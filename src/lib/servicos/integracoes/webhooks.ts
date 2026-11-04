import "server-only";
import dns from "node:dns";
import https from "node:https";
import type { LookupFunction } from "node:net";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ENTREGAS_POR_RODADA, TIMEOUT_WEBHOOK_MS, entregaOk, hostBloqueado, ipBloqueado } from "@/lib/dominio/integracoes";

/*
 * Entrega dos webhooks (no servidor, em segundo plano).
 * - O banco escolhe o lote (public.webhook_lote), segura cada linha por 2 min
 *   e devolve o corpo pronto + a assinatura HMAC-SHA256 calculada lá dentro.
 * - Aqui só sai um POST por entrega: tempo limite de 10 s, sem seguir
 *   redirecionamento, sem reaproveitar conexão e bloqueando destino interno
 *   (SSRF): o nome é resolvido por um lookup próprio que recusa qualquer IP de
 *   rede interna, link-local (metadados de nuvem), reservado ou multicast — a
 *   conferência vale para o IP que a conexão usa de fato (sem brecha de
 *   "DNS rebinding").
 * - O resultado volta para o banco (public.webhook_resultado), que agenda a
 *   próxima tentativa (5 min, 15, 45…) ou desiste na 6ª.
 */

export type EntregaLote = { id: string; url: string; evento: string; tentativa: number; corpo: string; assinatura: string };
export type ResultadoEnvio = { status: number | null; trecho: string | null; erro: string | null };

const AGENTE = "NovoAluguel-Webhooks/1.0";
const MAX_TRECHO = 2048;

const lookupSeguro: LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { all: true }, (err, lista) => {
    if (err) return callback(err, "", 0);
    if (!lista.length || lista.some((a) => ipBloqueado(a.address))) {
      const e: NodeJS.ErrnoException = new Error("Destino interno bloqueado: o endereço aponta para uma rede interna.");
      e.code = "EBLOQUEADO";
      return callback(e, "", 0);
    }
    if (options.all) callback(null, lista);
    else callback(null, lista[0].address, lista[0].family);
  });
};

function explicarErro(err: unknown): string {
  const e = err as NodeJS.ErrnoException;
  if (e?.code === "EBLOQUEADO") return e.message;
  if (e?.name === "AbortError" || e?.name === "TimeoutError" || e?.code === "ETIMEDOUT" || /tempo/i.test(e?.message ?? "")) return "Tempo esgotado (10 s) sem resposta.";
  if (e?.code === "ENOTFOUND" || e?.code === "EAI_AGAIN") return "Endereço não encontrado (DNS).";
  if (e?.code === "ECONNREFUSED") return "Conexão recusada pelo destino.";
  if (e?.code === "ECONNRESET") return "O destino fechou a conexão.";
  if (typeof e?.code === "string" && /CERT|SSL|TLS/i.test(e.code)) return "Certificado HTTPS do destino inválido.";
  return "Falha de conexão com o destino.";
}

/** Um POST (sem redirecionamento, 10 s, destino público). */
export function enviarWebhook(e: EntregaLote): Promise<ResultadoEnvio> {
  let u: URL;
  try {
    u = new URL(e.url);
  } catch {
    return Promise.resolve({ status: null, trecho: null, erro: "Endereço inválido." });
  }
  if (u.protocol !== "https:" || u.username || u.password || hostBloqueado(u.hostname))
    return Promise.resolve({ status: null, trecho: null, erro: "Destino bloqueado: use https:// e um endereço público." });

  return new Promise((resolve) => {
    let feito = false;
    const fim = (r: ResultadoEnvio) => {
      if (!feito) {
        feito = true;
        resolve(r);
      }
    };
    const corpo = Buffer.from(e.corpo, "utf8");
    const req = https.request(
      {
        protocol: "https:",
        hostname: u.hostname.replace(/^\[|\]$/g, ""),
        port: u.port ? Number(u.port) : 443,
        path: `${u.pathname}${u.search}`,
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Length": corpo.length,
          "User-Agent": AGENTE,
          "X-NovoAluguel-Evento": e.evento,
          "X-NovoAluguel-Assinatura": e.assinatura,
          "X-NovoAluguel-Entrega": e.id,
          "X-NovoAluguel-Tentativa": String(e.tentativa),
        },
        lookup: lookupSeguro,
        agent: false,
        timeout: TIMEOUT_WEBHOOK_MS,
        signal: AbortSignal.timeout(TIMEOUT_WEBHOOK_MS),
      },
      (res) => {
        const partes: Buffer[] = [];
        let tam = 0;
        const terminar = () => {
          const st = res.statusCode ?? null;
          const trecho = Buffer.concat(partes).toString("utf8").slice(0, 500) || null;
          fim({ status: st, trecho, erro: st !== null && st >= 300 && st < 400 ? "Redirecionamento não é seguido: cadastre o endereço final." : null });
        };
        res.on("data", (ch: Buffer) => {
          if (tam < MAX_TRECHO) {
            partes.push(ch);
            tam += ch.length;
          }
          if (tam >= MAX_TRECHO) res.destroy();
        });
        res.on("end", terminar);
        res.on("close", terminar);
        res.on("error", terminar);
      },
    );
    req.on("timeout", () => req.destroy(Object.assign(new Error("Tempo esgotado"), { code: "ETIMEDOUT" })));
    req.on("error", (err) => fim({ status: null, trecho: null, erro: explicarErro(err) }));
    req.end(corpo);
  });
}

/**
 * Roda um lote: pega no banco, envia em paralelo e devolve o resultado de cada uma.
 * Com `entregaId`, só aquela entrega (o teste ou o reprocessamento que acabou de
 * entrar na fila), sem esperar as mais antigas.
 */
export async function entregarWebhooks(supabase: SupabaseClient, limite = ENTREGAS_POR_RODADA, entregaId?: string | null): Promise<{ entregues: number; falhas: number }> {
  const { data, error } = await supabase.rpc("webhook_lote", entregaId ? { p_limite: 1, p_entrega: entregaId } : { p_limite: limite });
  if (error || !Array.isArray(data) || !data.length) return { entregues: 0, falhas: 0 };
  const res = await Promise.all(
    (data as EntregaLote[]).map(async (e) => {
      const r = await enviarWebhook(e);
      await supabase.rpc("webhook_resultado", { p_entrega: e.id, p_status: r.status, p_trecho: r.trecho, p_erro: r.erro });
      return entregaOk(r.status) && !r.erro;
    }),
  );
  const entregues = res.filter(Boolean).length;
  return { entregues, falhas: res.length - entregues };
}

/** Relógio por instância do servidor: no máximo uma rodada a cada 20 s por organização. */
const ultimaRodada = new Map<string, number>();
export function vezDeEntregar(organizacaoId: string, agora = Date.now(), intervaloMs = 20_000): boolean {
  const ultima = ultimaRodada.get(organizacaoId) ?? 0;
  if (agora - ultima < intervaloMs) return false;
  ultimaRodada.set(organizacaoId, agora);
  if (ultimaRodada.size > 5000) ultimaRodada.clear();
  return true;
}
