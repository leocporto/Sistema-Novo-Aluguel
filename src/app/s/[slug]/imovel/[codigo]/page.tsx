import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Check, MapPin } from "lucide-react";
import { consultaMapa } from "@/app/(app)/imoveis/mapa";
import { Copiar } from "@/components/copiar";
import { Aviso, Selo } from "@/components/ui";
import { hojeISO, somarDias } from "@/lib/dominio/datas";
import { formatarReais } from "@/lib/dominio/dinheiro";
import { descricaoSeo, embedVideo, enderecoPublico, jsonLdImovel, jsonSeguro, precosExibidos, resumoImovel, similares, tituloImovel, tourSeguro } from "@/lib/dominio/site";
import { carregarImovel, carregarImoveis, carregarSite, enderecosDoSite, urlFotoFixa, urlsDasFotos } from "@/lib/servicos/site";
import { Caracteristicas, GradeImoveis, Secao, linkImovel } from "../../componentes";
import { BotaoComparar, BotaoFavorito, FormContato, Galeria } from "../../interativo";

const decodificar = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

async function dados(slug: string, codigo: string) {
  const [site, imovel] = await Promise.all([carregarSite(slug), carregarImovel(slug, decodificar(codigo))]);
  return site && imovel ? { site, imovel } : null;
}

export async function generateMetadata({ params }: PageProps<"/s/[slug]/imovel/[codigo]">): Promise<Metadata> {
  const { slug, codigo } = await params;
  const d = await dados(slug, codigo);
  if (!d) return { title: "Imóvel não encontrado", robots: { index: false } };
  const { base, origem } = await enderecosDoSite(d.site);
  const i = d.imovel;
  const titulo = tituloImovel(i);
  const descricao = descricaoSeo([resumoImovel(i), i.descricao].filter(Boolean).join(". "));
  const fotos = (i.midias ?? []).filter((m) => m.tipo === "foto").slice(0, 4);
  const url = linkImovel(base, i.codigo);
  return {
    title: titulo,
    description: descricao,
    alternates: { canonical: url },
    openGraph: { title: titulo, description: descricao, url, type: "website", images: fotos.map((m) => ({ url: urlFotoFixa(origem, slug, m.id), alt: titulo })) },
    twitter: { card: fotos.length ? "summary_large_image" : "summary", title: titulo, description: descricao },
  };
}

