"use client";

import { useEffect } from "react";

const SW = "/sw-vistorias-campo.js";
const ESCOPO = "/vistorias/campo";

/**
 * Pede ao service worker do app de campo para guardar no aparelho esta tela
 * (de novo, com os dados atuais), a lista de vistorias em campo, as telas
 * extras e os arquivos que a tela já carregou. Sem service worker, não faz nada.
 */
export async function guardarTelasNoAparelho(extras: string[] = []) {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration(ESCOPO);
    const sw = reg?.active;
    if (!sw) return;
    const recursos = performance
      .getEntriesByType("resource")
      .map((e) => e.name)
      .filter((u) => u.startsWith(`${location.origin}/_next/static/`));
    sw.postMessage({ tipo: "guardar", urls: [location.href.split("#")[0], ESCOPO, ...extras, ...recursos] });
  } catch {
    /* o navegador não deixou: a tela continua funcionando enquanto estiver aberta */
  }
}

/** Espera o service worker recém-instalado ficar ativo (no máximo 15 s). */
function ativado(sw: ServiceWorker | null): Promise<void> {
  return new Promise((ok) => {
    if (!sw || sw.state === "activated") return ok();
    const fim = setTimeout(ok, 15_000);
    sw.addEventListener("statechange", () => {
      if (sw.state === "activated" || sw.state === "redundant") {
        clearTimeout(fim);
        ok();
      }
    });
  });
}

/**
 * Liga o modo sem internet do app de campo: registra o service worker (só
 * para /vistorias/campo) e guarda as telas no aparelho. Depois disso a tela
 * abre e recarrega mesmo sem sinal. Devolve false se o navegador não deixar.
 */
export async function ligarModoOffline(paginas: string[] = []): Promise<boolean> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return false;
  try {
    const reg = await navigator.serviceWorker.register(SW, { scope: ESCOPO });
    // Não usa serviceWorker.ready: quem chegou aqui navegando de outra tela do
    // sistema (ex.: /vistorias) fica fora do escopo e o "ready" nunca chegaria.
    if (!reg.active) await ativado(reg.installing ?? reg.waiting);
    await guardarTelasNoAparelho(paginas);
    return true;
  } catch {
    // Sem service worker (navegador antigo, modo privativo, http fora do localhost):
    // a tela funciona sem internet só enquanto estiver aberta.
    return false;
  }
}

/** Liga o modo sem internet ao abrir a tela (lista do app de campo). */
export function GuardarOffline({ paginas = [] }: { paginas?: string[] }) {
  const chave = paginas.join("|");
  useEffect(() => {
    void ligarModoOffline(chave ? chave.split("|") : []);
  }, [chave]);
  return null;
}
