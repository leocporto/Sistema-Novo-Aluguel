"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { obterContexto } from "@/lib/contexto";
import { type EstadoAcao, ErroValidacao, inteiro, mensagemErro, numero, texto, textoObrigatorio } from "@/lib/form";
import { instante } from "@/lib/dominio/agenda";
import { formatarDataBR, hojeISO } from "@/lib/dominio/datas";
import { formatarReais } from "@/lib/dominio/dinheiro";
import {
  ESTADOS_ITEM,
  ROTULO_ESTADO,
  ROTULO_RESPONSAVEL,
  ROTULO_STATUS_VISTORIA,
  ROTULO_TIPO_VISTORIA,
  TIPOS_AMBIENTE,
  TIPOS_MEDIDOR,
  TIPOS_VISTORIA,
  UUID_RE,
  ambientesSugeridos,
  chaveOp,
  checklistDoAmbiente,
  custoDoReparo,
  compararVistorias,
  prazoContestacao,
  proximosStatus,
  responsaveisDoModo,
  textoLaudo,
  vinculosDaFoto,
  vistoriaEditavel,
  type OpCampo,
  type RecusaCampo,
  type TipoRecusa,
} from "@/lib/dominio/vistorias";
import { carregarAmbientes, carregarVistoria, partesDaVistoria, quemFez } from "./dados";
import { dadosDoLaudo } from "./laudo";

type Supabase = Awaited<ReturnType<typeof obterContexto>>["supabase"];
type Resultado = { ok: boolean; erro?: string };

/** Quem pode aprovar orçamento, levar reparos ao acerto e responder contestação. */
const podeDecidir = (papel: string) => papel === "admin" || papel === "gestor" || papel === "financeiro";

function revalidar(extra: string[] = []) {
  revalidatePath("/vistorias", "layout");
  revalidatePath("/");
  for (const r of extra) revalidatePath(r, "layout");
}

async function evento(supabase: Supabase, vistoriaId: string, tipo: string, descricao: string) {
  await supabase.from("vistoria_eventos").insert({ vistoria_id: vistoriaId, tipo, descricao });
}

const novoId = () => crypto.randomUUID();

/**
 * Leva para o Financeiro o custo do reparo resolvido por conta do proprietário
 * ou da imobiliária (regra em `custoDoReparo`): conta a pagar ao prestador do
 * orçamento aprovado, ligada à pendência; a do proprietário é descontada do
 * repasse. Se a pendência volta a ficar aberta, muda de responsável ou o
 * orçamento muda, a conta ainda em aberto é cancelada (e refeita, se for o caso).
 * Devolve um aviso para mostrar na tela.
 */
async function sincronizarCustoReparo(supabase: Supabase, pendenciaId: string, modo: "imobiliaria" | "pessoal"): Promise<string | null> {
  const { data: p } = await supabase
    .from("vistoria_pendencias")
    .select("id, status, responsavel, descricao, valor_estimado, vistoria:vistorias(id, numero, imovel_id, contrato_id, imovel:imoveis(codigo)), vistoria_orcamentos(valor, aprovado, prestador_id)")
    .eq("id", pendenciaId)
    .maybeSingle();
  if (!p) return null;
  const vist = p.vistoria as unknown as { id: string; numero: number; imovel_id: string; contrato_id: string | null; imovel: { codigo: string } | null } | null;
  const orc = ((p.vistoria_orcamentos ?? []) as { valor: number; aprovado: boolean; prestador_id: string | null }[]).find((o) => o.aprovado);
  const plano = custoDoReparo({
    status: p.status as string,
    responsavel: p.responsavel as string,
    valorAprovado: orc?.valor ?? null,
    valorEstimado: p.valor_estimado as number | null,
    modo,
    descricao: `${p.descricao}${vist?.imovel?.codigo ? ` (${vist.imovel.codigo})` : ""}`,
  });
  const { data: atuais } = await supabase.from("lancamentos").select("id, valor, status, descontar_repasse").eq("vistoria_pendencia_id", pendenciaId).neq("status", "cancelado");
  const existentes = (atuais ?? []) as { id: string; valor: number; status: string; descontar_repasse: boolean }[];
  const desejado = plano?.pagar ?? [];
  const igual =
    existentes.length === desejado.length &&
    desejado.every((d) => existentes.some((e) => Math.round(Number(e.valor) * 100) === Math.round(d.valor * 100) && e.descontar_repasse === d.descontarRepasse));
  if (igual) return null;
  // Algo mudou: cancela o que ainda está em aberto (pago não se mexe).
  const pagos = existentes.filter((e) => e.status !== "aberto");
  if (pagos.length) return "O custo deste reparo já foi pago no Financeiro: ajuste por lá, se precisar.";
  if (existentes.length) {
    const { error } = await supabase
      .from("lancamentos")
      .update({ status: "cancelado", cancelado_motivo: "Reparo da vistoria alterado ou reaberto" })
      .in("id", existentes.map((e) => e.id));
    if (error) throw error;
  }
  if (!plano || !desejado.length || !vist) return existentes.length ? "A conta deste reparo no Financeiro foi cancelada." : null;
  const { data: planoConta } = await supabase.from("plano_contas").select("id").eq("tipo", "despesa").eq("ativo", true).ilike("nome", "%manuten%").limit(1).maybeSingle();
  const hoje = hojeISO();
  const { error } = await supabase.from("lancamentos").insert(
    desejado.map((l) => ({
      tipo: "pagar",
      descricao: `${l.descricao} · vistoria #${vist.numero}`,
      categoria: "Manutenção",
      valor: l.valor,
      vencimento: hoje,
      status: "aberto",
      pessoa_id: orc?.prestador_id ?? null,
      imovel_id: vist.imovel_id,
      contrato_id: vist.contrato_id,
      vistoria_pendencia_id: pendenciaId,
      descontar_repasse: l.descontarRepasse,
      // Despesa do proprietário paga pela imobiliária e descontada no repasse: dinheiro de terceiros (fora do resultado).
      terceiros: l.descontarRepasse,
      plano_id: l.descontarRepasse ? null : ((planoConta?.id as string | undefined) ?? null),
    })),
  );
  if (error) throw error;
  await evento(supabase, vist.id, "orcamento", `Custo do reparo "${p.descricao}" lançado no Financeiro: ${formatarReais(plano.total)}`);
  return `${formatarReais(plano.total)} lançado em contas a pagar.${plano.avisos.length ? " " + plano.avisos.join(" ") : ""}`;
}

/** Cria ambientes com os itens do checklist (ids gerados aqui para não depender da ordem de retorno). */
async function criarAmbientes(supabase: Supabase, vistoriaId: string, lista: { nome: string; tipo: string; itens: string[] }[], ordemInicial = 0) {
  if (!lista.length) return;
  const ambientes = lista.map((a, i) => ({ id: novoId(), vistoria_id: vistoriaId, nome: a.nome, tipo: a.tipo, ordem: ordemInicial + i }));
  const { error } = await supabase.from("vistoria_ambientes").insert(ambientes);
  if (error) throw error;
  const itens = lista.flatMap((a, i) => a.itens.map((nome, k) => ({ ambiente_id: ambientes[i].id, vistoria_id: vistoriaId, nome, ordem: k })));
  if (itens.length) {
    const { error: e2 } = await supabase.from("vistoria_itens").insert(itens);
    if (e2) throw e2;
  }
}

/** Ambientes da vistoria de referência (mesmos nomes e itens, sem o estado). */
async function copiarDaReferencia(supabase: Supabase, vistoriaId: string, referenciaId: string, ordemInicial = 0) {
  const antes = await carregarAmbientes(supabase, referenciaId);
  await criarAmbientes(
    supabase,
    vistoriaId,
    antes.map((a) => ({ nome: a.nome, tipo: a.tipo, itens: a.vistoria_itens.map((i) => i.nome) })),
    ordemInicial,
  );
  return antes.length;
}

/** Última vistoria terminada do imóvel (para comparar); na saída, prefere a de entrada do mesmo contrato. */
async function acharReferencia(supabase: Supabase, imovelId: string, contratoId: string | null, tipo: string, ignorar?: string) {
  let q = supabase.from("vistorias").select("id, tipo, contrato_id").eq("imovel_id", imovelId).in("status", ["concluida", "assinada", "contestada"]).order("data", { ascending: false }).limit(20);
  if (ignorar) q = q.neq("id", ignorar);
  const { data } = await q;
  const lista = (data ?? []) as { id: string; tipo: string; contrato_id: string | null }[];
  if (tipo === "saida") return (lista.find((x) => x.tipo === "entrada" && contratoId && x.contrato_id === contratoId) ?? lista.find((x) => x.tipo === "entrada") ?? lista[0])?.id ?? null;
  return lista[0]?.id ?? null;
}

