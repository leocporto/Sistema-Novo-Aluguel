import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import type { EmpreendimentoSite, ImovelSite, InfoSite } from "@/lib/dominio/site";
import { clienteAnonimo } from "@/lib/supabase/anonimo";

/*
 * Leitura do site público (visitante sem login). Tudo passa pelas funções
 * security definer do banco (site_*), que só devolvem o que está publicado.
 */

const slugOk = (s: string) => /^[a-z0-9-]{3,50}$/.test(s);

export const carregarSite = cache(async (slug: string): Promise<InfoSite | null> => {
  if (!slugOk(slug)) return null;
  const { data } = await clienteAnonimo().rpc("site_info", { p_slug: slug });
  return (data as InfoSite | null) ?? null;
});

/**
 * Endereço novo de um site que trocou de endereço (o antigo fica reservado para a
 * mesma imobiliária por 12 meses e os links antigos redirecionam). null se não houver.
 */
export const slugAtualDoSite = cache(async (slugAntigo: string): Promise<string | null> => {
  if (!slugOk(slugAntigo)) return null;
  const { data } = await clienteAnonimo().rpc("site_slug_atual", { p_slug: slugAntigo });
  return typeof data === "string" && slugOk(data) ? data : null;
});

export const carregarImoveis = cache(async (slug: string): Promise<ImovelSite[]> => {
  if (!slugOk(slug)) return [];
  const { data } = await clienteAnonimo().rpc("site_imoveis", { p_slug: slug });
  return (data as ImovelSite[] | null) ?? [];
});

export const carregarImovel = cache(async (slug: string, codigo: string): Promise<ImovelSite | null> => {
  if (!slugOk(slug) || !codigo || codigo.length > 60) return null;
  const { data } = await clienteAnonimo().rpc("site_imovel", { p_slug: slug, p_codigo: codigo });
  return (data as ImovelSite | null) ?? null;
});

export const carregarEmpreendimentos = cache(async (slug: string): Promise<EmpreendimentoSite[]> => {
  if (!slugOk(slug)) return [];
  const { data } = await clienteAnonimo().rpc("site_empreendimentos", { p_slug: slug });
  return (data as EmpreendimentoSite[] | null) ?? [];
});

/**
 * Links temporários (1 h) das fotos publicadas. O bucket "imoveis" é privado: a
 * policy do Storage só deixa o visitante gerar link de foto de imóvel publicado.
 */
export async function urlsDasFotos(caminhos: (string | null | undefined)[]): Promise<Map<string, string>> {
  const lista = [...new Set(caminhos.filter((c): c is string => !!c))];
  if (!lista.length) return new Map();
  const { data } = await clienteAnonimo().storage.from("imoveis").createSignedUrls(lista, 3600);
  const mapa = new Map<string, string>();
  for (const d of data ?? []) if (d.path && d.signedUrl) mapa.set(d.path, d.signedUrl);
  return mapa;
}

/** Endereço público do logo (bucket "site", público). */
export function urlLogo(caminho: string | null | undefined): string | null {
  if (!caminho) return null;
  return clienteAnonimo().storage.from("site").getPublicUrl(caminho).data.publicUrl;
}

/**
 * Prefixo dos links e endereço absoluto do site nesta requisição.
 * - acesso por /s/<slug>: base "/s/<slug>";
 * - acesso pelo domínio próprio (o proxy reescreve e manda o cabeçalho
 *   x-site-dominio): base "" e endereço https://<domínio>.
 */
export async function enderecosDoSite(site: Pick<InfoSite, "slug" | "dominio">): Promise<{ base: string; origem: string }> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const viaDominio = h.get("x-site-dominio");
  if (viaDominio && site.dominio && viaDominio.replace(/^www\./, "") === site.dominio) return { base: "", origem: `https://${viaDominio}` };
  return { base: `/s/${site.slug}`, origem: `${proto}://${host}` };
}

/** Link fixo da foto (não expira): usado no Open Graph, no JSON-LD, no sitemap e nos portais. */
export function urlFotoFixa(origem: string, slug: string, midiaId: string): string {
  return `${origem}/s/${slug}/foto/${midiaId}`;
}
