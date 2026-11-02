"use client";

import { useState, useTransition } from "react";
import { Check, Mail, MessageCircle } from "lucide-react";
import { classeBotao } from "@/components/ui";
import { marcarAvisoEnviado } from "./actions";

export interface AvisoDoDia {
  chave: string;
  regraId: string;
  faturaId: string;
  quando: string;
  inquilino: string;
  valor: string;
  vencimento: string;
  canal: "whatsapp" | "email";
  destinatario: string | null;
  link: string | null;
  mensagem: string;
}

/** Cartão de cada aviso do dia: um clique abre a mensagem pronta e marca como enviado. */
export function AvisosHoje({ avisos }: { avisos: AvisoDoDia[] }) {
  const [enviados, setEnviados] = useState<Set<string>>(new Set());
  const [, iniciar] = useTransition();

  if (avisos.length === 0) {
    return (
      <div className="flex items-center gap-3 rounded-card border border-ok-bd bg-ok-bg px-5 py-4 text-sm text-texto">
        <Check className="size-5 text-ok" /> Nenhum aviso para mandar hoje.
      </div>
    );
  }

  return (
    <ul className="grid gap-3 md:grid-cols-2">
      {avisos.map((a) => {
        const feito = enviados.has(a.chave);
        const Icone = a.canal === "whatsapp" ? MessageCircle : Mail;
        return (
          <li key={a.chave} className={`rounded-card border border-borda bg-card p-4 transition ${feito ? "opacity-60" : ""}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-[15px] font-semibold text-texto">{a.inquilino}</div>
                <div className="text-[13px] text-texto-2">
                  {a.valor} · vence {a.vencimento}
                </div>
                <div className="mt-1 text-xs text-mudo">{a.quando}</div>
              </div>
              {feito ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-ok-bd bg-ok-bg px-2.5 py-1 text-xs font-semibold text-ok">
                  <Check className="size-3.5" /> Enviado
                </span>
              ) : a.link ? (
                <button
                  type="button"
                  className={classeBotao("primario", "sm")}
                  onClick={() => {
                    window.open(a.link!, "_blank", "noopener");
                    setEnviados((s) => new Set(s).add(a.chave));
                    iniciar(async () => {
                      await marcarAvisoEnviado({ regraId: a.regraId, faturaId: a.faturaId, destinatario: a.destinatario });
                    });
                  }}
                >
                  <Icone className="size-4" /> Enviar {a.canal === "whatsapp" ? "no WhatsApp" : "e-mail"}
                </button>
              ) : (
                <span className="rounded-full border border-alerta-bd bg-alerta-bg px-2.5 py-1 text-xs font-semibold text-alerta">
                  Sem {a.canal === "whatsapp" ? "telefone" : "e-mail"} no cadastro
                </span>
              )}
            </div>
            <p className="mt-3 line-clamp-2 text-[13px] text-mudo">{a.mensagem}</p>
          </li>
        );
      })}
    </ul>
  );
}
