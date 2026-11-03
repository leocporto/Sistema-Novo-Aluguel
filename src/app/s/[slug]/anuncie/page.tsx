import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Camera, FileCheck2, Users } from "lucide-react";
import { carregarSite, enderecosDoSite } from "@/lib/servicos/site";
import { FormAnuncie } from "../interativo";

export async function generateMetadata({ params }: PageProps<"/s/[slug]/anuncie">): Promise<Metadata> {
  const { slug } = await params;
  const site = await carregarSite(slug);
  if (!site) return {};
  const { base } = await enderecosDoSite(site);
  return {
    title: "Anuncie seu imóvel",
    description: `Quer alugar ou vender seu imóvel? Mande os dados para a ${site.nome} e um corretor fala com você.`,
    alternates: { canonical: `${base}/anuncie` },
  };
}

/** Captação de proprietários pelo site: vira uma oportunidade em Captação de imóveis. */
export default async function AnunciePage({ params }: PageProps<"/s/[slug]/anuncie">) {
  const { slug } = await params;
  const site = await carregarSite(slug);
  if (!site || !site.captacao_ativa) notFound();
  const vantagens = [
    { icone: <Camera />, titulo: "Anúncio caprichado", texto: "Fotos, descrição e publicação no site e nos principais portais." },
    { icone: <Users />, titulo: "Visitas e interessados", texto: "Atendemos os interessados e acompanhamos as visitas." },
    { icone: <FileCheck2 />, titulo: "Contrato seguro", texto: "Análise do inquilino ou comprador, contrato e documentação." },
  ];
  return (
    <div className="grid items-start gap-8 lg:grid-cols-[1fr_1.2fr]">
      <div className="space-y-5">
        <h1 className="text-[clamp(28px,3.4vw,40px)] font-semibold leading-[1.08] tracking-[-0.03em] text-texto">Anuncie seu imóvel com a {site.nome}</h1>
        <p className="text-[15px] leading-relaxed text-texto-2">Conte um pouco sobre o imóvel que você quer alugar ou vender. Um corretor entra em contato para combinar a avaliação, sem compromisso.</p>
        <ul className="entrar-cascata space-y-3">
          {vantagens.map((v) => (
            <li key={v.titulo} className="flex gap-3 rounded-card border border-borda bg-card p-4">
              <span className="grid size-10 shrink-0 place-items-center rounded-[12px] border border-acento-bd bg-acento-bg text-acento [&>svg]:size-5">{v.icone}</span>
              <span>
                <span className="block font-semibold text-texto">{v.titulo}</span>
                <span className="text-sm text-texto-2">{v.texto}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div className="entrar rounded-card border border-borda bg-card p-5 sm:p-7">
        <FormAnuncie slug={slug} />
      </div>
    </div>
  );
}
