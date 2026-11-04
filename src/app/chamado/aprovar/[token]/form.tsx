"use client";

import { useActionState } from "react";
import { responderAprovacao } from "./actions";

const campo = "min-h-11 w-full rounded-[11px] border border-borda-forte bg-input px-3 text-[15px] text-texto outline-none focus:border-acento";
const botao = "inline-flex h-11 items-center justify-center rounded-[11px] px-5 text-[14px] font-semibold transition hover:-translate-y-px active:scale-[.98] disabled:opacity-50";

/** Aprovar ou recusar o orçamento (o botão clicado decide). */
export function FormAprovacao({ token, versao, nome }: { token: string; versao: string; nome: string }) {
  const [estado, enviar, enviando] = useActionState(responderAprovacao, {});
  if (estado.ok) return <div className="rounded-[14px] border border-ok-bd bg-ok-bg px-4 py-4 text-[15px] font-medium text-ok">{estado.ok}</div>;
  return (
    <form action={enviar} className="space-y-3">
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="versao" value={versao} />
      {estado.erro && <div className="rounded-[12px] border border-ruim-bd bg-ruim-bg px-4 py-2.5 text-sm text-ruim">{estado.erro}</div>}
      <input name="nome" required defaultValue={nome} className={campo} placeholder="Seu nome completo" aria-label="Seu nome completo" autoComplete="name" />
      <textarea name="obs" rows={3} className={`${campo} py-2`} aria-label="Observação" placeholder="Observação (opcional): peça nota fiscal, prefira outro prestador…" />
      <div className="flex flex-wrap gap-2">
        <button
          name="decisao"
          value="aprovar"
          disabled={enviando}
          onClick={(e) => {
            if (!window.confirm("Aprovar este orçamento?")) e.preventDefault();
          }}
          className={`${botao} border border-acento bg-acento text-white hover:bg-acento-hot`}
        >
          {enviando ? "Enviando…" : "Aprovar orçamento"}
        </button>
        <button
          name="decisao"
          value="recusar"
          disabled={enviando}
          onClick={(e) => {
            if (!window.confirm("Recusar este orçamento?")) e.preventDefault();
          }}
          className={`${botao} border border-borda text-texto-2`}
        >
          Recusar
        </button>
      </div>
    </form>
  );
}
