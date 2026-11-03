"use client";

import { TAMANHO_MAX_COMPROVANTE, TIPOS_COMPROVANTE, clienteNavegador } from "@/lib/supabase/navegador";

/**
 * Envia um documento da análise para o bucket privado "analises".
 * pasta: "<organizacao>/<analise>" (equipe) ou "ficha/<token>" (candidato pela ficha online).
 */
export async function enviarArquivoAnalise(pasta: string, arquivo: File): Promise<string> {
  if (!TIPOS_COMPROVANTE.includes(arquivo.type)) throw new Error(`"${arquivo.name}": envie foto (JPG, PNG) ou PDF.`);
  if (arquivo.size > TAMANHO_MAX_COMPROVANTE) throw new Error(`"${arquivo.name}" passa de 10 MB.`);
  const nome = arquivo.name.normalize("NFD").replace(/[^\w.-]+/g, "_").slice(-80);
  const caminho = `${pasta}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${nome}`;
  const { error } = await clienteNavegador().storage.from("analises").upload(caminho, arquivo, { contentType: arquivo.type, upsert: false });
  if (error) throw new Error(`Não foi possível enviar "${arquivo.name}": ${error.message}`);
  return caminho;
}
