import { gerarSitemap } from "@/lib/dominio/site";
import { carregarEmpreendimentos, carregarImoveis, carregarSite, enderecosDoSite, urlFotoFixa } from "@/lib/servicos/site";

/** sitemap.xml do site (páginas fixas, cada imóvel com a foto de capa e cada empreendimento). */
export async function GET(_req: Request, ctx: RouteContext<"/s/[slug]/sitemap.xml">) {
  const { slug } = await ctx.params;
  const site = await carregarSite(slug);
  if (!site) return new Response("Não encontrado", { status: 404 });
  const [imoveis, emps, { base, origem }] = await Promise.all([carregarImoveis(slug), carregarEmpreendimentos(slug), enderecosDoSite(site)]);
  const raiz = `${origem}${base}`;
  const xml = gerarSitemap([
    { url: raiz || origem, atualizado: site.atualizado_em, prioridade: 1 },
    { url: `${raiz}/imoveis`, prioridade: 0.9 },
    { url: `${raiz}/imoveis?finalidade=locacao`, prioridade: 0.8 },
    { url: `${raiz}/imoveis?finalidade=venda`, prioridade: 0.8 },
    ...(site.tem_empreendimentos ? [{ url: `${raiz}/empreendimentos`, prioridade: 0.7 }] : []),
    ...(site.captacao_ativa ? [{ url: `${raiz}/anuncie`, prioridade: 0.5 }] : []),
    ...imoveis.map((i) => ({
      url: `${raiz}/imovel/${encodeURIComponent(i.codigo)}`,
      atualizado: i.criado_em,
      imagens: i.capa ? [urlFotoFixa(origem, slug, i.capa.id)] : [],
      prioridade: 0.7,
    })),
    ...emps.map((e) => ({ url: `${raiz}/empreendimentos/${e.id}`, imagens: e.capa ? [urlFotoFixa(origem, slug, e.capa.id)] : [], prioridade: 0.6 })),
  ]);
  return new Response(xml, { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}
