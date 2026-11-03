"use client";

import { useActionState, useState } from "react";
import { assinar, recusar } from "./actions";

const campo = "min-h-11 w-full rounded-[11px] border border-borda-forte bg-input px-3 text-[15px] text-texto";
const botao = "inline-flex h-11 items-center justify-center rounded-[11px] px-5 text-[14px] font-semibold transition hover:-translate-y-px active:scale-[.98]";

export function FormAssinatura({ token, nome }: { token: string; nome: string }) {
  const [estado, enviar, enviando] = useActionState(assinar, {});
  const [estadoR, enviarR, recusando] = useActionState(recusar, {});
  const [modoRecusa, setModoRecusa] = useState(false);
  if (estado.ok || estadoR.ok)
    return <div className="rounded-[14px] border border-ok-bd bg-ok-bg px-4 py-4 text-[15px] font-medium text-ok">{estado.ok ?? estadoR.ok}</div>;
  if (modoRecusa)
    return (
      <form action={enviarR} className="space-y-3">
        <input type="hidden" name="token" value={token} />
        {estadoR.erro && <div className="rounded-[12px] border border-ruim-bd bg-ruim-bg px-4 py-2.5 text-sm text-ruim">{estadoR.erro}</div>}
        <textarea name="motivo" rows={3} className={`${campo} py-2`} placeholder="Por que você não vai assinar?" />
        <div className="flex gap-2">
          <button type="button" onClick={() => setModoRecusa(false)} className={`${botao} border border-borda text-texto`}>
            Voltar
          </button>
          <button disabled={recusando} className={`${botao} border border-ruim bg-ruim text-white`}>
            Recusar assinatura
          </button>
        </div>
      </form>
    );
  return (
    <form action={enviar} className="space-y-3">
      <input type="hidden" name="token" value={token} />
      {estado.erro && <div className="rounded-[12px] border border-ruim-bd bg-ruim-bg px-4 py-2.5 text-sm text-ruim">{estado.erro}</div>}
      <div className="grid gap-3 sm:grid-cols-2">
        <input name="nome" required defaultValue={nome} className={campo} placeholder="Nome completo" autoComplete="name" />
        <input name="cpf" required inputMode="numeric" className={campo} placeholder="CPF ou CNPJ" />
      </div>
      <label className="flex items-start gap-2 text-sm text-texto-2">
        <input type="checkbox" name="aceite" required className="mt-1 size-4" />
        Li o documento acima, concordo com o conteúdo e aceito assiná-lo eletronicamente.
      </label>
      <div className="flex flex-wrap gap-2">
        <button disabled={enviando} className={`${botao} border border-acento bg-acento text-white hover:bg-acento-hot`}>
          {enviando ? "Assinando…" : "Assinar documento"}
        </button>
        <button type="button" onClick={() => setModoRecusa(true)} className={`${botao} border border-borda text-texto-2`}>
          Não vou assinar
        </button>
      </div>
    </form>
  );
}
