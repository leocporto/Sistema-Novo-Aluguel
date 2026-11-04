import { CAMPOS_UTM } from "@/lib/dominio/marketing";
import { clienteAnonimo } from "@/lib/supabase/anonimo";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

/**
 * Entrada de leads por integração (site próprio, portais, Zapier/Make…).
 * POST JSON: { nome, telefone?, email?, mensagem?, origem?, funil?, imovel?,
 *   utm_source?, utm_medium?, utm_campaign?, utm_content?, utm_term?, gclid?, fbclid? }
 * A origem da conversão (UTM, gclid, fbclid) fica gravada no lead.
 */
export async function POST(req: Request, ctx: RouteContext<"/api/leads/[token]">) {
  const { token } = await ctx.params;
  let corpo: Record<string, unknown>;
  try {
    const tipo = req.headers.get("content-type") ?? "";
    corpo = tipo.includes("application/json") ? await req.json() : Object.fromEntries((await req.formData()).entries());
  } catch {
    return Response.json({ ok: false, erro: "Corpo inválido." }, { status: 400, headers: CORS });
  }
  const p = Object.fromEntries(
    ["nome", "telefone", "email", "mensagem", "origem", "funil", "imovel", ...CAMPOS_UTM].map((k) => [k, corpo[k] == null ? undefined : String(corpo[k]).slice(0, 2000)]),
  );
  const { error } = await clienteAnonimo().rpc("receber_lead_marketing", { p_token: token, p });
  if (error) return Response.json({ ok: false, erro: error.message }, { status: 400, headers: CORS });
  // Mesma resposta para contato novo ou repetido: não revela quem já é cliente/captação (nem o id).
  return Response.json({ ok: true }, { headers: CORS });
}
