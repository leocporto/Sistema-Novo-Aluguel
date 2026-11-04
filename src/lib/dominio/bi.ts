/**
 * Regras puras dos Relatórios e BI (nos dois modos): período e comparação com
 * o período anterior, taxas, médias e variações, leitura das linhas que vêm
 * das funções public.bi_* (agregadas no banco), previsão (reajuste), lista
 * FECHADA de fontes/colunas/filtros dos relatórios personalizados (espelho de
 * privado.bi_fontes / privado.bi_validar — mude os dois juntos), próxima
 * execução dos envios programados (espelho de privado.bi_proxima_execucao) e
 * exportação (CSV com BOM e ";" e Excel 2003 em XML).
 * Dinheiro somado em centavos (dinheiro.ts); datas ISO (datas.ts).
 */
import { diasEntre, diasNoMes, fimDoMes, formatarDataBR, somarDias, somarMeses, type DataISO } from "./datas";
import { paraCentavos, paraReais } from "./dinheiro";
import type { Modulo } from "./equipe";

// ---------------------------------------------------------------------------
// Período
// ---------------------------------------------------------------------------

export const TIPOS_PERIODO = ["mes", "tri", "ano", "int"] as const;
export type TipoPeriodo = (typeof TIPOS_PERIODO)[number];
export const ROTULO_TIPO_PERIODO: Record<TipoPeriodo, string> = { mes: "Mês", tri: "Trimestre", ano: "Ano", int: "Intervalo" };

export const NOMES_MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const ABREV_MES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

export type Intervalo = { inicio: DataISO; fim: DataISO; rotulo: string };
export type Periodo = Intervalo & { tipo: TipoPeriodo; ref: string; anterior: Intervalo };

/** Maior intervalo aceito (o banco recusa mais de ~10 anos). */
export const MAX_DIAS_INTERVALO = 3660;

const dataValida = (v: unknown): v is string => {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [a, m, d] = v.split("-").map(Number);
  return m >= 1 && m <= 12 && d >= 1 && d <= diasNoMes(a, m) && a >= 2000 && a <= 2100;
};
const um = (v: string | string[] | undefined) => (typeof v === "string" ? v : Array.isArray(v) ? v[0] : undefined);

export function rotuloMes(mes: string): string {
  const [a, m] = mes.split("-").map(Number);
  return `${NOMES_MESES[m - 1]} de ${a}`;
}

export function rotuloMesCurto(data: DataISO): string {
  const [a, m] = data.split("-").map(Number);
  return `${ABREV_MES[m - 1]}/${String(a).slice(2)}`;
}

function trimestreDe(d: DataISO): number {
  return Math.floor((Number(d.slice(5, 7)) - 1) / 3) + 1;
}

/**
 * Período da URL: ?p=mes&ref=2026-11 · ?p=tri&ref=2026-T4 · ?p=ano&ref=2026 ·
 * ?p=int&de=2026-01-01&ate=2026-03-31. Sem nada (ou inválido): o mês atual.
 */
export function lerPeriodo(sp: Record<string, string | string[] | undefined>, hoje: DataISO): Periodo {
  const tipoUrl = um(sp.p);
  const tipo: TipoPeriodo = (TIPOS_PERIODO as readonly string[]).includes(tipoUrl ?? "") ? (tipoUrl as TipoPeriodo) : "mes";
  const ref = um(sp.ref) ?? "";
  let inicio: DataISO;
  let fim: DataISO;
  let rotulo: string;
  let r: string;
  if (tipo === "tri") {
    const ok = /^(\d{4})-T([1-4])$/.exec(ref);
    const ano = ok ? Number(ok[1]) : Number(hoje.slice(0, 4));
    const t = ok ? Number(ok[2]) : trimestreDe(hoje);
    inicio = `${ano}-${String((t - 1) * 3 + 1).padStart(2, "0")}-01`;
    fim = fimDoMes(somarMeses(inicio, 2));
    rotulo = `${t}º trimestre de ${ano}`;
    r = `${ano}-T${t}`;
  } else if (tipo === "ano") {
    const ano = /^\d{4}$/.test(ref) && Number(ref) >= 2000 && Number(ref) <= 2100 ? Number(ref) : Number(hoje.slice(0, 4));
    inicio = `${ano}-01-01`;
    fim = `${ano}-12-31`;
    rotulo = `Ano de ${ano}`;
    r = String(ano);
  } else if (tipo === "int") {
    const de = um(sp.de);
    const ate = um(sp.ate);
    if (dataValida(de) && dataValida(ate) && de <= ate && diasEntre(de, ate) <= MAX_DIAS_INTERVALO) {
      inicio = de;
      fim = ate;
    } else {
      inicio = somarDias(hoje, -29);
      fim = hoje;
    }
    rotulo = `${formatarDataBR(inicio)} a ${formatarDataBR(fim)}`;
    r = `${inicio}_${fim}`;
  } else {
    const mes = /^\d{4}-(0[1-9]|1[0-2])$/.test(ref) ? ref : hoje.slice(0, 7);
    inicio = `${mes}-01`;
    fim = fimDoMes(inicio);
    rotulo = rotuloMes(mes);
    r = mes;
  }
  return { tipo, inicio, fim, rotulo, ref: r, anterior: periodoAnterior(tipo, inicio, fim, hoje) };
}

/**
 * Período de comparação: o anterior de mesmo tamanho (mês, trimestre ou ano
 * anterior; no intervalo, os mesmos dias logo antes). Se o período ainda está
 * em andamento (contém hoje), a comparação vai só até o "mesmo ponto" do
 * anterior — comparar o mês pela metade com o mês inteiro enganaria.
 */
export function periodoAnterior(tipo: TipoPeriodo, inicio: DataISO, fim: DataISO, hoje: DataISO): Intervalo {
  const emAndamento = hoje >= inicio && hoje < fim;
  if (tipo === "int") {
    const dias = diasEntre(inicio, fim) + 1;
    const ini = somarDias(inicio, -dias);
    const f = emAndamento ? somarDias(hoje, -dias) : somarDias(inicio, -1);
    return { inicio: ini, fim: f, rotulo: `${formatarDataBR(ini)} a ${formatarDataBR(f)}` };
  }
  const meses = tipo === "mes" ? 1 : tipo === "tri" ? 3 : 12;
  const ini = somarMeses(inicio, -meses);
  const fimCheio = fimDoMes(somarMeses(inicio, -1));
  const f = emAndamento ? minData(somarMeses(hoje, -meses), fimCheio) : fimCheio;
  const nome = tipo === "mes" ? rotuloMes(ini.slice(0, 7)) : tipo === "tri" ? `${trimestreDe(ini)}º trimestre de ${ini.slice(0, 4)}` : `ano de ${ini.slice(0, 4)}`;
  return { inicio: ini, fim: f, rotulo: emAndamento ? `${nome} até ${formatarDataBR(f).slice(0, 5)}` : nome };
}

const minData = (a: DataISO, b: DataISO) => (a < b ? a : b);

/** Período vizinho (‹ ›) de mês, trimestre ou ano: devolve o ?ref= dele. */
export function refVizinha(p: Pick<Periodo, "tipo" | "inicio">, delta: number): string | null {
  if (p.tipo === "mes") return somarMeses(p.inicio, delta).slice(0, 7);
  if (p.tipo === "tri") {
    const d = somarMeses(p.inicio, delta * 3);
    return `${d.slice(0, 4)}-T${trimestreDe(d)}`;
  }
  if (p.tipo === "ano") return String(Number(p.inicio.slice(0, 4)) + delta);
  return null;
}

