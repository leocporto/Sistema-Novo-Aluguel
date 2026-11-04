import { obterContexto } from "@/lib/contexto";
import { csvContabil } from "@/lib/dominio/integracoes";
import { exigirPermissao } from "@/lib/permissoes";
import { lancamentosContabeis, lerFiltroContabil } from "../../contabil";

/** CSV para o contador: lançamentos do período no layout genérico, com o de-para do plano de contas. */
export async function GET(req: Request) {
  const { supabase, papel, organizacao } = await obterContexto();
  if (papel !== "admin" && papel !== "gestor") return new Response("Sem permissão.", { status: 403 });
  try {
    await exigirPermissao("financeiro", "ver");
    await exigirPermissao("configuracoes", "ver");
  } catch {
    return new Response("Sem permissão.", { status: 403 });
  }
  const f = lerFiltroContabil(new URL(req.url).searchParams, organizacao.modo);
  const { linhas } = await lancamentosContabeis(supabase, f);
  const nome = `contabil-${f.regime}-${f.de}-a-${f.ate}.csv`;
  return new Response(csvContabil(linhas), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${nome}"`, "Cache-Control": "no-store" },
  });
}
