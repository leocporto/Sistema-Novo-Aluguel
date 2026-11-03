import { ehPortal, lerLeadPortal } from "@/lib/dominio/site-portais";
import { clienteAnonimo } from "@/lib/supabase/anonimo";

/**
 * Recebimento de leads do portal (webhook). O portal faz POST em JSON neste
 * endereço (cadastrado no painel do portal); o lead entra no funil do Comercial
 * com a origem do portal, sem repetir quem já está em atendimento.
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
  const { data, error } = await clienteAnonimo().rpc("portal_receber_lead", { p_token: token, p_portal: portal, p: lead });
  if (error) {
    const invalido = error.message.includes("inválido");
    return Response.json({ ok: false, erro: invalido ? "Endereço inválido." : error.message }, { status: invalido ? 404 : 400 });
  }
  return Response.json({ ok: true, ...(data as object) });
}
