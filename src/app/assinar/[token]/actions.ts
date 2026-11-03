"use server";

import { headers } from "next/headers";
import { clienteAnonimo } from "@/lib/supabase/anonimo";

type Estado = { erro?: string; ok?: string };

/** Assinatura pública: registra nome, CPF, IP e navegador junto com o código do texto. */
export async function assinar(_: Estado, fd: FormData): Promise<Estado> {
  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip") || "";
  const { error } = await clienteAnonimo().rpc("assinar_documento", {
    p_token: String(fd.get("token")),
    p: { nome: String(fd.get("nome") ?? ""), cpf: String(fd.get("cpf") ?? ""), aceite: fd.get("aceite") === "on", ip, ua: h.get("user-agent") ?? "" },
  });
  if (error) return { erro: error.message };
  return { ok: "Documento assinado. Obrigado!" };
}

export async function recusar(_: Estado, fd: FormData): Promise<Estado> {
  const { error } = await clienteAnonimo().rpc("recusar_assinatura", { p_token: String(fd.get("token")), p_motivo: String(fd.get("motivo") ?? "") });
  if (error) return { erro: error.message };
  return { ok: "Recusa registrada. Quem enviou será avisado no sistema." };
}
