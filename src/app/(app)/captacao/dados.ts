import type { obterContexto } from "@/lib/contexto";
import type { OpcaoNome } from "./campos";

type Supabase = Awaited<ReturnType<typeof obterContexto>>["supabase"];

export async function carregarCorretores(supabase: Supabase) {
  const { data } = await supabase.from("pessoas").select("id, nome").contains("papeis", ["corretor"]).order("nome");
  return (data ?? []) as OpcaoNome[];
}

export function haQuanto(iso: string, agora: number) {
  const dias = Math.floor((agora - new Date(iso).getTime()) / 86_400_000);
  if (dias <= 0) return "hoje";
  if (dias === 1) return "ontem";
  return `há ${dias} dias`;
}
