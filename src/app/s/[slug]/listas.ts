"use client";

import { useMemo, useSyncExternalStore } from "react";

/*
 * Favoritos e comparação ficam no navegador do visitante (localStorage), por
 * site. Leitura e escrita protegidas: em janela anônima ou com o armazenamento
 * bloqueado, a lista simplesmente começa vazia.
 */
export type TipoLista = "favoritos" | "comparar";
const EVENTO = "site-listas";
const chave = (slug: string, tipo: TipoLista) => `site:${slug}:${tipo}`;

function lerBruto(k: string): string {
  try {
    return window.localStorage.getItem(k) ?? "[]";
  } catch {
    return "[]";
  }
}

function assinar(aviso: () => void) {
  window.addEventListener(EVENTO, aviso);
  window.addEventListener("storage", aviso);
  return () => {
    window.removeEventListener(EVENTO, aviso);
    window.removeEventListener("storage", aviso);
  };
}

function converter(bruto: string): string[] {
  try {
    const v: unknown = JSON.parse(bruto);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 100) : [];
  } catch {
    return [];
  }
}

export function useLista(slug: string, tipo: TipoLista): string[] {
  const k = chave(slug, tipo);
  const bruto = useSyncExternalStore(
    assinar,
    () => lerBruto(k),
    () => "[]",
  );
  return useMemo(() => converter(bruto), [bruto]);
}

const semAviso = () => () => {};

/** true só depois que a página "acordou" no navegador (evita agir com a lista vazia do servidor). */
export function useNoNavegador(): boolean {
  return useSyncExternalStore(
    semAviso,
    () => true,
    () => false,
  );
}

export function lerLista(slug: string, tipo: TipoLista): string[] {
  return converter(lerBruto(chave(slug, tipo)));
}

export function gravarLista(slug: string, tipo: TipoLista, lista: string[]) {
  try {
    window.localStorage.setItem(chave(slug, tipo), JSON.stringify(lista));
  } catch {
    // Armazenamento bloqueado: a lista vale só nesta visita.
  }
  window.dispatchEvent(new Event(EVENTO));
}
