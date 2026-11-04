/**
 * Regras puras da gestão de condomínios (etapa 23 — módulo opcional, só no
 * modo imobiliária).
 *
 * - frações ideais (a soma fecha 1 ou 100%) — mesma conta de
 *   public.cond_conferir_fracoes no banco;
 * - cotas do mês: base do orçamento rateada por fração/igual/área, fundo de
 *   reserva (% sobre a parte ordinária), parcela de rateios extras, consumo
 *   individual e taxa de reserva de área — mesma conta de
 *   public.cond_gerar_cotas (mude as duas juntas; o teste confere);
 * - situação da cota (multa/juros) reaproveita situacaoFatura() das cobranças;
 * - acordo, inadimplência, fundo de reserva, previsto × realizado, contratos
 *   com fornecedores, reservas, assembleias (quórum, apuração, edital e ata),
 *   comunicados e mensagens prontas.
 * Dinheiro em centavos por dentro (dinheiro.ts); datas ISO (datas.ts).
 */
import { situacaoFatura, type PagamentoFatura, type SituacaoFatura } from "./cobrancas";
import { diasEntre, formatarCompetencia, formatarDataBR, parseData, type DataISO } from "./datas";
import { type Centavos, formatarReais, paraReais, percentual, ratear } from "./dinheiro";

// ---------------------------------------------------------------------------
// Rótulos
// ---------------------------------------------------------------------------

export type Cor = "azul" | "verde" | "amarelo" | "vermelho" | "cinza";

export const TIPOS_UNIDADE = { apartamento: "Apartamento", casa: "Casa", sala: "Sala", loja: "Loja", garagem: "Garagem", outro: "Outro" } as const;
export const SITUACOES_UNIDADE = { ocupada: "Ocupada pelo dono", alugada: "Alugada", vazia: "Vazia", em_obra: "Em obra" } as const;

export const PAPEIS_CONDOMINIO = {
  proprietario: "Condômino (proprietário)",
  inquilino: "Inquilino",
  morador: "Morador",
  sindico: "Síndico",
  subsindico: "Subsíndico",
  conselheiro: "Conselheiro",
} as const;
export type PapelCondominio = keyof typeof PAPEIS_CONDOMINIO;
/** Papéis que exigem unidade. */
export const PAPEIS_DE_UNIDADE: PapelCondominio[] = ["proprietario", "inquilino", "morador"];

export const CRITERIOS_RATEIO = { fracao: "Pela fração ideal", igual: "Igual para todas", area: "Pela área privativa" } as const;
export type CriterioRateio = keyof typeof CRITERIOS_RATEIO;

export const TIPOS_CONTA = { corrente: "Conta corrente", reserva: "Fundo de reserva", fundo: "Outro fundo" } as const;

export const STATUS_COTA = { aberta: "Em aberto", paga: "Paga", cancelada: "Cancelada", renegociada: "Em acordo" } as const;
export const COR_STATUS_COTA: Record<string, Cor> = { aberta: "amarelo", paga: "verde", cancelada: "cinza", renegociada: "azul" };
export const TIPOS_COTA = { ordinaria: "Ordinária", acordo: "Parcela de acordo", avulsa: "Avulsa" } as const;

export const TIPOS_RATEIO = { obra: "Obra", fundo_reserva: "Fundo de reserva", chamada_capital: "Chamada de capital", outro: "Outro" } as const;
export const TIPOS_CONSUMO = { agua: "Água", gas: "Gás", energia: "Energia", outro: "Outro" } as const;

export const TIPOS_OCORRENCIA = {
  manutencao: "Manutenção",
  barulho: "Barulho",
  seguranca: "Segurança",
  sugestao: "Sugestão",
  reclamacao: "Reclamação",
  outro: "Outro",
} as const;
export const STATUS_OCORRENCIA = { aberta: "Aberta", em_andamento: "Em andamento", resolvida: "Resolvida", cancelada: "Cancelada" } as const;
export const COR_STATUS_OCORRENCIA: Record<string, Cor> = { aberta: "amarelo", em_andamento: "azul", resolvida: "verde", cancelada: "cinza" };

export const TIPOS_ASSEMBLEIA = { ordinaria: "Ordinária (AGO)", extraordinaria: "Extraordinária (AGE)" } as const;
export const STATUS_ASSEMBLEIA = {
  rascunho: "Rascunho",
  convocada: "Convocada",
  em_andamento: "Em andamento",
  encerrada: "Encerrada",
  cancelada: "Cancelada",
} as const;
export const COR_STATUS_ASSEMBLEIA: Record<string, Cor> = { rascunho: "cinza", convocada: "azul", em_andamento: "amarelo", encerrada: "verde", cancelada: "cinza" };
export const TIPOS_VOTACAO = {
  simples: "Maioria simples dos votos",
  dois_tercos: "2/3 de todos os condôminos",
  unanimidade: "Unanimidade",
  informativo: "Só informativo (sem voto)",
} as const;
export type TipoVotacao = keyof typeof TIPOS_VOTACAO;
export const PESOS_VOTO = { fracao: "Pela fração ideal", unidade: "Um voto por unidade" } as const;

