import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Confere a assinatura X-Hub-Signature-256 da Meta (HMAC-SHA256 do corpo com o
 * "app secret"). Só vale quando a variável de ambiente existe; sem ela, a
 * segurança é o token secreto na URL.
 */
export function assinaturaMetaOk(corpo: string, cabecalho: string | null, segredo: string | undefined): boolean {
  if (!segredo) return true;
  if (!cabecalho?.startsWith("sha256=")) return false;
  const esperado = Buffer.from(createHmac("sha256", segredo).update(corpo, "utf8").digest("hex"));
  const recebido = Buffer.from(cabecalho.slice(7));
  return esperado.length === recebido.length && timingSafeEqual(esperado, recebido);
}

export const tokenValido = (t: string) => /^[0-9a-f-]{36}$/i.test(t);
