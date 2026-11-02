"use client";

/**
 * Janelas (modais) animam ao abrir e ao fechar em todo o sistema, sem mexer em
 * cada uma: basta a camada escura ter a classe `janela-fundo` e a janela ser o
 * primeiro filho. Ao abrir, a camada ganha `.janela-entra`; ao fechar, o nó
 * removido pelo React volta como "fantasma" (`.janela-sai`, sem clique) por
 * ~180ms e então sai de vez.
 */
import { useEffect } from "react";
import { prefereMenosMovimento } from "./pilula";

const SAIDA_MS = 180;

function ehJanela(n: Node): n is HTMLElement {
  return n instanceof HTMLElement && n.classList.contains("janela-fundo") && !n.classList.contains("janela-sai");
}

export function useMovimentoJanelas() {
  useEffect(() => {
    if (typeof MutationObserver === "undefined") return;
    const obs = new MutationObserver((registros) => {
      const saiu: { el: HTMLElement; pai: Node; proximo: Node | null }[] = [];
      const entrou: HTMLElement[] = [];
      for (const r of registros) {
        r.removedNodes.forEach((n) => {
          if (ehJanela(n)) saiu.push({ el: n, pai: r.target, proximo: r.nextSibling });
        });
        r.addedNodes.forEach((n) => {
          if (ehJanela(n)) entrou.push(n);
        });
      }
      if (!saiu.length && !entrou.length) return;
      const paisSaiu = new Set(saiu.map((s) => s.pai));
      for (const el of entrou) {
        if (el.parentNode && paisSaiu.has(el.parentNode)) continue; // remontagem: já estava na tela
        el.classList.add("janela-entra");
      }
      if (prefereMenosMovimento()) return;
      for (const s of saiu) {
        if (s.el.isConnected || !s.pai.isConnected) continue;
        if (entrou.some((e) => e.parentNode === s.pai)) continue;
        const el = s.el;
        el.classList.remove("janela-entra");
        el.classList.add("janela-sai");
        el.setAttribute("aria-hidden", "true");
        try {
          s.pai.insertBefore(el, s.proximo && s.proximo.parentNode === s.pai ? s.proximo : null);
        } catch {
          continue;
        }
        window.setTimeout(() => el.remove(), SAIDA_MS);
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });
    return () => obs.disconnect();
  }, []);
}