/**
 * Checklist, medidores, fotos e vídeos só mudam enquanto a vistoria está
 * agendada ou em andamento: depois de concluída (e assinada) eles são o que
 * vai no laudo. Para corrigir, a pessoa reabre a vistoria no Resumo.
 */
async function exigirEditavel(supabase: Supabase, vistoriaId: string | null | undefined) {
  if (!vistoriaId) throw new ErroValidacao("Vistoria não encontrada.");
  const { data } = await supabase.from("vistorias").select("status").eq("id", vistoriaId).single();
  if (!data) throw new ErroValidacao("Vistoria não encontrada.");
  if (!vistoriaEditavel(data.status))
    throw new ErroValidacao(`A vistoria está “${ROTULO_STATUS_VISTORIA[data.status] ?? data.status}”: o checklist, os medidores e as fotos ficam travados. Use “Reabrir” no Resumo para corrigir.`);
}

// Vistoria ------------------------------------------------------------------------
export async function criarVistoria(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase, organizacao } = await obterContexto();
  const pessoal = organizacao.modo === "pessoal";
  let id: string;
  try {
    const tipo = texto(fd, "tipo") ?? "entrada";
    if (!(TIPOS_VISTORIA as readonly string[]).includes(tipo)) throw new ErroValidacao("Tipo de vistoria inválido.");
    const contrato_id = texto(fd, "contrato_id");
    let imovel_id = texto(fd, "imovel_id");
    if (contrato_id) {
      const { data: c } = await supabase.from("contratos").select("imovel_id").eq("id", contrato_id).single();
      if (!c) throw new ErroValidacao("Contrato não encontrado.");
      if (imovel_id && imovel_id !== c.imovel_id) throw new ErroValidacao("O contrato escolhido é de outro imóvel.");
      imovel_id = c.imovel_id as string;
    }
    if (!imovel_id) throw new ErroValidacao("Escolha o imóvel (ou o contrato).");
    const data = texto(fd, "data") ?? hojeISO();
    const { data: im } = await supabase.from("imoveis").select("codigo, tipo, quartos, banheiros, vagas").eq("id", imovel_id).single();
    if (!im) throw new ErroValidacao("Imóvel não encontrado.");

    const referencia_id = tipo === "entrada" ? null : await acharReferencia(supabase, imovel_id, contrato_id, tipo);
    let desocupacao_id: string | null = null;
    if (tipo === "saida" && contrato_id) {
      const { data: d } = await supabase.from("contrato_desocupacoes").select("id").eq("contrato_id", contrato_id).maybeSingle();
      desocupacao_id = d?.id ?? null;
    }
    const { data: v, error } = await supabase
      .from("vistorias")
      .insert({
        tipo,
        imovel_id,
        contrato_id,
        desocupacao_id,
        referencia_id,
        data,
        responsavel_id: pessoal ? null : texto(fd, "responsavel_id"),
        responsavel_nome: texto(fd, "responsavel_nome") ?? (pessoal ? organizacao.nome : null),
        acompanhante: texto(fd, "acompanhante"),
        observacoes: texto(fd, "observacoes"),
        contestacao_dias: Math.min(90, Math.max(0, inteiro(fd, "contestacao_dias") ?? 10)),
      })
      .select("id, numero")
      .single();
    if (error) throw error;
    id = v.id;

    const escolha = texto(fd, "modelo") ?? "auto";
    const modelo = escolha === "auto" ? (referencia_id ? "referencia" : "imovel") : escolha;
    if (modelo === "referencia" && referencia_id) await copiarDaReferencia(supabase, id, referencia_id);
    else if (modelo !== "vazio") await criarAmbientes(supabase, id, ambientesSugeridos(im).map((a) => ({ ...a, itens: checklistDoAmbiente(a.tipo) })));

    await evento(supabase, id, "criada", `Vistoria de ${ROTULO_TIPO_VISTORIA[tipo].toLowerCase()} criada para ${formatarDataBR(data)}`);

    if (fd.getAll("agendar").includes("on")) {
      const { locatarios } = await partesDaVistoria(supabase, { contrato_id, imovel_id });
      const { data: vis, error: ev } = await supabase
        .from("visitas")
        .insert({
          tipo: "vistoria",
          titulo: `Vistoria de ${ROTULO_TIPO_VISTORIA[tipo].toLowerCase()} — ${im.codigo}`,
          data_hora: instante(data, texto(fd, "hora") ?? "09:00"),
          duracao_min: 90,
          imovel_id,
          pessoa_id: locatarios[0]?.id ?? null,
          observacoes: `Vistoria nº ${v.numero}`,
        })
        .select("id")
        .single();
      if (ev) throw ev;
      await supabase.from("visita_eventos").insert({ visita_id: vis.id, tipo: "criada", descricao: `Vistoria nº ${v.numero} marcada pela tela de vistorias` });
      await supabase.from("vistorias").update({ visita_id: vis.id }).eq("id", id);
    }
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar(["/agenda", "/imoveis"]);
  redirect(`/vistorias/${id}`);
}

/** Salva sozinho os dados da vistoria (cada quadro manda a sua parte). */
export async function atualizarVistoria(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase, organizacao } = await obterContexto();
  const id = String(fd.get("id"));
  try {
    const d: Record<string, unknown> = { updated_at: new Date().toISOString() };
    for (const c of ["responsavel_nome", "acompanhante", "observacoes", "conclusao"]) if (fd.has(c)) d[c] = texto(fd, c);
    if (fd.has("data")) d.data = textoObrigatorio(fd, "data", "a data");
    if (fd.has("responsavel_id") && organizacao.modo !== "pessoal") d.responsavel_id = texto(fd, "responsavel_id");
    if (fd.has("tipo")) {
      const t = texto(fd, "tipo") ?? "entrada";
      if ((TIPOS_VISTORIA as readonly string[]).includes(t)) d.tipo = t;
    }
    if (fd.has("referencia_id")) {
      const r = texto(fd, "referencia_id");
      if (r === id) throw new ErroValidacao("A vistoria não pode ser comparada com ela mesma.");
      d.referencia_id = r;
    }
    if (fd.has("contestacao_dias")) d.contestacao_dias = Math.min(90, Math.max(0, inteiro(fd, "contestacao_dias") ?? 10));
    if (fd.has("contestacao_ate")) d.contestacao_ate = texto(fd, "contestacao_ate");
    if (fd.has("contrato_id")) {
      const c = texto(fd, "contrato_id");
      d.contrato_id = c;
      if (c) {
        const [{ data: ct }, { data: v }] = await Promise.all([
          supabase.from("contratos").select("imovel_id").eq("id", c).single(),
          supabase.from("vistorias").select("imovel_id, tipo").eq("id", id).single(),
        ]);
        if (ct && v && ct.imovel_id !== v.imovel_id) throw new ErroValidacao("O contrato escolhido é de outro imóvel.");
        const { data: des } = await supabase.from("contrato_desocupacoes").select("id").eq("contrato_id", c).maybeSingle();
        d.desocupacao_id = des?.id ?? null;
      } else d.desocupacao_id = null;
    }
    const { error } = await supabase.from("vistorias").update(d).eq("id", id);
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Salvo." };
}

