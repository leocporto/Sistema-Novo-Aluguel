"use server";

import { revalidatePath } from "next/cache";
import { obterContexto } from "@/lib/contexto";
import { hojeISO, somarMeses } from "@/lib/dominio/datas";
import { paraCentavos } from "@/lib/dominio/dinheiro";
import { precisaAprovacao } from "@/lib/dominio/financeiro";
import { type EstadoAcao, ErroValidacao, booleano, inteiro, mensagemErro, numero, texto, textoObrigatorio } from "@/lib/form";

function revalidar() {
  revalidatePath("/despesas");
  revalidatePath("/financeiro", "layout");
  revalidatePath("/");
}

type Supabase = Awaited<ReturnType<typeof obterContexto>>["supabase"];

async function limiteAprovacao(supabase: Supabase, orgId: string): Promise<number | null> {
  const { data } = await supabase.from("organizacoes").select("aprovacao_pagamento_acima").eq("id", orgId).single();
  return data?.aprovacao_pagamento_acima == null ? null : Number(data.aprovacao_pagamento_acima);
}

const MSG_APROVACAO = "Esta despesa passa do limite de aprovação. Um administrador ou gestor precisa aprovar (Financeiro → lançamento → Aprovar) antes de marcar como paga.";

/** Lançamentos que esta tela não pode mexer (vêm de outro módulo). */
function bloqueio(l: { fatura_id?: string | null; adiantamento?: boolean | null; compensado_em?: string | null } | null) {
  if (!l) return "Despesa não encontrada.";
  if (l.fatura_id) return "Este lançamento veio do pagamento de um aluguel. Use Aluguéis do mês.";
  if (l.adiantamento && l.compensado_em) return "Este adiantamento já foi descontado no repasse. Desfaça o desconto em Financeiro → Proprietários.";
  return null;
}

function lerDespesa(fd: FormData, pessoal: boolean) {
  const valor = numero(fd, "valor");
  if (!valor || valor <= 0) throw new ErroValidacao("Informe o valor.");
  const imovel_id = texto(fd, "imovel_id");
  if (pessoal && !imovel_id) throw new ErroValidacao("Escolha o imóvel da despesa.");
  return {
    descricao: textoObrigatorio(fd, "descricao", "a descrição"),
    categoria: texto(fd, "categoria") ?? "Outros",
    valor,
    vencimento: textoObrigatorio(fd, "vencimento", "o vencimento"),
    imovel_id,
  };
}

export async function criarDespesa(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase, organizacao } = await obterContexto();
  let aviso = "";
  try {
    const base = lerDespesa(fd, organizacao.modo === "pessoal");
    const repetir = texto(fd, "repetir") === "mensal";
    const vezes = repetir ? (inteiro(fd, "meses") ?? 12) : 1;
    if (vezes < 1 || vezes > 60) throw new ErroValidacao("Repita entre 1 e 60 meses.");
    const serie_id = vezes > 1 ? crypto.randomUUID() : null;
    // Valor acima do limite de aprovação: lança em aberto (a aprovação vem antes do pagamento).
    const aprovar = precisaAprovacao("pagar", base.valor, await limiteAprovacao(supabase, organizacao.id));
    const pago = booleano(fd, "pago") && !aprovar;
    if (booleano(fd, "pago") && aprovar) aviso = " Ficou em aberto: o valor precisa de aprovação de um administrador ou gestor antes de marcar como paga.";
    const linhas = Array.from({ length: vezes }, (_, i) => ({
      ...base,
      tipo: "pagar" as const,
      vencimento: somarMeses(base.vencimento, i),
      descricao: vezes > 1 ? `${base.descricao} (${i + 1}/${vezes})` : base.descricao,
      serie_id,
      status: pago && i === 0 ? "liquidado" : "aberto",
      liquidado_em: pago && i === 0 ? hojeISO() : null,
      valor_pago: pago && i === 0 ? base.valor : null,
    }));
    const { error } = await supabase.from("lancamentos").insert(linhas);
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: `Despesa lançada.${aviso}` };
}

export async function atualizarDespesa(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase, organizacao } = await obterContexto();
  const id = String(fd.get("id"));
  try {
    const { data: atual } = await supabase.from("lancamentos").select("status, valor, fatura_id, adiantamento, compensado_em").eq("id", id).eq("tipo", "pagar").maybeSingle();
    const b = bloqueio(atual);
    if (b) throw new ErroValidacao(b);
    const d: Record<string, unknown> = lerDespesa(fd, organizacao.modo === "pessoal");
    // O formulário reenvia tudo: só conta como mudança de valor se for outro valor.
    if (paraCentavos(Number(d.valor)) === paraCentavos(Number(atual!.valor))) delete d.valor;
    else if (atual!.status === "liquidado") throw new ErroValidacao("Para mudar o valor de uma despesa paga, desfaça o pagamento antes.");
    const { error } = await supabase.from("lancamentos").update(d).eq("id", id).eq("tipo", "pagar");
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Despesa salva." };
}

