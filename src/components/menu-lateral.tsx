"use client";

import { Moon, Sun } from "lucide-react";
import { useTema } from "@/lib/tema";

/** Botão sol/lua: troca entre claro (padrão) e escuro. */
export function BotaoTema({ className = "" }: { className?: string }) {
  const [tema, trocar] = useTema();
  return (
    <button
      type="button"
      onClick={trocar}
      title={tema === "claro" ? "Modo escuro" : "Modo claro"}
      aria-label={tema === "claro" ? "Ativar modo escuro" : "Ativar modo claro"}
      className={`flex size-10 items-center justify-center rounded-btn border border-borda bg-card text-texto-2 transition hover:border-borda-forte hover:text-texto ${className}`}
    >
      {tema === "claro" ? <Moon className="size-[17px]" /> : <Sun className="size-[17px]" />}
    </button>
  );
}
