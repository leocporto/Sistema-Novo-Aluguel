"use server";

import { clienteAnonimo } from "@/lib/supabase/anonimo";
import { criarClienteServidor } from "@/lib/supabase/server";

type Estado = { erro?: string; ok?: string };

/** "Já paguei": avisa a imobiliária/locador para conferir (não dá baixa sozinho). */
export async function informarPagamento(_: Estado, fd: FormData): Promise<Estado> {
  const token = String(fd.get("token") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(token)) return { erro: "Link inválido." };
  const { error } = await clienteAnonimo().rpc("informar_pagamento", {
    p_token: token,
    p: { data: String(fd.get("data") ?? ""), mensagem: String(fd.get("mensagem") ?? "").slice(0, 500) },
  });
  if (error) return { erro: error.message };
  return { ok: "Obrigado! Avisamos que você pagou. Assim que o pagamento for conferido, a cobrança é baixada." };
}

/**
 * "Link aberto": chamada pelo navegador de quem abriu a 2ª via (prévias de link
 * do WhatsApp não rodam isto). Quem está logado no sistema (a equipe
 * conferindo) não conta.
 */
export async function registrarVisita(token: string): Promise<void> {
  if (!/^[0-9a-f-]{36}$/i.test(token)) return;
  try {
    const { data } = await (await criarClienteServidor()).auth.getClaims();
    if (data?.claims?.sub) return;
    await clienteAnonimo().rpc("registrar_visita_segunda_via", { p_token: token });
  } catch {
    // Registro de visita é só informativo: nunca atrapalha o locatário.
  }
}
