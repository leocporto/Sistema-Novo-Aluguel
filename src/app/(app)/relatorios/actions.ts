"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  FONTES_BI,
  FORMATOS,
  FREQUENCIAS,
  PERIODOS_AGENDADOS,
  campoDaFonte,
  colunasPadrao,
  ehFonte,
  ehRelatorioPadrao,
  fontesDoModo,
  fontesPermitidas,
  moduloDaFonte,
  normalizarNumeroFiltro,
  padroesDoModo,
  separarDestinatarios,
  validarDefinicao,
  type CampoFonte,
  type DefinicaoRelatorio,
  type FiltroRelatorio,
  type FonteBI,
} from "@/lib/dominio/bi";
import { type EstadoAcao, ErroValidacao, inteiro, mensagemErro, texto, textoObrigatorio } from "@/lib/form";
import { mensagemSemPermissao } from "@/lib/dominio/equipe";
import { exigirPermissao } from "@/lib/permissoes";
import { contextoRelatorios } from "./dados";
import { apagarArquivos, processarAgendamentos } from "./executar";

type Resultado = { ok: boolean; erro?: string };

function revalidar() {
  revalidatePath("/relatorios", "layout");
}

/** Quem cria/edita relatórios personalizados (o banco confere de novo: privado.bi_pode_editar). */
async function paraEditar() {
  await exigirPermissao("relatorios", "ver");
  const c = await contextoRelatorios();
  if (!c.bi.editar) throw new ErroValidacao("Seu perfil de acesso não permite criar ou editar relatórios personalizados. Fale com o administrador.");
  return c;
}

/** Quem programa envios (o banco confere de novo: privado.bi_pode_agendar). */
async function paraAgendar() {
  await exigirPermissao("relatorios", "ver");
  const c = await contextoRelatorios();
  if (!c.bi.agendar) throw new ErroValidacao("Seu perfil de acesso não permite programar envios de relatórios. Fale com o administrador.");
  return c;
}

const idValido = (id: string) => /^[0-9a-f-]{36}$/i.test(id);

// ---------------------------------------------------------------------------
// Relatórios personalizados
// ---------------------------------------------------------------------------

