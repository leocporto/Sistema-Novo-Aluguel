import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { gerarFeed, selecionarParaFeed, type Destaque, type ImovelPortal, type Portal, type ResultadoFeed } from "@/lib/dominio/site-portais";
import { urlFotoFixa } from "./site";

type LinhaFeed = Omit<ImovelPortal, "fotos" | "plantas" | "url" | "destaque"> & {
  fotos: string[];
  plantas: string[];
  destaque: Destaque;
  publicar_site: boolean;
};

type DadosFeed = {
  portal: Portal;
  ativo: boolean;
  /** false: o portal não está ligado (ou o site foi excluído) — o feed sai vazio. */
  configurado: boolean;
  codigo_anunciante: string | null;
  limite_anuncios: number | null;
  limite_destaques: number | null;
  site: { slug: string | null; ativo: boolean; nome: string; email: string | null; telefone: string | null; mostrar_endereco: boolean; dominio: string | null };
  imoveis: LinhaFeed[];
};

/** O que o banco registrou (calculado por ele mesmo, em portal_sincronizar). */
export type RegistroFeed = {
  id: string;
  elegiveis: number;
  enviados: string[];
  falhas: { imovel_id: string; codigo: string; problemas: string[] }[];
  fora_limite: string[];
};

export type FeedGerado = {
  xml: string;
  resultado: ResultadoFeed;
  elegiveis: number;
  ativo: boolean;
  configurado: boolean;
  registrado: boolean;
  registro: RegistroFeed | null;
};

/**
 * Gera o feed XML do portal na hora (preço, fotos e disponibilidade do cadastro)
 * e confere os campos obrigatórios. Portal desligado ou pausado gera um feed
 * válido e VAZIO (o portal tira os anúncios). Devolve null só se o código não existir.
 *
 * `registro`:
 * - "portal": o portal buscou — registra o envio (enviado, falhas, fora do limite,
 *   anúncios na aba Histórico do imóvel);
 * - "manual": "Conferir agora" — registra a conferência e as falhas, sem marcar enviado;
 * - null: só mostra o arquivo (prévia do "ver o arquivo"), sem registrar nada.
 * O registro é calculado pelo próprio banco (portal_sincronizar), não pelo que vem daqui.
 */
export async function montarFeed(
  cliente: SupabaseClient,
  token: string,
  portal: Portal,
  opcoes: { origem: string; registro: "portal" | "manual" | null; agente?: string | null },
): Promise<FeedGerado | null> {
  const { data, error } = await cliente.rpc("portal_feed", { p_token: token, p_portal: portal });
  if (error || !data) return null;
  const d = data as DadosFeed;
  const slug = d.site.slug;
  const lista: ImovelPortal[] = slug
    ? d.imoveis.map((i) => ({
        ...i,
        fotos: i.fotos.map((id) => urlFotoFixa(opcoes.origem, slug, id)),
        plantas: i.plantas.map((id) => urlFotoFixa(opcoes.origem, slug, id)),
        url: d.site.ativo && i.publicar_site ? `${opcoes.origem}/s/${slug}/imovel/${encodeURIComponent(i.codigo)}` : null,
      }))
    : [];
  const resultado = selecionarParaFeed(lista, portal, { anuncios: d.limite_anuncios, destaques: d.limite_destaques });
  const xml = gerarFeed(portal, resultado.enviar, {
    nome: d.site.nome,
    email: d.site.email,
    telefone: d.site.telefone,
    mostrarEndereco: d.site.mostrar_endereco,
    codigoAnunciante: d.codigo_anunciante,
    geradoEm: new Date().toISOString(),
  });
  let registro: RegistroFeed | null = null;
  if (opcoes.registro && d.configurado) {
    const args: Record<string, string> = { p_token: token, p_portal: portal, p_origem: opcoes.registro };
    if (opcoes.agente) args.p_agente = opcoes.agente.slice(0, 200);
    const r = await cliente.rpc("portal_sincronizar", args);
    registro = r.error ? null : ((r.data as RegistroFeed | null) ?? null);
  }
  return { xml, resultado, elegiveis: lista.length, ativo: d.ativo, configurado: d.configurado, registrado: !!registro, registro };
}
