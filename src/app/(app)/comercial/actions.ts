"use server";

import { revalidatePath } from "next/cache";
import { obterContexto } from "@/lib/contexto";
import { type EstadoAcao, ErroValidacao, booleano, lista, mensagemErro, numero, texto, textoObrigatorio } from "@/lib/form";
import { FUNIS, TODAS_ETAPAS, ordemEtapa, rotuloEtapa, type Funil } from "@/lib/dominio/crm";
import { TIPOS_META } from "@/lib/tipos";

function revalidarTudo() {
  revalidatePath("/comercial", "layout");
  revalidatePath("/");
}

type Supabase = Awaited<ReturnType<typeof obterContexto>>["supabase"];
type Resultado = { ok: boolean; erro?: string };

/** Lê só os campos do lead que vieram no formulário (cada tela salva a sua parte). */
function lerLead(fd: FormData) {
  const d: Record<string, unknown> = {};
  if (fd.has("nome")) d.nome = textoObrigatorio(fd, "nome", "o nome");
  for (const c of ["telefone", "email", "regioes", "observacoes", "proximo_contato"]) if (fd.has(c)) d[c] = texto(fd, c);
  if (fd.has("origem")) d.origem = texto(fd, "origem") ?? "outro";
  if (fd.has("prioridade")) d.prioridade = texto(fd, "prioridade") ?? "morno";
  if (fd.has("funil")) {
    const f = texto(fd, "funil");
    d.funil = FUNIS.includes(f as Funil) ? f : "locacao";
    d.interesse = d.funil === "venda" ? "compra" : "locacao";
  }
  for (const c of ["orcamento_min", "orcamento_max"]) if (fd.has(c)) d[c] = numero(fd, c);
  if (fd.has("quartos_min")) d.quartos_min = numero(fd, "quartos_min");
  if (fd.has("_tipos")) d.tipos = lista(fd, "tipos");
  if (fd.has("etiquetas"))
    d.etiquetas = [...new Set((texto(fd, "etiquetas") ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean))].slice(0, 20);
  if (typeof d.orcamento_min === "number" && typeof d.orcamento_max === "number" && d.orcamento_min > d.orcamento_max)
    throw new ErroValidacao("O orçamento mínimo está maior que o máximo.");
  if (typeof d.email === "string") d.email = d.email.toLowerCase();
  return d;
}

/** Lead aberto que já tem o mesmo telefone ou e-mail. */
async function leadRepetido(supabase: Supabase, telefone: string | null, email: string | null, ignorar?: string) {
  const dig = (telefone ?? "").replace(/\D/g, "").slice(-9);
  if (dig.length < 8 && !email) return null;
  const { data } = await supabase.from("leads").select("id, nome, telefone, email, status").not("status", "in", "(ganho,perdido)");
  return (
    (data ?? []).find(
      (l) =>
        l.id !== ignorar &&
        ((email && (l.email ?? "").toLowerCase() === email.toLowerCase()) ||
          (dig.length >= 8 && (l.telefone ?? "").replace(/\D/g, "").slice(-9) === dig)),
    ) ?? null
  );
}

async function evento(supabase: Supabase, leadId: string, tipo: string, descricao: string | null) {
  await supabase.from("lead_eventos").insert({ lead_id: leadId, tipo, descricao });
}

async function nomeCorretor(supabase: Supabase, id: string | null) {
  if (!id) return "ninguém";
  const { data } = await supabase.from("pessoas").select("nome").eq("id", id).maybeSingle();
  return (data?.nome as string) ?? "corretor";
}

