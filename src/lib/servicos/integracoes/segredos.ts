import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/*
 * Segredos dos provedores (chaves de API, senhas). Ficam em
 * public.integracoes_segredos, que só o administrador lê (RLS). Se a variável
 * INTEGRACOES_CHAVE existir no servidor (Vercel), o valor ainda é cifrado aqui
 * com AES-256-GCM antes de ir para o banco ("v1:<iv>:<tag>:<dados>", base64url):
 * quem abrir o banco sem a variável não vê a chave. Sem a variável, o valor vai
 * como está (protegido só pela RLS) — a tela avisa.
 */

const PREFIXO = "v1:";

function chaveMestra(): Buffer | null {
  const v = process.env.INTEGRACOES_CHAVE?.trim();
  if (!v || v.length < 16) return null;
  return createHash("sha256").update(v, "utf8").digest();
}

export const cifragemLigada = () => chaveMestra() !== null;

export function cifrar(valor: string): string {
  const k = chaveMestra();
  if (!k) return valor;
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", k, iv);
  const dados = Buffer.concat([c.update(valor, "utf8"), c.final()]);
  return `${PREFIXO}${iv.toString("base64url")}:${c.getAuthTag().toString("base64url")}:${dados.toString("base64url")}`;
}

/** Decifra (ou devolve como está, se foi gravado sem cifra). null = cifrado com outra chave/sem a variável. */
export function decifrar(valor: string): string | null {
  if (!valor.startsWith(PREFIXO)) return valor;
  const k = chaveMestra();
  if (!k) return null;
  try {
    const [iv, tag, dados] = valor.slice(PREFIXO.length).split(":");
    const d = createDecipheriv("aes-256-gcm", k, Buffer.from(iv, "base64url"));
    d.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([d.update(Buffer.from(dados, "base64url")), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}

export function cifrarTodos(segredos: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(segredos).map(([k, v]) => [k, cifrar(v)]));
}

export function decifrarTodos(segredos: Record<string, unknown> | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(segredos ?? {})) {
    if (typeof v !== "string") continue;
    const d = decifrar(v);
    if (d !== null) out[k] = d;
  }
  return out;
}
