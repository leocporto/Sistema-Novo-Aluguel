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

/**
 * O corpo vai como chegou, com a assinatura X-Hub-Signature-256: o banco confere
 * a assinatura com a chave secreta do app que a imobiliária cadastrou em
 * Integrações e lê as mensagens do próprio corpo assinado
 * (whatsapp_receber_assinado). Assim, chamar a API do banco direto, com a chave
 * pública e o endereço do webhook, não pula a conferência.
 */
export async function POST(req: Request, ctx: RouteContext<"/api/marketing/whatsapp/[token]">) {
  const { token } = await ctx.params;
  if (!tokenValido(token)) return Response.json({ ok: false }, { status: 404 });
  const corpo = await req.text();
  if (corpo.length > 1_000_000) return Response.json({ ok: false, erro: "Corpo grande demais." }, { status: 413 });
  const assinatura = req.headers.get("x-hub-signature-256");
  // Variável de ambiente (app único da plataforma), quando existir: confere aqui também.
  if (!assinaturaMetaOk(corpo, assinatura, process.env.WHATSAPP_APP_SECRET)) return Response.json({ ok: false, erro: "assinatura" }, { status: 401 });
  let payload: unknown;
  try {
    payload = JSON.parse(corpo);
  } catch {
    return Response.json({ ok: false, erro: "Corpo inválido." }, { status: 400 });
  }
  const lido = lerWebhookWhatsapp(payload);
  if (!lido.mensagens.length && !lido.status.length) return Response.json({ ok: true, mensagens: 0 });
  let { data, error } = await clienteAnonimo().rpc("whatsapp_receber_assinado", { p_token: token, p_corpo: corpo, p_assinatura: assinatura });
  // Banco ainda sem a migração 20261107000005 (código publicado antes): caminho antigo.
  if (error && (error.code === "PGRST202" || /could not find the function/i.test(error.message))) {
    ({ data, error } = await clienteAnonimo().rpc("whatsapp_receber", { p_token: token, p: lido }));
  }
  if (error) {
    const m = error.message;
    const status = m.includes("Webhook inválido") ? 404 : m.includes("Assinatura") ? 401 : m.includes("Lote") || m.includes("grande") ? 413 : m.includes("Corpo") ? 400 : 429;
    return Response.json({ ok: false, erro: error.message }, { status });
  }
  return Response.json({ ok: true, ...(data as object) });
}
