import { ehPortal } from "@/lib/dominio/site-portais";
import { montarFeed } from "@/lib/servicos/portais";
import { clienteAnonimo } from "@/lib/supabase/anonimo";

/** Endereço público deste servidor (atrás do proxy da hospedagem). */
function origemDe(req: Request): string {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!host) return new URL(req.url).origin;
  const proto = req.headers.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

/**
 * Feed XML do portal (ZAP/Viva Real em VRSync; OLX em XML de carga), gerado na
 * hora a partir do cadastro: preço, fotos e disponibilidade sempre atuais.
 * O portal busca este endereço de tempos em tempos; cada busca fica registrada
 * (Site → Portais → Histórico de envios). Aceita ".../zap" e ".../zap.xml".
 */
export async function GET(req: Request, ctx: RouteContext<"/api/portais/[token]/[portal]">) {
  const { token, portal: bruto } = await ctx.params;
  const portal = bruto.replace(/\.xml$/i, "").toLowerCase();
  if (!/^[0-9a-f-]{36}$/i.test(token) || !ehPortal(portal)) return new Response("Não encontrado", { status: 404 });
  const feed = await montarFeed(clienteAnonimo(), token, portal, { origem: origemDe(req), registro: "portal", agente: req.headers.get("user-agent") });
  if (!feed) return new Response("Não encontrado", { status: 404 });
  return new Response(feed.xml, {
    headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" },
  });
}
