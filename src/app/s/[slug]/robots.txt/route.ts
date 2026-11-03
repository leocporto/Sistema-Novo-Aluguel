import { carregarSite, enderecosDoSite } from "@/lib/servicos/site";

/**
 * robots.txt do site. Vale de verdade quando o site é aberto pelo domínio
 * próprio (o proxy manda /robots.txt do domínio para cá); no endereço
 * /s/<slug> o Google usa o sitemap enviado pelo Search Console.
 */
export async function GET(_req: Request, ctx: RouteContext<"/s/[slug]/robots.txt">) {
  const { slug } = await ctx.params;
  const site = await carregarSite(slug);
  if (!site) return new Response("User-agent: *\nDisallow: /\n", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  const { base, origem } = await enderecosDoSite(site);
  const texto = [
    "User-agent: *",
    "Allow: /",
    `Disallow: ${base}/favoritos`,
    `Disallow: ${base}/comparar`,
    "",
    `Sitemap: ${origem}${base}/sitemap.xml`,
    "",
  ].join("\n");
  return new Response(texto, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}
