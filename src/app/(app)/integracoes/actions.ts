"use server";

import { revalidatePath } from "next/cache";
import { obterContexto } from "@/lib/contexto";
import {
  dicaSegredo,
  filtrarEscopos,
  filtrarEventos,
  itemCatalogo,
  separarCampos,
  validarUrlWebhook,
  type ContratoImportado,
  type OrigemMapa,
} from "@/lib/dominio/integracoes";
import { type EstadoAcao, ErroValidacao, inteiro, mensagemErro, texto, textoObrigatorio } from "@/lib/form";
import { exigirPermissao } from "@/lib/permissoes";
import { buscarPosicao, consultasDoEndereco } from "@/lib/servicos/integracoes/geocodificacao";
import { testarConexao } from "@/lib/servicos/integracoes/provedores";
import { cifrarTodos, decifrarTodos } from "@/lib/servicos/integracoes/segredos";
import { entregarWebhooks } from "@/lib/servicos/integracoes/webhooks";
import { carregarReferencias, conferirLinha, fimDoContrato } from "./importacao";
import type { EstadoSegredo } from "./janela-segredo";

type Resultado = { ok: boolean; erro?: string };
const falha = (e: unknown): Resultado => ({ ok: false, erro: mensagemErro(e) });

/** Integrações: só o administrador muda (o banco confere o papel de novo nas tabelas e funções). */
async function contextoAdmin() {
  const ctx = await obterContexto();
  if (ctx.papel !== "admin") throw new ErroValidacao("Só o administrador mexe nas integrações (o gestor acompanha).");
  await exigirPermissao("configuracoes", "editar");
  return ctx;
}

function revalidar() {
  revalidatePath("/integracoes", "layout");
}

// ---------------------------------------------------------------------------
// Provedores
// ---------------------------------------------------------------------------

function provedorDoModo(id: string, modo: string) {
  const item = itemCatalogo(id);
  if (!item || (item.tipo !== "provedor" && id !== "nominatim")) throw new ErroValidacao("Integração desconhecida.");
  if (item.soImobiliaria && modo === "pessoal") throw new ErroValidacao("Esta integração só existe no modo imobiliária.");
  return item;
}