async function mudarStatus(id: string, para: string): Promise<Resultado> {
  const { supabase, papel } = await obterContexto();
  try {
    const { data: v } = await supabase.from("vistorias").select("status, contestacao_dias, contestacao_ate, visita_id, documento_id, iniciada_em, assinada_em").eq("id", id).single();
    if (!v) throw new ErroValidacao("Vistoria não encontrada.");
    if (!(proximosStatus(v.status) as string[]).includes(para)) throw new ErroValidacao(`Não dá para passar de “${ROTULO_STATUS_VISTORIA[v.status]}” para “${ROTULO_STATUS_VISTORIA[para]}”.`);
    const agora = new Date().toISOString();
    const d: Record<string, unknown> = { status: para, updated_at: agora };
    let descricao = `${ROTULO_STATUS_VISTORIA[v.status]} → ${ROTULO_STATUS_VISTORIA[para]}`;
    if (para === "em_andamento") {
      d.iniciada_em = v.iniciada_em ?? agora;
      if (v.status !== "rascunho") {
        // Reabrir um laudo já assinado é decisão de quem responde pela vistoria.
        if ((v.status === "assinada" || v.assinada_em) && !podeDecidir(papel)) throw new ErroValidacao("Só administrador, gestor ou financeiro reabrem uma vistoria com laudo assinado.");
        descricao = "Vistoria reaberta para correção";
        // O laudo antigo deixa de valer para a versão corrigida: sai da vistoria
        // (para gerar um novo) e, se ainda não foi assinado, é cancelado.
        d.assinada_em = null;
        d.documento_id = null;
        if (v.documento_id) {
          const { data: doc } = await supabase.from("documentos").select("status, numero").eq("id", v.documento_id).maybeSingle();
          if (doc && doc.status !== "assinado") {
            await supabase.from("documentos").update({ status: "cancelado" }).eq("id", v.documento_id);
            await supabase.from("documento_eventos").insert({ documento_id: v.documento_id, tipo: "cancelado", descricao: "Cancelado: a vistoria foi reaberta para correção" });
            descricao += " (o laudo enviado para assinatura foi cancelado)";
          } else if (doc) {
            await supabase.from("documento_eventos").insert({ documento_id: v.documento_id, tipo: "nota", descricao: "A vistoria foi reaberta para correção: este laudo assinado fica como histórico e um laudo novo será gerado" });
            descricao += ` (o laudo assinado, documento nº ${doc.numero}, continua em Documentos como histórico; depois de corrigir, gere um laudo novo para assinatura)`;
          }
        } else if (v.status === "assinada") descricao += " (a assinatura em papel vale só para a versão anterior; colha de novo depois de corrigir)";
      }
    }
    if (para === "concluida") {
      d.concluida_em = agora;
      // Prazo de contestação conta da (última) conclusão; uma data maior escolhida à mão continua valendo.
      const prazo = prazoContestacao(hojeISO(), v.contestacao_dias);
      d.contestacao_ate = v.contestacao_ate && v.contestacao_ate > prazo ? v.contestacao_ate : prazo;
      if (v.visita_id) await supabase.from("visitas").update({ status: "realizada" }).eq("id", v.visita_id).eq("status", "agendada");
    }
    if (para === "assinada") {
      d.assinada_em = agora;
      descricao = "Marcada como assinada (assinatura em papel)";
    }
    const { error } = await supabase.from("vistorias").update(d).eq("id", id);
    if (error) throw error;
    await evento(supabase, id, para, descricao);
    // Concluída de novo com contestação ainda sem resposta: continua "contestada".
    if (para === "concluida") await recalcularContestada(supabase, id);
  } catch (e) {
    return { ok: false, erro: mensagemErro(e) };
  }
  revalidar(["/agenda", "/documentos"]);
  return { ok: true };
}

export async function iniciarVistoria(id: string) {
  return mudarStatus(id, "em_andamento");
}
export async function concluirVistoria(id: string) {
  return mudarStatus(id, "concluida");
}
export async function reabrirVistoria(id: string) {
  return mudarStatus(id, "em_andamento");
}
export async function marcarAssinadaPapel(id: string) {
  return mudarStatus(id, "assinada");
}

/** Exclui a vistoria com tudo (fotos do bucket inclusive). O laudo gerado continua em Documentos. */
export async function excluirVistoria(id: string): Promise<Resultado> {
  const { supabase } = await obterContexto();
  const [{ data: m }, { data: c }] = await Promise.all([
    supabase.from("vistoria_midias").select("path").eq("vistoria_id", id),
    supabase.from("vistoria_contestacoes").select("fotos").eq("vistoria_id", id),
  ]);
  const caminhos = [...(m ?? []).map((x) => x.path as string), ...(c ?? []).flatMap((x) => (x.fotos ?? []) as string[])];
  const { error } = await supabase.from("vistorias").delete().eq("id", id);
  if (error) return { ok: false, erro: mensagemErro(error) };
  for (let i = 0; i < caminhos.length; i += 100) await supabase.storage.from("vistorias").remove(caminhos.slice(i, i + 100));
  revalidar(["/imoveis"]);
  return { ok: true };
}