/** Parâmetros de URL que reproduzem o período. */
export function paramsPeriodo(p: Pick<Periodo, "tipo" | "ref" | "inicio" | "fim">): Record<string, string> {
  if (p.tipo === "int") return { p: "int", de: p.inicio, ate: p.fim };
  return { p: p.tipo, ref: p.ref };
}

export function queryPeriodo(p: Pick<Periodo, "tipo" | "ref" | "inicio" | "fim">, extra: Record<string, string | undefined> = {}): string {
  const q = new URLSearchParams(paramsPeriodo(p));
  for (const [k, v] of Object.entries(extra)) if (v) q.set(k, v);
  return q.toString();
}

/** Meses (AAAA-MM-01) entre duas datas, inclusive. */
export function mesesEntreDatas(inicio: DataISO, fim: DataISO): DataISO[] {
  const out: DataISO[] = [];
  let m = `${inicio.slice(0, 7)}-01`;
  while (m <= fim) {
    out.push(m);
    m = somarMeses(m, 1);
  }
  return out;
}

// Períodos dos envios programados -------------------------------------------

export const PERIODOS_AGENDADOS = ["mes_atual", "mes_anterior", "ultimos_30", "ano_atual"] as const;
export type PeriodoAgendado = (typeof PERIODOS_AGENDADOS)[number];
export const ROTULO_PERIODO_AGENDADO: Record<PeriodoAgendado, string> = {
  mes_atual: "Mês atual (até o dia do envio)",
  mes_anterior: "Mês anterior (completo)",
  ultimos_30: "Últimos 30 dias",
  ano_atual: "Ano atual (até o dia do envio)",
};

export function periodoRelativo(chave: string, hoje: DataISO): Intervalo {
  if (chave === "mes_anterior") {
    const ini = somarMeses(`${hoje.slice(0, 7)}-01`, -1);
    return { inicio: ini, fim: fimDoMes(ini), rotulo: rotuloMes(ini.slice(0, 7)) };
  }
  if (chave === "ultimos_30") {
    const ini = somarDias(hoje, -29);
    return { inicio: ini, fim: hoje, rotulo: `${formatarDataBR(ini)} a ${formatarDataBR(hoje)}` };
  }
  if (chave === "ano_atual") return { inicio: `${hoje.slice(0, 4)}-01-01`, fim: hoje, rotulo: `${hoje.slice(0, 4)} até ${formatarDataBR(hoje)}` };
  return { inicio: `${hoje.slice(0, 7)}-01`, fim: hoje, rotulo: `${rotuloMes(hoje.slice(0, 7))} até ${formatarDataBR(hoje)}` };
}

// ---------------------------------------------------------------------------
// Taxas, médias, variações e formatos
// ---------------------------------------------------------------------------

const arred1 = (n: number) => Math.round(n * 10) / 10;

/** Parte ÷ total em % (1 casa). null quando não há base. */
export function taxa(parte: number, total: number): number | null {
  if (!total || !Number.isFinite(total) || total <= 0) return null;
  return arred1((parte / total) * 100);
}

/** Variação % do atual sobre o anterior (1 casa). null quando o anterior é zero. */
export function variacao(atual: number, anterior: number): number | null {
  if (!anterior || !Number.isFinite(anterior)) return null;
  return arred1(((atual - anterior) / Math.abs(anterior)) * 100);
}

/** Média em dias (inteiro). null sem nenhum caso. */
export function mediaDias(soma: number, qtd: number): number | null {
  return qtd > 0 ? Math.round(soma / qtd) : null;
}

export function formatarPct(v: number | null | undefined, casas = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return `${v.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas })}%`;
}

/** "+12,5%" / "−3,0%" / "—". */
export function formatarVariacao(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  const s = Math.abs(v).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return v > 0 ? `+${s}%` : v < 0 ? `−${s}%` : "0,0%";
}

export function formatarDias(d: number | null | undefined): string {
  if (d === null || d === undefined || !Number.isFinite(d)) return "—";
  return d === 1 ? "1 dia" : `${d.toLocaleString("pt-BR")} dias`;
}

/** Para indicadores em que subir é ruim (inadimplência, vacância, prazos). */
export type Sentido = "maior_melhor" | "menor_melhor";
export function tomVariacao(v: number | null, sentido: Sentido = "maior_melhor"): "sucesso" | "perigo" | "neutro" {
  if (v === null || v === 0) return "neutro";
  const bom = sentido === "maior_melhor" ? v > 0 : v < 0;
  return bom ? "sucesso" : "perigo";
}

const num = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};
/** Data que veio do banco (texto "AAAA-MM-DD" ou Date) como ISO. */
export function lerData(v: unknown): DataISO | null {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
}

// ---------------------------------------------------------------------------
// Financeiro (public.bi_financeiro_mensal)
// ---------------------------------------------------------------------------

export const CAMPOS_FINANCEIRO = [
  "aluguel_recebido",
  "faturado",
  "outras_receitas",
  "despesas",
  "taxa_administracao",
  "taxa_intermediacao",
  "comissao_vendas",
  "repasses_pagos",
  "venc_valor",
  "venc_aberto",
  "venc_acordo",
  "comp_valor",
  "comp_aberto",
  "comp_acordo",
] as const;
export type CampoFinanceiro = (typeof CAMPOS_FINANCEIRO)[number];
export type TotaisFinanceiro = Record<CampoFinanceiro, number>;
export type LinhaFinanceira = TotaisFinanceiro & { mes: DataISO };

export function lerLinhaFinanceira(r: Record<string, unknown>): LinhaFinanceira {
  return { mes: lerData(r.mes) ?? "", ...(Object.fromEntries(CAMPOS_FINANCEIRO.map((c) => [c, num(r[c])])) as TotaisFinanceiro) };
}

/** Soma das linhas (em centavos por dentro). */
export function somarFinanceiro(linhas: Partial<TotaisFinanceiro>[]): TotaisFinanceiro {
  const t = Object.fromEntries(CAMPOS_FINANCEIRO.map((c) => [c, 0])) as TotaisFinanceiro;
  for (const l of linhas) for (const c of CAMPOS_FINANCEIRO) t[c] += paraCentavos(l[c] ?? 0);
  for (const c of CAMPOS_FINANCEIRO) t[c] = paraReais(t[c]);
  return t;
}

/** Receita própria da imobiliária: administração + intermediação + comissão de vendas + outras receitas. */
export function receitaImobiliaria(t: Pick<TotaisFinanceiro, "taxa_administracao" | "taxa_intermediacao" | "comissao_vendas" | "outras_receitas">): number {
  return paraReais(paraCentavos(t.taxa_administracao) + paraCentavos(t.taxa_intermediacao) + paraCentavos(t.comissao_vendas) + paraCentavos(t.outras_receitas));
}

/**
 * Resultado do período. Imóveis pessoais: aluguel recebido + outras receitas −
 * despesas. Imobiliária: receita própria − despesas (o aluguel é do proprietário).
 */
export function resultadoFinanceiro(t: TotaisFinanceiro, pessoal: boolean): number {
  const receitas = pessoal ? paraCentavos(t.aluguel_recebido) + paraCentavos(t.outras_receitas) : paraCentavos(receitaImobiliaria(t));
  return paraReais(receitas - paraCentavos(t.despesas));
}

export type Inadimplencia = { vencido: number; emAberto: number; emAcordo: number; naoPago: number; pct: number | null };

/** Inadimplência = valor vencido e ainda não pago (em aberto + em acordo) ÷ valor que venceu. */
export function inadimplencia(vencido: number, emAberto: number, emAcordo: number): Inadimplencia {
  const naoPago = paraReais(paraCentavos(emAberto) + paraCentavos(emAcordo));
  return { vencido, emAberto, emAcordo, naoPago, pct: taxa(naoPago, vencido) };
}

