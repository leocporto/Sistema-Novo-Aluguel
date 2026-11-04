/** Regras puras do CRM de leads: funis, conversão, tempo de atendimento e reativação. */
import type { PerfilInteresse } from "./pessoas";

/** Funis de leads (quem quer alugar ou comprar). Proprietário que quer anunciar vai para a Captação de imóveis. */
export const FUNIS = ["locacao", "venda"] as const;
export type Funil = (typeof FUNIS)[number] | "captacao";
export const ROTULO_FUNIL: Record<Funil, string> = { locacao: "Locação", venda: "Venda", captacao: "Captação" };

/** Etapas abertas, na ordem do funil (ganho e perdido são o fim). */
export const ETAPAS = ["novo", "em_atendimento", "visita", "proposta", "ganho"] as const;
export const TODAS_ETAPAS = [...ETAPAS, "perdido"] as const;
export type Etapa = (typeof TODAS_ETAPAS)[number];

/** Nome das etapas em cada funil (captação fala de avaliação e autorização). */
export function rotuloEtapa(funil: string, etapa: string): string {
  const base: Record<string, string> = {
    novo: "Novo",
    em_atendimento: "Em atendimento",
    visita: "Visita",
    proposta: "Proposta",
    ganho: "Fechado",
    perdido: "Perdido",
  };
  if (funil === "captacao") {
    const cap: Record<string, string> = { visita: "Avaliação", proposta: "Autorização", ganho: "Captado" };
    return cap[etapa] ?? base[etapa] ?? etapa;
  }
  if (funil === "venda" && etapa === "ganho") return "Vendido";
  if (funil === "locacao" && etapa === "ganho") return "Alugado";
  return base[etapa] ?? etapa;
}

export function ordemEtapa(etapa: string): number {
  const i = (ETAPAS as readonly string[]).indexOf(etapa);
  return i < 0 ? -1 : i;
}

export const MOTIVOS_PERDA = [
  "Preço acima do orçamento",
  "Comprou/alugou com outra imobiliária",
  "Desistiu ou adiou",
  "Não encontrou imóvel adequado",
  "Crédito/financiamento negado",
  "Documentação ou fiador",
  "Não respondeu mais",
  "Localização",
  "Outro",
];

export const ROTULO_PRIORIDADE: Record<string, string> = { quente: "Alta", morno: "Média", frio: "Baixa" };

/** Horas entre a chegada do lead e o primeiro atendimento (null = ainda não atendido). */
export function horasAtePrimeiroAtendimento(criado: string, atendido: string | null): number | null {
  if (!atendido) return null;
  return Math.max(0, (new Date(atendido).getTime() - new Date(criado).getTime()) / 3_600_000);
}

export function textoHoras(h: number | null): string {
  if (h === null) return "—";
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  if (h < 48) return `${Math.round(h)} h`;
  return `${Math.round(h / 24)} dias`;
}

export type LeadResumo = {
  id: string;
  status: string;
  etapa_max: number;
  corretor_id: string | null;
  origem: string;
  funil: string;
  created_at: string;
  atendido_em: string | null;
  motivo_perda: string | null;
};

/** Quantos leads chegaram até cada etapa e a conversão de uma etapa para a próxima. */
export function conversaoPorEtapa(leads: Pick<LeadResumo, "etapa_max" | "status">[]) {
  const total = leads.length;
  return ETAPAS.map((etapa, i) => {
    const chegaram = leads.filter((l) => (l.status === "ganho" ? 4 : l.etapa_max) >= i).length;
    const anterior = i === 0 ? total : leads.filter((l) => (l.status === "ganho" ? 4 : l.etapa_max) >= i - 1).length;
    return {
      etapa,
      chegaram,
      pctTotal: total ? Math.round((chegaram / total) * 1000) / 10 : 0,
      pctAnterior: anterior ? Math.round((chegaram / anterior) * 1000) / 10 : 0,
    };
  });
}

/** Números por grupo (corretor, origem…): total, abertos, ganhos, perdidos, conversão e tempo médio de 1º atendimento. */
export function resumoPor<T extends LeadResumo>(leads: T[], chave: (l: T) => string | null) {
  const grupos = new Map<string, T[]>();
  for (const l of leads) {
    const k = chave(l) ?? "";
    grupos.set(k, [...(grupos.get(k) ?? []), l]);
  }
  return [...grupos.entries()]
    .map(([k, ls]) => {
      const ganhos = ls.filter((l) => l.status === "ganho").length;
      const perdidos = ls.filter((l) => l.status === "perdido").length;
      const horas = ls.map((l) => horasAtePrimeiroAtendimento(l.created_at, l.atendido_em)).filter((h): h is number => h !== null);
      return {
        chave: k,
        total: ls.length,
        abertos: ls.length - ganhos - perdidos,
        ganhos,
        perdidos,
        conversao: ganhos + perdidos ? Math.round((ganhos / (ganhos + perdidos)) * 1000) / 10 : null,
        tempoMedioHoras: horas.length ? horas.reduce((s, h) => s + h, 0) / horas.length : null,
      };
    })
    .sort((a, b) => b.total - a.total);
}

/** Leads para reativar: perdidos há mais de 30 dias ou parados (sem contato) há mais de 60. */
export function paraReativar<T extends { status: string; perdido_em: string | null; ultimo_contato: string | null; created_at: string }>(
  leads: T[],
  agoraMs: number,
): T[] {
  const dias = (iso: string | null) => (iso ? (agoraMs - new Date(iso).getTime()) / 86_400_000 : Infinity);
  return leads.filter((l) => {
    if (l.status === "ganho") return false;
    if (l.status === "perdido") return dias(l.perdido_em ?? l.created_at) >= 30;
    return dias(l.ultimo_contato ?? l.created_at) >= 60;
  });
}

/** Perfil de busca do lead no formato usado para achar imóveis compatíveis. */
export function perfilDoLead(l: {
  funil: string;
  tipos: string[];
  regioes: string | null;
  orcamento_min: number | string | null;
  orcamento_max: number | string | null;
  quartos_min: number | null;
}): PerfilInteresse {
  return {
    interesse: l.funil === "venda" ? ["comprar"] : l.funil === "locacao" ? ["alugar"] : [],
    pref_tipos: l.tipos ?? [],
    pref_regioes: l.regioes,
    pref_valor_min: l.orcamento_min == null ? null : Number(l.orcamento_min),
    pref_valor_max: l.orcamento_max == null ? null : Number(l.orcamento_max),
    pref_quartos_min: l.quartos_min,
  };
}
