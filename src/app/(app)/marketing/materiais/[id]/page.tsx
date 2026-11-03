import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BotaoImprimir } from "@/components/formulario";
import { Copiar } from "@/components/copiar";
import { PilulasLink } from "@/components/pilulas-link";
import { Cabecalho, Cartao } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { formatarReais } from "@/lib/dominio/dinheiro";
import { descricaoImovel, destaquesImovel, precoDoImovel, textoAnuncio, type ImovelMaterial } from "@/lib/dominio/marketing";
import { AbasMarketing } from "../../campos";
import { obterConfig, urlBase } from "../../dados";

export const metadata: Metadata = { title: "Material de divulgação" };

const FORMATOS: Record<string, string> = { a4: "Ficha A4", post: "Post (quadrado)", story: "Story (vertical)" };

/* Foto ocupa a arte; o texto fica sobre uma faixa escura (legível em qualquer foto). */
const faixa = "bg-[linear-gradient(to_top,rgba(10,14,20,.88),rgba(10,14,20,.35)_55%,rgba(10,14,20,0))]";

export default async function MaterialPage({ params, searchParams }: PageProps<"/marketing/materiais/[id]">) {
  const { id } = await params;
  const sp = await searchParams;
  const formato = typeof sp.formato === "string" && sp.formato in FORMATOS ? sp.formato : "a4";
  const { supabase, organizacao } = await obterContexto();
  const [{ data: i }, { data: fotos }, cfg, { data: lp }] = await Promise.all([
    supabase.from("imoveis").select("*").eq("id", id).maybeSingle(),
    supabase.from("imovel_midias").select("path, capa, ordem").eq("imovel_id", id).eq("tipo", "foto").order("capa", { ascending: false }).order("ordem").limit(4),
    obterConfig(supabase),
    supabase.from("mkt_landing_pages").select("slug").eq("imovel_id", id).eq("publicada", true).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (!i) notFound();
  const caminhos = (fotos ?? []).map((f) => f.path as string);
  const { data: assinadas } = caminhos.length ? await supabase.storage.from("imoveis").createSignedUrls(caminhos, 3600) : { data: [] };
  const urls = (assinadas ?? []).map((s) => s.signedUrl).filter((u): u is string => !!u);
  const im = i as unknown as ImovelMaterial & { id: string };
  const vendaSo = (im.finalidades ?? []).includes("venda") && !(im.finalidades ?? []).some((f) => f === "locacao" || f === "temporada");
  const preco = precoDoImovel(im, vendaSo ? "venda" : undefined);
  const destaques = destaquesImovel(im);
  const contato = cfg.whatsapp_numero || organizacao.telefone || "";
  const texto = textoAnuncio(im, { imobiliaria: organizacao.nome, telefone: contato, creci: organizacao.creci });
  const linkLp = lp ? `${await urlBase()}/lp/${lp.slug}` : null;
  const titulo = im.titulo?.trim() || `${im.tipo.charAt(0).toUpperCase() + im.tipo.slice(1)} ${vendaSo ? "à venda" : "para alugar"}`;
  const onde = [im.bairro, im.cidade].filter(Boolean).join(", ");
  const url = (k: string) => `/marketing/materiais/${id}?formato=${k}`;

  return (
    <>
      <div className="nao-imprimir">
        <Cabecalho titulo={descricaoImovel(im)} trilha="Materiais de divulgação" acoes={<BotaoImprimir />} />
        <AbasMarketing />
        <PilulasLink className="mb-4" rotulo="Formato" ativo={url(formato)} itens={Object.entries(FORMATOS).map(([k, r]) => ({ href: url(k), rotulo: r }))} />
      </div>
      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <div className="flex justify-center">
          {formato === "a4" ? (
            <article className="w-full max-w-[794px] rounded-card border border-borda bg-card p-8 print:max-w-none print:rounded-none print:border-0 print:p-0">
              <header className="flex items-start justify-between gap-4 border-b border-borda pb-4">
                <div>
                  <div className="text-[13px] text-mudo">Código {im.codigo}</div>
                  <h2 className="text-[28px] font-semibold leading-tight tracking-[-0.02em] text-texto">{titulo}</h2>
                  {onde && <div className="text-[15px] text-texto-2">{onde}</div>}
                </div>
                <div className="text-right">
                  <div className="text-[26px] font-semibold tabular-nums text-acento">{preco}</div>
                  {im.valor_condominio && Number(im.valor_condominio) > 0 ? <div className="text-sm text-texto-2">Condomínio {formatarReais(Number(im.valor_condominio))}</div> : null}
                  {im.valor_iptu && Number(im.valor_iptu) > 0 ? <div className="text-sm text-texto-2">IPTU {formatarReais(Number(im.valor_iptu))}</div> : null}
                </div>
              </header>
              {urls.length > 0 && (
                <div className={`mt-4 grid gap-2 ${urls.length > 1 ? "grid-cols-2" : ""}`}>
                  {urls.map((u, k) => (
                    // eslint-disable-next-line @next/next/no-img-element -- link temporário do Storage (sem otimização)
                    <img key={k} src={u} alt={`Foto ${k + 1} do imóvel ${im.codigo}`} className={`w-full rounded-[12px] object-cover ${k === 0 && urls.length > 2 ? "col-span-2 aspect-[16/8]" : "aspect-[4/3]"}`} />
                  ))}
                </div>
              )}
              {destaques.length > 0 && (
                <ul className="mt-5 flex flex-wrap gap-2">
                  {destaques.map((d) => (
                    <li key={d} className="rounded-full border border-borda px-3 py-1 text-sm text-texto">
                      {d}
                    </li>
                  ))}
                </ul>
              )}
              {im.descricao && <p className="mt-5 whitespace-pre-wrap text-[14.5px] leading-relaxed text-texto">{im.descricao}</p>}
              {(im.comodidades ?? []).length > 0 && (
                <div className="mt-5">
                  <h3 className="mb-2 text-[15px] font-semibold text-texto">Destaques</h3>
                  <ul className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm text-texto-2 sm:grid-cols-3">
                    {(im.comodidades ?? []).map((c) => (
                      <li key={c}>• {c}</li>
                    ))}
                  </ul>
                </div>
              )}
              <footer className="mt-6 flex flex-wrap items-end justify-between gap-3 border-t border-borda pt-4 text-sm">
                <div>
                  <div className="text-[16px] font-semibold text-texto">{organizacao.nome}</div>
                  <div className="text-texto-2">
                    {[contato, organizacao.email, organizacao.creci ? `CRECI ${organizacao.creci}` : null].filter(Boolean).join(" · ")}
                  </div>
                </div>
                {linkLp && <div className="font-mono text-[12px] text-texto-2">{linkLp}</div>}
              </footer>
            </article>
          ) : (
            <div
              className={`relative w-full overflow-hidden rounded-[20px] border border-borda bg-elev ${formato === "post" ? "aspect-square max-w-[540px]" : "aspect-[9/16] max-w-[380px]"}`}
            >
              {urls[0] ? (
                // eslint-disable-next-line @next/next/no-img-element -- link temporário do Storage (sem otimização)
                <img src={urls[0]} alt={`Foto do imóvel ${im.codigo}`} className="absolute inset-0 size-full object-cover" />
              ) : (
                <div className="absolute inset-0 bg-acento-bg" />
              )}
              <div className="absolute left-4 top-4 rounded-full bg-acento px-3 py-1 text-[13px] font-semibold text-white">{vendaSo ? "À venda" : "Para alugar"}</div>
              <div className={`absolute inset-x-0 bottom-0 p-6 text-white ${faixa}`}>
                <div className="text-[13px] opacity-90">
                  {onde} · Cód. {im.codigo}
                </div>
                <div className={`font-semibold leading-tight tracking-[-0.02em] ${formato === "post" ? "text-[30px]" : "text-[26px]"}`}>{titulo}</div>
                {destaques.length > 0 && <div className="mt-1 text-[15px] opacity-95">{destaques.slice(0, 4).join(" · ")}</div>}
                <div className={`mt-3 font-semibold tabular-nums ${formato === "post" ? "text-[34px]" : "text-[30px]"}`}>{preco}</div>
                <div className="mt-3 flex items-center justify-between gap-2 border-t border-white/30 pt-3 text-[14px]">
                  <span className="font-semibold">{organizacao.nome}</span>
                  <span>{contato}</span>
                </div>
              </div>
            </div>
          )}
        </div>
        <div className="nao-imprimir space-y-6">
          <Cartao titulo="Texto para anúncio e post" acoes={<Copiar texto={linkLp ? `${texto}\n${linkLp}` : texto} />}>
            <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-texto-2">
              {texto}
              {linkLp ? `\n${linkLp}` : ""}
            </p>
          </Cartao>
          <Cartao titulo="Como usar">
            <ul className="space-y-2 text-sm text-texto-2">
              <li>Ficha A4: clique em Imprimir e escolha “Salvar como PDF” para mandar por WhatsApp ou e-mail.</li>
              <li>Post e story: abra no celular e tire um print da arte, ou imprima em PDF.</li>
              <li>A foto usada é a capa do imóvel (aba Fotos e mídia). {urls.length ? "" : "Este imóvel ainda não tem fotos."}</li>
              {!linkLp && <li>Crie uma landing page para este imóvel (Marketing › Landing pages) e o link entra no material.</li>}
            </ul>
          </Cartao>
        </div>
      </div>
    </>
  );
}