export function inadimplenciaPorVencimento(t: Pick<TotaisFinanceiro, "venc_valor" | "venc_aberto" | "venc_acordo">): Inadimplencia {
  return inadimplencia(t.venc_valor, t.venc_aberto, t.venc_acordo);
}

export function inadimplenciaPorCompetencia(t: Pick<TotaisFinanceiro, "comp_valor" | "comp_aberto" | "comp_acordo">): Inadimplencia {
  return inadimplencia(t.comp_valor, t.comp_aberto, t.comp_acordo);
}

// ---------------------------------------------------------------------------
// Imóveis (public.bi_ocupacao)
// ---------------------------------------------------------------------------

export const CAMPOS_OCUPACAO = [
  "imoveis",
  "dias_disponiveis",
  "dias_ocupados",
  "vagos_hoje",
  "alugados_hoje",
  "vacancia_soma",
  "vacancia_qtd",
  "vacancia_abertas",
  "alugar_soma",
  "alugar_qtd",
  "vender_soma",
  "vender_qtd",
  "contratos_ativos",
  "contratos_novos",
  "contratos_encerrados",
] as const;
export type ResumoOcupacao = Record<(typeof CAMPOS_OCUPACAO)[number], number>;

export function lerOcupacao(r: Record<string, unknown> | null | undefined): ResumoOcupacao {
  return Object.fromEntries(CAMPOS_OCUPACAO.map((c) => [c, num(r?.[c])])) as ResumoOcupacao;
}

/** Ocupação = dias ocupados ÷ dias disponíveis dos imóveis de locação. */
export const taxaOcupacao = (o: Pick<ResumoOcupacao, "dias_ocupados" | "dias_disponiveis">) => taxa(o.dias_ocupados, o.dias_disponiveis);
export const vacanciaMedia = (o: Pick<ResumoOcupacao, "vacancia_soma" | "vacancia_qtd">) => mediaDias(o.vacancia_soma, o.vacancia_qtd);
export const tempoParaAlugar = (o: Pick<ResumoOcupacao, "alugar_soma" | "alugar_qtd">) => mediaDias(o.alugar_soma, o.alugar_qtd);
export const tempoParaVender = (o: Pick<ResumoOcupacao, "vender_soma" | "vender_qtd">) => mediaDias(o.vender_soma, o.vender_qtd);

// ---------------------------------------------------------------------------
// Rentabilidade
// ---------------------------------------------------------------------------

/**
 * Rendimento anualizado sobre o valor do imóvel: resultado do período ÷ valor
 * de referência, levado a 12 meses (× 365 ÷ dias do período). 2 casas.
 */
export function rendimentoAnual(resultado: number, valorReferencia: number | null | undefined, dias: number): number | null {
  if (!valorReferencia || valorReferencia <= 0 || dias <= 0) return null;
  return Math.round((resultado / valorReferencia) * (365 / dias) * 10000) / 100;
}

// ---------------------------------------------------------------------------
// Previsão (public.bi_previsao)
// ---------------------------------------------------------------------------

/**
 * Reajustes pendentes até a competência: quantos aniversários da data-base
 * (data-base + n × periodicidade meses) caem até o mês da competência.
 * Mesma conta de privado.bi_reajustes_ate.
 */
export function reajustesAte(dataBase: DataISO | null, periodicidadeMeses: number, competencia: DataISO): number {
  if (!dataBase || periodicidadeMeses <= 0) return 0;
  const meses = (Number(competencia.slice(0, 4)) - Number(dataBase.slice(0, 4))) * 12 + Number(competencia.slice(5, 7)) - Number(dataBase.slice(5, 7));
  if (meses <= 0) return 0;
  return Math.floor(meses / periodicidadeMeses);
}

/** Aluguel com k reajustes pelo índice acumulado (ex.: 0,045 = 4,5%). */
export function valorReajustado(valor: number, acumulado: number, k: number): number {
  return paraReais(Math.round(paraCentavos(valor) * Math.pow(1 + acumulado, k)));
}

/** Variação acumulada de uma lista de índices mensais em % (ex.: [0,5; 0,4] → 0,902%). */
export function acumuladoIndices(variacoesPct: number[]): number {
  return variacoesPct.reduce((acc, v) => acc * (1 + v / 100), 1) - 1;
}

export const CAMPOS_PREVISAO = [
  "faturas_em_aberto",
  "alugueis_previstos",
  "reajuste_previsto",
  "outras_receitas",
  "despesas",
  "repasses_agendados",
  "repasses_estimados",
  "taxa_adm_prevista",
  "contratos",
] as const;
export type LinhaPrevisao = Record<(typeof CAMPOS_PREVISAO)[number], number> & { mes: DataISO; atrasado: boolean };

export function lerLinhaPrevisao(r: Record<string, unknown>): LinhaPrevisao {
  return {
    mes: lerData(r.mes) ?? "",
    atrasado: r.atrasado === true || r.atrasado === "t" || r.atrasado === "true",
    ...(Object.fromEntries(CAMPOS_PREVISAO.map((c) => [c, num(r[c])])) as Record<(typeof CAMPOS_PREVISAO)[number], number>),
  };
}

/** Quanto entra no mês: aluguéis (faturas em aberto + previstos) + outras receitas. */
export function entradasPrevistas(l: Pick<LinhaPrevisao, "faturas_em_aberto" | "alugueis_previstos" | "outras_receitas">): number {
  return paraReais(paraCentavos(l.faturas_em_aberto) + paraCentavos(l.alugueis_previstos) + paraCentavos(l.outras_receitas));
}

/**
 * Saldo previsto do mês. Pessoal: entradas − despesas. Imobiliária: taxa de
 * administração prevista + outras receitas − despesas (o aluguel vira repasse).
 */
export function saldoPrevisto(l: LinhaPrevisao, pessoal: boolean): number {
  const entra = pessoal ? paraCentavos(entradasPrevistas(l)) : paraCentavos(l.taxa_adm_prevista) + paraCentavos(l.outras_receitas);
  return paraReais(entra - paraCentavos(l.despesas));
}

export function somarPrevisao(linhas: LinhaPrevisao[]): Record<(typeof CAMPOS_PREVISAO)[number], number> {
  const t = Object.fromEntries(CAMPOS_PREVISAO.map((c) => [c, 0])) as Record<(typeof CAMPOS_PREVISAO)[number], number>;
  for (const l of linhas) for (const c of CAMPOS_PREVISAO) t[c] += c === "contratos" ? 0 : paraCentavos(l[c]);
  for (const c of CAMPOS_PREVISAO) t[c] = c === "contratos" ? Math.max(0, ...linhas.map((l) => l.contratos)) : paraReais(t[c]);
  return t;
}

// ---------------------------------------------------------------------------
// Comercial (public.bi_funil / bi_leads_canais)
// ---------------------------------------------------------------------------

export const ROTULO_ORIGEM: Record<string, string> = {
  site: "Site",
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
  portal: "Portal",
  zap: "ZAP Imóveis",
  vivareal: "Viva Real",
  olx: "OLX",
  imovelweb: "Imovelweb",
  indicacao: "Indicação",
  placa: "Placa",
  telefone: "Telefone",
  email: "E-mail",
  visita: "Visita ao escritório",
  outro: "Outro",
};

export type Funil = {
  leads: number;
  atendidos: number;
  com_visita: number;
  com_proposta: number;
  fechados: number;
  perdidos: number;
  visitas_realizadas: number;
  propostas_feitas: number;
  propostas_aceitas: number;
  contratos_locacao: number;
  vendas_concluidas: number;
  valor_vendas: number;
};
const CAMPOS_FUNIL = [
  "leads",
  "atendidos",
  "com_visita",
  "com_proposta",
  "fechados",
  "perdidos",
  "visitas_realizadas",
  "propostas_feitas",
  "propostas_aceitas",
  "contratos_locacao",
  "vendas_concluidas",
  "valor_vendas",
] as const;

