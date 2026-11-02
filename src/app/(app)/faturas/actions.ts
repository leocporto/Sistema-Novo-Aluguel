"use server";

import { revalidatePath } from "next/cache";
import { obterContexto } from "@/lib/contexto";
import { type EstadoAcao, booleano, mensagemErro, texto, textoObrigatorio } from "@/lib/form";
import { carregarContrato, gerarFaturaDoContrato, gerarFaturasDaCompetencia, liquidarFatura } from "@/lib/servicos/locacao";

export async function gerarFaturasDoMes(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  try {
    const comp = textoObrigatorio(fd, "competencia", "a competência");
    const r = await gerarFaturasDaCompetencia(supabase, `${comp}-01`);
    revalidatePath("/faturas");
    revalidatePath("/");
    const partes = [`${r.criadas} fatura(s) gerada(s)`, `${r.ignoradas} contrato(s) sem nova cobrança`];
    if (r.erros.length) return { erro: `${partes.join(", ")}. Problemas: ${r.erros.join(" | ")}` };
    return { ok: `${partes.join(", ")}.` };
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
}

export async function darBaixa(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  const id = String(fd.get("fatura_id"));
  try {
    await liquidarFatura(supabase, id, {
      pagoEm: textoObrigatorio(fd, "pago_em", "a data do pagamento"),
      formaPagamento: texto(fd, "forma_pagamento") ?? "pix",
      dispensarEncargos: booleano(fd, "dispensar"),
    });
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidatePath(`/faturas/${id}`);
  revalidatePath("/");
  revalidatePath("/faturas");
  revalidatePath("/repasses");
  return { ok: "Pagamento registrado e repasse gerado." };
}

export async function cancelarFatura(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  const id = String(fd.get("fatura_id"));
  try {
    const { error } = await supabase
      .from("faturas")
      .update({ status: "cancelada", observacoes: texto(fd, "motivo") })
      .eq("id", id)
      .eq("status", "aberta");
    if (error) throw error;
    await supabase.from("repasses").update({ status: "cancelado" }).eq("fatura_id", id).eq("status", "pendente");
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidatePath(`/faturas/${id}`);
  revalidatePath("/");
  revalidatePath("/faturas");
  return { ok: "Fatura cancelada." };
}

function revalidarTelas() {
  for (const p of ["/faturas", "/", "/repasses", "/regua", "/financeiro"]) revalidatePath(p);
}

/**
 * Check de "pago" no controle do mês: gera a fatura da competência se ainda não
 * existir e dá a baixa (multa/juros, repasse e taxa no financeiro).
 */
export async function marcarPago(dados: {
  contratoId: string;
  competencia: string;
  faturaId: string | null;
  pagoEm: string;
  formaPagamento: string;
  dispensarEncargos: boolean;
}): Promise<{ ok: boolean; erro?: string }> {
  const { supabase } = await obterContexto();
  try {
    let faturaId = dados.faturaId;
    if (!faturaId) {
      const c = await carregarContrato(supabase, dados.contratoId);
      if (!c) return { ok: false, erro: "Contrato não encontrado." };
      faturaId = await gerarFaturaDoContrato(supabase, c, dados.competencia);
      if (!faturaId) {
        const { data } = await supabase
          .from("faturas")
          .select("id")
          .eq("contrato_id", dados.contratoId)
          .eq("competencia", dados.competencia)
          .neq("status", "cancelada")
          .maybeSingle();
        faturaId = (data?.id as string | undefined) ?? null;
      }
      if (!faturaId) return { ok: false, erro: "O contrato não tem aluguel a cobrar neste mês." };
    }
    await liquidarFatura(supabase, faturaId, {
      pagoEm: dados.pagoEm,
      formaPagamento: dados.formaPagamento,
      dispensarEncargos: dados.dispensarEncargos,
    });
  } catch (e) {
    return { ok: false, erro: mensagemErro(e) };
  }
  revalidarTelas();
  return { ok: true };
}

/** Desmarca o check: desfaz a baixa (só se o repasse ao proprietário ainda não foi pago). */
export async function desfazerPagamento(faturaId: string): Promise<{ ok: boolean; erro?: string }> {
  const { supabase } = await obterContexto();
  const { error } = await supabase.rpc("estornar_baixa", { p_fatura_id: faturaId });
  if (error) return { ok: false, erro: mensagemErro(error) };
  revalidarTelas();
  revalidatePath(`/faturas/${faturaId}`);
  return { ok: true };
}
