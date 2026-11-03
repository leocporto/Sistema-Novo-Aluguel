import type { obterContexto } from "@/lib/contexto";
import type { OpcaoImovel, OpcaoNome } from "./campos";

type Supabase = Awaited<ReturnType<typeof obterContexto>>["supabase"];

/** Listas usadas nos formulários do Comercial. */
export async function carregarOpcoes(supabase: Supabase) {
  const [imoveis, leads, corretores] = await Promise.all([
    supabase.from("imoveis").select("id, codigo, logradouro, numero").neq("status", "inativo").order("codigo"),
    supabase.from("leads").select("id, nome").not("status", "in", "(ganho,perdido)").order("nome"),
    supabase.from("pessoas").select("id, nome").contains("papeis", ["corretor"]).order("nome"),
  ]);
  return {
    imoveis: (imoveis.data ?? []) as OpcaoImovel[],
    leads: (leads.data ?? []) as OpcaoNome[],
    corretores: (corretores.data ?? []) as OpcaoNome[],
  };
}
