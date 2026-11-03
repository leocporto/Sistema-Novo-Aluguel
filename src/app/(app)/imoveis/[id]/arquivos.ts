import type { obterContexto } from "@/lib/contexto";
import type { ArquivoImovel } from "./galeria";

type Supabase = Awaited<ReturnType<typeof obterContexto>>["supabase"];

/** Lista os arquivos de um tipo, com links temporários (1 h) para mostrar as imagens. */
export async function carregarArquivos(supabase: Supabase, imovelId: string, tipos: string[]): Promise<(ArquivoImovel & { tipo: string })[]> {
  const { data } = await supabase
    .from("imovel_midias")
    .select("id, tipo, path, nome, capa, categoria, ordem")
    .eq("imovel_id", imovelId)
    .in("tipo", tipos)
    .order("ordem")
    .order("created_at");
  const lista = data ?? [];
  const caminhos = lista.map((a) => a.path as string);
  const { data: assinadas } = caminhos.length ? await supabase.storage.from("imoveis").createSignedUrls(caminhos, 3600) : { data: [] };
  const url = new Map((assinadas ?? []).map((s) => [s.path, s.signedUrl]));
  return lista.map((a) => ({
    id: a.id as string,
    tipo: a.tipo as string,
    nome: a.nome as string | null,
    capa: Boolean(a.capa),
    categoria: a.categoria as string | null,
    url: url.get(a.path as string) ?? null,
    ehPdf: String(a.path).toLowerCase().endsWith(".pdf"),
  }));
}
