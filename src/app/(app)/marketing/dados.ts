import "server-only";
import { headers } from "next/headers";
import type { obterContexto } from "@/lib/contexto";
import { perfilDaPessoa, perfilDoLead, type Consentimento, type Contato, type Descadastro } from "@/lib/dominio/marketing";
import { todas } from "../financeiro/dados";

export type Supabase = Awaited<ReturnType<typeof obterContexto>>["supabase"];
export { todas };

/** Endereço do sistema (para montar links públicos: landing page, pesquisa, preferências, webhooks). */
export async function urlBase(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}`;
}

export type Config = {
  id: string;
  organizacao_id: string;
  webhook_token: string;
  whatsapp_numero: string | null;
  whatsapp_phone_number_id: string | null;
  whatsapp_waba_id: string | null;
  whatsapp_verify_token: string;
  whatsapp_cria_lead: boolean;
  meta_pixel_id: string | null;
  meta_verify_token: string;
  google_tag_id: string | null;
  google_conversao_label: string | null;
  google_lead_key: string;
  email_remetente: string | null;
  assinatura: string | null;
  pesquisa_pergunta: string | null;
  automacoes_em: string | null;
};

/** Configuração de marketing da imobiliária (criada na primeira vez). */
export async function obterConfig(supabase: Supabase): Promise<Config> {
  const { data } = await supabase.from("mkt_config").select("*").maybeSingle();
  if (data) return data as Config;
  const { data: nova, error } = await supabase.from("mkt_config").insert({}).select("*").single();
  if (error) {
    // Outra aba criou ao mesmo tempo.
    const { data: de_novo } = await supabase.from("mkt_config").select("*").single();
    return de_novo as Config;
  }
  return nova as Config;
}

export type Membro = { user_id: string; nome: string };
export async function carregarMembros(supabase: Supabase): Promise<Membro[]> {
  const { data } = await supabase.from("membros").select("user_id, nome, papel").order("created_at").limit(500);
  return (data ?? []).map((m, i) => ({ user_id: m.user_id as string, nome: (m.nome as string | null) || `Usuário ${i + 1} (${m.papel})` }));
}

type LinhaLead = {
  id: string;
  nome: string;
  telefone: string | null;
  email: string | null;
  funil: string;
  status: string;
  origem: string;
  corretor_id: string | null;
  ultimo_contato: string | null;
  perdido_em: string | null;
  created_at: string;
  utm_source: string | null;
  tipos: string[];
  regioes: string | null;
  orcamento_min: number | null;
  orcamento_max: number | null;
  quartos_min: number | null;
  preferencias_token: string;
  corretor: { nome: string } | null;
};

type LinhaPessoa = {
  id: string;
  nome: string;
  telefone: string | null;
  email: string | null;
  papeis: string[];
  cidade: string | null;
  bairro: string | null;
  interesse: string[];
  pref_tipos: string[];
  pref_regioes: string | null;
  pref_valor_min: number | null;
  pref_valor_max: number | null;
  pref_quartos_min: number | null;
  aceita_whatsapp: boolean;
  aceita_email: boolean;
  aceita_sms: boolean;
  aceita_marketing: boolean;
  preferencias_token: string;
};

/** Todos os contatos (leads e pessoas) no formato do público das campanhas. */
export async function carregarContatos(supabase: Supabase, quais: "leads" | "pessoas" | "ambos" = "ambos"): Promise<Contato[]> {
  const [leads, pessoas, ligados] = await Promise.all([
    quais === "pessoas"
      ? Promise.resolve([] as LinhaLead[])
      : todas<LinhaLead>(() =>
          supabase
            .from("leads")
            .select(
              "id, nome, telefone, email, funil, status, origem, corretor_id, ultimo_contato, perdido_em, created_at, utm_source, tipos, regioes, orcamento_min, orcamento_max, quartos_min, preferencias_token, corretor:pessoas!leads_corretor_id_fkey(nome)",
            )
            .order("id"),
        ),
    quais === "leads"
      ? Promise.resolve([] as LinhaPessoa[])
      : todas<LinhaPessoa>(() =>
          supabase
            .from("pessoas")
            .select(
              "id, nome, telefone, email, papeis, cidade, bairro, interesse, pref_tipos, pref_regioes, pref_valor_min, pref_valor_max, pref_quartos_min, aceita_whatsapp, aceita_email, aceita_sms, aceita_marketing, preferencias_token",
            )
            .order("id"),
        ),
    quais === "pessoas" ? Promise.resolve([] as { lead_id: string; imovel_id: string }[]) : todas<{ lead_id: string; imovel_id: string }>(() => supabase.from("lead_imoveis").select("lead_id, imovel_id").order("lead_id").order("imovel_id")),
  ]);
  const imoveisDoLead = new Map<string, string[]>();
  for (const li of ligados) imoveisDoLead.set(li.lead_id, [...(imoveisDoLead.get(li.lead_id) ?? []), li.imovel_id]);
  return [
    ...leads.map(
      (l): Contato => ({
        tipo: "lead",
        id: l.id,
        nome: l.nome,
        telefone: l.telefone,
        email: l.email,
        preferencias_token: l.preferencias_token,
        funil: l.funil,
        status: l.status,
        origem: l.origem,
        corretor_id: l.corretor_id,
        corretor: l.corretor?.nome ?? null,
        ultimo_contato: l.ultimo_contato,
        perdido_em: l.perdido_em,
        created_at: l.created_at,
        utm_source: l.utm_source,
        perfil: perfilDoLead({ funil: l.funil, tipos: l.tipos ?? [], regioes: l.regioes, orcamento_min: l.orcamento_min, orcamento_max: l.orcamento_max, quartos_min: l.quartos_min }),
        imoveis: imoveisDoLead.get(l.id) ?? [],
      }),
    ),
    ...pessoas.map(
      (p): Contato => ({
        tipo: "pessoa",
        id: p.id,
        nome: p.nome,
        telefone: p.telefone,
        email: p.email,
        preferencias_token: p.preferencias_token,
        papeis: p.papeis ?? [],
        cidade: p.cidade,
        bairro: p.bairro,
        interesse: p.interesse ?? [],
        aceita: { whatsapp: p.aceita_whatsapp, email: p.aceita_email, sms: p.aceita_sms, marketing: p.aceita_marketing },
        perfil: perfilDaPessoa(p),
      }),
    ),
  ];
}

/** Descadastros ativos e o histórico de autorizações das pessoas (para prever quem fica fora). */
export async function carregarBloqueios(supabase: Supabase): Promise<{ descadastros: Descadastro[]; consentimentos: Consentimento[] }> {
  const [descadastros, consentimentos] = await Promise.all([
    todas<Descadastro & { id: string }>(() => supabase.from("mkt_descadastros").select("id, pessoa_id, lead_id, email, telefone, canal").order("id")),
    todas<Consentimento & { id: string }>(() => supabase.from("pessoa_consentimentos").select("id, pessoa_id, canal, concedido, em").order("id")),
  ]);
  return { descadastros, consentimentos };
}

export type ContagemEnvios = { total: number; pendentes: number; enviados: number; bloqueados: number; falhas: number };
export const contagemVazia = (): ContagemEnvios => ({ total: 0, pendentes: 0, enviados: 0, bloqueados: 0, falhas: 0 });

/** Quantos envios cada campanha tem em cada situação. */
export async function contagensPorCampanha(supabase: Supabase, ids: string[]): Promise<Map<string, ContagemEnvios>> {
  const out = new Map<string, ContagemEnvios>();
  if (!ids.length) return out;
  const linhas = await todas<{ id: string; campanha_id: string; status: string }>(() =>
    supabase.from("mkt_envios").select("id, campanha_id, status").in("campanha_id", ids).order("id"),
  );
  for (const l of linhas) {
    const c = out.get(l.campanha_id) ?? contagemVazia();
    c.total++;
    if (l.status === "pendente") c.pendentes++;
    else if (l.status === "enviado") c.enviados++;
    else if (l.status === "bloqueado") c.bloqueados++;
    else if (l.status === "falhou") c.falhas++;
    out.set(l.campanha_id, c);
  }
  return out;
}

export type Campanha = {
  id: string;
  nome: string;
  tipo: string;
  canal: "whatsapp" | "email" | "sms";
  modelo_id: string | null;
  assunto: string | null;
  mensagem: string;
  filtros: unknown;
  imovel_id: string | null;
  so_autorizados: boolean;
  agendada_para: string | null;
  status: string;
  utm_campaign: string | null;
  link: string | null;
  fila_em: string | null;
  created_at: string;
};

export type Envio = {
  id: string;
  campanha_id: string | null;
  automacao_id: string | null;
  pesquisa_id: string | null;
  origem: string;
  finalidade: string;
  canal: "whatsapp" | "email" | "sms";
  pessoa_id: string | null;
  lead_id: string | null;
  nome: string | null;
  telefone: string | null;
  email: string | null;
  assunto: string | null;
  mensagem: string;
  status: string;
  motivo: string | null;
  agendado_para: string;
  enviado_em: string | null;
  created_at: string;
};

export type ImovelBasico = {
  id: string;
  codigo: string;
  tipo: string;
  finalidades: string[];
  status: string;
  bairro: string | null;
  cidade: string | null;
  quartos: number | null;
  valor_aluguel: number | null;
  valor_venda: number | null;
};

export const SELECT_IMOVEL_BASICO = "id, codigo, tipo, finalidades, status, bairro, cidade, quartos, valor_aluguel, valor_venda";

export const numerico = <T extends { valor_aluguel: number | string | null; valor_venda: number | string | null }>(i: T) => ({
  ...i,
  valor_aluguel: i.valor_aluguel == null ? null : Number(i.valor_aluguel),
  valor_venda: i.valor_venda == null ? null : Number(i.valor_venda),
});

/** Imóveis disponíveis (para recomendar e para as campanhas de imóvel). */
export async function imoveisDisponiveis(supabase: Supabase): Promise<ImovelBasico[]> {
  const lista = await todas<ImovelBasico>(() => supabase.from("imoveis").select(SELECT_IMOVEL_BASICO).eq("status", "disponivel").order("id"));
  return lista.map(numerico);
}

/** Link da landing page de cada imóvel (a mais recente publicada). */
export async function landingPorImovel(supabase: Supabase, base: string): Promise<Map<string, string>> {
  const { data } = await supabase.from("mkt_landing_pages").select("slug, imovel_id, created_at").eq("publicada", true).not("imovel_id", "is", null).order("created_at");
  return new Map((data ?? []).map((l) => [l.imovel_id as string, `${base}/lp/${l.slug}`]));
}
