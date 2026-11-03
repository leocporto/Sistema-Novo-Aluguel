import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { FiltroAutomatico } from "@/components/filtro-automatico";
import { PilulasLink } from "@/components/pilulas-link";
import { BotaoLink, Campo, Entrada, Selecao } from "@/components/ui";
import {
  ROTULO_ORDEM,
  filtrarImoveis,
  lerFiltros,
  opcoesFiltro,
  ordenarImoveis,
  paginar,
  pontosValidos,
  precoCurto,
  precoDe,
  queryFiltros,
  resumoImovel,
  tituloImovel,
  type FiltrosSite,
} from "@/lib/dominio/site";
import { carregarImoveis, carregarSite, enderecosDoSite, urlsDasFotos } from "@/lib/servicos/site";
import { GradeImoveis, linkImovel } from "../componentes";
import { MapaSite } from "../mapa-site";

function tituloBusca(f: FiltrosSite) {
  const base = f.finalidade === "venda" ? "Imóveis à venda" : f.finalidade === "locacao" ? "Imóveis para alugar" : "Imóveis";
  const tipo = f.tipo ? ` — ${f.tipo}` : "";
  const local = f.bairro || f.cidade ? ` em ${[f.bairro, f.cidade].filter(Boolean).join(", ")}` : "";
  return `${base}${local}${tipo}`;
}

export async function generateMetadata({ params, searchParams }: PageProps<"/s/[slug]/imoveis">): Promise<Metadata> {
  const { slug } = await params;
  const site = await carregarSite(slug);
  if (!site) return {};
  const f = lerFiltros(await searchParams);
  const { base } = await enderecosDoSite(site);
  const canonica = new URLSearchParams(Object.entries({ finalidade: f.finalidade, cidade: f.cidade, bairro: f.bairro, tipo: f.tipo }).filter(([, v]) => v) as [string, string][]).toString();
  return {
    title: tituloBusca(f),
    description: `${tituloBusca(f)} com ${site.nome}. Fotos, valores, mapa e agendamento de visita pelo site.`,
    alternates: { canonical: `${base}/imoveis${canonica ? `?${canonica}` : ""}` },
  };
}

const FAIXAS = [1, 2, 3, 4];

