"use server";

import { revalidatePath } from "next/cache";
import { obterContexto } from "@/lib/contexto";
import { hojeISO } from "@/lib/dominio/datas";
import {
  ACAO_AUTOMATICA,
  ACOES_REGRA,
  CAMPOS_DOC,
  CAMPOS_QUALIFICACAO,
  CONDICOES_POR_GATILHO,
  GATILHOS_IA_IMOB,
  RECURSOS_IA,
  TIPOS_ACAO_IA,
  TIPOS_ACAO_IA_IMOB,
  TIPOS_DOC_EXTRACAO,
  TIPOS_INCONSISTENCIA,
  consultaPorChave,
  dentroDoHorario,
  descricaoPorRegra,
  descreverFiltros,
  explicarConsulta,
  explicarPreco,
  gatilhosDoModo,
  intencaoPorRegra,
  interpretarBuscaPorRegra,
  interpretarPerguntaPorRegra,
  lerResultadoConsulta,
  perguntasFaltando,
  primeiroNomeIA,
  promptAtendimento,
  promptBusca,
  promptConsulta,
  promptDescricao,
  promptExplicarConsulta,
  promptExtracao,
  promptLead,
  promptPreco,
  promptResumo,
  respostaPorRegra,
  resumoExtracao,
  resumoPorRegra,
  validarAnaliseLead,
  validarCondicoes,
  validarConfigAcao,
  validarDescricao,
  validarEscolhaConsulta,
  validarExplicacao,
  validarExtracao,
  validarFiltrosBusca,
  validarPayloadAcao,
  validarRespostaAtendimento,
  validarResumo,
  consultasDoModo,
  acoesRegraDoModo,
  type AcaoRegra,
  type AnaliseLeadIA,
  type CampoQualificacao,
  type EscolhaConsulta,
  type FiltrosBusca,
  type GatilhoIA,
  type ImovelIA,
  type Intencao,
  type LeadIA,
  type MensagemResumo,
  type OpcoesDescricao,
  type ResultadoConsulta,
  type ResultadoPreco,
  type ResultadoResumo,
  type TipoAcaoIA,
  type TipoDocExtracao,
} from "@/lib/dominio/ia";
import { type EstadoAcao, ErroValidacao, inteiro, mensagemErro, numero, texto, textoObrigatorio } from "@/lib/form";
import { exigirPermissao, pode } from "@/lib/permissoes";
import { MAX_ARQUIVO_IA, MENSAGEM_SEM_IA, TIPOS_IMAGEM_IA, chamarIA, type AnexoIA } from "@/lib/servicos/ia";
import { carregarSalvo, executarPersonalizado } from "../relatorios/dados";
import { estadoIA, podeConfigurarIA } from "./dados";
import { executarAcao, type AcaoParaExecutar } from "./executar";

type Resultado = { ok: boolean; erro?: string };
type Contexto = Awaited<ReturnType<typeof obterContexto>>;

function revalidar() {
  revalidatePath("/inteligencia", "layout");
}

