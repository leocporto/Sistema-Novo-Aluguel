/**
 * Utilitários monetários. Todos os cálculos internos são feitos em centavos
 * (inteiros) para evitar erros de ponto flutuante; a conversão para reais
 * acontece apenas na entrada e na saída.
 */

export type Centavos = number;

export function paraCentavos(reais: number | string | null | undefined): Centavos {
  if (reais === null || reais === undefined || reais === "") return 0;
  const n = typeof reais === "string" ? Number(reais.replace(",", ".")) : reais;
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

export function paraReais(centavos: Centavos): number {
  return Math.round(centavos) / 100;
}

/** Aplica um percentual (ex.: 10 = 10%) sobre um valor em centavos, arredondando. */
export function percentual(valor: Centavos, pct: number): Centavos {
  return Math.round((valor * pct) / 100);
}

/**
 * Divide um valor entre participantes conforme percentuais, garantindo que a
 * soma das partes seja exatamente igual ao total (a diferença de arredondamento
 * vai para a maior parte).
 */
export function ratear(total: Centavos, percentuais: number[]): Centavos[] {
  if (percentuais.length === 0) return [];
  const somaPct = percentuais.reduce((a, b) => a + b, 0);
  if (somaPct <= 0) throw new Error("A soma dos percentuais deve ser maior que zero");
  const partes = percentuais.map((p) => Math.floor((total * p) / somaPct));
  let resto = total - partes.reduce((a, b) => a + b, 0);
  const ordem = percentuais
    .map((p, i) => ({ p, i }))
    .sort((a, b) => b.p - a.p || a.i - b.i);
  let k = 0;
  while (resto !== 0) {
    const passo = resto > 0 ? 1 : -1;
    partes[ordem[k % ordem.length].i] += passo;
    resto -= passo;
    k++;
  }
  return partes;
}

const formatador = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export function formatarReais(reais: number | string | null | undefined): string {
  const n = typeof reais === "string" ? Number(reais) : (reais ?? 0);
  return formatador.format(Number.isFinite(n) ? n : 0);
}
