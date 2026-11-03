import { lerWebhookWhatsapp } from "@/lib/dominio/marketing";
import { clienteAnonimo } from "@/lib/supabase/anonimo";
import { assinaturaMetaOk, tokenValido } from "../../assinatura";

/**
 * Webhook do WhatsApp Business (Cloud API da Meta), por imobiliária (token na URL).
 * GET: verificação (hub.mode=subscribe, hub.verify_token, hub.challenge).
 * POST: mensagens recebidas e status das enviadas → caixa de entrada (Marketing › Conversas).
 * Não envia nada: responder pela API exige o token de acesso do app (credencial).
 */
export async function GET(req: Request, ctx: RouteContext<"/api/marketing/whatsapp/[token]">) {
  const { token } = await ctx.params;
  const q = new URL(req.url).searchParams;
  if (!tokenValido(token) || q.get("hub.mode") !== "subscribe") return new Response("Não autorizado", { status: 403 });
  const { data } = await clienteAnonimo().rpc("mkt_verificar_webhook", { p_token: token, p_tipo: "whatsapp", p_verify: q.get("hub.verify_token") ?? "" });
  if (data !== true) return new Response("Não autorizado", { status: 403 });
  return new Response(q.get("hub.challenge") ?? "", { status: 200, headers: { "Content-Type": "text/plain" } });
}

export async function POST(req: Request, ctx: RouteContext<"/api/marketing/whatsapp/[token]">) {
  const { token } = await ctx.params;
  if (!tokenValido(token)) return Response.json({ ok: false }, { status: 404 });
  const corpo = await req.text();
  if (!assinaturaMetaOk(corpo, req.headers.get("x-hub-signature-256"), process.env.WHATSAPP_APP_SECRET)) return Response.json({ ok: false, erro: "assinatura" }, { status: 401 });
  let payload: unknown;
  try {
    payload = JSON.parse(corpo);
  } catch {
    return Response.json({ ok: false, erro: "Corpo inválido." }, { status: 400 });
  }
  const lido = lerWebhookWhatsapp(payload);
  if (!lido.mensagens.length && !lido.status.length) return Response.json({ ok: true, mensagens: 0 });
  const { data, error } = await clienteAnonimo().rpc("whatsapp_receber", { p_token: token, p: lido });
  if (error) return Response.json({ ok: false, erro: error.message }, { status: error.message.includes("inválido") ? 404 : 429 });
  return Response.json({ ok: true, ...(data as object) });
}