export function lerFunil(r: Record<string, unknown> | null | undefined): Funil {
  return Object.fromEntries(CAMPOS_FUNIL.map((c) => [c, num(r?.[c])])) as Funil;
}

/** Etapas do funil com a conversão de cada uma sobre a anterior e sobre o total de leads. */
export function etapasFunil(f: Pick<Funil, "leads" | "com_visita" | "com_proposta" | "fechados">): { chave: string; rotulo: string; valor: number; daAnterior: number | null; doTotal: number | null }[] {
  const etapas = [
    { chave: "leads", rotulo: "Leads", valor: f.leads },
    { chave: "visita", rotulo: "Visitaram", valor: f.com_visita },
    { chave: "proposta", rotulo: "Fizeram proposta", valor: f.com_proposta },
    { chave: "fechado", rotulo: "Fecharam negócio", valor: f.fechados },
  ];
  return etapas.map((e, i) => ({ ...e, daAnterior: i === 0 ? null : taxa(e.valor, etapas[i - 1].valor), doTotal: i === 0 ? null : taxa(e.valor, f.leads) }));
}

// ---------------------------------------------------------------------------
// Relatórios personalizados: lista FECHADA (espelho de privado.bi_fontes)
// ---------------------------------------------------------------------------

export const TIPOS_CAMPO = ["texto", "inteiro", "numero", "dinheiro", "data"] as const;
export type TipoCampo = (typeof TIPOS_CAMPO)[number];
export type CampoFonte = { id: string; rotulo: string; tipo: TipoCampo; soImobiliaria?: boolean };
/** modulo: módulo de onde vêm os dados — o perfil de acesso precisa "ver" esse módulo (privado.bi_pode_fonte). */
export type DefFonte = { rotulo: string; modulo: Modulo; descricao: string; soImobiliaria: boolean; campos: CampoFonte[] };