export async function criarRelatorio(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  let id: string;
  try {
    const { supabase, imob, perms } = await paraEditar();
    const nome = textoObrigatorio(fd, "nome", "o nome do relatório");
    const fonte = texto(fd, "fonte");
    if (!ehFonte(fonte) || !fontesDoModo(imob).includes(fonte)) throw new ErroValidacao("Escolha de onde vêm os dados.");
    // O perfil precisa ver o módulo de onde vêm os dados (o banco confere de novo: privado.bi_pode_fonte).
    if (!fontesPermitidas(imob, perms).includes(fonte)) throw new ErroValidacao(mensagemSemPermissao(moduloDaFonte(fonte), "ver"));
    const { data, error } = await supabase
      .from("relatorios_salvos")
      .insert({ nome, descricao: texto(fd, "descricao"), fonte, colunas: colunasPadrao(fonte, imob) })
      .select("id")
      .single();
    if (error) throw error;
    id = data.id as string;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  redirect(`/relatorios/personalizados/${id}`);
}

/** Lê os filtros do formulário (linhas f_campo_N / f_op_N / f_valor_N); linha sem valor ainda não vale. */
function filtrosDoFormulario(fd: FormData, fonte: FonteBI): FiltroRelatorio[] {
  const n = Math.min(10, Math.max(0, inteiro(fd, "f_n") ?? 0));
  const out: FiltroRelatorio[] = [];
  for (let i = 0; i < n; i++) {
    const campo = texto(fd, `f_campo_${i}`);
    const op = texto(fd, `f_op_${i}`);
    if (!campo || !op) continue;
    const c = campoDaFonte(fonte, campo);
    if (!c) continue;
    let valor = texto(fd, `f_valor_${i}`);
    if (["vazio", "preenchido", "este_mes", "mes_passado", "este_ano"].includes(op)) valor = null;
    else if (!valor) continue;
    else if ((c.tipo === "dinheiro" || c.tipo === "numero" || c.tipo === "inteiro") && op !== "ultimos_dias") valor = normalizarNumeroFiltro(valor);
    out.push({ campo, op, valor });
  }
  return out;
}

export async function salvarRelatorio(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  try {
    const { supabase, imob, perms } = await paraEditar();
    const id = textoObrigatorio(fd, "id");
    if (!idValido(id)) throw new ErroValidacao("Relatório não encontrado.");
    const { data: atual } = await supabase.from("relatorios_salvos").select("fonte").eq("id", id).maybeSingle();
    if (!atual || !ehFonte(atual.fonte)) throw new ErroValidacao("Relatório não encontrado.");
    const fonte = atual.fonte as FonteBI;
    if (!fontesPermitidas(imob, perms).includes(fonte)) throw new ErroValidacao(mensagemSemPermissao(moduloDaFonte(fonte), "ver"));
    const campos = (FONTES_BI[fonte].campos as CampoFonte[]).filter((c) => imob || !c.soImobiliaria);
    const marcadas = new Set(fd.getAll("colunas").map(String));
    const colunas = campos.filter((c) => marcadas.has(c.id)).map((c) => c.id);
    const agrupar = texto(fd, "agrupar_por");
    const totaisMarcados = new Set(fd.getAll("totais").map(String));
    const totais = campos.filter((c) => totaisMarcados.has(c.id) && (c.tipo === "dinheiro" || c.tipo === "numero" || c.tipo === "inteiro")).map((c) => c.id);
    const def: DefinicaoRelatorio = {
      fonte,
      colunas,
      filtros: filtrosDoFormulario(fd, fonte),
      agrupar_por: agrupar && campos.some((c) => c.id === agrupar) ? agrupar : null,
      totais,
      ordenar_por: texto(fd, "ordenar_por"),
      ordem: texto(fd, "ordem") === "desc" ? "desc" : "asc",
    };
    // Ordenação que não cabe mais na definição (coluna desmarcada, agrupamento mudou) volta ao padrão.
    const ok = def.agrupar_por ? [def.agrupar_por, "quantidade", ...totais] : colunas;
    if (def.ordenar_por && !ok.includes(def.ordenar_por)) def.ordenar_por = null;
    const erro = validarDefinicao(def, imob);
    if (erro) throw new ErroValidacao(erro);
    const limite = Math.min(10000, Math.max(1, inteiro(fd, "limite") ?? 500));
    const { error } = await supabase
      .from("relatorios_salvos")
      .update({
        nome: textoObrigatorio(fd, "nome", "o nome do relatório"),
        descricao: texto(fd, "descricao"),
        colunas: def.colunas,
        filtros: def.filtros,
        agrupar_por: def.agrupar_por,
        totais: def.totais,
        ordenar_por: def.ordenar_por,
        ordem: def.ordem,
        limite,
      })
      .eq("id", id);
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Salvo" };
}

export async function excluirRelatorio(id: string): Promise<Resultado> {
  try {
    const { supabase } = await paraEditar();
    if (!idValido(id)) throw new ErroValidacao("Relatório não encontrado.");
    const { error } = await supabase.from("relatorios_salvos").delete().eq("id", id);
    if (error) throw error;
  } catch (e) {
    return { ok: false, erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: true };
}

export async function duplicarRelatorio(id: string): Promise<Resultado> {
  let novo: string;
  try {
    const { supabase } = await paraEditar();
    if (!idValido(id)) throw new ErroValidacao("Relatório não encontrado.");
    const { data: r } = await supabase.from("relatorios_salvos").select("nome, descricao, fonte, colunas, filtros, agrupar_por, totais, ordenar_por, ordem, limite").eq("id", id).maybeSingle();
    if (!r) throw new ErroValidacao("Relatório não encontrado.");
    const { data, error } = await supabase
      .from("relatorios_salvos")
      .insert({ ...r, nome: `${String(r.nome).slice(0, 110)} (cópia)` })
      .select("id")
      .single();
    if (error) throw error;
    novo = data.id as string;
  } catch (e) {
    return { ok: false, erro: mensagemErro(e) };
  }
  revalidar();
  redirect(`/relatorios/personalizados/${novo}`);
}

// ---------------------------------------------------------------------------
// Envios programados
// ---------------------------------------------------------------------------

/** Campos do agendamento vindos do formulário (relatório, quando, formato e para quem). */
function agendamentoDoFormulario(fd: FormData, imob: boolean) {
  const rel = texto(fd, "relatorio") ?? "";
  let relatorio_id: string | null = null;
  let padrao: string | null = null;
  if (rel.startsWith("salvo:") && idValido(rel.slice(6))) relatorio_id = rel.slice(6);
  else if (rel.startsWith("padrao:") && ehRelatorioPadrao(rel.slice(7)) && padroesDoModo(imob).some((p) => p === rel.slice(7))) padrao = rel.slice(7);
  else throw new ErroValidacao("Escolha o relatório que será enviado.");
  const frequencia = texto(fd, "frequencia") ?? "mensal";
  if (!(FREQUENCIAS as readonly string[]).includes(frequencia)) throw new ErroValidacao("Escolha a frequência.");
  const periodo = texto(fd, "periodo") ?? "mes_anterior";
  if (!(PERIODOS_AGENDADOS as readonly string[]).includes(periodo)) throw new ErroValidacao("Escolha o período.");
  const formato = texto(fd, "formato") ?? "csv";
  if (!(FORMATOS as readonly string[]).includes(formato)) throw new ErroValidacao("Escolha o formato.");
  const hora = inteiro(fd, "hora") ?? 8;
  if (hora < 0 || hora > 23) throw new ErroValidacao("Hora inválida.");
  const diaSemana = inteiro(fd, "dia_semana");
  const diaMes = inteiro(fd, "dia_mes");
  if (diaSemana !== null && (diaSemana < 0 || diaSemana > 6)) throw new ErroValidacao("Dia da semana inválido.");
  if (diaMes !== null && (diaMes < 1 || diaMes > 28)) throw new ErroValidacao("Escolha um dia do mês de 1 a 28.");
  const dest = separarDestinatarios(texto(fd, "destinatarios"));
  if (dest.invalidos.length) throw new ErroValidacao(`Não reconheci como e-mail ou WhatsApp: ${dest.invalidos.slice(0, 3).join(", ")}.`);
  if (dest.emails.length > 20 || dest.whatsapps.length > 20) throw new ErroValidacao("No máximo 20 e-mails e 20 WhatsApps por envio.");
  return {
    nome: textoObrigatorio(fd, "nome", "o nome do envio"),
    relatorio_id,
    padrao,
    periodo,
    frequencia,
    dia_semana: frequencia === "semanal" ? (diaSemana ?? 1) : null,
    dia_mes: frequencia === "mensal" ? (diaMes ?? 1) : null,
    hora,
    formato,
    emails: dest.emails,
    whatsapps: dest.whatsapps,
    ativo: fd.getAll("ativo").includes("on"),
  };
}

export async function criarAgendamento(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  let id: string;
  try {
    const { supabase, imob } = await paraAgendar();
    const { data, error } = await supabase.from("relatorio_agendamentos").insert(agendamentoDoFormulario(fd, imob)).select("id").single();
    if (error) throw error;
    id = data.id as string;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  redirect(`/relatorios/agendados/${id}`);
}

export async function salvarAgendamento(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  try {
    const { supabase, imob } = await paraAgendar();
    const id = textoObrigatorio(fd, "id");
    if (!idValido(id)) throw new ErroValidacao("Envio não encontrado.");
    const { error } = await supabase.from("relatorio_agendamentos").update(agendamentoDoFormulario(fd, imob)).eq("id", id);
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Salvo" };
}

/** Excluir o envio apaga também os arquivos que ele gerou (LGPD); o histórico (sem os arquivos) fica. */
export async function excluirAgendamento(id: string): Promise<Resultado> {
  try {
    const { supabase } = await paraAgendar();
    if (!idValido(id)) throw new ErroValidacao("Envio não encontrado.");
    const { data: execs } = await supabase
      .from("relatorio_execucoes")
      .select("id, arquivo_path")
      .eq("agendamento_id", id)
      .not("arquivo_path", "is", null)
      .is("arquivo_apagado_em", null)
      .limit(500);
    await apagarArquivos(supabase, (execs ?? []) as { id: string; arquivo_path: string | null }[]);
    const { error } = await supabase.from("relatorio_agendamentos").delete().eq("id", id);
    if (error) throw error;
  } catch (e) {
    return { ok: false, erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: true };
}

/** Apaga o arquivo de um envio já gerado (antes do prazo de guarda). O registro do envio fica. */
export async function apagarArquivoExecucao(id: string): Promise<Resultado> {
  try {
    const { supabase } = await paraAgendar();
    if (!idValido(id)) throw new ErroValidacao("Envio não encontrado.");
    const { data } = await supabase.from("relatorio_execucoes").select("id, arquivo_path, arquivo_apagado_em").eq("id", id).maybeSingle();
    if (!data?.arquivo_path || data.arquivo_apagado_em) throw new ErroValidacao("Este envio não tem arquivo guardado.");
    const n = await apagarArquivos(supabase, [{ id: data.id as string, arquivo_path: data.arquivo_path as string }]);
    if (!n) throw new ErroValidacao("Não foi possível apagar o arquivo. Tente de novo.");
  } catch (e) {
    return { ok: false, erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: true };
}

/** "Rodar agora": gera o arquivo e envia (ou deixa pronto para enviar) na hora. */
export async function rodarAgendamento(id: string): Promise<Resultado> {
  try {
    const ctx = await paraAgendar();
    if (!idValido(id)) throw new ErroValidacao("Envio não encontrado.");
    const r = await processarAgendamentos(ctx, { id });
    if (r.gerados + r.erros === 0) throw new ErroValidacao("Envio não encontrado.");
    if (r.erros) throw new ErroValidacao("Não foi possível gerar o relatório. Veja o motivo no histórico de envios.");
  } catch (e) {
    revalidar();
    return { ok: false, erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: true };
}