/** Configuração comum (salva sozinha): ambiente, ligado/desligado e campos não secretos. */
export async function salvarProvedor(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  try {
    const { supabase, organizacao } = await contextoAdmin();
    const item = provedorDoModo(textoObrigatorio(fd, "provedor"), organizacao.modo);
    const valores = Object.fromEntries((item.campos ?? []).filter((c) => c.tipo !== "segredo").map((c) => [c.nome, texto(fd, c.nome)]));
    const { config } = separarCampos(item, valores);
    const ambiente = texto(fd, "ambiente") === "producao" ? "producao" : "sandbox";
    const ativo = fd.getAll("ativo").includes("on");
    const { data: atual } = await supabase.from("integracoes_config").select("ambiente").eq("provedor", item.id).maybeSingle();
    const mudouAmbiente = atual && atual.ambiente !== ambiente;
    const { error } = await supabase.from("integracoes_config").upsert(
      {
        organizacao_id: organizacao.id,
        provedor: item.id,
        categoria: item.categoria,
        ambiente,
        ativo,
        config,
        ...(mudouAmbiente ? { ultimo_teste_ok: null, ultimo_teste_msg: "Ambiente trocado: teste de novo." } : {}),
      },
      { onConflict: "organizacao_id,provedor" },
    );
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Salvo." };
}

/** Guarda as chaves/senhas (cifradas se houver INTEGRACOES_CHAVE). Campo vazio mantém o que já estava. */
export async function guardarSegredos(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  try {
    const { supabase, organizacao } = await contextoAdmin();
    const item = provedorDoModo(textoObrigatorio(fd, "provedor"), organizacao.modo);
    const valores = Object.fromEntries((item.campos ?? []).filter((c) => c.tipo === "segredo").map((c) => [c.nome, texto(fd, c.nome)]));
    const { segredos } = separarCampos(item, valores);
    if (!Object.keys(segredos).length) throw new ErroValidacao("Preencha a chave (ou senha) que quer guardar.");
    const [{ data: cofre }, { data: cfg }] = await Promise.all([
      supabase.from("integracoes_segredos").select("segredos").eq("provedor", item.id).maybeSingle(),
      supabase.from("integracoes_config").select("chaves_dica").eq("provedor", item.id).maybeSingle(),
    ]);
    const r1 = await supabase
      .from("integracoes_segredos")
      .upsert({ organizacao_id: organizacao.id, provedor: item.id, segredos: { ...((cofre?.segredos as Record<string, string>) ?? {}), ...cifrarTodos(segredos) } }, { onConflict: "organizacao_id,provedor" });
    if (r1.error) throw r1.error;
    const dicas = { ...((cfg?.chaves_dica as Record<string, string>) ?? {}), ...Object.fromEntries(Object.entries(segredos).map(([k, v]) => [k, dicaSegredo(v)])) };
    const r2 = await supabase
      .from("integracoes_config")
      .upsert({ organizacao_id: organizacao.id, provedor: item.id, categoria: item.categoria, chaves_dica: dicas, ultimo_teste_ok: null, ultimo_teste_msg: null }, { onConflict: "organizacao_id,provedor" });
    if (r2.error) throw r2.error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Chaves guardadas. Elas não aparecem de novo na tela." };
}

export async function apagarSegredos(provedor: string): Promise<Resultado> {
  try {
    const { supabase, organizacao } = await contextoAdmin();
    provedorDoModo(provedor, organizacao.modo);
    const r = await supabase.from("integracoes_segredos").delete().eq("provedor", provedor);
    if (r.error) throw r.error;
    await supabase.from("integracoes_config").update({ chaves_dica: {}, ativo: false, ultimo_teste_ok: null, ultimo_teste_msg: null }).eq("provedor", provedor);
  } catch (e) {
    return falha(e);
  }
  revalidar();
  return { ok: true };
}

export async function excluirProvedor(provedor: string): Promise<Resultado> {
  try {
    const { supabase } = await contextoAdmin();
    const r1 = await supabase.from("integracoes_segredos").delete().eq("provedor", provedor);
    if (r1.error) throw r1.error;
    const r2 = await supabase.from("integracoes_config").delete().eq("provedor", provedor);
    if (r2.error) throw r2.error;
  } catch (e) {
    return falha(e);
  }
  revalidar();
  return { ok: true };
}

/** Testar conexão: chamada real só nos provedores implementados (o resultado fica gravado). */
export async function testarProvedor(provedor: string): Promise<Resultado> {
  let r: { ok: boolean; mensagem: string };
  try {
    const { supabase, organizacao } = await contextoAdmin();
    const item = provedorDoModo(provedor, organizacao.modo);
    const [{ data: cfg }, { data: cofre }] = await Promise.all([
      supabase.from("integracoes_config").select("ambiente, config").eq("provedor", provedor).maybeSingle(),
      supabase.from("integracoes_segredos").select("segredos").eq("provedor", provedor).maybeSingle(),
    ]);
    r = await testarConexao(provedor, {
      ambiente: cfg?.ambiente === "producao" ? "producao" : "sandbox",
      config: (cfg?.config as Record<string, string>) ?? {},
      segredos: decifrarTodos(cofre?.segredos as Record<string, unknown>),
    });
    const { error } = await supabase.from("integracoes_config").upsert(
      {
        organizacao_id: organizacao.id,
        provedor,
        categoria: item.categoria,
        ultimo_teste_em: new Date().toISOString(),
        ultimo_teste_ok: r.ok,
        ultimo_teste_msg: r.mensagem.slice(0, 500),
        ...(provedor === "nominatim" ? { ativo: r.ok, ambiente: "producao" } : {}),
      },
      { onConflict: "organizacao_id,provedor" },
    );
    if (error) throw error;
  } catch (e) {
    return falha(e);
  }
  revalidar();
  return r.ok ? { ok: true } : { ok: false, erro: r.mensagem };
}

/** Imóveis que já tentaram e não acharam (por instância; evita repetir a mesma consulta a cada clique). */
const naoAchados = new Map<string, number>();

/** Preenche latitude/longitude pelo endereço (OpenStreetMap, 1 consulta por segundo, poucas por clique). */
export async function localizarImoveis(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  void fd;
  const MAX_CONSULTAS = 6;
  try {
    const { supabase } = await contextoAdmin();
    await exigirPermissao("imoveis", "editar");
    const { data, error } = await supabase
      .from("imoveis")
      .select("id, codigo, logradouro, numero, bairro, cidade, uf")
      .or("latitude.is.null,longitude.is.null")
      .not("logradouro", "is", null)
      .not("cidade", "is", null)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw error;
    const agora = Date.now();
    const fila = (data ?? []).filter((i) => (naoAchados.get(i.id) ?? 0) < agora - 86_400_000);
    if (!fila.length) return { ok: data?.length ? "Os imóveis sem posição já foram tentados hoje e o endereço não foi achado: confira rua e cidade no cadastro." : "Todos os imóveis com endereço já têm posição no mapa." };
    let consultas = 0;
    let achados = 0;
    const semPosicao: string[] = [];
    for (const i of fila) {
      if (consultas >= MAX_CONSULTAS) break;
      const tentativas = consultasDoEndereco(i);
      let pos: { lat: number; lon: number } | null = null;
      let feitas = 0;
      for (const q of tentativas) {
        if (consultas >= MAX_CONSULTAS) break;
        consultas += 1;
        feitas += 1;
        pos = await buscarPosicao(q);
        if (pos) break;
      }
      if (pos) {
        const r = await supabase.from("imoveis").update({ latitude: pos.lat, longitude: pos.lon }).eq("id", i.id);
        if (r.error) throw r.error;
        achados += 1;
      } else if (feitas === tentativas.length) {
        // Tentou todas as formas do endereço: não repete hoje.
        naoAchados.set(i.id, agora);
        semPosicao.push(i.codigo ?? "sem código");
      }
    }
    revalidatePath("/imoveis", "layout");
    revalidar();
    const resto = fila.length - achados - semPosicao.length;
    return {
      ok:
        `${achados} imóvel(is) localizado(s).` +
        (semPosicao.length ? ` Não achei no mapa: ${semPosicao.join(", ")}.` : "") +
        (resto > 0 ? ` Faltam ${resto}: clique de novo (o OpenStreetMap aceita uma consulta por segundo).` : ""),
    };
  } catch (e) {
    return { erro: e instanceof Error && /OpenStreetMap|fetch|Timeout/i.test(`${e.name} ${e.message}`) ? "O OpenStreetMap não respondeu agora. Tente de novo em instantes." : mensagemErro(e) };
  }
}

// ---------------------------------------------------------------------------
// Chaves de API
// ---------------------------------------------------------------------------

export async function criarChave(_: EstadoSegredo, fd: FormData): Promise<EstadoSegredo> {
  try {
    const { supabase, organizacao } = await contextoAdmin();
    const nome = textoObrigatorio(fd, "nome", "o nome da chave");
    const escopos = filtrarEscopos(fd.getAll("escopos").map(String), organizacao.modo);
    if (!escopos.length) throw new ErroValidacao("Marque pelo menos uma permissão.");
    const dias = inteiro(fd, "validade_dias") ?? 0;
    const limite = Math.min(5000, Math.max(1, inteiro(fd, "limite_hora") ?? 600));
    const expira = dias > 0 ? new Date(Date.now() + dias * 86_400_000).toISOString() : null;
    const { data, error } = await supabase.rpc("api_chave_criar", { p_nome: nome, p_escopos: escopos, p_expira_em: expira, p_limite_hora: limite });
    if (error) throw error;
    revalidar();
    return { ok: "Chave criada.", segredo: (data as { chave: string }).chave };
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
}

export async function revogarChave(id: string): Promise<Resultado> {
  try {
    const { supabase } = await contextoAdmin();
    const { error } = await supabase.from("api_chaves").update({ revogada_em: new Date().toISOString() }).eq("id", id).is("revogada_em", null);
    if (error) throw error;
  } catch (e) {
    return falha(e);
  }
  revalidar();
  return { ok: true };
}

export async function excluirChave(id: string): Promise<Resultado> {
  try {
    const { supabase } = await contextoAdmin();
    const { error } = await supabase.from("api_chaves").delete().eq("id", id);
    if (error) throw error;
  } catch (e) {
    return falha(e);
  }
  revalidar();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

function lerWebhook(fd: FormData, modo: string) {
  const nome = textoObrigatorio(fd, "nome", "o nome do webhook");
  const url = textoObrigatorio(fd, "url", "o endereço (URL)");
  const problema = validarUrlWebhook(url);
  if (problema) throw new ErroValidacao(problema);
  const eventos = filtrarEventos(fd.getAll("eventos").map(String), modo === "pessoal" ? "pessoal" : "imobiliaria");
  if (!eventos.length) throw new ErroValidacao("Marque pelo menos um evento.");
  return { nome, url, eventos };
}

export async function criarWebhook(_: EstadoSegredo, fd: FormData): Promise<EstadoSegredo> {
  try {
    const { supabase, organizacao } = await contextoAdmin();
    const w = lerWebhook(fd, organizacao.modo);
    const { data, error } = await supabase.rpc("webhook_criar", { p_nome: w.nome, p_url: w.url, p_eventos: w.eventos });
    if (error) throw error;
    revalidar();
    return { ok: "Webhook criado.", segredo: (data as { segredo: string }).segredo };
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
}

/** Edição (salva sozinha): nome, endereço e eventos. */
export async function salvarWebhook(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  try {
    const { supabase, organizacao } = await contextoAdmin();
    const id = textoObrigatorio(fd, "id");
    const w = lerWebhook(fd, organizacao.modo);
    const { error } = await supabase.from("webhook_assinaturas").update(w).eq("id", id);
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Salvo." };
}

export async function pausarWebhook(id: string): Promise<Resultado> {
  try {
    const { supabase } = await contextoAdmin();
    const { error } = await supabase.from("webhook_assinaturas").update({ ativo: false, pausada_motivo: "Pausado pelo administrador." }).eq("id", id);
    if (error) throw error;
  } catch (e) {
    return falha(e);
  }
  revalidar();
  return { ok: true };
}

export async function reativarWebhook(id: string): Promise<Resultado> {
  try {
    const { supabase } = await contextoAdmin();
    const { error } = await supabase.from("webhook_assinaturas").update({ ativo: true }).eq("id", id);
    if (error) throw error;
  } catch (e) {
    return falha(e);
  }
  revalidar();
  return { ok: true };
}

/** Manda um evento de teste e tenta entregar na hora; diz o que o destino respondeu. */
export async function testarWebhook(id: string): Promise<Resultado> {
  try {
    const { supabase } = await contextoAdmin();
    const { data: entregaId, error } = await supabase.rpc("webhook_enviar_teste", { p_id: id });
    if (error) throw error;
    if (typeof entregaId !== "string") throw new ErroValidacao("Não foi possível pôr o teste na fila.");
    // Entrega ESTA entrega agora (mesmo que haja outras esperando na fila).
    await entregarWebhooks(supabase, 1, entregaId);
    const { data: ult } = await supabase.from("webhook_entregas").select("status, resposta_status, erro").eq("id", entregaId).maybeSingle();
    revalidar();
    if (ult && ult.status !== "entregue")
      return { ok: false, erro: `O teste não foi entregue: ${ult.erro ?? (ult.resposta_status ? `o destino respondeu ${ult.resposta_status}` : "sem resposta")}. O sistema tenta de novo sozinho.` };
  } catch (e) {
    return falha(e);
  }
  return { ok: true };
}

export async function trocarSegredoWebhook(_: EstadoSegredo, fd: FormData): Promise<EstadoSegredo> {
  try {
    const { supabase } = await contextoAdmin();
    const { data, error } = await supabase.rpc("webhook_trocar_segredo", { p_id: textoObrigatorio(fd, "id") });
    if (error) throw error;
    revalidar();
    return { ok: "Segredo trocado.", segredo: (data as { segredo: string }).segredo };
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
}

export async function excluirWebhook(id: string): Promise<Resultado> {
  try {
    const { supabase } = await contextoAdmin();
    const { error } = await supabase.from("webhook_assinaturas").delete().eq("id", id);
    if (error) throw error;
  } catch (e) {
    return falha(e);
  }
  revalidar();
  return { ok: true };
}

export async function reprocessarEntrega(id: string): Promise<Resultado> {
  try {
    const { supabase } = await contextoAdmin();
    const { error } = await supabase.rpc("webhook_reprocessar", { p_entrega: id });
    if (error) throw error;
    await entregarWebhooks(supabase, 1, id);
  } catch (e) {
    return falha(e);
  }
  revalidar();
  return { ok: true };
}

/** "Enviar agora": entrega o que já venceu na fila (sem esperar o próximo uso do sistema). */
export async function entregarFilaAgora(_id: string): Promise<Resultado> {
  void _id;
  try {
    const { supabase } = await contextoAdmin();
    await entregarWebhooks(supabase, 20);
  } catch (e) {
    return falha(e);
  }
  revalidar();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Contabilidade: de-para do plano de contas
// ---------------------------------------------------------------------------

/** Uma linha do de-para (salva sozinha). Conta vazia = tira o de-para. */
export async function salvarMapaContabil(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  try {
    const { supabase } = await contextoAdmin();
    const tipo = texto(fd, "origem_tipo") as OrigemMapa | null;
    if (!tipo || !["plano", "categoria", "conta_financeira", "padrao"].includes(tipo)) throw new ErroValidacao("Origem inválida.");
    const origemId = tipo === "plano" || tipo === "conta_financeira" ? textoObrigatorio(fd, "origem_id") : null;
    const origemTexto = tipo === "categoria" || tipo === "padrao" ? textoObrigatorio(fd, "origem_texto") : null;
    const conta = texto(fd, "conta_contabil");
    const historico = texto(fd, "historico_padrao");
    let q = supabase.from("contabil_contas_mapa").select("id").eq("origem_tipo", tipo);
    q = origemId ? q.eq("origem_id", origemId) : q.ilike("origem_texto", (origemTexto ?? "").replace(/[\\%_]/g, "\\$&"));
    const { data: atual } = await q.maybeSingle();
    if (!conta) {
      if (atual) {
        const r = await supabase.from("contabil_contas_mapa").delete().eq("id", atual.id);
        if (r.error) throw r.error;
      }
    } else if (atual) {
      const r = await supabase.from("contabil_contas_mapa").update({ conta_contabil: conta.slice(0, 60), historico_padrao: historico?.slice(0, 200) ?? null }).eq("id", atual.id);
      if (r.error) throw r.error;
    } else {
      const r = await supabase
        .from("contabil_contas_mapa")
        .insert({ origem_tipo: tipo, origem_id: origemId, origem_texto: origemTexto, conta_contabil: conta.slice(0, 60), historico_padrao: historico?.slice(0, 200) ?? null });
      if (r.error) throw r.error;
    }
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidatePath("/integracoes/exportar");
  return { ok: "Salvo." };
}

// ---------------------------------------------------------------------------
// Importação de contratos
// ---------------------------------------------------------------------------

export async function salvarModeloImportacao(nome: string, mapa: Record<string, string>): Promise<Resultado> {
  try {
    const { supabase } = await contextoAdmin();
    const n = nome.trim().slice(0, 80);
    if (!n) throw new ErroValidacao("Dê um nome ao modelo (ex.: o nome do sistema antigo).");
    if (!Object.keys(mapa).length) throw new ErroValidacao("Ligue pelo menos uma coluna antes de salvar o modelo.");
    const { error } = await supabase.from("importacao_modelos").upsert({ tipo: "contratos", nome: n, mapa }, { onConflict: "organizacao_id,tipo,nome" });
    if (error) throw error;
  } catch (e) {
    return falha(e);
  }
  revalidatePath("/integracoes/importar");
  return { ok: true };
}

export async function excluirModeloImportacao(id: string): Promise<Resultado> {
  try {
    const { supabase } = await contextoAdmin();
    const { error } = await supabase.from("importacao_modelos").delete().eq("id", id);
    if (error) throw error;
  } catch (e) {
    return falha(e);
  }
  revalidatePath("/integracoes/importar");
  return { ok: true };
}

type LinhaEnvio = { linha: number; dados: ContratoImportado };
const MAX_LINHAS = 300;

/** Prévia: confere cada linha contra o cadastro (imóvel, pessoas, proprietários, contrato ativo). */
export async function conferirContratos(linhas: LinhaEnvio[]): Promise<{ ok: boolean; erro?: string; problemas?: Record<number, string[]> }> {
  try {
    const { supabase, organizacao } = await contextoAdmin();
    await exigirPermissao("contratos", "criar");
    if (linhas.length > 2000) throw new ErroValidacao("Até 2.000 linhas por arquivo.");
    const refs = await carregarReferencias(supabase);
    const problemas: Record<number, string[]> = {};
    const noArquivo = new Map<string, number>();
    for (const l of linhas) {
      const c = conferirLinha(l.dados, refs, organizacao.modo);
      if (l.dados.status === "ativo" && c.imovelId) {
        const antes = noArquivo.get(c.imovelId);
        if (antes) c.erros.push(`mesmo imóvel ativo na linha ${antes}`);
        else noArquivo.set(c.imovelId, l.linha);
      }
      if (c.erros.length) problemas[l.linha] = c.erros;
    }
    return { ok: true, problemas };
  } catch (e) {
    return falha(e);
  }
}

/** Cria os contratos (até 300 por chamada; a tela manda em partes). Cada linha é tudo ou nada. */
export async function importarContratos(linhas: LinhaEnvio[]): Promise<{ ok: boolean; erro?: string; criados?: number; falhas?: string[] }> {
  const falhas: string[] = [];
  let criados = 0;
  try {
    const { supabase, organizacao } = await contextoAdmin();
    await exigirPermissao("contratos", "criar");
    if (linhas.length > MAX_LINHAS) throw new ErroValidacao(`Envie até ${MAX_LINHAS} linhas por vez.`);
    const pessoal = organizacao.modo === "pessoal";
    const refs = await carregarReferencias(supabase);
    for (const { linha, dados: d } of linhas) {
      const c = conferirLinha(d, refs, organizacao.modo);
      if (c.erros.length || !c.imovelId || !c.locatarioId) {
        falhas.push(`Linha ${linha}: ${c.erros.join("; ") || "dados incompletos"}`);
        continue;
      }
      const fim = fimDoContrato(d);
      const ativo = d.status === "ativo";
      const { data: novo, error } = await supabase
        .from("contratos")
        .insert({
          imovel_id: c.imovelId,
          codigo: d.codigo,
          finalidade: d.finalidade,
          data_inicio: d.data_inicio,
          prazo_meses: d.prazo_meses,
          data_fim: fim,
          valor_aluguel: d.valor_aluguel,
          dia_vencimento: d.dia_vencimento,
          modalidade: d.modalidade,
          indice_reajuste: d.indice_reajuste,
          data_base_reajuste: d.data_inicio,
          taxa_administracao_pct: pessoal ? 0 : (d.taxa_administracao_pct ?? Number(organizacao.taxa_administracao_pct ?? 10)),
          taxa_intermediacao_pct: pessoal ? 0 : (d.taxa_intermediacao_pct ?? Number(organizacao.taxa_intermediacao_pct ?? 100)),
          tipo_repasse: pessoal ? "manual" : "automatico",
          garantia_tipo: d.garantia_tipo,
          garantia_valor: d.garantia_valor,
          observacoes: [d.observacoes, `Importado de outro sistema (linha ${linha}).`].filter(Boolean).join("\n"),
          status: ativo ? "ativo" : "encerrado",
          ativado_em: ativo ? new Date().toISOString() : null,
        })
        .select("id")
        .single();
      if (error || !novo) {
        falhas.push(`Linha ${linha}: ${mensagemErro(error)}`);
        continue;
      }
      try {
        const partes = [
          ...(pessoal ? [] : c.proprietarios).map((p) => ({ contrato_id: novo.id, pessoa_id: p.pessoa_id, papel: "proprietario", percentual: p.percentual })),
          { contrato_id: novo.id, pessoa_id: c.locatarioId, papel: "locatario", percentual: null },
          ...(c.fiadorId ? [{ contrato_id: novo.id, pessoa_id: c.fiadorId, papel: "fiador", percentual: null }] : []),
        ];
        const r1 = await supabase.from("contrato_partes").insert(partes);
        if (r1.error) throw r1.error;
        if (d.garantia_tipo !== "sem_garantia") {
          const r2 = await supabase
            .from("contrato_garantias")
            .insert({ contrato_id: novo.id, tipo: d.garantia_tipo, pessoa_id: d.garantia_tipo === "fiador" ? c.fiadorId : null, valor: d.garantia_valor });
          if (r2.error) throw r2.error;
        }
        if (ativo) {
          await supabase.from("imoveis").update({ status: "alugado" }).eq("id", c.imovelId);
          refs.ativos.set(c.imovelId, [...(refs.ativos.get(c.imovelId) ?? []), { imovel_id: c.imovelId, data_inicio: d.data_inicio, data_fim: fim, data_rescisao: null, numero: 0 }]);
        }
        for (const [pid, papel] of [
          [c.locatarioId, "locatario"],
          [c.fiadorId, "fiador"],
        ] as const) {
          if (!pid) continue;
          const p = [...refs.pessoaPorDocumento.values()].find((x) => x.id === pid);
          if (p && !p.papeis.includes(papel)) {
            await supabase.from("pessoas").update({ papeis: [...p.papeis, papel] }).eq("id", pid);
            p.papeis = [...p.papeis, papel];
          }
        }
        if (d.codigo) refs.codigosContrato.add(d.codigo.trim().toLowerCase());
        criados += 1;
      } catch (e) {
        await supabase.from("contratos").delete().eq("id", novo.id);
        falhas.push(`Linha ${linha}: ${mensagemErro(e)}`);
      }
    }
  } catch (e) {
    return { ...falha(e), criados, falhas };
  }
  revalidatePath("/contratos");
  revalidatePath("/imoveis", "layout");
  revalidatePath("/");
  return { ok: true, criados, falhas };
}
