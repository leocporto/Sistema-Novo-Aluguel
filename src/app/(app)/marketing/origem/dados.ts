import "server-only";
import type { LeadConversao } from "@/lib/dominio/marketing";
import { todas, type Supabase } from "../dados";

export type LeadOrigem = LeadConversao & {
  nome: string;
  email: string | null;
  telefone: string | null;
  origem: string;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  gclid: string | null;
  fbclid: string | null;
  created_at: string;
  landing: string | null;
  campanha: string | null;
  /** quando o negócio fechou (venda concluída ou proposta aceita) */
  data_negocio: string | null;
};

export const PERIODOS: Record<string, { rotulo: string; dias: number | null }> = {
  "30": { rotulo: "30 dias", dias: 30 },
  "90": { rotulo: "90 dias", dias: 90 },
  "365": { rotulo: "12 meses", dias: 365 },
  tudo: { rotulo: "Tudo", dias: null },
};

/** Leads do período com visitas, propostas e negócio fechado (para o funil por origem e as conversões offline). */
export async function carregarLeadsOrigem(supabase: Supabase, periodo: string, agoraMs: number): Promise<LeadOrigem[]> {
  const dias = PERIODOS[periodo]?.dias ?? 90;
  const desde = dias ? new Date(agoraMs - dias * 86_400_000).toISOString() : null;
  const leads = await todas<{
    id: string;
    nome: string;
    email: string | null;
    telefone: string | null;
    status: string;
    etapa_max: number;
    origem: string;
    utm_source: string | null;
    utm_medium: string | null;
    utm_campaign: string | null;
    gclid: string | null;
    fbclid: string | null;
    created_at: string;
    landing: { titulo: string } | null;
    campanha: { nome: string } | null;
  }>(() => {
    let q = supabase
      .from("leads")
      .select("id, nome, email, telefone, status, etapa_max, origem, utm_source, utm_medium, utm_campaign, gclid, fbclid, created_at, landing:mkt_landing_pages(titulo), campanha:mkt_campanhas(nome)")
      .order("id");
    if (desde) q = q.gte("created_at", desde);
    return q;
  });
  if (!leads.length) return [];
  const ids = new Set(leads.map((l) => l.id));
  const [visitas, propostas, vendas] = await Promise.all([
    todas<{ id: string; lead_id: string }>(() => supabase.from("visitas").select("id, lead_id").not("lead_id", "is", null).order("id")),
    todas<{ id: string; lead_id: string; status: string; valor: number; fechada_em: string | null }>(() =>
      supabase.from("propostas").select("id, lead_id, status, valor, fechada_em").not("lead_id", "is", null).order("id"),
    ),
    todas<{ id: string; lead_id: string; status: string; valor: number; concluida_em: string | null }>(() =>
      supabase.from("vendas").select("id, lead_id, status, valor, concluida_em").not("lead_id", "is", null).order("id"),
    ),
  ]);
  const nVisitas = new Map<string, number>();
  for (const v of visitas) if (ids.has(v.lead_id)) nVisitas.set(v.lead_id, (nVisitas.get(v.lead_id) ?? 0) + 1);
  const nPropostas = new Map<string, number>();
  const aceita = new Map<string, { valor: number; data: string | null }>();
  for (const p of propostas) {
    if (!ids.has(p.lead_id)) continue;
    nPropostas.set(p.lead_id, (nPropostas.get(p.lead_id) ?? 0) + 1);
    if (p.status === "aceita") aceita.set(p.lead_id, { valor: Number(p.valor), data: p.fechada_em });
  }
  const venda = new Map<string, { valor: number; data: string | null }>();
  for (const v of vendas) if (ids.has(v.lead_id) && v.status === "concluida") venda.set(v.lead_id, { valor: Number(v.valor), data: v.concluida_em });

  return leads.map((l) => {
    const negocio = l.status === "ganho" ? (venda.get(l.id) ?? aceita.get(l.id) ?? null) : null;
    return {
      ...l,
      landing: l.landing?.titulo ?? null,
      campanha: l.campanha?.nome ?? null,
      visitas: nVisitas.get(l.id) ?? 0,
      propostas: nPropostas.get(l.id) ?? 0,
      valor: negocio?.valor ?? null,
      data_negocio: l.status === "ganho" ? (negocio?.data ?? l.created_at.slice(0, 10)) : null,
    };
  });
}
