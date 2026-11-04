import "server-only";

/**
 * Envio de e-mail pelo Resend (https://resend.com), só no servidor.
 * Opcional: sem RESEND_API_KEY nada é enviado e quem chamou decide o que fazer
 * (ex.: deixar "pronto para enviar"). O remetente vem de RELATORIOS_EMAIL_DE
 * (ex.: "Imobiliária <relatorios@seudominio.com.br>", domínio verificado no
 * Resend); sem ele, o remetente de teste do Resend.
 */
export type ResultadoEmail = { ok: boolean; configurado: boolean; erro?: string };
export type Anexo = { nome: string; conteudo: string; tipo: string };

export const emailConfigurado = () => Boolean(process.env.RESEND_API_KEY);

export async function enviarEmail(m: { para: string[]; assunto: string; html: string; anexos?: Anexo[] }): Promise<ResultadoEmail> {
  const chave = process.env.RESEND_API_KEY;
  if (!chave) return { ok: false, configurado: false, erro: "Envio de e-mail não configurado." };
  if (!m.para.length) return { ok: false, configurado: true, erro: "Sem destinatário." };
  const de = process.env.RELATORIOS_EMAIL_DE || "Novo Aluguel <onboarding@resend.dev>";
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${chave}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: de,
        to: m.para.slice(0, 50),
        subject: m.assunto.slice(0, 200),
        html: m.html,
        attachments: (m.anexos ?? []).map((a) => ({ filename: a.nome, content: Buffer.from(a.conteudo, "utf8").toString("base64"), content_type: a.tipo })),
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) {
      const corpo = await r.text().catch(() => "");
      // Não devolve o corpo inteiro (pode trazer dados da conta): só o motivo.
      const motivo = /"message"\s*:\s*"([^"]{1,200})"/.exec(corpo)?.[1] ?? `HTTP ${r.status}`;
      return { ok: false, configurado: true, erro: `O provedor de e-mail recusou: ${motivo}` };
    }
    return { ok: true, configurado: true };
  } catch (e) {
    const tempo = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    return { ok: false, configurado: true, erro: tempo ? "O provedor de e-mail não respondeu a tempo." : "Não foi possível falar com o provedor de e-mail." };
  }
}

/** Escapa texto para colocar no HTML do e-mail. */
export function escaparHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
