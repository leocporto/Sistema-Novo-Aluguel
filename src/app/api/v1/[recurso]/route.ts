import { ehRecursoApi } from "@/lib/dominio/integracoes";
import { criarLead, erroApi, listar } from "@/lib/servicos/integracoes/api-v1";

/** GET /api/v1/<recurso> — lista com filtros e cursor (imoveis, pessoas, contratos, faturas, leads). */
export async function GET(req: Request, ctx: RouteContext<"/api/v1/[recurso]">) {
  const { recurso } = await ctx.params;
  if (!ehRecursoApi(recurso)) return erroApi(404, "nao_encontrado", "Recurso desconhecido. Veja /api/v1/openapi.json.");
  return listar(req, recurso);
}

/** POST /api/v1/leads — cria lead (escopo leads:escrita). Nos outros recursos a API é só de leitura. */
export async function POST(req: Request, ctx: RouteContext<"/api/v1/[recurso]">) {
  const { recurso } = await ctx.params;
  if (recurso === "leads") return criarLead(req);
  if (!ehRecursoApi(recurso)) return erroApi(404, "nao_encontrado", "Recurso desconhecido. Veja /api/v1/openapi.json.");
  return erroApi(405, "metodo_nao_permitido", "Este recurso é só de leitura pela API.", { Allow: "GET" });
}
