import { especificacaoCom } from "@/lib/dominio/api";

/** Especificação OpenAPI 3.1 da API (pública, sem dados). */
export function GET(req: Request) {
  const u = new URL(req.url);
  const host = req.headers.get("x-forwarded-host") ?? u.host;
  const proto = req.headers.get("x-forwarded-proto") ?? u.protocol.replace(":", "");
  return Response.json(especificacaoCom(`${proto}://${host}`), {
    headers: { "Cache-Control": "public, max-age=300", "Access-Control-Allow-Origin": "*" },
  });
}
