"use client";

import { useTransition } from "react";
import { RotateCcw } from "lucide-react";
import { classeBotao } from "@/components/ui";
import { moverCaptacao } from "../actions";

/** Volta a oportunidade para "Em contato" (fica registrado no histórico). */
export function BotaoRetomar({ id }: { id: string }) {
  const [rodando, iniciar] = useTransition();
  return (
    <button
      type="button"
      disabled={rodando}
      className={classeBotao("secundario", "sm")}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        iniciar(async () => {
          const r = await moverCaptacao(id, "contato");
          if (!r.ok) window.alert(r.erro ?? "Não foi possível retomar.");
        });
      }}
    >
      <RotateCcw className="size-3.5" /> Retomar
    </button>
  );
}
