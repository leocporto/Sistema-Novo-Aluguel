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
  return enviarArquivoComprovante(organizacaoId, "faturas", faturaId, arquivo);
}

/** Comprovante de uma despesa (pasta <org>/despesas/<id>/). */
export async function enviarComprovanteDespesa(organizacaoId: string, despesaId: string, arquivo: File): Promise<string> {
  return enviarArquivoComprovante(organizacaoId, "despesas", despesaId, arquivo);
}

async function enviarArquivoComprovante(organizacaoId: string, pasta: string, id: string, arquivo: File): Promise<string> {
  if (!TIPOS_COMPROVANTE.includes(arquivo.type)) throw new Error("Envie uma imagem (JPG, PNG) ou PDF.");
  if (arquivo.size > TAMANHO_MAX_COMPROVANTE) throw new Error("O arquivo passa de 10 MB.");
  const nome = arquivo.name.normalize("NFD").replace(/[^\w.-]+/g, "_").slice(-80);
  const caminho = `${organizacaoId}/${pasta}/${id}/${Date.now()}-${nome}`;
  const { error } = await clienteNavegador().storage.from("comprovantes").upload(caminho, arquivo, {
    contentType: arquivo.type,
    upsert: false,
  });
  if (error) throw new Error(`Não foi possível enviar o comprovante: ${error.message}`);
  return caminho;
}

export const TIPOS_ARQUIVO_IMOVEL = ["image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf", "video/mp4"];
export const TAMANHO_MAX_ARQUIVO_IMOVEL = 25 * 1024 * 1024;

/** Envia foto, planta ou documento do imóvel para o bucket privado "imoveis". Devolve o caminho. */
export async function enviarArquivoImovel(organizacaoId: string, imovelId: string, arquivo: File): Promise<string> {
  if (!TIPOS_ARQUIVO_IMOVEL.includes(arquivo.type)) throw new Error(`"${arquivo.name}": envie imagem (JPG, PNG, WEBP), PDF ou vídeo MP4.`);
  if (arquivo.size > TAMANHO_MAX_ARQUIVO_IMOVEL) throw new Error(`"${arquivo.name}" passa de 25 MB.`);
  const nome = arquivo.name.normalize("NFD").replace(/[^\w.-]+/g, "_").slice(-80);
  const caminho = `${organizacaoId}/${imovelId}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${nome}`;
  const { error } = await clienteNavegador().storage.from("imoveis").upload(caminho, arquivo, { contentType: arquivo.type, upsert: false });
  if (error) throw new Error(`Não foi possível enviar "${arquivo.name}": ${error.message}`);
  return caminho;
}

/** Documento de uma pessoa (bucket privado "pessoas", pasta <org>/<pessoa>/). */
export async function enviarArquivoPessoa(organizacaoId: string, pessoaId: string, arquivo: File): Promise<string> {
  if (!TIPOS_COMPROVANTE.includes(arquivo.type)) throw new Error(`"${arquivo.name}": envie imagem (JPG, PNG) ou PDF.`);
  if (arquivo.size > TAMANHO_MAX_COMPROVANTE) throw new Error(`"${arquivo.name}" passa de 10 MB.`);
  const nome = arquivo.name.normalize("NFD").replace(/[^\w.-]+/g, "_").slice(-80);
  const caminho = `${organizacaoId}/${pessoaId}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${nome}`;
  const { error } = await clienteNavegador().storage.from("pessoas").upload(caminho, arquivo, { contentType: arquivo.type, upsert: false });
  if (error) throw new Error(`Não foi possível enviar "${arquivo.name}": ${error.message}`);
  return caminho;
}
