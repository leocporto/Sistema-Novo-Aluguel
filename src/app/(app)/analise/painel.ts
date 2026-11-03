import "server-only";
import type { obterContexto } from "@/lib/contexto";
import { GARANTIA_AGUARDANDO } from "@/lib/dominio/analise";
import { somarDias } from "@/lib/dominio/datas";

type Supabase = Awaited<ReturnType<typeof obterContexto>>["supabase"];

/**
 * Números para quadros do Painel (ponto de integração: painel-widgets.tsx).
 * Nos dois modos. Contagens feitas no banco (head + count), sem o limite de 1.000 linhas.
 */
export async function numerosAnalisePainel(supabase: Supabase, hoje: string) {
  const [{ count: emAnalise }, { count: aguardando }, { count: vencendo }, { count: vencidas }] = await Promise.all([
    supabase.from("analises").select("id", { count: "exact", head: true }).eq("status", "em_analise"),
    supabase
      .from("analise_garantias")
      .select("id, analise:analises!inner(status)", { count: "exact", head: true })
      .in("status", [...GARANTIA_AGUARDANDO])
      .eq("analise.status", "em_analise"),
    supabase
      .from("contrato_garantias")
      .select("id, contrato:contratos!inner(status)", { count: "exact", head: true })
      .eq("status", "ativa")
      .eq("contrato.status", "ativo")
      .gte("fim", hoje)
      .lte("fim", somarDias(hoje, 30)),
    supabase
      .from("contrato_garantias")
      .select("id, contrato:contratos!inner(status)", { count: "exact", head: true })
      .eq("status", "ativa")
      .eq("contrato.status", "ativo")
      .lt("fim", hoje),
  ]);
  return {
    /** Candidatos sem decisão (quadro "analises_pendentes" → /analise). */
    emAnalise: emAnalise ?? 0,
    /** Propostas esperando a garantidora (→ /analise/garantidoras). */
    aguardandoGarantidora: aguardando ?? 0,
    /** Garantias de contratos ativos que vencem em até 30 dias (→ /analise/garantias?filtro=30). */
    garantiasVencendo: vencendo ?? 0,
    /** Garantias já vencidas (→ /analise/garantias?filtro=vencida). */
    garantiasVencidas: vencidas ?? 0,
  };
}
