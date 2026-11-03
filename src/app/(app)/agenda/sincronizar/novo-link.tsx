"use client";

import { useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { classeBotao } from "@/components/ui";
import { novoTokenAgenda } from "../actions";

export function NovoLinkAgenda() {
  const [rodando, iniciar] = useTransition();
  return (
    <button
      type="button"
      disabled={rodando}
      className={classeBotao("fantasma", "sm")}
      onClick={() => {
        if (!window.confirm("Gerar links novos? Os calendários que usam o link atual param de atualizar até você assinar de novo.")) return;
        iniciar(async () => {
          const r = await novoTokenAgenda();
          if (!r.ok) window.alert(r.erro);
        });
      }}
    >
      <RefreshCw className="size-3.5" /> Gerar links novos
    </button>
  );
}