export const FONTES_BI = {
  imoveis: {
    rotulo: "Imóveis",
    modulo: "imoveis",
    descricao: "Cadastro de imóveis: situação, valores, endereço e captação.",
    soImobiliaria: false,
    campos: [
      { id: "codigo", rotulo: "Código", tipo: "texto" },
      { id: "titulo", rotulo: "Título", tipo: "texto" },
      { id: "tipo", rotulo: "Tipo", tipo: "texto" },
      { id: "status", rotulo: "Situação", tipo: "texto" },
      { id: "finalidades", rotulo: "Finalidades", tipo: "texto" },
      { id: "bairro", rotulo: "Bairro", tipo: "texto" },
      { id: "cidade", rotulo: "Cidade", tipo: "texto" },
      { id: "uf", rotulo: "UF", tipo: "texto" },
      { id: "valor_aluguel", rotulo: "Aluguel", tipo: "dinheiro" },
      { id: "valor_venda", rotulo: "Valor de venda", tipo: "dinheiro" },
      { id: "valor_condominio", rotulo: "Condomínio", tipo: "dinheiro" },
      { id: "valor_iptu", rotulo: "IPTU (mensal)", tipo: "dinheiro" },
      { id: "area_util", rotulo: "Área útil (m²)", tipo: "numero" },
      { id: "quartos", rotulo: "Quartos", tipo: "inteiro" },
      { id: "vagas", rotulo: "Vagas", tipo: "inteiro" },
      { id: "captado_em", rotulo: "Captado em", tipo: "data" },
      { id: "corretor", rotulo: "Corretor", tipo: "texto", soImobiliaria: true },
      { id: "filial", rotulo: "Filial", tipo: "texto", soImobiliaria: true },
    ],
  },
  contratos: {
    rotulo: "Contratos de locação",
    modulo: "contratos",
    descricao: "Contratos com imóvel, locatário, prazo, aluguel e garantia.",
    soImobiliaria: false,
    campos: [
      { id: "numero", rotulo: "Nº", tipo: "inteiro" },
      { id: "codigo", rotulo: "Código", tipo: "texto" },
      { id: "imovel", rotulo: "Imóvel", tipo: "texto" },
      { id: "locatario", rotulo: "Locatário", tipo: "texto" },
      { id: "proprietario", rotulo: "Proprietário", tipo: "texto", soImobiliaria: true },
      { id: "status", rotulo: "Situação", tipo: "texto" },
      { id: "finalidade", rotulo: "Finalidade", tipo: "texto" },
      { id: "data_inicio", rotulo: "Início", tipo: "data" },
      { id: "data_fim", rotulo: "Fim", tipo: "data" },
      { id: "valor_aluguel", rotulo: "Aluguel", tipo: "dinheiro" },
      { id: "dia_vencimento", rotulo: "Dia do vencimento", tipo: "inteiro" },
      { id: "indice_reajuste", rotulo: "Índice de reajuste", tipo: "texto" },
      { id: "garantia", rotulo: "Garantia", tipo: "texto" },
      { id: "taxa_administracao_pct", rotulo: "Taxa de administração (%)", tipo: "numero", soImobiliaria: true },
      { id: "filial", rotulo: "Filial", tipo: "texto", soImobiliaria: true },
    ],
  },
  faturas: {
    rotulo: "Aluguéis (faturas)",
    modulo: "faturas",
    descricao: "Cada aluguel cobrado: competência, vencimento, valor, saldo e atraso.",
    soImobiliaria: false,
    campos: [
      { id: "numero", rotulo: "Nº", tipo: "inteiro" },
      { id: "contrato", rotulo: "Contrato", tipo: "inteiro" },
      { id: "imovel", rotulo: "Imóvel", tipo: "texto" },
      { id: "locatario", rotulo: "Locatário", tipo: "texto" },
      { id: "competencia", rotulo: "Competência", tipo: "data" },
      { id: "vencimento", rotulo: "Vencimento", tipo: "data" },
      { id: "valor_total", rotulo: "Valor", tipo: "dinheiro" },
      { id: "saldo", rotulo: "Saldo em aberto", tipo: "dinheiro" },
      { id: "status", rotulo: "Situação", tipo: "texto" },
      { id: "pago_em", rotulo: "Pago em", tipo: "data" },
      { id: "dias_atraso", rotulo: "Dias de atraso", tipo: "inteiro" },
    ],
  },
  lancamentos: {
    rotulo: "Lançamentos financeiros",
    modulo: "financeiro",
    descricao: "Contas a receber e a pagar do Financeiro.",
    soImobiliaria: false,
    campos: [
      { id: "tipo", rotulo: "Tipo", tipo: "texto" },
      { id: "descricao", rotulo: "Descrição", tipo: "texto" },
      { id: "categoria", rotulo: "Categoria", tipo: "texto" },
      { id: "valor", rotulo: "Valor", tipo: "dinheiro" },
      { id: "valor_pago", rotulo: "Valor pago", tipo: "dinheiro" },
      { id: "vencimento", rotulo: "Vencimento", tipo: "data" },
      { id: "liquidado_em", rotulo: "Pago/recebido em", tipo: "data" },
      { id: "status", rotulo: "Situação", tipo: "texto" },
      { id: "pessoa", rotulo: "Pessoa", tipo: "texto" },
      { id: "imovel", rotulo: "Imóvel", tipo: "texto" },
      { id: "plano", rotulo: "Plano de contas", tipo: "texto" },
      { id: "centro_custo", rotulo: "Centro de custo", tipo: "texto" },
      { id: "conta", rotulo: "Conta", tipo: "texto" },
      { id: "terceiros", rotulo: "De terceiros", tipo: "texto", soImobiliaria: true },
    ],
  },
  leads: {
    rotulo: "Leads",
    modulo: "comercial",
    descricao: "Contatos interessados: origem, funil, etapa e corretor.",
    soImobiliaria: true,
    campos: [
      { id: "nome", rotulo: "Nome", tipo: "texto" },
      { id: "telefone", rotulo: "Telefone", tipo: "texto" },
      { id: "email", rotulo: "E-mail", tipo: "texto" },
      { id: "origem", rotulo: "Origem", tipo: "texto" },
      { id: "funil", rotulo: "Funil", tipo: "texto" },
      { id: "status", rotulo: "Etapa", tipo: "texto" },
      { id: "prioridade", rotulo: "Prioridade", tipo: "texto" },
      { id: "corretor", rotulo: "Corretor", tipo: "texto" },
      { id: "imovel", rotulo: "Imóvel", tipo: "texto" },
      { id: "entrada", rotulo: "Entrada", tipo: "data" },
      { id: "atendido_em", rotulo: "1º atendimento", tipo: "data" },
      { id: "perdido_em", rotulo: "Perdido em", tipo: "data" },
      { id: "motivo_perda", rotulo: "Motivo da perda", tipo: "texto" },
      { id: "utm_source", rotulo: "Origem da campanha (utm_source)", tipo: "texto" },
      { id: "utm_campaign", rotulo: "Campanha (utm_campaign)", tipo: "texto" },
      { id: "filial", rotulo: "Filial", tipo: "texto" },
    ],
  },
  visitas: {
    rotulo: "Visitas e compromissos",
    modulo: "agenda",
    descricao: "Agenda: visitas, avaliações, vistorias e reuniões.",
    soImobiliaria: false,
    campos: [
      { id: "data", rotulo: "Data", tipo: "data" },
      { id: "hora", rotulo: "Hora", tipo: "texto" },
      { id: "tipo", rotulo: "Tipo", tipo: "texto" },
      { id: "status", rotulo: "Situação", tipo: "texto" },
      { id: "imovel", rotulo: "Imóvel", tipo: "texto" },
      { id: "contato", rotulo: "Contato", tipo: "texto" },
      { id: "feedback_nota", rotulo: "Nota da visita", tipo: "inteiro" },
      { id: "feedback_interesse", rotulo: "Interesse", tipo: "texto" },
      { id: "corretor", rotulo: "Corretor", tipo: "texto", soImobiliaria: true },
    ],
  },
  propostas: {
    rotulo: "Propostas",
    modulo: "comercial",
    descricao: "Propostas de locação e de venda.",
    soImobiliaria: true,
    campos: [
      { id: "tipo", rotulo: "Tipo", tipo: "texto" },
      { id: "status", rotulo: "Situação", tipo: "texto" },
      { id: "valor", rotulo: "Valor", tipo: "dinheiro" },
      { id: "imovel", rotulo: "Imóvel", tipo: "texto" },
      { id: "corretor", rotulo: "Corretor", tipo: "texto" },
      { id: "cliente", rotulo: "Cliente", tipo: "texto" },
      { id: "criada_em", rotulo: "Feita em", tipo: "data" },
      { id: "fechada_em", rotulo: "Fechada em", tipo: "data" },
    ],
  },
  repasses: {
    rotulo: "Repasses",
    modulo: "repasses",
    descricao: "Repasses aos proprietários: aluguel, taxas, IRRF e líquido.",
    soImobiliaria: true,
    campos: [
      { id: "competencia", rotulo: "Competência", tipo: "data" },
      { id: "contrato", rotulo: "Contrato", tipo: "inteiro" },
      { id: "imovel", rotulo: "Imóvel", tipo: "texto" },
      { id: "proprietario", rotulo: "Proprietário", tipo: "texto" },
      { id: "aluguel", rotulo: "Aluguel", tipo: "dinheiro" },
      { id: "valor_bruto", rotulo: "Bruto", tipo: "dinheiro" },
      { id: "taxa_administracao", rotulo: "Taxa de administração", tipo: "dinheiro" },
      { id: "taxa_intermediacao", rotulo: "Taxa de intermediação", tipo: "dinheiro" },
      { id: "irrf", rotulo: "IRRF", tipo: "dinheiro" },
      { id: "valor_liquido", rotulo: "Líquido", tipo: "dinheiro" },
      { id: "status", rotulo: "Situação", tipo: "texto" },
      { id: "pagar_em", rotulo: "Pagar em", tipo: "data" },
      { id: "pago_em", rotulo: "Pago em", tipo: "data" },
    ],
  },
  chamados: {
    rotulo: "Chamados de manutenção",
    modulo: "manutencao",
    descricao: "Chamados: imóvel, categoria, urgência, valores e prestador.",
    soImobiliaria: false,
    campos: [
      { id: "numero", rotulo: "Nº", tipo: "inteiro" },
      { id: "titulo", rotulo: "Título", tipo: "texto" },
      { id: "imovel", rotulo: "Imóvel", tipo: "texto" },
      { id: "categoria", rotulo: "Categoria", tipo: "texto" },
      { id: "urgencia", rotulo: "Urgência", tipo: "texto" },
      { id: "status", rotulo: "Situação", tipo: "texto" },
      { id: "aberto_em", rotulo: "Aberto em", tipo: "data" },
      { id: "concluido_em", rotulo: "Concluído em", tipo: "data" },
      { id: "valor_aprovado", rotulo: "Valor aprovado", tipo: "dinheiro" },
      { id: "valor_final", rotulo: "Valor final", tipo: "dinheiro" },
      { id: "prestador", rotulo: "Prestador", tipo: "texto" },
      { id: "responsabilidade", rotulo: "Quem paga", tipo: "texto" },
    ],
  },
} satisfies Record<string, DefFonte>;

export type FonteBI = keyof typeof FONTES_BI;
export const LISTA_FONTES = Object.keys(FONTES_BI) as FonteBI[];

export function ehFonte(f: unknown): f is FonteBI {
  return typeof f === "string" && Object.prototype.hasOwnProperty.call(FONTES_BI, f);
}

/** Fontes que o modo deixa usar. */
export function fontesDoModo(imob: boolean): FonteBI[] {
  return LISTA_FONTES.filter((f) => imob || !FONTES_BI[f].soImobiliaria);
}

/** Módulo de onde vêm os dados da fonte (espelho de privado.bi_fontes()->fonte->>'modulo'). */
export const moduloDaFonte = (f: FonteBI): Modulo => FONTES_BI[f].modulo;

/**
 * Fontes que o usuário pode usar: as do modo cujo módulo o perfil de acesso
 * deixa ver (mesma conta de privado.bi_pode_fonte). Ex.: perfil com
 * Relatórios mas sem Financeiro não monta relatório de lançamentos.
 */
export function fontesPermitidas(imob: boolean, perms: Partial<Record<string, readonly string[]>>): FonteBI[] {
  return fontesDoModo(imob).filter((f) => Boolean(perms[moduloDaFonte(f)]?.includes("ver")));
}

/** Colunas da fonte que o modo deixa usar. */
export function camposDaFonte(fonte: FonteBI, imob: boolean): CampoFonte[] {
  return (FONTES_BI[fonte].campos as CampoFonte[]).filter((c) => imob || !c.soImobiliaria);
}

export function campoDaFonte(fonte: FonteBI, id: string): CampoFonte | undefined {
  return (FONTES_BI[fonte].campos as CampoFonte[]).find((c) => c.id === id);
}

