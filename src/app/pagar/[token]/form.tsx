"use client";

import { useActionState, useState } from "react";
import { informarPagamento } from "./actions";

const campo = "min-h-11 w-full rounded-[11px] border border-borda-forte bg-input px-3 text-[15px] text-texto";
const botao = "inline-flex h-11 items-center justify-center rounded-[11px] px-5 text-[14px] font-semibold transition hover:-translate-y-px active:scale-[.98] disabled:opacity-50";

/** Formulário "Já paguei" da 2ª via pública. */
export function FormJaPaguei({ token, hoje }: { token: string; hoje: string }) {
  const [estado, enviar, enviando] = useActionState(informarPagamento, {});
  const [aberto, setAberto] = useState(false);
  if (estado.ok) return <div className="rounded-[14px] border border-ok-bd bg-ok-bg px-4 py-3 text-[15px] font-medium text-ok">{estado.ok}</div>;
  if (!aberto)
    return (
      <button type="button" onClick={() => setAberto(true)} className={`${botao} border border-borda text-texto`}>
        Já paguei
      </button>
    );
  return (
    <form action={enviar} className="space-y-3">
      <input type="hidden" name="token" value={token} />
      {estado.erro && <div className="rounded-[12px] border border-ruim-bd bg-ruim-bg px-4 py-2.5 text-sm text-ruim">{estado.erro}</div>}
      <label className="flex flex-col gap-1 text-sm text-texto-2">
        Paguei em
        <input type="date" name="data" required defaultValue={hoje} max={hoje} className={campo} />
      </label>
      <textarea name="mensagem" rows={2} maxLength={500} aria-label="Mensagem" placeholder="Algum detalhe? (opcional — ex.: paguei por Pix do banco X)" className={`${campo} py-2`} />
      <div className="flex gap-2">
        <button type="button" onClick={() => setAberto(false)} className={`${botao} border border-borda text-texto-2`}>
          Voltar
        </button>
        <button disabled={enviando} className={`${botao} border border-acento bg-acento text-white hover:bg-acento-hot`}>
          {enviando ? "Enviando…" : "Avisar que paguei"}
        </button>
      </div>
    </form>
  );
}
