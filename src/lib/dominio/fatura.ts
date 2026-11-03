import { type Centavos, percentual, ratear } from "./dinheiro";
import {
  type DataISO,
  diaNoMes,
  diasEntre,
  diasNoMes,
  fimDoMes,
  inicioDoMes,
  parseData,
  somarMeses,
} from "./datas";
import { calcularIRRF } from "./irrf";

export type DestinoItem = "proprietario" | "imobiliaria" | "terceiro";
export type TipoItem =
  | "aluguel"
  | "encargo"
  | "multa"
  | "juros"
  | "desconto"
  | "irrf"
  | "outro";

export interface ItemFatura {
  descricao: string;
  tipo: TipoItem;
  /** Positivo para cobrança, negativo para desconto/retenção. */
  valor: Centavos;
  destino: DestinoItem;
}

export type Modalidade = "antecipado" | "vencido";

export interface EncargoRecorrente {
  descricao: string;
  valor: Centavos;
  destino: DestinoItem;
  /** Primeira competência (AAAA-MM-01) em que o encargo é cobrado. */
  inicio: DataISO | null;
  /** Última competência (inclusive) em que o encargo é cobrado; null = indeterminado. */
  fim: DataISO | null;
}

export interface ParteProprietario {
  pessoaId: string;
  percentual: number;
  tipoPessoa: "PF" | "PJ";
}

export interface ContratoParaFatura {
  dataInicio: DataISO;
  dataFim: DataISO | null;
  valorAluguel: Centavos;
  diaVencimento: number;
  modalidade: Modalidade;
  taxaAdministracaoPct: number;
  locatarioTipoPessoa: "PF" | "PJ";
  proprietarios: ParteProprietario[];
  encargos: EncargoRecorrente[];
  /** Desconto por pontualidade em % do aluguel (informativo na fatura). */
  descontoPontualidadePct?: number;
  /** Carência: nos primeiros N meses o aluguel tem desconto (100% = isento). */
  carenciaMeses?: number;
  carenciaDescontoPct?: number;
  /** Descontos temporários por competência (valor em centavos ou % do aluguel). */
  descontos?: DescontoTemporario[];
}

export interface DescontoTemporario {
  inicio: DataISO;
  fim: DataISO | null;
  tipo: "valor" | "pct";
  /** Centavos (tipo valor) ou percentual (tipo pct). */
  valor: number;
  motivo: string | null;
}

/** Desconto por pagar até o vencimento (centavos), sobre o aluguel. */
export function descontoPontualidade(aluguel: Centavos, pct: number, pagoEm: DataISO, vencimento: DataISO): Centavos {
  if (!pct || pct <= 0 || pagoEm > vencimento) return 0;
  return percentual(aluguel, Math.min(100, pct));
}

export interface FaturaGerada {
  competencia: DataISO;
  vencimento: DataISO;
  periodoInicio: DataISO;
  periodoFim: DataISO;
  itens: ItemFatura[];
  total: Centavos;
  /** IRRF retido por proprietário (pessoaId → centavos), quando aplicável. */
  irrfPorProprietario: Record<string, Centavos>;
}

function maxData(a: DataISO, b: DataISO): DataISO {
  return a > b ? a : b;
}
function minData(a: DataISO, b: DataISO): DataISO {
  return a < b ? a : b;
}

/**
 * Monta a fatura de uma competência (mês de uso do imóvel).
 *
 * - Aluguel proporcional (pro rata die) quando o contrato começa ou termina
 *   no meio do mês.
 * - Vencimento: no próprio mês da competência (antecipado) ou no mês seguinte
 *   (vencido), nunca antes do início do contrato.
 * - Encargos recorrentes (IPTU, condomínio, seguro…) dentro da vigência.
 * - Retenção de IRRF quando o locatário é PJ e o proprietário é PF.
 *
 * Retorna null se o contrato não cobre nenhum dia da competência.
 */
