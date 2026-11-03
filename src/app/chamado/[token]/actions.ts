"use server";

import { clienteAnonimo } from "@/lib/supabase/anonimo";

type Estado = { erro?: string; ok?: string };
type ChamadoAberto = { id: string; numero: number; upload_token: string; pasta: string; garantia: boolean };

const tokenValido = (t: string) => /^[0-9a-f-]{36}$/i.test(t);

/** Locatário abre o chamado pelo link do contrato (sem login). */
export async function abrirChamadoPublico(token: string, dados: Record<string, string>): Promise<{ ok: true; chamado: ChamadoAberto } | { ok: false; erro: string }> {
  if (!tokenValido(token)) return { ok: false, erro: "Link inválido." };
  const p = Object.fromEntries(["nome", "telefone", "titulo", "categoria", "urgencia", "local", "descricao"].map((k) => [k, String(dados[k] ?? "").slice(0, 4000)]));
  const { data, error } = await clienteAnonimo().rpc("abrir_chamado_link", { p_token: token, p });
  if (error) return { ok: false, erro: error.message };
  return { ok: true, chamado: data as ChamadoAberto };
}

/** Registra a foto/vídeo que o navegador já enviou para a pasta do chamado. */
export async function registrarMidiaPublica(token: string, a: { chamadoId: string; upload: string; path: string; nome: string; tipo: string }): Promise<{ ok: boolean; erro?: string }> {
  if (!tokenValido(token)) return { ok: false, erro: "Link inválido." };
  const { error } = await clienteAnonimo().rpc("registrar_midia_chamado_link", {
    p_token: token,
    p_chamado: a.chamadoId,
    p_upload: a.upload,
    p_path: a.path,
    p_nome: a.nome.slice(0, 160),
    p_tipo: a.tipo,
  });
  return error ? { ok: false, erro: error.message } : { ok: true };
}

/** Locatário confirma que o serviço foi feito. */
export async function confirmarServicoPublico(_: Estado, fd: FormData): Promise<Estado> {
  const token = String(fd.get("token") ?? "");
  if (!tokenValido(token)) return { erro: "Link inválido." };
  const { error } = await clienteAnonimo().rpc("confirmar_servico_chamado", {
    p_token: token,
    p_chamado: String(fd.get("chamado") ?? ""),
    p_comentario: String(fd.get("comentario") ?? "").slice(0, 1000),
  });
  if (error) return { erro: error.message };
  return { ok: "Obrigado! Registramos que o serviço foi feito." };
}
