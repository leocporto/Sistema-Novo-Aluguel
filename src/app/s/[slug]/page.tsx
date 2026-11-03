import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, Building2, Home, KeyRound, Search } from "lucide-react";
import { BotaoLink, Selecao, classeBotao } from "@/components/ui";
import { atendeFinalidade, opcoesFiltro } from "@/lib/dominio/site";
import { carregarEmpreendimentos, carregarImoveis, carregarSite, enderecosDoSite, urlsDasFotos } from "@/lib/servicos/site";
import { CartaoEmpreendimento, GradeImoveis, Secao } from "./componentes";

export async function generateMetadata({ params }: PageProps<"/s/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const site = await carregarSite(slug);
  if (!site) return {};
  const { base } = await enderecosDoSite(site);
  return { alternates: { canonical: base || "/" } };
}

/** Página inicial do site: busca, destaques, lançamentos, bairros e "anuncie". */
export default async function InicioSitePage({ params }: PageProps<"/s/[slug]">) {
  const { slug } = await params;
  const site = await carregarSite(slug);
  if (!site) notFound();
  const [imoveis, emps, { base }] = await Promise.all([carregarImoveis(slug), carregarEmpreendimentos(slug), enderecosDoSite(site)]);
  const destaques = imoveis.slice(0, 6);
  const lancamentos = emps.slice(0, 3);
  const fotos = await urlsDasFotos([...destaques.map((i) => i.capa?.path), ...lancamentos.map((e) => e.capa?.path)]);
  const op = opcoesFiltro(imoveis);
  const nAluguel = imoveis.filter((i) => atendeFinalidade(i, "locacao")).length;
  const nVenda = imoveis.filter((i) => atendeFinalidade(i, "venda")).length;
  const bairros = op.bairros.slice(0, 10);

  return (
    <div className="space-y-12">
      <section
        className="entrar relative overflow-hidden rounded-[24px] px-5 py-10 sm:px-10 sm:py-14"
        style={{ background: "linear-gradient(135deg, var(--site-escuro), var(--accent-hot))", color: "var(--site-sobre-escuro)" }}
      >
        <div className="max-w-2xl">
          <h1 className="text-[clamp(30px,4.4vw,48px)] font-semibold leading-[1.05] tracking-[-0.03em]">{site.titulo_home || "Encontre o imóvel certo para você"}</h1>
          <p className="mt-3 text-[clamp(15px,1.6vw,18px)] opacity-85">
            {site.subtitulo_home || `${imoveis.length} ${imoveis.length === 1 ? "imóvel disponível" : "imóveis disponíveis"} para alugar e comprar com ${site.nome}.`}
          </p>
        </div>
        <Form action={`${base}/imoveis`} className="mt-7 grid gap-2 rounded-[18px] bg-card p-3 text-texto shadow-[0_24px_60px_-30px_rgba(0,0,0,.6)] sm:grid-cols-2 lg:grid-cols-[1fr_1.3fr_1.3fr_1fr_auto]">
          <Selecao name="finalidade" aria-label="Comprar ou alugar" defaultValue={nAluguel >= nVenda ? "locacao" : "venda"}>
            <option value="locacao">Alugar</option>
            <option value="venda">Comprar</option>
          </Selecao>
          <Selecao name="cidade" aria-label="Cidade" defaultValue="">
            <option value="">Todas as cidades</option>
            {op.cidades.map((c) => (
              <option key={c.rotulo} value={c.rotulo}>
                {c.rotulo} ({c.n})
              </option>
            ))}
          </Selecao>
          <Selecao name="tipo" aria-label="Tipo de imóvel" defaultValue="">
            <option value="">Todos os tipos</option>
            {op.tipos.map((t) => (
              <option key={t.rotulo} value={t.rotulo}>
                {t.rotulo.charAt(0).toUpperCase() + t.rotulo.slice(1)}
              </option>
            ))}
          </Selecao>
          <Selecao name="quartos" aria-label="Quartos" defaultValue="">
            <option value="">Quartos</option>
            {[1, 2, 3, 4].map((n) => (
              <option key={n} value={n}>
                {n}+ quartos
              </option>
            ))}
          </Selecao>
          <button type="submit" className={classeBotao("primario")}>
            <Search className="size-4" /> Buscar
          </button>
        </Form>
        <div className="mt-4 flex flex-wrap gap-2 text-sm">
          <Link href={`${base}/imoveis?finalidade=locacao`} className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 font-medium opacity-90 ring-1 ring-current/30 transition hover:opacity-100">
            <KeyRound className="size-4" /> {nAluguel} para alugar
          </Link>
          <Link href={`${base}/imoveis?finalidade=venda`} className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 font-medium opacity-90 ring-1 ring-current/30 transition hover:opacity-100">
            <Home className="size-4" /> {nVenda} à venda
          </Link>
        </div>
      </section>

      <Secao
        titulo="Imóveis em destaque"
        descricao="Os mais recentes no nosso catálogo."
        acoes={
          <BotaoLink href={`${base}/imoveis`} variante="secundario">
            Ver todos <ArrowRight className="size-4" />
          </BotaoLink>
        }
      >
        <GradeImoveis itens={destaques} base={base} slug={slug} fotos={fotos} vazio="Em breve novos imóveis por aqui." />
      </Secao>

      {lancamentos.length > 0 && (
        <Secao
          titulo="Lançamentos e empreendimentos"
          acoes={
            <BotaoLink href={`${base}/empreendimentos`} variante="secundario">
              Ver todos <ArrowRight className="size-4" />
            </BotaoLink>
          }
        >
          <div className="entrar-cascata grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {lancamentos.map((e) => (
              <CartaoEmpreendimento key={e.id} e={e} base={base} foto={e.capa ? (fotos.get(e.capa.path) ?? null) : null} />
            ))}
          </div>
        </Secao>
      )}

      {bairros.length > 1 && (
        <Secao titulo="Busque por bairro">
          <div className="flex flex-wrap gap-2">
            {bairros.map((b) => (
              <Link key={b.rotulo} href={`${base}/imoveis?bairro=${encodeURIComponent(b.rotulo)}`} className="rounded-full border border-borda bg-card px-4 py-2 text-sm text-texto transition hover:-translate-y-px hover:border-acento hover:text-acento">
                {b.rotulo} <span className="text-mudo">({b.n})</span>
              </Link>
            ))}
          </div>
        </Secao>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        {site.captacao_ativa && (
          <section className="entrar flex flex-col justify-between gap-4 rounded-card border border-acento-bd bg-acento-bg p-6 sm:p-8">
            <div>
              <Building2 className="mb-3 size-8 text-acento" />
              <h2 className="text-[22px] font-semibold tracking-[-0.02em] text-texto">Quer alugar ou vender seu imóvel?</h2>
              <p className="mt-1.5 text-sm text-texto-2">Mande os dados e um corretor fala com você. Cuidamos do anúncio, das visitas e do contrato.</p>
            </div>
            <BotaoLink href={`${base}/anuncie`}>Anunciar meu imóvel</BotaoLink>
          </section>
        )}
        {site.sobre && (
          <section className="entrar rounded-card border border-borda bg-card p-6 sm:p-8">
            <h2 className="text-[22px] font-semibold tracking-[-0.02em] text-texto">Sobre a {site.nome}</h2>
            <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-texto-2">{site.sobre}</p>
          </section>
        )}
      </div>
    </div>
  );
}