export async function registrarNotaVistoria(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  try {
    await evento(supabase, textoObrigatorio(fd, "vistoria_id"), "nota", textoObrigatorio(fd, "descricao", "o que aconteceu"));
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Registrado." };
}

/** Marca a vistoria na agenda (compromisso do tipo "vistoria"). */
export async function agendarVistoria(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  try {
    const id = textoObrigatorio(fd, "vistoria_id");
    const data = textoObrigatorio(fd, "data", "a data");
    const v = await carregarVistoria(supabase, id);
    if (!v) throw new ErroValidacao("Vistoria não encontrada.");
    const { locatarios } = await partesDaVistoria(supabase, v);
    const { data: vis, error } = await supabase
      .from("visitas")
      .insert({
        tipo: "vistoria",
        titulo: `Vistoria de ${ROTULO_TIPO_VISTORIA[v.tipo].toLowerCase()} — ${v.imovel?.codigo ?? ""}`,
        data_hora: instante(data, texto(fd, "hora") ?? "09:00"),
        duracao_min: Math.min(1440, Math.max(15, inteiro(fd, "duracao_min") ?? 90)),
        imovel_id: v.imovel_id,
        pessoa_id: locatarios[0]?.id ?? null,
        observacoes: `Vistoria nº ${v.numero}`,
      })
      .select("id")
      .single();
    if (error) throw error;
    await supabase.from("visita_eventos").insert({ visita_id: vis.id, tipo: "criada", descricao: `Vistoria nº ${v.numero} marcada pela tela de vistorias` });
    await supabase.from("vistorias").update({ visita_id: vis.id, data }).eq("id", id);
    await evento(supabase, id, "agenda", `Marcada na agenda para ${formatarDataBR(data)} às ${texto(fd, "hora") ?? "09:00"}`);
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar(["/agenda"]);
  return { ok: "Vistoria marcada na agenda." };
}

// Ambientes e itens -------------------------------------------------------------
export async function criarAmbiente(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  try {
    const vistoriaId = textoObrigatorio(fd, "vistoria_id");
    await exigirEditavel(supabase, vistoriaId);
    const tipo = TIPOS_AMBIENTE[texto(fd, "tipo") ?? ""] ? (texto(fd, "tipo") as string) : "outro";
    const nome = texto(fd, "nome") ?? TIPOS_AMBIENTE[tipo].rotulo;
    const { data: ult } = await supabase.from("vistoria_ambientes").select("ordem").eq("vistoria_id", vistoriaId).order("ordem", { ascending: false }).limit(1).maybeSingle();
    const comChecklist = fd.getAll("checklist").includes("on");
    await criarAmbientes(supabase, vistoriaId, [{ nome, tipo, itens: comChecklist ? checklistDoAmbiente(tipo) : [] }], (ult?.ordem ?? -1) + 1);
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Ambiente incluído." };
}

/** Cria os ambientes pelo cadastro do imóvel (quartos, banheiros, vagas…). */
export async function criarAmbientesDoImovel(vistoriaId: string): Promise<Resultado> {
  const { supabase } = await obterContexto();
  try {
    await exigirEditavel(supabase, vistoriaId);
    const v = await carregarVistoria(supabase, vistoriaId);
    if (!v?.imovel) throw new ErroValidacao("Imóvel não encontrado.");
    const { count } = await supabase.from("vistoria_ambientes").select("id", { count: "exact", head: true }).eq("vistoria_id", vistoriaId);
    await criarAmbientes(supabase, vistoriaId, ambientesSugeridos(v.imovel).map((a) => ({ ...a, itens: checklistDoAmbiente(a.tipo) })), count ?? 0);
  } catch (e) {
    return { ok: false, erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: true };
}

export async function copiarAmbientesDaReferencia(vistoriaId: string): Promise<Resultado> {
  const { supabase } = await obterContexto();
  try {
    await exigirEditavel(supabase, vistoriaId);
    const { data: v } = await supabase.from("vistorias").select("referencia_id").eq("id", vistoriaId).single();
    if (!v?.referencia_id) throw new ErroValidacao("Escolha antes a vistoria de referência (aba Comparação).");
    const { count } = await supabase.from("vistoria_ambientes").select("id", { count: "exact", head: true }).eq("vistoria_id", vistoriaId);
    const n = await copiarDaReferencia(supabase, vistoriaId, v.referencia_id, count ?? 0);
    if (!n) throw new ErroValidacao("A vistoria de referência não tem ambientes.");
  } catch (e) {
    return { ok: false, erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: true };
}

export async function atualizarAmbiente(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  const id = String(fd.get("id"));
  try {
    const d: Record<string, unknown> = {};
    if (fd.has("nome")) d.nome = textoObrigatorio(fd, "nome", "o nome do ambiente");
    if (fd.has("observacoes")) d.observacoes = texto(fd, "observacoes");
    if (fd.has("tipo") && TIPOS_AMBIENTE[texto(fd, "tipo") ?? ""]) d.tipo = texto(fd, "tipo");
    if (fd.has("ordem")) d.ordem = inteiro(fd, "ordem") ?? 0;
    const { error } = await supabase.from("vistoria_ambientes").update(d).eq("id", id);
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Salvo." };
}

export async function excluirAmbiente(id: string): Promise<Resultado> {
  const { supabase } = await obterContexto();
  const { data: a } = await supabase.from("vistoria_ambientes").select("vistoria_id, nome").eq("id", id).single();
  if (!a) return { ok: false, erro: "Ambiente não encontrado." };
  try {
    await exigirEditavel(supabase, a.vistoria_id);
  } catch (e) {
    return { ok: false, erro: mensagemErro(e) };
  }
  const { error } = await supabase.from("vistoria_ambientes").delete().eq("id", id);
  if (error) return { ok: false, erro: mensagemErro(error) };
  await evento(supabase, a.vistoria_id, "ambiente", `Ambiente excluído: ${a.nome} (as fotos dele continuam na galeria)`);
  revalidar();
  return { ok: true };
}

/** Salva estado e observação de todos os itens do ambiente (campos estado:<id> e obs:<id>). */
export async function salvarItensAmbiente(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  try {
    await exigirEditavel(supabase, textoObrigatorio(fd, "vistoria_id"));
    const itens = new Map<string, { id: string; estado: string | null; observacao: string | null }>();
    for (const [k, v] of fd.entries()) {
      const [campo, id] = k.split(":");
      if (!id || !UUID_RE.test(id) || (campo !== "estado" && campo !== "obs")) continue;
      const atual = itens.get(id) ?? { id, estado: null, observacao: null };
      const valor = String(v).trim() || null;
      if (campo === "estado") atual.estado = valor && (ESTADOS_ITEM as readonly string[]).includes(valor) ? valor : null;
      else atual.observacao = valor;
      itens.set(id, atual);
    }
    if (!itens.size) return { ok: "Salvo." };
    const { error } = await supabase.rpc("salvar_itens_vistoria", { p_itens: [...itens.values()] });
    if (error) throw error;
    // Quem começa a preencher já está "em andamento".
    const vid = String(fd.get("vistoria_id"));
    await supabase.from("vistorias").update({ status: "em_andamento", iniciada_em: new Date().toISOString() }).eq("id", vid).eq("status", "rascunho");
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Salvo." };
}

export async function criarItem(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  try {
    const ambiente_id = textoObrigatorio(fd, "ambiente_id");
    const { data: a } = await supabase.from("vistoria_ambientes").select("vistoria_id").eq("id", ambiente_id).single();
    if (!a) throw new ErroValidacao("Ambiente não encontrado.");
    await exigirEditavel(supabase, a.vistoria_id);
    const { count } = await supabase.from("vistoria_itens").select("id", { count: "exact", head: true }).eq("ambiente_id", ambiente_id);
    const estado = texto(fd, "estado");
    const { error } = await supabase.from("vistoria_itens").insert({
      ambiente_id,
      vistoria_id: a.vistoria_id,
      nome: textoObrigatorio(fd, "nome", "o nome do item"),
      ordem: count ?? 0,
      estado: estado && (ESTADOS_ITEM as readonly string[]).includes(estado) ? estado : null,
      observacao: texto(fd, "observacao"),
    });
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Item incluído." };
}

export async function excluirItem(id: string): Promise<Resultado> {
  const { supabase } = await obterContexto();
  const { data: i } = await supabase.from("vistoria_itens").select("vistoria_id").eq("id", id).single();
  if (!i) return { ok: false, erro: "Item não encontrado." };
  try {
    await exigirEditavel(supabase, i.vistoria_id);
  } catch (e) {
    return { ok: false, erro: mensagemErro(e) };
  }
  const { error } = await supabase.from("vistoria_itens").delete().eq("id", id);
  if (error) return { ok: false, erro: mensagemErro(error) };
  revalidar();
  return { ok: true };
}

// Medidores -----------------------------------------------------------------------
async function vistoriaDe(supabase: Supabase, tabela: "vistoria_medidores" | "vistoria_midias", id: string) {
  const { data } = await supabase.from(tabela).select("vistoria_id").eq("id", id).maybeSingle();
  if (!data) throw new ErroValidacao(tabela === "vistoria_medidores" ? "Medidor não encontrado." : "Foto ou vídeo não encontrado.");
  return data.vistoria_id as string;
}

export async function criarMedidor(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  try {
    const vistoria_id = textoObrigatorio(fd, "vistoria_id");
    await exigirEditavel(supabase, vistoria_id);
    const tipo = texto(fd, "tipo") ?? "";
    if (!(TIPOS_MEDIDOR as readonly string[]).includes(tipo)) throw new ErroValidacao("Escolha o tipo do medidor.");
    const leitura = numero(fd, "leitura");
    if (leitura !== null && leitura < 0) throw new ErroValidacao("A leitura não pode ser negativa.");
    const { error } = await supabase.from("vistoria_medidores").insert({ vistoria_id, tipo, numero: texto(fd, "numero"), leitura, observacao: texto(fd, "observacao") });
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Medidor incluído." };
}

export async function criarMedidoresPadrao(vistoriaId: string): Promise<Resultado> {
  const { supabase } = await obterContexto();
  try {
    await exigirEditavel(supabase, vistoriaId);
  } catch (e) {
    return { ok: false, erro: mensagemErro(e) };
  }
  const { error } = await supabase.from("vistoria_medidores").insert(TIPOS_MEDIDOR.map((tipo) => ({ vistoria_id: vistoriaId, tipo })));
  if (error) return { ok: false, erro: mensagemErro(error) };
  revalidar();
  return { ok: true };
}

export async function atualizarMedidor(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  const id = String(fd.get("id"));
  try {
    await exigirEditavel(supabase, await vistoriaDe(supabase, "vistoria_medidores", id));
    const d: Record<string, unknown> = {};
    if (fd.has("numero")) d.numero = texto(fd, "numero");
    if (fd.has("observacao")) d.observacao = texto(fd, "observacao");
    if (fd.has("leitura")) {
      const l = numero(fd, "leitura");
      if (l !== null && l < 0) throw new ErroValidacao("A leitura não pode ser negativa.");
      d.leitura = l;
    }
    if (fd.has("tipo") && (TIPOS_MEDIDOR as readonly string[]).includes(texto(fd, "tipo") ?? "")) d.tipo = texto(fd, "tipo");
    const { error } = await supabase.from("vistoria_medidores").update(d).eq("id", id);
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Salvo." };
}

export async function excluirMedidor(id: string): Promise<Resultado> {
  const { supabase } = await obterContexto();
  try {
    await exigirEditavel(supabase, await vistoriaDe(supabase, "vistoria_medidores", id));
  } catch (e) {
    return { ok: false, erro: mensagemErro(e) };
  }
  const { error } = await supabase.from("vistoria_medidores").delete().eq("id", id);
  if (error) return { ok: false, erro: mensagemErro(error) };
  revalidar();
  return { ok: true };
}

// Fotos e vídeos ------------------------------------------------------------------
/** Registra uma foto/vídeo já enviado ao bucket "vistorias" (pasta <org>/<vistoria>/). */
export async function registrarMidia(a: {
  id?: string;
  vistoriaId: string;
  path: string;
  tipo: "foto" | "video";
  nome: string | null;
  ambienteId?: string | null;
  itemId?: string | null;
  medidorId?: string | null;
  legenda?: string | null;
  tiradaEm?: string | null;
}): Promise<Resultado> {
  const { supabase, organizacao } = await obterContexto();
  if (!a.path.startsWith(`${organizacao.id}/${a.vistoriaId}/`) || a.path.includes("..")) return { ok: false, erro: "Arquivo inválido." };
  try {
    await exigirEditavel(supabase, a.vistoriaId);
  } catch (e) {
    // O arquivo já subiu: sem o registro, não fica perdido no armazenamento.
    await supabase.storage.from("vistorias").remove([a.path]);
    return { ok: false, erro: mensagemErro(e) };
  }
  const linha = {
    ...(a.id && UUID_RE.test(a.id) ? { id: a.id } : {}),
    vistoria_id: a.vistoriaId,
    path: a.path,
    tipo: a.tipo === "video" ? "video" : "foto",
    nome_arquivo: a.nome?.slice(0, 200) ?? null,
    ambiente_id: a.ambienteId || null,
    item_id: a.itemId || null,
    medidor_id: a.medidorId || null,
    legenda: a.legenda?.trim().slice(0, 300) || null,
    tirada_em: a.tiradaEm || new Date().toISOString(),
  };
  const { error } = await supabase.from("vistoria_midias").upsert(linha, { onConflict: "id", ignoreDuplicates: true });
  if (error) return { ok: false, erro: mensagemErro(error) };
  revalidar();
  return { ok: true };
}

/**
 * Legenda, ambiente e item da foto. O item só é apagado quando deixa de ser
 * do ambiente escolhido (trocar só a legenda mantém "Sala · Piso").
 */
export async function atualizarMidia(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  const id = String(fd.get("id"));
  try {
    const { data: atual } = await supabase.from("vistoria_midias").select("vistoria_id, ambiente_id, item_id").eq("id", id).maybeSingle();
    if (!atual) throw new ErroValidacao("Foto ou vídeo não encontrado.");
    await exigirEditavel(supabase, atual.vistoria_id);
    const d: Record<string, unknown> = {};
    if (fd.has("legenda")) d.legenda = texto(fd, "legenda");
    const ambiente = fd.has("ambiente_id") ? texto(fd, "ambiente_id") : (atual.ambiente_id as string | null);
    if (fd.has("ambiente_id")) d.ambiente_id = ambiente;
    let item = fd.has("item_id") ? texto(fd, "item_id") : (atual.item_id as string | null);
    if (item) {
      // O item tem de ser do ambiente da foto (e da mesma vistoria).
      const { data: it } = ambiente
        ? await supabase.from("vistoria_itens").select("id").eq("id", item).eq("ambiente_id", ambiente).eq("vistoria_id", atual.vistoria_id).maybeSingle()
        : { data: null };
      if (!it) item = null;
    }
    if (item !== atual.item_id) d.item_id = item;
    if (!Object.keys(d).length) return { ok: "Salvo." };
    const { error } = await supabase.from("vistoria_midias").update(d).eq("id", id);
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Salvo." };
}

export async function excluirMidia(id: string): Promise<Resultado> {
  const { supabase } = await obterContexto();
  const { data } = await supabase.from("vistoria_midias").select("path, vistoria_id").eq("id", id).maybeSingle();
  if (!data) return { ok: false, erro: "Foto ou vídeo não encontrado." };
  try {
    await exigirEditavel(supabase, data.vistoria_id);
  } catch (e) {
    return { ok: false, erro: mensagemErro(e) };
  }
  const { error } = await supabase.from("vistoria_midias").delete().eq("id", id);
  if (error) return { ok: false, erro: mensagemErro(error) };
  if (data?.path) await supabase.storage.from("vistorias").remove([data.path]);
  revalidar();
  return { ok: true };
}

// Danos, pendências e orçamentos ---------------------------------------------------
/** Na criação vale só o que o modo oferece; na edição aceita o valor que já estava gravado. */
function lerResponsavel(fd: FormData, pessoal: boolean, edicao = false) {
  const r = texto(fd, "responsavel") ?? "locatario";
  const validos = edicao ? Object.keys(ROTULO_RESPONSAVEL) : responsaveisDoModo(pessoal).map((o) => o.valor);
  return validos.includes(r) ? r : "locatario";
}

export async function criarPendencia(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase, organizacao } = await obterContexto();
  try {
    const vistoria_id = textoObrigatorio(fd, "vistoria_id");
    const valor = numero(fd, "valor_estimado");
    if (valor !== null && valor < 0) throw new ErroValidacao("O valor não pode ser negativo.");
    const descricao = textoObrigatorio(fd, "descricao", "o que precisa ser feito");
    const { error } = await supabase.from("vistoria_pendencias").insert({
      vistoria_id,
      tipo: texto(fd, "tipo") === "pendencia" ? "pendencia" : "dano",
      descricao,
      ambiente_id: texto(fd, "ambiente_id"),
      item_id: texto(fd, "item_id"),
      responsavel: lerResponsavel(fd, organizacao.modo === "pessoal"),
      prazo: texto(fd, "prazo"),
      valor_estimado: valor,
      observacao: texto(fd, "observacao"),
    });
    if (error) throw error;
    await evento(supabase, vistoria_id, "pendencia", `Pendência registrada: ${descricao}`);
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Pendência registrada." };
}

/**
 * Cria pendências dos itens com dano (ruim/danificado) — ou, com
 * "soPiorou", só do que piorou em relação à vistoria de referência.
 */
async function gerarPendencias(vistoriaId: string, soPiorou: boolean): Promise<Resultado> {
  const { supabase } = await obterContexto();
  try {
    const { data: v } = await supabase.from("vistorias").select("tipo, referencia_id").eq("id", vistoriaId).single();
    if (!v) throw new ErroValidacao("Vistoria não encontrada.");
    const [ambientes, { data: ja }] = await Promise.all([carregarAmbientes(supabase, vistoriaId), supabase.from("vistoria_pendencias").select("item_id").eq("vistoria_id", vistoriaId)]);
    const usados = new Set((ja ?? []).map((p) => p.item_id).filter(Boolean));
    const ambDoItem = new Map(ambientes.flatMap((a) => a.vistoria_itens.map((i) => [i.id, a] as const)));
    let novos: { item_id: string; ambiente_id: string; descricao: string }[] = [];
    if (soPiorou) {
      if (!v.referencia_id) throw new ErroValidacao("Escolha a vistoria de referência para comparar.");
      const antes = await carregarAmbientes(supabase, v.referencia_id);
      const r = compararVistorias(
        antes.map((a) => ({ nome: a.nome, itens: a.vistoria_itens })),
        ambientes.map((a) => ({ nome: a.nome, itens: a.vistoria_itens })),
      );
      novos = r.linhas
        .filter((l) => l.situacao === "piorou" && l.itemId && !usados.has(l.itemId))
        .map((l) => ({
          item_id: l.itemId!,
          ambiente_id: ambDoItem.get(l.itemId!)!.id,
          descricao: `${l.item}: estava ${ROTULO_ESTADO[l.antes ?? ""]?.toLowerCase() ?? "—"}, agora ${ROTULO_ESTADO[l.depois ?? ""]?.toLowerCase() ?? "—"}${l.obsDepois ? ` (${l.obsDepois})` : ""}`,
        }));
    } else {
      novos = ambientes.flatMap((a) =>
        a.vistoria_itens
          .filter((i) => (i.estado === "ruim" || i.estado === "danificado") && !usados.has(i.id))
          .map((i) => ({ item_id: i.id, ambiente_id: a.id, descricao: `${i.nome}: ${ROTULO_ESTADO[i.estado!].toLowerCase()}${i.observacao ? ` (${i.observacao})` : ""}` })),
      );
    }
    if (!novos.length) throw new ErroValidacao(soPiorou ? "Nenhum item piorou (ou já tem pendência)." : "Nenhum item com dano sem pendência.");
    const responsavel = soPiorou || v.tipo === "saida" ? "locatario" : "proprietario";
    const { error } = await supabase.from("vistoria_pendencias").insert(novos.map((n) => ({ ...n, vistoria_id: vistoriaId, tipo: "dano", responsavel })));
    if (error) throw error;
    await evento(supabase, vistoriaId, "pendencia", `${novos.length} pendência(s) criada(s) ${soPiorou ? "do que piorou" : "dos itens com dano"}`);
  } catch (e) {
    return { ok: false, erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: true };
}
export async function gerarPendenciasDosDanos(vistoriaId: string) {
  return gerarPendencias(vistoriaId, false);
}
export async function gerarPendenciasDoQuePiorou(vistoriaId: string) {
  return gerarPendencias(vistoriaId, true);
}

export async function atualizarPendencia(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase, organizacao } = await obterContexto();
  const id = String(fd.get("id"));
  let aviso: string | null = null;
  try {
    const d: Record<string, unknown> = {};
    if (fd.has("descricao")) d.descricao = textoObrigatorio(fd, "descricao", "a descrição");
    for (const c of ["prazo", "observacao", "ambiente_id"]) if (fd.has(c)) d[c] = texto(fd, c);
    if (fd.has("tipo")) d.tipo = texto(fd, "tipo") === "pendencia" ? "pendencia" : "dano";
    if (fd.has("responsavel")) d.responsavel = lerResponsavel(fd, organizacao.modo === "pessoal", true);
    if (fd.has("valor_estimado")) {
      const v = numero(fd, "valor_estimado");
      if (v !== null && v < 0) throw new ErroValidacao("O valor não pode ser negativo.");
      d.valor_estimado = v;
    }
    if (fd.has("status")) {
      const s = texto(fd, "status") ?? "aberta";
      if (!["aberta", "em_reparo", "resolvida", "cancelada"].includes(s)) throw new ErroValidacao("Situação inválida.");
      d.status = s;
      d.resolvida_em = s === "resolvida" ? (texto(fd, "resolvida_em") ?? hojeISO()) : null;
    }
    const { error } = await supabase.from("vistoria_pendencias").update(d).eq("id", id);
    if (error) throw error;
    aviso = await sincronizarCustoReparo(supabase, id, organizacao.modo);
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar(aviso ? ["/financeiro", "/despesas", "/repasses"] : []);
  return { ok: aviso ? `Salvo. ${aviso}` : "Salvo." };
}

export async function excluirPendencia(id: string): Promise<Resultado> {
  const { supabase } = await obterContexto();
  const { data: p } = await supabase.from("vistoria_pendencias").select("vistoria_id, descricao").eq("id", id).single();
  // A conta do reparo ainda em aberto deixa de valer junto com a pendência.
  await supabase
    .from("lancamentos")
    .update({ status: "cancelado", cancelado_motivo: "Pendência da vistoria excluída" })
    .eq("vistoria_pendencia_id", id)
    .eq("status", "aberto");
  const { error } = await supabase.from("vistoria_pendencias").delete().eq("id", id);
  if (error) return { ok: false, erro: mensagemErro(error) };
  if (p) await evento(supabase, p.vistoria_id, "pendencia", `Pendência excluída: ${p.descricao}`);
  revalidar();
  return { ok: true };
}

export async function criarOrcamento(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  try {
    const pendencia_id = textoObrigatorio(fd, "pendencia_id");
    const valor = numero(fd, "valor");
    if (valor === null || valor < 0) throw new ErroValidacao("Informe o valor do orçamento.");
    const prestador_id = texto(fd, "prestador_id");
    const prestador_nome = texto(fd, "prestador_nome");
    if (!prestador_id && !prestador_nome) throw new ErroValidacao("Escolha o prestador ou digite o nome.");
    const prazo = inteiro(fd, "prazo_dias");
    const { error } = await supabase.from("vistoria_orcamentos").insert({
      pendencia_id,
      prestador_id,
      prestador_nome,
      valor,
      prazo_dias: prazo !== null && prazo >= 0 ? prazo : null,
      validade: texto(fd, "validade"),
      descricao: texto(fd, "descricao"),
    });
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Orçamento incluído." };
}

/** Aprova o orçamento (os outros da mesma pendência deixam de valer). Só admin, gestor ou financeiro. */
export async function aprovarOrcamento(id: string): Promise<Resultado> {
  const { supabase, papel, organizacao } = await obterContexto();
  if (!podeDecidir(papel)) return { ok: false, erro: "Só administrador, gestor ou financeiro aprovam orçamentos." };
  try {
    const { data: o } = await supabase.from("vistoria_orcamentos").select("pendencia_id, valor, prestador_nome, prestador:pessoas(nome), pendencia:vistoria_pendencias(vistoria_id, descricao)").eq("id", id).single();
    if (!o) throw new ErroValidacao("Orçamento não encontrado.");
    await supabase.from("vistoria_orcamentos").update({ aprovado: false, aprovado_em: null }).eq("pendencia_id", o.pendencia_id).neq("id", id);
    const { error } = await supabase.from("vistoria_orcamentos").update({ aprovado: true, aprovado_em: new Date().toISOString() }).eq("id", id);
    if (error) throw error;
    const pend = o.pendencia as unknown as { vistoria_id: string; descricao: string } | null;
    const prest = (o.prestador as unknown as { nome: string } | null)?.nome ?? o.prestador_nome ?? "prestador";
    if (pend) await evento(supabase, pend.vistoria_id, "orcamento", `Orçamento aprovado: ${pend.descricao} — ${prest}, ${formatarReais(o.valor)}`);
    await sincronizarCustoReparo(supabase, o.pendencia_id as string, organizacao.modo);
  } catch (e) {
    return { ok: false, erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: true };
}

export async function desaprovarOrcamento(id: string): Promise<Resultado> {
  const { supabase, papel, organizacao } = await obterContexto();
  if (!podeDecidir(papel)) return { ok: false, erro: "Só administrador, gestor ou financeiro mexem na aprovação." };
  const { data: o } = await supabase.from("vistoria_orcamentos").select("pendencia_id").eq("id", id).maybeSingle();
  const { error } = await supabase.from("vistoria_orcamentos").update({ aprovado: false, aprovado_em: null }).eq("id", id);
  if (error) return { ok: false, erro: mensagemErro(error) };
  try {
    if (o) await sincronizarCustoReparo(supabase, o.pendencia_id as string, organizacao.modo);
  } catch (e) {
    return { ok: false, erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: true };
}

export async function excluirOrcamento(id: string): Promise<Resultado> {
  const { supabase, organizacao } = await obterContexto();
  const { data: o } = await supabase.from("vistoria_orcamentos").select("pendencia_id").eq("id", id).maybeSingle();
  const { error } = await supabase.from("vistoria_orcamentos").delete().eq("id", id);
  if (error) return { ok: false, erro: mensagemErro(error) };
  try {
    if (o) await sincronizarCustoReparo(supabase, o.pendencia_id as string, organizacao.modo);
  } catch (e) {
    return { ok: false, erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: true };
}

/** Leva os reparos do locatário para o acerto de saída do contrato. */
export async function levarParaAcerto(vistoriaId: string): Promise<Resultado> {
  const { supabase, papel } = await obterContexto();
  if (!podeDecidir(papel)) return { ok: false, erro: "Só administrador, gestor ou financeiro mexem no acerto de saída." };
  const { error } = await supabase.rpc("aplicar_vistoria_no_acerto", { p_vistoria: vistoriaId });
  if (error) return { ok: false, erro: mensagemErro(error) };
  revalidar(["/contratos"]);
  return { ok: true };
}

// Laudo, assinatura e contestação -------------------------------------------------
/**
 * Gera o laudo como documento (Documentos), já com os signatários
 * (locatários, locador/proprietários e quem fez a vistoria) e enviado para
 * assinatura eletrônica pelo link /assinar/[token]. Um laudo anterior não
 * assinado é cancelado.
 */
export async function gerarLaudoAssinatura(vistoriaId: string): Promise<Resultado> {
  const { supabase, organizacao } = await obterContexto();
  const pessoal = organizacao.modo === "pessoal";
  try {
    const v = await carregarVistoria(supabase, vistoriaId);
    if (!v) throw new ErroValidacao("Vistoria não encontrada.");
    if (!["concluida", "contestada"].includes(v.status)) throw new ErroValidacao("Conclua a vistoria antes de gerar o laudo para assinatura.");
    const [dados, partes] = await Promise.all([dadosDoLaudo(supabase, v, organizacao), partesDaVistoria(supabase, v)]);
    const conteudo = textoLaudo(dados);
    if (v.documento_id) {
      const { data: antigo } = await supabase.from("documentos").select("status").eq("id", v.documento_id).single();
      if (antigo?.status === "assinado") throw new ErroValidacao("O laudo já foi assinado por todos. Para corrigir, use “Reabrir” no Resumo: o laudo assinado fica em Documentos como histórico e você gera um novo.");
      if (antigo) {
        await supabase.from("documentos").update({ status: "cancelado" }).eq("id", v.documento_id);
        await supabase.from("documento_eventos").insert({ documento_id: v.documento_id, tipo: "cancelado", descricao: "Substituído por um laudo novo da vistoria" });
      }
    }
    type Sig = { pessoa_id: string | null; nome: string; cpf: string | null; telefone: string | null; email: string | null; papel: string };
    const sigs: Sig[] = [];
    for (const p of partes.locatarios) sigs.push({ pessoa_id: p.id, nome: p.nome, cpf: p.documento, telefone: p.telefone, email: p.email, papel: "locatario" });
    if (pessoal) sigs.push({ pessoa_id: null, nome: organizacao.nome, cpf: organizacao.documento, telefone: organizacao.telefone, email: organizacao.email, papel: "locador" });
    else for (const p of partes.proprietarios) sigs.push({ pessoa_id: p.id, nome: p.nome, cpf: p.documento, telefone: p.telefone, email: p.email, papel: "locador" });
    const vistoriador = quemFez(v);
    if (!pessoal && vistoriador && !sigs.some((s) => s.nome === vistoriador))
      sigs.push({ pessoa_id: v.responsavel?.id ?? null, nome: vistoriador, cpf: v.responsavel?.documento ?? null, telefone: v.responsavel?.telefone ?? null, email: null, papel: "parte" });

    const titulo = `Laudo de vistoria de ${ROTULO_TIPO_VISTORIA[v.tipo].toLowerCase()} nº ${v.numero} — ${v.imovel?.codigo ?? ""}`;
    const { data: doc, error } = await supabase
      .from("documentos")
      .insert({
        titulo,
        tipo: "vistoria",
        imovel_id: v.imovel_id,
        contrato_id: v.contrato_id,
        pessoa_id: partes.locatarios[0]?.id ?? null,
        conteudo,
        status: sigs.length ? "aguardando_assinatura" : "rascunho",
      })
      .select("id")
      .single();
    if (error) throw error;
    await supabase.from("documento_versoes").insert({ documento_id: doc.id, versao: 1, conteudo, observacao: `Gerado pela vistoria nº ${v.numero}` });
    await supabase.from("documento_eventos").insert({ documento_id: doc.id, tipo: "criado", descricao: `Laudo gerado pela vistoria nº ${v.numero}${sigs.length ? " e enviado para assinatura" : ""}` });
    if (sigs.length) {
      const { error: e2 } = await supabase.from("documento_signatarios").insert(sigs.map((s, i) => ({ ...s, documento_id: doc.id, ordem: i + 1 })));
      if (e2) throw e2;
    }
    await supabase.from("vistorias").update({ documento_id: doc.id, updated_at: new Date().toISOString() }).eq("id", vistoriaId);
    await evento(supabase, vistoriaId, "laudo", `Laudo gerado para assinatura (${sigs.length} signatário(s))`);
  } catch (e) {
    return { ok: false, erro: mensagemErro(e) };
  }
  revalidar(["/documentos"]);
  return { ok: true };
}

/** Troca o link de contestação (o anterior para de funcionar). */
export async function novoLinkContestacao(vistoriaId: string): Promise<Resultado> {
  const { supabase } = await obterContexto();
  const { error } = await supabase.from("vistorias").update({ contestacao_token: novoId() }).eq("id", vistoriaId);
  if (error) return { ok: false, erro: mensagemErro(error) };
  await evento(supabase, vistoriaId, "contestacao", "Link de contestação trocado (o anterior parou de funcionar)");
  revalidar();
  return { ok: true };
}

/** Sem contestação em aberto, a vistoria volta para assinada/concluída. */
async function recalcularContestada(supabase: Supabase, vistoriaId: string) {
  const [{ count }, { data: v }] = await Promise.all([
    supabase.from("vistoria_contestacoes").select("id", { count: "exact", head: true }).eq("vistoria_id", vistoriaId).eq("status", "aberta"),
    supabase.from("vistorias").select("status, assinada_em").eq("id", vistoriaId).single(),
  ]);
  if (!v) return;
  if (count && v.status !== "contestada" && ["concluida", "assinada"].includes(v.status)) await supabase.from("vistorias").update({ status: "contestada" }).eq("id", vistoriaId);
  if (!count && v.status === "contestada") await supabase.from("vistorias").update({ status: v.assinada_em ? "assinada" : "concluida" }).eq("id", vistoriaId);
}

export async function responderContestacao(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase, papel } = await obterContexto();
  try {
    if (!podeDecidir(papel)) throw new ErroValidacao("Só administrador, gestor ou financeiro respondem contestações.");
    const id = textoObrigatorio(fd, "id");
    const decisao = texto(fd, "decisao") ?? "";
    if (!["aceita", "parcial", "mantida"].includes(decisao)) throw new ErroValidacao("Escolha a decisão.");
    const resposta = textoObrigatorio(fd, "resposta", "a resposta ao locatário");
    const { data: c, error } = await supabase
      .from("vistoria_contestacoes")
      .update({ status: "respondida", decisao, resposta, respondida_em: new Date().toISOString(), respondida_por: (await supabase.auth.getUser()).data.user?.id ?? null })
      .eq("id", id)
      .select("vistoria_id, nome")
      .single();
    if (error) throw error;
    await evento(supabase, c.vistoria_id, "contestacao", `Contestação de ${c.nome} respondida: ${decisao === "aceita" ? "aceita" : decisao === "parcial" ? "aceita em parte" : "laudo mantido"}`);
    await recalcularContestada(supabase, c.vistoria_id);
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Resposta registrada." };
}

/** Contestação que chegou por outro meio (e-mail, carta, WhatsApp). */
export async function registrarContestacaoManual(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  try {
    const vistoria_id = textoObrigatorio(fd, "vistoria_id");
    const nome = textoObrigatorio(fd, "nome", "quem contestou");
    const { error } = await supabase.from("vistoria_contestacoes").insert({ vistoria_id, nome, contato: texto(fd, "contato"), texto: textoObrigatorio(fd, "texto", "o que foi contestado"), origem: "manual" });
    if (error) throw error;
    await evento(supabase, vistoria_id, "contestada", `Contestação de ${nome} registrada à mão`);
    await recalcularContestada(supabase, vistoria_id);
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Contestação registrada." };
}

export async function excluirContestacao(id: string): Promise<Resultado> {
  const { supabase } = await obterContexto();
  const { data: c } = await supabase.from("vistoria_contestacoes").select("vistoria_id, nome, fotos").eq("id", id).single();
  if (!c) return { ok: false, erro: "Contestação não encontrada." };
  const { error } = await supabase.from("vistoria_contestacoes").delete().eq("id", id);
  if (error) return { ok: false, erro: mensagemErro(error) };
  if ((c.fotos ?? []).length) await supabase.storage.from("vistorias").remove(c.fotos as string[]);
  await evento(supabase, c.vistoria_id, "contestacao", `Contestação de ${c.nome} excluída`);
  await recalcularContestada(supabase, c.vistoria_id);
  revalidar();
  return { ok: true };
}

// App de campo --------------------------------------------------------------------
type ResultadoCampo = {
  ok: boolean;
  erro?: string;
  aplicadas?: number;
  /** O que não foi aceito (a tela mostra e a pessoa tenta de novo ou descarta). */
  recusas?: RecusaCampo[];
  avisos?: string[];
  /** Situação real da vistoria no sistema depois de sincronizar. */
  status?: string;
};

/**
 * Recebe a fila de alterações feitas no celular (inclusive sem internet) e
 * aplica uma por uma: o que não puder ser gravado (vistoria concluída por
 * outra pessoa, ambiente ou item excluído no computador, erro ao gravar) é
 * devolvido em "recusas" sem travar o resto. Pode ser chamada de novo com a
 * mesma fila sem duplicar nada: ambientes, itens, medidores e fotos usam o id
 * criado no aparelho.
 */
export async function sincronizarCampo(vistoriaId: string, ops: OpCampo[]): Promise<ResultadoCampo> {
  const { supabase, organizacao } = await obterContexto();
  const recusas: RecusaCampo[] = [];
  let aplicadas = 0;
  let fotos = 0;
  let semVinculo = 0;
  let statusFinal: string;
  try {
    if (!UUID_RE.test(vistoriaId)) throw new ErroValidacao("Vistoria inválida.");
    if (!Array.isArray(ops) || ops.length > 2000) throw new ErroValidacao("Alterações inválidas.");
    const { data: v } = await supabase.from("vistorias").select("status").eq("id", vistoriaId).single();
    if (!v) throw new ErroValidacao("Vistoria não encontrada.");
    const editavel = vistoriaEditavel(v.status);
    const travada = `A vistoria está “${ROTULO_STATUS_VISTORIA[v.status] ?? v.status}” no sistema. Para gravar isto, reabra no computador (Resumo → Reabrir) e toque em “Tentar de novo”.`;
    const ehId = (s: unknown): s is string => typeof s === "string" && UUID_RE.test(s);
    const txt = (s: unknown, max = 500) => (typeof s === "string" && s.trim() ? s.trim().slice(0, max) : null);
    const lista = ops.filter((o): o is OpCampo => Boolean(o) && typeof o === "object" && typeof (o as { op?: unknown }).op === "string");
    const recusar = (o: OpCampo, tipo: TipoRecusa, motivo: string) => recusas.push({ chave: chaveOp(o), tipo, motivo });
    const falhou = (o: OpCampo, e: unknown) => recusar(o, "erro", `Não foi possível gravar: ${mensagemErro(e)}`);

    // 1) Ambientes criados no aparelho (com os itens do checklist).
    for (const o of lista) {
      if (o.op !== "ambiente") continue;
      if (!ehId(o.id) || (o.itens ?? []).some((i) => !ehId(i.id))) recusar(o, "invalida", "Alteração inválida.");
      else if (!editavel) recusar(o, "travada", travada);
      else
        try {
          const { data: ult } = await supabase.from("vistoria_ambientes").select("ordem").eq("vistoria_id", vistoriaId).order("ordem", { ascending: false }).limit(1).maybeSingle();
          const tipo = TIPOS_AMBIENTE[o.tipo] ? o.tipo : "outro";
          const { error } = await supabase
            .from("vistoria_ambientes")
            .upsert({ id: o.id, vistoria_id: vistoriaId, nome: txt(o.nome, 120) ?? TIPOS_AMBIENTE[tipo].rotulo, tipo, ordem: (ult?.ordem ?? -1) + 1 }, { onConflict: "id", ignoreDuplicates: true });
          if (error) throw error;
          const { data: dono } = await supabase.from("vistoria_ambientes").select("id").eq("id", o.id).eq("vistoria_id", vistoriaId).maybeSingle();
          if (!dono) {
            recusar(o, "invalida", "Este ambiente já existe em outra vistoria.");
            continue;
          }
          const novos = (o.itens ?? []).map((i, k) => ({ id: i.id, ambiente_id: o.id, vistoria_id: vistoriaId, nome: txt(i.nome, 120) ?? "Item", ordem: k }));
          if (novos.length) {
            const { error: e2 } = await supabase.from("vistoria_itens").upsert(novos, { onConflict: "id", ignoreDuplicates: true });
            if (e2) throw e2;
          }
          aplicadas++;
        } catch (e) {
          falhou(o, e);
        }
    }

    // 2) Medidores (novos ou leitura alterada).
    const { data: meds } = await supabase.from("vistoria_medidores").select("id").eq("vistoria_id", vistoriaId);
    const medidores = new Set((meds ?? []).map((m) => m.id as string));
    for (const o of lista) {
      if (o.op !== "medidor") continue;
      if (!ehId(o.id) || !(TIPOS_MEDIDOR as readonly string[]).includes(o.tipo)) recusar(o, "invalida", "Medidor inválido.");
      else if (!editavel) recusar(o, "travada", travada);
      else
        try {
          const leitura = typeof o.leitura === "number" && Number.isFinite(o.leitura) && o.leitura >= 0 ? o.leitura : null;
          const linha = { tipo: o.tipo, numero: txt(o.numero, 60), leitura };
          const { error } = medidores.has(o.id)
            ? await supabase.from("vistoria_medidores").update(linha).eq("id", o.id).eq("vistoria_id", vistoriaId)
            : await supabase.from("vistoria_medidores").insert({ id: o.id, vistoria_id: vistoriaId, ...linha });
          if (error) throw error;
          medidores.add(o.id);
          aplicadas++;
        } catch (e) {
          falhou(o, e);
        }
    }

    // 3) O que existe agora no sistema (o computador pode ter excluído ambientes e itens).
    const [{ data: ambs }, { data: its }] = await Promise.all([
      supabase.from("vistoria_ambientes").select("id").eq("vistoria_id", vistoriaId),
      supabase.from("vistoria_itens").select("id, ambiente_id").eq("vistoria_id", vistoriaId),
    ]);
    const existe = {
      ambientes: new Set((ambs ?? []).map((a) => a.id as string)),
      itens: new Map((its ?? []).map((i) => [i.id as string, i.ambiente_id as string])),
      medidores,
    };

    // 4) Checklist, observações e fotos, na ordem em que foram feitos.
    const itens: { op: OpCampo; linha: { id: string; estado: string | null; observacao: string | null } }[] = [];
    let opStatus: Extract<OpCampo, { op: "status" }> | null = null;
    for (const o of lista) {
      if (o.op === "ambiente" || o.op === "medidor") continue;
      if (o.op === "status") {
        if (o.status === "concluida" || o.status === "em_andamento") opStatus = o;
        else recusar(o, "invalida", "Situação inválida.");
        continue;
      }
      if (!ehId(o.id)) {
        recusar(o, "invalida", "Alteração inválida.");
        continue;
      }
      if (o.op === "ambiente_obs") {
        if (!editavel) recusar(o, "travada", travada);
        else if (!existe.ambientes.has(o.id)) recusar(o, "invalida", "O ambiente foi excluído no computador.");
        else {
          const { error } = await supabase.from("vistoria_ambientes").update({ observacoes: txt(o.observacoes, 2000) }).eq("id", o.id).eq("vistoria_id", vistoriaId);
          if (error) falhou(o, error);
          else aplicadas++;
        }
      } else if (o.op === "item") {
        if (!editavel) recusar(o, "travada", travada);
        else if (!existe.itens.has(o.id)) recusar(o, "invalida", "O item (ou o ambiente dele) foi excluído no computador.");
        else {
          const estado = o.estado && (ESTADOS_ITEM as readonly string[]).includes(o.estado) ? o.estado : null;
          itens.push({ op: o, linha: { id: o.id, estado, observacao: txt(o.observacao, 1000) } });
        }
      } else if (o.op === "foto") {
        if (!editavel) recusar(o, "travada", travada);
        else if (!o.path || !o.path.startsWith(`${organizacao.id}/${vistoriaId}/`) || o.path.includes("..")) recusar(o, "invalida", "Arquivo inválido.");
        else {
          // Ambiente, item ou medidor excluído no computador: a foto fica, sem o vínculo perdido.
          const vin = vinculosDaFoto(o, existe);
          const { error } = await supabase.from("vistoria_midias").upsert(
            {
              id: o.id,
              vistoria_id: vistoriaId,
              path: o.path,
              tipo: o.tipo === "video" ? "video" : "foto",
              nome_arquivo: o.nome?.slice(0, 200) ?? null,
              ambiente_id: vin.ambienteId,
              item_id: vin.itemId,
              medidor_id: vin.medidorId,
              legenda: o.legenda?.trim().slice(0, 300) || null,
              tirada_em: o.tiradaEm || new Date().toISOString(),
            },
            { onConflict: "id", ignoreDuplicates: true },
          );
          if (error) falhou(o, error);
          else {
            fotos++;
            aplicadas++;
            if (vin.perdidos.length) semVinculo++;
          }
        }
      } else recusar(o as OpCampo, "invalida", "Alteração desconhecida.");
    }
    if (itens.length) {
      const { error } = await supabase.rpc("salvar_itens_vistoria", { p_itens: itens.map((i) => i.linha) });
      if (error) for (const i of itens) falhou(i.op, error);
      else aplicadas += itens.length;
    }

    // 5) Situação: começar a preencher já é "em andamento"; concluir pelo aparelho.
    if (v.status === "rascunho" && (aplicadas || opStatus)) {
      await supabase.from("vistorias").update({ status: "em_andamento", iniciada_em: new Date().toISOString() }).eq("id", vistoriaId).eq("status", "rascunho");
    }
    if (opStatus) {
      const { data: atual } = await supabase.from("vistorias").select("status").eq("id", vistoriaId).single();
      if (opStatus.status === "concluida" && atual?.status === "em_andamento") {
        // Não conclui por cima de alterações que falharam ao gravar (a pessoa confere e conclui de novo).
        if (recusas.some((r) => r.tipo === "erro")) recusar(opStatus, "erro", "A vistoria não foi concluída porque algumas alterações não foram gravadas. Tente de novo e conclua depois.");
        else {
          const r = await mudarStatus(vistoriaId, "concluida");
          if (r.ok) aplicadas++;
          else recusar(opStatus, "erro", r.erro ?? "Não foi possível concluir.");
        }
      } else aplicadas++; // já está como o aparelho pediu (ou foi concluída por outra pessoa)
    }

    const { data: fim } = await supabase.from("vistorias").select("status").eq("id", vistoriaId).single();
    statusFinal = (fim?.status as string | undefined) ?? v.status;
    if (aplicadas || recusas.length)
      await evento(
        supabase,
        vistoriaId,
        "campo",
        `App de campo: ${aplicadas} alteração(ões) sincronizada(s)${fotos ? `, ${fotos} foto(s)/vídeo(s)` : ""}${recusas.length ? `; ${recusas.length} não aceita(s)` : ""}`,
      );
  } catch (e) {
    return { ok: false, erro: mensagemErro(e) };
  }
  revalidar();
  const avisos = semVinculo ? [`${semVinculo} foto(s) eram de um ambiente, item ou medidor excluído no computador: ficaram na galeria como fotos gerais.`] : [];
  return { ok: true, aplicadas, recusas, avisos, status: statusFinal };
}

/**
 * Descarta fotos e vídeos que subiram do aparelho mas não foram aceitos
 * (a pessoa tocou em "Descartar"): apaga do armazenamento só o que não está
 * registrado em nenhuma vistoria.
 */
export async function descartarArquivosCampo(vistoriaId: string, caminhos: string[]): Promise<Resultado> {
  const { supabase, organizacao } = await obterContexto();
  if (!UUID_RE.test(vistoriaId) || !Array.isArray(caminhos)) return { ok: false, erro: "Pedido inválido." };
  const prefixo = `${organizacao.id}/${vistoriaId}/`;
  const lista = caminhos.filter((c) => typeof c === "string" && c.startsWith(prefixo) && !c.includes("..")).slice(0, 200);
  if (!lista.length) return { ok: true };
  const { data: usados } = await supabase.from("vistoria_midias").select("path").in("path", lista);
  const registrados = new Set((usados ?? []).map((u) => u.path as string));
  const livres = lista.filter((c) => !registrados.has(c));
  if (livres.length) await supabase.storage.from("vistorias").remove(livres);
  return { ok: true };
}
