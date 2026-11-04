"use server";

import { headers } from "next/headers";
import { clienteAnonimo } from "@/lib/supabase/anonimo";

type Estado = { erro?: string; ok?: string };

/**
 * Proprietário aprova ou recusa o orçamento pelo link (sem login). Registra
 * nome, data e (só como informação) o IP. "versao" é o retrato do que a página
 * mostrou: se o orçamento mudou depois, o banco recusa e pede para recarregar.
 */
export async function responderAprovacao(_: Estado, fd: FormData): Promise<Estado> {
  const token = String(fd.get("token") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(token)) return { erro: "Link inválido." };
  const aprovar = fd.get("decisao") === "aprovar";
  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip") || "";
  const { error } = await clienteAnonimo().rpc("responder_aprovacao_chamado", {
    p_token: token,
    p: { aprovar, nome: String(fd.get("nome") ?? ""), obs: String(fd.get("obs") ?? "").slice(0, 1000), ip, versao: String(fd.get("versao") ?? "").slice(0, 64) },
  });
  if (error) return { erro: error.message };
  return { ok: aprovar ? "Orçamento aprovado. Obrigado! A administração vai agendar o serviço." : "Recusa registrada. A administração vai buscar outra solução e falar com você." };
}
