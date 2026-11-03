"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { obterContexto } from "@/lib/contexto";
import { type EstadoAcao, ErroValidacao, booleano, inteiro, mensagemErro, texto, textoObrigatorio } from "@/lib/form";
import { ROTULO_TIPO_COMPROMISSO, TIPOS_COMPROMISSO, TIPOS_SO_IMOBILIARIA, conflitos, horaLocal, instante, diaLocal } from "@/lib/dominio/agenda";
import { formatarDataBR } from "@/lib/dominio/datas";

type Supabase = Awaited<ReturnType<typeof obterContexto>>["supabase"];
type Resultado = { ok: boolean; erro?: string };

function revalidarTudo() {
  revalidatePath("/agenda", "layout");
  revalidatePath("/comercial", "layout");
  revalidatePath("/captacao", "layout");
  revalidatePath("/imoveis", "layout");
  revalidatePath("/chaves", "layout");
  revalidatePath("/");
}

async function evento(supabase: Supabase, visitaId: string, tipo: string, descricao: string | null) {
  await supabase.from("visita_eventos").insert({ visita_id: visitaId, tipo, descricao });
}

const quando = (iso: string) => `${formatarDataBR(diaLocal(iso))} às ${horaLocal(iso)}`;

/** Avisos de conflito (mesmo imóvel/corretor no horário ou imóvel indisponível). */
async function verificarConflitos(supabase: Supabase, novo: { id: string; data_hora: string; duracao_min: number; imovel_id: string | null; corretor_id: string | null }) {
  if (!novo.imovel_id && !novo.corretor_id) return [];
  const ini = new Date(new Date(novo.data_hora).getTime() - 24 * 3600_000).toISOString();
  const fim = new Date(new Date(novo.data_hora).getTime() + 24 * 3600_000).toISOString();
  let q = supabase.from("visitas").select("id, data_hora, duracao_min, status, imovel_id, corretor_id").gte("data_hora", ini).lte("data_hora", fim);
  const ors = [novo.imovel_id && `imovel_id.eq.${novo.imovel_id}`, novo.corretor_id && `corretor_id.eq.${novo.corretor_id}`].filter(Boolean).join(",");
  q = q.or(ors);
  const [{ data: ex }, { data: bl }] = await Promise.all([
    q,
    novo.imovel_id ? supabase.from("imovel_indisponibilidades").select("imovel_id, inicio, fim, motivo").eq("imovel_id", novo.imovel_id).lte("inicio", fim).gte("fim", ini) : Promise.resolve({ data: [] }),
  ]);
  return conflitos({ ...novo, status: "agendada" }, (ex ?? []) as never, (bl ?? []) as never);
}

/** Lead avança para "Visita" quando agenda uma visita (nunca volta etapas). */
async function avancarLeadParaVisita(supabase: Supabase, leadId: string | null) {
  if (!leadId) return;
  const { data } = await supabase.from("leads").select("status, etapa_max, atendido_em").eq("id", leadId).single();
  if (!data || !["novo", "em_atendimento"].includes(data.status)) return;
  const agora = new Date().toISOString();
  await supabase
    .from("leads")
    .update({ status: "visita", etapa_max: Math.max(data.etapa_max ?? 0, 2), atendido_em: data.atendido_em ?? agora, ultimo_contato: agora })
    .eq("id", leadId);
  await supabase.from("lead_eventos").insert({ lead_id: leadId, tipo: "etapa", descricao: "→ Visita (agendada na agenda)" });
}

