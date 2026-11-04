import "server-only";
import { headers } from "next/headers";
import type { obterContexto } from "@/lib/contexto";
import { agoraMs } from "@/lib/dominio/datas";
import type { SinaisInternos } from "@/lib/dominio/integracoes";

export type Supabase = Awaited<ReturnType<typeof obterContexto>>["supabase"];

/** Endereço do sistema (para os exemplos da API). */
export async function urlBase(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}`;
}

export type ConfigProvedor = {
  id: string;
  provedor: string;
  categoria: string;
  ambiente: "sandbox" | "producao";
  ativo: boolean;
  config: Record<string, string>;
  chaves_dica: Record<string, string>;
  ultimo_teste_em: string | null;
  ultimo_teste_ok: boolean | null;
  ultimo_teste_msg: string | null;
  updated_at: string;
};

export async function configsProvedores(supabase: Supabase): Promise<ConfigProvedor[]> {
  const { data } = await supabase.from("integracoes_config").select("*").order("provedor");
  return (data ?? []) as ConfigProvedor[];
}

/** Contagem de chaves de API valendo agora (nem revogadas nem vencidas): igual à situação "Ativa" da tela de chaves. */
export async function contarChavesAtivas(supabase: Supabase): Promise<number> {
  const agora = new Date(agoraMs()).toISOString();
  const { count } = await supabase
    .from("api_chaves")
    .select("id", { count: "exact", head: true })
    .is("revogada_em", null)
    .or(`expira_em.is.null,expira_em.gt.${agora}`);
  return count ?? 0;
}

/**
 * Sinais de uso dos recursos internos (para o catálogo não mostrar "Ativo" no
 * que a organização ainda não ligou): chave Pix da cobrança, número do WhatsApp
 * (Cloud API), lead de anúncio recebido, portal ligado e GA4 no site. Só lê;
 * tabela ou coluna ausente (migração não aplicada) conta como "não".
 */
export async function sinaisInternos(supabase: Supabase, organizacaoId: string, pessoal: boolean, chavesApi: number, webhooks: number): Promise<SinaisInternos> {
  const sim = async (consulta: PromiseLike<{ data: unknown; error: unknown }>, teste: (d: unknown) => boolean) => {
    try {
      const { data, error } = await consulta;
      return !error && teste(data);
    } catch {
      return false;
    }
  };
  const temLinha = (d: unknown) => Array.isArray(d) && d.length > 0;
  const [pix, whatsapp, leadAds, portais, ga4] = await Promise.all([
    sim(supabase.from("organizacoes").select("cobranca_pix_chave").eq("id", organizacaoId).maybeSingle(), (d) =>
      Boolean((d as { cobranca_pix_chave?: string | null } | null)?.cobranca_pix_chave?.trim()),
    ),
    pessoal ? false : sim(supabase.from("mkt_config").select("id").not("whatsapp_phone_number_id", "is", null).limit(1), temLinha),
    pessoal ? false : sim(supabase.from("mkt_lead_ads").select("id").eq("status", "recebido").limit(1), temLinha),
    pessoal ? false : sim(supabase.from("site_portais").select("id").eq("ativo", true).limit(1), temLinha),
    pessoal ? false : sim(supabase.from("site_config").select("id").not("ga4_id", "is", null).limit(1), temLinha),
  ]);
  return { pix, whatsapp, leadAds, portais, ga4, chavesApi, webhooks };
}

export type ChaveApi = {
  id: string;
  nome: string;
  prefixo: string;
  escopos: string[];
  limite_hora: number;
  created_at: string;
  expira_em: string | null;
  revogada_em: string | null;
  ultimo_uso: string | null;
};

export type Webhook = {
  id: string;
  nome: string;
  url: string;
  eventos: string[];
  ativo: boolean;
  pausada_em: string | null;
  pausada_motivo: string | null;
  falhas_seguidas: number;
  ultima_entrega_em: string | null;
  ultimo_status: number | null;
  created_at: string;
};

export type Entrega = {
  id: string;
  assinatura_id: string;
  evento: string;
  status: "pendente" | "entregue" | "falhou" | "desistiu";
  tentativas: number;
  proxima_tentativa: string;
  ultima_tentativa_em: string | null;
  resposta_status: number | null;
  resposta_trecho: string | null;
  erro: string | null;
  entregue_em: string | null;
  criado_em: string;
  teste: boolean;
  payload: Record<string, unknown>;
};

export const SELECT_ENTREGA =
  "id, assinatura_id, evento, status, tentativas, proxima_tentativa, ultima_tentativa_em, resposta_status, resposta_trecho, erro, entregue_em, criado_em, teste, payload";

export type Resumo = {
  entregas: Record<string, number>;
  fila: number;
  por_webhook: { assinatura_id: string; entregues: number; falhas: number; desistiu: number; fila: number }[];
  api_total: number;
  api_erros: number;
  api_por_status: Record<string, number>;
  api_por_chave: { chave_id: string | null; prefixo: string | null; total: number; erros: number; ultimo: string }[];
  api_por_recurso: Record<string, number>;
};

export const RESUMO_VAZIO: Resumo = { entregas: {}, fila: 0, por_webhook: [], api_total: 0, api_erros: 0, api_por_status: {}, api_por_chave: [], api_por_recurso: {} };

/** Somas no banco (sem o corte de 1.000 linhas). Banco sem a migração → zeros. */
export async function resumoIntegracoes(supabase: Supabase, desde: string): Promise<Resumo> {
  const { data, error } = await supabase.rpc("integracoes_resumo", { p_desde: desde });
  if (error || !data) return RESUMO_VAZIO;
  return { ...RESUMO_VAZIO, ...(data as Resumo) };
}

export type UsoBucket = { bucket: string; arquivos: number; bytes: number };
export async function usoArmazenamento(supabase: Supabase): Promise<UsoBucket[]> {
  const { data, error } = await supabase.rpc("integracoes_uso_armazenamento");
  if (error || !Array.isArray(data)) return [];
  return (data as UsoBucket[]).map((b) => ({ ...b, arquivos: Number(b.arquivos), bytes: Number(b.bytes) }));
}

/** Data/hora curta em Brasília. */
export function quando(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
}
