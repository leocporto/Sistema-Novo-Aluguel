import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { carregarEmpreendimentos, carregarSite, enderecosDoSite, urlsDasFotos } from "@/lib/servicos/site";
import { CartaoEmpreendimento } from "../componentes";

export async function generateMetadata({ params }: PageProps<"/s/[slug]/empreendimentos">): Promise<Metadata> {
  const { slug } = await params;
  const site = await carregarSite(slug);
  if (!site) return {};
  const { base } = await enderecosDoSite(site);
  return {
    title: "Lançamentos e empreendimentos",
    description: `Lançamentos, imóveis na planta e empreendimentos prontos com ${site.nome}.`,
    alternates: { canonical: `${base}/empreendimentos` },
  };
}

/** Lista de empreendimentos e lançamentos publicados. */
export default async function EmpreendimentosSitePage({ params }: PageProps<"/s/[slug]/empreendimentos">) {
  const { slug } = await params;
  const site = await carregarSite(slug);
  if (!site) notFound();
  const [emps, { base }] = await Promise.all([carregarEmpreendimentos(slug), enderecosDoSite(site)]);
  const fotos = await urlsDasFotos(emps.map((e) => e.capa?.path));
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[clamp(26px,3vw,34px)] font-semibold tracking-[-0.025em] text-texto">Lançamentos e empreendimentos</h1>
        <p className="mt-1 text-sm text-texto-2">Imóveis na planta, em obras e prontos para morar.</p>
      </div>
      {emps.length ? (
        <div className="entrar-cascata grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {emps.map((e) => (
            <CartaoEmpreendimento key={e.id} e={e} base={base} foto={e.capa ? (fotos.get(e.capa.path) ?? null) : null} />
          ))}
        </div>
      ) : (
        <div className="rounded-card border border-dashed border-borda-forte bg-card px-6 py-12 text-center text-sm text-texto-2">Nenhum empreendimento publicado no momento.</div>
      )}
    </div>
  );
}
