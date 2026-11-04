import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import type { PerfilPortal, TipoCodigo } from "@/lib/dominio/portal";
import { clienteAnonimo } from "@/lib/supabase/anonimo";

/**
 * Sessão do portal: depois de confirmar a identidade, o navegador guarda um
 * segredo num cookie httpOnly (válido só em /portal/<token>); o banco guarda
 * só o hash e confere em toda leitura e escrita (RPCs portal_*).
 */
export const COOKIE_PORTAL = "portal_sessao";

export const tokenValido = (t: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t);

export type InfoPortal = {
  perfil: PerfilPortal;
  modo: "imobiliaria" | "pessoal";
  organizacao: { nome: string; telefone: string | null; email: string | null };
  primeiro_nome: string;
  tipo_codigo: TipoCodigo | null;
  bloqueado_ate: string | null;
  entrou: boolean;
  nome: string | null;
  expira_em: string | null;
};

export async function lerSessao(): Promise<string | null> {
  return (await cookies()).get(COOKIE_PORTAL)?.value ?? null;
}

/** O link vale? A pessoa já entrou? (uma consulta por requisição) */
export const infoPortal = cache(async (token: string): Promise<InfoPortal | null> => {
  if (!tokenValido(token)) return null;
  const { data } = await clienteAnonimo().rpc("portal_inicio", { p_token: token, p_sessao: await lerSessao() });
  return (data as InfoPortal | null) ?? null;
});

export type ErroPortal = { erro: "link" | "sessao" };
export const ehErroPortal = (d: unknown): d is ErroPortal =>
  Boolean(d && typeof d === "object" && !Array.isArray(d) && "erro" in d && ((d as ErroPortal).erro === "link" || (d as ErroPortal).erro === "sessao"));

/** Dados de uma seção (só os da própria pessoa; o banco confere a sessão). */
export async function dadosPortal<T>(token: string, secao: string, p: Record<string, unknown> = {}): Promise<T | ErroPortal | null> {
  if (!tokenValido(token)) return { erro: "link" };
  const { data, error } = await clienteAnonimo().rpc("portal_dados", { p_token: token, p_sessao: await lerSessao(), p_secao: secao, p });
  if (error) throw new Error(error.message);
  return data as T | ErroPortal | null;
}

/** IP e navegador de quem está no portal (registro de acessos). */
export async function visitante(): Promise<{ ip: string | null; ua: string | null }> {
  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip") || null;
  return { ip: ip?.slice(0, 64) ?? null, ua: h.get("user-agent")?.slice(0, 200) ?? null };
}

