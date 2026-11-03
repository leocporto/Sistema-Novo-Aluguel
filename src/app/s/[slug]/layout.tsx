import type { CSSProperties } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import Script from "next/script";
import { notFound } from "next/navigation";
import { Mail, MessageCircle, Phone } from "lucide-react";
import { ga4Valido, jsonLdImobiliaria, jsonSeguro, paletaMarca } from "@/lib/dominio/site";
import { carregarSite, enderecosDoSite, urlLogo } from "@/lib/servicos/site";
import { linkWhatsapp } from "@/lib/whatsapp";
import { BarraComparar, ContadorFavoritos } from "./interativo";
import { TEMA_CLARO } from "./tema";

export async function generateMetadata({ params }: LayoutProps<"/s/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const site = await carregarSite(slug);
  if (!site) return { title: "Site não encontrado", robots: { index: false } };
  const { origem } = await enderecosDoSite(site);
  const logo = urlLogo(site.logo_path);
  return {
    title: { default: site.seo_titulo || site.nome, template: `%s · ${site.nome}` },
    description: site.seo_descricao || site.slogan || `Imóveis para alugar e comprar com ${site.nome}.`,
    metadataBase: new URL(origem),
    applicationName: site.nome,
    openGraph: { siteName: site.nome, locale: "pt_BR", type: "website", images: logo ? [{ url: logo }] : undefined },
    icons: logo ? { icon: logo, apple: logo } : undefined,
    robots: { index: true, follow: true },
  };
}

