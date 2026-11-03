import type { SupabaseClient } from "@supabase/supabase-js";
import { fimDoMes } from "@/lib/dominio/datas";
import type { TipoMeta } from "@/lib/tipos";

/** Quanto foi realizado no mês (AAAA-MM) em cada tipo de meta. */
export async function realizadoDoMes(supabase: SupabaseClient, mes: string): Promise<Record<TipoMeta, number>> {
  const ini = `${mes}-01`;
  const fim = fimDoMes(ini);
  const conta = (r: { count: number | null }) => r.count ?? 0;
  const [locacoes, vendas, captacoes, leads, receitas] = await Promise.all([
    supabase.from("contratos").select("id", { count: "exact", head: true }).neq("status", "rascunho").gte("data_inicio", ini).lte("data_inicio", fim),
    supabase.from("imoveis").select("id", { count: "exact", head: true }).gte("vendido_em", ini).lte("vendido_em", fim),
    supabase.from("imoveis").select("id", { count: "exact", head: true }).gte("captado_em", ini).lte("captado_em", fim),
    supabase.from("leads").select("id", { count: "exact", head: true }).gte("created_at", `${ini}T00:00:00-03:00`).lte("created_at", `${fim}T23:59:59-03:00`),
    supabase.from("lancamentos").select("valor").eq("tipo", "receber").eq("status", "liquidado").gte("liquidado_em", ini).lte("liquidado_em", fim),
  ]);
  return {
    locacoes: conta(locacoes),
    vendas: conta(vendas),
    captacoes: conta(captacoes),
    leads: conta(leads),
    faturamento: (receitas.data ?? []).reduce((s, l) => s + Number(l.valor), 0),
  };
}
