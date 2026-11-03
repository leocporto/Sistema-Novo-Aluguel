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
  codigo_anunciante: string | null;
  limite_anuncios: number | null;
  limite_destaques: number | null;
  site: { slug: string; ativo: boolean; nome: string; email: string | null; telefone: string | null; mostrar_endereco: boolean; dominio: string | null };
  imoveis: LinhaFeed[];
};

export type FeedGerado = { xml: string; resultado: ResultadoFeed; elegiveis: number; ativo: boolean; registrado: boolean };

/**
 * Gera o feed XML do portal na hora (preço, fotos e disponibilidade do cadastro),
 * confere os campos obrigatórios e registra o envio (o que foi, o que falhou e
 * o que ficou fora do limite). Usado pela URL do feed (o portal busca) e pelo
 * botão "Conferir agora" do sistema. Devolve null se o token/portal não existir.
 */
export async function montarFeed(
  cliente: SupabaseClient,
  token: string,
  portal: Portal,
  opcoes: { origem: string; registro: "portal" | "manual"; agente?: string | null },
): Promise<FeedGerado | null> {
  const { data, error } = await cliente.rpc("portal_feed", { p_token: token, p_portal: portal });
  if (error || !data) return null;
  const d = data as DadosFeed;
  const lista: ImovelPortal[] = d.imoveis.map((i) => ({
    ...i,
    fotos: i.fotos.map((id) => urlFotoFixa(opcoes.origem, d.site.slug, id)),
    plantas: i.plantas.map((id) => urlFotoFixa(opcoes.origem, d.site.slug, id)),
    url: d.site.ativo && i.publicar_site ? `${opcoes.origem}/s/${d.site.slug}/imovel/${encodeURIComponent(i.codigo)}` : null,
  }));
  const resultado = selecionarParaFeed(lista, portal, { anuncios: d.limite_anuncios, destaques: d.limite_destaques });
  const xml = gerarFeed(portal, resultado.enviar, {
    nome: d.site.nome,
    email: d.site.email,
    telefone: d.site.telefone,
    mostrarEndereco: d.site.mostrar_endereco,
    codigoAnunciante: d.codigo_anunciante,
    geradoEm: new Date().toISOString(),
  });
  const { data: registro } = await cliente.rpc("portal_registrar", {
    p_token: token,
    p_portal: portal,
    p: {
      origem: opcoes.registro,
      elegiveis: lista.length,
      enviados: resultado.enviar.map((i) => i.id),
      falhas: resultado.falhas,
      fora_limite: resultado.foraDoLimite.map((i) => i.id),
      agente: opcoes.agente?.slice(0, 200) ?? null,
    },
  });
  return { xml, resultado, elegiveis: lista.length, ativo: d.ativo, registrado: !!registro };
}
