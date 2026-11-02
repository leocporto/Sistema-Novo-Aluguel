import { type Centavos, paraCentavos } from "./dinheiro";

/**
 * IRRF sobre aluguel: quando o locatário é pessoa jurídica e o locador é pessoa
 * física, a PJ é obrigada a reter o imposto na fonte usando a tabela
 * progressiva mensal. A base de cálculo pode excluir a taxa de administração,
 * o IPTU e o condomínio pagos pelo locador.
 *
 * ATENÇÃO: a tabela abaixo reflete a legislação conhecida para 2026 (tabela
 * mensal vigente desde 05/2025 + redutor da Lei 15.270/2025). Confirme com a
 * contabilidade e atualize aqui sempre que a legislação mudar.
 */
export interface FaixaIR {
  ate: number | null; // limite superior da faixa em R$ (null = sem limite)
  aliquotaPct: number;
  deducao: number; // parcela a deduzir em R$
}

export const TABELA_IR_MENSAL_2026: FaixaIR[] = [
  { ate: 2428.8, aliquotaPct: 0, deducao: 0 },
  { ate: 2826.65, aliquotaPct: 7.5, deducao: 182.16 },
  { ate: 3751.05, aliquotaPct: 15, deducao: 394.16 },
  { ate: 4664.68, aliquotaPct: 22.5, deducao: 675.49 },
  { ate: null, aliquotaPct: 27.5, deducao: 908.73 },
];

/** Redutor mensal da Lei 15.270/2025 (vigência a partir de 01/2026). */
export function redutor2026(baseReais: number, impostoReais: number): number {
  if (baseReais <= 5000) return impostoReais; // zera o imposto
  if (baseReais <= 7350) return Math.max(0, Math.min(impostoReais, 978.62 - 0.133145 * baseReais));
  return 0;
}

export function calcularIRRF(
  base: Centavos,
  tabela: FaixaIR[] = TABELA_IR_MENSAL_2026,
  aplicarRedutor = true,
): Centavos {
  const reais = base / 100;
  if (reais <= 0) return 0;
  const faixa = tabela.find((f) => f.ate === null || reais <= f.ate)!;
  let imposto = Math.max(0, (reais * faixa.aliquotaPct) / 100 - faixa.deducao);
  if (aplicarRedutor) imposto = Math.max(0, imposto - redutor2026(reais, imposto));
  return paraCentavos(Math.round(imposto * 100) / 100);
}