export async function criarCompromisso(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase, organizacao } = await obterContexto();
  const pessoal = organizacao.modo === "pessoal";
  let id: string;
  try {
    let tipo = texto(fd, "tipo") ?? "visita";
    if (!(TIPOS_COMPROMISSO as readonly string[]).includes(tipo) || (pessoal && TIPOS_SO_IMOBILIARIA.includes(tipo))) tipo = "visita";
    const data_hora = instante(textoObrigatorio(fd, "data", "a data"), texto(fd, "hora") ?? "09:00");
    const duracao_min = Math.min(1440, Math.max(5, inteiro(fd, "duracao_min") ?? 60));
    const imovel_id = texto(fd, "imovel_id");
    const lead_id = pessoal ? null : texto(fd, "lead_id");
    const corretor_id = pessoal ? null : texto(fd, "corretor_id");
    const pessoa_id = texto(fd, "pessoa_id");
    const contato_nome = texto(fd, "contato_nome");
    const titulo = texto(fd, "titulo");
    if (tipo === "visita" && !imovel_id) throw new ErroValidacao("Escolha o imóvel da visita.");
    if (!imovel_id && !lead_id && !pessoa_id && !contato_nome && !titulo) throw new ErroValidacao("Dê um título ou escolha o imóvel/cliente do compromisso.");
    if (!booleano(fd, "agendar_mesmo_assim")) {
      const avisos = await verificarConflitos(supabase, { id: "", data_hora, duracao_min, imovel_id, corretor_id });
      if (avisos.length) throw new ErroValidacao(`${avisos.join(" ")} Mude o horário ou marque “Agendar mesmo assim”.`);
    }
    const { data, error } = await supabase
      .from("visitas")
      .insert({
        tipo,
        titulo,
        data_hora,
        duracao_min,
        modalidade: texto(fd, "modalidade") === "virtual" ? "virtual" : "presencial",
        link_virtual: texto(fd, "link_virtual"),
        imovel_id,
        lead_id,
        corretor_id,
        pessoa_id,
        contato_nome,
        contato_telefone: texto(fd, "contato_telefone"),
        compartilhada: !booleano(fd, "privada"),
        lembrete_min: inteiro(fd, "lembrete_min") ?? 60,
        observacoes: texto(fd, "observacoes"),
      })
      .select("id")
      .single();
    if (error) throw error;
    id = data.id;
    await evento(supabase, id, "criada", `${ROTULO_TIPO_COMPROMISSO[tipo]} marcada para ${quando(data_hora)}`);
    if (tipo === "visita") await avancarLeadParaVisita(supabase, lead_id);
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidarTudo();
  if (fd.get("voltar")) return { ok: "Compromisso agendado." };
  redirect(`/agenda/${id}`);
}

/** Salva sozinho os campos da ficha do compromisso (cada quadro manda a sua parte). */
export async function atualizarCompromisso(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase, organizacao } = await obterContexto();
  const id = String(fd.get("id"));
  try {
    const d: Record<string, unknown> = {};
    for (const c of ["titulo", "observacoes", "link_virtual", "contato_nome", "contato_telefone", "feedback_texto", "feedback_proprietario", "imovel_id", "pessoa_id"])
      if (fd.has(c)) d[c] = texto(fd, c);
    if (organizacao.modo !== "pessoal") for (const c of ["lead_id", "corretor_id"]) if (fd.has(c)) d[c] = texto(fd, c);
    if (fd.has("modalidade")) d.modalidade = texto(fd, "modalidade") === "virtual" ? "virtual" : "presencial";
    if (fd.has("duracao_min")) d.duracao_min = Math.min(1440, Math.max(5, inteiro(fd, "duracao_min") ?? 60));
    if (fd.has("lembrete_min")) d.lembrete_min = inteiro(fd, "lembrete_min") ?? 0;
    if (fd.has("_privada")) d.compartilhada = !booleano(fd, "privada");
    if (fd.has("tipo")) {
      const t = texto(fd, "tipo") ?? "visita";
      if ((TIPOS_COMPROMISSO as readonly string[]).includes(t)) d.tipo = t;
    }
    if (fd.has("feedback_nota")) {
      const n = inteiro(fd, "feedback_nota");
      d.feedback_nota = n && n >= 1 && n <= 5 ? n : null;
    }
    if (fd.has("feedback_interesse")) {
      const f = texto(fd, "feedback_interesse");
      d.feedback_interesse = ["alto", "medio", "baixo", "nenhum"].includes(f ?? "") ? f : null;
    }
    const temFeedback = d.feedback_nota || d.feedback_interesse || d.feedback_texto;
    const { data: antes } = await supabase.from("visitas").select("status, lead_id, feedback_interesse, imovel:imoveis(codigo)").eq("id", id).single();
    if (temFeedback && antes?.status === "agendada") d.status = "realizada";
    const { error } = await supabase.from("visitas").update(d).eq("id", id);
    if (error) throw error;
    if (d.feedback_interesse && antes && d.feedback_interesse !== antes.feedback_interesse) {
      await evento(supabase, id, "feedback", `Retorno do cliente: ${String(d.feedback_interesse)}`);
      if (antes.lead_id) {
        const codigo = (antes.imovel as unknown as { codigo: string } | null)?.codigo;
        await supabase.from("lead_eventos").insert({
          lead_id: antes.lead_id,
          tipo: "nota",
          descricao: `Retorno da visita${codigo ? ` ao ${codigo}` : ""}: ${{ alto: "gostou muito", medio: "talvez", baixo: "pouco interesse", nenhum: "não gostou" }[String(d.feedback_interesse)]}`,
        });
      }
    }
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidarTudo();
  return { ok: "Salvo." };
}

