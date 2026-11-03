"use server";

import { headers } from "next/headers";
import { clienteAnonimo } from "@/lib/supabase/anonimo";

/** Contestação pública: grava pela RPC que confere o token, o prazo e a pasta das fotos. */
export async function enviarContestacao(
  token: string,
  d: { nome: string; contato: string; texto: string; itens: { item_id: string; texto: string }[]; fotos: string[] },
): Promise<{ ok: boolean; erro?: string }> {
  if (!/^[0-9a-f-]{36}$/i.test(token)) return { ok: false, erro: "Link inválido." };
  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip") || "";
  const { error } = await clienteAnonimo().rpc("contestar_vistoria", {
    p_token: token,
    p: {
      nome: String(d.nome ?? "").slice(0, 160),
      contato: String(d.contato ?? "").slice(0, 160),
      texto: String(d.texto ?? "").slice(0, 5000),
      itens: Array.isArray(d.itens) ? d.itens.slice(0, 200) : [],
      fotos: Array.isArray(d.fotos) ? d.fotos.slice(0, 20) : [],
      ip,
      ua: h.get("user-agent") ?? "",
    },
  });
  if (error) return { ok: false, erro: error.message };
  return { ok: true };
}