/** Colunas que um relatório novo já traz marcadas (as 6 primeiras do modo). */
export function colunasPadrao(fonte: FonteBI, imob: boolean): string[] {
  return camposDaFonte(fonte, imob)
    .slice(0, 6)
    .map((c) => c.id);
}

export const OPERADORES = ["igual", "diferente", "contem", "maior_igual", "menor_igual", "ultimos_dias", "este_mes", "mes_passado", "este_ano", "vazio", "preenchido"] as const;
export type Operador = (typeof OPERADORES)[number];
export const ROTULO_OPERADOR: Record<Operador, string> = {
  igual: "é igual a",
  diferente: "é diferente de",
  contem: "contém",
  maior_igual: "a partir de (≥)",
  menor_igual: "até (≤)",
  ultimos_dias: "nos últimos N dias",
  este_mes: "neste mês",
  mes_passado: "no mês passado",
  este_ano: "neste ano",
  vazio: "está vazio",
  preenchido: "está preenchido",
};
/** Operadores de cada tipo de coluna (espelho de privado.bi_operadores). */
export const OPERADORES_POR_TIPO: Record<TipoCampo, Operador[]> = {
  texto: ["igual", "diferente", "contem", "vazio", "preenchido"],
  data: ["igual", "maior_igual", "menor_igual", "ultimos_dias", "este_mes", "mes_passado", "este_ano", "vazio", "preenchido"],
  dinheiro: ["igual", "diferente", "maior_igual", "menor_igual", "vazio", "preenchido"],
  numero: ["igual", "diferente", "maior_igual", "menor_igual", "vazio", "preenchido"],
  inteiro: ["igual", "diferente", "maior_igual", "menor_igual", "vazio", "preenchido"],
};
export const OPERADORES_SEM_VALOR: Operador[] = ["vazio", "preenchido", "este_mes", "mes_passado", "este_ano"];

export type FiltroRelatorio = { campo: string; op: string; valor?: string | null };
export type DefinicaoRelatorio = {
  fonte: string;
  colunas: string[];
  filtros?: FiltroRelatorio[] | null;
  agrupar_por?: string | null;
  totais?: string[] | null;
  ordenar_por?: string | null;
  ordem?: string | null;
};

/** "1.234,56" → "1234.56" (o banco aceita só ponto decimal). */
export function normalizarNumeroFiltro(v: string): string {
  const s = v.trim().replace(/\s/g, "");
  return s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s;
}

/**
 * Confere a definição (mesmas regras e mensagens de privado.bi_validar).
 * Devolve a mensagem de erro ou null.
 */
export function validarDefinicao(def: DefinicaoRelatorio, imob: boolean): string | null {
  if (!def || typeof def !== "object") return "Relatório inválido.";
  if (!ehFonte(def.fonte)) return "Escolha a fonte dos dados.";
  const fonte = FONTES_BI[def.fonte] as DefFonte;
  if (fonte.soImobiliaria && !imob) return "Esta fonte só existe no modo imobiliária.";
  const campo = (id: string) => fonte.campos.find((c) => c.id === id);
  const soImob = (id: string) => Boolean(campo(id)?.soImobiliaria);
  if (!Array.isArray(def.colunas)) return "Escolha as colunas.";
  if (def.colunas.length === 0) return "Escolha ao menos uma coluna.";
  if (def.colunas.length > 30) return "No máximo 30 colunas.";
  if (new Set(def.colunas).size !== def.colunas.length) return "Há coluna repetida.";
  for (const c of def.colunas) {
    if (!campo(c)) return `Coluna desconhecida: ${c}.`;
    if (!imob && soImob(c)) return `A coluna ${c} só existe no modo imobiliária.`;
  }
  const filtros = def.filtros ?? [];
  if (!Array.isArray(filtros)) return "Filtros inválidos.";
  if (filtros.length > 10) return "No máximo 10 filtros.";
  for (const f of filtros) {
    if (!f || typeof f !== "object") return "Filtro inválido.";
    const c = campo(f.campo);
    if (!c) return "Há filtro com coluna desconhecida.";
    if (!imob && c.soImobiliaria) return `A coluna ${c.id} só existe no modo imobiliária.`;
    if (!(OPERADORES_POR_TIPO[c.tipo] as string[]).includes(f.op)) return `Esse filtro não vale para a coluna ${c.id}.`;
    if ((OPERADORES_SEM_VALOR as string[]).includes(f.op)) continue;
    const v = f.valor ?? "";
    if (!v.trim()) return `Informe o valor do filtro de ${c.id}.`;
    if (v.length > 200) return "Valor de filtro muito longo.";
    if (f.op === "ultimos_dias") {
      if (!/^\d{1,4}$/.test(v) || Number(v) < 1 || Number(v) > 3650) return "Informe de 1 a 3650 dias.";
    } else if (c.tipo === "data") {
      if (!dataValidaQualquerAno(v)) return `Data inválida no filtro de ${c.id}.`;
    } else if (c.tipo === "dinheiro" || c.tipo === "numero" || c.tipo === "inteiro") {
      if (!/^-?\d{1,12}(\.\d{1,4})?$/.test(v)) return `Número inválido no filtro de ${c.id}.`;
    }
  }
  const grupo = def.agrupar_por || null;
  if (grupo) {
    const g = campo(grupo);
    if (!g || g.tipo === "dinheiro" || g.tipo === "numero") return "Escolha agrupar por uma coluna de texto, número inteiro ou data.";
    if (!imob && g.soImobiliaria) return `A coluna ${g.id} só existe no modo imobiliária.`;
  }
  const totais = def.totais ?? [];
  if (!Array.isArray(totais)) return "Totais inválidos.";
  if (totais.length > 10) return "No máximo 10 totais.";
  for (const t of totais) {
    const c = campo(t);
    if (!c || !(c.tipo === "dinheiro" || c.tipo === "numero" || c.tipo === "inteiro")) return "Só dá para somar colunas de número ou valor.";
    if (!imob && c.soImobiliaria) return `A coluna ${c.id} só existe no modo imobiliária.`;
  }
  const ord = def.ordenar_por || null;
  if (ord) {
    const ok = grupo ? [grupo, "quantidade", ...totais] : def.colunas;
    if (!ok.includes(ord)) return "Escolha ordenar por uma das colunas do relatório.";
  }
  if (!["asc", "desc"].includes(def.ordem || "asc")) return "Ordem inválida.";
  return null;
}

function dataValidaQualquerAno(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [a, m, d] = v.split("-").map(Number);
  return a >= 1 && m >= 1 && m <= 12 && d >= 1 && d <= diasNoMes(a, m);
}

/** Colunas que o resultado devolve (agrupado: grupo + quantidade + totais). */
export function colunasDoResultado(def: DefinicaoRelatorio): { id: string; rotulo: string; tipo: TipoColuna }[] {
  if (!ehFonte(def.fonte)) return [];
  const f = def.fonte;
  const desc = (id: string) => {
    if (id === "quantidade") return { id, rotulo: "Quantidade", tipo: "inteiro" as TipoColuna };
    const c = campoDaFonte(f, id);
    return { id, rotulo: c?.rotulo ?? id, tipo: (c?.tipo ?? "texto") as TipoColuna };
  };
  if (def.agrupar_por) {
    const g = desc(def.agrupar_por);
    return [{ ...g, tipo: g.tipo === "data" ? "texto" : g.tipo, rotulo: g.tipo === "data" ? `${g.rotulo} (mês)` : g.rotulo }, desc("quantidade"), ...(def.totais ?? []).map(desc)];
  }
  return def.colunas.map(desc);
}