export async function reagendarCompromisso(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  const id = String(fd.get("id"));
  try {
    const nova = instante(textoObrigatorio(fd, "data", "a nova data"), texto(fd, "hora") ?? "09:00");
    const { data: v, error: e1 } = await supabase.from("visitas").select("data_hora, duracao_min, imovel_id, corretor_id").eq("id", id).single();
    if (e1) throw e1;
    if (!booleano(fd, "agendar_mesmo_assim")) {
      const avisos = await verificarConflitos(supabase, { id, data_hora: nova, duracao_min: v.duracao_min, imovel_id: v.imovel_id, corretor_id: v.corretor_id });
      if (avisos.length) throw new ErroValidacao(`${avisos.join(" ")} Mude o horário ou marque “Agendar mesmo assim”.`);
    }
    const { error } = await supabase
      .from("visitas")
      .update({ data_hora: nova, status: "agendada", cliente_confirmado_em: null, proprietario_confirmado_em: null, checkin_em: null, checkout_em: null, motivo_cancelamento: null })
      .eq("id", id);
    if (error) throw error;
    const motivo = texto(fd, "motivo");
    await evento(supabase, id, "reagendada", `De ${quando(v.data_hora)} para ${quando(nova)}${motivo ? ` · ${motivo}` : ""}`);
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidarTudo();
  return { ok: "Reagendado." };
}

export async function cancelarCompromisso(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  const id = String(fd.get("id"));
  try {
    const motivo = textoObrigatorio(fd, "motivo", "o motivo do cancelamento");
    const { error } = await supabase.from("visitas").update({ status: "cancelada", motivo_cancelamento: motivo }).eq("id", id);
    if (error) throw error;
    await evento(supabase, id, "cancelada", motivo);
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidarTudo();
  return { ok: "Cancelado." };
}

/** Ações de um clique: confirmar cliente/proprietário, check-in, check-out, realizada, reabrir. */
export async function marcarCompromisso(fd: FormData) {
  const { supabase } = await obterContexto();
  const id = String(fd.get("id"));
  const acao = String(fd.get("acao"));
  const agora = new Date().toISOString();
  const mapa: Record<string, { campos: Record<string, unknown>; tipo: string; texto: string }> = {
    confirmar_cliente: { campos: { cliente_confirmado_em: agora }, tipo: "confirmada", texto: "Cliente confirmou" },
    desconfirmar_cliente: { campos: { cliente_confirmado_em: null }, tipo: "nota", texto: "Confirmação do cliente desfeita" },
    confirmar_proprietario: { campos: { proprietario_confirmado_em: agora }, tipo: "confirmada", texto: "Proprietário/responsável confirmou" },
    desconfirmar_proprietario: { campos: { proprietario_confirmado_em: null }, tipo: "nota", texto: "Confirmação do proprietário desfeita" },
    checkin: { campos: { checkin_em: agora }, tipo: "checkin", texto: "Check-in (chegada)" },
    checkout: { campos: { checkout_em: agora, status: "realizada" }, tipo: "checkout", texto: "Check-out (saída)" },
    realizada: { campos: { status: "realizada" }, tipo: "realizada", texto: "Marcado como realizado" },
    reabrir: { campos: { status: "agendada", motivo_cancelamento: null }, tipo: "nota", texto: "Reaberto" },
  };
  const m = mapa[acao];
  if (!m) return;
  await supabase.from("visitas").update(m.campos).eq("id", id);
  await evento(supabase, id, m.tipo, m.texto);
  revalidarTudo();
}

export async function excluirCompromisso(id: string): Promise<Resultado> {
  const { supabase } = await obterContexto();
  const { error } = await supabase.from("visitas").delete().eq("id", id);
  if (error) return { ok: false, erro: mensagemErro(error) };
  revalidarTudo();
  return { ok: true };
}

export async function adicionarParticipante(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  try {
    const pessoa_id = texto(fd, "pessoa_id");
    const nome = texto(fd, "nome");
    if (!pessoa_id && !nome) throw new ErroValidacao("Escolha uma pessoa ou digite o nome.");
    const { error } = await supabase.from("visita_participantes").insert({ visita_id: String(fd.get("visita_id")), pessoa_id, nome: pessoa_id ? null : nome, papel: texto(fd, "papel") });
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidarTudo();
  return { ok: "Participante adicionado." };
}

export async function excluirParticipante(id: string): Promise<Resultado> {
  const { supabase } = await obterContexto();
  const { error } = await supabase.from("visita_participantes").delete().eq("id", id);
  if (error) return { ok: false, erro: mensagemErro(error) };
  revalidarTudo();
  return { ok: true };
}

export async function registrarNotaCompromisso(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  try {
    await evento(supabase, String(fd.get("visita_id")), "nota", textoObrigatorio(fd, "descricao", "a anotação"));
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidarTudo();
  return { ok: "Anotado." };
}

export async function excluirEventoCompromisso(id: string): Promise<Resultado> {
  const { supabase } = await obterContexto();
  const { error } = await supabase.from("visita_eventos").delete().eq("id", id);
  if (error) return { ok: false, erro: mensagemErro(error) };
  revalidarTudo();
  return { ok: true };
}

// Disponibilidade do imóvel ---------------------------------------------------
export async function salvarHorarioVisitas(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  const { error } = await supabase.from("imoveis").update({ horario_visitas: texto(fd, "horario_visitas") }).eq("id", String(fd.get("imovel_id")));
  if (error) return { erro: mensagemErro(error) };
  revalidarTudo();
  return { ok: "Salvo." };
}

export async function adicionarIndisponibilidade(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  try {
    const inicio = instante(textoObrigatorio(fd, "inicio_data", "o início"), texto(fd, "inicio_hora") ?? "00:00");
    const fim = instante(textoObrigatorio(fd, "fim_data", "o fim"), texto(fd, "fim_hora") ?? "23:59");
    if (fim <= inicio) throw new ErroValidacao("O fim precisa ser depois do início.");
    const { error } = await supabase.from("imovel_indisponibilidades").insert({ imovel_id: String(fd.get("imovel_id")), inicio, fim, motivo: texto(fd, "motivo") });
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidarTudo();
  return { ok: "Período bloqueado." };
}

export async function excluirIndisponibilidade(id: string): Promise<Resultado> {
  const { supabase } = await obterContexto();
  const { error } = await supabase.from("imovel_indisponibilidades").delete().eq("id", id);
  if (error) return { ok: false, erro: mensagemErro(error) };
  revalidarTudo();
  return { ok: true };
}

/** Troca o link do calendário (o antigo para de funcionar no celular). */
export async function novoTokenAgenda(): Promise<Resultado> {
  const { supabase, organizacao } = await obterContexto();
  const { error } = await supabase.from("organizacoes").update({ agenda_token: crypto.randomUUID() }).eq("id", organizacao.id);
  if (error) return { ok: false, erro: mensagemErro(error) };
  revalidarTudo();
  return { ok: true };
}