export const PUBLICOS_COMUNICADO = { todos: "Todos os moradores", bloco: "Um bloco", unidades: "Unidades escolhidas" } as const;

export const STATUS_RESERVA = { pedida: "Pedida", confirmada: "Confirmada", recusada: "Recusada", cancelada: "Cancelada" } as const;
export const COR_STATUS_RESERVA: Record<string, Cor> = { pedida: "amarelo", confirmada: "verde", recusada: "vermelho", cancelada: "cinza" };

export const TIPOS_DOCUMENTO_COND = {
  convencao: "Convenção",
  regimento: "Regimento interno",
  ata: "Ata",
  seguro: "Apólice de seguro",
  avcb: "AVCB (bombeiros)",
  contrato: "Contrato",
  balancete: "Balancete",
  outro: "Outro",
} as const;

export const PERIODICIDADES = {
  mensal: "Mensal",
  bimestral: "Bimestral",
  trimestral: "Trimestral",
  semestral: "Semestral",
  anual: "Anual",
  unico: "Pagamento único",
} as const;
export type Periodicidade = keyof typeof PERIODICIDADES;

export const CATEGORIAS_DESPESA = [
  "Água",
  "Energia",
  "Gás",
  "Pessoal e encargos",
  "Portaria e segurança",
  "Limpeza",
  "Manutenção",
  "Elevadores",
  "Jardinagem",
  "Seguro",
  "Administração",
  "Material de consumo",
  "Taxas bancárias",
  "Obras",
  "Outros",
];
export const CATEGORIAS_RECEITA = ["Cotas condominiais", "Fundo de reserva", "Multa e juros", "Rateio extra", "Reserva de áreas", "Outras receitas"];

/** "Bloco A - 101" ou "101". */
export function nomeUnidade(u: { numero: string; bloco?: { nome: string } | null }): string {
  return u.bloco?.nome ? `${u.bloco.nome} - ${u.numero}` : u.numero;
}

// ---------------------------------------------------------------------------
// Unidades em lote
// ---------------------------------------------------------------------------

/**
 * Lê uma lista de números de unidade: "101-104, 201, 301-302" → 101, 102,
 * 103, 104, 201, 301, 302. Intervalos só com números (até 500 unidades).
 */
export function expandirNumeros(texto: string): string[] {
  const out: string[] = [];
  for (const parte of texto.split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean)) {
    const m = /^(\d+)\s*(?:-|a|até)\s*(\d+)$/i.exec(parte);
    if (m) {
      const [ini, fim] = [Number(m[1]), Number(m[2])];
      if (fim < ini || fim - ini > 500) throw new Error(`Intervalo inválido: ${parte}`);
      for (let n = ini; n <= fim; n++) out.push(String(n).padStart(m[1].length, "0"));
    } else out.push(parte.slice(0, 40));
  }
  const unicos = [...new Set(out)];
  if (unicos.length > 500) throw new Error("No máximo 500 unidades de uma vez.");
  return unicos;
}

// ---------------------------------------------------------------------------
// Frações ideais
// ---------------------------------------------------------------------------

export interface ConferenciaFracoes {
  unidades: number;
  semFracao: number;
  soma: number;
  /** unitaria = soma 1; percentual = soma 100; null = não fecha. */
  escala: "unitaria" | "percentual" | null;
  ok: boolean;
  /** Quanto falta (positivo) ou sobra (negativo) para fechar. */
  diferenca: number;
}

/** A soma das frações fecha 1 (ou 100%)? Tolerância de meio milionésimo por unidade. Igual a public.cond_conferir_fracoes. */
export function conferirFracoes(fracoes: (number | null | undefined)[]): ConferenciaFracoes {
  const n = fracoes.length;
  // Soma em milionésimos (as frações têm 6 casas) para não acumular erro de ponto flutuante.
  const somaMilionesimos = fracoes.reduce<number>((a, f) => a + Math.round((Number(f) || 0) * 1_000_000), 0);
  const soma = somaMilionesimos / 1_000_000;
  const semFracao = fracoes.filter((f) => !(Number(f) > 0)).length;
  const tol = Math.max(1, n * 0.5);
  let escala: ConferenciaFracoes["escala"] = null;
  let alvo = soma > 2 ? 100 : 1;
  if (Math.abs(somaMilionesimos - 1_000_000) <= tol) {
    escala = "unitaria";
    alvo = 1;
  } else if (Math.abs(somaMilionesimos - 100_000_000) <= tol * 100) {
    escala = "percentual";
    alvo = 100;
  }
  return { unidades: n, semFracao, soma, escala, ok: n > 0 && semFracao === 0 && escala !== null, diferenca: (alvo * 1_000_000 - somaMilionesimos) / 1_000_000 };
}

/** Fração em % para mostrar (aceita as duas escalas). */
export function fracaoEmPct(fracao: number | null | undefined, escala: ConferenciaFracoes["escala"]): number | null {
  if (fracao == null) return null;
  return escala === "percentual" ? Number(fracao) : Number(fracao) * 100;
}

