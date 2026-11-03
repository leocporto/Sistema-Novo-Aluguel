import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { Check, ImageIcon, Minus } from "lucide-react";
import { formatarReais } from "@/lib/dominio/dinheiro";
import { MAX_COMPARAR, areaPrincipal, lerCodigos, normalizarCodigo, precosExibidos, tituloImovel, type ImovelSite } from "@/lib/dominio/site";
import { carregarImoveis, carregarSite, enderecosDoSite, urlsDasFotos } from "@/lib/servicos/site";
import { linkImovel } from "../componentes";
import { BotaoComparar, SincronizarLista } from "../interativo";

export const metadata: Metadata = { title: "Comparar imóveis", robots: { index: false } };

const nada = <Minus className="mx-auto size-4 text-fraco" />;
const dinheiro = (v: number | null) => (v ? formatarReais(v) : nada);
const numero = (v: number | null | undefined) => (v ? String(v) : nada);

/** Comparação lado a lado (até 4 imóveis). */
export default async function CompararPage({ params, searchParams }: PageProps<"/s/[slug]/comparar">) {
  const { slug } = await params;
  const sp = await searchParams;
  const site = await carregarSite(slug);
  if (!site) notFound();
  const codigos = lerCodigos(sp.c, MAX_COMPARAR);
  const [imoveis, { base }] = await Promise.all([carregarImoveis(slug), enderecosDoSite(site)]);
  const porCodigo = new Map(imoveis.map((i) => [normalizarCodigo(i.codigo), i]));
  const lista = codigos.flatMap((c) => porCodigo.get(normalizarCodigo(c)) ?? []);
  const fotos = await urlsDasFotos(lista.map((i) => i.capa?.path));
  const comodidades = [...new Set(lista.flatMap((i) => i.comodidades ?? []))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  const linhas: [string, (i: ImovelSite) => ReactNode][] = [
    ["Aluguel", (i) => dinheiro(precosExibidos(i).aluguel)],
    ["Venda", (i) => dinheiro(precosExibidos(i).venda)],
    ["Condomínio", (i) => dinheiro(precosExibidos(i).condominio)],
    ["IPTU (mês)", (i) => dinheiro(precosExibidos(i).iptu)],
    ["Total por mês", (i) => dinheiro(precosExibidos(i).totalMes ?? precosExibidos(i).aluguel)],
    ["Tipo", (i) => i.tipo.charAt(0).toUpperCase() + i.tipo.slice(1)],
    ["Bairro", (i) => [i.bairro, i.cidade].filter(Boolean).join(", ") || nada],
    ["Área", (i) => (areaPrincipal(i) ? `${areaPrincipal(i)!.toLocaleString("pt-BR")} m²` : nada)],
    ["Quartos", (i) => numero(i.quartos)],
    ["Suítes", (i) => numero(i.suites)],
    ["Banheiros", (i) => numero(i.banheiros)],
    ["Vagas", (i) => numero(i.vagas)],
    ...comodidades.map((c): [string, (i: ImovelSite) => ReactNode] => [c, (i) => (i.comodidades?.includes(c) ? <Check className="mx-auto size-4 text-ok" /> : nada)]),
  ];
  const celula = "border-b border-borda-suave px-4 py-3 text-center text-[14px] text-texto";

  return (
    <div className="space-y-5">
      <SincronizarLista slug={slug} tipo="comparar" atual={codigos} maximo={MAX_COMPARAR} />
      <div>
        <h1 className="text-[clamp(26px,3vw,34px)] font-semibold tracking-[-0.025em] text-texto">Comparar imóveis</h1>
        <p className="mt-1 text-sm text-texto-2">Use o botão “Comparar” nos anúncios para escolher até {MAX_COMPARAR} imóveis.</p>
      </div>
      {lista.length === 0 ? (
        <div className="rounded-card border border-dashed border-borda-forte bg-card px-6 py-12 text-center text-sm text-texto-2">
          Nenhum imóvel para comparar.{" "}
          <Link href={`${base}/imoveis`} className="font-semibold text-acento hover:underline">
            Ver imóveis
          </Link>
        </div>
      ) : (
        <div className="entrar overflow-x-auto rounded-card border border-borda bg-card">
          <table className="min-w-full border-collapse">
            <thead>
              <tr>
                <th className="w-40 border-b border-borda bg-elev px-4 py-3" />
                {lista.map((i) => (
                  <th key={i.id} className="min-w-[200px] border-b border-borda bg-elev px-4 py-3 align-top">
                    <Link href={linkImovel(base, i.codigo)} className="block space-y-2 text-left">
                      {i.capa && fotos.get(i.capa.path) ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={fotos.get(i.capa.path)} alt="" className="aspect-[4/3] w-full rounded-[12px] object-cover" />
                      ) : (
                        <span className="grid aspect-[4/3] w-full place-items-center rounded-[12px] bg-card text-mudo">
                          <ImageIcon className="size-6" />
                        </span>
                      )}
                      <span className="line-clamp-2 text-sm font-semibold text-texto hover:text-acento">{tituloImovel(i)}</span>
                    </Link>
                    <div className="mt-2 text-left">
                      <BotaoComparar slug={slug} codigo={i.codigo} />
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {linhas.map(([rotulo, valor]) => (
                <tr key={rotulo}>
                  <th scope="row" className="border-b border-borda-suave px-4 py-3 text-left font-mono text-[10.5px] font-semibold uppercase tracking-[0.1em] text-mudo">
                    {rotulo}
                  </th>
                  {lista.map((i) => (
                    <td key={i.id} className={celula}>
                      {valor(i)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
