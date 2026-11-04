import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import type { TipoCodigo } from "@/lib/dominio/portal";
import { clienteAnonimo } from "@/lib/supabase/anonimo";

/**
 * Sessão do portal do condômino: depois de confirmar a identidade, o
 * navegador guarda um segredo num cookie httpOnly (só em /condominio/<link>);
 * o banco guarda só o hash e confere em toda leitura e escrita (RPCs cond_portal_*).
 */
export const COOKIE_CONDOMINIO = "cond_sessao";

export const tokenValido = (t: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t);

export type InfoCondominio = {
  condominio: string;
  organizacao: { nome: string; telefone: string | null; email: string | null };
  primeiro_nome: string;
  tipo_codigo: TipoCodigo | null;
  bloqueado_ate: string | null;
  entrou: boolean;
  nome: string | null;
};

export async function lerSessao(): Promise<string | null> {
  return (await cookies()).get(COOKIE_CONDOMINIO)?.value ?? null;
}

/** O link vale? A pessoa já entrou? (uma consulta por requisição) */
export const infoCondominio = cache(async (token: string): Promise<InfoCondominio | null> => {
  if (!tokenValido(token)) return null;
  const { data } = await clienteAnonimo().rpc("cond_portal_inicio", { p_token: token, p_sessao: await lerSessao() });
  return (data as InfoCondominio | null) ?? null;
});

export type ErroPortal = { erro: "link" | "sessao" };
export const ehErro = (d: unknown): d is ErroPortal => Boolean(d && typeof d === "object" && !Array.isArray(d) && "erro" in d);

/** Dados de uma seção (só os da própria pessoa; o banco confere a sessão). */
export async function dadosCondominio<T>(token: string, secao: string, p: Record<string, unknown> = {}): Promise<T | ErroPortal | null> {
  if (!tokenValido(token)) return { erro: "link" };
  const { data, error } = await clienteAnonimo().rpc("cond_portal_dados", { p_token: token, p_sessao: await lerSessao(), p_secao: secao, p });
  if (error) throw new Error(error.message);
  return data as T | ErroPortal | null;
}

export async function visitante(): Promise<{ ip: string | null; ua: string | null }> {
  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip") || null;
  return { ip: ip?.slice(0, 64) ?? null, ua: h.get("user-agent")?.slice(0, 200) ?? null };
}
