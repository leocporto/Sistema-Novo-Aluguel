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
  plano_id: string | null;
  plano: { codigo: string; nome: string; grupo_dre: string } | null;
};

type Recebido = { fatura_numero: number; valor: number; data: string };

/**
 * O que foi recebido e pago no período (regime de caixa), com a classificação
 * do plano de contas.
 * - Pessoal: cada recebimento de aluguel (inteiro ou parcial) gera um lançamento
 *   "Aluguel" (registrar_recebimento), que entra como os demais. Aluguéis pagos
 *   ANTES disso (sem lançamento) vêm da visão `alugueis_recebidos`
 *   (entra_no_resultado), na conta "Aluguéis recebidos" do plano, se existir.
 *   Assim nada conta duas vezes.
 * - Imobiliária: o aluguel é dinheiro de terceiros (não entra); a taxa de
 *   administração entra pelo lançamento da baixa. Lançamentos marcados como
 *   "de terceiros" ficam fora.
 */
export async function linhasRealizadas(supabase: Supabase, pessoal: boolean, de: string, ate: string): Promise<LinhaComData[]> {
  const [lanc, fat, planoAluguel] = await Promise.all([
    todas<L>(() =>
      supabase
        .from("lancamentos")
        .select("tipo, descricao, valor, valor_pago, liquidado_em, terceiros, plano_id, plano:plano_contas(codigo, nome, grupo_dre)")
        .eq("status", "liquidado")
        .gte("liquidado_em", de)
        .lte("liquidado_em", ate)
        .order("id"),
    ),
    pessoal
      ? todas<Recebido>(() =>
          supabase.from("alugueis_recebidos").select("fatura_numero, valor, data").eq("entra_no_resultado", true).gte("data", de).lte("data", ate).order("id"),
        )
      : Promise.resolve([] as Recebido[]),
    pessoal
      ? supabase.from("plano_contas").select("id, codigo, nome, grupo_dre").eq("tipo", "receita").eq("ativo", true).eq("nome", "Aluguéis recebidos").order("codigo").limit(1).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const linhas: LinhaComData[] = [];
  for (const l of lanc) {
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
  const p = planoAluguel.data as { id: string; codigo: string; nome: string; grupo_dre: string } | null;
  for (const f of fat)
    linhas.push({
      tipo: "receber",
      valor: Number(f.valor),
      grupo_dre: p?.grupo_dre ?? "receita_operacional",
      plano_id: p?.id ?? "alugueis",
      plano_nome: p ? `${p.codigo} · ${p.nome}` : "Aluguéis recebidos",
      plano_codigo: p?.codigo ?? null,
      data: f.data,
      descricao: `Aluguel · fatura #${f.fatura_numero}`,
    });
  return linhas;
}
