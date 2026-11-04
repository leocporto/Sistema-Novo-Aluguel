"use client";

import { useContagem } from "@/lib/movimento/useContagem";

/**
 * Contador do custo estimado da IA em dólar (o preço por milhão de tokens das
 * Configurações é em US$). Mesmo movimento do <Contador> dos KPIs, com duas casas.
 */
export function ContadorDolar({ valor }: { valor: number }) {
  const v = useContagem(Number(valor) || 0);
  return <span style={{ fontVariantNumeric: "tabular-nums" }}>{`US$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}</span>;
}
