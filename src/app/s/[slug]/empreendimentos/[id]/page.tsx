import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Building, CalendarClock, MapPin } from "lucide-react";
import { Selo } from "@/components/ui";
import { formatarDataBR, hojeISO, somarDias } from "@/lib/dominio/datas";
import { formatarReais } from "@/lib/dominio/dinheiro";
import { ROTULO_FASE, descricaoSeo, embedVideo, tourSeguro } from "@/lib/dominio/site";
import { carregarEmpreendimentos, carregarImoveis, carregarSite, enderecosDoSite, urlFotoFixa, urlsDasFotos } from "@/lib/servicos/site";
import { GradeImoveis, Secao } from "../../componentes";
import { FormContato, Galeria } from "../../interativo";

async function dados(slug: string, id: string) {
  const [site, emps] = await Promise.all([carregarSite(slug), carregarEmpreendimentos(slug)]);
  const emp = emps.find((e) => e.id === id);
  return site && emp ? { site, emp } : null;
}

export async function generateMetadata({ params }: PageProps<"/s/[slug]/empreendimentos/[id]">): Promise<Metadata> {
  const { slug, id } = await params;
  const d = await dados(slug, id);
  if (!d) return { title: "Empreendimento não encontrado", robots: { index: false } };
  const { base, origem } = await enderecosDoSite(d.site);
  const e = d.emp;
  const titulo = `${e.nome}${e.fase ? ` — ${ROTULO_FASE[e.fase]}` : ""}`;
  const descricao = descricaoSeo(e.descricao || `${e.nome} em ${[e.bairro, e.cidade].filter(Boolean).join(", ")}. Unidades, valores e contato.`);
  return {
    title: titulo,
    description: descricao,
    alternates: { canonical: `${base}/empreendimentos/${e.id}` },
    openGraph: { title: titulo, description: descricao, images: e.capa ? [{ url: urlFotoFixa(origem, slug, e.capa.id) }] : undefined },
  };
}

/** Página do empreendimento/lançamento: fase, entrega, unidades disponíveis, vídeo, tour e contato. */
export default async function EmpreendimentoSitePage({ params }: PageProps<"/s/[slug]/empreendimentos/[id]">) {
  const { slug, id } = await params;
  const d = await dados(slug, id);
  if (!d) notFound();
  const { site, emp: e } = d;
  const [todos, { base }] = await Promise.all([carregarImoveis(slug), enderecosDoSite(site)]);
  const unidades = todos.filter((i) => i.empreendimento_id === e.id);
  const fotos = await urlsDasFotos(unidades.map((i) => i.capa?.path));
  const galeria = unidades.flatMap((i) => (i.capa && fotos.get(i.capa.path) ? [{ url: fotos.get(i.capa.path)!, nome: i.codigo }] : [])).slice(0, 12);
  const video = embedVideo(e.video_url);
  const tour = tourSeguro(e.tour_url);
  const endereco = [[e.logradouro, e.numero].filter(Boolean).join(", "), e.bairro, [e.cidade, e.uf].filter(Boolean).join("/")].filter(Boolean).join(" · ");

  return (
    <div className="space-y-10">
      <nav aria-label="Caminho" className="flex flex-wrap items-center gap-2 text-[13px] text-mudo">
        <Link href={base || "/"} className="hover:text-acento">
          Início
        </Link>
        <span className="text-fraco">›</span>
        <Link href={`${base}/empreendimentos`} className="hover:text-acento">
          Lançamentos
        </Link>
        <span className="text-fraco">›</span>
        <span className="text-acento-hot">{e.nome}</span>
      </nav>
      <div className="grid items-start gap-8 lg:grid-cols-[1fr_380px]">
        <div className="min-w-0 space-y-6">
          <Galeria fotos={galeria} titulo={e.nome} />
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              {e.fase && <Selo cor={e.fase === "lancamento" ? "azul" : e.fase === "em_obras" ? "amarelo" : "verde"}>{ROTULO_FASE[e.fase].toUpperCase()}</Selo>}
              {e.construtora && <Selo>{e.construtora.toUpperCase()}</Selo>}
            </div>
            <h1 className="text-[clamp(26px,3vw,36px)] font-semibold leading-tight tracking-[-0.025em] text-texto">{e.nome}</h1>
            {endereco && (
              <p className="flex items-center gap-1.5 text-[15px] text-texto-2">
                <MapPin className="size-4 shrink-0 text-mudo" /> {endereco}
              </p>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-card border border-borda bg-card p-4">
              <Building className="mb-1.5 size-5 text-acento" />
              <div className="text-xs text-mudo">Unidades disponíveis</div>
              <div className="text-[20px] font-semibold text-texto">{e.unidades}</div>
            </div>
            <div className="rounded-card border border-borda bg-card p-4">
              <div className="mb-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-mudo">A partir de</div>
              <div className="text-[20px] font-semibold text-acento">{e.venda_desde ? formatarReais(e.venda_desde) : e.aluguel_desde ? `${formatarReais(e.aluguel_desde)}/mês` : "Consulte"}</div>
            </div>
            <div className="rounded-card border border-borda bg-card p-4">
              <CalendarClock className="mb-1.5 size-5 text-acento" />
              <div className="text-xs text-mudo">Entrega prevista</div>
              <div className="text-[20px] font-semibold text-texto">{e.previsao_entrega ? formatarDataBR(e.previsao_entrega).slice(3) : e.fase === "pronto" ? "Pronto" : "—"}</div>
            </div>
          </div>
          {e.descricao && <p className="whitespace-pre-line text-[15px] leading-relaxed text-texto-2">{e.descricao}</p>}
          {video && <iframe title={`Vídeo — ${e.nome}`} src={video} className="aspect-video w-full rounded-card border border-borda" allowFullScreen loading="lazy" />}
          {tour && <iframe title={`Tour virtual — ${e.nome}`} src={tour} className="aspect-video w-full rounded-card border border-borda" allowFullScreen loading="lazy" referrerPolicy="no-referrer" />}
        </div>
        <aside className="entrar rounded-card border border-borda bg-card p-5 lg:sticky lg:top-24">
          <h2 className="mb-3 text-[17px] font-semibold text-texto">Quero saber mais</h2>
          <FormContato
            slug={slug}
            empreendimento={e.id}
            agendamento={false}
            mensagemPadrao={`Olá! Tenho interesse no ${e.nome}. Pode me mandar a tabela de valores e as plantas?`}
            whatsapp={site.whatsapp}
            amanha={somarDias(hojeISO(), 1)}
          />
        </aside>
      </div>
      <Secao titulo="Unidades disponíveis">
        <GradeImoveis itens={unidades} base={base} slug={slug} fotos={fotos} vazio="As unidades deste empreendimento aparecem aqui assim que forem publicadas." />
      </Secao>
    </div>
  );
}
