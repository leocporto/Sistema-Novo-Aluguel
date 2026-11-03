import { type Centavos } from "./dinheiro";
import { type DataISO, diasEntre, diasNoMes, mesesEntre, parseData, somarDias, somarMeses } from "./datas";

export interface ParametrosRescisao {
  valorAluguel: Centavos;
  dataInicio: DataISO;
  prazoMeses: number;
  dataEntrega: DataISO;
  /** Último dia já coberto por fatura paga (o saldo é cobrado a partir do dia seguinte). */
  pagoAte: DataISO;
  /** Multa compensatória integral prevista no contrato, em nº de aluguéis (ex.: 3). */
  multaAlugueis: number;
  /** Isenção legal (art. 4º, par. único, Lei 8.245/91 — transferência de emprego) ou acordo. */
  isentarMulta?: boolean;
  /** Em contrato por prazo indeterminado, o locatário deu aviso prévio de 30 dias? */
  avisoPrevioCumprido?: boolean;
  /** Outros débitos em aberto (faturas, reparos da vistoria de saída…). */
  debitosPendentes?: Centavos;
  /** Caução a devolver/abater. */
  caucao?: Centavos;
}

export interface ResultadoRescisao {
  diasSaldo: number;
  saldoAluguel: Centavos;
  mesesCumpridos: number;
  mesesRestantes: number;
  multa: Centavos;
  multaFundamento: string;
  debitosPendentes: Centavos;
  caucao: Centavos;
  /** Positivo: locatário deve pagar. Negativo: valor a devolver ao locatário. */
  totalDevido: Centavos;
}

/**
 * Cálculo de rescisão antecipada pelo locatário.
 * Multa proporcional ao período restante (art. 4º da Lei 8.245/91):
 *   multa = aluguel × nº de aluguéis × (meses restantes ÷ prazo total).
 * Após o fim do prazo (contrato indeterminado) não há multa compensatória;
 * sem aviso prévio de 30 dias, cobra-se um aluguel (art. 6º).
 */
export function calcularRescisao(p: ParametrosRescisao): ResultadoRescisao {
  // Saldo de aluguel pro rata do dia seguinte ao último pago até a entrega.
  let saldo = 0;
  let diasSaldo = 0;
  let cursor = somarDias(p.pagoAte, 1);
  while (cursor <= p.dataEntrega) {
    const dt = parseData(cursor);
    const ano = dt.getUTCFullYear();
    const mes = dt.getUTCMonth() + 1;
    const fimMes = `${cursor.slice(0, 7)}-${String(diasNoMes(ano, mes)).padStart(2, "0")}`;
    const fimTrecho = fimMes < p.dataEntrega ? fimMes : p.dataEntrega;
    const dias = diasEntre(cursor, fimTrecho) + 1;
    saldo += Math.round((p.valorAluguel * dias) / diasNoMes(ano, mes));
    diasSaldo += dias;
    cursor = somarDias(fimTrecho, 1);
  }

  const fimPrazo = somarMeses(p.dataInicio, p.prazoMeses);
  const mesesCumpridos = Math.min(p.prazoMeses, mesesEntre(p.dataInicio, p.dataEntrega));
  const mesesRestantes = Math.max(0, p.prazoMeses - mesesCumpridos);

  let multa = 0;
  let fundamento: string;
  if (p.isentarMulta) {
    fundamento = "Isento de multa";
  } else if (p.dataEntrega >= fimPrazo) {
    if (p.avisoPrevioCumprido === false) {
      multa = p.valorAluguel;
      fundamento = "Prazo indeterminado sem aviso prévio de 30 dias: 1 aluguel (art. 6º)";
    } else {
      fundamento = "Prazo contratual cumprido: sem multa";
    }
  } else {
    multa = Math.round((p.valorAluguel * p.multaAlugueis * mesesRestantes) / p.prazoMeses);
    fundamento = `Multa proporcional: ${p.multaAlugueis} aluguel(is) × ${mesesRestantes}/${p.prazoMeses} meses restantes (art. 4º)`;
  }

  const debitos = p.debitosPendentes ?? 0;
  const caucao = p.caucao ?? 0;
  return {
    diasSaldo,
    saldoAluguel: saldo,
    mesesCumpridos,
    mesesRestantes,
    multa,
    multaFundamento: fundamento,
    debitosPendentes: debitos,
    caucao,
    totalDevido: saldo + multa + debitos - caucao,
  };
}

export interface LinhaAcerto {
  descricao: string;
  /** Centavos: positivo = locatário deve; negativo = a devolver/abater. */
  valor: Centavos;
}

/**
 * Acerto de saída: saldo de aluguel + multa + reparos da vistoria + outros
 * débitos − caução a devolver. Faturas em aberto de períodos já cobertos
 * continuam como faturas (não entram aqui, para não cobrar duas vezes).
 */
export function acertoDeSaida(
  p: Omit<ParametrosRescisao, "debitosPendentes" | "caucao">,
  extras: { reparos: Centavos; outros: Centavos; caucao: Centavos },
): { linhas: LinhaAcerto[]; total: Centavos; rescisao: ResultadoRescisao } {
  const r = calcularRescisao({ ...p, debitosPendentes: 0, caucao: 0 });
  const linhas: LinhaAcerto[] = [];
  if (r.saldoAluguel) linhas.push({ descricao: `Saldo de aluguel (${r.diasSaldo} dias)`, valor: r.saldoAluguel });
  if (r.multa) linhas.push({ descricao: `Multa rescisória — ${r.multaFundamento}`, valor: r.multa });
  if (extras.reparos) linhas.push({ descricao: "Reparos apontados na vistoria de saída", valor: extras.reparos });
  if (extras.outros) linhas.push({ descricao: "Outros débitos (contas, condomínio, IPTU do período…)", valor: extras.outros });
  if (extras.caucao) linhas.push({ descricao: "(−) Caução a devolver/abater", valor: -extras.caucao });
  return { linhas, total: linhas.reduce((s, l) => s + l.valor, 0), rescisao: r };
}
