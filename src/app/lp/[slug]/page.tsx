import type { Metadata } from "next";
import { MessageCircle } from "lucide-react";
import { classeBotao } from "@/components/ui";
import { formatarReais } from "@/lib/dominio/dinheiro";
import { destaquesImovel, lerUtm, precoDoImovel, type ImovelMaterial } from "@/lib/dominio/marketing";
import { clienteAnonimo } from "@/lib/supabase/anonimo";
import { linkWhatsapp } from "@/lib/whatsapp";
import { FormularioLanding } from "./formulario-lp";
import { Rastreio } from "./rastreio";

type Info = {
  titulo: string;
  subtitulo: string | null;
  texto: string | null;
  chamada: string;
  funil: string;
  imagem_url: string | null;
  imobiliaria: string;
  telefone: string | null;
  creci: string | null;
  whatsapp: string | null;
  meta_pixel_id: string | null;
  google_tag_id: string | null;
  google_conversao_label: string | null;
  imovel: (ImovelMaterial & { status: string }) | null;
};

const slugOk = (s: string) => /^[a-z0-9-]{1,60}$/.test(s);

export async function generateMetadata({ params }: PageProps<"/lp/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const { data } = slugOk(slug) ? await clienteAnonimo().rpc("info_landing", { p_slug: slug, p_contar: false }) : { data: null };
  const info = data as Info | null;
  return { title: info ? `${info.titulo} · ${info.imobiliaria}` : "Página não encontrada", description: info?.subtitulo ?? undefined };
}

/** Landing page pública (anúncios, posts): quem preenche vira lead com a origem. */
export default async function LandingPublicaPage({ params, searchParams }: PageProps<"/lp/[slug]">) {
  const { slug } = await params;
  const utm = lerUtm(await searchParams);
  const { data } = slugOk(slug) ? await clienteAnonimo().rpc("info_landing", { p_slug: slug, p_contar: true }) : { data: null };
  const info = data as Info | null;

  if (!info)
    return (
      <main className="flex min-h-screen items-center justify-center bg-app px-4">
        <p className="rounded-card border border-borda bg-card p-8 text-center text-texto-2">Esta página não está mais no ar.</p>
      </main>
    );

  const im = info.imovel;
  const vendaSo = im ? (im.finalidades ?? []).includes("venda") && !(im.finalidades ?? []).some((f) => f === "locacao" || f === "temporada") : info.funil === "venda";
  const zap = info.whatsapp || info.telefone;
  const placeholder = im ? `Tenho interesse no imóvel ${im.codigo}` : info.funil === "captacao" ? "Endereço e tipo do imóvel" : "Bairro, quartos, faixa de valor…";

  return (
    <main className="min-h-screen bg-app px-4 py-8 sm:py-12">
      <Rastreio pixel={info.meta_pixel_id} tag={info.google_tag_id} conversao={info.google_conversao_label} />
      <div className="mx-auto grid max-w-5xl gap-6 lg:grid-cols-[1fr_420px]">
        <section className="space-y-5">
          <div className="text-sm font-medium text-acento">{info.imobiliaria}</div>
          <h1 className="text-[clamp(30px,4vw,44px)] font-semibold leading-[1.05] tracking-[-0.025em] text-texto">{info.titulo}</h1>
          {info.subtitulo && <p className="text-[17px] text-texto-2">{info.subtitulo}</p>}
          {info.imagem_url && (
            // eslint-disable-next-line @next/next/no-img-element -- imagem externa escolhida pela imobiliária
            <img src={info.imagem_url} alt={info.titulo} className="aspect-[16/9] w-full rounded-card border border-borda object-cover" />
          )}
          {im && im.status === "disponivel" && (
            <div className="rounded-card border border-borda bg-card p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-xs text-mudo">Código {im.codigo}</div>
                  <div className="text-[18px] font-semibold capitalize text-texto">
                    {im.titulo?.trim() || im.tipo} {[im.bairro, im.cidade].filter(Boolean).length ? `— ${[im.bairro, im.cidade].filter(Boolean).join(", ")}` : ""}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[22px] font-semibold tabular-nums text-acento">{precoDoImovel(im, vendaSo ? "venda" : undefined)}</div>
                  {im.valor_condominio && Number(im.valor_condominio) > 0 ? <div className="text-xs text-texto-2">condomínio {formatarReais(Number(im.valor_condominio))}</div> : null}
                </div>
              </div>
              {destaquesImovel(im).length > 0 && (
                <ul className="mt-3 flex flex-wrap gap-2">
                  {destaquesImovel(im).map((d) => (
                    <li key={d} className="rounded-full border border-borda px-3 py-1 text-sm text-texto">
                      {d}
                    </li>
                  ))}
                </ul>
              )}
              {im.descricao && <p className="mt-3 whitespace-pre-wrap text-[14.5px] leading-relaxed text-texto-2">{im.descricao}</p>}
              {(im.comodidades ?? []).length > 0 && <p className="mt-3 text-sm text-texto-2">{(im.comodidades ?? []).join(" · ")}</p>}
            </div>
          )}
          {im && im.status !== "disponivel" && <p className="text-sm text-texto-2">Este imóvel não está mais disponível, mas temos outras opções parecidas. Deixe seus dados!</p>}
          {info.texto && <p className="whitespace-pre-wrap text-[15.5px] leading-relaxed text-texto">{info.texto}</p>}
        </section>
        <aside className="h-fit rounded-card border border-borda bg-card p-6 shadow-[0_24px_60px_-30px_rgba(0,0,0,.35)] lg:sticky lg:top-6">
          <h2 className="mb-1 text-[20px] font-semibold tracking-[-0.01em] text-texto">{info.chamada}</h2>
          <p className="mb-5 text-sm text-texto-2">Deixe seus dados que retornamos rapidinho.</p>
          <FormularioLanding slug={slug} utm={utm} chamada={info.chamada} placeholder={placeholder} conversaoGoogle={info.google_conversao_label} />
          {zap && (
            <a
              href={linkWhatsapp(zap, `Olá! Vi a página "${info.titulo}"${im ? ` (imóvel ${im.codigo})` : ""} e quero mais informações.`)}
              target="_blank"
              rel="noreferrer"
              className={`${classeBotao("secundario")} mt-3 w-full`}
            >
              <MessageCircle className="size-4" /> Falar no WhatsApp
            </a>
          )}
          <p className="mt-4 text-center text-[11px] text-mudo">
            {info.imobiliaria}
            {info.creci ? ` · CRECI ${info.creci}` : ""}
          </p>
        </aside>
      </div>
    </main>
  );
}
