import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { criarClienteServidor } from "./supabase/server";
import type { Organizacao } from "./tipos";

/**
 * Camada de acesso: garante usuário autenticado e organização (imobiliária)
 * vinculada. Toda leitura/escrita passa pelo Supabase com RLS, então mesmo
 * que uma ação seja chamada diretamente, só enxerga dados da própria
 * organização.
 */
export const obterContexto = cache(async () => {
  const supabase = await criarClienteServidor();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");

  const { data: membro } = await supabase
    .from("membros")
    .select("papel, organizacao:organizacoes(*)")
    .eq("user_id", auth.user.id)
    .order("created_at")
    .limit(1)
    .maybeSingle();

  if (!membro?.organizacao) redirect("/onboarding");

  return {
    supabase,
    usuario: auth.user,
    papel: membro.papel as string,
    organizacao: membro.organizacao as unknown as Organizacao,
  };
});

export async function obterUsuarioSemOrganizacao() {
  const supabase = await criarClienteServidor();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");
  return { supabase, usuario: auth.user };
}
