import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { criarClienteServidor } from "./supabase/server";
import type { Organizacao } from "./tipos";

export interface UsuarioSessao {
  id: string;
  email: string | null;
}

/**
 * Lê o usuário da sessão verificando o token (JWT) — sem ida ao servidor de
 * autenticação quando o projeto usa chaves assimétricas (o Supabase valida a
 * assinatura localmente). Toda leitura/escrita continua passando pelo RLS.
 */
async function usuarioDaSessao() {
  const supabase = await criarClienteServidor();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  const usuario: UsuarioSessao | null = claims?.sub
    ? { id: String(claims.sub), email: typeof claims.email === "string" ? claims.email : null }
    : null;
  return { supabase, usuario };
}

/**
 * Camada de acesso: garante usuário autenticado e organização (imobiliária)
 * vinculada. Toda leitura/escrita passa pelo Supabase com RLS, então mesmo
 * que uma ação seja chamada diretamente, só enxerga dados da própria
 * organização.
 */
export const obterContexto = cache(async () => {
  const { supabase, usuario } = await usuarioDaSessao();
  if (!usuario) redirect("/login");

  const { data: membro } = await supabase
    .from("membros")
    .select("papel, organizacao:organizacoes(*)")
    .eq("user_id", usuario.id)
    .order("created_at")
    .limit(1)
    .maybeSingle();

  if (!membro?.organizacao) redirect("/onboarding");

  return {
    supabase,
    usuario,
    papel: membro.papel as string,
    organizacao: membro.organizacao as unknown as Organizacao,
  };
});

export async function obterUsuarioSemOrganizacao() {
  const { supabase, usuario } = await usuarioDaSessao();
  if (!usuario) redirect("/login");
  return { supabase, usuario };
}
