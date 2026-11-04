import "server-only";
import type { CredenciaisProvedor, ResultadoTeste } from "./tipos";

/*
 * "Testar conexão": só para os provedores com chamada real implementada.
 * Cada teste faz UMA leitura inofensiva na API oficial com a credencial
 * guardada (nada é criado lá fora). Os demais respondem "estrutura pronta".
 * Tudo no servidor, com tempo limite e sem devolver a credencial.
 */

const AGENTE = "NovoAluguel/1.0 (sistema de administracao de imoveis)";
const TEMPO_MS = 8000;

type Teste = (c: CredenciaisProvedor) => Promise<ResultadoTeste>;

async function chamar(url: string, headers: Record<string, string>): Promise<Response> {
  return fetch(url, {
    headers: { Accept: "application/json", "User-Agent": AGENTE, ...headers },
    signal: AbortSignal.timeout(TEMPO_MS),
    cache: "no-store",
    redirect: "manual",
  });
}

function falhaRede(e: unknown): ResultadoTeste {
  const nome = e instanceof Error ? e.name : "";
  return { ok: false, mensagem: nome === "TimeoutError" ? "O provedor não respondeu a tempo (8 s). Tente de novo." : "Não foi possível falar com o provedor agora." };
}

const semChave = (c: CredenciaisProvedor, campo = "api_key"): ResultadoTeste | null =>
  c.segredos[campo] ? null : { ok: false, mensagem: "Guarde a chave da API antes de testar." };

const TESTES: Record<string, Teste> = {
  async asaas(c) {
    const falta = semChave(c);
    if (falta) return falta;
    const base = c.ambiente === "producao" ? "https://api.asaas.com/v3" : "https://api-sandbox.asaas.com/v3";
    try {
      const r = await chamar(`${base}/customers?limit=1`, { access_token: c.segredos.api_key });
      if (r.ok) return { ok: true, mensagem: `Chave aceita pelo Asaas (${c.ambiente === "producao" ? "produção" : "sandbox"}).` };
      if (r.status === 401) return { ok: false, mensagem: "O Asaas recusou a chave. Confira se ela é do ambiente escolhido (sandbox × produção)." };
      return { ok: false, mensagem: `O Asaas respondeu ${r.status}.` };
    } catch (e) {
      return falhaRede(e);
    }
  },
  async mercadopago(c) {
    const falta = semChave(c);
    if (falta) return falta;
    try {
      const r = await chamar("https://api.mercadopago.com/users/me", { Authorization: `Bearer ${c.segredos.api_key}` });
      if (r.ok) {
        const d = (await r.json().catch(() => ({}))) as { nickname?: string };
        return { ok: true, mensagem: `Access token aceito pelo Mercado Pago${d.nickname ? ` (conta ${d.nickname})` : ""}.` };
      }
      if (r.status === 401) return { ok: false, mensagem: "O Mercado Pago recusou o access token." };
      return { ok: false, mensagem: `O Mercado Pago respondeu ${r.status}.` };
    } catch (e) {
      return falhaRede(e);
    }
  },
  async resend(c) {
    const falta = semChave(c);
    if (falta) return falta;
    try {
      const r = await chamar("https://api.resend.com/domains", { Authorization: `Bearer ${c.segredos.api_key}` });
      if (r.ok) {
        const d = (await r.json().catch(() => ({}))) as { data?: { name: string; status: string }[] };
        const verificados = (d.data ?? []).filter((x) => x.status === "verified").map((x) => x.name);
        return { ok: true, mensagem: verificados.length ? `Chave aceita. Domínios verificados: ${verificados.join(", ")}.` : "Chave aceita, mas nenhum domínio verificado no Resend ainda." };
      }
      if (r.status === 401) return { ok: false, mensagem: "O Resend recusou a chave." };
      if (r.status === 403) return { ok: true, mensagem: "Chave aceita (permissão só de envio: o Resend não deixa listar os domínios com ela)." };
      return { ok: false, mensagem: `O Resend respondeu ${r.status}.` };
    } catch (e) {
      return falhaRede(e);
    }
  },
  async nominatim() {
    try {
      const r = await chamar("https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=br&q=Pra%C3%A7a%20da%20S%C3%A9%2C%20S%C3%A3o%20Paulo", { "Accept-Language": "pt-BR" });
      if (!r.ok) return { ok: false, mensagem: `O OpenStreetMap respondeu ${r.status}.` };
      const d = (await r.json()) as unknown[];
      return d.length ? { ok: true, mensagem: "OpenStreetMap respondeu: a localização pelo endereço está funcionando." } : { ok: false, mensagem: "O OpenStreetMap respondeu sem resultado." };
    } catch (e) {
      return falhaRede(e);
    }
  },
};

export const provedorTestavel = (id: string) => id in TESTES;

export async function testarConexao(provedor: string, c: CredenciaisProvedor): Promise<ResultadoTeste> {
  const t = TESTES[provedor];
  if (!t) return { ok: false, mensagem: "Estrutura pronta: a chamada a este provedor depende do contrato/credencial e ainda não foi ligada." };
  return t(c);
}
