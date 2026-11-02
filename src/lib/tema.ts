"use client";

/**
 * Tema: CLARO é o padrão para todo mundo. Só fica escuro quem clicar no
 * sol/lua — e só essa escolha é gravada (mesma regra do Gueco).
 * A fonte da verdade é o atributo data-tema do <html>, aplicado antes da
 * pintura pelo SCRIPT_TEMA (sem piscar).
 */
import { useCallback, useSyncExternalStore } from "react";

export type Tema = "claro" | "escuro";
export const TEMA_KEY = "novoaluguel_tema";

/** Script inline do <head>: aplica o tema salvo antes da pintura. */
export const SCRIPT_TEMA = `try{if(localStorage.getItem("${TEMA_KEY}")==="escuro")document.documentElement.dataset.tema="escuro"}catch(e){}`;

function lerTema(): Tema {
  return document.documentElement.dataset.tema === "escuro" ? "escuro" : "claro";
}

function assinar(aoMudar: () => void) {
  const obs = new MutationObserver(aoMudar);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-tema"] });
  return () => obs.disconnect();
}

export function useTema(): [Tema, () => void] {
  const tema = useSyncExternalStore(assinar, lerTema, () => "claro" as Tema);
  const trocar = useCallback(() => {
    const novo: Tema = lerTema() === "claro" ? "escuro" : "claro";
    try {
      localStorage.setItem(TEMA_KEY, novo);
    } catch {
      /* navegação privada */
    }
    if (novo === "escuro") document.documentElement.dataset.tema = "escuro";
    else delete document.documentElement.dataset.tema;
  }, []);
  return [tema, trocar];
}
