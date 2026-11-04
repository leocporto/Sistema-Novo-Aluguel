import { ehPortal, lerLeadPortal } from "@/lib/dominio/site-portais";
import { clienteAnonimo } from "@/lib/supabase/anonimo";

/**
 * Recebimento de leads do portal (webhook). O portal faz POST em JSON neste
 * endereço (cadastrado no painel do portal), que usa o código de LEADS da
 * imobiliária — diferente do código do feed. O lead entra no funil do Comercial
 * com a origem do portal, sem repetir quem já está em atendimento, e o mesmo lead
 * reenviado pelo portal não entra duas vezes. Os erros voltam genéricos.
 */
export async function POST(req: Request, ctx: RouteContext<"/api/portais/[token]/[portal]/leads">) {
  const { token, portal } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(token) || !ehPortal(portal)) return Response.json({ ok: false, erro: "Endereço inválido." }, { status: 404 });
  const texto = await req.text();
  if (texto.length > 50_000) return Response.json({ ok: false, erro: "Conteúdo grande demais." }, { status: 413 });
  let corpo: unknown;
  try {
    corpo = JSON.parse(texto);
  } catch {
    return Response.json({ ok: false, erro: "Envie o lead em JSON." }, { status: 400 });
  }
  const lead = lerLeadPortal(corpo, portal);
  if ("erro" in lead) return Response.json({ ok: false, erro: lead.erro }, { status: 400 });
  const { error } = await clienteAnonimo().rpc("portal_receber_lead", { p_token: token, p_portal: portal, p: lead });
  if (error) {
    const msg = error.message ?? "";
    if (msg.includes("inválido")) return Response.json({ ok: false, erro: "Endereço inválido." }, { status: 404 });
    if (msg.startsWith("Muitas mensagens")) return Response.json({ ok: false, erro: "Muitos leads agora. Tente de novo mais tarde." }, { status: 429 });
    if (msg.startsWith("Informe ")) return Response.json({ ok: false, erro: "Lead sem nome ou sem telefone/e-mail." }, { status: 400 });
    return Response.json({ ok: false, erro: "Não foi possível registrar o lead." }, { status: 400 });
  }
  return Response.json({ ok: true });
}
