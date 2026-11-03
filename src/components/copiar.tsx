"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { classeBotao } from "./ui";

/** Botão que copia um texto (link, código…) e mostra "Copiado". */
export function Copiar({ texto, rotulo = "Copiar" }: { texto: string; rotulo?: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      type="button"
      className={classeBotao("secundario", "sm")}
      onClick={async (e) => {
        e.stopPropagation();
        await navigator.clipboard.writeText(texto);
        setOk(true);
        setTimeout(() => setOk(false), 1800);
      }}
    >
      {ok ? <Check className="size-3.5" /> : <Copy className="size-3.5" />} {ok ? "Copiado" : rotulo}
    </button>
  );
}
