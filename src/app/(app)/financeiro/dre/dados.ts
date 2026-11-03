import "server-only";
import type { obterContexto } from "@/lib/contexto";
import { valorRealizado, type LinhaRealizada } from "@/lib/dominio/financeiro";

type Supabase = Awaited<ReturnType<typeof obterContexto>>["supabase"];

export type LinhaComData = LinhaRealizada & { data: string; descricao: string; plano_codigo: string | null };

/**
 * O que foi recebido e pago no período (regime de caixa), com a classificação
 * do plano de contas. No modo pessoal, os aluguéis recebidos entram como receita.
 * Na imobiliária, lançamentos marcados como "de terceiros" ficam fora.
 */
export async function linhasRealizadas(supabase: Supabase, pessoal: boolean, de: string, ate: string): Promise<LinhaComData[]> {
  const [{ data: lanc }, { data: fat }] = await Promise.all([
    supabase
      .from("lancamentos")
      .select("tipo, descricao, valor, valor_pago, liquidado_em, terceiros, plano_id, plano:plano_contas(codigo, nome, grupo_dre)")
      .eq("status", "liquidado")
      .gte("liquidado_em", de)
      .lte("liquidado_em", ate)
      .limit(20000),
    pessoal
      ? supabase.from("faturas").select("numero, valor_total, valor_pago, pago_em").eq("status", "paga").gte("pago_em", de).lte("pago_em", ate).limit(20000)
      : Promise.resolve({ data: [] as { numero: number; valor_total: number; valor_pago: number | null; pago_em: string }[] }),
  ]);
  const linhas: LinhaComData[] = [];
  for (const l of (lanc ?? []) as unknown as {
    tipo: "receber" | "pagar";
    descricao: string;
    valor: number;
    valor_pago: number | null;
    liquidado_em: string;
    terceiros: boolean;
    plano_id: string | null;
    plano: { codigo: string; nome: string; grupo_dre: string } | null;
  }[]) {
    if (!pessoal && l.terceiros) continue;
    linhas.push({
      tipo: l.tipo,
      valor: valorRealizado(l),
      grupo_dre: l.plano?.grupo_dre ?? null,
      plano_id: l.plano_id,
      plano_nome: l.plano ? `${l.plano.codigo} · ${l.plano.nome}` : null,
      plano_codigo: l.plano?.codigo ?? null,
      data: l.liquidado_em,
      descricao: l.descricao,
    });
  }
  for (const f of fat ?? [])
    linhas.push({
      tipo: "receber",
      valor: Number(f.valor_pago ?? f.valor_total),
      grupo_dre: "receita_operacional",
      plano_id: "alugueis",
      plano_nome: "Aluguéis recebidos",
      plano_codigo: null,
      data: f.pago_em,
      descricao: `Aluguel · fatura #${f.numero}`,
    });
  return linhas;
}