/** Resultado de public.bi_executar como tabela de relatório. */
export function tabelaDoResultado(
  def: DefinicaoRelatorio,
  r: { linhas?: unknown; total?: unknown; totais?: unknown } | null | undefined,
  titulo: string,
  subtitulo?: string,
): TabelaRelatorio & { total: number } {
  const colunas = colunasDoResultado(def);
  const linhas = (Array.isArray(r?.linhas) ? (r?.linhas as unknown[][]) : []).map((l) =>
    colunas.map((c, i) => {
      const v = l?.[i];
      if (v === null || v === undefined) return null;
      if (c.tipo === "dinheiro" || c.tipo === "numero" || c.tipo === "inteiro") return Number(v);
      if (c.tipo === "data") return lerData(v);
      return String(v);
    }),
  );
  const tot = (r?.totais && typeof r.totais === "object" ? r.totais : {}) as Record<string, unknown>;
  const temTotais = colunas.some((c) => c.id in tot);
  const totais = temTotais ? colunas.map((c, i) => (c.id in tot ? num(tot[c.id]) : i === 0 ? "Total" : null)) : undefined;
  return {
    titulo,
    subtitulo,
    colunas: colunas.map((c) => ({ rotulo: c.rotulo, tipo: c.tipo })),
    linhas,
    totais,
    total: num(r?.total),
  };
}

// ---------------------------------------------------------------------------
// Relatórios padrão e envios programados
// ---------------------------------------------------------------------------

export const RELATORIOS_PADRAO = {
  financeiro_mensal: { rotulo: "Financeiro mês a mês", soImobiliaria: false },
  inadimplencia: { rotulo: "Inadimplência (cobranças vencidas)", soImobiliaria: false },
  rentabilidade: { rotulo: "Rentabilidade por imóvel", soImobiliaria: false },
  imoveis_vagos: { rotulo: "Imóveis vagos", soImobiliaria: false },
  imoveis_sem_visitas: { rotulo: "Imóveis sem visitas", soImobiliaria: false },
  previsao: { rotulo: "Previsão de receitas e repasses", soImobiliaria: false },
  imoveis_procura: { rotulo: "Imóveis com maior procura", soImobiliaria: true },
  leads_canais: { rotulo: "Leads por canal de origem", soImobiliaria: true },
  equipe: { rotulo: "Desempenho dos corretores", soImobiliaria: true },
  filiais: { rotulo: "Desempenho por filial", soImobiliaria: true },
} as const;
export type RelatorioPadrao = keyof typeof RELATORIOS_PADRAO;
export const LISTA_PADRAO = Object.keys(RELATORIOS_PADRAO) as RelatorioPadrao[];
export const ehRelatorioPadrao = (v: unknown): v is RelatorioPadrao => typeof v === "string" && Object.prototype.hasOwnProperty.call(RELATORIOS_PADRAO, v);
export const padroesDoModo = (imob: boolean) => LISTA_PADRAO.filter((r) => imob || !RELATORIOS_PADRAO[r].soImobiliaria);

export const FREQUENCIAS = ["diaria", "semanal", "mensal"] as const;
export type Frequencia = (typeof FREQUENCIAS)[number];
export const ROTULO_FREQUENCIA: Record<Frequencia, string> = { diaria: "Todo dia", semanal: "Toda semana", mensal: "Todo mês" };
export const DIAS_SEMANA = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];
export const FORMATOS = ["csv", "xls"] as const;
export type Formato = (typeof FORMATOS)[number];
export const ROTULO_FORMATO: Record<Formato, string> = { csv: "Planilha CSV", xls: "Excel (.xls)" };
/** Explicação do .xls na tela (botão Excel e formato do envio programado). */
export const DICA_XLS =
  "O arquivo Excel é uma “Planilha XML 2003”. Ao abrir, o Excel pode avisar que o formato e a extensão não correspondem: é só clicar em “Sim” para abrir. Se preferir sem aviso, use o CSV (também abre no Excel).";

export const DICA_XLS_CURTA = "No Excel (.xls), o Excel pode avisar que o formato não corresponde à extensão: é só clicar em “Sim”.";

/** Por quantos dias os arquivos dos envios ficam guardados (espelho de privado.bi_dias_guarda). */
export const DIAS_GUARDA_ARQUIVOS = 90;

/** Fuso de Brasília: UTC−3 o ano todo (sem horário de verão desde 2019). */
const OFFSET_SP_MS = 3 * 60 * 60 * 1000;

/**
 * Próxima execução depois de `depois`, no horário de Brasília: diária (na
 * hora), semanal (dia da semana, 0 = domingo) ou mensal (dia 1–28). Mesma
 * conta de privado.bi_proxima_execucao.
 */
export function proximaExecucao(freq: string, diaSemana: number | null, diaMes: number | null, hora: number, depois: Date): Date | null {
  const local = new Date(depois.getTime() - OFFSET_SP_MS);
  const h = Math.min(23, Math.max(0, Number.isFinite(hora) ? hora : 8));
  for (let i = 0; i <= 62; i++) {
    const dia = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + i, h, 0, 0));
    if (dia.getTime() <= local.getTime()) continue;
    const ok =
      freq === "diaria" ||
      (freq === "semanal" && dia.getUTCDay() === (diaSemana ?? 1)) ||
      (freq === "mensal" && dia.getUTCDate() === (diaMes ?? 1));
    if (ok) return new Date(dia.getTime() + OFFSET_SP_MS);
  }
  return null;
}

/** "Toda segunda-feira às 8h" etc. */
export function descreverAgenda(a: { frequencia: string; dia_semana: number | null; dia_mes: number | null; hora: number }): string {
  const h = `${a.hora}h`;
  if (a.frequencia === "semanal") return `Toda ${DIAS_SEMANA[a.dia_semana ?? 1]} às ${h}`.replace("Toda domingo", "Todo domingo").replace("Toda sábado", "Todo sábado");
  if (a.frequencia === "mensal") return `Todo dia ${a.dia_mes ?? 1} às ${h}`;
  return `Todo dia às ${h}`;
}

export const emailValidoBi = (e: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e.trim()) && e.trim().length <= 200;

/** Lista separada por vírgula, ponto e vírgula ou linha → e-mails/telefones limpos (sem repetir). */
export function separarDestinatarios(texto: string | null | undefined): { emails: string[]; whatsapps: string[]; invalidos: string[] } {
  const partes = (texto ?? "")
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const emails = new Set<string>();
  const whatsapps = new Set<string>();
  const invalidos: string[] = [];
  for (const p of partes) {
    if (p.includes("@")) {
      if (emailValidoBi(p)) emails.add(p.toLowerCase());
      else invalidos.push(p);
    } else {
      const d = p.replace(/\D/g, "");
      if (d.length >= 10 && d.length <= 13) whatsapps.add(d);
      else invalidos.push(p);
    }
  }
  return { emails: [...emails], whatsapps: [...whatsapps], invalidos };
}

export function mensagemWhatsApp(nomeRelatorio: string, periodo: string, link: string, imobiliaria: string): string {
  return `Olá! Segue o relatório "${nomeRelatorio}" (${periodo}) de ${imobiliaria}. Baixe aqui (o link vale por 7 dias): ${link}`;
}

export const ROTULO_STATUS_EXECUCAO: Record<string, string> = { enviado: "Enviado", pronto_para_enviar: "Pronto para enviar", erro: "Erro" };
export const COR_STATUS_EXECUCAO = { enviado: "verde", pronto_para_enviar: "amarelo", erro: "vermelho" } as const;

// ---------------------------------------------------------------------------
// Exportação: CSV (Excel brasileiro) e Excel 2003 (XML)
// ---------------------------------------------------------------------------

