import { clienteAnonimo } from "@/lib/supabase/anonimo";

/**
 * Link fixo de uma foto publicada (não expira): confere no banco se a foto é
 * de um imóvel publicado (site no ar ou portal ativo) e redireciona para um
 * link temporário do Storage. Usado no Open Graph (WhatsApp/Facebook), no
 * JSON-LD, no sitemap e nos feeds dos portais, que precisam de endereço estável.
 */
export async function GET(_req: Request, ctx: RouteContext<"/s/[slug]/foto/[id]">) {
  const { slug, id } = await ctx.params;
  const midia = id.replace(/\.(jpe?g|png|webp)$/i, "");
  if (!/^[a-z0-9-]{3,50}$/.test(slug) || !/^[0-9a-f-]{36}$/i.test(midia)) return new Response("Não encontrado", { status: 404 });
  const cliente = clienteAnonimo();
  const { data: caminho } = await cliente.rpc("site_foto", { p_slug: slug, p_midia: midia });
  if (!caminho) return new Response("Não encontrado", { status: 404 });
  const { data } = await cliente.storage.from("imoveis").createSignedUrl(caminho as string, 3600);
  if (!data?.signedUrl) return new Response("Não encontrado", { status: 404 });
  return new Response(null, { status: 302, headers: { Location: data.signedUrl, "Cache-Control": "public, max-age=1800" } });
}
