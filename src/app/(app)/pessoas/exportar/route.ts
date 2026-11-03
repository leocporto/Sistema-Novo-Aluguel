import { obterContexto } from "@/lib/contexto";
import { pessoasParaCSV } from "@/lib/dominio/pessoas";
import { ROTULO_PAPEL } from "@/lib/tipos";
import { buscarPessoas } from "../filtro";

/** Baixa as pessoas da lista (com os mesmos filtros) em CSV que abre no Excel. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const ctx = await obterContexto();
  const lista = await buscarPessoas(ctx, { q: url.searchParams.get("q") ?? "", papel: url.searchParams.get("papel") ?? "", pendencia: url.searchParams.get("pendencia") === "1" }, 10000);
  const corpo = pessoasParaCSV(lista as unknown as Record<string, unknown>[], ROTULO_PAPEL);
  const data = new Date().toISOString().slice(0, 10);
  return new Response(corpo, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="pessoas-${data}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