export type TipoColuna = "texto" | "inteiro" | "numero" | "dinheiro" | "pct" | "data" | "dias";
export type ColunaRelatorio = { rotulo: string; tipo: TipoColuna };
export type Celula = string | number | null;
export type TabelaRelatorio = {
  titulo: string;
  subtitulo?: string;
  colunas: ColunaRelatorio[];
  linhas: Celula[][];
  totais?: Celula[];
  rodape?: string;
};

const fmtNum = (n: number, casas: number) => n.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas, useGrouping: false });

/** Valor da célula como texto para o CSV (números com vírgula, sem separador de milhar; datas dd/mm/aaaa). */
export function celulaCSV(v: Celula | undefined, tipo: TipoColuna): string {
  if (v === null || v === undefined || v === "") return "";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return "";
    if (tipo === "dinheiro") return fmtNum(v, 2);
    if (tipo === "numero" || tipo === "pct") return fmtNum(v, Number.isInteger(v) ? 0 : 2);
    return fmtNum(Math.round(v), 0);
  }
  if (tipo === "data" && /^\d{4}-\d{2}-\d{2}$/.test(v)) return formatarDataBR(v);
  return v;
}

/** Valor da célula para a tela e a impressão (R$, %, dias, datas). */
export function celulaTela(v: Celula | undefined, tipo: TipoColuna): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "number") {
    if (tipo === "dinheiro") return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    if (tipo === "pct") return formatarPct(v);
    if (tipo === "dias") return formatarDias(v);
    if (tipo === "numero") return v.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
    return v.toLocaleString("pt-BR");
  }
  if (tipo === "data" && /^\d{4}-\d{2}-\d{2}$/.test(v)) return formatarDataBR(v);
  return v;
}

const celulaSegura = (s: string) => {
  // Texto que começa com = + - @ vira fórmula no Excel: protege com apóstrofo.
  const t = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[;"\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};

/**
 * CSV para o Excel brasileiro: UTF-8 com BOM (acentos certos), separador ";",
 * vírgula decimal, linhas com CRLF. Título e período nas primeiras linhas.
 */
export function tabelaParaCSV(t: TabelaRelatorio, comCabecalho = true): string {
  const linhas: string[] = [];
  if (comCabecalho) {
    linhas.push(celulaSegura(t.titulo));
    if (t.subtitulo) linhas.push(celulaSegura(t.subtitulo));
    linhas.push("");
  }
  linhas.push(t.colunas.map((c) => celulaSegura(c.rotulo)).join(";"));
  for (const l of t.linhas) linhas.push(t.colunas.map((c, i) => (typeof l[i] === "number" ? celulaCSV(l[i], c.tipo) : celulaSegura(celulaCSV(l[i], c.tipo)))).join(";"));
  if (t.totais) linhas.push(t.colunas.map((c, i) => (typeof t.totais?.[i] === "number" ? celulaCSV(t.totais?.[i], c.tipo) : celulaSegura(celulaCSV(t.totais?.[i], c.tipo)))).join(";"));
  if (t.rodape) linhas.push("", celulaSegura(t.rodape));
  return "﻿" + linhas.join("\r\n");
}

const xmlEsc = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    // Caracteres de controle não são aceitos no XML.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");

function celulaXLS(v: Celula | undefined, tipo: TipoColuna, estiloTexto = ""): string {
  if (v === null || v === undefined || v === "") return "<Cell/>";
  if (typeof v === "number" && Number.isFinite(v)) {
    const estilo = tipo === "dinheiro" ? ' ss:StyleID="m"' : tipo === "pct" || tipo === "numero" ? ' ss:StyleID="n"' : "";
    return `<Cell${estilo}><Data ss:Type="Number">${v}</Data></Cell>`;
  }
  const s = String(v);
  if (tipo === "data" && /^\d{4}-\d{2}-\d{2}$/.test(s)) return `<Cell ss:StyleID="d"><Data ss:Type="DateTime">${s}T00:00:00.000</Data></Cell>`;
  return `<Cell${estiloTexto}><Data ss:Type="String">${xmlEsc(s)}</Data></Cell>`;
}

/** Nome da aba do Excel: até 31 caracteres, sem []:*?/\ . */
export function nomeAbaExcel(titulo: string): string {
  return titulo.replace(/[[\]:*?/\\]/g, " ").slice(0, 31).trim() || "Relatório";
}

/**
 * Excel sem biblioteca: "Planilha XML 2003" (SpreadsheetML), que o Excel e o
 * LibreOffice abrem como planilha, com números, valores e datas de verdade.
 * Salvo como .xls, o Excel pode avisar que o formato é diferente da extensão:
 * é só confirmar.
 */
export function tabelaParaXLS(t: TabelaRelatorio): string {
  const linha = (cel: string[]) => `<Row>${cel.join("")}</Row>`;
  const rows: string[] = [];
  rows.push(linha([`<Cell ss:StyleID="t"><Data ss:Type="String">${xmlEsc(t.titulo)}</Data></Cell>`]));
  if (t.subtitulo) rows.push(linha([`<Cell><Data ss:Type="String">${xmlEsc(t.subtitulo)}</Data></Cell>`]));
  rows.push("<Row/>");
  rows.push(linha(t.colunas.map((c) => `<Cell ss:StyleID="h"><Data ss:Type="String">${xmlEsc(c.rotulo)}</Data></Cell>`)));
  for (const l of t.linhas) rows.push(linha(t.colunas.map((c, i) => celulaXLS(l[i], c.tipo))));
  if (t.totais) rows.push(linha(t.colunas.map((c, i) => celulaXLS(t.totais?.[i], c.tipo, ' ss:StyleID="h"'))));
  if (t.rodape) rows.push("<Row/>", linha([`<Cell><Data ss:Type="String">${xmlEsc(t.rodape)}</Data></Cell>`]));
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<?mso-application progid="Excel.Sheet"?>',
    '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">',
    "<Styles>",
    '<Style ss:ID="t"><Font ss:Bold="1" ss:Size="14"/></Style>',
    '<Style ss:ID="h"><Font ss:Bold="1"/><Interior ss:Color="#EEF2F7" ss:Pattern="Solid"/></Style>',
    '<Style ss:ID="m"><NumberFormat ss:Format="#,##0.00"/></Style>',
    '<Style ss:ID="n"><NumberFormat ss:Format="#,##0.0#"/></Style>',
    '<Style ss:ID="d"><NumberFormat ss:Format="dd/mm/yyyy"/></Style>',
    "</Styles>",
    `<Worksheet ss:Name="${xmlEsc(nomeAbaExcel(t.titulo))}"><Table>`,
    ...rows,
    "</Table></Worksheet></Workbook>",
  ].join("\n");
}

/** Nome de arquivo seguro: "financeiro-mes-a-mes-2026-11-01.csv". */
export function nomeArquivo(titulo: string, sufixo: string, ext: string): string {
  const base = titulo
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  return `${base || "relatorio"}${sufixo ? `-${sufixo}` : ""}.${ext}`;
}

/** Quantos dias tem o intervalo (inclusive). */
export const diasDoIntervalo = (i: Pick<Intervalo, "inicio" | "fim">) => diasEntre(i.inicio, i.fim) + 1;

// ---------------------------------------------------------------------------
// Permissões na tela (espelho de privado.bi_pode_editar / agendar / rodar)
// ---------------------------------------------------------------------------

export function permissoesBi(papel: string, perms: Partial<Record<string, string[]>>): { ver: boolean; editar: boolean; agendar: boolean; rodar: boolean } {
  const ver = papel === "admin" || Boolean(perms.relatorios?.includes("ver"));
  const editar = ver && (papel === "admin" || papel === "gestor" || Boolean(perms.configuracoes?.includes("editar")));
  return { ver, editar, agendar: editar && papel !== "corretor", rodar: ver && papel !== "corretor" };
}
