"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { instante } from "@/lib/dominio/agenda";
import { HORAS_SESSAO_PORTAL } from "@/lib/dominio/portal";
import type { EstadoAcao } from "@/lib/form";
import { clienteAnonimo } from "@/lib/supabase/anonimo";
import { COOKIE_CONDOMINIO, lerSessao, tokenValido, visitante } from "./sessao";

/*
 * Ações do portal do condômino (sem login). Toda escrita é por RPC do banco,
 * que confere o token E a sessão (cookie httpOnly), só deixa mexer no que é
 * da pessoa e tem limite por link e por condomínio.
 */

const campo = (fd: FormData, k: string, max = 4000) => String(fd.get(k) ?? "").slice(0, max);
const atualizar = (token: string) => revalidatePath(`/condominio/${token}`, "layout");

async function rpc(nome: string, token: string, extra: Record<string, unknown>): Promise<{ data: unknown; erro?: string }> {
  if (!tokenValido(token)) return { data: null, erro: "Link inválido." };
  const { data, error } = await clienteAnonimo().rpc(nome, { p_token: token, p_sessao: await lerSessao(), ...extra });
  return error ? { data: null, erro: error.message } : { data };
}

export async function entrarCondominio(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const token = campo(fd, "token", 40);
  if (!tokenValido(token)) return { erro: "Link inválido." };
  const { ip, ua } = await visitante();
  const { data, error } = await clienteAnonimo().rpc("cond_portal_entrar", { p_token: token, p_codigo: campo(fd, "codigo", 20), p_ip: ip, p_ua: ua });
  if (error) return { erro: error.message };
  const r = data as { ok: boolean; erro?: string; sessao?: string };
  if (!r.ok || !r.sessao) return { erro: r.erro ?? "Não foi possível entrar." };
  (await cookies()).set(COOKIE_CONDOMINIO, r.sessao, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: `/condominio/${token}`,
    maxAge: HORAS_SESSAO_PORTAL * 3600,
  });
  atualizar(token);
  redirect(`/condominio/${token}`);
}

export async function sairCondominio(token: string): Promise<{ ok: boolean; erro?: string }> {
  if (!tokenValido(token)) return { ok: false, erro: "Link inválido." };
  const sessao = await lerSessao();
  if (sessao) await clienteAnonimo().rpc("cond_portal_sair", { p_token: token, p_sessao: sessao });
  (await cookies()).set(COOKIE_CONDOMINIO, "", { path: `/condominio/${token}`, maxAge: 0 });
  atualizar(token);
  return { ok: true };
}

/** "token|comunicado": confirma a leitura. */
export async function lerComunicado(valor: string): Promise<{ ok: boolean; erro?: string }> {
  const [token, comunicado] = valor.split("|");
  const r = await rpc("cond_portal_ler_comunicado", token, { p_comunicado: comunicado });
  if (r.erro) return { ok: false, erro: r.erro };
  atualizar(token);
  return { ok: true };
}

/** Pede a reserva de uma área comum (a administradora confirma). */
export async function reservarArea(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const token = campo(fd, "token", 40);
  const dia = campo(fd, "dia", 10);
  const ini = campo(fd, "hora_inicio", 5);
  const fimH = campo(fd, "hora_fim", 5);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia) || !/^\d{2}:\d{2}$/.test(ini) || !/^\d{2}:\d{2}$/.test(fimH)) return { erro: "Informe o dia e os horários." };
  const inicio = instante(dia, ini);
  let fim = instante(dia, fimH);
  if (fim <= inicio) fim = new Date(new Date(fim).getTime() + 86_400_000).toISOString();
  const r = await rpc("cond_portal_reservar", token, {
    p_area: campo(fd, "area_id", 40),
    p_unidade: campo(fd, "unidade_id", 40),
    p_inicio: inicio,
    p_fim: fim,
    p_obs: campo(fd, "observacao", 500) || null,
  });
  if (r.erro) return { erro: r.erro };
  atualizar(token);
  return { ok: "Pedido de reserva enviado. A administradora confirma por aqui." };
}

/** "token|reserva": cancela a própria reserva (antes de começar). */
export async function cancelarReservaPortal(valor: string): Promise<{ ok: boolean; erro?: string }> {
  const [token, reserva] = valor.split("|");
  const r = await rpc("cond_portal_cancelar_reserva", token, { p_reserva: reserva });
  if (r.erro) return { ok: false, erro: r.erro };
  atualizar(token);
  return { ok: true };
}

type OcorrenciaAberta = { id: string; numero: number; envio: string; pasta: string };

/** Abre a ocorrência; devolve a pasta liberada (2 horas) para as fotos. */
export async function abrirOcorrenciaPortal(token: string, d: { unidade_id: string; tipo: string; titulo: string; descricao: string }): Promise<{ ok: true; ocorrencia: OcorrenciaAberta } | { ok: false; erro: string }> {
  const r = await rpc("cond_portal_abrir_ocorrencia", token, {
    p_unidade: d.unidade_id || null,
    p_tipo: d.tipo.slice(0, 20),
    p_titulo: d.titulo.slice(0, 160),
    p_descricao: d.descricao.slice(0, 4000),
  });
  if (r.erro) return { ok: false, erro: r.erro };
  atualizar(token);
  return { ok: true, ocorrencia: r.data as OcorrenciaAberta };
}

/** Registra a foto que o navegador já enviou para a pasta liberada. */
export async function registrarFotoPortal(token: string, envio: string, path: string): Promise<{ ok: boolean; erro?: string }> {
  const r = await rpc("cond_portal_registrar_foto", token, { p_envio: envio, p_path: path.slice(0, 300) });
  if (r.erro) return { ok: false, erro: r.erro };
  return { ok: true };
}

export async function responderOcorrenciaPortal(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const token = campo(fd, "token", 40);
  const r = await rpc("cond_portal_responder_ocorrencia", token, { p_ocorrencia: campo(fd, "ocorrencia_id", 40), p_texto: campo(fd, "texto", 2000) });
  if (r.erro) return { erro: r.erro };
  atualizar(token);
  return { ok: "Mensagem enviada." };
}

/** Voto pelo portal (se a assembleia permitir; uma vez por unidade). */
export async function votarPortal(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const token = campo(fd, "token", 40);
  const r = await rpc("cond_portal_votar", token, { p_item: campo(fd, "item_id", 40), p_unidade: campo(fd, "unidade_id", 40), p_opcao: campo(fd, "opcao", 60) });
  if (r.erro) return { erro: r.erro };
  atualizar(token);
  return { ok: "Voto registrado. Obrigado!" };
}
