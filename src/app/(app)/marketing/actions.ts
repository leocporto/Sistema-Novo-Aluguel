"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { obterContexto } from "@/lib/contexto";
import { type EstadoAcao, ErroValidacao, inteiro, mensagemErro, numero, texto, textoObrigatorio } from "@/lib/form";
import { hojeISO } from "@/lib/dominio/datas";
import {
  CANAIS,
  GATILHOS,
  MODELOS_PADRAO,
  TIPOS_CAMPANHA,
  USOS_MODELO,
  contatoBloqueado,
  dataHoraLocalParaISO,
  finalidadeDoTipo,
  gerarSlug,
  lerFiltros,
  separarPorSugestao,
  telefoneE164,
  pixelMetaValido,
  rotuloConversaoValido,
  slugValido,
  tagGoogleValida,
  type Canal,
  type Contato,
  type Descadastro,
  type FiltrosCampanha,
} from "@/lib/dominio/marketing";
import { processarAutomacoes } from "./automacao";
import { carregarBloqueios, carregarContatos, imoveisDisponiveis, obterConfig, todas, urlBase, type Campanha } from "./dados";
import { corpoPadrao, gravarFila, linhaParaContato, type NovaLinhaEnvio, type NovaPesquisa } from "./montar-fila";
import { prepararCampanha } from "./publico-campanha";

type Resultado = { ok: boolean; erro?: string };

/** Marketing só existe no modo imobiliária (docs/MODOS.md): as ações também conferem. */
async function contexto() {
  const c = await obterContexto();
  if (c.organizacao.modo === "pessoal") throw new ErroValidacao("Marketing só existe no modo imobiliária.");
  return c;
}

const gestor = (papel: string) => papel === "admin" || papel === "gestor";

function revalidar() {
  revalidatePath("/marketing", "layout");
}

const canalValido = (v: string | null, padrao: Canal = "whatsapp"): Canal => ((CANAIS as readonly string[]).includes(v ?? "") ? (v as Canal) : padrao);
const marcado = (fd: FormData, campo: string) => fd.getAll(campo).includes("on");

