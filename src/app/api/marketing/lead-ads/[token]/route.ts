import { lerLeadGenerico, lerLeadGoogle, lerLeadMeta } from "@/lib/dominio/marketing";
import { clienteAnonimo } from "@/lib/supabase/anonimo";
import { assinaturaMetaOk, tokenValido } from "../../assinatura";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

/** Verificação do webhook do Meta Lead Ads (hub.mode=subscribe). */
export async function GET(req: Request, ctx: RouteContext<"/api/marketing/lead-ads/[token]">) {
  const { token } = await ctx.params;
  const q = new URL(req.url).searchParams;
  if (!tokenValido(token) || q.get("hub.mode") !== "subscribe") return new Response("Não autorizado", { status: 403 });
  const { data } = await clienteAnonimo().rpc("mkt_verificar_webhook", { p_token: token, p_tipo: "meta", p_verify: q.get("hub.verify_token") ?? "" });
  if (data !== true) return new Response("Não autorizado", { status: 403 });
  return new Response(q.get("hub.challenge") ?? "", { status: 200, headers: { "Content-Type": "text/plain" } });
}

/**
 * Leads de anúncios, por imobiliária (token na URL):
 * - Google Ads (formulário de lead com webhook): user_column_data + google_key;
 * - Meta Lead Ads: aviso "leadgen" (os dados vêm da Graph API com o token da página — fica guardado);
 * - genérico (Zapier, Make, site): {nome, telefone, email, mensagem, utm_*, gclid, fbclid, funil}.
 */
export async function POST(req: Request, ctx: RouteContext<"/api/marketing/lead-ads/[token]">) {
  const { token } = await ctx.params;
  if (!tokenValido(token)) return Response.json({ ok: false }, { status: 404, headers: CORS });
  const corpo = await req.text();
  let payload: unknown;
  try {
    payload = (req.headers.get("content-type") ?? "").includes("application/x-www-form-urlencoded") ? Object.fromEntries(new URLSearchParams(corpo)) : JSON.parse(corpo);
  } catch {
    return Response.json({ ok: false, erro: "Corpo inválido." }, { status: 400, headers: CORS });
  }
  const rpc = (p: Record<string, unknown>) => clienteAnonimo().rpc("lead_ads_receber", { p_token: token, p });
  const bruto = corpo.length <= 20_000 ? payload : null;

  // Respostas sem o id do lead e sem "duplicado": não revelam quem já é cliente da imobiliária.
  const google = lerLeadGoogle(payload);
  if (google) {
    const { error } = await rpc({ ...google, bruto });
    if (error) return Response.json({ ok: false, erro: error.message }, { status: error.message.includes("Chave") ? 403 : 400 });
    return Response.json({ ok: true });
  }

  const meta = lerLeadMeta(payload);
  if (meta.length) {
    if (!assinaturaMetaOk(corpo, req.headers.get("x-hub-signature-256"), process.env.META_APP_SECRET)) return Response.json({ ok: false }, { status: 401 });
    for (const m of meta) {
      const { error } = await rpc({ ...m, bruto });
      if (error) return Response.json({ ok: false, erro: error.message }, { status: 400 });
    }
    return Response.json({ ok: true, pendentes: meta.length });
  }

  const generico = lerLeadGenerico(payload);
  if (!generico) return Response.json({ ok: false, erro: "Informe pelo menos o nome e o telefone ou e-mail." }, { status: 400, headers: CORS });
  const { error } = await rpc({ ...generico, bruto });
  if (error) return Response.json({ ok: false, erro: error.message }, { status: 400, headers: CORS });
  return Response.json({ ok: true }, { headers: CORS });
}
