import { ehRecursoApi } from "@/lib/dominio/integracoes";
import { erroApi, obter } from "@/lib/servicos/integracoes/api-v1";

/** GET /api/v1/<recurso>/<id> — um registro da organização da chave. */
export async function GET(req: Request, ctx: RouteContext<"/api/v1/[recurso]/[id]">) {
  const { recurso, id } = await ctx.params;
  if (!ehRecursoApi(recurso)) return erroApi(404, "nao_encontrado", "Recurso desconhecido. Veja /api/v1/openapi.json.");
  return obter(req, recurso, id);
}