export function gerarFatura(contrato: ContratoParaFatura, competencia: DataISO): FaturaGerada | null {
  const comp = inicioDoMes(competencia);
  const ultimoDia = fimDoMes(comp);
  const periodoInicio = maxData(comp, contrato.dataInicio);
  const periodoFim = contrato.dataFim ? minData(ultimoDia, contrato.dataFim) : ultimoDia;
  if (periodoFim < periodoInicio) return null;

  const dt = parseData(comp);
  const totalDias = diasNoMes(dt.getUTCFullYear(), dt.getUTCMonth() + 1);
  const diasUso = diasEntre(periodoInicio, periodoFim) + 1;
  const aluguel =
    diasUso >= totalDias ? contrato.valorAluguel : Math.round((contrato.valorAluguel * diasUso) / totalDias);

  const itens: ItemFatura[] = [];
  const mesTxt = `${comp.slice(5, 7)}/${comp.slice(0, 4)}`;
  itens.push({
    descricao:
      diasUso >= totalDias
        ? `Aluguel ${mesTxt}`
        : `Aluguel ${mesTxt} (proporcional ${diasUso}/${totalDias} dias)`,
    tipo: "aluguel",
    valor: aluguel,
    destino: "proprietario",
  });

  // Carência: desconto no aluguel nos primeiros meses do contrato.
  let descontado = 0;
  if (contrato.carenciaMeses && contrato.carenciaMeses > 0 && comp < somarMeses(inicioDoMes(contrato.dataInicio), contrato.carenciaMeses)) {
    const pct = Math.min(100, Math.max(0, contrato.carenciaDescontoPct ?? 100));
    const d = percentual(aluguel, pct);
    if (d > 0) {
      descontado += d;
      itens.push({ descricao: pct >= 100 ? "Carência (aluguel isento)" : `Carência (${pct}% de desconto)`, tipo: "desconto", valor: -d, destino: "proprietario" });
    }
  }
  // Descontos temporários combinados (nunca passam do aluguel).
  for (const d of contrato.descontos ?? []) {
    if (inicioDoMes(d.inicio) > comp || (d.fim && inicioDoMes(d.fim) < comp)) continue;
    const bruto = d.tipo === "pct" ? percentual(aluguel, d.valor) : Math.round(d.valor);
    const v = Math.min(bruto, aluguel - descontado);
    if (v <= 0) continue;
    descontado += v;
    itens.push({ descricao: `Desconto${d.motivo ? ` — ${d.motivo}` : ""}`, tipo: "desconto", valor: -v, destino: "proprietario" });
  }

  for (const e of contrato.encargos) {
    if (e.inicio && inicioDoMes(e.inicio) > comp) continue;
    if (e.fim && inicioDoMes(e.fim) < comp) continue;
    if (e.valor === 0) continue;
    itens.push({ descricao: e.descricao, tipo: "encargo", valor: e.valor, destino: e.destino });
  }

  const irrfPorProprietario: Record<string, Centavos> = {};
  if (contrato.locatarioTipoPessoa === "PJ" && contrato.proprietarios.length > 0) {
    const partesAluguel = ratear(aluguel, contrato.proprietarios.map((p) => p.percentual));
    const taxa = percentual(aluguel, contrato.taxaAdministracaoPct);
    const partesTaxa = ratear(taxa, contrato.proprietarios.map((p) => p.percentual));
    contrato.proprietarios.forEach((p, i) => {
      if (p.tipoPessoa !== "PF") return;
      const irrf = calcularIRRF(partesAluguel[i] - partesTaxa[i]);
      if (irrf > 0) {
        irrfPorProprietario[p.pessoaId] = irrf;
        itens.push({
          descricao: "IRRF retido pelo locatário (PJ)",
          tipo: "irrf",
          valor: -irrf,
          destino: "proprietario",
        });
      }
    });
  }

  const mesVenc = contrato.modalidade === "vencido" ? somarMeses(comp, 1) : comp;
  const vencimento = maxData(diaNoMes(mesVenc, contrato.diaVencimento), contrato.dataInicio);

  return {
    competencia: comp,
    vencimento,
    periodoInicio,
    periodoFim,
    itens,
    total: itens.reduce((s, i) => s + i.valor, 0),
    irrfPorProprietario,
  };
}

/** Competências (AAAA-MM-01) cobertas pelo contrato até `ate` (inclusive). */
export function competenciasDoContrato(dataInicio: DataISO, dataFim: DataISO | null, ate: DataISO): DataISO[] {
  const lista: DataISO[] = [];
  let c = inicioDoMes(dataInicio);
  const limite = inicioDoMes(dataFim && dataFim < ate ? dataFim : ate);
  while (c <= limite) {
    lista.push(c);
    c = somarMeses(c, 1);
  }
  return lista;
}
