"use client";

import { useState, useTransition } from "react";
import { Check, Copy, RefreshCw } from "lucide-react";
import { classeBotao } from "@/components/ui";
import { novoLinkCaptacao } from "../actions";

export function Copiar({ texto, rotulo = "Copiar" }: { texto: string; rotulo?: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      type="button"
      className={classeBotao("secundario", "sm")}
      onClick={async () => {
        await navigator.clipboard.writeText(texto);
        setOk(true);
        setTimeout(() => setOk(false), 1800);
      }}
    >
      {ok ? <Check className="size-3.5" /> : <Copy className="size-3.5" />} {ok ? "Copiado" : rotulo}
    </button>
  );
}

export function NovoLink() {
  const [rodando, iniciar] = useTransition();
  return (
    <button
      type="button"
      disabled={rodando}
      className={classeBotao("fantasma", "sm")}
      onClick={() => {
        if (!window.confirm("Gerar um link novo? O link atual (e a API) param de funcionar — atualize onde ele estiver publicado.")) return;
        iniciar(async () => {
          const r = await novoLinkCaptacao();
          if (!r.ok) window.alert(r.erro);
        });
      }}
    >
      <RefreshCw className="size-3.5" /> Gerar link novo
    </button>
  );
}
