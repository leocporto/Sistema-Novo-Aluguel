"use client";

import { clienteNavegador } from "./navegador";

/** Fotos e vídeos dos chamados de manutenção (bucket privado "manutencao"). */
export const TIPOS_MIDIA_CHAMADO = ["image/jpeg", "image/png", "image/webp", "image/heic", "video/mp4", "video/quicktime", "video/webm"];
export const MAX_FOTO_CHAMADO = 10 * 1024 * 1024;
export const MAX_VIDEO_CHAMADO = 50 * 1024 * 1024;

export const tipoDaMidia = (arquivo: File): "foto" | "video" => (arquivo.type.startsWith("video/") ? "video" : "foto");

function validar(arquivo: File) {
  if (!TIPOS_MIDIA_CHAMADO.includes(arquivo.type)) throw new Error(`"${arquivo.name}": envie foto (JPG, PNG, WEBP, HEIC) ou vídeo (MP4, MOV, WEBM).`);
  const max = tipoDaMidia(arquivo) === "video" ? MAX_VIDEO_CHAMADO : MAX_FOTO_CHAMADO;
  if (arquivo.size > max) throw new Error(`"${arquivo.name}" passa de ${max / 1024 / 1024} MB.`);
}

/** Extensão pelo tipo do arquivo (o banco só aceita foto/vídeo com a extensão certa no envio pelo link). */
const EXTENSAO: Record<string, string[]> = {
  "image/jpeg": ["jpg", "jpeg"],
  "image/png": ["png"],
  "image/webp": ["webp"],
  "image/heic": ["heic"],
  "video/mp4": ["mp4"],
  "video/quicktime": ["mov"],
  "video/webm": ["webm"],
};

function nomeSeguro(arquivo: File) {
  const nome = arquivo.name.normalize("NFD").replace(/[^\w.-]+/g, "_").slice(-80);
  const ext = EXTENSAO[arquivo.type];
  const atual = nome.split(".").pop()?.toLowerCase() ?? "";
  return ext && !(nome.includes(".") && ext.includes(atual)) ? `${nome.slice(0, 74)}.${ext[0]}` : nome;
}

/**
 * Envia para a pasta informada (sem barra no fim) e devolve o caminho gravado.
 * - equipe: `<org>/<chamado>`;
 * - locatário pelo link (sem login): `<org>/<chamado>/<upload_token>` — o banco
 *   só aceita essa pasta, do chamado que ele acabou de abrir.
 */
export async function enviarMidiaChamado(pasta: string, arquivo: File): Promise<string> {
  validar(arquivo);
  const caminho = `${pasta}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${nomeSeguro(arquivo)}`;
  const { error } = await clienteNavegador().storage.from("manutencao").upload(caminho, arquivo, { contentType: arquivo.type, upsert: false });
  if (error) throw new Error(`Não foi possível enviar "${arquivo.name}": ${error.message}`);
  return caminho;
}
