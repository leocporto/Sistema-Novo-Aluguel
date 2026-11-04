"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { obterContexto } from "@/lib/contexto";
import { type EstadoAcao, ErroValidacao, inteiro, mensagemErro, numero, texto, textoObrigatorio } from "@/lib/form";
import {
  BASES_LEGAIS,
  BUREAUS,
  CANAIS_RENOVACAO,
  DESTINATARIOS_RENOVACAO,
  PARTES_DOCUMENTO,
  ROTULO_BUREAU,
  STATUS_GARANTIA_PROPOSTA,
  TIPOS_GARANTIA_PROPOSTA,
  TIPOS_RENDA,
  checarConsultaCredito,
  checklistPadrao,
  configComPadrao,
  fichaExpiraEm,
  normalizarResultadoCredito,
  papelAprovaExcecao,
  papelDecide,
  validarDecisao,
} from "@/lib/dominio/analise";
import { hojeISO } from "@/lib/dominio/datas";
import { somenteDigitos, validarCNPJ, validarCPF } from "@/lib/dominio/documentos";
import { conectorCredito } from "@/lib/servicos/credito";

type Supabase = Awaited<ReturnType<typeof obterContexto>>["supabase"];
type Resultado = { ok: boolean; erro?: string; url?: string };

function revalidar() {
  revalidatePath("/analise", "layout");
  revalidatePath("/");
}

const um = <T extends string>(lista: readonly T[], v: string | null, padrao: T): T => (v && (lista as readonly string[]).includes(v) ? (v as T) : padrao);
const marcado = (fd: FormData, campo: string) => fd.getAll(campo).includes("on");
const naoNegativo = (v: number | null, rotulo: string) => {
  if (v !== null && v < 0) throw new ErroValidacao(`${rotulo} não pode ser negativo.`);
  return v;
};
const agora = () => new Date().toISOString();

