import "server-only";
import { headers } from "next/headers";
import type { obterContexto } from "@/lib/contexto";
import type { Destaque, Portal } from "@/lib/dominio/site-portais";

type Supabase = Awaited<ReturnType<typeof obterContexto>>["supabase"];

export type ConfigSite = {
  id: string;
  slug: string;
  ativo: boolean;
  nome: string | null;
  slogan: string | null;
  logo_path: string | null;
  cor_primaria: string;
  cor_secundaria: string;
  titulo_home: string | null;
  subtitulo_home: string | null;
  sobre: string | null;
  telefone: string | null;
  whatsapp: string | null;
  email: string | null;
  endereco: string | null;
  creci: string | null;
  instagram: string | null;
  facebook: string | null;
  youtube: string | null;
  ga4_id: string | null;
  dominio: string | null;
  dominio_verificado_em: string | null;
  seo_titulo: string | null;
  seo_descricao: string | null;
  mostrar_endereco: boolean;
  captacao_ativa: boolean;
  agendamento_ativo: boolean;
  portais_token: string;
  atualizado_em: string;
};

export type ConfigPortal = {
  id: string;
  portal: Portal;
  ativo: boolean;
  publicar_todos: boolean;
  codigo_anunciante: string | null;
  limite_anuncios: number | null;
  limite_destaques: number | null;
  observacoes: string | null;
};

export type ControlePortal = {
  imovel_id: string;
  portal: Portal;
  publicado: boolean | null;
  destaque: Destaque;
  codigo_portal: string | null;
  url: string | null;
  ultima_sincronizacao: string | null;
  verificado_em: string | null;
  ultimo_status: "enviado" | "falha" | "fora_do_limite" | "fora" | null;
  ultimas_falhas: string[];
};

export async function carregarConfig(supabase: Supabase): Promise<ConfigSite | null> {
  const { data } = await supabase.from("site_config").select("*").maybeSingle();
  return (data as ConfigSite | null) ?? null;
}

export async function carregarPortais(supabase: Supabase): Promise<ConfigPortal[]> {
  const { data } = await supabase.from("site_portais").select("id, portal, ativo, publicar_todos, codigo_anunciante, limite_anuncios, limite_destaques, observacoes").order("portal");
  return (data ?? []) as ConfigPortal[];
}

/** Endereço do sistema nesta requisição (para montar os links do site e dos portais). */
export async function origemAtual(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export const podeAdministrar = (papel: string) => papel === "admin" || papel === "gestor";
