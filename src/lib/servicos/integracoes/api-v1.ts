import "server-only";
import { filtrosDaConsulta } from "@/lib/dominio/api";
import { chaveDoCabecalho, codificarCursor, decodificarCursor, type RecursoApi } from "@/lib/dominio/integracoes";
import { clienteAnonimo } from "@/lib/supabase/anonimo";

/*
 * Rotas /api/v1 (públicas: ponto de integração "/api/v1" em ROTAS_PUBLICAS do
 * proxy). Não há service role: a rota entra como anônimo e chama as funções
 * api_v1_* do banco, que conferem a chave (hash), escopo, validade, modo e
 * limites, registram o uso e só devolvem dados da organização da chave.
 */

type RespostaBanco = { status?: number; dados?: unknown; proximo_cursor?: string | null; erro?: { codigo: string; mensagem: string }; tentar_em?: number };

const CABECALHOS = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

export function erroApi(status: number, codigo: string, mensagem: string, extra: Record<string, string> = {}): Response {
  return Response.json({ erro: { codigo, mensagem } }, { status, headers: { ...CABECALHOS, ...extra } });
}

export const chaveDaRequisicao = (req: Request) => chaveDoCabecalho(req.headers.get("authorization"), req.headers.get("x-api-key"));

export function ipDaRequisicao(req: Request): string | null {
  const v = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || null;
  return v ? v.slice(0, 64) : null;
}

function responder(r: RespostaBanco | null, error: { message: string; code?: string } | null): Response {
  if (error) {
    // Banco sem a migração 20261107000009 (função não existe) ou falha inesperada.
    if (error.code === "PGRST202" || /could not find the function|does not exist/i.test(error.message)) return erroApi(503, "indisponivel", "A API ainda não está ligada nesta instalação.");
    return erroApi(500, "erro_interno", "Erro inesperado. Tente de novo.");
  }
  const status = r?.status ?? 500;
  if (r?.erro) return erroApi(status, r.erro.codigo, r.erro.mensagem, status === 429 && r.tentar_em ? { "Retry-After": String(r.tentar_em) } : {});
  const corpo: Record<string, unknown> = { dados: r?.dados ?? null };
  if (r && "proximo_cursor" in r) corpo.proximo_cursor = codificarCursor(r.proximo_cursor ?? null);
  return Response.json(corpo, { status, headers: CABECALHOS });
}

export async function listar(req: Request, recurso: RecursoApi): Promise<Response> {
  const chave = chaveDaRequisicao(req);
  if (!chave) return erroApi(401, "nao_autorizado", "Envie a chave no cabeçalho Authorization: Bearer <chave>.");
  const sp = new URL(req.url).searchParams;
  const params: Record<string, string> = filtrosDaConsulta(recurso, sp);
  const limite = sp.get("limite");
  if (limite !== null) params.limite = limite.slice(0, 10);
  const cursor = decodificarCursor(sp.get("cursor"));
  if (cursor === false) return erroApi(422, "dados_invalidos", "cursor inválido.");
  if (cursor) params.cursor = cursor;
  const { data, error } = await clienteAnonimo().rpc("api_v1_listar", { p_chave: chave, p_recurso: recurso, p_params: params, p_ip: ipDaRequisicao(req) });
  return responder(data as RespostaBanco, error);
}

export async function obter(req: Request, recurso: RecursoApi, id: string): Promise<Response> {
  const chave = chaveDaRequisicao(req);
  if (!chave) return erroApi(401, "nao_autorizado", "Envie a chave no cabeçalho Authorization: Bearer <chave>.");
  const { data, error } = await clienteAnonimo().rpc("api_v1_obter", { p_chave: chave, p_recurso: recurso, p_id: id.slice(0, 64), p_ip: ipDaRequisicao(req) });
  return responder(data as RespostaBanco, error);
}

/** Corpo JSON de até 20 KB (null = inválido). */
export async function corpoJson(req: Request): Promise<Record<string, unknown> | null> {
  const tipo = req.headers.get("content-type") ?? "";
  if (!tipo.includes("application/json")) return null;
  const texto = await req.text().catch(() => "");
  if (!texto) return {};
  if (texto.length > 20_000) return null;
  try {
    const v = JSON.parse(texto) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export async function criarLead(req: Request): Promise<Response> {
  const chave = chaveDaRequisicao(req);
  if (!chave) return erroApi(401, "nao_autorizado", "Envie a chave no cabeçalho Authorization: Bearer <chave>.");
  const corpo = await corpoJson(req);
  if (!corpo) return erroApi(400, "requisicao_invalida", "Envie um objeto JSON (Content-Type: application/json) de até 20 KB.");
  const { data, error } = await clienteAnonimo().rpc("api_v1_criar_lead", { p_chave: chave, p: corpo, p_ip: ipDaRequisicao(req) });
  return responder(data as RespostaBanco, error);
}

export async function testarWebhooks(req: Request): Promise<Response> {
  const chave = chaveDaRequisicao(req);
  if (!chave) return erroApi(401, "nao_autorizado", "Envie a chave no cabeçalho Authorization: Bearer <chave>.");
  const corpo = (await corpoJson(req)) ?? {};
  const params = typeof corpo.assinatura_id === "string" ? { assinatura_id: corpo.assinatura_id.slice(0, 64) } : {};
  const { data, error } = await clienteAnonimo().rpc("api_v1_webhook_teste", { p_chave: chave, p_params: params, p_ip: ipDaRequisicao(req) });
  return responder(data as RespostaBanco, error);
}