// ---------------------------------------------------------------------------
// Rateio e cotas
// ---------------------------------------------------------------------------

export interface UnidadeRateio {
  id: string;
  fracao?: number | null;
  area?: number | null;
}

/** Peso inteiro de cada unidade no critério (fração ×1.000.000, área ×100, igual = 1). Igual a privado.cond_peso. */
export function pesoDoCriterio(u: UnidadeRateio, criterio: CriterioRateio): number {
  if (criterio === "fracao") return Math.round((Number(u.fracao) || 0) * 1_000_000);
  if (criterio === "area") return Math.round((Number(u.area) || 0) * 100);
  return 1;
}

/** Unidades na ordem do banco (pelo id) — o desempate do rateio depende da ordem. */
export const ordenarUnidades = <T extends { id: string }>(us: T[]): T[] => [...us].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

/** Divide um total em centavos entre as unidades pelo critério, sem perder centavo. */
export function ratearPorCriterio(total: Centavos, unidades: UnidadeRateio[], criterio: CriterioRateio): Map<string, Centavos> {
  const us = ordenarUnidades(unidades);
  const pesos = us.map((u) => pesoDoCriterio(u, criterio));
  if (us.length === 0) return new Map();
  if (pesos.some((p) => p <= 0)) throw new Error(criterio === "area" ? "Há unidades sem área privativa." : "Há unidades sem fração ideal.");
  const partes = ratear(total, pesos);
  return new Map(us.map((u, i) => [u.id, partes[i]]));
}