/** Data digitada (AAAA-MM-DD) vira o meio-dia de Brasília, para não "voltar um dia" no fuso. */
const dataParaInstante = (d: string | null) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d}T12:00:00-03:00` : agora());

async function inserirChecklist(supabase: Supabase, analiseId: string, parte: "candidato" | "fiador", tipoPessoa: string | null | undefined, fiadorId: string | null, jaTem: Set<string>) {
  const itens = checklistPadrao(parte, tipoPessoa)
    .map((i, k) => ({ ...i, ordem: (parte === "fiador" ? 100 : 0) + k }))
    .filter((i) => !jaTem.has(`${fiadorId ?? ""}|${i.item}`));
  if (!itens.length) return 0;
  const { error } = await supabase.from("analise_documentos").insert(
    itens.map((i) => ({ analise_id: analiseId, fiador_id: fiadorId, parte, item: i.item, rotulo: i.rotulo, obrigatorio: i.obrigatorio, ordem: i.ordem })),
  );
  if (error) throw error;
  return itens.length;
}

// Candidato / análise ------------------------------------------------------------------
export async function criarAnalise(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase, organizacao } = await obterContexto();
  const pessoal = organizacao.modo === "pessoal";
  let id: string;
  try {
    let candidato = texto(fd, "candidato_id");
    if (!candidato) {
      const nome = textoObrigatorio(fd, "nome", "o candidato (escolha uma pessoa ou digite o nome)");
      const documento = somenteDigitos(texto(fd, "documento")) || null;
      let tipo: "PF" | "PJ" = "PF";
      if (documento) {
        if (documento.length === 14) tipo = "PJ";
        if (!(tipo === "PF" ? validarCPF(documento) : validarCNPJ(documento))) throw new ErroValidacao(tipo === "PF" ? "CPF inválido." : "CNPJ inválido.");
        const { data: existe } = await supabase.from("pessoas").select("id").eq("documento", documento).maybeSingle();
        if (existe) candidato = existe.id as string;
      }
      if (!candidato) {
        const { data, error } = await supabase
          .from("pessoas")
          .insert({ nome, documento, tipo_pessoa: tipo, telefone: texto(fd, "telefone"), email: texto(fd, "email"), papeis: ["locatario"] })
          .select("id")
          .single();
        if (error) throw error;
        candidato = data.id as string;
      }
    }
    const imovel_id = texto(fd, "imovel_id");
    let aluguel = naoNegativo(numero(fd, "valor_aluguel"), "O aluguel");
    let encargos = naoNegativo(numero(fd, "valor_encargos"), "Os encargos");
    if (imovel_id && (aluguel === null || encargos === null)) {
      const { data: im } = await supabase.from("imoveis").select("valor_aluguel, valor_condominio, valor_iptu").eq("id", imovel_id).single();
      aluguel ??= Number(im?.valor_aluguel ?? 0);
      encargos ??= Number(im?.valor_condominio ?? 0) + Number(im?.valor_iptu ?? 0);
    }
    const moradores = inteiro(fd, "moradores");
    if (moradores !== null && (moradores < 0 || moradores > 50)) throw new ErroValidacao("Número de moradores inválido.");
    const { data, error } = await supabase
      .from("analises")
      .insert({
        candidato_id: candidato,
        imovel_id,
        corretor_id: pessoal ? null : texto(fd, "corretor_id"),
        finalidade: texto(fd, "finalidade") === "comercial" ? "comercial" : "residencial",
        valor_aluguel: aluguel ?? 0,
        valor_encargos: encargos ?? 0,
        moradores,
        renda_declarada: naoNegativo(numero(fd, "renda_declarada"), "A renda"),
        observacoes: texto(fd, "observacoes"),
      })
      .select("id")
      .single();
    if (error) throw error;
    id = data.id as string;
    const { data: p } = await supabase.from("pessoas").select("tipo_pessoa").eq("id", candidato).single();
    await inserirChecklist(supabase, id, "candidato", p?.tipo_pessoa as string | undefined, null, new Set());
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  redirect(`/analise/${id}`);
}

/** Salva sozinho a parte da ficha que veio no formulário. */
export async function atualizarAnalise(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase, organizacao } = await obterContexto();
  const pessoal = organizacao.modo === "pessoal";
  const id = String(fd.get("id"));
  try {
    const d: Record<string, unknown> = {};
    for (const c of ["moradores_obs", "observacoes", "proprietario_ciente_em"]) if (fd.has(c)) d[c] = texto(fd, c);
    if (fd.has("imovel_id")) d.imovel_id = texto(fd, "imovel_id");
    if (fd.has("corretor_id") && !pessoal) d.corretor_id = texto(fd, "corretor_id");
    if (fd.has("finalidade")) d.finalidade = texto(fd, "finalidade") === "comercial" ? "comercial" : "residencial";
    if (fd.has("valor_aluguel")) d.valor_aluguel = naoNegativo(numero(fd, "valor_aluguel"), "O aluguel") ?? 0;
    if (fd.has("valor_encargos")) d.valor_encargos = naoNegativo(numero(fd, "valor_encargos"), "Os encargos") ?? 0;
    if (fd.has("renda_declarada")) d.renda_declarada = naoNegativo(numero(fd, "renda_declarada"), "A renda");
    if (fd.has("moradores")) {
      const m = inteiro(fd, "moradores");
      if (m !== null && (m < 0 || m > 50)) throw new ErroValidacao("Número de moradores inválido.");
      d.moradores = m;
    }
    if (pessoal) delete d.proprietario_ciente_em;
    const { error } = await supabase.from("analises").update(d).eq("id", id);
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Salvo." };
}

/** Caminhos de arquivos guardados numa pasta do bucket (sem subpastas). */
async function listarPasta(supabase: Supabase, pasta: string): Promise<string[]> {
  const { data } = await supabase.storage.from("analises").list(pasta, { limit: 1000 });
  return (data ?? []).filter((o) => o.id).map((o) => `${pasta}/${o.name}`);
}

/**
 * Apaga arquivos do Storage ANTES de apagar os registros: a permissão de apagar
 * os arquivos enviados pelo candidato (ficha/<token>/…) depende do registro em
 * analise_arquivos ou do token da análise. Sem isso RG e holerite ficavam órfãos (LGPD).
 */
async function apagarArquivos(supabase: Supabase, paths: string[]): Promise<string | null> {
  const unicos = [...new Set(paths.filter(Boolean))];
  for (let i = 0; i < unicos.length; i += 100) {
    const { error } = await supabase.storage.from("analises").remove(unicos.slice(i, i + 100));
    if (error) return `Não foi possível apagar os arquivos enviados (${error.message}). Nada foi excluído; tente de novo.`;
  }
  return null;
}

export async function excluirAnalise(id: string): Promise<Resultado> {
  const { supabase, organizacao, papel } = await obterContexto();
  const { data: a } = await supabase.from("analises").select("id, decisao, token").eq("id", id).maybeSingle();
  if (!a) return { ok: false, erro: "Análise não encontrada." };
  // Mesma regra do banco, conferida antes de apagar os arquivos (para não apagar arquivo e manter a análise).
  if (a.decisao && !papelAprovaExcecao(papel)) return { ok: false, erro: "Só administradores e gestores excluem uma análise já decidida (a decisão continua na auditoria)." };
  const [{ data: arqs }, daEquipe, daFicha] = await Promise.all([
    supabase.from("analise_arquivos").select("path").eq("analise_id", id),
    listarPasta(supabase, `${organizacao.id}/${id}`),
    listarPasta(supabase, `ficha/${a.token}`),
  ]);
  const falha = await apagarArquivos(supabase, [...(arqs ?? []).map((f) => f.path as string), ...daEquipe, ...daFicha]);
  if (falha) return { ok: false, erro: falha };
  const { error } = await supabase.from("analises").delete().eq("id", id);
  if (error) return { ok: false, erro: mensagemErro(error) };
  revalidar();
  return { ok: true };
}

/** Conferi o documento original (foto x pessoa). Grava quem e quando. */
export async function conferirIdentidade(chave: string): Promise<Resultado> {
  return marcarIdentidade(chave, agora());
}
export async function desfazerIdentidade(chave: string): Promise<Resultado> {
  return marcarIdentidade(chave, null);
}
async function marcarIdentidade(chave: string, valor: string | null): Promise<Resultado> {
  const { supabase } = await obterContexto();
  const [tipo, id] = chave.split(":");
  const tabela = tipo === "fiador" ? "analise_fiadores" : "analises";
  const { error } = await supabase.from(tabela).update({ identidade_conferida_em: valor }).eq("id", id);
  if (error) return { ok: false, erro: mensagemErro(error) };
  revalidar();
  return { ok: true };
}

// Ficha online ------------------------------------------------------------------------
export async function ativarFicha(id: string): Promise<Resultado> {
  const { supabase, organizacao } = await obterContexto();
  const { data: cfg } = await supabase.from("analise_config").select("ficha_dias").eq("organizacao_id", organizacao.id).maybeSingle();
  const dias = configComPadrao(cfg).ficha_dias;
  const { error } = await supabase.from("analises").update({ ficha_ativa: true, ficha_expira_em: fichaExpiraEm(hojeISO(), dias) }).eq("id", id);
  if (error) return { ok: false, erro: mensagemErro(error) };
  revalidar();
  return { ok: true };
}

export async function desativarFicha(id: string): Promise<Resultado> {
  const { supabase } = await obterContexto();
  const { error } = await supabase.from("analises").update({ ficha_ativa: false }).eq("id", id);
  if (error) return { ok: false, erro: mensagemErro(error) };
  revalidar();
  return { ok: true };
}

/**
 * Troca o link (o antigo para de funcionar). O valor mandado é só o sinal da
 * troca: o banco gera o token novo (ninguém escolhe um token já usado).
 */
export async function novoLinkFicha(id: string): Promise<Resultado> {
  const { supabase } = await obterContexto();
  const { error } = await supabase.from("analises").update({ token: crypto.randomUUID() }).eq("id", id);
  if (error) return { ok: false, erro: mensagemErro(error) };
  revalidar();
  return { ok: true };
}

// LGPD: autorização de consulta ------------------------------------------------------------
// O banco guarda data, origem, IP e texto juntos: registro manual fica sem IP/texto
// (eles só vêm da ficha online) e a retirada limpa os quatro.
export async function registrarConsentimento(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  try {
    const alvo = textoObrigatorio(fd, "alvo", "de quem é a autorização");
    const [tipo, id] = alvo.split(":");
    const origem = textoObrigatorio(fd, "origem", "como a autorização foi dada");
    const em = dataParaInstante(texto(fd, "data"));
    if (em.slice(0, 10) > hojeISO()) throw new ErroValidacao("A data da autorização não pode ser no futuro.");
    const tabela = tipo === "fiador" ? "analise_fiadores" : "analises";
    const { error } = await supabase.from(tabela).update({ consentimento_em: em, consentimento_origem: origem }).eq("id", id);
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Autorização registrada." };
}

export async function retirarConsentimento(chave: string): Promise<Resultado> {
  const { supabase } = await obterContexto();
  const [tipo, id] = chave.split(":");
  const tabela = tipo === "fiador" ? "analise_fiadores" : "analises";
  const { error } = await supabase.from(tabela).update({ consentimento_em: null, consentimento_origem: null }).eq("id", id);
  if (error) return { ok: false, erro: mensagemErro(error) };
  revalidar();
  return { ok: true };
}

// Documentos -------------------------------------------------------------------------
/** Inclui os documentos padrão que faltam (candidato e cada fiador). */
export async function gerarChecklist(analiseId: string): Promise<Resultado> {
  const { supabase } = await obterContexto();
  try {
    const [{ data: a }, { data: fs }, { data: docs }] = await Promise.all([
      supabase.from("analises").select("candidato:pessoas!analises_candidato_id_fkey(tipo_pessoa)").eq("id", analiseId).single(),
      supabase.from("analise_fiadores").select("id, pessoa:pessoas(tipo_pessoa)").eq("analise_id", analiseId),
      supabase.from("analise_documentos").select("item, fiador_id").eq("analise_id", analiseId),
    ]);
    const jaTem = new Set((docs ?? []).map((d) => `${d.fiador_id ?? ""}|${d.item}`));
    const cand = (a as unknown as { candidato: { tipo_pessoa: string } | null })?.candidato;
    let n = await inserirChecklist(supabase, analiseId, "candidato", cand?.tipo_pessoa, null, jaTem);
    for (const f of (fs ?? []) as unknown as { id: string; pessoa: { tipo_pessoa: string } | null }[])
      n += await inserirChecklist(supabase, analiseId, "fiador", f.pessoa?.tipo_pessoa, f.id, jaTem);
    if (!n) return { ok: false, erro: "O checklist padrão já está completo." };
  } catch (e) {
    return { ok: false, erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: true };
}

export async function adicionarDocumento(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  try {
    const analise_id = textoObrigatorio(fd, "analise_id");
    const fiador_id = texto(fd, "fiador_id");
    const { error } = await supabase.from("analise_documentos").insert({
      analise_id,
      fiador_id,
      parte: fiador_id ? "fiador" : um(PARTES_DOCUMENTO, texto(fd, "parte"), "candidato"),
      rotulo: textoObrigatorio(fd, "rotulo", "o nome do documento"),
      obrigatorio: marcado(fd, "obrigatorio"),
      ordem: 500,
    });
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Documento incluído no checklist." };
}

async function statusDocumento(id: string, status: string): Promise<Resultado> {
  const { supabase } = await obterContexto();
  const { error } = await supabase.from("analise_documentos").update({ status }).eq("id", id);
  if (error) return { ok: false, erro: mensagemErro(error) };
  revalidar();
  return { ok: true };
}
export async function validarDocumento(id: string) {
  return statusDocumento(id, "validado");
}
export async function dispensarDocumento(id: string) {
  return statusDocumento(id, "dispensado");
}
export async function reabrirDocumento(id: string) {
  return statusDocumento(id, "pendente");
}

export async function recusarDocumento(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  try {
    const { error } = await supabase
      .from("analise_documentos")
      .update({ status: "recusado", motivo_recusa: textoObrigatorio(fd, "motivo", "o motivo da recusa") })
      .eq("id", textoObrigatorio(fd, "id"));
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Documento recusado." };
}

export async function excluirDocumento(id: string): Promise<Resultado> {
  const { supabase } = await obterContexto();
  const { error } = await supabase.from("analise_documentos").delete().eq("id", id);
  if (error) return { ok: false, erro: mensagemErro(error) };
  revalidar();
  return { ok: true };
}

// Arquivos ---------------------------------------------------------------------------
export async function registrarArquivo(a: { analiseId: string; path: string; nome: string; documentoId: string | null }): Promise<Resultado> {
  const { supabase, organizacao } = await obterContexto();
  if (!a.path.startsWith(`${organizacao.id}/${a.analiseId}/`)) return { ok: false, erro: "Arquivo inválido." };
  const { error } = await supabase.from("analise_arquivos").insert({ analise_id: a.analiseId, path: a.path, nome: a.nome, documento_id: a.documentoId || null });
  if (error) {
    await supabase.storage.from("analises").remove([a.path]);
    return { ok: false, erro: mensagemErro(error) };
  }
  if (a.documentoId) await supabase.from("analise_documentos").update({ status: "recebido" }).eq("id", a.documentoId).in("status", ["pendente", "recusado"]);
  revalidar();
  return { ok: true };
}

export async function linkArquivo(id: string): Promise<Resultado> {
  const { supabase } = await obterContexto();
  const { data } = await supabase.from("analise_arquivos").select("path").eq("id", id).maybeSingle();
  if (!data) return { ok: false, erro: "Arquivo não encontrado." };
  const { data: u, error } = await supabase.storage.from("analises").createSignedUrl(data.path as string, 300);
  if (error) return { ok: false, erro: mensagemErro(error) };
  return { ok: true, url: u.signedUrl };
}

export async function excluirArquivo(id: string): Promise<Resultado> {
  const { supabase } = await obterContexto();
  const { data } = await supabase.from("analise_arquivos").select("path").eq("id", id).maybeSingle();
  if (!data) return { ok: false, erro: "Arquivo não encontrado." };
  // Primeiro o arquivo (a permissão depende do registro), depois o registro.
  const falha = await apagarArquivos(supabase, [data.path as string]);
  if (falha) return { ok: false, erro: falha };
  const { error } = await supabase.from("analise_arquivos").delete().eq("id", id);
  if (error) return { ok: false, erro: mensagemErro(error) };
  revalidar();
  return { ok: true };
}

// Renda ------------------------------------------------------------------------------
export async function adicionarRenda(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  try {
    const declarado = naoNegativo(numero(fd, "valor_declarado"), "O valor");
    if (!declarado) throw new ErroValidacao("Informe o valor declarado.");
    const { error } = await supabase.from("analise_rendas").insert({
      analise_id: textoObrigatorio(fd, "analise_id"),
      fiador_id: texto(fd, "fiador_id"),
      titular: texto(fd, "titular"),
      tipo: um(TIPOS_RENDA, texto(fd, "tipo"), "outro"),
      fonte: texto(fd, "fonte"),
      valor_declarado: declarado,
      valor_comprovado: naoNegativo(numero(fd, "valor_comprovado"), "O valor comprovado"),
      comprovante: texto(fd, "comprovante"),
    });
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Renda incluída." };
}

export async function atualizarRenda(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  try {
    const d: Record<string, unknown> = {};
    for (const c of ["titular", "fonte", "comprovante"]) if (fd.has(c)) d[c] = texto(fd, c);
    if (fd.has("tipo")) d.tipo = um(TIPOS_RENDA, texto(fd, "tipo"), "outro");
    if (fd.has("valor_declarado")) d.valor_declarado = naoNegativo(numero(fd, "valor_declarado"), "O valor") ?? 0;
    if (fd.has("valor_comprovado")) d.valor_comprovado = naoNegativo(numero(fd, "valor_comprovado"), "O valor comprovado");
    const { error } = await supabase.from("analise_rendas").update(d).eq("id", String(fd.get("id")));
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Salvo." };
}

export async function excluirRenda(id: string): Promise<Resultado> {
  const { supabase } = await obterContexto();
  const { error } = await supabase.from("analise_rendas").delete().eq("id", id);
  if (error) return { ok: false, erro: mensagemErro(error) };
  revalidar();
  return { ok: true };
}

// Consultas de crédito -------------------------------------------------------------------
export async function registrarConsulta(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  try {
    const analise_id = textoObrigatorio(fd, "analise_id");
    const fiador_id = texto(fd, "fiador_id");
    const base_legal = texto(fd, "base_legal");
    if (!base_legal || !(BASES_LEGAIS as readonly string[]).includes(base_legal)) throw new ErroValidacao("Escolha a base legal da consulta (LGPD).");
    const score = inteiro(fd, "score");
    if (score !== null && (score < 0 || score > 1000)) throw new ErroValidacao("O score vai de 0 a 1000.");
    const consultado_em = texto(fd, "consultado_em") ?? hojeISO();
    if (consultado_em > hojeISO()) throw new ErroValidacao("A data da consulta não pode ser no futuro.");
    let documento: string | null = null;
    if (fiador_id) {
      const { data } = await supabase.from("analise_fiadores").select("pessoa:pessoas(documento)").eq("id", fiador_id).single();
      documento = (data as unknown as { pessoa: { documento: string | null } | null })?.pessoa?.documento ?? null;
    } else {
      const { data } = await supabase.from("analises").select("candidato:pessoas!analises_candidato_id_fkey(documento)").eq("id", analise_id).single();
      documento = (data as unknown as { candidato: { documento: string | null } | null })?.candidato?.documento ?? null;
    }
    const restricoes = texto(fd, "restricoes") === "sim";
    const { error } = await supabase.from("analise_consultas").insert({
      analise_id,
      fiador_id,
      documento_consultado: documento,
      bureau: um(BUREAUS, texto(fd, "bureau"), "outro"),
      bureau_nome: texto(fd, "bureau_nome"),
      consultado_em,
      score,
      faixa_risco: texto(fd, "faixa_risco"),
      restricoes,
      restricoes_qtd: restricoes ? naoNegativo(inteiro(fd, "restricoes_qtd"), "A quantidade") : null,
      restricoes_valor: restricoes ? naoNegativo(numero(fd, "restricoes_valor"), "O valor") : null,
      restricoes_descricao: restricoes ? texto(fd, "restricoes_descricao") : null,
      protocolo: texto(fd, "protocolo"),
      base_legal,
      observacoes: texto(fd, "observacoes"),
    });
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Consulta registrada." };
}

/**
 * Consulta automática pelo conector do birô (src/lib/servicos/credito.ts).
 * Sem conector ligado, explica e não grava nada (sem resultado inventado).
 */
export async function consultarCreditoAutomatico(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  try {
    const analise_id = textoObrigatorio(fd, "analise_id");
    const fiador_id = texto(fd, "fiador_id");
    const bureau = um(BUREAUS, texto(fd, "bureau"), "outro");
    const conector = conectorCredito(bureau);
    if (!conector)
      throw new ErroValidacao(
        `A consulta automática ao ${ROTULO_BUREAU[bureau] ?? "birô"} ainda não está ligada (falta o contrato e as credenciais do birô). Consulte no site do birô e use "Registrar consulta".`,
      );
    let pessoa: { nome: string | null; documento: string | null } | null = null;
    let consentimentoEm: string | null = null;
    if (fiador_id) {
      const { data } = await supabase.from("analise_fiadores").select("consentimento_em, pessoa:pessoas(nome, documento)").eq("id", fiador_id).eq("analise_id", analise_id).single();
      const f = data as unknown as { consentimento_em: string | null; pessoa: { nome: string | null; documento: string | null } | null } | null;
      pessoa = f?.pessoa ?? null;
      consentimentoEm = f?.consentimento_em ?? null;
    } else {
      const { data } = await supabase.from("analises").select("consentimento_em, candidato:pessoas!analises_candidato_id_fkey(nome, documento)").eq("id", analise_id).single();
      const a = data as unknown as { consentimento_em: string | null; candidato: { nome: string | null; documento: string | null } | null } | null;
      pessoa = a?.candidato ?? null;
      consentimentoEm = a?.consentimento_em ?? null;
    }
    const base_legal = texto(fd, "base_legal");
    const problema = checarConsultaCredito({ baseLegal: base_legal, documento: pessoa?.documento, consentimentoEm });
    if (problema) throw new ErroValidacao(problema);
    const documento = somenteDigitos(pessoa?.documento ?? "");
    const resposta = await conector.consultar({ documento, nome: pessoa?.nome ?? null, baseLegal: base_legal as "consentimento" | "protecao_credito", referencia: fiador_id ?? analise_id });
    const r = normalizarResultadoCredito(resposta);
    const { error } = await supabase.from("analise_consultas").insert({
      analise_id,
      fiador_id,
      documento_consultado: documento,
      bureau,
      consultado_em: hojeISO(),
      ...r,
      base_legal,
      origem: "integracao",
      resposta: resposta.bruta ?? null,
    });
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Consulta feita e registrada." };
}

export async function excluirConsulta(id: string): Promise<Resultado> {
  const { supabase } = await obterContexto();
  const { error } = await supabase.from("analise_consultas").delete().eq("id", id);
  if (error) return { ok: false, erro: mensagemErro(error) };
  revalidar();
  return { ok: true };
}

// Fiadores ---------------------------------------------------------------------------
export async function adicionarFiador(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  try {
    const analise_id = textoObrigatorio(fd, "analise_id");
    const pessoa_id = textoObrigatorio(fd, "pessoa_id", "o fiador");
    const { data: a } = await supabase.from("analises").select("candidato_id").eq("id", analise_id).single();
    if (a?.candidato_id === pessoa_id) throw new ErroValidacao("O candidato não pode ser fiador dele mesmo.");
    const { data, error } = await supabase
      .from("analise_fiadores")
      .insert({ analise_id, pessoa_id, parentesco: texto(fd, "parentesco") })
      .select("id, pessoa:pessoas(tipo_pessoa, papeis)")
      .single();
    if (error) throw error;
    const p = (data as unknown as { pessoa: { tipo_pessoa: string; papeis: string[] } | null }).pessoa;
    if (p && !p.papeis.includes("fiador")) await supabase.from("pessoas").update({ papeis: [...p.papeis, "fiador"] }).eq("id", pessoa_id);
    const { data: docs } = await supabase.from("analise_documentos").select("item, fiador_id").eq("analise_id", analise_id);
    await inserirChecklist(supabase, analise_id, "fiador", p?.tipo_pessoa, data.id as string, new Set((docs ?? []).map((d) => `${d.fiador_id ?? ""}|${d.item}`)));
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Fiador incluído." };
}

export async function atualizarFiador(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase, papel } = await obterContexto();
  try {
    const id = String(fd.get("id"));
    const d: Record<string, unknown> = {};
    for (const c of ["parentesco", "conjuge_nome", "conjuge_documento", "imovel_descricao", "imovel_matricula", "imovel_cartorio", "parecer"]) if (fd.has(c)) d[c] = texto(fd, c);
    if (fd.has("imovel_valor")) d.imovel_valor = naoNegativo(numero(fd, "imovel_valor"), "O valor do imóvel");
    if (fd.has("outorga_conjuge")) d.outorga_conjuge = marcado(fd, "outorga_conjuge");
    if (fd.has("imovel_onus")) d.imovel_onus = marcado(fd, "imovel_onus");
    if (fd.has("status")) {
      const s = texto(fd, "status");
      const { data: antes } = await supabase.from("analise_fiadores").select("status").eq("id", id).single();
      if (antes && antes.status !== s) {
        if (!papelDecide(papel)) throw new ErroValidacao("Só administrador, gestor ou financeiro aprovam ou reprovam fiador.");
        d.status = s === "aprovado" || s === "reprovado" ? s : "pendente";
      }
    }
    const { error } = await supabase.from("analise_fiadores").update(d).eq("id", id);
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Salvo." };
}

export async function excluirFiador(id: string): Promise<Resultado> {
  const { supabase } = await obterContexto();
  const { error } = await supabase.from("analise_fiadores").delete().eq("id", id);
  if (error) return { ok: false, erro: mensagemErro(error) };
  revalidar();
  return { ok: true };
}

// Garantias propostas ----------------------------------------------------------------------
function camposGarantia(fd: FormData, parcial: boolean) {
  const d: Record<string, unknown> = {};
  const tem = (c: string) => !parcial || fd.has(c);
  for (const c of ["garantidora", "proposta_numero", "apolice_numero", "conta", "observacoes", "resposta", "vigencia_inicio", "vigencia_fim", "solicitada_em", "respondida_em"])
    if (tem(c)) d[c] = texto(fd, c);
  if (tem("fiador_id")) d.fiador_id = texto(fd, "fiador_id");
  if (tem("valor")) d.valor = naoNegativo(numero(fd, "valor"), "O valor");
  if (tem("premio")) d.premio = naoNegativo(numero(fd, "premio"), "O prêmio");
  if (tem("parcelas")) {
    const p = inteiro(fd, "parcelas");
    if (p !== null && (p < 1 || p > 120)) throw new ErroValidacao("Parcelas: de 1 a 120.");
    d.parcelas = p;
  }
  if (tem("status")) {
    const s = um(STATUS_GARANTIA_PROPOSTA, texto(fd, "status"), "proposta");
    if (s === "contratada") throw new ErroValidacao('"Levada ao contrato" é marcado sozinho ao vincular o contrato.');
    d.status = s;
  }
  if (d.vigencia_inicio && d.vigencia_fim && String(d.vigencia_fim) <= String(d.vigencia_inicio)) throw new ErroValidacao("O fim da vigência precisa ser depois do início.");
  return d;
}

export async function adicionarGarantia(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  try {
    const tipo = um(TIPOS_GARANTIA_PROPOSTA, texto(fd, "tipo"), "outro");
    const d = camposGarantia(fd, false);
    if (tipo === "fiador" && !d.fiador_id) throw new ErroValidacao("Escolha o fiador (cadastre na aba Fiadores).");
    const { error } = await supabase.from("analise_garantias").insert({ ...d, analise_id: textoObrigatorio(fd, "analise_id"), tipo });
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Garantia incluída." };
}

export async function atualizarGarantia(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  try {
    const id = String(fd.get("id"));
    const d = camposGarantia(fd, true);
    const { data: antes } = await supabase.from("analise_garantias").select("status").eq("id", id).single();
    if (antes?.status === "contratada") {
      delete d.status;
      if (fd.has("status") && texto(fd, "status") !== "contratada") throw new ErroValidacao("Esta garantia já foi levada ao contrato; mude por lá.");
    }
    const { error } = await supabase.from("analise_garantias").update(d).eq("id", id);
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Salvo." };
}

export async function excluirGarantia(id: string): Promise<Resultado> {
  const { supabase } = await obterContexto();
  const { error } = await supabase.from("analise_garantias").delete().eq("id", id);
  if (error) return { ok: false, erro: mensagemErro(error) };
  revalidar();
  return { ok: true };
}

// Decisão ----------------------------------------------------------------------------
export async function decidirAnalise(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase, papel } = await obterContexto();
  try {
    const id = textoObrigatorio(fd, "id");
    const decisao = texto(fd, "decisao");
    const { data: regras, error: e1 } = await supabase.rpc("analise_checar_regras", { p_id: id });
    if (e1) throw e1;
    const erro = validarDecisao({
      decisao,
      justificativa: texto(fd, "justificativa"),
      condicoes: texto(fd, "condicoes"),
      foraDaRegra: ((regras ?? []) as string[]).length,
      excecaoJustificativa: texto(fd, "excecao_justificativa"),
      papel,
    });
    if (erro) throw new ErroValidacao(erro);
    const { error } = await supabase
      .from("analises")
      .update({
        decisao,
        decisao_justificativa: texto(fd, "justificativa"),
        decisao_condicoes: decisao === "aprovado_condicoes" ? texto(fd, "condicoes") : null,
        excecao_justificativa: texto(fd, "excecao_justificativa"),
      })
      .eq("id", id);
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Decisão registrada." };
}

export async function reabrirAnalise(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase, papel } = await obterContexto();
  try {
    if (!papelAprovaExcecao(papel)) throw new ErroValidacao("Só administradores e gestores reabrem uma análise já decidida.");
    const { error } = await supabase
      .from("analises")
      .update({ decisao: null, reaberta_motivo: textoObrigatorio(fd, "motivo", "o motivo") })
      .eq("id", textoObrigatorio(fd, "id"));
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Análise reaberta." };
}

export async function marcarDesistencia(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  try {
    const { error } = await supabase
      .from("analises")
      .update({ status: "desistencia", desistencia_motivo: texto(fd, "motivo"), ficha_ativa: false })
      .eq("id", textoObrigatorio(fd, "id"));
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Desistência registrada." };
}

export async function retomarAnalise(id: string): Promise<Resultado> {
  const { supabase } = await obterContexto();
  const { error } = await supabase.from("analises").update({ status: "em_analise", desistencia_motivo: null }).eq("id", id);
  if (error) return { ok: false, erro: mensagemErro(error) };
  revalidar();
  return { ok: true };
}

// Contrato ---------------------------------------------------------------------------
/** Liga o contrato criado e leva as garantias aprovadas e os fiadores para ele. */
export async function vincularContrato(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  let n = 0;
  try {
    const { data, error } = await supabase.rpc("levar_garantias_contrato", {
      p_analise: textoObrigatorio(fd, "id"),
      p_contrato: textoObrigatorio(fd, "contrato_id", "o contrato"),
    });
    if (error) throw error;
    n = Number(data ?? 0);
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  revalidatePath("/contratos", "layout");
  return { ok: n ? `Contrato vinculado. ${n} garantia(s) levada(s) para o contrato.` : "Contrato vinculado." };
}

/** Botão "Vincular" do contrato sugerido (chave = "<analise>|<contrato>"). */
export async function vincularContratoSugerido(chave: string): Promise<Resultado> {
  const { supabase } = await obterContexto();
  const [analise, contrato] = chave.split("|");
  if (!analise || !contrato) return { ok: false, erro: "Contrato não encontrado." };
  const { error } = await supabase.rpc("levar_garantias_contrato", { p_analise: analise, p_contrato: contrato });
  if (error) return { ok: false, erro: mensagemErro(error) };
  revalidar();
  revalidatePath("/contratos", "layout");
  return { ok: true };
}

/**
 * Desvincula pela RPC (papel conferido no banco): as garantias levadas ficam
 * encerradas no contrato antigo (com aviso) e voltam a "aprovada" aqui, para
 * irem ao contrato certo no próximo vínculo.
 */
export async function desvincularContrato(id: string): Promise<Resultado> {
  const { supabase, papel } = await obterContexto();
  if (!papelAprovaExcecao(papel)) return { ok: false, erro: "Só administradores e gestores desvinculam o contrato." };
  const { error } = await supabase.rpc("desvincular_contrato_analise", { p_analise: id });
  if (error) return { ok: false, erro: mensagemErro(error) };
  revalidar();
  revalidatePath("/contratos", "layout");
  return { ok: true };
}

// Anotações --------------------------------------------------------------------------
export async function registrarNota(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase, organizacao, usuario } = await obterContexto();
  try {
    const { error } = await supabase.from("analise_eventos").insert({
      organizacao_id: organizacao.id,
      analise_id: textoObrigatorio(fd, "analise_id"),
      tipo: "nota",
      descricao: textoObrigatorio(fd, "descricao", "a anotação"),
      usuario_id: usuario.id,
    });
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Anotação registrada." };
}

// Regras ----------------------------------------------------------------------------
export async function salvarRegras(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase, organizacao, papel } = await obterContexto();
  try {
    if (!papelAprovaExcecao(papel)) throw new ErroValidacao("Só administradores e gestores mudam as regras da análise.");
    const limite = numero(fd, "limite_comprometimento_pct") ?? 30;
    const alerta = numero(fd, "alerta_comprometimento_pct") ?? Math.min(25, limite);
    if (limite < 1 || limite > 100) throw new ErroValidacao("O limite de comprometimento vai de 1% a 100%.");
    if (alerta < 1 || alerta > limite) throw new ErroValidacao("O sinal amarelo precisa ficar entre 1% e o limite.");
    const multiplo = numero(fd, "renda_fiador_multiplo") ?? 3;
    if (multiplo < 0 || multiplo > 20) throw new ErroValidacao("A renda do fiador vai de 0 a 20 vezes o aluguel.");
    const score = inteiro(fd, "score_minimo");
    if (score !== null && (score < 0 || score > 1000)) throw new ErroValidacao("O score mínimo vai de 0 a 1000.");
    const validade = inteiro(fd, "validade_dias") ?? 30;
    const ficha = inteiro(fd, "ficha_dias") ?? 15;
    if (validade < 1 || validade > 365) throw new ErroValidacao("A validade da aprovação vai de 1 a 365 dias.");
    if (ficha < 1 || ficha > 90) throw new ErroValidacao("O link da ficha vale de 1 a 90 dias.");
    const { error } = await supabase.from("analise_config").upsert(
      {
        organizacao_id: organizacao.id,
        limite_comprometimento_pct: limite,
        alerta_comprometimento_pct: alerta,
        renda_fiador_multiplo: multiplo,
        score_minimo: score,
        aceitar_restricoes: marcado(fd, "aceitar_restricoes"),
        exigir_consulta: marcado(fd, "exigir_consulta"),
        exigir_garantia: marcado(fd, "exigir_garantia"),
        validade_dias: validade,
        ficha_dias: ficha,
        bureau_padrao: texto(fd, "bureau_padrao"),
        texto_consentimento: texto(fd, "texto_consentimento"),
      },
      { onConflict: "organizacao_id" },
    );
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Regras salvas." };
}

// Renovação de garantias dos contratos ----------------------------------------------------------
function alvoRenovacao(fd: FormData) {
  const objeto = texto(fd, "objeto") === "seguro_incendio" ? "seguro_incendio" : "garantia";
  return {
    objeto,
    contrato_id: textoObrigatorio(fd, "contrato_id"),
    contrato_garantia_id: objeto === "garantia" ? textoObrigatorio(fd, "contrato_garantia_id") : null,
  };
}

export async function solicitarRenovacao(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  try {
    const { error } = await supabase.from("garantia_renovacoes").insert({
      ...alvoRenovacao(fd),
      canal: um(Object.keys(CANAIS_RENOVACAO), texto(fd, "canal"), "whatsapp"),
      destinatario: um(Object.keys(DESTINATARIOS_RENOVACAO), texto(fd, "destinatario"), "seguradora"),
      destinatario_nome: texto(fd, "destinatario_nome"),
      solicitada_em: texto(fd, "solicitada_em") ?? hojeISO(),
      observacoes: texto(fd, "observacoes"),
    });
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Solicitação registrada." };
}

/** Registra a renovação (com ou sem solicitação antes): novo vencimento, nº e valor. */
export async function concluirRenovacao(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  try {
    const id = texto(fd, "renovacao_id");
    const dados = {
      nova_fim: textoObrigatorio(fd, "nova_fim", "o novo vencimento"),
      numero: texto(fd, "numero"),
      valor: texto(fd, "valor"),
      premio: texto(fd, "premio"),
      observacoes: texto(fd, "observacoes"),
    };
    // Sem pedido antes: cria e conclui numa transação só (falhou = nada gravado, nem na auditoria).
    const { error } = id
      ? await supabase.rpc("concluir_renovacao_garantia", { p_id: id, p: dados })
      : await supabase.rpc("registrar_renovacao_garantia", { p: { ...alvoRenovacao(fd), ...dados } });
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  revalidatePath("/contratos", "layout");
  return { ok: "Renovação registrada." };
}

async function encerrarRenovacao(id: string, status: "cancelada" | "recusada"): Promise<Resultado> {
  const { supabase } = await obterContexto();
  const { error } = await supabase.from("garantia_renovacoes").update({ status }).eq("id", id);
  if (error) return { ok: false, erro: mensagemErro(error) };
  revalidar();
  return { ok: true };
}
export async function cancelarRenovacao(id: string) {
  return encerrarRenovacao(id, "cancelada");
}
export async function recusarRenovacao(id: string) {
  return encerrarRenovacao(id, "recusada");
}

export async function excluirRenovacao(id: string): Promise<Resultado> {
  const { supabase } = await obterContexto();
  const { error } = await supabase.from("garantia_renovacoes").delete().eq("id", id);
  if (error) return { ok: false, erro: mensagemErro(error) };
  revalidar();
  return { ok: true };
}
