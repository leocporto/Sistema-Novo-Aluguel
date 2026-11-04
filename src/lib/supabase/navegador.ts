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

/**
 * Regrava a imagem (canvas) para tirar os metadados: o EXIF da foto do celular
 * guarda a latitude e a longitude exatas de onde ela foi tirada, e as fotos do
 * imóvel vão para o site e para os portais — mesmo quando o endereço está oculto.
 * A orientação da câmera já sai aplicada. Lados maiores que 2560 px são reduzidos.
 * Se o navegador não conseguir abrir a imagem (ex.: HEIC fora do iPhone), devolve null.
 */
async function imagemSemMetadados(arquivo: File): Promise<{ blob: Blob; tipo: string; extensao: string } | null> {
  if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(arquivo.type) || typeof createImageBitmap !== "function") return null;
  try {
    const bmp = await createImageBitmap(arquivo, { imageOrientation: "from-image" });
    const escala = Math.min(1, 2560 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bmp.width * escala));
    canvas.height = Math.max(1, Math.round(bmp.height * escala));
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    // PNG continua PNG (plantas com fundo transparente); o resto vira JPEG.
    const tipo = arquivo.type === "image/png" ? "image/png" : "image/jpeg";
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, tipo, 0.9));
    return blob ? { blob, tipo, extensao: tipo === "image/png" ? "png" : "jpg" } : null;
  } catch {
    return null;
  }
}

/**
 * Envia foto, planta ou documento do imóvel para o bucket privado "imoveis". Devolve o caminho.
 * Imagens sobem sem metadados (sem o GPS da câmera) e sem o nome original no caminho.
 */
export async function enviarArquivoImovel(organizacaoId: string, imovelId: string, arquivo: File): Promise<string> {
  if (!TIPOS_ARQUIVO_IMOVEL.includes(arquivo.type)) throw new Error(`"${arquivo.name}": envie imagem (JPG, PNG, WEBP), PDF ou vídeo MP4.`);
  if (arquivo.size > TAMANHO_MAX_ARQUIVO_IMOVEL) throw new Error(`"${arquivo.name}" passa de 25 MB.`);
  const prefixo = `${organizacaoId}/${imovelId}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const limpa = await imagemSemMetadados(arquivo);
  const nome = arquivo.name.normalize("NFD").replace(/[^\w.-]+/g, "_").slice(-80);
  const extensao = /\.(\w{1,5})$/.exec(nome)?.[1]?.toLowerCase() ?? "img";
  const caminho = limpa ? `${prefixo}.${limpa.extensao}` : arquivo.type.startsWith("image/") ? `${prefixo}.${extensao}` : `${prefixo}-${nome}`;
  const corpo = limpa?.blob ?? arquivo;
  const tipo = limpa?.tipo ?? arquivo.type;
  const { error } = await clienteNavegador().storage.from("imoveis").upload(caminho, corpo, { contentType: tipo, upsert: false });
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

/** Documento de uma venda (bucket privado "vendas", pasta <org>/<venda>/). */
export async function enviarArquivoVenda(organizacaoId: string, vendaId: string, arquivo: File): Promise<string> {
  if (!TIPOS_COMPROVANTE.includes(arquivo.type)) throw new Error(`"${arquivo.name}": envie imagem (JPG, PNG) ou PDF.`);
  if (arquivo.size > TAMANHO_MAX_COMPROVANTE) throw new Error(`"${arquivo.name}" passa de 10 MB.`);
  const nome = arquivo.name.normalize("NFD").replace(/[^\w.-]+/g, "_").slice(-80);
  const caminho = `${organizacaoId}/${vendaId}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${nome}`;
  const { error } = await clienteNavegador().storage.from("vendas").upload(caminho, arquivo, { contentType: arquivo.type, upsert: false });
  if (error) throw new Error(`Não foi possível enviar "${arquivo.name}": ${error.message}`);
  return caminho;
}

export const TIPOS_DOCUMENTO_ARQUIVO = [...TIPOS_COMPROVANTE, "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"];

/** Arquivo da central de documentos (bucket privado "documentos", pasta <org>/). */
export async function enviarArquivoDocumento(organizacaoId: string, arquivo: File): Promise<string> {
  if (!TIPOS_DOCUMENTO_ARQUIVO.includes(arquivo.type)) throw new Error(`"${arquivo.name}": envie PDF, imagem ou Word.`);
  if (arquivo.size > 20 * 1024 * 1024) throw new Error(`"${arquivo.name}" passa de 20 MB.`);
  const nome = arquivo.name.normalize("NFD").replace(/[^\w.-]+/g, "_").slice(-80);
  const caminho = `${organizacaoId}/arquivos/${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${nome}`;
  const { error } = await clienteNavegador().storage.from("documentos").upload(caminho, arquivo, { contentType: arquivo.type, upsert: false });
  if (error) throw new Error(`Não foi possível enviar "${arquivo.name}": ${error.message}`);
  return caminho;
}
