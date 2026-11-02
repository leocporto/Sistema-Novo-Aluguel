import { type Centavos, percentual } from "./dinheiro";
import { type DataISO, diasEntre } from "./datas";

export interface ParametrosAtraso {
  /** Valor sobre o qual incidem multa e juros, em centavos. */
  valor: Centavos;
  vencimento: DataISO;
  pagamento: DataISO;
  /** Multa moratória em % (cobrada uma única vez). */
  multaPct: number;
  /** Juros de mora simples em % ao mês, calculados pro rata die (mês de 30 dias). */
  jurosMesPct: number;
  /** Dias de tolerância após o vencimento sem cobrança de encargos. */
  carenciaDias?: number;
}

export interface ResultadoAtraso {
  diasAtraso: number;
  multa: Centavos;
  juros: Centavos;
  total: Centavos;
}

/**
 * Calcula multa e juros de mora sobre uma fatura paga após o vencimento.
 * Se o pagamento ocorrer dentro da carência, nada é cobrado; fora dela, os
 * juros contam desde o vencimento original.
 */
export function calcularAtraso(p: ParametrosAtraso): ResultadoAtraso {
  const dias = diasEntre(p.vencimento, p.pagamento);
  const carencia = p.carenciaDias ?? 0;
  if (dias <= carencia || p.valor <= 0) {
    return { diasAtraso: Math.max(0, dias), multa: 0, juros: 0, total: p.valor };
  }
  const multa = percentual(p.valor, p.multaPct);
  const juros = Math.round((p.valor * (p.jurosMesPct / 100) * dias) / 30);
  return { diasAtraso: dias, multa, juros, total: p.valor + multa + juros };
}