async function acao(fn: () => Promise<void>): Promise<Resultado> {
  try {
    await fn();
  } catch (e) {
    return { ok: false, erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: true };
}

// =============================================================================
// Configuração (só administrador ou gestor)
// =============================================================================
export async function salvarConfig(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  try {
    const { supabase, papel } = await contexto();
    if (!gestor(papel)) throw new ErroValidacao("Só administradores e gestores mudam as configurações de marketing.");
    const cfg = await obterConfig(supabase);
    const d: Record<string, unknown> = {};
    for (const c of ["whatsapp_numero", "whatsapp_phone_number_id", "whatsapp_waba_id", "email_remetente", "assinatura", "pesquisa_pergunta"]) if (fd.has(c)) d[c] = texto(fd, c);
    if (fd.has("meta_pixel_id")) {
      const v = texto(fd, "meta_pixel_id");
      if (v && !pixelMetaValido(v)) throw new ErroValidacao("O ID do pixel da Meta tem só números (ex.: 123456789012345).");
      d.meta_pixel_id = v;
    }
    if (fd.has("google_tag_id")) {
      const v = texto(fd, "google_tag_id");
      if (v && !tagGoogleValida(v)) throw new ErroValidacao("A tag do Google começa com G- ou AW- (ex.: G-ABC123 ou AW-123456789).");
      d.google_tag_id = v?.toUpperCase() ?? null;
    }
    if (fd.has("google_conversao_label")) {
      const v = texto(fd, "google_conversao_label");
      if (v && !rotuloConversaoValido(v)) throw new ErroValidacao("A conversão do Google Ads tem o formato AW-123456789/AbCdEf.");
      d.google_conversao_label = v;
    }
    if (fd.has("whatsapp_cria_lead")) d.whatsapp_cria_lead = marcado(fd, "whatsapp_cria_lead");
    // Segredo do app (Meta › Configurações do app › Básico › Chave secreta do app): campo vazio = mantém.
    if (fd.has("whatsapp_app_secret")) {
      const v = (texto(fd, "whatsapp_app_secret") ?? "").trim();
      if (v) {
        if (!/^[A-Za-z0-9_-]{16,200}$/.test(v)) throw new ErroValidacao("A chave secreta do app da Meta tem letras e números (32 caracteres, em geral).");
        d.whatsapp_app_secret = v;
      }
    }
    if (!Object.keys(d).length) return { ok: "Salvo." };
    const { error } = await supabase.from("mkt_config").update(d).eq("id", cfg.id);
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Salvo." };
}

/** Gera um novo código secreto (o anterior para de funcionar). */
export async function trocarCodigo(qual: string): Promise<Resultado> {
  return acao(async () => {
    const { supabase, papel } = await contexto();
    if (!gestor(papel)) throw new ErroValidacao("Só administradores e gestores trocam os códigos.");
    const cfg = await obterConfig(supabase);
    const novo = randomUUID().replace(/-/g, "");
    const campo: Record<string, unknown> =
      qual === "webhook"
        ? { webhook_token: randomUUID() }
        : qual === "whatsapp"
          ? { whatsapp_verify_token: novo }
          : qual === "meta"
            ? { meta_verify_token: novo }
            : qual === "google"
              ? { google_lead_key: novo }
              : qual === "segredo_whatsapp"
                ? { whatsapp_app_secret: null }
                : {};
    if (!Object.keys(campo).length) throw new ErroValidacao("Código desconhecido.");
    const { error } = await supabase.from("mkt_config").update(campo).eq("id", cfg.id);
    if (error) throw error;
  });
}

// =============================================================================
// Modelos de mensagem
// =============================================================================
function dadosModelo(fd: FormData, parcial: boolean) {
  const d: Record<string, unknown> = {};
  if (!parcial || fd.has("nome")) d.nome = textoObrigatorio(fd, "nome", "o nome do modelo");
  if (!parcial || fd.has("canal")) d.canal = canalValido(texto(fd, "canal"));
  if (!parcial || fd.has("uso")) d.uso = texto(fd, "uso") && texto(fd, "uso")! in USOS_MODELO ? texto(fd, "uso") : "geral";
  if (!parcial || fd.has("assunto")) d.assunto = texto(fd, "assunto");
  if (!parcial || fd.has("corpo")) d.corpo = textoObrigatorio(fd, "corpo", "o texto da mensagem");
  if (fd.has("ativo")) d.ativo = marcado(fd, "ativo");
  return d;
}

export async function criarModelo(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  try {
    const { supabase } = await contexto();
    const { error } = await supabase.from("mkt_modelos").insert(dadosModelo(fd, false));
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Modelo criado." };
}

export async function atualizarModelo(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  try {
    const { supabase } = await contexto();
    const { error } = await supabase.from("mkt_modelos").update(dadosModelo(fd, true)).eq("id", String(fd.get("id")));
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Salvo." };
}

export async function excluirModelo(id: string): Promise<Resultado> {
  return acao(async () => {
    const { supabase } = await contexto();
    const { error } = await supabase.from("mkt_modelos").delete().eq("id", id);
    if (error) throw error;
  });
}

/** Instala os modelos prontos que ainda não existem (pelo nome). */
export async function instalarModelosProntos(): Promise<Resultado> {
  return acao(async () => {
    const { supabase } = await contexto();
    const { data } = await supabase.from("mkt_modelos").select("nome");
    const tem = new Set((data ?? []).map((m) => (m.nome as string).toLowerCase()));
    const novos = MODELOS_PADRAO.filter((m) => !tem.has(m.nome.toLowerCase())).map((m) => ({ nome: m.nome, canal: m.canal, uso: m.uso, assunto: m.assunto ?? null, corpo: m.corpo }));
    if (!novos.length) throw new ErroValidacao("Os modelos prontos já estão instalados.");
    const { error } = await supabase.from("mkt_modelos").insert(novos);
    if (error) throw error;
  });
}

// =============================================================================
// Campanhas
// =============================================================================
function filtrosPadrao(tipo: string): FiltrosCampanha {
  switch (tipo) {
    case "reativacao":
      // Mesma regra da tela Comercial › Reativar (perdidos há 30+ dias ou parados há 60+).
      return { publico: "leads", reativar: true };
    case "novo_imovel":
    case "reducao_preco":
      return { publico: "ambos", combina_imovel: true };
    case "pesquisa":
    case "pos_venda":
    case "pos_locacao":
      return { publico: "pessoas" };
    default:
      return { publico: "ambos" };
  }
}

export async function criarCampanha(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  let id: string;
  try {
    const { supabase } = await contexto();
    const nome = textoObrigatorio(fd, "nome", "o nome da campanha");
    const tipo = (TIPOS_CAMPANHA as readonly string[]).includes(texto(fd, "tipo") ?? "") ? (texto(fd, "tipo") as string) : "manual";
    let canal = canalValido(texto(fd, "canal"));
    const modeloId = texto(fd, "modelo_id");
    let mensagem = corpoPadrao(tipo);
    let assunto: string | null = null;
    if (modeloId) {
      const { data: m } = await supabase.from("mkt_modelos").select("corpo, assunto, canal").eq("id", modeloId).single();
      if (m) {
        mensagem = m.corpo as string;
        assunto = m.assunto as string | null;
        canal = m.canal as Canal;
      }
    }
    const { data, error } = await supabase
      .from("mkt_campanhas")
      .insert({
        nome,
        tipo,
        canal,
        modelo_id: modeloId,
        mensagem,
        assunto,
        imovel_id: texto(fd, "imovel_id"),
        filtros: filtrosPadrao(tipo),
        utm_campaign: gerarSlug(nome) || null,
      })
      .select("id")
      .single();
    if (error) throw error;
    id = data.id;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  redirect(`/marketing/campanhas/${id}`);
}

function filtrosDoFormulario(fd: FormData): FiltrosCampanha {
  const n = inteiro(fd, "f_parado_dias");
  return lerFiltros({
    publico: texto(fd, "f_publico"),
    funil: texto(fd, "f_funil"),
    etapas: fd.getAll("f_etapas").map(String).filter(Boolean),
    origem: texto(fd, "f_origem"),
    utm_source: texto(fd, "f_utm_source"),
    corretor: texto(fd, "f_corretor"),
    parado_dias: n && n > 0 ? n : null,
    incluir_perdidos: marcado(fd, "f_incluir_perdidos"),
    reativar: marcado(fd, "f_reativar"),
    papel: texto(fd, "f_papel"),
    regiao: texto(fd, "f_regiao"),
    interesse: texto(fd, "f_interesse"),
    combina_imovel: marcado(fd, "f_combina_imovel"),
  });
}

/** Salva sozinho a ficha da campanha (mensagem, público, agendamento). */
export async function atualizarCampanha(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  try {
    const { supabase } = await contexto();
    const id = String(fd.get("id"));
    const { data: atual, error: e1 } = await supabase.from("mkt_campanhas").select("modelo_id, status").eq("id", id).single();
    if (e1) throw e1;
    if (atual.status === "cancelada") throw new ErroValidacao("Campanha cancelada não muda mais.");
    const d: Record<string, unknown> = {};
    if (fd.has("nome")) d.nome = textoObrigatorio(fd, "nome", "o nome da campanha");
    if (fd.has("canal")) d.canal = canalValido(texto(fd, "canal"));
    for (const c of ["assunto", "utm_campaign", "imovel_id"]) if (fd.has(c)) d[c] = texto(fd, c);
    if (fd.has("link")) {
      const l = texto(fd, "link");
      if (l && !/^https?:\/\//i.test(l)) throw new ErroValidacao("O link precisa começar com https://");
      d.link = l;
    }
    if (fd.has("mensagem")) d.mensagem = texto(fd, "mensagem") ?? "";
    if (fd.has("agendada_para")) d.agendada_para = dataHoraLocalParaISO(texto(fd, "agendada_para"));
    if (fd.has("so_autorizados")) d.so_autorizados = marcado(fd, "so_autorizados");
    if (fd.has("filtros")) d.filtros = filtrosDoFormulario(fd);
    if (fd.has("modelo_id")) {
      const modeloId = texto(fd, "modelo_id");
      d.modelo_id = modeloId;
      // Trocou o modelo: o texto passa a ser o do modelo.
      if (modeloId && modeloId !== atual.modelo_id) {
        const { data: m } = await supabase.from("mkt_modelos").select("corpo, assunto, canal").eq("id", modeloId).single();
        if (m) {
          d.mensagem = m.corpo;
          d.assunto = m.assunto;
          d.canal = m.canal;
        }
      }
    }
    const { error } = await supabase.from("mkt_campanhas").update(d).eq("id", id);
    if (error) throw error;
    // Fila já montada: a nova data vale para o que ainda não foi enviado.
    if ("agendada_para" in d && atual.status === "fila") {
      const { error: e2 } = await supabase
        .from("mkt_envios")
        .update({ agendado_para: (d.agendada_para as string | null) ?? new Date().toISOString() })
        .eq("campanha_id", id)
        .eq("status", "pendente");
      if (e2) throw e2;
    }
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Salvo." };
}

/**
 * Monta a fila de envio da campanha com o público de agora (quem pediu para não
 * receber fica de fora). Rodar de novo só acrescenta quem entrou no público depois.
 */
export async function montarFila(id: string): Promise<Resultado> {
  return acao(async () => {
    const { supabase, organizacao } = await contexto();
    const { data, error } = await supabase.from("mkt_campanhas").select("*").eq("id", id).single();
    if (error) throw error;
    const c = data as Campanha;
    if (c.status === "cancelada") throw new ErroValidacao("A campanha está cancelada.");
    if (!c.mensagem.trim()) throw new ErroValidacao("Escreva a mensagem antes de montar a fila.");
    if (c.canal === "email" && !(c.assunto ?? "").trim()) throw new ErroValidacao("Escreva o assunto do e-mail.");
    const finalidade = finalidadeDoTipo(c.tipo);
    // Mesma conta do "Público agora" e da prévia (publico-campanha.ts).
    const { incluidos: publico, ctx, problema } = await prepararCampanha(supabase, c, { base: await urlBase(), imobiliaria: organizacao.nome, agoraMs: Date.now() });
    if (problema) throw new ErroValidacao(problema);
    if (!publico.length) throw new ErroValidacao("Ninguém no público com esses filtros (ou todos pediram para não receber).");

    const existentes = await todas<{ chave: string; id: string }>(() => supabase.from("mkt_envios").select("id, chave").eq("campanha_id", id).order("id"));
    const ja = new Set(existentes.map((e) => e.chave));
    const linhas: NovaLinhaEnvio[] = [];
    const pesquisas: NovaPesquisa[] = [];
    const cfg = c.tipo === "pesquisa" || c.mensagem.includes("{{link_pesquisa}}") ? await obterConfig(supabase) : null;
    for (const contato of publico) {
      const r = linhaParaContato(contato, {
        prefixoChave: `c:${c.id}`,
        origem: c.tipo === "pesquisa" ? "pesquisa" : "campanha",
        finalidade,
        canal: c.canal,
        corpo: c.mensagem,
        assunto: c.assunto,
        agendadoPara: c.agendada_para ?? new Date().toISOString(),
        campanhaId: c.id,
        imovelId: c.imovel_id,
        ctx,
        pesquisa: { contexto: c.tipo === "pos_venda" || c.tipo === "pos_locacao" ? c.tipo : "atendimento", pergunta: cfg?.pesquisa_pergunta ?? null },
      });
      if (ja.has(r.linha.chave)) continue;
      linhas.push(r.linha);
      if (r.pesquisa) pesquisas.push(r.pesquisa);
    }
    if (!linhas.length && c.status === "fila") throw new ErroValidacao("A fila já tem todo mundo deste público.");
    await gravarFila(supabase, linhas, pesquisas);
    const { error: e2 } = await supabase.from("mkt_campanhas").update({ status: "fila", fila_em: new Date().toISOString() }).eq("id", id);
    if (e2) throw e2;
  });
}

export async function cancelarCampanha(id: string): Promise<Resultado> {
  return acao(async () => {
    const { supabase } = await contexto();
    const { error } = await supabase.from("mkt_campanhas").update({ status: "cancelada" }).eq("id", id);
    if (error) throw error;
    await supabase.from("mkt_envios").update({ status: "cancelado", motivo: "Campanha cancelada" }).eq("campanha_id", id).eq("status", "pendente");
  });
}

export async function duplicarCampanha(id: string): Promise<Resultado> {
  return acao(async () => {
    const { supabase } = await contexto();
    const { data, error } = await supabase.from("mkt_campanhas").select("*").eq("id", id).single();
    if (error) throw error;
    const c = data as Campanha;
    const { error: e2 } = await supabase.from("mkt_campanhas").insert({
      nome: `${c.nome} (cópia)`,
      tipo: c.tipo,
      canal: c.canal,
      modelo_id: c.modelo_id,
      assunto: c.assunto,
      mensagem: c.mensagem,
      filtros: c.filtros,
      imovel_id: c.imovel_id,
      so_autorizados: c.so_autorizados,
      utm_campaign: c.utm_campaign,
      link: c.link,
    });
    if (e2) throw e2;
  });
}

export async function excluirCampanha(id: string): Promise<Resultado> {
  return acao(async () => {
    const { supabase } = await contexto();
    const { error } = await supabase.from("mkt_campanhas").delete().eq("id", id);
    if (error) throw error;
  });
}

// =============================================================================
// Fila de envio
// =============================================================================
export async function marcarEnviado(id: string): Promise<Resultado> {
  return acao(async () => {
    const { supabase } = await contexto();
    const { data, error } = await supabase.from("mkt_envios").update({ status: "enviado" }).eq("id", id).in("status", ["pendente", "falhou"]).select("id");
    if (error) throw error;
    if (!data?.length) throw new ErroValidacao("Esta mensagem não está mais na fila (a pessoa pode ter pedido para não receber). Atualize a tela.");
  });
}

/**
 * E-mail em quantidade: depois de importar o CSV na ferramenta de e-mail
 * (Mailchimp, Brevo, RD…) e disparar, marca os MESMOS e-mails do CSV como
 * enviados (vai para o histórico do CRM). ref = "<fila|id da campanha>|<data do CSV>".
 * Quem pediu para não receber nesse meio-tempo vira "descadastrado", nunca "enviado".
 */
export async function marcarEmailsEnviados(ref: string): Promise<Resultado> {
  return acao(async () => {
    const { supabase } = await contexto();
    const [escopo, ate] = ref.split("|");
    if (!escopo || !ate || Number.isNaN(Date.parse(ate))) throw new ErroValidacao("Atualize a tela e tente de novo.");
    const ids = await todas<{ id: string }>(() => {
      let q = supabase.from("mkt_envios").select("id").eq("status", "pendente").eq("canal", "email").lte("created_at", ate).order("id");
      q = escopo === "fila" ? q.lte("agendado_para", ate) : q.eq("campanha_id", escopo);
      return q;
    });
    if (!ids.length) throw new ErroValidacao("Nenhum e-mail na fila para marcar.");
    for (let i = 0; i < ids.length; i += 500) {
      const { error } = await supabase.rpc("mkt_marcar_enviados", { p_ids: ids.slice(i, i + 500).map((x) => x.id) });
      if (error) throw error;
    }
  });
}

/**
 * "Voltar para a fila": cancelado, descadastrado (se o bloqueio já saiu) ou enviado
 * há poucos minutos (desfaz: o registro sai do histórico do CRM). O banco confere
 * (mkt_envio_antes): campanha cancelada não volta e envio antigo não é desfeito.
 */
export async function voltarParaFila(id: string): Promise<Resultado> {
  return acao(async () => {
    const { supabase } = await contexto();
    const { data, error } = await supabase
      .from("mkt_envios")
      .update({ status: "pendente", motivo: null })
      .eq("id", id)
      .in("status", ["enviado", "cancelado", "bloqueado"])
      .select("id");
    if (error) throw error;
    if (!data?.length) throw new ErroValidacao("Esta mensagem não pode voltar para a fila. Atualize a tela.");
  });
}

export async function excluirEnvio(id: string): Promise<Resultado> {
  return acao(async () => {
    const { supabase } = await contexto();
    const { error } = await supabase.from("mkt_envios").delete().eq("id", id);
    if (error) throw error;
  });
}

/** Põe na fila a sugestão de imóveis para um contato ("l:<id>" lead ou "p:<id>" pessoa). */
export async function enfileirarSugestao(ref: string): Promise<Resultado> {
  return acao(async () => {
    const { supabase, organizacao } = await contexto();
    const [tipo, id] = ref.split(":");
    const contatos = await carregarContatos(supabase, tipo === "l" ? "leads" : "pessoas");
    const c = contatos.find((x) => x.id === id);
    if (!c) throw new ErroValidacao("Contato não encontrado.");
    const canal: Canal = c.telefone ? "whatsapp" : "email";
    const base = await urlBase();
    const [disponiveis, bloqueios, { data: modelo }] = await Promise.all([
      imoveisDisponiveis(supabase),
      carregarBloqueios(supabase),
      supabase.from("mkt_modelos").select("corpo, assunto").eq("uso", "recomendacao").eq("canal", canal).eq("ativo", true).limit(1).maybeSingle(),
    ]);
    if (contatoBloqueado(c, canal, "ofertas", bloqueios.descadastros, bloqueios.consentimentos)) throw new ErroValidacao("Esta pessoa pediu para não receber ofertas.");
    if (!separarPorSugestao([c], disponiveis).comImoveis.length) throw new ErroValidacao("Nenhum imóvel disponível combina com o perfil agora.");
    const r = linhaParaContato(c, {
      prefixoChave: `r:${hojeISO()}`,
      origem: "recomendacao",
      finalidade: "ofertas",
      canal,
      corpo: (modelo?.corpo as string | undefined) ?? corpoPadrao("recomendacao"),
      assunto: (modelo?.assunto as string | undefined) ?? (canal === "email" ? "Imóveis para você — {{imobiliaria}}" : null),
      agendadoPara: new Date().toISOString(),
      ctx: { base, imobiliaria: organizacao.nome, disponiveis },
    });
    const n = await gravarFila(supabase, [r.linha], []);
    if (!n) throw new ErroValidacao("A sugestão de hoje para este contato já está na fila.");
  });
}

// =============================================================================
// Caixa de entrada (conversas)
// =============================================================================
const dig9 = (t: string | null | undefined) => (t ?? "").replace(/\D/g, "").slice(-9);

export async function criarConversa(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  let id: string;
  try {
    const { supabase, usuario } = await contexto();
    const canal = (["whatsapp", "email", "sms", "outro"] as const).find((c) => c === texto(fd, "canal")) ?? "whatsapp";
    const bruto = textoObrigatorio(fd, "contato", canal === "email" ? "o e-mail" : "o telefone");
    // Telefone no formato do WhatsApp (55 + DDD + número), igual ao que o webhook grava.
    const contato = canal === "email" ? bruto.trim().toLowerCase() : telefoneE164(bruto);
    if (canal !== "email" && dig9(contato).length < 8) throw new ErroValidacao("Telefone inválido.");
    const nome = texto(fd, "nome");
    const { data: candidatas } =
      canal === "email"
        ? await supabase.from("mkt_conversas").select("id, contato").eq("canal", canal).eq("contato", contato).limit(1)
        : await supabase.from("mkt_conversas").select("id, contato").eq("canal", canal).like("contato", `%${dig9(contato)}`).order("ultima_em", { ascending: false }).limit(20);
    // Mesmo número escrito de outro jeito (com/sem 55, com/sem o 9): conta pelos últimos 9 dígitos.
    const existente = (candidatas ?? []).find((x) => (canal === "email" ? x.contato === contato : dig9(x.contato) === dig9(contato)));
    if (existente) id = existente.id;
    else {
      // Liga ao lead/pessoa com o mesmo telefone ou e-mail.
      const [leads, pessoas] = await Promise.all([
        supabase.from("leads").select("id, telefone, email").not("status", "in", "(ganho,perdido)").limit(5000),
        supabase.from("pessoas").select("id, telefone, email").limit(5000),
      ]);
      const bate = (x: { telefone: string | null; email: string | null }) => (canal === "email" ? (x.email ?? "").toLowerCase() === contato : dig9(x.telefone) === dig9(contato));
      const { data, error } = await supabase
        .from("mkt_conversas")
        .insert({
          canal,
          contato,
          nome,
          responsavel_id: usuario.id,
          lead_id: (leads.data ?? []).find(bate)?.id ?? null,
          pessoa_id: (pessoas.data ?? []).find(bate)?.id ?? null,
        })
        .select("id")
        .single();
      if (error) throw error;
      id = data.id;
    }
    const msg = texto(fd, "texto");
    if (msg) {
      const { error } = await supabase.from("mkt_mensagens").insert({ conversa_id: id, direcao: texto(fd, "direcao") === "saida" ? "saida" : "entrada", texto: msg });
      if (error) throw error;
    }
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  redirect(`/marketing/conversas/${id}`);
}

export async function atualizarConversa(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  try {
    const { supabase } = await contexto();
    const d: Record<string, unknown> = {};
    for (const c of ["responsavel_id", "lead_id", "pessoa_id", "nome"]) if (fd.has(c)) d[c] = texto(fd, c);
    if (fd.has("status")) d.status = ["aberta", "aguardando", "resolvida"].includes(texto(fd, "status") ?? "") ? texto(fd, "status") : "aberta";
    const { error } = await supabase.from("mkt_conversas").update(d).eq("id", String(fd.get("id")));
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Salvo." };
}

/** Registra uma mensagem (recebida por fora do sistema ou enviada). */
export async function registrarMensagem(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  try {
    const { supabase } = await contexto();
    const { error } = await supabase.from("mkt_mensagens").insert({
      conversa_id: textoObrigatorio(fd, "conversa_id"),
      direcao: texto(fd, "direcao") === "saida" ? "saida" : "entrada",
      texto: textoObrigatorio(fd, "texto", "a mensagem"),
    });
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Mensagem registrada." };
}

/** Resposta: grava no histórico (a tela abre o WhatsApp/e-mail com o texto). */
export async function responderConversa(conversaId: string, mensagem: string): Promise<Resultado> {
  return acao(async () => {
    const { supabase } = await contexto();
    const t = mensagem.trim();
    if (!t) throw new ErroValidacao("Escreva a resposta.");
    const { error } = await supabase.from("mkt_mensagens").insert({ conversa_id: conversaId, direcao: "saida", texto: t.slice(0, 4000) });
    if (error) throw error;
  });
}

export async function marcarLida(id: string): Promise<Resultado> {
  return acao(async () => {
    const { supabase } = await contexto();
    const { error } = await supabase.from("mkt_conversas").update({ nao_lidas: 0 }).eq("id", id);
    if (error) throw error;
  });
}

export async function assumirConversa(id: string): Promise<Resultado> {
  return acao(async () => {
    const { supabase, usuario } = await contexto();
    const { error } = await supabase.from("mkt_conversas").update({ responsavel_id: usuario.id, nao_lidas: 0 }).eq("id", id);
    if (error) throw error;
  });
}

/** Cria o lead a partir da conversa e liga os dois (o histórico passa a ir para o CRM). */
export async function criarLeadDaConversa(id: string): Promise<Resultado> {
  return acao(async () => {
    const { supabase } = await contexto();
    const { data: c, error } = await supabase.from("mkt_conversas").select("canal, contato, nome, lead_id").eq("id", id).single();
    if (error) throw error;
    if (c.lead_id) throw new ErroValidacao("A conversa já está ligada a um lead.");
    const email = c.canal === "email";
    const { data: lead, error: e2 } = await supabase
      .from("leads")
      .insert({
        nome: c.nome || (email ? c.contato : `+${c.contato}`),
        telefone: email ? null : c.contato,
        email: email ? c.contato : null,
        origem: c.canal === "whatsapp" ? "whatsapp" : email ? "email" : "outro",
        ultimo_contato: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (e2) throw e2;
    const { count } = await supabase.from("mkt_mensagens").select("id", { count: "exact", head: true }).eq("conversa_id", id);
    await supabase.from("lead_eventos").insert({ lead_id: lead.id, tipo: "entrada", descricao: `Criado a partir da conversa no Marketing (${count ?? 0} mensagem(ns) até agora)` });
    const { error: e3 } = await supabase.from("mkt_conversas").update({ lead_id: lead.id }).eq("id", id);
    if (e3) throw e3;
  });
}

export async function excluirConversa(id: string): Promise<Resultado> {
  return acao(async () => {
    const { supabase } = await contexto();
    const { error } = await supabase.from("mkt_conversas").delete().eq("id", id);
    if (error) throw error;
  });
}

export async function excluirMensagem(id: string): Promise<Resultado> {
  return acao(async () => {
    const { supabase } = await contexto();
    const { error } = await supabase.from("mkt_mensagens").delete().eq("id", id);
    if (error) throw error;
  });
}

// =============================================================================
// Automações
// =============================================================================
function dadosAutomacao(fd: FormData, parcial: boolean) {
  const d: Record<string, unknown> = {};
  if (!parcial || fd.has("nome")) d.nome = textoObrigatorio(fd, "nome", "o nome da automação");
  if (!parcial || fd.has("gatilho")) {
    const g = texto(fd, "gatilho");
    if (!(GATILHOS as readonly string[]).includes(g ?? "")) throw new ErroValidacao("Escolha quando a automação roda.");
    d.gatilho = g;
  }
  if (!parcial || fd.has("acao")) d.acao = texto(fd, "acao") === "tarefa" ? "tarefa" : "mensagem";
  if (!parcial || fd.has("canal")) d.canal = canalValido(texto(fd, "canal"));
  if (!parcial || fd.has("modelo_id")) d.modelo_id = texto(fd, "modelo_id");
  if (!parcial || fd.has("mensagem")) d.mensagem = texto(fd, "mensagem");
  if (!parcial || fd.has("dias")) {
    const n = inteiro(fd, "dias") ?? 0;
    if (n < 0 || n > 3650) throw new ErroValidacao("Dias entre 0 e 3650.");
    d.dias = n;
  }
  if (!parcial || fd.has("reducao_min_pct")) {
    const n = numero(fd, "reducao_min_pct") ?? 0;
    if (n < 0 || n > 100) throw new ErroValidacao("A redução mínima fica entre 0% e 100%.");
    d.reducao_min_pct = n;
  }
  if (!parcial || fd.has("publico")) d.publico = ["leads", "pessoas"].includes(texto(fd, "publico") ?? "") ? texto(fd, "publico") : "ambos";
  if (fd.has("ativa")) d.ativa = marcado(fd, "ativa");
  return d;
}

export async function criarAutomacao(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  try {
    const { supabase } = await contexto();
    const { error } = await supabase.from("mkt_automacoes").insert(dadosAutomacao(fd, false));
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Automação criada." };
}

export async function atualizarAutomacao(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  try {
    const { supabase } = await contexto();
    const { error } = await supabase.from("mkt_automacoes").update(dadosAutomacao(fd, true)).eq("id", String(fd.get("id")));
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Salvo." };
}

export async function excluirAutomacao(id: string): Promise<Resultado> {
  return acao(async () => {
    const { supabase } = await contexto();
    const { error } = await supabase.from("mkt_automacoes").delete().eq("id", id);
    if (error) throw error;
  });
}

export async function rodarAutomacoes(): Promise<Resultado> {
  return acao(async () => {
    const { supabase, organizacao } = await contexto();
    await processarAutomacoes(supabase, { base: await urlBase(), imobiliaria: organizacao.nome, forcar: true });
  });
}

// =============================================================================
// Landing pages
// =============================================================================
export async function criarLanding(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  let id: string;
  try {
    const { supabase } = await contexto();
    const titulo = textoObrigatorio(fd, "titulo", "o título");
    let slug = gerarSlug(texto(fd, "slug") ?? titulo);
    if (!slugValido(slug)) throw new ErroValidacao("Endereço inválido: use letras, números e hífen.");
    const imovelId = texto(fd, "imovel_id");
    const funil = ["venda", "captacao"].includes(texto(fd, "funil") ?? "") ? texto(fd, "funil") : "locacao";
    for (let tentativa = 0; ; tentativa++) {
      const { data, error } = await supabase
        .from("mkt_landing_pages")
        .insert({ titulo, slug, funil, imovel_id: imovelId, subtitulo: texto(fd, "subtitulo"), utm_campaign: slug })
        .select("id")
        .single();
      if (!error) {
        id = data.id;
        break;
      }
      // Endereço já usado (por esta ou outra imobiliária): acrescenta um final.
      if (tentativa < 3 && /duplicate key|unique/i.test(error.message)) {
        slug = `${slug.slice(0, 54)}-${randomUUID().slice(0, 4)}`;
        continue;
      }
      throw error;
    }
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  redirect(`/marketing/landing/${id}`);
}

export async function atualizarLanding(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  try {
    const { supabase } = await contexto();
    const d: Record<string, unknown> = {};
    if (fd.has("titulo")) d.titulo = textoObrigatorio(fd, "titulo", "o título");
    for (const c of ["subtitulo", "texto", "imovel_id", "utm_campaign"]) if (fd.has(c)) d[c] = texto(fd, c);
    if (fd.has("chamada")) d.chamada = texto(fd, "chamada") ?? "Quero ser atendido";
    if (fd.has("funil")) d.funil = ["venda", "captacao"].includes(texto(fd, "funil") ?? "") ? texto(fd, "funil") : "locacao";
    if (fd.has("slug")) {
      const s = gerarSlug(textoObrigatorio(fd, "slug", "o endereço"));
      if (!slugValido(s)) throw new ErroValidacao("Endereço inválido: use letras, números e hífen.");
      d.slug = s;
    }
    if (fd.has("imagem_url")) {
      const u = texto(fd, "imagem_url");
      if (u && !/^https:\/\//i.test(u)) throw new ErroValidacao("O link da imagem precisa começar com https://");
      d.imagem_url = u;
    }
    if (fd.has("publicada")) d.publicada = marcado(fd, "publicada");
    const { error } = await supabase.from("mkt_landing_pages").update(d).eq("id", String(fd.get("id")));
    if (error) {
      if (/duplicate key|unique/i.test(error.message)) throw new ErroValidacao("Este endereço já está em uso. Escolha outro.");
      throw error;
    }
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Salvo." };
}

export async function excluirLanding(id: string): Promise<Resultado> {
  return acao(async () => {
    const { supabase } = await contexto();
    const { error } = await supabase.from("mkt_landing_pages").delete().eq("id", id);
    if (error) throw error;
  });
}

// =============================================================================
// Pesquisas de satisfação
// =============================================================================
async function contatoEscolhido(supabase: Awaited<ReturnType<typeof contexto>>["supabase"], ref: string | null): Promise<Contato | null> {
  if (!ref) return null;
  const [tipo, id] = ref.split(":");
  if (tipo === "p") {
    const { data } = await supabase.from("pessoas").select("id, nome, telefone, email, preferencias_token").eq("id", id).maybeSingle();
    return data ? { tipo: "pessoa", ...(data as { id: string; nome: string; telefone: string | null; email: string | null; preferencias_token: string }) } : null;
  }
  if (tipo === "l") {
    const { data } = await supabase.from("leads").select("id, nome, telefone, email, preferencias_token").eq("id", id).maybeSingle();
    return data ? { tipo: "lead", ...(data as { id: string; nome: string; telefone: string | null; email: string | null; preferencias_token: string }) } : null;
  }
  return null;
}

/** Cria a pesquisa e já põe o convite na fila de envio (se houver telefone/e-mail). */
export async function criarPesquisa(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  try {
    const { supabase, organizacao } = await contexto();
    const escolhido = await contatoEscolhido(supabase, texto(fd, "contato"));
    const contato: Contato = escolhido ?? {
      tipo: "pessoa",
      id: "",
      nome: textoObrigatorio(fd, "nome", "o nome (ou escolha um contato)"),
      telefone: texto(fd, "telefone"),
      email: texto(fd, "email"),
    };
    const contexto_ = ["pos_venda", "pos_locacao", "atendimento"].includes(texto(fd, "contexto") ?? "") ? (texto(fd, "contexto") as "pos_venda" | "pos_locacao" | "atendimento") : "geral";
    const canal = canalValido(texto(fd, "canal"), contato.telefone ? "whatsapp" : "email");
    const cfg = await obterConfig(supabase);
    const { data: modelo } = await supabase.from("mkt_modelos").select("corpo, assunto").eq("uso", "pesquisa").eq("canal", canal).eq("ativo", true).limit(1).maybeSingle();
    const r = linhaParaContato(contato, {
      prefixoChave: `q:${randomUUID()}`,
      origem: "pesquisa",
      finalidade: "relacionamento",
      canal,
      corpo: (modelo?.corpo as string | undefined) ?? corpoPadrao("pesquisa"),
      assunto: (modelo?.assunto as string | undefined) ?? (canal === "email" ? "Como foi o atendimento da {{imobiliaria}}?" : null),
      agendadoPara: new Date().toISOString(),
      ctx: { base: await urlBase(), imobiliaria: organizacao.nome },
      pesquisa: { contexto: contexto_, pergunta: cfg.pesquisa_pergunta },
    });
    const temDestino = canal === "email" ? !!contato.email : !!contato.telefone;
    await gravarFila(supabase, temDestino ? [r.linha] : [], r.pesquisa ? [r.pesquisa] : []);
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Pesquisa criada." };
}

export async function excluirPesquisa(id: string): Promise<Resultado> {
  return acao(async () => {
    const { supabase } = await contexto();
    const { error } = await supabase.from("mkt_pesquisas").delete().eq("id", id);
    if (error) throw error;
  });
}

// =============================================================================
// Descadastro e preferências
// =============================================================================
const CANAL_CONSENTIMENTO: Record<string, string[]> = {
  todos: ["whatsapp", "email", "sms", "marketing"],
  whatsapp: ["whatsapp"],
  email: ["email"],
  sms: ["sms"],
  ofertas: ["marketing"],
};

/** Bloqueio manual (a pessoa pediu por telefone, e-mail…): vale para todas as campanhas e para a fila. */
export async function bloquearContato(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  try {
    const { supabase } = await contexto();
    const c = await contatoEscolhido(supabase, texto(fd, "contato"));
    const email = texto(fd, "email") ?? c?.email ?? null;
    const telefone = texto(fd, "telefone") ?? c?.telefone ?? null;
    if (!c && !email && !telefone) throw new ErroValidacao("Escolha um contato ou informe telefone/e-mail.");
    const canal = ["todos", "whatsapp", "email", "sms", "ofertas"].includes(texto(fd, "canal") ?? "") ? (texto(fd, "canal") as string) : "todos";
    const motivo = texto(fd, "motivo");
    const linha = {
      pessoa_id: c?.tipo === "pessoa" ? c.id : null,
      lead_id: c?.tipo === "lead" ? c.id : null,
      email: email?.toLowerCase() ?? null,
      telefone,
    };
    const { error } = await supabase.from("mkt_descadastros").insert({ ...linha, canal, origem: "manual", motivo });
    if (error) throw error;
    await supabase.from("mkt_preferencias_log").insert({ ...linha, canal, concedido: false, origem: "manual", detalhe: motivo });
    if (linha.pessoa_id) {
      const canais = CANAL_CONSENTIMENTO[canal];
      await supabase
        .from("pessoas")
        .update({ ...Object.fromEntries(canais.map((k) => [`aceita_${k}`, false])), consentimento_em: new Date().toISOString() })
        .eq("id", linha.pessoa_id);
      await supabase.from("pessoa_consentimentos").insert(canais.map((k) => ({ pessoa_id: linha.pessoa_id, canal: k, concedido: false, origem: motivo ?? "Bloqueio no Marketing" })));
    }
    // O que estava na fila para este contato sai.
    const pendentes = await todas<{ id: string; pessoa_id: string | null; lead_id: string | null; email: string | null; telefone: string | null; canal: Canal; finalidade: "ofertas" | "relacionamento" }>(() =>
      supabase.from("mkt_envios").select("id, pessoa_id, lead_id, email, telefone, canal, finalidade").eq("status", "pendente").order("id"),
    );
    const regra: Descadastro[] = [{ ...linha, canal }];
    const bloquear = pendentes
      .filter((e) =>
        // Envio sem cadastro (pesquisa com nome digitado, comprador sem cadastro) vai com id vazio:
        // só casa pelo telefone/e-mail, nunca "sem cadastro = sem cadastro".
        contatoBloqueado({ tipo: e.pessoa_id ? "pessoa" : "lead", id: e.pessoa_id ?? e.lead_id ?? "", email: e.email, telefone: e.telefone }, e.canal, e.finalidade, regra),
      )
      .map((e) => e.id);
    for (let i = 0; i < bloquear.length; i += 300)
      await supabase.from("mkt_envios").update({ status: "bloqueado", motivo: "Pediu para não receber por este canal" }).in("id", bloquear.slice(i, i + 300));
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Contato bloqueado." };
}

/**
 * Tira o bloqueio (só administrador ou gestor). Fica no registro de preferências.
 * NÃO liga nenhuma autorização da pessoa: se ela tinha negado na aba Comunicação,
 * continua negado até ela autorizar de novo (aba Comunicação ou o link dela).
 */
export async function excluirDescadastro(id: string): Promise<Resultado> {
  return acao(async () => {
    const { supabase, papel } = await contexto();
    if (!gestor(papel)) throw new ErroValidacao("Só administradores e gestores retiram um bloqueio de comunicação.");
    const { data: d, error: e1 } = await supabase.from("mkt_descadastros").select("pessoa_id, lead_id, email, telefone, canal").eq("id", id).single();
    if (e1) throw e1;
    const { error } = await supabase.from("mkt_descadastros").delete().eq("id", id);
    if (error) throw error;
    const { error: e2 } = await supabase.from("mkt_preferencias_log").insert({ ...d, concedido: true, origem: "manual", detalhe: "Bloqueio retirado no Marketing" });
    if (e2) throw e2;
  });
}
