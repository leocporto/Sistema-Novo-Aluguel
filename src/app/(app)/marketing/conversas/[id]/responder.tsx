"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Send } from "lucide-react";
import { classeBotao } from "@/components/ui";
import { linkEmail, linkSms, primeiroNome, renderizarMensagem } from "@/lib/dominio/marketing";
import { linkWhatsapp } from "@/lib/whatsapp";
import { responderConversa } from "../../actions";

type Modelo = { id: string; nome: string; corpo: string };

/**
 * Responder sem a API oficial: grava a resposta na conversa (e no histórico do
 * CRM) e abre o WhatsApp/e-mail/SMS com o texto pronto para enviar.
 */
export function Responder({
  conversaId,
  canal,
  contato,
  nome,
  imobiliaria,
  modelos,
}: {
  conversaId: string;
  canal: string;
  contato: string;
  nome: string | null;
  imobiliaria: string;
  modelos: Modelo[];
}) {
  const [texto, setTexto] = useState("");
  const [rodando, iniciar] = useTransition();
  const router = useRouter();
  const destino = (t: string) =>
    canal === "email" ? linkEmail(contato, `Contato — ${imobiliaria}`, t) : canal === "sms" ? linkSms(contato, t) : canal === "whatsapp" ? linkWhatsapp(contato, t) : null;

  function enviar() {
    const t = texto.trim();
    if (!t) return;
    const link = destino(t);
    // Abre já (no clique), para o navegador não bloquear a janela.
    if (link) window.open(link, "_blank", "noopener");
    iniciar(async () => {
      const r = await responderConversa(conversaId, t);
      if (!r.ok) window.alert(r.erro ?? "Não foi possível registrar.");
      else setTexto("");
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      {modelos.length > 0 && (
        <select
          aria-label="Usar um modelo de mensagem"
          className="min-h-[34px] w-full rounded-[9px] border border-borda-forte bg-input px-2 text-[13px] text-texto"
          value=""
          onChange={(e) => {
            const m = modelos.find((x) => x.id === e.target.value);
            if (m) setTexto(renderizarMensagem(m.corpo, { nome: nome ?? "", primeiro_nome: primeiroNome(nome), imobiliaria }));
          }}
        >
          <option value="">Usar um modelo…</option>
          {modelos.map((m) => (
            <option key={m.id} value={m.id}>
              {m.nome}
            </option>
          ))}
        </select>
      )}
      <textarea
        aria-label="Resposta"
        rows={4}
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        placeholder="Escreva a resposta…"
        className="w-full min-h-[46px] rounded-btn border border-borda-forte bg-input px-3.5 py-2.5 text-[15px] text-texto outline-none transition placeholder:text-fraco focus:border-acento focus:ring-4 focus:ring-acento-bg"
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-mudo">A resposta fica registrada aqui e no histórico do lead/da pessoa.</span>
        <button type="button" className={classeBotao("primario")} disabled={rodando || !texto.trim()} onClick={enviar}>
          <Send className="size-4" /> {canal === "email" ? "Abrir e-mail e registrar" : canal === "sms" ? "Abrir SMS e registrar" : canal === "whatsapp" ? "Abrir WhatsApp e registrar" : "Registrar resposta"}
        </button>
      </div>
    </div>
  );
}
