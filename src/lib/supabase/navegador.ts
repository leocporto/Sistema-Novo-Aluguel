"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseConfig } from "./config";

let cliente: SupabaseClient | null = null;

/** Cliente do Supabase no navegador (mesma sessão do servidor, via cookies). */
export function clienteNavegador(): SupabaseClient {
  if (!cliente) {
    const { url, key } = supabaseConfig();
    cliente = createBrowserClient(url, key);
  }
  return cliente;
}

export const TIPOS_COMPROVANTE = ["image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf"];
export const TAMANHO_MAX_COMPROVANTE = 10 * 1024 * 1024;

/**
 * Envia o comprovante para o Storage (bucket privado "comprovantes") na pasta
 * da organização. Devolve o caminho gravado.
 */
export async function enviarComprovante(organizacaoId: string, faturaId: string, arquivo: File): Promise<string> {
  if (!TIPOS_COMPROVANTE.includes(arquivo.type)) throw new Error("Envie uma imagem (JPG, PNG) ou PDF.");
  if (arquivo.size > TAMANHO_MAX_COMPROVANTE) throw new Error("O arquivo passa de 10 MB.");
  const nome = arquivo.name.normalize("NFD").replace(/[^\w.-]+/g, "_").slice(-80);
  const caminho = `${organizacaoId}/faturas/${faturaId}/${Date.now()}-${nome}`;
  const { error } = await clienteNavegador().storage.from("comprovantes").upload(caminho, arquivo, {
    contentType: arquivo.type,
    upsert: false,
  });
  if (error) throw new Error(`Não foi possível enviar o comprovante: ${error.message}`);
  return caminho;
}
