"use client";

import { formatarPct } from "@/lib/dominio/analise";
import { useContagem } from "@/lib/movimento/useContagem";

/**
 * KPI de percentual com uma casa decimal (30,4%), contando até o valor como o
 * <Contador>. O formato "pct" do Contador arredonda para inteiro e mostraria
 * "30%" em vermelho com a regra "até 30%".
 */
export function ContadorPct({ valor }: { valor: number }) {
  const v = useContagem(Number(valor) || 0);
  return <span style={{ fontVariantNumeric: "tabular-nums" }}>{formatarPct(v)}</span>;
}
