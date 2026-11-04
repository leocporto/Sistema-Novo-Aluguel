import "server-only";
import { obterContexto } from "@/lib/contexto";

/**
 * Portal do corretor (só imobiliária). Os dados vêm de public.corretor_portal,
 * que no papel "corretor" SEMPRE usa o cadastro ligado ao usuário (ignora o
 * parâmetro); administrador, gestor e financeiro escolhem o corretor (?corretor=).
 */
export async function contextoCorretor(sp: Record<string, string | string[] | undefined>) {
  const ctx = await obterContexto();
  const ehCorretor = ctx.papel === "corretor";
  const escolhido = !ehCorretor && typeof sp.corretor === "string" && /^[0-9a-f-]{36}$/i.test(sp.corretor) ? sp.corretor : null;
  const { data: corretores } = ehCorretor
    ? { data: [] as { id: string; nome: string }[] }
    : await ctx.supabase.from("pessoas").select("id, nome").contains("papeis", ["corretor"]).order("nome").limit(1000);
  return { ...ctx, ehCorretor, escolhido, corretores: (corretores ?? []) as { id: string; nome: string }[], gestao: ctx.papel === "admin" || ctx.papel === "gestor" };
}

export type SemVinculo = { sem_vinculo: true; papel: string | null };
export const semVinculo = (d: unknown): d is SemVinculo => Boolean(d && typeof d === "object" && "sem_vinculo" in d);

export async function portalCorretor<T>(supabase: Awaited<ReturnType<typeof obterContexto>>["supabase"], secao: string, pessoa: string | null, p: Record<string, unknown> = {}): Promise<T | SemVinculo> {
  const { data, error } = await supabase.rpc("corretor_portal", { p_secao: secao, p_pessoa: pessoa, p });
  if (error) throw new Error(error.message);
  return data as T | SemVinculo;
}

/** "?corretor=<id>" para manter a escolha do gestor entre as abas. */
export const sufixo = (escolhido: string | null) => (escolhido ? `?corretor=${escolhido}` : "");
