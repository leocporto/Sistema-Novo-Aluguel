import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MAX_FAVORITOS, lerCodigos, normalizarCodigo } from "@/lib/dominio/site";
import { carregarImoveis, carregarSite, enderecosDoSite, urlsDasFotos } from "@/lib/servicos/site";
import { GradeImoveis } from "../componentes";
import { SincronizarLista } from "../interativo";

export const metadata: Metadata = { title: "Meus favoritos", robots: { index: false } };

/** Favoritos do visitante (guardados no navegador; a lista vem na URL ?c=…). */
export default async function FavoritosPage({ params, searchParams }: PageProps<"/s/[slug]/favoritos">) {
  const { slug } = await params;
  const sp = await searchParams;
  const site = await carregarSite(slug);
  if (!site) notFound();
  const codigos = lerCodigos(sp.c, MAX_FAVORITOS);
  const [imoveis, { base }] = await Promise.all([carregarImoveis(slug), enderecosDoSite(site)]);
  const porCodigo = new Map(imoveis.map((i) => [normalizarCodigo(i.codigo), i]));
  const lista = codigos.flatMap((c) => porCodigo.get(normalizarCodigo(c)) ?? []);
  const fotos = await urlsDasFotos(lista.map((i) => i.capa?.path));
  const saiu = codigos.length - lista.length;
  return (
    <div className="space-y-5">
      <SincronizarLista slug={slug} tipo="favoritos" atual={codigos} maximo={MAX_FAVORITOS} />
      <div>
        <h1 className="text-[clamp(26px,3vw,34px)] font-semibold tracking-[-0.025em] text-texto">Meus favoritos</h1>
        <p className="mt-1 text-sm text-texto-2">Toque no coração de um imóvel para guardar aqui. A lista fica neste aparelho.</p>
      </div>
      <GradeImoveis itens={lista} base={base} slug={slug} fotos={fotos} vazio="Você ainda não guardou nenhum imóvel." />
      {saiu > 0 && <p className="text-sm text-mudo">{saiu} imóvel(is) da sua lista não está(ão) mais disponível(is).</p>}
    </div>
  );
}
