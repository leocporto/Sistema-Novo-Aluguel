"use server";

import { revalidatePath } from "next/cache";
import { obterContexto } from "@/lib/contexto";
import { type EstadoAcao, ErroValidacao, booleano, mensagemErro, numero, texto, textoObrigatorio } from "@/lib/form";
import { TIPOS_META } from "@/lib/tipos";

function revalidarTudo() {
  revalidatePath("/comercial", "layout");
  revalidatePath("/");
}

function lerLead(fd: FormData) {
  return {
    nome: textoObrigatorio(fd, "nome", "o nome"),
    telefone: texto(fd, "telefone"),
    email: texto(fd, "email"),
    origem: texto(fd, "origem") ?? "outro",
    interesse: texto(fd, "interesse") === "compra" ? "compra" : "locacao",
    imovel_id: texto(fd, "imovel_id"),
    observacoes: texto(fd, "observacoes"),
  };
}

export async function criarLead(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  try {
    const { error } = await supabase.from("leads").insert(lerLead(fd));
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidarTudo();
  return { ok: "Lead cadastrado." };
}

export async function atualizarLead(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  const id = String(fd.get("id"));
  try {
    const dados: Record<string, unknown> = lerLead(fd);
    const status = texto(fd, "status");
    if (status) {
      dados.status = status;
      if (status !== "novo") {
        const { data } = await supabase.from("leads").select("atendido_em").eq("id", id).single();
        if (data && !data.atendido_em) dados.atendido_em = new Date().toISOString();
      }
    }
    const { error } = await supabase.from("leads").update(dados).eq("id", id);
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidarTudo();
  return { ok: "Lead salvo." };
}

/** Só muda a etapa do funil (seletor do cartão). */
export async function mudarStatusLead(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  const id = String(fd.get("id"));
  const status = texto(fd, "status");
  if (!status) return { erro: "Escolha a etapa." };
  const dados: Record<string, unknown> = { status };
  if (status !== "novo") {
    const { data } = await supabase.from("leads").select("atendido_em").eq("id", id).single();
    if (data && !data.atendido_em) dados.atendido_em = new Date().toISOString();
  }
  const { error } = await supabase.from("leads").update(dados).eq("id", id);
  if (error) return { erro: mensagemErro(error) };
  revalidarTudo();
  return { ok: "Etapa atualizada." };
}

type Resultado = { ok: boolean; erro?: string };

export async function excluirLead(id: string): Promise<Resultado> {
  const { supabase } = await obterContexto();
  const { error } = await supabase.from("leads").delete().eq("id", id);
  if (error) return { ok: false, erro: mensagemErro(error) };
  revalidarTudo();
  return { ok: true };
}

/** Avança o lead no funil sem voltar etapas (ex.: agendou visita → "visita"). */
async function avancarLead(supabase: Awaited<ReturnType<typeof obterContexto>>["supabase"], leadId: string | null, para: "visita" | "proposta") {
  if (!leadId) return;
  const ordem = ["novo", "em_atendimento", "visita", "proposta", "ganho", "perdido"];
  const { data } = await supabase.from("leads").select("status, atendido_em").eq("id", leadId).single();
  if (!data || ordem.indexOf(data.status) >= ordem.indexOf(para)) return;
  await supabase
    .from("leads")
    .update({ status: para, atendido_em: data.atendido_em ?? new Date().toISOString() })
    .eq("id", leadId);
}

// Visitas -------------------------------------------------------------------
export async function criarVisita(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  try {
    const data = textoObrigatorio(fd, "data", "a data");
    const hora = texto(fd, "hora") ?? "09:00";
    const leadId = texto(fd, "lead_id");
    const imovelId = texto(fd, "imovel_id");
    if (!leadId && !imovelId) throw new ErroValidacao("Escolha o cliente (lead) ou o imóvel da visita.");
    const { error } = await supabase.from("visitas").insert({
      lead_id: leadId,
      imovel_id: imovelId,
      corretor_id: texto(fd, "corretor_id"),
      // Horário de Brasília
      data_hora: `${data}T${hora}:00-03:00`,
      observacoes: texto(fd, "observacoes"),
    });
    if (error) throw error;
    await avancarLead(supabase, leadId, "visita");
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidarTudo();
  return { ok: "Visita agendada." };
}

export async function mudarStatusVisita(fd: FormData) {
  const { supabase } = await obterContexto();
  const status = String(fd.get("status"));
  if (!["agendada", "realizada", "cancelada"].includes(status)) return;
  await supabase.from("visitas").update({ status }).eq("id", String(fd.get("id")));
  revalidarTudo();
}

export async function excluirVisita(id: string): Promise<Resultado> {
  const { supabase } = await obterContexto();
  const { error } = await supabase.from("visitas").delete().eq("id", id);
  if (error) return { ok: false, erro: mensagemErro(error) };
  revalidarTudo();
  return { ok: true };
}

// Propostas -----------------------------------------------------------------
export async function criarProposta(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  try {
    const valor = numero(fd, "valor");
    if (!valor || valor <= 0) throw new ErroValidacao("Informe o valor da proposta.");
    const leadId = texto(fd, "lead_id");
    const imovelId = texto(fd, "imovel_id");
    if (!imovelId) throw new ErroValidacao("Escolha o imóvel da proposta.");
    const pct = numero(fd, "comissao_pct");
    if (pct !== null && (pct < 0 || pct > 100)) throw new ErroValidacao("A comissão deve ficar entre 0% e 100%.");
    const { error } = await supabase.from("propostas").insert({
      lead_id: leadId,
      imovel_id: imovelId,
      tipo: texto(fd, "tipo") === "venda" ? "venda" : "locacao",
      valor,
      corretor_id: texto(fd, "corretor_id"),
      comissao_pct: pct,
      observacoes: texto(fd, "observacoes"),
    });
    if (error) throw error;
    await avancarLead(supabase, leadId, "proposta");
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidarTudo();
  return { ok: "Proposta registrada." };
}

export async function aceitarProposta(fd: FormData) {
  const { supabase } = await obterContexto();
  await supabase.rpc("aceitar_proposta", { p_id: String(fd.get("id")) });
  revalidarTudo();
  revalidatePath("/imoveis");
  revalidatePath("/despesas");
  revalidatePath("/financeiro");
}

export async function recusarProposta(fd: FormData) {
  const { supabase } = await obterContexto();
  await supabase
    .from("propostas")
    .update({ status: "recusada", fechada_em: new Date().toISOString().slice(0, 10) })
    .eq("id", String(fd.get("id")))
    .eq("status", "em_negociacao");
  revalidarTudo();
}

/** Exclui a proposta; se ela tinha gerado comissão ainda não paga, a comissão sai junto. */
export async function excluirProposta(id: string): Promise<Resultado> {
  const { supabase } = await obterContexto();
  const { error: e1 } = await supabase.from("lancamentos").delete().eq("proposta_id", id).eq("status", "aberto");
  if (e1) return { ok: false, erro: mensagemErro(e1) };
  const { error } = await supabase.from("propostas").delete().eq("id", id);
  if (error) return { ok: false, erro: mensagemErro(error) };
  revalidarTudo();
  revalidatePath("/despesas");
  revalidatePath("/financeiro");
  return { ok: true };
}

// Tarefas -------------------------------------------------------------------
export async function criarTarefa(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  try {
    const { error } = await supabase.from("tarefas").insert({
      titulo: textoObrigatorio(fd, "titulo", "o que precisa ser feito"),
      vencimento: texto(fd, "vencimento"),
      prioridade: booleano(fd, "alta") ? "alta" : "normal",
      lead_id: texto(fd, "lead_id"),
      imovel_id: texto(fd, "imovel_id"),
      contrato_id: texto(fd, "contrato_id"),
    });
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidarTudo();
  return { ok: "Tarefa criada." };
}

export async function alternarTarefa(fd: FormData) {
  const { supabase } = await obterContexto();
  const concluir = String(fd.get("concluir")) === "1";
  await supabase
    .from("tarefas")
    .update({ concluida: concluir, concluida_em: concluir ? new Date().toISOString() : null })
    .eq("id", String(fd.get("id")));
  revalidarTudo();
}

export async function excluirTarefa(id: string): Promise<Resultado> {
  const { supabase } = await obterContexto();
  const { error } = await supabase.from("tarefas").delete().eq("id", id);
  if (error) return { ok: false, erro: mensagemErro(error) };
  revalidarTudo();
  return { ok: true };
}

// Metas ---------------------------------------------------------------------
export async function salvarMetas(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  try {
    const mes = textoObrigatorio(fd, "mes");
    const competencia = `${mes}-01`;
    for (const tipo of TIPOS_META) {
      const v = numero(fd, tipo);
      if (v === null) {
        const { error } = await supabase.from("metas").delete().eq("competencia", competencia).eq("tipo", tipo);
        if (error) throw error;
      } else {
        if (v < 0) throw new ErroValidacao("A meta não pode ser negativa.");
        const { error } = await supabase.from("metas").upsert({ competencia, tipo, valor: v }, { onConflict: "organizacao_id,competencia,tipo" });
        if (error) throw error;
      }
    }
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidarTudo();
  return { ok: "Metas salvas." };
}
