import type { Metadata } from "next";
import { EyeOff, MapPin, MonitorUp } from "lucide-react";
import { BotaoAcao } from "@/components/botao-acao";
import { FiltroAutomatico } from "@/components/filtro-automatico";
import { Formulario } from "@/components/formulario";
import { LinhaLink } from "@/components/linha-link";
import { PilulasLink } from "@/components/pilulas-link";
import { Aviso, Cabecalho, Celula, Entrada, LinhaVazia, Selo, Tabela } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { formatarReais } from "@/lib/dominio/dinheiro";
import { normalizar } from "@/lib/dominio/imoveis";
import { pendenciasSite } from "@/lib/dominio/site";
import { ROTULO_STATUS_IMOVEL } from "@/lib/tipos";
import { todas } from "../../financeiro/dados";
import { AbasSite } from "../abas";
import { localizarImovel, publicarDisponiveis, salvarPublicacao, tirarTodosDoSite } from "../actions";
import { carregarConfig, origemAtual } from "../dados";

export const metadata: Metadata = { title: "Imóveis no site" };

const FILTROS: Record<string, string> = { "": "Todos", site: "No site", fora: "Disponíveis fora do site", pendencias: "Com pendências", mapa: "Fora do mapa" };

type Linha = {
  id: string;
  codigo: string;
  titulo: string | null;
  tipo: string;
  status: string;
  finalidades: string[];
  bairro: string | null;
  cidade: string | null;
  valor_aluguel: number | null;
  valor_venda: number | null;
  descricao: string | null;
  latitude: number | null;
  longitude: number | null;
  publicar_site: boolean;
};

