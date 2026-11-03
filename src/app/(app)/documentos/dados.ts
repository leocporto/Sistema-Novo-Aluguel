import type { obterContexto } from "@/lib/contexto";

type Supabase = Awaited<ReturnType<typeof obterContexto>>["supabase"];

export async function opcoesDocumentos(supabase: Supabase, pessoal: boolean) {
  const [im, pe, co, ve, mo] = await Promise.all([
    supabase.from("imoveis").select("id, codigo").order("codigo"),
    supabase.from("pessoas").select("id, nome").order("nome").limit(2000),
    supabase.from("contratos").select("id, numero, imovel:imoveis(codigo)").order("numero", { ascending: false }).limit(500),
    pessoal ? Promise.resolve({ data: null }) : supabase.from("vendas").select("id, numero, imovel:imoveis(codigo)").order("numero", { ascending: false }).limit(300),
    supabase.from("documento_modelos").select("id, nome, tipo").eq("ativo", true).order("nome"),
  ]);
  return {
    imoveis: (im.data ?? []) as { id: string; codigo: string }[],
    pessoas: (pe.data ?? []) as { id: string; nome: string }[],
    contratos: (co.data ?? []) as unknown as { id: string; numero: number; imovel: { codigo: string } | null }[],
    vendas: ve.data as unknown as { id: string; numero: number; imovel: { codigo: string } | null }[] | null,
    modelos: (mo.data ?? []) as { id: string; nome: string; tipo: string }[],
  };
}
