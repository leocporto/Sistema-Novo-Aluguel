import type { obterContexto } from "@/lib/contexto";
import { pendencias } from "@/lib/dominio/pessoas";
import type { Pessoa } from "@/lib/tipos";

type Ctx = Awaited<ReturnType<typeof obterContexto>>;

/** Busca as pessoas com os filtros da lista (usada na tela e na exportação). */
export async function buscarPessoas(ctx: Ctx, f: { q?: string; papel?: string; pendencia?: boolean }, limite = 500) {
  const { supabase, organizacao } = ctx;
  let q = supabase.from("pessoas").select("*").order("nome").limit(limite);
  const busca = (f.q ?? "").trim();
  if (busca) {
    const txt = busca.replace(/[%,()]/g, "");
    const dig = busca.replace(/\D/g, "");
    q = q.or([`nome.ilike.%${txt}%`, `email.ilike.%${txt}%`, dig ? `documento.ilike.%${dig}%` : null, dig ? `telefone.ilike.%${dig}%` : null].filter(Boolean).join(","));
  }
  if (f.papel) q = q.contains("papeis", [f.papel]);
  const [{ data }, { data: arqs }] = await Promise.all([q, supabase.from("pessoa_arquivos").select("pessoa_id, categoria")]);
  const porPessoa = new Map<string, string[]>();
  for (const a of arqs ?? []) porPessoa.set(a.pessoa_id as string, [...(porPessoa.get(a.pessoa_id as string) ?? []), a.categoria as string]);
  const lista = ((data ?? []) as Pessoa[]).map((p) => ({ ...p, pendencias: pendencias(p, porPessoa.get(p.id) ?? [], organizacao.modo) }));
  return f.pendencia ? lista.filter((p) => p.pendencias.length) : lista;
}
