"use server";

import { revalidatePath } from "next/cache";
import { obterContexto } from "@/lib/contexto";
import { type EstadoAcao, booleano, mensagemErro, texto, textoObrigatorio } from "@/lib/form";
import { gerarFaturasDaCompetencia, liquidarFatura } from "@/lib/servicos/locacao";

export async function gerarFaturasDoMes(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  try {
    const comp = textoObrigatorio(fd, "competencia", "a competência");
    const r = await gerarFaturasDaCompetencia(supabase, `${comp}-01`);
    revalidatePath("/faturas");
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
  revalidatePath("/faturas");
  return { ok: "Fatura cancelada." };
}