/** Quais imóveis aparecem no site, com o que falta em cada anúncio. */
export default async function ImoveisNoSitePage({ searchParams }: PageProps<"/site/imoveis">) {
  const sp = await searchParams;
  const filtro = typeof sp.filtro === "string" && sp.filtro in FILTROS ? sp.filtro : "";
  const busca = typeof sp.busca === "string" ? sp.busca : "";
  const { supabase } = await obterContexto();
  const [config, origem, imoveis, fotos] = await Promise.all([
    carregarConfig(supabase),
    origemAtual(),
    todas<Linha>(() =>
      supabase
        .from("imoveis")
        .select("id, codigo, titulo, tipo, status, finalidades, bairro, cidade, valor_aluguel, valor_venda, descricao, latitude, longitude, publicar_site")
        .order("codigo")
        .order("id"),
    ),
    todas<{ imovel_id: string }>(() => supabase.from("imovel_midias").select("imovel_id").eq("tipo", "foto").order("id")),
  ]);
  const nFotos = new Map<string, number>();
  for (const f of fotos) nFotos.set(f.imovel_id, (nFotos.get(f.imovel_id) ?? 0) + 1);
  const comDados = imoveis.map((i) => ({ ...i, fotos: nFotos.get(i.id) ?? 0, pendencias: pendenciasSite({ ...i, fotos: nFotos.get(i.id) ?? 0 }) }));
  const visivel = (i: Linha) => i.publicar_site && (i.status === "disponivel" || i.status === "reservado");
  const termo = normalizar(busca);
  const lista = comDados.filter((i) => {
    if (filtro === "site" && !visivel(i)) return false;
    if (filtro === "fora" && (i.publicar_site || i.status !== "disponivel")) return false;
    if (filtro === "pendencias" && (!visivel(i) || !i.pendencias.length)) return false;
    if (filtro === "mapa" && (!visivel(i) || (i.latitude != null && i.longitude != null))) return false;
    if (termo && !normalizar([i.codigo, i.titulo, i.bairro, i.cidade].filter(Boolean).join(" ")).includes(termo)) return false;
    return true;
  });
  const disponiveisFora = comDados.filter((i) => !i.publicar_site && i.status === "disponivel").length;
  const url = (f: string) => `/site/imoveis${f || busca ? `?${new URLSearchParams(Object.entries({ filtro: f, busca }).filter(([, v]) => v) as [string, string][])}` : ""}`;
  const linkSite = config ? `${origem}/s/${config.slug}` : null;

  return (
    <>
      <Cabecalho
        titulo="Imóveis no site"
        trilha="Site e portais"
        descricao="Marque quais imóveis aparecem no site. Alugados, vendidos e inativos saem sozinhos; preço e fotos vêm sempre do cadastro."
        acoes={
          <>
            <BotaoAcao acao={publicarDisponiveis} id="todos" variante="primario" confirmar={`Colocar no site todos os ${disponiveisFora} imóveis disponíveis que estão fora?`}>
              <MonitorUp className="size-4" /> Publicar todos os disponíveis
            </BotaoAcao>
            <BotaoAcao acao={tirarTodosDoSite} id="todos" variante="fantasma" confirmar="Tirar TODOS os imóveis do site (e dos portais que seguem o site)?">
              <EyeOff className="size-4" /> Tirar todos
            </BotaoAcao>
          </>
        }
      />
      <AbasSite />
      {!config && <div className="mb-4"><Aviso tipo="alerta">O site ainda não foi criado (aba Configuração). Você já pode escolher os imóveis.</Aviso></div>}
      <PilulasLink className="mb-4" rotulo="Filtro" ativo={url(filtro)} itens={Object.entries(FILTROS).map(([k, r]) => ({ href: url(k), rotulo: r }))} />
      <FiltroAutomatico>
        {filtro && <input type="hidden" name="filtro" value={filtro} />}
        <Entrada name="busca" aria-label="Buscar imóvel" defaultValue={busca} placeholder="Código, título, bairro…" className="max-w-72" />
      </FiltroAutomatico>
      <Tabela colunas={["No site", "Imóvel", "Situação", "Valor", "Fotos", "O que falta", ""]}>
        {lista.slice(0, 500).map((i) => (
          <LinhaLink key={i.id} href={`/imoveis/${i.id}`}>
            <Celula>
              <Formulario acao={salvarPublicacao} automatico semAviso className="flex">
                <input type="hidden" name="id" value={i.id} />
                <input type="hidden" name="publicar_site" value="" />
                <input type="checkbox" name="publicar_site" defaultChecked={i.publicar_site} aria-label={`Mostrar ${i.codigo} no site`} className="size-5 cursor-pointer" />
              </Formulario>
            </Celula>
            <Celula>
              <span className="font-semibold text-acento">{i.codigo}</span>
              <span className="block max-w-80 truncate text-xs text-mudo">{[i.titulo, i.bairro, i.cidade].filter(Boolean).join(" · ") || i.tipo}</span>
            </Celula>
            <Celula>
              {visivel(i) ? (
                <Selo cor="verde">NO SITE</Selo>
              ) : i.publicar_site ? (
                <Selo cor="cinza">NÃO APARECE: {(ROTULO_STATUS_IMOVEL[i.status] ?? i.status).toUpperCase()}</Selo>
              ) : (
                <Selo cor={i.status === "disponivel" ? "amarelo" : "cinza"}>FORA</Selo>
              )}
            </Celula>
            <Celula className="tabular-nums">
              {i.valor_aluguel ? <span className="block">{formatarReais(i.valor_aluguel)}/mês</span> : null}
              {i.valor_venda ? <span className="block text-xs text-texto-2">venda {formatarReais(i.valor_venda)}</span> : null}
              {!i.valor_aluguel && !i.valor_venda && <span className="text-mudo">—</span>}
            </Celula>
            <Celula>{i.fotos}</Celula>
            <Celula>
              {i.pendencias.length ? (
                <span className="flex flex-wrap gap-1">
                  {i.pendencias.map((p) => (
                    <Selo key={p} cor="amarelo">
                      {p.toUpperCase()}
                    </Selo>
                  ))}
                </span>
              ) : (
                <span className="text-xs text-ok">tudo certo</span>
              )}
            </Celula>
            <Celula>
              <span className="flex items-center justify-end gap-2">
                {(i.latitude == null || i.longitude == null) && i.cidade && (
                  <BotaoAcao acao={localizarImovel} id={i.id} tamanho="sm">
                    <MapPin className="size-3.5" /> Localizar
                  </BotaoAcao>
                )}
                {visivel(i) && config?.ativo && linkSite && (
                  <a href={`${linkSite}/imovel/${encodeURIComponent(i.codigo)}`} target="_blank" rel="noreferrer" className="whitespace-nowrap text-xs font-semibold text-acento hover:underline">
                    ver no site
                  </a>
                )}
              </span>
            </Celula>
          </LinhaLink>
        ))}
        {lista.length === 0 && <LinhaVazia colunas={7}>Nenhum imóvel aqui.</LinhaVazia>}
      </Tabela>
      {lista.length > 500 && <p className="mt-3 text-sm text-alerta">Mostrando 500 de {lista.length}. Use a busca para achar os outros.</p>}
      <p className="mt-3 text-right text-xs text-mudo">As alterações são salvas automaticamente. “Localizar” busca a posição no mapa pelo endereço (OpenStreetMap).</p>
    </>
  );
}