/** Meses entre a primeira competência e esta (0 = mesmo mês). */
export function mesesDesde(primeira: DataISO, competencia: DataISO): number {
  const a = parseData(primeira);
  const b = parseData(competencia);
  return (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
}

export interface RateioExtra {
  id: string;
  descricao: string;
  tipo?: string;
  valorTotal: Centavos;
  parcelas: number;
  primeiraCompetencia: DataISO;
  criterio: CriterioRateio;
  ativo?: boolean;
}

/** Parcela do rateio extra neste mês (k de n, com valor; a sobra dos centavos vai nas primeiras) ou null. */
export function parcelaDoRateio(r: RateioExtra, competencia: DataISO): { k: number; valor: Centavos } | null {
  if (r.ativo === false) return null;
  const k = mesesDesde(r.primeiraCompetencia, competencia) + 1;
  if (k < 1 || k > r.parcelas) return null;
  return { k, valor: ratear(r.valorTotal, Array(r.parcelas).fill(1))[k - 1] };
}

export type TipoItemCota = "ordinaria" | "fundo_reserva" | "rateio_extra" | "consumo" | "reserva_area" | "acordo" | "outro";

export interface ItemCotaCalculado {
  tipo: TipoItemCota;
  descricao: string;
  valor: Centavos;
  rateioId?: string;
  consumoId?: string;
  reservaId?: string;
}

export interface EntradaCotas {
  competencia: DataISO;
  unidades: UnidadeRateio[];
  criterio: CriterioRateio;
  /** Total do mês a ratear (orçamento aprovado ou valor informado). */
  base: Centavos;
  fundoReservaPct: number;
  rateios?: RateioExtra[];
  consumos?: { id: string; unidadeId: string; tipo: string; valor: Centavos }[];
  reservas?: { id: string; unidadeId: string; area: string; data: DataISO; valor: Centavos }[];
}

export interface CotaCalculada {
  unidadeId: string;
  itens: ItemCotaCalculado[];
  total: Centavos;
}

/**
 * Cotas do mês, unidade a unidade (mesma conta de public.cond_gerar_cotas).
 * Lança erro amigável se faltar fração/área no critério.
 */
export function calcularCotas(e: EntradaCotas): CotaCalculada[] {
  if (e.base <= 0) throw new Error("Informe o total das despesas do mês (ou aprove o orçamento do ano).");
  if (e.unidades.length === 0) throw new Error("Cadastre as unidades antes de gerar as cotas.");
  const us = ordenarUnidades(e.unidades);
  const ordinaria = ratearPorCriterio(e.base, us, e.criterio);
  const extras = (e.rateios ?? [])
    .map((r) => ({ r, p: parcelaDoRateio(r, e.competencia) }))
    .filter((x): x is { r: RateioExtra; p: { k: number; valor: Centavos } } => x.p !== null)
    .map(({ r, p }) => ({
      r,
      descricao: r.descricao + (r.parcelas > 1 ? ` (parcela ${p.k}/${r.parcelas})` : ""),
      partes: ratearPorCriterio(p.valor, us, r.criterio),
    }));
  return us.map((u) => {
    const itens: ItemCotaCalculado[] = [];
    const ord = ordinaria.get(u.id) ?? 0;
    itens.push({ tipo: "ordinaria", descricao: `Cota condominial ${formatarCompetencia(e.competencia)}`, valor: ord });
    const fundo = percentual(ord, e.fundoReservaPct);
    if (fundo > 0) itens.push({ tipo: "fundo_reserva", descricao: `Fundo de reserva (${e.fundoReservaPct}%)`, valor: fundo });
    for (const x of extras) {
      const v = x.partes.get(u.id) ?? 0;
      if (v > 0) itens.push({ tipo: "rateio_extra", descricao: x.descricao, valor: v, rateioId: x.r.id });
    }
    for (const c of (e.consumos ?? []).filter((c) => c.unidadeId === u.id && c.valor > 0))
      itens.push({ tipo: "consumo", descricao: `Consumo de ${TIPOS_CONSUMO[c.tipo as keyof typeof TIPOS_CONSUMO]?.toLowerCase() ?? c.tipo}`, valor: c.valor, consumoId: c.id });
    for (const r of (e.reservas ?? []).filter((r) => r.unidadeId === u.id && r.valor > 0 && r.data < e.competencia))
      itens.push({ tipo: "reserva_area", descricao: `Reserva: ${r.area} em ${formatarDataBR(r.data)}`, valor: r.valor, reservaId: r.id });
    return { unidadeId: u.id, itens, total: itens.reduce((a, i) => a + i.valor, 0) };
  });
}

/** Base do mês pelo orçamento aprovado: despesas − outras receitas (valores mensais). */
export function baseDoOrcamento(itens: { tipo: string; valor_mensal: number | string }[]): Centavos {
  return itens.reduce((a, i) => a + (i.tipo === "despesa" ? 1 : -1) * Math.round(Number(i.valor_mensal) * 100), 0);
}

// ---------------------------------------------------------------------------
// Situação da cota, inadimplência e acordo
// ---------------------------------------------------------------------------

/** Multa (uma vez) e juros pro rata dia da cota numa data (mesma conta de privado.cond_encargos). */
export function situacaoCota(
  cota: { valor: Centavos; vencimento: DataISO },
  pagamentos: PagamentoFatura[],
  regras: { multaPct: number; jurosMesPct: number },
  data: DataISO,
): SituacaoFatura {
  return situacaoFatura({ valorTotal: cota.valor, vencimento: cota.vencimento }, pagamentos, { ...regras, carenciaDias: 0 }, data);
}

/** Parcelas do acordo (a sobra dos centavos vai nas primeiras). Igual ao banco. */
export function parcelasAcordo(total: Centavos, n: number): Centavos[] {
  if (!Number.isInteger(n) || n < 1 || n > 60) throw new Error("Parcelas: de 1 a 60.");
  return ratear(total, Array(n).fill(1));
}

/**
 * Números do mês na aba Cotas, sem misturar coisas diferentes:
 * - emitido: as cotas do mês em aberto ou pagas (a renegociada virou parcelas de acordo e fica à parte);
 * - recebido: o dinheiro que entrou (pagamentos não desfeitos, com multa e juros); o desconto fica separado;
 * - em aberto: o saldo das cotas em aberto (o mesmo que a lista mostra).
 */
export function resumoCotasMes(
  cotas: { id: string; status: string; valor: Centavos; abatido: Centavos }[],
  pagamentos: { cotaId: string; valor: Centavos; principal: Centavos; multa: Centavos; juros: Centavos; desconto: Centavos }[],
): {
  emitido: Centavos;
  emitidas: number;
  pagas: number;
  recebido: Centavos;
  encargos: Centavos;
  desconto: Centavos;
  emAberto: Centavos;
  abertas: number;
  renegociadas: number;
  valorRenegociado: Centavos;
} {
  const ids = new Set(cotas.map((q) => q.id));
  const doMes = pagamentos.filter((p) => ids.has(p.cotaId));
  const vale = cotas.filter((q) => q.status === "aberta" || q.status === "paga");
  const abertas = cotas.filter((q) => q.status === "aberta");
  const reneg = cotas.filter((q) => q.status === "renegociada");
  return {
    emitido: vale.reduce((a, q) => a + q.valor, 0),
    emitidas: vale.length,
    pagas: cotas.filter((q) => q.status === "paga").length,
    recebido: doMes.reduce((a, p) => a + p.valor, 0),
    encargos: doMes.reduce((a, p) => a + p.multa + p.juros, 0),
    desconto: doMes.reduce((a, p) => a + p.desconto, 0),
    emAberto: abertas.reduce((a, q) => a + Math.max(0, q.valor - q.abatido), 0),
    abertas: abertas.length,
    renegociadas: reneg.length,
    valorRenegociado: reneg.reduce((a, q) => a + Math.max(0, q.valor - q.abatido), 0),
  };
}

export function faixaAtrasoCota(dias: number): "ate30" | "ate90" | "mais90" {
  return dias <= 30 ? "ate30" : dias <= 90 ? "ate90" : "mais90";
}

/** Mensagem pronta de cobrança (WhatsApp/e-mail) para a unidade em atraso. */
export function mensagemCobranca(o: {
  nome?: string | null;
  condominio: string;
  unidade: string;
  competencias: string[];
  corrigido: number;
  organizacao: string;
  link?: string | null;
}): string {
  const primeiro = (o.nome ?? "").trim().split(/\s+/)[0];
  const meses = o.competencias.length === 1 ? `a cota de ${o.competencias[0]}` : `as cotas de ${o.competencias.join(", ")}`;
  return [
    `Olá${primeiro ? `, ${primeiro}` : ""}! Aqui é da ${o.organizacao}, administradora do ${o.condominio}.`,
    `Consta em aberto ${meses} da unidade ${o.unidade}, que hoje somam ${formatarReais(o.corrigido)} com multa e juros.`,
    o.link ? `Você pode ver a 2ª via e pagar com Pix pelo portal: ${o.link}` : "Podemos enviar a 2ª via ou combinar um acordo.",
    "Se já pagou, por favor desconsidere esta mensagem e nos mande o comprovante.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Livro-caixa e fundo de reserva
// ---------------------------------------------------------------------------

export interface LancamentoCaixa {
  tipo: "receita" | "despesa" | "transferencia";
  valor: Centavos;
  status: string;
  conta_id: string | null;
  conta_destino_id?: string | null;
}

/** Saldo de cada conta: saldo inicial + entradas − saídas (só o que foi pago). */
export function saldosContas(contas: { id: string; saldoInicial: Centavos }[], lancs: LancamentoCaixa[]): Map<string, Centavos> {
  const s = new Map(contas.map((c) => [c.id, c.saldoInicial]));
  for (const l of lancs) {
    if (l.status !== "pago") continue;
    const somar = (id: string | null | undefined, v: Centavos) => {
      if (id && s.has(id)) s.set(id, (s.get(id) ?? 0) + v);
    };
    if (l.tipo === "receita") somar(l.conta_id, l.valor);
    else if (l.tipo === "despesa") somar(l.conta_id, -l.valor);
    else {
      somar(l.conta_id, -l.valor);
      somar(l.conta_destino_id, l.valor);
    }
  }
  return s;
}

/** Saída do fundo de reserva precisa de aprovação registrada (assembleia ou quem aprovou). Igual ao gatilho. */
export function saidaFundoValida(o: { assembleiaId?: string | null; aprovacao?: string | null; papel: string }): string | null {
  if (!o.assembleiaId && !(o.aprovacao ?? "").trim()) return "Saída do fundo de reserva precisa de aprovação: informe a assembleia ou quem aprovou.";
  if (o.papel !== "admin" && o.papel !== "gestor") return "Só administradores e gestores registram saídas do fundo de reserva.";
  return null;
}

// ---------------------------------------------------------------------------
// Orçamento: previsto × realizado
// ---------------------------------------------------------------------------

export interface LinhaPrevistoRealizado {
  categoria: string;
  tipo: "despesa" | "receita";
  previstoMensal: Centavos;
  /** Realizado por mês (índice 0 = janeiro). */
  meses: Centavos[];
  previstoAte: Centavos;
  realizadoAte: Centavos;
  /** Diferença realizado − previsto até o mês de referência. */
  diferenca: Centavos;
  /** % do previsto já usado (null sem previsto). */
  pct: number | null;
}

/**
 * Junta o previsto (orçamento aprovado, valor mensal por categoria) com o
 * realizado (pago por categoria e mês) até o mês de referência (1–12).
 */
export function previstoRealizado(
  previsto: { categoria: string; tipo: string; mensal: number | string }[],
  realizado: { categoria: string; tipo: string; mes: number; valor: number | string }[],
  ateMes: number,
): LinhaPrevistoRealizado[] {
  const linhas = new Map<string, LinhaPrevistoRealizado>();
  const chave = (c: string, t: string) => `${t}|${c}`;
  const linha = (categoria: string, tipo: string) => {
    const k = chave(categoria, tipo);
    let l = linhas.get(k);
    if (!l) {
      l = { categoria, tipo: tipo === "receita" ? "receita" : "despesa", previstoMensal: 0, meses: Array(12).fill(0), previstoAte: 0, realizadoAte: 0, diferenca: 0, pct: null };
      linhas.set(k, l);
    }
    return l;
  };
  for (const p of previsto) linha(p.categoria, p.tipo).previstoMensal += Math.round(Number(p.mensal) * 100);
  for (const r of realizado) if (r.mes >= 1 && r.mes <= 12) linha(r.categoria, r.tipo).meses[r.mes - 1] += Math.round(Number(r.valor) * 100);
  const ate = Math.max(1, Math.min(12, ateMes));
  for (const l of linhas.values()) {
    l.previstoAte = l.previstoMensal * ate;
    l.realizadoAte = l.meses.slice(0, ate).reduce((a, v) => a + v, 0);
    l.diferenca = l.realizadoAte - l.previstoAte;
    l.pct = l.previstoAte > 0 ? Math.round((l.realizadoAte / l.previstoAte) * 1000) / 10 : null;
  }
  return [...linhas.values()].sort((a, b) => (a.tipo === b.tipo ? b.previstoMensal - a.previstoMensal || a.categoria.localeCompare(b.categoria) : a.tipo === "despesa" ? -1 : 1));
}

// ---------------------------------------------------------------------------
// Contratos com fornecedores
// ---------------------------------------------------------------------------

const PASSO: Record<Periodicidade, number> = { mensal: 1, bimestral: 2, trimestral: 3, semestral: 6, anual: 12, unico: 0 };

/** O contrato gera despesa nesta competência? Igual a privado.cond_contrato_no_mes. */
export function contratoNoMes(c: { periodicidade: Periodicidade; inicio: DataISO; fim?: DataISO | null }, competencia: DataISO): boolean {
  const meses = mesesDesde(c.inicio.slice(0, 7) + "-01", competencia.slice(0, 7) + "-01");
  if (meses < 0) return false;
  if (c.fim && competencia.slice(0, 7) > c.fim.slice(0, 7)) return false;
  if (c.periodicidade === "unico") return meses === 0;
  return meses % (PASSO[c.periodicidade] || 1) === 0;
}

/** Validade (contrato, documento, AVCB, seguro): vencido, vence em breve (até `dias`) ou ok. */
export function situacaoValidade(validade: DataISO | null | undefined, hoje: DataISO, dias = 60): { situacao: "vencido" | "vence" | "ok" | null; dias: number | null } {
  if (!validade) return { situacao: null, dias: null };
  const d = diasEntre(hoje, validade);
  return { situacao: d < 0 ? "vencido" : d <= dias ? "vence" : "ok", dias: d };
}

export const COR_VALIDADE: Record<string, Cor> = { vencido: "vermelho", vence: "amarelo", ok: "verde" };

// ---------------------------------------------------------------------------
// Reservas de áreas comuns
// ---------------------------------------------------------------------------

export interface RegrasArea {
  antecedencia_min_horas: number;
  antecedencia_max_dias: number;
  duracao_max_horas: number;
}

/** Regras da área para pedir pelo portal (igual a public.cond_portal_reservar). Datas em ms. */
export function validarReserva(area: RegrasArea, inicio: number, fim: number, agora: number): string | null {
  if (!Number.isFinite(inicio) || !Number.isFinite(fim) || fim <= inicio) return "O fim da reserva precisa ser depois do início.";
  if (fim - inicio > area.duracao_max_horas * 3_600_000) return `A reserva pode durar no máximo ${area.duracao_max_horas} hora(s).`;
  if (inicio < agora + area.antecedencia_min_horas * 3_600_000) return `Peça com pelo menos ${area.antecedencia_min_horas} hora(s) de antecedência.`;
  if (inicio > agora + area.antecedencia_max_dias * 86_400_000) return `Reservas só até ${area.antecedencia_max_dias} dias à frente.`;
  return null;
}

/** Conflito de horário (intervalos [início, fim) se cruzam). Igual ao gatilho do banco. */
export function conflitaReserva(existentes: { inicio: number; fim: number; status: string }[], inicio: number, fim: number): boolean {
  return existentes.some((r) => (r.status === "pedida" || r.status === "confirmada") && r.inicio < fim && inicio < r.fim);
}

// ---------------------------------------------------------------------------
// Assembleias: quórum, apuração, edital e ata
// ---------------------------------------------------------------------------

export interface ItemPauta {
  id: string;
  ordem: number;
  titulo: string;
  descricao?: string | null;
  tipo_votacao: TipoVotacao;
  opcoes: string[];
}

export interface Quorum {
  unidades: number;
  presentes: number;
  pctUnidades: number;
  pesoTotal: number;
  pesoPresente: number;
  pctPeso: number;
}

/** Peso de uma unidade: fração ideal ou 1. */
export const pesoVoto = (fracao: number | null | undefined, peso: "fracao" | "unidade") => (peso === "fracao" ? Number(fracao) || 0 : 1);

export function quorum(unidades: { id: string; fracao?: number | null }[], presentes: string[], peso: "fracao" | "unidade"): Quorum {
  const set = new Set(presentes);
  const pesoTotal = unidades.reduce((a, u) => a + pesoVoto(u.fracao, peso), 0);
  const pesoPresente = unidades.filter((u) => set.has(u.id)).reduce((a, u) => a + pesoVoto(u.fracao, peso), 0);
  const n = unidades.filter((u) => set.has(u.id)).length;
  return {
    unidades: unidades.length,
    presentes: n,
    pctUnidades: unidades.length ? Math.round((n / unidades.length) * 1000) / 10 : 0,
    pesoTotal,
    pesoPresente,
    pctPeso: pesoTotal > 0 ? Math.round((pesoPresente / pesoTotal) * 1000) / 10 : 0,
  };
}

export interface ApuracaoItem {
  itemId: string;
  totais: { opcao: string; votos: number; peso: number; pct: number }[];
  /** null = informativo ou sem votos. */
  aprovado: boolean | null;
  vencedora: string | null;
  texto: string;
}

const ehSimNao = (opcoes: string[]) => opcoes.some((o) => /^sim$/i.test(o)) && opcoes.some((o) => /^n[aã]o$/i.test(o));

/**
 * Apura um item:
 * - simples: Sim > Não entre os votos dados (abstenção não conta);
 * - 2/3: Sim ≥ 2/3 do peso de TODOS os condôminos;
 * - unanimidade: Sim = peso de todos;
 * - opções livres: vence a de maior peso.
 */
export function apurarItem(item: ItemPauta, votos: { opcao: string; peso: number }[], pesoTotal: number): ApuracaoItem {
  const totais = item.opcoes.map((opcao) => {
    const vs = votos.filter((v) => v.opcao === opcao);
    return { opcao, votos: vs.length, peso: vs.reduce((a, v) => a + Number(v.peso), 0), pct: 0 };
  });
  const pesoVotos = totais.reduce((a, t) => a + t.peso, 0);
  for (const t of totais) t.pct = pesoVotos > 0 ? Math.round((t.peso / pesoVotos) * 1000) / 10 : 0;
  if (item.tipo_votacao === "informativo") return { itemId: item.id, totais, aprovado: null, vencedora: null, texto: "Item informativo (sem votação)." };
  if (votos.length === 0) return { itemId: item.id, totais, aprovado: null, vencedora: null, texto: "Sem votos." };
  const eps = 1e-9;
  if (ehSimNao(item.opcoes)) {
    const sim = totais.find((t) => /^sim$/i.test(t.opcao))?.peso ?? 0;
    const nao = totais.find((t) => /^n[aã]o$/i.test(t.opcao))?.peso ?? 0;
    let aprovado: boolean;
    if (item.tipo_votacao === "dois_tercos") aprovado = sim + eps >= (2 / 3) * pesoTotal;
    else if (item.tipo_votacao === "unanimidade") aprovado = pesoTotal > 0 && sim + eps >= pesoTotal;
    else aprovado = sim > nao;
    return { itemId: item.id, totais, aprovado, vencedora: aprovado ? "Sim" : "Não", texto: aprovado ? "Aprovado" : "Não aprovado" };
  }
  const ordem = [...totais].sort((a, b) => b.peso - a.peso);
  const empate = ordem.length > 1 && Math.abs(ordem[0].peso - ordem[1].peso) < eps;
  return { itemId: item.id, totais, aprovado: null, vencedora: empate ? null : ordem[0].opcao, texto: empate ? "Empate" : `Mais votada: ${ordem[0].opcao}` };
}

const dataHora = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

/** Edital de convocação (texto editável). */
export function textoEdital(o: {
  condominio: string;
  cnpj?: string | null;
  tipo: keyof typeof TIPOS_ASSEMBLEIA;
  data: string;
  segundaChamada?: string | null;
  local?: string | null;
  linkOnline?: string | null;
  itens: Pick<ItemPauta, "ordem" | "titulo">[];
  sindico?: string | null;
  votoPortal?: boolean;
}): string {
  const tipo = o.tipo === "ordinaria" ? "ORDINÁRIA" : "EXTRAORDINÁRIA";
  const linhas = [
    `EDITAL DE CONVOCAÇÃO — ASSEMBLEIA GERAL ${tipo}`,
    `${o.condominio}${o.cnpj ? ` — CNPJ ${o.cnpj}` : ""}`,
    "",
    `Ficam convocados os senhores condôminos para a Assembleia Geral ${tipo.toLowerCase()} a realizar-se em ${dataHora(o.data)}, em primeira chamada${
      o.segundaChamada ? `, ou em ${dataHora(o.segundaChamada)}, em segunda chamada, com qualquer número de presentes` : ""
    }${o.local ? `, no local: ${o.local}` : ""}${o.linkOnline ? `${o.local ? " ou" : ","} de forma online pelo link ${o.linkOnline}` : ""}, para deliberar sobre a seguinte ordem do dia:`,
    "",
    ...o.itens.map((i) => `${i.ordem}. ${i.titulo}`),
    "",
    "Os condôminos poderão fazer-se representar por procuração. Só votam os condôminos em dia com as cotas, conforme a convenção.",
    o.votoPortal ? "Os itens com votação também poderão ser votados pelo portal do condômino durante a assembleia." : "",
    "",
    o.sindico ? `${o.sindico}\nSíndico(a)` : "A administração",
  ];
  return linhas.filter((l, i, a) => !(l === "" && a[i - 1] === "")).join("\n");
}

/** Ata (rascunho editável) com presença, quórum e resultado de cada item. */
export function textoAta(o: {
  condominio: string;
  tipo: keyof typeof TIPOS_ASSEMBLEIA;
  data: string;
  local?: string | null;
  quorum: Quorum;
  peso: "fracao" | "unidade";
  itens: ItemPauta[];
  apuracao: ApuracaoItem[];
  presentes: string[];
}): string {
  const tipo = o.tipo === "ordinaria" ? "ORDINÁRIA" : "EXTRAORDINÁRIA";
  const q = o.quorum;
  const linhas = [
    `ATA DA ASSEMBLEIA GERAL ${tipo} — ${o.condominio}`,
    "",
    `Aos ${dataHora(o.data)}${o.local ? `, em ${o.local}` : ""}, reuniram-se os condôminos do ${o.condominio}. Estiveram presentes (ou representadas) ${q.presentes} de ${q.unidades} unidades (${q.pctUnidades.toLocaleString("pt-BR")}%)${
      o.peso === "fracao" ? `, somando ${q.pctPeso.toLocaleString("pt-BR")}% das frações ideais` : ""
    }.`,
    o.presentes.length ? `Unidades presentes: ${o.presentes.join(", ")}.` : "",
    "",
    "Deliberações:",
  ];
  for (const it of [...o.itens].sort((a, b) => a.ordem - b.ordem)) {
    const ap = o.apuracao.find((a) => a.itemId === it.id);
    linhas.push(`${it.ordem}. ${it.titulo}`);
    if (it.descricao) linhas.push(`   ${it.descricao}`);
    if (ap && it.tipo_votacao !== "informativo") {
      const det = ap.totais
        .filter((t) => t.votos > 0)
        .map((t) => `${t.opcao}: ${t.votos} voto(s)${o.peso === "fracao" ? ` (${(t.peso * (q.pesoTotal > 2 ? 1 : 100)).toLocaleString("pt-BR", { maximumFractionDigits: 4 })}% das frações)` : ""}`)
        .join("; ");
      linhas.push(`   Resultado: ${ap.texto}${det ? ` — ${det}` : ""}.`);
    }
  }
  linhas.push("", "Nada mais havendo a tratar, a assembleia foi encerrada, e eu, secretário(a), lavrei a presente ata, que vai assinada pelo presidente e por mim.", "", "Presidente: ____________________    Secretário(a): ____________________");
  return linhas.filter((l, i, a) => !(l === "" && a[i - 1] === "")).join("\n");
}

// ---------------------------------------------------------------------------
// Comunicados e portal
// ---------------------------------------------------------------------------

/** O comunicado chega a esta unidade? (todos, bloco da unidade ou unidade escolhida). */
export function comunicadoParaUnidade(c: { publico: string; bloco_id?: string | null; unidades?: string[] | null }, u: { id: string; bloco_id?: string | null }): boolean {
  if (c.publico === "todos") return true;
  if (c.publico === "bloco") return Boolean(c.bloco_id) && c.bloco_id === u.bloco_id;
  return (c.unidades ?? []).includes(u.id);
}

export function mensagemComunicado(o: { condominio: string; titulo: string; texto: string; link?: string | null }): string {
  return [`${o.condominio}: ${o.titulo}`, "", o.texto.trim(), o.link ? `\nVeja no portal do condômino: ${o.link}` : ""].join("\n").trim();
}

export function mensagemPortalCondominio(o: { nome: string; condominio: string; link: string; organizacao: string; dica?: string | null }): string {
  const primeiro = o.nome.trim().split(/\s+/)[0];
  return [
    `Olá${primeiro ? `, ${primeiro}` : ""}! Este é o seu link pessoal do portal do condômino do ${o.condominio} (${o.organizacao}):`,
    o.link,
    `Lá você vê suas cotas (2ª via e Pix), comunicados, reservas, ocorrências, assembleias e a prestação de contas.${o.dica ? ` Para entrar, digite ${o.dica}.` : ""}`,
    "O link é só seu: não compartilhe.",
  ].join("\n");
}

/** Seções do portal do condômino. */
export const SECOES_PORTAL_COND = [
  { slug: "", rotulo: "Início" },
  { slug: "cotas", rotulo: "Minhas cotas" },
  { slug: "comunicados", rotulo: "Comunicados" },
  { slug: "reservas", rotulo: "Reservas" },
  { slug: "ocorrencias", rotulo: "Ocorrências" },
  { slug: "assembleias", rotulo: "Assembleias" },
  { slug: "documentos", rotulo: "Documentos" },
  { slug: "contas", rotulo: "Prestação de contas" },
] as const;

/** Txid do Pix da cota: COND + número. */
export const txidCota = (numero: number | string) => `COND${numero}`;

/** Total para pagar hoje (saldo + multa + juros), em reais. */
export const totalHoje = (c: { saldo: number; multa: number; juros: number }) => paraReais(Math.round(Number(c.saldo) * 100) + Math.round(Number(c.multa) * 100) + Math.round(Number(c.juros) * 100));

/**
 * Célula de CSV (Excel, separador ";"). Texto que começa com = + - @ (ou tab/CR)
 * vira fórmula no Excel — nomes de pessoas, descrições e categorias podem vir de
 * formulário —, então ganha um apóstrofo na frente (mesma regra do paraCSV do
 * financeiro). Valores em reais/números que o próprio sistema formatou
 * ("-R$ 50,00", "-12,5%") ficam como estão.
 */
export function celulaCsvCond(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "";
  let s = String(v);
  const numeroNosso = /^-\s?(R\$\s?)?[\d.]+(,\d+)?%?$/u.test(s);
  if (/^[=+\-@\t\r]/.test(s) && !numeroNosso) s = `'${s}`;
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
