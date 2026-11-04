import "server-only";
import type { obterContexto } from "@/lib/contexto";
import { notaLead, proximoContato, type FatorNota, type LeadIA, type ProximoContato, type SinaisLead } from "@/lib/dominio/ia";
import { todas } from "../../financeiro/dados";
import { porLotes } from "../dados";

type Supabase = Awaited<ReturnType<typeof obterContexto>>["supabase"];

export type LeadPrioridade = LeadIA & { id: string; nome: string; corretor_id: string | null; observacoes: string | null };
export type LinhaPrioridade = { lead: LeadPrioridade; nota: number; fatores: FatorNota[]; proximo: ProximoContato | null; sinais: SinaisLead };

export const SELECT_LEAD_IA =
  "id, nome, status, origem, prioridade, funil, interesse, created_at, atendido_em, ultimo_contato, proximo_contato, telefone, email, orcamento_min, orcamento_max, regioes, tipos, quartos_min, imovel_id, corretor_id, observacoes";

/** Sinais de cada lead (contatos registrados, imóveis, visitas e propostas). */
export async function sinaisDosLeads(supabase: Supabase, ids: string[], agoraMs: number): Promise<Map<string, SinaisLead>> {
  const agora = new Date(agoraMs).toISOString();
  const [eventos, imoveis, visitas, propostas] = await Promise.all([
    porLotes(ids, (l) =>
      todas<{ lead_id: string; tipo: string }>(() => supabase.from("lead_eventos").select("id, lead_id, tipo").in("lead_id", l).in("tipo", ["ligacao", "whatsapp", "email", "reuniao", "mensagem"]).order("id"), 20_000),
    ),
    porLotes(ids, async (l) => ((await supabase.from("lead_imoveis").select("lead_id").in("lead_id", l)).data ?? []) as { lead_id: string }[]),
    porLotes(ids, async (l) => ((await supabase.from("visitas").select("lead_id, status, data_hora").in("lead_id", l).eq("tipo", "visita")).data ?? []) as { lead_id: string; status: string; data_hora: string }[]),
    porLotes(ids, async (l) => ((await supabase.from("propostas").select("lead_id").in("lead_id", l)).data ?? []) as { lead_id: string }[]),
  ]);
  const mapa = new Map<string, SinaisLead>(ids.map((id) => [id, { interacoes: 0, imoveis: 0, visitasRealizadas: 0, propostas: 0, ultimaVisita: null }]));
  for (const e of eventos) mapa.get(e.lead_id)!.interacoes++;
  for (const i of imoveis) mapa.get(i.lead_id)!.imoveis++;
  for (const p of propostas) mapa.get(p.lead_id)!.propostas++;
  for (const v of visitas) {
    const s = mapa.get(v.lead_id)!;
    if (v.status === "realizada") s.visitasRealizadas++;
    if (v.status !== "cancelada" && (!s.ultimaVisita || v.data_hora > s.ultimaVisita) && v.data_hora <= agora) s.ultimaVisita = v.data_hora;
  }
  return mapa;
}

const ABERTOS = ["novo", "em_atendimento", "visita", "proposta"];
const DIAS_PARADO = 7;

/**
 * Leads em aberto com a nota por regra e o próximo contato sugerido. Para não
 * esquecer os antigos: os 500 mais recentes + (sem limite de data de chegada)
 * os com retorno combinado até hoje e os parados há 7 dias ou mais (até 500
 * de cada, os mais atrasados primeiro). O total de abertos vem contado no banco.
 */
export async function carregarPrioridades(supabase: Supabase, o: { agoraMs: number; hoje: string }): Promise<{ linhas: LinhaPrioridade[]; total: number }> {
  const corte = new Date(o.agoraMs - DIAS_PARADO * 86_400_000).toISOString();
  const abertos = () => supabase.from("leads").select(SELECT_LEAD_IA).in("status", ABERTOS);
  const [recentes, combinados, parados, contagem] = await Promise.all([
    abertos().order("created_at", { ascending: false }).limit(500),
    abertos().not("proximo_contato", "is", null).lte("proximo_contato", o.hoje).order("proximo_contato", { ascending: true }).limit(500),
    abertos()
      .or(`ultimo_contato.lt.${corte},and(ultimo_contato.is.null,atendido_em.lt.${corte}),and(ultimo_contato.is.null,atendido_em.is.null,created_at.lt.${corte})`)
      .order("created_at", { ascending: true })
      .limit(500),
    supabase.from("leads").select("id", { count: "exact", head: true }).in("status", ABERTOS),
  ]);
  for (const r of [recentes, combinados, parados]) if (r.error) throw new Error(`Não foi possível ler os leads: ${r.error.message}`);
  const porId = new Map<string, LeadPrioridade>();
  for (const r of [recentes, combinados, parados]) for (const l of (r.data ?? []) as unknown as LeadPrioridade[]) porId.set(l.id, l);
  const leads = [...porId.values()];
  const sinais = await sinaisDosLeads(
    supabase,
    leads.map((l) => l.id),
    o.agoraMs,
  );
  const linhas = leads
    .map((lead) => {
      const s = sinais.get(lead.id)!;
      const { nota, fatores } = notaLead(lead, s, o.agoraMs, o.hoje);
      return { lead, nota, fatores, proximo: proximoContato(lead, s, o.hoje), sinais: s };
    })
    .sort((a, b) => b.nota - a.nota || (a.proximo?.quando ?? "9").localeCompare(b.proximo?.quando ?? "9"));
  return { linhas, total: contagem.count ?? linhas.length };
}