/** Página do imóvel: galeria, vídeo, tour, características, mapa, parecidos e contato/visita. */
export default async function ImovelSitePage({ params }: PageProps<"/s/[slug]/imovel/[codigo]">) {
  const { slug, codigo } = await params;
  const d = await dados(slug, codigo);
  if (!d) notFound();
  const { site, imovel: i } = d;
  const [{ base, origem }, todos] = await Promise.all([enderecosDoSite(site), carregarImoveis(slug)]);
  const parecidos = similares(i, todos, 3);
  const midias = i.midias ?? [];
  const fotosMidia = midias.filter((m) => m.tipo === "foto");
  const plantas = midias.filter((m) => m.tipo === "planta");
  const urls = await urlsDasFotos([...midias.map((m) => m.path), ...parecidos.map((p) => p.capa?.path)]);
  const titulo = tituloImovel(i);
  const p = precosExibidos(i);
  const video = embedVideo(i.video_url);
  const tour = tourSeguro(i.tour_url);
  const mapa = consultaMapa({
    latitude: i.latitude ?? null,
    longitude: i.longitude ?? null,
    logradouro: i.logradouro ?? null,
    numero: i.numero ?? null,
    bairro: i.bairro,
    cidade: i.cidade,
    uf: i.uf,
    cep: i.cep ?? null,
  });
  const urlAbsoluta = `${origem}${linkImovel(base, i.codigo)}`;
  const vendaSo = !p.aluguel && !!p.venda;
  const ld = jsonLdImovel(
    i,
    urlAbsoluta,
    fotosMidia.slice(0, 10).map((m) => urlFotoFixa(origem, slug, m.id)),
    { nome: site.nome, url: `${origem}${base || "/"}`, telefone: site.telefone || site.whatsapp },
  );

  return (
    <div className="space-y-10">
      <nav aria-label="Caminho" className="flex flex-wrap items-center gap-2 text-[13px] text-mudo">
        <Link href={base || "/"} className="hover:text-acento">
          Início
        </Link>
        <span className="text-fraco">›</span>
        <Link href={`${base}/imoveis${vendaSo ? "?finalidade=venda" : p.aluguel ? "?finalidade=locacao" : ""}`} className="hover:text-acento">
          {vendaSo ? "Comprar" : "Alugar"}
        </Link>
        <span className="text-fraco">›</span>
        <span className="text-acento-hot">Cód. {i.codigo}</span>
      </nav>

      <div className="grid items-start gap-8 lg:grid-cols-[1fr_380px]">
        <div className="min-w-0 space-y-6">
          <Galeria fotos={fotosMidia.flatMap((m) => (urls.get(m.path) ? [{ url: urls.get(m.path)!, nome: m.nome }] : []))} titulo={titulo} />
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              {i.status === "reservado" && <Selo cor="amarelo">RESERVADO</Selo>}
              {i.empreendimento && i.empreendimento_id && (
                <Link href={`${base}/empreendimentos/${i.empreendimento_id}`}>
                  <Selo cor="azul">{i.empreendimento.toUpperCase()}</Selo>
                </Link>
              )}
              <Selo>CÓD. {i.codigo}</Selo>
            </div>
            <h1 className="text-[clamp(24px,3vw,34px)] font-semibold leading-tight tracking-[-0.025em] text-texto">{titulo}</h1>
            <p className="flex items-center gap-1.5 text-[15px] text-texto-2">
              <MapPin className="size-4 shrink-0 text-mudo" /> {enderecoPublico(i) || "Endereço sob consulta"}
            </p>
          </div>
          <div className="rounded-card border border-borda bg-card p-5">
            <Caracteristicas i={i} grande />
          </div>
          {i.status === "reservado" && <Aviso tipo="alerta">Este imóvel está reservado. Deixe seu contato para ser avisado(a) se ele voltar a ficar disponível.</Aviso>}
          {i.descricao && (
            <section className="space-y-2">
              <h2 className="text-[19px] font-semibold text-texto">Sobre o imóvel</h2>
              <p className="whitespace-pre-line text-[15px] leading-relaxed text-texto-2">{i.descricao}</p>
            </section>
          )}
          {(i.comodidades.length > 0 || i.caracteristicas.length > 0) && (
            <section className="space-y-3">
              <h2 className="text-[19px] font-semibold text-texto">Comodidades</h2>
              <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {[...i.comodidades, ...i.caracteristicas].map((c) => (
                  <li key={c} className="flex items-center gap-2 text-[14px] text-texto-2">
                    <Check className="size-4 shrink-0 text-ok" /> {c}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {video && (
            <section className="space-y-3">
              <h2 className="text-[19px] font-semibold text-texto">Vídeo</h2>
              <iframe title={`Vídeo — ${titulo}`} src={video} className="aspect-video w-full rounded-card border border-borda" allowFullScreen loading="lazy" />
            </section>
          )}
          {tour && (
            <section className="space-y-3">
              <h2 className="text-[19px] font-semibold text-texto">Tour virtual</h2>
              <iframe title={`Tour virtual — ${titulo}`} src={tour} className="aspect-video w-full rounded-card border border-borda" allowFullScreen loading="lazy" referrerPolicy="no-referrer" />
            </section>
          )}
          {plantas.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-[19px] font-semibold text-texto">Plantas</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {plantas.map((m) =>
                  urls.get(m.path) ? (
                    <a key={m.id} href={urls.get(m.path)} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-card border border-borda bg-card">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={urls.get(m.path)} alt={`Planta — ${titulo}`} loading="lazy" className="w-full object-contain" />
                    </a>
                  ) : null,
                )}
              </div>
            </section>
          )}
          {mapa && (
            <section className="space-y-3">
              <h2 className="text-[19px] font-semibold text-texto">Localização</h2>
              <iframe
                title="Mapa do imóvel"
                src={`https://maps.google.com/maps?q=${encodeURIComponent(mapa)}&z=${site.mostrar_endereco ? 16 : 14}&output=embed`}
                className="h-72 w-full rounded-card border border-borda"
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
              />
              {!site.mostrar_endereco && <p className="text-xs text-mudo">Localização aproximada. O endereço exato é passado no contato.</p>}
            </section>
          )}
        </div>

        <aside className="space-y-4 lg:sticky lg:top-24">
          <div className="entrar space-y-3 rounded-card border border-borda bg-card p-5">
            {p.aluguel && (
              <div>
                <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-mudo">Aluguel</div>
                <div className="text-[30px] font-semibold tracking-[-0.025em] text-acento">{formatarReais(p.aluguel)}</div>
              </div>
            )}
            {p.venda && (
              <div>
                <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-mudo">Venda</div>
                <div className={`${p.aluguel ? "text-[22px]" : "text-[30px]"} font-semibold tracking-[-0.025em] text-acento`}>{formatarReais(p.venda)}</div>
              </div>
            )}
            {!p.aluguel && !p.venda && <div className="text-[22px] font-semibold text-texto">Consulte o valor</div>}
            {(p.condominio || p.iptu) && (
              <dl className="space-y-1 border-t border-borda-suave pt-3 text-sm">
                {p.condominio ? (
                  <div className="flex justify-between">
                    <dt className="text-texto-2">Condomínio</dt>
                    <dd className="font-medium text-texto">{formatarReais(p.condominio)}</dd>
                  </div>
                ) : null}
                {p.iptu ? (
                  <div className="flex justify-between">
                    <dt className="text-texto-2">IPTU (mês)</dt>
                    <dd className="font-medium text-texto">{formatarReais(p.iptu)}</dd>
                  </div>
                ) : null}
                {p.totalMes ? (
                  <div className="flex justify-between border-t border-borda-suave pt-1">
                    <dt className="font-semibold text-texto">Total por mês</dt>
                    <dd className="font-semibold text-texto">{formatarReais(p.totalMes)}</dd>
                  </div>
                ) : null}
              </dl>
            )}
            <div className="flex flex-wrap gap-2 pt-1">
              <BotaoFavorito slug={slug} codigo={i.codigo} comTexto />
              <BotaoComparar slug={slug} codigo={i.codigo} tamanho="md" />
              <Copiar texto={urlAbsoluta} rotulo="Copiar link" />
            </div>
          </div>
          <div className="entrar rounded-card border border-borda bg-card p-5">
            <h2 className="mb-3 text-[17px] font-semibold text-texto">Gostou? Fale com a gente</h2>
            <FormContato
              slug={slug}
              imovel={i.codigo}
              funil={vendaSo ? "venda" : undefined}
              ambas={!!p.aluguel && !!p.venda}
              agendamento={site.agendamento_ativo}
              horario={i.horario_visitas}
              mensagemPadrao={`Olá! Tenho interesse no imóvel ${i.codigo} — ${titulo}. Pode me passar mais informações?`}
              whatsapp={site.whatsapp}
              amanha={somarDias(hojeISO(), 1)}
            />
          </div>
        </aside>
      </div>

      {parecidos.length > 0 && (
        <Secao titulo="Imóveis parecidos">
          <GradeImoveis itens={parecidos} base={base} slug={slug} fotos={urls} />
        </Secao>
      )}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonSeguro(ld) }} />
    </div>
  );
}