/** Catálogo com busca, filtros, ordenação, páginas e mapa. */
export default async function CatalogoPage({ params, searchParams }: PageProps<"/s/[slug]/imoveis">) {
  const { slug } = await params;
  const sp = await searchParams;
  const site = await carregarSite(slug);
  if (!site) notFound();
  const [imoveis, { base }] = await Promise.all([carregarImoveis(slug), enderecosDoSite(site)]);
  const f = lerFiltros(sp);
  const ver = sp.ver === "mapa" ? "mapa" : "lista";
  const achados = ordenarImoveis(filtrarImoveis(imoveis, f), f.ordem, f.finalidade);
  const pg = paginar(achados, f.pagina, 12);
  const noMapa = ver === "mapa" ? pontosValidos(achados).slice(0, 500) : [];
  const fotos = await urlsDasFotos((ver === "mapa" ? noMapa : pg.itens).map((i) => i.capa?.path));
  const op = opcoesFiltro(imoveis, f.cidade);
  const caminho = `${base}/imoveis`;
  // Links que mudam um filtro e mantêm o resto (a página volta para a 1ª).
  const url = (mudar: Record<string, string | number | undefined>) => `${caminho}${queryFiltros(f, { pagina: undefined, ver: ver === "mapa" ? "mapa" : undefined, ...mudar })}`;
  const urlVer = (v: string) => url({ ver: v === "mapa" ? "mapa" : undefined });
  const filtrosAtivos = [f.tipo, f.cidade, f.bairro, f.precoMin, f.precoMax, f.quartos, f.vagas, f.banheiros, f.areaMin, f.areaMax, f.busca, f.empreendimento, ...f.comodidades].filter(Boolean).length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[clamp(26px,3vw,34px)] font-semibold tracking-[-0.025em] text-texto">{tituloBusca(f)}</h1>
          <p className="mt-1 text-sm text-texto-2">
            {achados.length} {achados.length === 1 ? "imóvel encontrado" : "imóveis encontrados"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <PilulasLink
            rotulo="Finalidade"
            ativo={url({ finalidade: f.finalidade })}
            itens={[
              { href: url({ finalidade: undefined }), rotulo: "Todos" },
              { href: url({ finalidade: "venda" }), rotulo: "Comprar" },
              { href: url({ finalidade: "locacao" }), rotulo: "Alugar" },
            ]}
          />
          <PilulasLink
            rotulo="Ver em"
            ativo={urlVer(ver)}
            itens={[
              { href: urlVer("lista"), rotulo: "Lista" },
              { href: urlVer("mapa"), rotulo: "Mapa" },
            ]}
          />
        </div>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[290px_1fr]">
        <aside className="entrar rounded-card border border-borda bg-card p-4 lg:sticky lg:top-24">
          <FiltroAutomatico action={caminho} className="space-y-3">
            {f.finalidade && <input type="hidden" name="finalidade" value={f.finalidade} />}
            {f.empreendimento && <input type="hidden" name="empreendimento" value={f.empreendimento} />}
            {ver === "mapa" && <input type="hidden" name="ver" value="mapa" />}
            <Entrada name="busca" aria-label="Buscar por código, bairro ou palavra" defaultValue={f.busca ?? ""} placeholder="Código, bairro, palavra…" />
            <Selecao name="tipo" aria-label="Tipo de imóvel" defaultValue={f.tipo ?? ""}>
              <option value="">Todos os tipos</option>
              {op.tipos.map((t) => (
                <option key={t.rotulo} value={t.rotulo}>
                  {t.rotulo.charAt(0).toUpperCase() + t.rotulo.slice(1)} ({t.n})
                </option>
              ))}
            </Selecao>
            <Selecao name="cidade" aria-label="Cidade" defaultValue={f.cidade ?? ""}>
              <option value="">Todas as cidades</option>
              {op.cidades.map((c) => (
                <option key={c.rotulo} value={c.rotulo}>
                  {c.rotulo} ({c.n})
                </option>
              ))}
            </Selecao>
            <Selecao name="bairro" aria-label="Bairro" defaultValue={f.bairro ?? ""}>
              <option value="">Todos os bairros</option>
              {op.bairros.map((b) => (
                <option key={b.rotulo} value={b.rotulo}>
                  {b.rotulo} ({b.n})
                </option>
              ))}
            </Selecao>
            <Campo rotulo="Preço (R$)">
              <div className="grid grid-cols-2 gap-2">
                <Entrada name="preco_min" inputMode="numeric" aria-label="Preço mínimo" placeholder="Mínimo" defaultValue={f.precoMin ?? ""} />
                <Entrada name="preco_max" inputMode="numeric" aria-label="Preço máximo" placeholder="Máximo" defaultValue={f.precoMax ?? ""} />
              </div>
            </Campo>
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  ["quartos", "Quartos", f.quartos],
                  ["banheiros", "Banheiros", f.banheiros],
                  ["vagas", "Vagas", f.vagas],
                ] as const
              ).map(([nome, rotulo, valor]) => (
                <Campo key={nome} rotulo={rotulo}>
                  <Selecao name={nome} defaultValue={valor ? String(valor) : ""}>
                    <option value="">—</option>
                    {FAIXAS.map((n) => (
                      <option key={n} value={n}>
                        {n}+
                      </option>
                    ))}
                  </Selecao>
                </Campo>
              ))}
            </div>
            <Campo rotulo="Área (m²)">
              <div className="grid grid-cols-2 gap-2">
                <Entrada name="area_min" inputMode="numeric" aria-label="Área mínima" placeholder="Mínima" defaultValue={f.areaMin ?? ""} />
                <Entrada name="area_max" inputMode="numeric" aria-label="Área máxima" placeholder="Máxima" defaultValue={f.areaMax ?? ""} />
              </div>
            </Campo>
            {op.comodidades.length > 0 && (
              <fieldset className="space-y-1.5">
                <legend className="mb-1 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-mudo">Comodidades</legend>
                {op.comodidades.map((c) => (
                  <label key={c.rotulo} className="flex items-center gap-2 text-sm text-texto-2">
                    <input type="checkbox" name="comodidade" value={c.rotulo} defaultChecked={f.comodidades.includes(c.rotulo)} className="size-4 accent-[var(--accent)]" />
                    {c.rotulo}
                  </label>
                ))}
              </fieldset>
            )}
            <Selecao name="ordem" aria-label="Ordenar por" defaultValue={f.ordem}>
              {Object.entries(ROTULO_ORDEM).map(([k, r]) => (
                <option key={k} value={k}>
                  Ordenar: {r}
                </option>
              ))}
            </Selecao>
          </FiltroAutomatico>
          {filtrosAtivos > 0 && (
            <div className="mt-3">
              <BotaoLink href={`${caminho}${f.finalidade ? `?finalidade=${f.finalidade}` : ""}`} variante="fantasma">
                <X className="size-4" /> Limpar filtros
              </BotaoLink>
            </div>
          )}
        </aside>

        <div className="min-w-0 space-y-5">
          {ver === "mapa" ? (
            <>
              <MapaSite
                pinos={noMapa.map((i) => ({
                  codigo: i.codigo,
                  lat: i.lat,
                  lon: i.lon,
                  titulo: tituloImovel(i),
                  preco: precoCurto(precoDe(i, f.finalidade)),
                  href: linkImovel(base, i.codigo),
                  foto: i.capa ? (fotos.get(i.capa.path) ?? null) : null,
                  resumo: resumoImovel(i),
                }))}
              />
              <p className="text-sm text-texto-2">
                {noMapa.length} no mapa
                {achados.length > noMapa.length ? ` · ${achados.length - noMapa.length} sem localização (veja na lista)` : ""}.
                {!site.mostrar_endereco && " A posição é aproximada."}
              </p>
            </>
          ) : (
            <>
              <GradeImoveis
                itens={pg.itens}
                base={base}
                slug={slug}
                fotos={fotos}
                vazio={
                  <>
                    Nenhum imóvel com esses filtros.{" "}
                    <a href={caminho} className="font-semibold text-acento hover:underline">
                      Ver todos
                    </a>
                  </>
                }
              />
              {pg.paginas > 1 && (
                <nav aria-label="Páginas" className="flex items-center justify-center gap-3">
                  {pg.pagina > 1 && (
                    <BotaoLink href={`${caminho}${queryFiltros(f, { pagina: pg.pagina - 1 })}`} variante="secundario">
                      <ChevronLeft className="size-4" /> Anterior
                    </BotaoLink>
                  )}
                  <span className="text-sm text-texto-2">
                    Página {pg.pagina} de {pg.paginas}
                  </span>
                  {pg.pagina < pg.paginas && (
                    <BotaoLink href={`${caminho}${queryFiltros(f, { pagina: pg.pagina + 1 })}`} variante="secundario">
                      Próxima <ChevronRight className="size-4" />
                    </BotaoLink>
                  )}
                </nav>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