/**
 * Marca como paga hoje (pelo valor da despesa) ou desfaz o pagamento. Segue as
 * mesmas regras do Financeiro: aprovação acima do limite, nada de mexer em
 * lançamento de aluguel, e desfazer limpa juros/desconto/conciliação.
 */
export async function marcarDespesaPaga(id: string, pago: boolean): Promise<{ ok: boolean; erro?: string }> {
  const { supabase, organizacao } = await obterContexto();
  const { data: l } = await supabase.from("lancamentos").select("status, valor, aprovado_em, fatura_id, adiantamento, compensado_em").eq("id", id).eq("tipo", "pagar").maybeSingle();
  const b = bloqueio(l);
  if (b) return { ok: false, erro: b };
  if (pago) {
    if (l!.status !== "aberto") return { ok: false, erro: "Esta despesa não está em aberto." };
    if (!l!.aprovado_em && precisaAprovacao("pagar", Number(l!.valor), await limiteAprovacao(supabase, organizacao.id))) return { ok: false, erro: MSG_APROVACAO };
    const { data: feito, error } = await supabase
      .from("lancamentos")
      .update({ status: "liquidado", liquidado_em: hojeISO(), valor_pago: l!.valor, juros: 0, desconto: 0 })
      .eq("id", id)
      .eq("status", "aberto")
      .select("id");
    if (error) return { ok: false, erro: mensagemErro(error).includes("limite de aprovação") ? MSG_APROVACAO : mensagemErro(error) };
    if (!feito?.length) return { ok: false, erro: "Esta despesa não está mais em aberto." };
  } else {
    const { data: feito, error } = await supabase
      .from("lancamentos")
      .update({ status: "aberto", liquidado_em: null, valor_pago: null, juros: 0, desconto: 0, conciliado_em: null })
      .eq("id", id)
      .eq("status", "liquidado")
      .select("id");
    if (error) return { ok: false, erro: mensagemErro(error) };
    if (!feito?.length) return { ok: false, erro: "Esta despesa não está paga." };
    await supabase.from("extrato_itens").update({ lancamento_id: null }).eq("lancamento_id", id);
  }
  revalidar();
  return { ok: true };
}

export async function excluirDespesa(id: string, proximas: boolean): Promise<{ ok: boolean; erro?: string }> {
  const { supabase } = await obterContexto();
  const { data: d } = await supabase.from("lancamentos").select("serie_id, vencimento, fatura_id, adiantamento, compensado_em").eq("id", id).maybeSingle();
  const b = bloqueio(d);
  if (b) return { ok: false, erro: b };
  const r =
    proximas && d?.serie_id
      ? await supabase.from("lancamentos").delete().eq("serie_id", d.serie_id).gte("vencimento", d.vencimento).eq("tipo", "pagar").neq("status", "liquidado").is("fatura_id", null)
      : await supabase.from("lancamentos").delete().eq("id", id).eq("tipo", "pagar");
  if (r.error) return { ok: false, erro: mensagemErro(r.error) };
  revalidar();
  return { ok: true };
}

export async function salvarComprovanteDespesa(id: string, caminho: string): Promise<{ ok: boolean; erro?: string }> {
  const { supabase, organizacao } = await obterContexto();
  if (!caminho.startsWith(`${organizacao.id}/despesas/${id}/`)) return { ok: false, erro: "Caminho de comprovante inválido." };
  const { error } = await supabase.from("lancamentos").update({ comprovante_path: caminho }).eq("id", id);
  if (error) return { ok: false, erro: mensagemErro(error) };
  revalidar();
  return { ok: true };
}

export async function linkComprovanteDespesa(id: string): Promise<{ ok: boolean; url?: string; erro?: string }> {
  const { supabase } = await obterContexto();
  const { data: l } = await supabase.from("lancamentos").select("comprovante_path").eq("id", id).maybeSingle();
  if (!l?.comprovante_path) return { ok: false, erro: "Esta despesa não tem comprovante." };
  const { data, error } = await supabase.storage.from("comprovantes").createSignedUrl(l.comprovante_path as string, 300);
  if (error || !data) return { ok: false, erro: "Não foi possível abrir o comprovante." };
  return { ok: true, url: data.signedUrl };
}
