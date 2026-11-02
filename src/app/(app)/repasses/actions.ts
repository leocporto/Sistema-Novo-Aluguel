"use server";

import { revalidatePath } from "next/cache";
import { obterContexto } from "@/lib/contexto";
import { type EstadoAcao, lista, mensagemErro, texto, textoObrigatorio } from "@/lib/form";

export async function marcarRepassesPagos(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  const ids = lista(fd, "ids");
  if (ids.length === 0) return { erro: "Selecione ao menos um repasse." };
  try {
    const { error, count } = await supabase
      .from("repasses")
      .update({ status: "pago", pago_em: textoObrigatorio(fd, "pago_em", "a data"), comprovante: texto(fd, "comprovante") }, { count: "exact" })
      .in("id", ids)
      .eq("status", "pendente");
    if (error) throw error;
    revalidatePath("/repasses");
    return { ok: `${count ?? ids.length} repasse(s) marcado(s) como pago(s).` };
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
}
