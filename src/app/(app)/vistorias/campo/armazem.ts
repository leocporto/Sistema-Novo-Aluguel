/**
 * Armazém do aparelho para o app de campo (só no navegador):
 * - "filas": as alterações de cada vistoria que ainda não subiram (e, à
 *   parte, as que o sistema recusou);
 * - "arquivos": as fotos e vídeos tirados sem internet, esperando o envio.
 * Usa IndexedDB; se o navegador não tiver, guarda a fila no localStorage
 * (e as fotos só na memória, até enviar).
 */
import type { OpCampo, OpRecusada } from "@/lib/dominio/vistorias";

const BANCO = "novoaluguel-vistorias";
const memoria = new Map<string, ArquivoGuardado>();

export type ArquivoGuardado = { blob: Blob; mime: string; nome: string };

const temIdb = () => typeof indexedDB !== "undefined";

function abrir(): Promise<IDBDatabase> {
  return new Promise((ok, falha) => {
    const r = indexedDB.open(BANCO, 1);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains("filas")) db.createObjectStore("filas");
      if (!db.objectStoreNames.contains("arquivos")) db.createObjectStore("arquivos");
    };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => falha(r.error);
  });
}

async function usar<T>(loja: "filas" | "arquivos", modo: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest | void): Promise<T | undefined> {
  const db = await abrir();
  try {
    return await new Promise<T | undefined>((ok, falha) => {
      const t = db.transaction(loja, modo);
      const req = fn(t.objectStore(loja));
      t.oncomplete = () => ok(req ? (req.result as T) : undefined);
      t.onerror = () => falha(t.error);
      t.onabort = () => falha(t.error);
    });
  } finally {
    db.close();
  }
}

export async function lerFila(vistoriaId: string): Promise<OpCampo[]> {
  try {
    if (temIdb()) return (await usar<OpCampo[]>("filas", "readonly", (s) => s.get(vistoriaId))) ?? [];
    return JSON.parse(localStorage.getItem(`vistoria-fila-${vistoriaId}`) ?? "[]") as OpCampo[];
  } catch {
    return [];
  }
}

export async function gravarFila(vistoriaId: string, fila: OpCampo[]) {
  try {
    if (temIdb()) await usar("filas", "readwrite", (s) => (fila.length ? s.put(fila, vistoriaId) : s.delete(vistoriaId)));
    else if (fila.length) localStorage.setItem(`vistoria-fila-${vistoriaId}`, JSON.stringify(fila));
    else localStorage.removeItem(`vistoria-fila-${vistoriaId}`);
  } catch {
    /* sem espaço no aparelho: a fila continua na memória da tela */
  }
}

/** Alterações que o sistema não aceitou (ficam até a pessoa tentar de novo ou descartar). */
export async function lerRecusadas(vistoriaId: string): Promise<OpRecusada[]> {
  const chave = `${vistoriaId}|recusadas`;
  try {
    if (temIdb()) return (await usar<OpRecusada[]>("filas", "readonly", (s) => s.get(chave))) ?? [];
    return JSON.parse(localStorage.getItem(`vistoria-${chave}`) ?? "[]") as OpRecusada[];
  } catch {
    return [];
  }
}

export async function gravarRecusadas(vistoriaId: string, lista: OpRecusada[]) {
  const chave = `${vistoriaId}|recusadas`;
  try {
    if (temIdb()) await usar("filas", "readwrite", (s) => (lista.length ? s.put(lista, chave) : s.delete(chave)));
    else if (lista.length) localStorage.setItem(`vistoria-${chave}`, JSON.stringify(lista));
    else localStorage.removeItem(`vistoria-${chave}`);
  } catch {
    /* sem espaço no aparelho: a lista continua na memória da tela */
  }
}

export async function guardarArquivo(id: string, a: ArquivoGuardado) {
  memoria.set(id, a);
  try {
    if (temIdb()) await usar("arquivos", "readwrite", (s) => s.put(a, id));
  } catch {
    /* fica só na memória */
  }
}

export async function lerArquivo(id: string): Promise<ArquivoGuardado | undefined> {
  if (memoria.has(id)) return memoria.get(id);
  try {
    if (temIdb()) return await usar<ArquivoGuardado>("arquivos", "readonly", (s) => s.get(id));
  } catch {
    /* nada */
  }
  return undefined;
}

export async function apagarArquivo(id: string) {
  memoria.delete(id);
  try {
    if (temIdb()) await usar("arquivos", "readwrite", (s) => s.delete(id));
  } catch {
    /* nada */
  }
}

/** O aparelho guarda as fotos mesmo se fechar a tela? */
export const guardaFotosNoAparelho = () => temIdb();
