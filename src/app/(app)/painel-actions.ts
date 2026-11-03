"use server";

import { revalidatePath } from "next/cache";
import { obterContexto } from "@/lib/contexto";
import { mensagemErro } from "@/lib/form";

export type PreferenciaPainel = { ordem: string[]; ocultos: string[] };

const lista = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.length < 60).slice(0, 80) : []);

/** Grava a ordem e os quadros escondidos do Painel para o usuário logado. */
export async function salvarPreferenciaPainel(pref: PreferenciaPainel | null): Promise<{ ok: boolean; erro?: string }> {
  const { supabase, organizacao, usuario } = await obterContexto();
  const r = pref
    ? await supabase.from("painel_preferencias").upsert(
        { user_id: usuario.id, organizacao_id: organizacao.id, widgets: { ordem: lista(pref.ordem), ocultos: lista(pref.ocultos) }, atualizado_em: new Date().toISOString() },
        { onConflict: "user_id,organizacao_id" },
      )
    : await supabase.from("painel_preferencias").delete().eq("user_id", usuario.id).eq("organizacao_id", organizacao.id);
  if (r.error) return { ok: false, erro: mensagemErro(r.error) };
  revalidatePath("/");
  return { ok: true };
}