/** Moldura do site público: topo com a marca, navegação, rodapé com contatos, WhatsApp e Analytics. */
export default async function SiteLayout({ children, params }: LayoutProps<"/s/[slug]">) {
  const { slug } = await params;
  const site = await carregarSite(slug);
  if (!site) notFound();
  const { base, origem } = await enderecosDoSite(site);
  const logo = urlLogo(site.logo_path);
  const estilo = { ...TEMA_CLARO, ...paletaMarca(site.cor_primaria, site.cor_secundaria) } as CSSProperties;
  const zap = site.whatsapp || null;
  const ga = ga4Valido(site.ga4_id) ? site.ga4_id : null;
  const inicio = base || "/";
  const links = [
    { href: `${base}/imoveis?finalidade=venda`, rotulo: "Comprar" },
    { href: `${base}/imoveis?finalidade=locacao`, rotulo: "Alugar" },
    ...(site.tem_empreendimentos ? [{ href: `${base}/empreendimentos`, rotulo: "Lançamentos" }] : []),
    ...(site.captacao_ativa ? [{ href: `${base}/anuncie`, rotulo: "Anuncie seu imóvel" }] : []),
  ];
  const ld = jsonLdImobiliaria({
    nome: site.nome,
    url: `${origem}${inicio}`,
    logo,
    telefone: site.telefone || site.whatsapp,
    email: site.email,
    endereco: site.endereco,
    redes: [site.instagram, site.facebook, site.youtube],
  });

  return (
    <div style={estilo} className="flex min-h-screen flex-col bg-app font-sans text-texto">
      <header className="sticky top-0 z-40 border-b border-borda bg-card/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3 sm:px-6">
          <Link href={inicio} className="flex min-w-0 items-center gap-3">
            {logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logo} alt={site.nome} className="h-11 max-w-[180px] object-contain" />
            ) : (
              <span className="grid size-11 shrink-0 place-items-center rounded-[13px] bg-acento text-lg font-bold text-white">{site.nome.charAt(0).toUpperCase()}</span>
            )}
            <span className="min-w-0">
              <span className="block truncate text-[17px] font-semibold tracking-[-0.01em] text-texto">{site.nome}</span>
              {site.slogan && <span className="hidden truncate text-xs text-mudo sm:block">{site.slogan}</span>}
            </span>
          </Link>
          <nav aria-label="Navegação do site" className="ml-auto hidden items-center gap-5 text-[14px] font-medium text-texto-2 lg:flex">
            {links.map((l) => (
              <Link key={l.href} href={l.href} className="transition hover:text-acento">
                {l.rotulo}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2 lg:ml-0">
            <ContadorFavoritos slug={slug} base={base} />
            {zap && (
              <a href={linkWhatsapp(zap, `Olá! Vim pelo site da ${site.nome}.`)} target="_blank" rel="noreferrer" className="hidden h-10 items-center gap-2 rounded-full bg-ok px-4 text-sm font-semibold text-white transition hover:-translate-y-px sm:inline-flex">
                <MessageCircle className="size-4" /> WhatsApp
              </a>
            )}
          </div>
        </div>
        <nav aria-label="Navegação do site" className="mx-auto flex max-w-7xl gap-4 overflow-x-auto px-4 pb-2.5 text-[14px] font-medium text-texto-2 sm:px-6 lg:hidden">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className="whitespace-nowrap hover:text-acento">
              {l.rotulo}
            </Link>
          ))}
        </nav>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 sm:py-8">{children}</main>

      <footer className="mt-10" style={{ background: "var(--site-escuro)", color: "var(--site-sobre-escuro)" }}>
        <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 text-sm sm:grid-cols-3 sm:px-6">
          <div className="space-y-2">
            <div className="text-[17px] font-semibold">{site.nome}</div>
            {site.slogan && <p className="opacity-80">{site.slogan}</p>}
            {site.creci && <p className="opacity-70">CRECI {site.creci}</p>}
            {site.endereco && <p className="opacity-70">{site.endereco}</p>}
          </div>
          <div className="space-y-2">
            <div className="font-semibold">Fale com a gente</div>
            {zap && (
              <a href={linkWhatsapp(zap, `Olá! Vim pelo site da ${site.nome}.`)} target="_blank" rel="noreferrer" className="flex items-center gap-2 opacity-85 hover:opacity-100">
                <MessageCircle className="size-4" /> WhatsApp
              </a>
            )}
            {site.telefone && (
              <a href={`tel:${site.telefone.replace(/[^\d+]/g, "")}`} className="flex items-center gap-2 opacity-85 hover:opacity-100">
                <Phone className="size-4" /> {site.telefone}
              </a>
            )}
            {site.email && (
              <a href={`mailto:${site.email}`} className="flex items-center gap-2 opacity-85 hover:opacity-100">
                <Mail className="size-4" /> {site.email}
              </a>
            )}
            <div className="flex gap-3 pt-1">
              {[
                ["Instagram", site.instagram],
                ["Facebook", site.facebook],
                ["YouTube", site.youtube],
              ]
                .filter(([, u]) => u && /^https:\/\//.test(u))
                .map(([n, u]) => (
                  <a key={n} href={u!} target="_blank" rel="noreferrer" className="underline opacity-85 hover:opacity-100">
                    {n}
                  </a>
                ))}
            </div>
          </div>
          <div className="space-y-2">
            <div className="font-semibold">Navegue</div>
            <Link href={`${base}/imoveis`} className="block opacity-85 hover:opacity-100">
              Todos os imóveis
            </Link>
            {links.map((l) => (
              <Link key={l.href} href={l.href} className="block opacity-85 hover:opacity-100">
                {l.rotulo}
              </Link>
            ))}
            <Link href={`${base}/favoritos`} className="block opacity-85 hover:opacity-100">
              Meus favoritos
            </Link>
          </div>
        </div>
        <div className="px-4 py-4 text-center text-xs opacity-60" style={{ borderTop: "1px solid color-mix(in srgb, currentColor 15%, transparent)" }}>
          © {site.nome}. Seus dados são usados só para o contato sobre imóveis.
        </div>
      </footer>

      {zap && (
        <a
          href={linkWhatsapp(zap, `Olá! Vim pelo site da ${site.nome}.`)}
          target="_blank"
          rel="noreferrer"
          aria-label="Conversar no WhatsApp"
          className="fixed bottom-5 right-5 z-40 grid size-14 place-items-center rounded-full bg-ok text-white shadow-[0_12px_30px_-10px_rgba(0,0,0,.5)] transition hover:-translate-y-0.5 active:scale-95"
        >
          <MessageCircle className="size-7" />
        </a>
      )}
      <BarraComparar slug={slug} base={base} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonSeguro(ld) }} />
      {ga && (
        <>
          <Script src={`https://www.googletagmanager.com/gtag/js?id=${ga}`} strategy="afterInteractive" />
          <Script id="ga4" strategy="afterInteractive">{`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${ga}');`}</Script>
        </>
      )}
    </div>
  );
}
