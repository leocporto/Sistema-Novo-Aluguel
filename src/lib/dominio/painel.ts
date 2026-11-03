/** Contas puras do Painel (sem banco): meses, comparativos e metas. */

/** Os `n` meses (AAAA-MM) que terminam em `mesFinal`, do mais antigo ao mais novo. */
export function mesesAte(mesFinal: string, n: number): string[] {
  const [a, m] = mesFinal.split("-").map(Number);
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const total = a * 12 + (m - 1) - i;
    out.push(`${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`);
  }
  return out;
}

/** Mesmo mês, `anos` antes. */
export function mesAnoAnterior(mes: string, anos = 1): string {
  const [a, m] = mes.split("-");
  return `${Number(a) - anos}-${m}`;
}

/** Soma valores por mês (a data pode ser AAAA-MM-DD ou timestamp ISO). */
export function somarPorMes(itens: { data: string | null | undefined; valor: number }[], meses: string[]): number[] {
  const idx = new Map(meses.map((m, i) => [m, i]));
  const out = meses.map(() => 0);
  for (const it of itens) {
    if (!it.data) continue;
    const i = idx.get(it.data.slice(0, 7));
    if (i !== undefined) out[i] += Number(it.valor) || 0;
  }
  return out.map((v) => Math.round(v * 100) / 100);
}

/** Conta itens por mês. */
export function contarPorMes(datas: (string | null | undefined)[], meses: string[]): number[] {
  return somarPorMes(
    datas.map((d) => ({ data: d, valor: 1 })),
    meses,
  );
}

/** Variação % de `anterior` para `atual` (null quando não há base). */
export function variacaoPct(atual: number, anterior: number): number | null {
  if (!anterior) return null;
  return Math.round(((atual - anterior) / Math.abs(anterior)) * 1000) / 10;
}

/** Progresso de uma meta: % (pode passar de 100) e se foi atingida. */
export function progressoMeta(realizado: number, meta: number | null | undefined): { pct: number; atingida: boolean } | null {
  if (!meta || meta <= 0) return null;
  const pct = Math.round((realizado / meta) * 1000) / 10;
  return { pct, atingida: realizado >= meta };
}

/** Aplica a preferência do usuário (ordem + escondidos) à lista padrão de quadros. */
export function aplicarPreferencia(
  padrao: string[],
  pref: { ordem?: string[]; ocultos?: string[] } | null | undefined,
): { visiveis: string[]; ocultos: string[] } {
  const ordemSalva = (pref?.ordem ?? []).filter((id) => padrao.includes(id));
  // Quadros novos (que não estavam salvos) entram na posição padrão.
  const ordem = [...ordemSalva];
  for (const id of padrao) {
    if (ordem.includes(id)) continue;
    const anterior = padrao.slice(0, padrao.indexOf(id)).reverse().find((p) => ordem.includes(p));
    ordem.splice(anterior ? ordem.indexOf(anterior) + 1 : 0, 0, id);
  }
  const ocultos = new Set((pref?.ocultos ?? []).filter((id) => padrao.includes(id)));
  return { visiveis: ordem.filter((id) => !ocultos.has(id)), ocultos: ordem.filter((id) => ocultos.has(id)) };
}