const falha = (e: unknown): Resultado => ({ ok: false, erro: mensagemErro(e) });
const imobiliaria = (ctx: Contexto) => ctx.organizacao.modo !== "pessoal";
function exigirImobiliaria(ctx: Contexto) {
  if (!imobiliaria(ctx)) throw new ErroValidacao("Este recurso só existe no modo imobiliária.");
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function idValido(v: string | null, rotulo = "o registro"): string {
  if (!v || !UUID.test(v)) throw new ErroValidacao(`Escolha ${rotulo}.`);
  return v;
}

// =============================================================================
// Configuração da IA
// =============================================================================
export async function salvarConfigIA(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  try {
    const ctx = await obterContexto();
    if (!podeConfigurarIA(ctx.papel)) throw new ErroValidacao("Só o administrador ou o gestor configuram a IA.");
    await exigirPermissao("configuracoes", "editar");
    const marcado = (k: string) => fd.getAll(k).includes("on");
    const recursos = fd.getAll("recursos").map(String).filter((r) => (RECURSOS_IA as readonly string[]).includes(r));
    const dias = fd
      .getAll("dias_uteis")
      .map(Number)
      .filter((d) => d >= 1 && d <= 7);
    const hora = (k: string, padrao: string) => {
      const v = texto(fd, k);
      return v && /^\d{2}:\d{2}$/.test(v) ? v : padrao;
    };
    const perguntas = CAMPOS_QUALIFICACAO.map((campo: CampoQualificacao) => ({
      campo,
      ativa: marcado(`pergunta_ativa_${campo}`),
      texto: (texto(fd, `pergunta_${campo}`) ?? "").slice(0, 300),
    }));
    const limite = (k: string, padrao: number, max: number) => Math.min(max, Math.max(1, inteiro(fd, k) ?? padrao));
    const preco = (k: string, padrao: number) => Math.min(1000, Math.max(0, numero(fd, k) ?? padrao));
    const linha: Record<string, unknown> = {
      organizacao_id: ctx.organizacao.id,
      ativa: marcado("ativa"),
      recursos,
      limite_dia_org: limite("limite_dia_org", 300, 10000),
      limite_dia_usuario: limite("limite_dia_usuario", 60, 5000),
      horario_inicio: hora("horario_inicio", "08:00"),
      horario_fim: hora("horario_fim", "18:00"),
      dias_uteis: dias,
      fora_horario_ativo: marcado("fora_horario_ativo"),
      mensagem_fora_horario: (texto(fd, "mensagem_fora_horario") ?? "").slice(0, 1000),
      exigir_aprovacao: marcado("exigir_aprovacao"),
      perguntas,
      preco_entrada_mtok: preco("preco_entrada_mtok", 3),
      preco_saida_mtok: preco("preco_saida_mtok", 15),
    };
    // O envio automático fora do horário só o administrador mexe (o banco confere de novo).
    if (ctx.papel === "admin") linha.fora_horario_envio_auto = marcado("fora_horario_envio_auto");
    const { error } = await ctx.supabase.from("ia_config").upsert(linha, { onConflict: "organizacao_id" });
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Salvo." };
}

// =============================================================================
// Assistente: pergunta → UMA consulta da lista fechada (sessão do usuário)
// =============================================================================
export type EstadoPergunta = {
  erro?: string;
  aviso?: string;
  pergunta?: string;
  resultado?: ResultadoConsulta;
  explicacao?: string;
  entendi?: string;
  usouIA?: boolean;
};

async function rodarConsulta(ctx: Contexto, e: EscolhaConsulta): Promise<ResultadoConsulta> {
  if (e.chave === "relatorio_salvo") {
    const salvo = await carregarSalvo(ctx.supabase, e.parametros.relatorio_id ?? "");
    if (!salvo) throw new ErroValidacao("Relatório personalizado não encontrado.");
    const r = await executarPersonalizado(ctx.supabase, salvo, 100);
    if (!r.ok) throw new ErroValidacao(r.erro);
    return {
      titulo: salvo.nome,
      fonte: `Relatórios e BI → Personalizados → "${salvo.nome}"`,
      resumo: Object.entries(r.resultado.totais).map(([rotulo, valor]) => ({ rotulo: `Total de ${rotulo}`, valor: Number(valor ?? 0), tipo: "moeda" as const })),
      colunas: r.resultado.colunas,
      tipos: r.resultado.colunas.map(() => "texto" as const),
      linhas: r.resultado.linhas,
      consulta: e.chave,
      parametros: e.parametros,
    };
  }
  const { data, error } = await ctx.supabase.rpc("ia_consulta", { p_chave: e.chave, p: e.parametros });
  if (error) throw new ErroValidacao(error.message);
  const r = lerResultadoConsulta(data);
  if (!r) throw new ErroValidacao("A consulta não devolveu resultado.");
  return r;
}

export async function perguntar(_: EstadoPergunta, fd: FormData): Promise<EstadoPergunta> {
  const pergunta = (texto(fd, "pergunta") ?? "").slice(0, 500);
  if (!pergunta) return { erro: "Escreva a pergunta." };
  try {
    const ctx = await obterContexto();
    const hoje = hojeISO();
    const ia = await estadoIA(ctx.supabase);
    const podeRel = await pode("relatorios", "ver");
    const { data: rels } = podeRel ? await ctx.supabase.from("relatorios_salvos").select("id, nome").order("nome").limit(40) : { data: [] };
    const relatorios = (rels ?? []) as { id: string; nome: string }[];
    let escolha: EscolhaConsulta | null = null;
    let usouIA = false;
    let aviso: string | undefined;
    let entendi: string | undefined;
    if (ia.disponivel) {
      const r = await chamarIA(ctx.supabase, {
        recurso: "assistente",
        pedido: promptConsulta(pergunta, consultasDoModo(ctx.organizacao.modo), relatorios, hoje),
        entradaResumo: `Pergunta: ${pergunta}`,
      });
      if (r.ok) {
        escolha = validarEscolhaConsulta(r.json, { modo: ctx.organizacao.modo, hoje, relatorios: relatorios.map((x) => x.id) });
        entendi = typeof r.json.entendi === "string" ? r.json.entendi.slice(0, 200) : undefined;
        usouIA = !!escolha;
        if (!escolha && r.json.consulta === null) return { pergunta, aviso: entendi || "Essa pergunta não tem uma consulta pronta no sistema.", usouIA: true };
      } else aviso = `${r.mensagem} Usei as regras.`;
    }
    if (!escolha) escolha = interpretarPerguntaPorRegra(pergunta, hoje, ctx.organizacao.modo);
    if (!escolha)
      return {
        pergunta,
        aviso: `${aviso ? `${aviso} ` : ""}Não entendi a pergunta. Experimente: "quanto recebi de aluguel em outubro?", "quais contratos vencem em 60 dias?", "quem está devendo?".`,
      };
    const def = consultaPorChave(escolha.chave);
    if (def) await exigirPermissao(def.modulo, def.operacao);
    const resultado = await rodarConsulta(ctx, escolha);
    let explicacao = explicarConsulta(resultado);
    if (usouIA) {
      const r = await chamarIA(ctx.supabase, {
        recurso: "assistente",
        pedido: promptExplicarConsulta(pergunta, resultado),
        entradaResumo: `Explicar: ${resultado.titulo}`,
      });
      const t = r.ok ? validarExplicacao(r.json) : null;
      if (t) explicacao = t;
    }
    return { pergunta, resultado, explicacao, usouIA, aviso, entendi };
  } catch (e) {
    return { pergunta, erro: mensagemErro(e) };
  }
}

// =============================================================================
// Busca de imóveis por linguagem natural (a IA só preenche filtros fechados)
// =============================================================================
export type ImovelEncontrado = {
  id: string;
  codigo: string;
  tipo: string | null;
  titulo: string | null;
  bairro: string | null;
  cidade: string | null;
  quartos: number | null;
  vagas: number | null;
  area_util: number | null;
  valor_aluguel: number | null;
  valor_venda: number | null;
};
export type EstadoBusca = { erro?: string; aviso?: string; filtros?: FiltrosBusca; entendido?: string[]; imoveis?: ImovelEncontrado[]; usouIA?: boolean };

export async function buscarImoveisPorTexto(_: EstadoBusca, fd: FormData): Promise<EstadoBusca> {
  const pedido = (texto(fd, "pedido") ?? "").slice(0, 600);
  if (!pedido) return { erro: "Descreva o imóvel que procura." };
  try {
    const ctx = await obterContexto();
    await exigirPermissao("imoveis", "ver");
    const ia = await estadoIA(ctx.supabase);
    let filtros: FiltrosBusca = {};
    let usouIA = false;
    let aviso: string | undefined;
    if (ia.disponivel) {
      const r = await chamarIA(ctx.supabase, { recurso: "busca_imoveis", pedido: promptBusca(pedido), entradaResumo: `Busca: ${pedido}` });
      if (r.ok) {
        filtros = validarFiltrosBusca((r.json.filtros as Record<string, unknown>) ?? null);
        usouIA = Object.keys(filtros).length > 0;
      } else aviso = `${r.mensagem} Usei as regras.`;
    }
    if (!usouIA) filtros = interpretarBuscaPorRegra(pedido);
    if (!Object.keys(filtros).length) return { aviso: "Não entendi o que filtrar. Diga o tipo, quartos, bairro ou valor (ex.: “apartamento 2 quartos até 2.500 no Centro”)." };
    const campoValor = filtros.finalidade === "venda" ? "valor_venda" : "valor_aluguel";
    let q = ctx.supabase
      .from("imoveis")
      .select("id, codigo, tipo, titulo, bairro, cidade, quartos, vagas, area_util, valor_aluguel, valor_venda")
      .eq("status", "disponivel")
      .order(campoValor, { ascending: true, nullsFirst: false })
      .limit(30);
    if (filtros.finalidade) q = q.contains("finalidades", [filtros.finalidade]);
    if (filtros.tipos?.length) q = q.in("tipo", filtros.tipos);
    if (filtros.quartos_min) q = q.gte("quartos", filtros.quartos_min);
    if (filtros.suites_min) q = q.gte("suites", filtros.suites_min);
    if (filtros.banheiros_min) q = q.gte("banheiros", filtros.banheiros_min);
    if (filtros.vagas_min) q = q.gte("vagas", filtros.vagas_min);
    if (filtros.valor_min) q = q.gte(campoValor, filtros.valor_min);
    if (filtros.valor_max) q = q.lte(campoValor, filtros.valor_max);
    if (filtros.area_min) q = q.gte("area_util", filtros.area_min);
    if (filtros.area_max) q = q.lte("area_util", filtros.area_max);
    if (filtros.cidade) q = q.ilike("cidade", `%${filtros.cidade}%`);
    if (filtros.bairros?.length) q = q.or(filtros.bairros.map((b) => `bairro.ilike.*${b}*`).join(","));
    if (filtros.comodidades?.length) q = q.contains("comodidades", filtros.comodidades);
    const { data, error } = await q;
    if (error) throw error;
    return { filtros, entendido: descreverFiltros(filtros), imoveis: (data ?? []) as ImovelEncontrado[], usouIA, aviso };
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
}

// =============================================================================
// Descrição de anúncio (só grava quando o usuário aceita)
// =============================================================================
export type EstadoDescricao = { erro?: string; aviso?: string; titulo?: string; descricao?: string; avisos?: string[]; usouIA?: boolean };

const SELECT_IMOVEL_IA =
  "id, codigo, tipo, finalidades, bairro, cidade, uf, area_util, area_total, quartos, suites, banheiros, vagas, valor_aluguel, valor_venda, valor_condominio, valor_iptu, comodidades, caracteristicas";

async function imovelParaIA(ctx: Contexto, id: string): Promise<ImovelIA & { id: string }> {
  const { data } = await ctx.supabase.from("imoveis").select(SELECT_IMOVEL_IA).eq("id", id).maybeSingle();
  if (!data) throw new ErroValidacao("Imóvel não encontrado.");
  return data as unknown as ImovelIA & { id: string };
}

export async function gerarDescricao(_: EstadoDescricao, fd: FormData): Promise<EstadoDescricao> {
  try {
    const ctx = await obterContexto();
    await exigirPermissao("imoveis", "editar");
    const imovel = await imovelParaIA(ctx, idValido(texto(fd, "imovel_id"), "o imóvel"));
    const tom = (["profissional", "acolhedor", "direto"] as const).find((t) => t === texto(fd, "tom")) ?? "profissional";
    const tamanho = (["curto", "medio", "longo"] as const).find((t) => t === texto(fd, "tamanho")) ?? "medio";
    const opcoes: OpcoesDescricao = { tom, tamanho, destaques: (texto(fd, "destaques") ?? "").slice(0, 500), incluirValores: fd.getAll("incluir_valores").includes("on") };
    const ia = await estadoIA(ctx.supabase);
    if (ia.disponivel) {
      const r = await chamarIA(ctx.supabase, {
        recurso: "descricao_anuncio",
        pedido: promptDescricao(imovel, opcoes),
        entradaResumo: `Descrição do imóvel ${imovel.codigo} (${tom}, ${tamanho})`,
        referencia: { tipo: "imovel", id: imovel.id },
      });
      const v = r.ok ? validarDescricao(r.json, imovel) : null;
      if (v) return { ...v, usouIA: true };
      const regra = descricaoPorRegra(imovel, opcoes);
      return { ...regra, avisos: [], usouIA: false, aviso: `${r.ok ? "A IA respondeu fora do formato." : r.mensagem} Mostrando a versão por regra.` };
    }
    return { ...descricaoPorRegra(imovel, opcoes), avisos: [], usouIA: false };
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
}

export async function aceitarDescricao(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  try {
    const ctx = await obterContexto();
    await exigirPermissao("imoveis", "editar");
    const id = idValido(texto(fd, "imovel_id"), "o imóvel");
    const descricao = textoObrigatorio(fd, "descricao", "a descrição").slice(0, 6000);
    const titulo = (texto(fd, "titulo") ?? "").slice(0, 150) || null;
    const upd: Record<string, unknown> = { descricao };
    if (fd.getAll("usar_titulo").includes("on") && titulo) upd.titulo = titulo;
    const { error } = await ctx.supabase.from("imoveis").update(upd).eq("id", id);
    if (error) throw error;
    revalidatePath(`/imoveis/${id}`, "layout");
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Descrição gravada no imóvel." };
}

// =============================================================================
// Resumo de conversas, histórico do lead e anotações da pessoa
// =============================================================================
export type FonteResumo = "conversa" | "lead" | "pessoa";
export type EstadoResumo = { erro?: string; aviso?: string; resultado?: ResultadoResumo; usouIA?: boolean; total?: number };

const dataHora = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

async function historicoPara(ctx: Contexto, fonte: FonteResumo, id: string): Promise<{ contexto: string; msgs: MensagemResumo[] }> {
  if (fonte === "conversa") {
    exigirImobiliaria(ctx);
    const { data: c } = await ctx.supabase.from("mkt_conversas").select("canal").eq("id", id).maybeSingle();
    if (!c) throw new ErroValidacao("Conversa não encontrada.");
    const { data } = await ctx.supabase.from("mkt_mensagens").select("direcao, texto, data").eq("conversa_id", id).order("data", { ascending: false }).limit(200);
    const msgs = ((data ?? []) as { direcao: string; texto: string | null; data: string }[])
      .reverse()
      .map((m) => ({ quando: dataHora(m.data), quem: m.direcao === "entrada" ? "Cliente" : "Equipe", texto: m.texto ?? "" }));
    return { contexto: `Conversa por ${c.canal} com um cliente da imobiliária.`, msgs };
  }
  if (fonte === "lead") {
    exigirImobiliaria(ctx);
    const { data: l } = await ctx.supabase.from("leads").select("status, origem, observacoes, created_at").eq("id", id).maybeSingle();
    if (!l) throw new ErroValidacao("Lead não encontrado.");
    const { data } = await ctx.supabase.from("lead_eventos").select("tipo, descricao, data").eq("lead_id", id).order("data", { ascending: false }).limit(150);
    const msgs: MensagemResumo[] = ((data ?? []) as { tipo: string; descricao: string | null; data: string }[])
      .reverse()
      .map((e) => ({ quando: dataHora(e.data), quem: "Equipe", texto: `${e.tipo}: ${e.descricao ?? ""}` }));
    if (l.observacoes) msgs.unshift({ quando: dataHora(l.created_at as string), quem: "Observação do lead", texto: String(l.observacoes) });
    return { contexto: `Histórico de atendimento de um lead (etapa: ${l.status}, origem: ${l.origem ?? "—"}).`, msgs };
  }
  const { data: p } = await ctx.supabase.from("pessoas").select("id").eq("id", id).maybeSingle();
  if (!p) throw new ErroValidacao("Pessoa não encontrada.");
  const { data } = await ctx.supabase.from("pessoa_interacoes").select("tipo, descricao, data").eq("pessoa_id", id).order("data", { ascending: false }).limit(150);
  const msgs = ((data ?? []) as { tipo: string; descricao: string | null; data: string }[])
    .reverse()
    .map((e) => ({ quando: dataHora(e.data), quem: "Equipe", texto: `${e.tipo}: ${e.descricao ?? ""}` }));
  return { contexto: "Relacionamento (anotações e contatos) com uma pessoa do cadastro.", msgs };
}

export async function resumir(_: EstadoResumo, fd: FormData): Promise<EstadoResumo> {
  try {
    const ctx = await obterContexto();
    const fonte = (["conversa", "lead", "pessoa"] as const).find((f) => f === texto(fd, "fonte"));
    if (!fonte) throw new ErroValidacao("Escolha o que resumir.");
    await exigirPermissao(fonte === "pessoa" ? "pessoas" : "comercial", "ver");
    const id = idValido(texto(fd, "id"));
    const { contexto, msgs } = await historicoPara(ctx, fonte, id);
    if (!msgs.length) return { resultado: resumoPorRegra([]), usouIA: false, total: 0 };
    const ia = await estadoIA(ctx.supabase);
    if (ia.disponivel) {
      const r = await chamarIA(ctx.supabase, {
        recurso: "resumo",
        pedido: promptResumo(contexto, msgs),
        entradaResumo: `Resumo de ${fonte} (${msgs.length} registros)`,
        referencia: { tipo: fonte, id },
      });
      const v = r.ok ? validarResumo(r.json) : null;
      if (v) return { resultado: v, usouIA: true, total: msgs.length };
      return { resultado: resumoPorRegra(msgs), usouIA: false, total: msgs.length, aviso: `${r.ok ? "A IA respondeu fora do formato." : r.mensagem} Mostrando o resumo por regra.` };
    }
    return { resultado: resumoPorRegra(msgs), usouIA: false, total: msgs.length };
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
}

/** Grava o resumo como anotação (quando o usuário pede). */
export async function salvarResumo(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  try {
    const ctx = await obterContexto();
    const fonte = texto(fd, "fonte");
    const id = idValido(texto(fd, "id"));
    const resumo = `Resumo: ${textoObrigatorio(fd, "texto", "o resumo")}`.slice(0, 4000);
    if (fonte === "pessoa") {
      await exigirPermissao("pessoas", "editar");
      const { error } = await ctx.supabase.from("pessoa_interacoes").insert({ pessoa_id: id, tipo: "nota", descricao: resumo });
      if (error) throw error;
    } else if (fonte === "lead" || fonte === "conversa") {
      exigirImobiliaria(ctx);
      await exigirPermissao("comercial", "editar");
      let lead = fonte === "lead" ? id : null;
      let pessoa: string | null = null;
      if (fonte === "conversa") {
        const { data: c } = await ctx.supabase.from("mkt_conversas").select("lead_id, pessoa_id").eq("id", id).maybeSingle();
        lead = (c?.lead_id as string | null) ?? null;
        pessoa = (c?.pessoa_id as string | null) ?? null;
      }
      if (lead) {
        const { error } = await ctx.supabase.from("lead_eventos").insert({ lead_id: lead, tipo: "nota", descricao: resumo });
        if (error) throw error;
      } else if (pessoa) {
        const { error } = await ctx.supabase.from("pessoa_interacoes").insert({ pessoa_id: pessoa, tipo: "nota", descricao: resumo });
        if (error) throw error;
      } else throw new ErroValidacao("A conversa não está ligada a um lead nem a uma pessoa: copie o resumo.");
    } else throw new ErroValidacao("Origem inválida.");
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Resumo guardado como anotação." };
}

// =============================================================================
// Leitura de documentos (prévia para conferir; nunca grava sozinha)
// =============================================================================
export type EstadoExtracao = {
  erro?: string;
  tipo?: TipoDocExtracao;
  pessoaId?: string;
  campos?: Record<string, string | number | null>;
  avisos?: string[];
  legivel?: boolean;
};

const EXTENSAO_MIDIA: Record<string, (typeof TIPOS_IMAGEM_IA)[number] | "application/pdf"> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  pdf: "application/pdf",
};

export async function lerDocumento(_: EstadoExtracao, fd: FormData): Promise<EstadoExtracao> {
  try {
    const ctx = await obterContexto();
    await exigirPermissao("pessoas", "editar");
    const tipo = (Object.keys(TIPOS_DOC_EXTRACAO) as TipoDocExtracao[]).find((t) => t === texto(fd, "tipo"));
    if (!tipo) throw new ErroValidacao("Escolha o tipo do documento.");
    const arquivoId = idValido(texto(fd, "arquivo_id"), "o arquivo");
    const ia = await estadoIA(ctx.supabase);
    if (!ia.configurada) throw new ErroValidacao(MENSAGEM_SEM_IA);
    if (!ia.config.ativa) throw new ErroValidacao("A IA está desligada nesta conta (Configurações da IA).");
    const { data: arq } = await ctx.supabase.from("pessoa_arquivos").select("id, pessoa_id, path, nome, categoria").eq("id", arquivoId).maybeSingle();
    if (!arq) throw new ErroValidacao("Arquivo não encontrado.");
    const ext = String(arq.path).split(".").pop()?.toLowerCase() ?? "";
    const midia = EXTENSAO_MIDIA[ext];
    if (!midia) throw new ErroValidacao("A leitura aceita imagem (JPG, PNG, WEBP) ou PDF. Este arquivo não é de um tipo que a IA lê.");
    // O arquivo é lido do Storage com a sessão de quem está logado (as regras do bucket valem).
    const { data: blob, error } = await ctx.supabase.storage.from("pessoas").download(String(arq.path));
    if (error || !blob) throw new ErroValidacao("Não foi possível abrir o arquivo.");
    const max = midia === "application/pdf" ? MAX_ARQUIVO_IA.pdf : MAX_ARQUIVO_IA.imagem;
    if (blob.size > max) throw new ErroValidacao(`Arquivo grande demais para a leitura (máximo ${Math.round(max / 1024 / 1024)} MB).`);
    const base64 = Buffer.from(await blob.arrayBuffer()).toString("base64");
    const anexo: AnexoIA = midia === "application/pdf" ? { tipo: "pdf", base64 } : { tipo: "imagem", midia, base64 };
    const r = await chamarIA(ctx.supabase, {
      recurso: "extracao_documento",
      pedido: promptExtracao(tipo),
      entradaResumo: `Leitura de ${TIPOS_DOC_EXTRACAO[tipo]} (${arq.categoria ?? "arquivo"}, ${Math.round(blob.size / 1024)} KB)`,
      referencia: { tipo: "pessoa", id: String(arq.pessoa_id) },
      anexo,
    });
    if (!r.ok) throw new ErroValidacao(r.mensagem);
    const v = validarExtracao(tipo, r.json);
    if (!v) throw new ErroValidacao("A IA não conseguiu ler os campos deste documento. Confira se é o tipo certo e se a imagem está nítida.");
    return { tipo, pessoaId: String(arq.pessoa_id), campos: v.campos, avisos: v.avisos, legivel: v.legivel };
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
}

/** Grava no cadastro só os campos que o usuário marcou e conferiu. */
export async function aplicarDocumento(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  try {
    const ctx = await obterContexto();
    await exigirPermissao("pessoas", "editar");
    const pessoaId = idValido(texto(fd, "pessoa_id"), "a pessoa");
    const tipo = (Object.keys(TIPOS_DOC_EXTRACAO) as TipoDocExtracao[]).find((t) => t === texto(fd, "tipo"));
    if (!tipo) throw new ErroValidacao("Tipo de documento inválido.");
    const marcados = fd.getAll("aplicar").map(String);
    const upd: Record<string, unknown> = {};
    for (const c of CAMPOS_DOC[tipo]) {
      if (!c.pessoa || !marcados.includes(c.campo)) continue;
      const v = texto(fd, `v_${c.campo}`);
      if (!v) continue;
      if (c.tipo === "cpf") {
        const d = v.replace(/\D/g, "");
        if (d.length !== 11) throw new ErroValidacao("CPF inválido.");
        upd[c.pessoa] = d;
      } else if (c.tipo === "data") {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new ErroValidacao(`${c.rotulo}: use uma data válida.`);
        upd[c.pessoa] = v;
      } else if (c.tipo === "cep") upd[c.pessoa] = v.replace(/\D/g, "").slice(0, 8);
      else if (c.tipo === "uf") upd[c.pessoa] = v.toUpperCase().slice(0, 2);
      else upd[c.pessoa] = v.slice(0, 200);
    }
    if (!Object.keys(upd).length) throw new ErroValidacao("Marque pelo menos um campo para gravar.");
    const { error } = await ctx.supabase.from("pessoas").update(upd).eq("id", pessoaId);
    if (error) throw error;
    await ctx.supabase
      .from("pessoa_interacoes")
      .insert({ pessoa_id: pessoaId, tipo: "nota", descricao: `Dados conferidos a partir do documento (${TIPOS_DOC_EXTRACAO[tipo]}): ${Object.keys(upd).join(", ")}.` });
    revalidatePath(`/pessoas/${pessoaId}`, "layout");
    return { ok: `Gravado no cadastro: ${Object.keys(upd).length} campo(s). ${resumoExtracao(tipo, upd)}` };
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
}

// =============================================================================
// Leads (imobiliária): análise com IA e resposta sugerida no atendimento
// =============================================================================
export type EstadoAnaliseLead = { erro?: string; analise?: AnaliseLeadIA };

export async function analisarLeadComIA(_: EstadoAnaliseLead, fd: FormData): Promise<EstadoAnaliseLead> {
  try {
    const ctx = await obterContexto();
    exigirImobiliaria(ctx);
    await exigirPermissao("comercial", "ver");
    const id = idValido(texto(fd, "lead_id"), "o lead");
    const ia = await estadoIA(ctx.supabase);
    if (!ia.configurada) throw new ErroValidacao(MENSAGEM_SEM_IA);
    if (!ia.config.ativa) throw new ErroValidacao("A IA está desligada nesta conta (Configurações da IA).");
    const { data: l } = await ctx.supabase
      .from("leads")
      .select("nome, status, origem, funil, interesse, orcamento_min, orcamento_max, regioes, tipos, quartos_min, observacoes, imovel:imoveis(codigo, tipo, bairro, valor_aluguel, valor_venda)")
      .eq("id", id)
      .maybeSingle();
    if (!l) throw new ErroValidacao("Lead não encontrado.");
    const { data: ev } = await ctx.supabase.from("lead_eventos").select("tipo, descricao, data").eq("lead_id", id).order("data", { ascending: false }).limit(30);
    const eventos = ((ev ?? []) as { tipo: string; descricao: string | null; data: string }[]).reverse();
    const imovel = l.imovel as unknown as { codigo: string; tipo: string | null; bairro: string | null } | null;
    const perfil = [
      l.interesse ? `quer ${l.interesse === "compra" ? "comprar" : "alugar"}` : null,
      l.orcamento_max ? `até R$ ${l.orcamento_max}` : null,
      l.regioes ? `regiões: ${l.regioes}` : null,
      (l.tipos as string[] | null)?.length ? `tipos: ${(l.tipos as string[]).join(", ")}` : null,
      l.quartos_min ? `${l.quartos_min}+ quartos` : null,
      l.observacoes ? `observações: ${String(l.observacoes).slice(0, 500)}` : null,
    ]
      .filter(Boolean)
      .join("; ");
    const ultimaMensagem = [...eventos].reverse().find((e) => e.tipo === "mensagem" || e.tipo === "whatsapp" || e.tipo === "entrada")?.descricao ?? null;
    const faltando = perguntasFaltando(l as unknown as Partial<LeadIA>, ia.config.perguntas);
    const r = await chamarIA(ctx.supabase, {
      recurso: "leads",
      pedido: promptLead(
        {
          primeiroNome: primeiroNomeIA(l.nome as string),
          status: String(l.status),
          origem: (l.origem as string | null) ?? null,
          funil: (l.funil as string | null) ?? null,
          perfil: perfil || "não preenchido",
          imovel: imovel ? `${imovel.codigo} (${imovel.tipo ?? "imóvel"}, ${imovel.bairro ?? "—"})` : null,
          historico: eventos.map((e) => ({ quando: dataHora(e.data), quem: "Equipe", texto: `${e.tipo}: ${e.descricao ?? ""}` })),
          ultimaMensagem,
        },
        faltando,
        hojeISO(),
      ),
      entradaResumo: `Análise do lead (${eventos.length} contatos)`,
      referencia: { tipo: "lead", id },
    });
    if (!r.ok) throw new ErroValidacao(r.mensagem);
    const analise = validarAnaliseLead(r.json);
    if (!analise) throw new ErroValidacao("A IA respondeu fora do formato. Tente de novo.");
    return { analise };
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
}

export type EstadoAtendimento = { erro?: string; aviso?: string; intencao?: Intencao; resposta?: string; perguntas?: string[]; usouIA?: boolean; foraDoHorario?: boolean };

export async function sugerirResposta(_: EstadoAtendimento, fd: FormData): Promise<EstadoAtendimento> {
  try {
    const ctx = await obterContexto();
    exigirImobiliaria(ctx);
    await exigirPermissao("comercial", "ver");
    const mensagem = (texto(fd, "mensagem") ?? "").slice(0, 2000);
    if (!mensagem) throw new ErroValidacao("Cole a mensagem do cliente.");
    const ia = await estadoIA(ctx.supabase);
    const conversaId = texto(fd, "conversa_id");
    let historico: MensagemResumo[] = [];
    let nome: string | null = texto(fd, "nome");
    let lead: Record<string, unknown> = {};
    if (conversaId && UUID.test(conversaId)) {
      const h = await historicoPara(ctx, "conversa", conversaId);
      historico = h.msgs.slice(-20);
      const { data: c } = await ctx.supabase.from("mkt_conversas").select("nome, lead:leads(funil, interesse, regioes, orcamento_min, orcamento_max, quartos_min)").eq("id", conversaId).maybeSingle();
      nome = nome ?? ((c?.nome as string | null) ?? null);
      lead = ((c?.lead as unknown) as Record<string, unknown> | null) ?? {};
    }
    const faltando = perguntasFaltando(lead as Partial<LeadIA>, ia.config.perguntas);
    const fora = !dentroDoHorario(new Date(), ia.config);
    const regra = intencaoPorRegra(mensagem);
    const porRegra = respostaPorRegra({ nome, imobiliaria: ctx.organizacao.nome, intencao: regra.intencao, faltando, foraDoHorario: fora && ia.config.fora_horario_ativo, cfg: ia.config });
    if (ia.disponivel && ia.config.recursos.includes("atendimento")) {
      const r = await chamarIA(ctx.supabase, {
        recurso: "atendimento",
        pedido: promptAtendimento(mensagem, { imobiliaria: ctx.organizacao.nome, faltando, historico }),
        entradaResumo: `Resposta sugerida para: ${mensagem.slice(0, 300)}`,
        referencia: conversaId && UUID.test(conversaId) ? { tipo: "conversa", id: conversaId } : null,
      });
      const v = r.ok ? validarRespostaAtendimento(r.json) : null;
      if (v) return { ...v, usouIA: true, foraDoHorario: fora };
      return { intencao: regra.intencao, resposta: porRegra, perguntas: faltando.slice(0, 1).map((p) => p.texto), usouIA: false, foraDoHorario: fora, aviso: `${r.ok ? "A IA respondeu fora do formato." : r.mensagem} Mostrando a resposta por regra.` };
    }
    return { intencao: regra.intencao, resposta: porRegra, perguntas: faltando.slice(0, 1).map((p) => p.texto), usouIA: false, foraDoHorario: fora };
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
}

// =============================================================================
// Preço por comparáveis: explicação com IA (os números são do banco)
// =============================================================================
export type EstadoPreco = { erro?: string; explicacao?: string; usouIA?: boolean };

export async function explicarPrecoComIA(_: EstadoPreco, fd: FormData): Promise<EstadoPreco> {
  try {
    const ctx = await obterContexto();
    await exigirPermissao("imoveis", "ver");
    const id = idValido(texto(fd, "imovel_id"), "o imóvel");
    const finalidade = texto(fd, "finalidade") === "venda" ? "venda" : "locacao";
    const { data, error } = await ctx.supabase.rpc("ia_preco_comparaveis", { p_imovel: id, p_finalidade: finalidade });
    if (error) throw new ErroValidacao(error.message);
    const r = data as ResultadoPreco;
    const regra = explicarPreco(r);
    if (r.erro) return { explicacao: regra, usouIA: false };
    const ia = await estadoIA(ctx.supabase);
    if (!ia.disponivel) throw new ErroValidacao(ia.configurada ? "A IA está desligada nesta conta (Configurações da IA)." : MENSAGEM_SEM_IA);
    const imovel = await imovelParaIA(ctx, id);
    const resp = await chamarIA(ctx.supabase, { recurso: "preco", pedido: promptPreco(r, imovel), entradaResumo: `Preço de ${imovel.codigo} (${finalidade})`, referencia: { tipo: "imovel", id } });
    if (!resp.ok) throw new ErroValidacao(resp.mensagem);
    return { explicacao: validarExplicacao(resp.json, "explicacao") ?? regra, usouIA: true };
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
}

// =============================================================================
// Ações sugeridas (aprovação humana)
// =============================================================================
function payloadDoForm(tipo: TipoAcaoIA, fd: FormData): { payload: Record<string, unknown>; valor: number | null; referencia: [string, string] | null; pessoa: string | null } {
  const t = (k: string) => texto(fd, k);
  const limpo = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined && v !== ""));
  switch (tipo) {
    case "mensagem_cliente": {
      const p = limpo({ canal: t("canal") ?? "whatsapp", destino: t("destino"), nome: t("nome"), texto: t("texto"), conversa_id: t("conversa_id"), lead_id: t("lead_id"), pessoa_id: t("pessoa_id") });
      const ref: [string, string] | null = p.conversa_id ? ["conversa", String(p.conversa_id)] : p.lead_id ? ["lead", String(p.lead_id)] : p.pessoa_id ? ["pessoa", String(p.pessoa_id)] : null;
      return { payload: p, valor: null, referencia: ref, pessoa: (p.pessoa_id as string) ?? null };
    }
    case "mudar_etapa_lead":
      return { payload: limpo({ lead_id: t("lead_id"), status: t("status"), motivo: t("motivo") }), valor: null, referencia: t("lead_id") ? ["lead", t("lead_id")!] : null, pessoa: null };
    case "mudar_responsavel_lead":
      return { payload: { ...limpo({ lead_id: t("lead_id"), motivo: t("motivo") }), corretor_id: t("corretor_id") }, valor: null, referencia: t("lead_id") ? ["lead", t("lead_id")!] : null, pessoa: null };
    case "desconto": {
      const valor = numero(fd, "valor");
      return { payload: limpo({ contrato_id: t("contrato_id"), tipo: t("tipo_desconto") ?? "valor", valor, inicio: t("inicio"), fim: t("fim"), motivo: t("motivo") }), valor: t("tipo_desconto") === "pct" ? null : valor, referencia: t("contrato_id") ? ["contrato", t("contrato_id")!] : null, pessoa: null };
    }
    case "alterar_preco": {
      const valor = numero(fd, "valor");
      return { payload: limpo({ imovel_id: t("imovel_id"), campo: t("campo") ?? "valor_aluguel", valor }), valor, referencia: t("imovel_id") ? ["imovel", t("imovel_id")!] : null, pessoa: null };
    }
    case "cancelar_cobranca":
      return { payload: limpo({ fatura_id: t("fatura_id"), motivo: t("motivo") }), valor: null, referencia: t("fatura_id") ? ["fatura", t("fatura_id")!] : null, pessoa: null };
    case "renegociar_cobranca":
      return { payload: limpo({ fatura_id: t("fatura_id"), observacao: t("observacao") }), valor: null, referencia: t("fatura_id") ? ["fatura", t("fatura_id")!] : null, pessoa: null };
    case "criar_lancamento": {
      const valor = numero(fd, "valor");
      return {
        // "descricao_lancamento" = descrição do lançamento; "descricao" fica para a explicação da ação.
        payload: limpo({
          tipo: t("tipo_lancamento"),
          descricao: t("descricao_lancamento") ?? t("descricao"),
          valor,
          vencimento: t("vencimento"),
          categoria: t("categoria"),
          pessoa_id: t("pessoa_id"),
          contrato_id: t("contrato_id"),
          imovel_id: t("imovel_id"),
        }),
        valor,
        referencia: t("contrato_id") ? ["contrato", t("contrato_id")!] : t("imovel_id") ? ["imovel", t("imovel_id")!] : null,
        pessoa: t("pessoa_id"),
      };
    }
    case "criar_tarefa":
      return {
        payload: limpo({ titulo: t("titulo_tarefa"), vencimento: t("vencimento"), prioridade: t("prioridade") ?? "normal", lead_id: t("lead_id"), imovel_id: t("imovel_id"), contrato_id: t("contrato_id") }),
        valor: null,
        referencia: t("lead_id") ? ["lead", t("lead_id")!] : t("contrato_id") ? ["contrato", t("contrato_id")!] : null,
        pessoa: null,
      };
  }
}

/** Sugere uma ação crítica: vai para "Ações para aprovar" (nunca roda direto). */
export async function sugerirAcao(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  try {
    const ctx = await obterContexto();
    const tipo = (TIPOS_ACAO_IA as readonly string[]).find((t) => t === texto(fd, "tipo")) as TipoAcaoIA | undefined;
    if (!tipo) throw new ErroValidacao("Tipo de ação inválido.");
    if (TIPOS_ACAO_IA_IMOB.includes(tipo)) exigirImobiliaria(ctx);
    const { payload, valor, referencia, pessoa } = payloadDoForm(tipo, fd);
    const erro = validarPayloadAcao(tipo, payload);
    if (erro) throw new ErroValidacao(erro);
    const { error } = await ctx.supabase.from("ia_acoes").insert({
      tipo,
      origem: texto(fd, "origem") === "ia" ? "ia" : "usuario",
      titulo: textoObrigatorio(fd, "titulo", "o título").slice(0, 200),
      descricao: (texto(fd, "descricao") ?? "").slice(0, 2000) || null,
      valor,
      payload,
      referencia_tipo: referencia?.[0] ?? null,
      referencia_id: referencia?.[1] ?? null,
      pessoa_id: pessoa && UUID.test(pessoa) ? pessoa : null,
    });
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Enviado para “Ações para aprovar”. Nada muda até alguém aprovar." };
}

type LinhaAcao = AcaoParaExecutar & { status: string; executada_em: string | null };

async function carregarAcao(ctx: Contexto, id: string): Promise<LinhaAcao> {
  const { data } = await ctx.supabase.from("ia_acoes").select("id, tipo, payload, titulo, status, executada_em").eq("id", id).maybeSingle();
  if (!data) throw new ErroValidacao("Ação não encontrada.");
  return data as unknown as LinhaAcao;
}

/** Execução parada há mais que isso (a tela caiu no meio) pode ser destravada (o banco confere de novo). */
const TRAVA_EXECUCAO_MS = 10 * 60_000;

/**
 * Trava a ação para executar: passa de aprovada/erro para "executando" num
 * update condicional. Duas telas ao mesmo tempo: só uma recebe a linha de volta
 * e executa; a outra não roda nada.
 */
async function travarParaExecutar(ctx: Contexto, id: string): Promise<boolean> {
  const { data, error } = await ctx.supabase.from("ia_acoes").update({ status: "executando" }).eq("id", id).in("status", ["aprovada", "erro"]).select("id").maybeSingle();
  if (error) throw new ErroValidacao(error.message);
  return !!data;
}

/** Fecha a execução travada por esta tela (executando → executada/erro). */
async function marcarResultado(ctx: Contexto, id: string, r: { ok: boolean; resultado?: string; erro?: string }) {
  await ctx.supabase
    .from("ia_acoes")
    .update(r.ok ? { status: "executada", resultado: (r.resultado ?? "Feito.").slice(0, 1000) } : { status: "erro", erro: (r.erro ?? "Não foi possível executar.").slice(0, 1000) })
    .eq("id", id)
    .eq("status", "executando");
}

/** Trava, roda pela via normal e registra o resultado. null = outra tela já está fazendo (ou fez). */
async function travarEExecutar(ctx: Contexto, a: LinhaAcao): Promise<{ ok: boolean; resultado?: string; erro?: string } | null> {
  if (!(await travarParaExecutar(ctx, a.id))) return null;
  const r = await executarAcao(ctx, a);
  await marcarResultado(ctx, a.id, r);
  return r;
}

/** Aprovar (e, se a ação roda sozinha, executar pela via normal) ou recusar com motivo. */
export async function decidirAcao(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  let msg = "Decisão registrada.";
  try {
    const ctx = await obterContexto();
    const id = idValido(texto(fd, "id"), "a ação");
    const aprovar = texto(fd, "decisao") === "aprovar";
    const motivo = (texto(fd, "motivo") ?? "").slice(0, 500) || null;
    const a = await carregarAcao(ctx, id);
    if (a.status !== "pendente") throw new ErroValidacao("Esta ação já foi decidida.");
    // Decisão atômica: só muda se AINDA estiver pendente (dois gestores ao mesmo tempo → só um decide).
    const { data, error } = await ctx.supabase
      .from("ia_acoes")
      .update({ status: aprovar ? "aprovada" : "recusada", motivo })
      .eq("id", id)
      .eq("status", "pendente")
      .select("status")
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new ErroValidacao("Esta ação acabou de ser decidida por outra pessoa (ou você não pode decidi-la).");
    if (aprovar && ACAO_AUTOMATICA[a.tipo]) {
      const r = await travarEExecutar(ctx, a);
      msg = !r ? "Aprovada. Outra tela já está fazendo esta ação." : r.ok ? `Aprovada e feita: ${r.resultado}` : `Aprovada, mas deu erro ao executar: ${r.erro}`;
    } else if (aprovar) msg = "Aprovada. Agora faça pelo botão (abrir o WhatsApp / montar o acordo) e marque como feita.";
    else msg = "Recusada.";
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: msg };
}

/** Faz (ou tenta de novo) uma ação aprovada que o sistema executa sozinho. */
export async function executarAprovada(id: string): Promise<Resultado> {
  try {
    const ctx = await obterContexto();
    const a = await carregarAcao(ctx, id);
    if (!ACAO_AUTOMATICA[a.tipo]) throw new ErroValidacao("Esta ação é feita à mão (abra pelo botão e depois marque como feita).");
    if (a.status === "executando") {
      // Só destrava execução parada há mais de 10 minutos (a tela caiu no meio).
      if (!a.executada_em || Date.now() - new Date(a.executada_em).getTime() < TRAVA_EXECUCAO_MS)
        throw new ErroValidacao("Esta ação está sendo feita agora. Espere terminar e atualize a página.");
      const { error } = await ctx.supabase
        .from("ia_acoes")
        .update({ status: "erro", erro: "A execução anterior não terminou (tempo esgotado)." })
        .eq("id", id)
        .eq("status", "executando");
      if (error) throw new ErroValidacao(error.message);
    } else if (a.status !== "aprovada" && a.status !== "erro") throw new ErroValidacao("Só ação aprovada (ou com erro) pode ser executada.");
    const r = await travarEExecutar(ctx, a);
    revalidar();
    if (!r) return { ok: false, erro: "Esta ação já foi feita ou está sendo feita agora por outra pessoa." };
    return r.ok ? { ok: true } : { ok: false, erro: r.erro };
  } catch (e) {
    return falha(e);
  }
}

/** Ação feita à mão (mensagem enviada pelo WhatsApp/e-mail, acordo montado): marca como feita e registra. */
export async function marcarAcaoFeita(id: string): Promise<Resultado> {
  try {
    const ctx = await obterContexto();
    const a = await carregarAcao(ctx, id);
    if (ACAO_AUTOMATICA[a.tipo]) throw new ErroValidacao("Esta ação é feita pelo sistema: use “Fazer agora”.");
    if (a.status !== "aprovada" && a.status !== "erro") throw new ErroValidacao("Só ação aprovada pode ser marcada como feita.");
    const p = a.payload;
    const canal = String(p.canal ?? "whatsapp");
    const resultado =
      a.tipo === "mensagem_cliente" ? `Mensagem enviada por ${canal === "email" ? "e-mail" : canal === "sms" ? "SMS" : "WhatsApp"} (envio assistido).` : "Feito à mão.";
    // Primeiro marca (update condicional: duas telas → só uma passa), depois registra a
    // mensagem no histórico do cliente — assim o registro não sai em dobro.
    const { data, error } = await ctx.supabase.from("ia_acoes").update({ status: "executada", resultado }).eq("id", id).in("status", ["aprovada", "erro"]).select("id").maybeSingle();
    if (error) throw error;
    if (!data) throw new ErroValidacao("Esta ação já foi marcada como feita (ou você não pode concluí-la).");
    if (a.tipo === "mensagem_cliente") {
      const txt = String(p.texto ?? "").slice(0, 4000);
      const tipoContato = canal === "email" ? "email" : "whatsapp";
      if (p.conversa_id && imobiliaria(ctx)) {
        await ctx.supabase.from("mkt_mensagens").insert({ conversa_id: String(p.conversa_id), direcao: "saida", texto: txt });
      } else if (p.lead_id && imobiliaria(ctx)) {
        await ctx.supabase.from("lead_eventos").insert({ lead_id: String(p.lead_id), tipo: tipoContato, descricao: txt });
        await ctx.supabase.from("leads").update({ ultimo_contato: new Date().toISOString() }).eq("id", String(p.lead_id));
      } else if (p.pessoa_id) {
        await ctx.supabase.from("pessoa_interacoes").insert({ pessoa_id: String(p.pessoa_id), tipo: tipoContato, descricao: txt });
      }
    }
    revalidar();
    return { ok: true };
  } catch (e) {
    return falha(e);
  }
}

export async function cancelarAcao(id: string): Promise<Resultado> {
  try {
    const ctx = await obterContexto();
    const { data, error } = await ctx.supabase.from("ia_acoes").update({ status: "cancelada" }).eq("id", id).eq("status", "pendente").select("id").maybeSingle();
    if (error) throw error;
    if (!data) throw new ErroValidacao("Não dá para cancelar esta ação.");
    revalidar();
    return { ok: true };
  } catch (e) {
    return falha(e);
  }
}

// =============================================================================
// Automações por regras
// =============================================================================
function regraDoForm(fd: FormData, modo: string) {
  const gatilho = gatilhosDoModo(modo).find((g) => g === texto(fd, "gatilho")) as GatilhoIA | undefined;
  if (!gatilho) throw new ErroValidacao("Escolha um gatilho válido.");
  const acao = (ACOES_REGRA as readonly string[]).find((a) => a === texto(fd, "acao")) as AcaoRegra | undefined;
  if (!acao) throw new ErroValidacao("Escolha uma ação válida.");
  if (!acoesRegraDoModo(modo).includes(acao))
    throw new ErroValidacao(acao === "criar_tarefa" ? "No modo imóveis pessoais a automação não cria tarefa: use “Avisar o responsável”." : "Esta ação só existe no modo imobiliária.");
  const condicoes: Record<string, unknown> = {};
  const permitidas = CONDICOES_POR_GATILHO[gatilho] as readonly string[];
  for (const k of ["funil", "origem", "prioridade", "urgencia"]) if (permitidas.includes(k) && texto(fd, `cond_${k}`)) condicoes[k] = texto(fd, `cond_${k}`);
  if (permitidas.includes("sem_corretor") && fd.getAll("cond_sem_corretor").includes("on")) condicoes.sem_corretor = true;
  if (permitidas.includes("valor_min") && numero(fd, "cond_valor_min")) condicoes.valor_min = numero(fd, "cond_valor_min");
  const cfg: Record<string, unknown> = {};
  if (texto(fd, "cfg_titulo") && (acao === "criar_tarefa" || acao === "avisar_responsavel")) cfg.titulo = texto(fd, "cfg_titulo");
  if (acao === "criar_tarefa") cfg.prioridade = texto(fd, "cfg_prioridade_tarefa") === "alta" ? "alta" : "normal";
  if (acao === "sugerir_mensagem") {
    cfg.mensagem = texto(fd, "cfg_mensagem") ?? "";
    cfg.canal = texto(fd, "cfg_canal") ?? "whatsapp";
  }
  if (acao === "marcar_prioridade") {
    if (texto(fd, "cfg_prioridade_lead")) cfg.prioridade = texto(fd, "cfg_prioridade_lead");
    if (texto(fd, "cfg_etiqueta")) cfg.etiqueta = texto(fd, "cfg_etiqueta");
  }
  const erro = validarCondicoes(gatilho, condicoes) ?? validarConfigAcao(acao, gatilho, cfg);
  if (erro) throw new ErroValidacao(erro);
  if (GATILHOS_IA_IMOB.includes(gatilho) && modo === "pessoal") throw new ErroValidacao("Gatilhos de leads e visitas só existem no modo imobiliária.");
  return {
    nome: textoObrigatorio(fd, "nome", "o nome").slice(0, 80),
    gatilho,
    dias: Math.min(365, Math.max(0, inteiro(fd, "dias") ?? 1)),
    acao,
    condicoes,
    acao_config: cfg,
    repetir_dias: Math.min(365, Math.max(0, inteiro(fd, "repetir_dias") ?? 0)),
  };
}

async function contextoConfig() {
  const ctx = await obterContexto();
  if (!podeConfigurarIA(ctx.papel)) throw new ErroValidacao("Só o administrador ou o gestor mexem nas automações.");
  await exigirPermissao("configuracoes", "editar");
  return ctx;
}

export async function criarRegra(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  try {
    const ctx = await contextoConfig();
    const { error } = await ctx.supabase.from("automacoes_regras").insert(regraDoForm(fd, ctx.organizacao.modo));
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Automação criada." };
}

export async function salvarRegra(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  try {
    const ctx = await contextoConfig();
    const id = idValido(texto(fd, "id"), "a automação");
    const { error } = await ctx.supabase
      .from("automacoes_regras")
      .update({ ...regraDoForm(fd, ctx.organizacao.modo), ativa: fd.getAll("ativa").includes("on") })
      .eq("id", id);
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Salvo." };
}

export async function excluirRegra(id: string): Promise<Resultado> {
  try {
    const ctx = await contextoConfig();
    const { error } = await ctx.supabase.from("automacoes_regras").delete().eq("id", id);
    if (error) throw error;
  } catch (e) {
    return falha(e);
  }
  revalidar();
  return { ok: true };
}

export async function rodarAutomacoesAgora(_id: string): Promise<Resultado> {
  void _id;
  try {
    const ctx = await contextoConfig();
    const { error } = await ctx.supabase.rpc("automacoes_rodar", { p_forcar: true });
    if (error) throw new ErroValidacao(error.message);
  } catch (e) {
    return falha(e);
  }
  revalidar();
  revalidatePath("/comercial", "layout");
  return { ok: true };
}

// =============================================================================
// Inconsistências e avisos
// =============================================================================
export async function conferirInconsistencia(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  try {
    const ctx = await obterContexto();
    await exigirPermissao("financeiro", "editar");
    const tipo = (TIPOS_INCONSISTENCIA as readonly string[]).find((t) => t === texto(fd, "tipo"));
    if (!tipo) throw new ErroValidacao("Tipo inválido.");
    const { error } = await ctx.supabase
      .from("ia_inconsistencias_conferidas")
      .insert({ tipo, chave: textoObrigatorio(fd, "chave").slice(0, 300), observacao: (texto(fd, "observacao") ?? "").slice(0, 500) || null });
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Marcado como conferido." };
}

export async function desmarcarInconsistencia(ref: string): Promise<Resultado> {
  try {
    const ctx = await obterContexto();
    await exigirPermissao("financeiro", "editar");
    const i = ref.indexOf("|");
    const { error } = await ctx.supabase.from("ia_inconsistencias_conferidas").delete().eq("tipo", ref.slice(0, i)).eq("chave", ref.slice(i + 1));
    if (error) throw error;
  } catch (e) {
    return falha(e);
  }
  revalidar();
  return { ok: true };
}

export async function marcarAvisoLido(id: string): Promise<Resultado> {
  try {
    const ctx = await obterContexto();
    const q = ctx.supabase.from("ia_avisos").update({ lido_em: new Date().toISOString() }).is("lido_em", null);
    const { error } = id === "todos" ? await q.eq("usuario_id", ctx.usuario.id) : await q.eq("id", id);
    if (error) throw error;
  } catch (e) {
    return falha(e);
  }
  revalidar();
  return { ok: true };
}

