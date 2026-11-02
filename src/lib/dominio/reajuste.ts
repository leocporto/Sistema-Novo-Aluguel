import { type Centavos } from "./dinheiro";
import { type DataISO, inicioDoMes, somarMeses } from "./datas";

export const INDICES = ["IGPM", "IPCA", "INPC", "IVAR", "IGPDI"] as const;
export type Indice = (typeof INDICES)[number];

export const NOME_INDICE: Record<Indice, string> = {
  IGPM: "IGP-M (FGV)",
  IPCA: "IPCA (IBGE)",
  INPC: "INPC (IBGE)",
  IVAR: "IVAR (FGV)",
  IGPDI: "IGP-DI (FGV)",
};

export interface VariacaoMensal {
  /** Primeiro dia do mês de referência (AAAA-MM-01). */
  competencia: DataISO;
  /** Variação do mês em % (pode ser negativa). */
  variacaoPct: number;
}

/**
 * Meses de referência usados no reajuste com aniversário em `dataReajuste`:
 * os N meses anteriores ao mês do aniversário (ex.: aniversário em 03/2026,
 * período de 12 meses usa 03/2025 a 02/2026), que é a prática de mercado
 * quando o índice do mês do aniversário ainda não foi divulgado.
 */
export function mesesDoPeriodo(dataReajuste: DataISO, periodicidadeMeses = 12): DataISO[] {
  const fim = somarMeses(inicioDoMes(dataReajuste), -1);
  const meses: DataISO[] = [];
  for (let i = periodicidadeMeses - 1; i >= 0; i--) meses.push(somarMeses(fim, -i));
  return meses;
}

/** Variação acumulada (composta) em %, a partir das variações mensais. */
export function acumular(variacoes: number[]): number {
  const fator = variacoes.reduce((f, v) => f * (1 + v / 100), 1);
  return (fator - 1) * 100;
}

export interface ResultadoReajuste {
  percentualAcumulado: number;
  valorAnterior: Centavos;
  valorNovo: Centavos;
  mesesFaltantes: DataISO[];
}

/**
 * Calcula o novo aluguel. Se faltarem índices de algum mês do período, o
 * resultado lista os meses faltantes para que o usuário os cadastre antes de
 * aplicar. Variação acumulada negativa não reduz o aluguel por padrão
 * (`permitirReducao = false`), prática comum em contratos residenciais.
 */
export function calcularReajuste(params: {
  valorAtual: Centavos;
  dataReajuste: DataISO;
  periodicidadeMeses?: number;
  variacoes: VariacaoMensal[];
  permitirReducao?: boolean;
}): ResultadoReajuste {
  const meses = mesesDoPeriodo(params.dataReajuste, params.periodicidadeMeses ?? 12);
  const mapa = new Map(params.variacoes.map((v) => [v.competencia.slice(0, 7), v.variacaoPct]));
  const faltantes = meses.filter((m) => !mapa.has(m.slice(0, 7)));
  const usadas = meses.filter((m) => mapa.has(m.slice(0, 7))).map((m) => mapa.get(m.slice(0, 7))!);
  let pct = acumular(usadas);
  if (pct < 0 && !params.permitirReducao) pct = 0;
  const pctArredondado = Math.round(pct * 10000) / 10000;
  return {
    percentualAcumulado: pctArredondado,
    valorAnterior: params.valorAtual,
    valorNovo: Math.round(params.valorAtual * (1 + pctArredondado / 100)),
    mesesFaltantes: faltantes,
  };
}

/** Próxima data de aniversário de reajuste após `ultimaBase` (início ou último reajuste). */
export function proximoReajuste(ultimaBase: DataISO, periodicidadeMeses = 12): DataISO {
  return somarMeses(ultimaBase, periodicidadeMeses);
}
