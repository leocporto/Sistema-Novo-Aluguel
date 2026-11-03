import "server-only";
import type { obterContexto } from "@/lib/contexto";
import { valorRealizado, type LinhaRealizada } from "@/lib/dominio/financeiro";
import { todas } from "../dados";

type Supabase = Awaited<ReturnType<typeof obterContexto>>["supabase"];

export type LinhaComData = LinhaRealizada & { data: string; descricao: string; plano_codigo: string | null };

type L = {
  tipo: "receber" | "pagar";
  descricao: string;
  valor: number;
  valor_pago: number | null;
  liquidado_em: string;
  terceiros: boolean;
  fatura_id: string | null;
  plano_id: string | null;
  plano: { codigo: string; nome: string; grupo_dre: string } | null;
};

/**
 * O que foi recebido e pago no período (regime de caixa), com a classificação
 * do plano de contas.
 * - Pessoal: o aluguel recebido entra pela FATURA paga (na conta "1.1 Aluguéis
 *   recebidos" do plano, se existir). O lançamento automático que a baixa cria
 *   (com fatura_id) fica de fora para não contar duas vezes.
 * - Imobiliária: o aluguel é dinheiro de terceiros (não entra); a taxa de
 *   administração entra pelo lançamento da baixa. Lançamentos marcados como
 *   "de terceiros" ficam fora.
 */
export async function linhasRealizadas(supabase: Supabase, pessoal: boolean, de: string, ate: string): Promise<LinhaComData[]> {
  const [lanc, fat, planoAluguel] = await Promise.all([
    todas<L>(() =>
      supabase
        .from("lancamentos")
        .select("tipo, descricao, valor, valor_pago, liquidado_em, terceiros, fatura_id, plano_id, plano:plano_contas(codigo, nome, grupo_dre)")
        .eq("status", "liquidado")
        .gte("liquidado_em", de)
        .lte("liquidado_em", ate)
        .order("id"),
    ),
    pessoal
      ? todas<{ numero: number; valor_total: number; valor_pago: number | null; pago_em: string }>(() =>
          supabase.from("faturas").select("numero, valor_total, valor_pago, pago_em").eq("status", "paga").gte("pago_em", de).lte("pago_em", ate).order("id"),
        )
      : Promise.resolve([]),
    pessoal
      ? supabase.from("plano_contas").select("id, codigo, nome, grupo_dre").eq("codigo", "1.1").eq("tipo", "receita").maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const linhas: LinhaComData[] = [];
  for (const l of lanc) {
    if (!pessoal && l.terceiros) continue;
    if (pessoal && l.fatura_id) continue;
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
  const p = planoAluguel.data as { id: string; codigo: string; nome: string; grupo_dre: string } | null;
  for (const f of fat)
    linhas.push({
      tipo: "receber",
      valor: Number(f.valor_pago ?? f.valor_total),
      grupo_dre: p?.grupo_dre ?? "receita_operacional",
      plano_id: p?.id ?? "alugueis",
      plano_nome: p ? `${p.codigo} · ${p.nome}` : "Aluguéis recebidos",
      plano_codigo: p?.codigo ?? null,
      data: f.pago_em,
      descricao: `Aluguel · fatura #${f.numero}`,
    });
  return linhas;
}