export async function criarLead(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  try {
    const dados = lerLead(fd);
    if (!booleano(fd, "criar_mesmo_assim")) {
      const rep = await leadRepetido(supabase, (dados.telefone as string) ?? null, (dados.email as string) ?? null);
      if (rep)
        throw new ErroValidacao(
          `Já existe um lead em aberto com esse telefone/e-mail: ${rep.nome}. Abra o cadastro dele em Leads — ou marque "Criar mesmo assim".`,
        );
    }
    let corretor = texto(fd, "corretor_id");
    if (corretor === "auto") {
      const { data } = await supabase.rpc("proximo_corretor_lead");
      corretor = (data as string | null) ?? null;
    }
    const agora = new Date().toISOString();
    const { data, error } = await supabase
      .from("leads")
      .insert({ ...dados, corretor_id: corretor, atribuido_em: corretor ? agora : null, ultimo_contato: agora })
      .select("id")
      .single();
    if (error) throw error;
    await evento(supabase, data.id, "entrada", `Cadastrado na imobiliária${corretor ? ` · atendido por ${await nomeCorretor(supabase, corretor)}` : ""}`);
    const imovel = texto(fd, "imovel_id");
    if (imovel) await supabase.from("lead_imoveis").insert({ lead_id: data.id, imovel_id: imovel });
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidarTudo();
  return { ok: "Lead cadastrado." };
}

/**
 * Muda a etapa: registra no histórico, marca o 1º atendimento, guarda até onde
 * o lead chegou (para a conversão) e o motivo quando é perdido.
 */
async function aplicarEtapa(supabase: Supabase, id: string, status: string, motivo?: string | null) {
  if (!(TODAS_ETAPAS as readonly string[]).includes(status)) throw new ErroValidacao("Etapa inválida.");
  const { data: atual, error: e1 } = await supabase.from("leads").select("status, etapa_max, atendido_em, funil").eq("id", id).single();
  if (e1) throw e1;
  if (atual.status === status) return;
  if (status === "perdido" && !motivo) throw new ErroValidacao("Escolha o motivo da perda.");
  const agora = new Date().toISOString();
  const dados: Record<string, unknown> = { status, ultimo_contato: agora };
  if (status !== "novo" && !atual.atendido_em) dados.atendido_em = agora;
  const ordem = ordemEtapa(status);
  if (ordem > atual.etapa_max) dados.etapa_max = ordem;
  if (status === "perdido") {
    dados.motivo_perda = motivo;
    dados.perdido_em = agora;
  }
  const { error } = await supabase.from("leads").update(dados).eq("id", id);
  if (error) throw error;
  await evento(
    supabase,
    id,
    status === "perdido" ? "perda" : "etapa",
    status === "perdido"
      ? `Perdido: ${motivo}`
      : `${rotuloEtapa(atual.funil, atual.status)} → ${rotuloEtapa(atual.funil, status)}`,
  );
}

export async function moverLead(id: string, status: string, motivo?: string | null): Promise<Resultado> {
  const { supabase } = await obterContexto();
  try {
    await aplicarEtapa(supabase, id, status, motivo);
  } catch (e) {
    return { ok: false, erro: mensagemErro(e) };
  }
  revalidarTudo();
  return { ok: true };
}

export async function atualizarLead(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  const id = String(fd.get("id"));
  try {
    const dados = lerLead(fd);
    if (Object.keys(dados).length) {
      const { error } = await supabase.from("leads").update(dados).eq("id", id);
      if (error) throw error;
    }
    const status = texto(fd, "status");
    if (status) await aplicarEtapa(supabase, id, status, texto(fd, "motivo_perda"));
    if (status === "perdido" && texto(fd, "motivo_perda"))
      await supabase.from("leads").update({ motivo_perda: texto(fd, "motivo_perda") }).eq("id", id);
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidarTudo();
  return { ok: "Lead salvo." };
}

export async function excluirLead(id: string): Promise<Resultado> {
  const { supabase } = await obterContexto();
  const { error } = await supabase.from("leads").delete().eq("id", id);
  if (error) return { ok: false, erro: mensagemErro(error) };
  revalidarTudo();
  return { ok: true };
}

/** Registra ligação, WhatsApp, e-mail, reunião ou anotação no histórico do lead. */
export async function registrarContatoLead(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  const id = String(fd.get("lead_id"));
  try {
    const tipo = texto(fd, "tipo") ?? "nota";
    const { error } = await supabase.from("lead_eventos").insert({ lead_id: id, tipo, descricao: textoObrigatorio(fd, "descricao", "o que foi conversado") });
    if (error) throw error;
    const proximo = texto(fd, "proximo_contato");
    const upd: Record<string, unknown> = { ultimo_contato: new Date().toISOString() };
    if (proximo) upd.proximo_contato = proximo;
    if (tipo !== "nota") {
      const { data } = await supabase.from("leads").select("status, atendido_em").eq("id", id).single();
      if (data && !data.atendido_em) upd.atendido_em = new Date().toISOString();
      await supabase.from("leads").update(upd).eq("id", id);
      if (data?.status === "novo") await aplicarEtapa(supabase, id, "em_atendimento");
    } else if (proximo) await supabase.from("leads").update({ proximo_contato: proximo }).eq("id", id);
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidarTudo();
  return { ok: "Registrado." };
}

export async function excluirEventoLead(id: string): Promise<Resultado> {
  const { supabase } = await obterContexto();
  const { error } = await supabase.from("lead_eventos").delete().eq("id", id);
  if (error) return { ok: false, erro: mensagemErro(error) };
  revalidarTudo();
  return { ok: true };
}

/** Passa o atendimento para outro corretor (fica no histórico). */
export async function transferirLead(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  const id = String(fd.get("lead_id"));
  try {
    let novo = texto(fd, "corretor_id");
    if (novo === "auto") {
      const { data } = await supabase.rpc("proximo_corretor_lead");
      novo = (data as string | null) ?? null;
    }
    const { data: atual } = await supabase.from("leads").select("corretor_id").eq("id", id).single();
    if ((atual?.corretor_id ?? null) === novo) throw new ErroValidacao("Esse já é o corretor do lead.");
    const { error } = await supabase.from("leads").update({ corretor_id: novo, atribuido_em: novo ? new Date().toISOString() : null }).eq("id", id);
    if (error) throw error;
    const motivo = texto(fd, "motivo");
    await evento(
      supabase,
      id,
      "transferencia",
      `${await nomeCorretor(supabase, atual?.corretor_id ?? null)} → ${await nomeCorretor(supabase, novo)}${motivo ? ` · ${motivo}` : ""}`,
    );
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidarTudo();
  return { ok: "Atendimento transferido." };
}

export async function associarImovelLead(leadId: string, imovelId: string): Promise<Resultado> {
  const { supabase } = await obterContexto();
  const { error } = await supabase.from("lead_imoveis").upsert({ lead_id: leadId, imovel_id: imovelId }, { onConflict: "lead_id,imovel_id" });
  if (error) return { ok: false, erro: mensagemErro(error) };
  revalidarTudo();
  return { ok: true };
}

export async function desassociarImovelLead(chave: string): Promise<Resultado> {
  const [leadId, imovelId] = chave.split("|");
  const { supabase } = await obterContexto();
  const { error } = await supabase.from("lead_imoveis").delete().eq("lead_id", leadId).eq("imovel_id", imovelId);
  if (error) return { ok: false, erro: mensagemErro(error) };
  revalidarTudo();
  return { ok: true };
}

/** Traz de volta um contato antigo para o funil. */
export async function reativarLead(id: string): Promise<Resultado> {
  const { supabase } = await obterContexto();
  try {
    const hoje = new Date().toISOString().slice(0, 10);
    const { error } = await supabase
      .from("leads")
      .update({ status: "em_atendimento", proximo_contato: hoje, ultimo_contato: new Date().toISOString() })
      .eq("id", id);
    if (error) throw error;
    await evento(supabase, id, "reativacao", "Contato reativado");
  } catch (e) {
    return { ok: false, erro: mensagemErro(e) };
  }
  revalidarTudo();
  return { ok: true };
}

/** Configuração da captação: rodízio e quem recebe leads. */
export async function salvarCaptacao(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase, organizacao } = await obterContexto();
  try {
    const { error } = await supabase
      .from("organizacoes")
      .update({ distribuicao_leads: texto(fd, "distribuicao_leads") === "rodizio" ? "rodizio" : "manual" })
      .eq("id", organizacao.id);
    if (error) throw error;
    const recebem = new Set(lista(fd, "recebe"));
    const { data: corretores } = await supabase.from("pessoas").select("id, recebe_leads").contains("papeis", ["corretor"]);
    for (const c of corretores ?? []) {
      const quer = recebem.has(c.id as string);
      if (quer !== c.recebe_leads) await supabase.from("pessoas").update({ recebe_leads: quer }).eq("id", c.id);
    }
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidarTudo();
  return { ok: "Configuração salva." };
}

/** Troca o link de captação (o antigo para de funcionar). */
export async function novoLinkCaptacao(): Promise<Resultado> {
  const { supabase, organizacao } = await obterContexto();
  const { error } = await supabase.from("organizacoes").update({ leads_token: crypto.randomUUID() }).eq("id", organizacao.id);
  if (error) return { ok: false, erro: mensagemErro(error) };
  revalidarTudo();
  return { ok: true };
}

/** Só muda a etapa do funil (seletor do cartão). */
export async function mudarStatusLead(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const r = await moverLead(String(fd.get("id")), String(fd.get("status")), texto(fd, "motivo_perda"));
  return r.ok ? { ok: "Etapa atualizada." } : { erro: r.erro };
}

/** Avança o lead no funil sem voltar etapas (ex.: agendou visita → "visita"). */
async function avancarLead(supabase: Supabase, leadId: string | null, para: "visita" | "proposta") {
  if (!leadId) return;
  const { data } = await supabase.from("leads").select("status").eq("id", leadId).single();
  if (!data || data.status === "ganho" || data.status === "perdido" || ordemEtapa(data.status) >= ordemEtapa(para)) return;
  await aplicarEtapa(supabase, leadId, para);
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
