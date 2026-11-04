"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { HORAS_SESSAO_PORTAL } from "@/lib/dominio/portal";
import type { EstadoAcao } from "@/lib/form";
import { clienteAnonimo } from "@/lib/supabase/anonimo";
import { COOKIE_PORTAL, lerSessao, tokenValido, visitante } from "./sessao";

/*
 * Ações do portal (sem login). Toda escrita é por RPC do banco, que confere o
 * token E a sessão (cookie httpOnly) e só deixa mexer no que é da pessoa.
 */

const campo = (fd: FormData, k: string, max = 4000) => String(fd.get(k) ?? "").slice(0, max);
const atualizar = (token: string) => revalidatePath(`/portal/${token}`, "layout");

/** Confirma a identidade (4 números) e grava a sessão num cookie httpOnly. */
export async function entrarPortal(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const token = campo(fd, "token", 40);
  if (!tokenValido(token)) return { erro: "Link inválido." };
  const { ip, ua } = await visitante();
  const { data, error } = await clienteAnonimo().rpc("portal_entrar", { p_token: token, p_codigo: campo(fd, "codigo", 20), p_ip: ip, p_ua: ua });
  if (error) return { erro: error.message };
  const r = data as { ok: boolean; erro?: string; sessao?: string };
  if (!r.ok || !r.sessao) return { erro: r.erro ?? "Não foi possível entrar." };
  (await cookies()).set(COOKIE_PORTAL, r.sessao, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: `/portal/${token}`,
    maxAge: HORAS_SESSAO_PORTAL * 3600,
  });
  atualizar(token);
  redirect(`/portal/${token}`);
}

export async function sairPortal(token: string): Promise<{ ok: boolean; erro?: string }> {
  if (!tokenValido(token)) return { ok: false, erro: "Link inválido." };
  const sessao = await lerSessao();
  if (sessao) await clienteAnonimo().rpc("portal_sair", { p_token: token, p_sessao: sessao });
  (await cookies()).set(COOKIE_PORTAL, "", { path: `/portal/${token}`, maxAge: 0 });
  atualizar(token);
  return { ok: true };
}

async function rpc(nome: string, token: string, extra: Record<string, unknown>): Promise<{ data: unknown; erro?: string }> {
  if (!tokenValido(token)) return { data: null, erro: "Link inválido." };
  const { data, error } = await clienteAnonimo().rpc(nome, { p_token: token, p_sessao: await lerSessao(), ...extra });
  return error ? { data: null, erro: error.message } : { data };
}

/** Pedido para a equipe: renovação, desocupação (não é criada sozinha) ou contato. */
export async function solicitarPortal(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const token = campo(fd, "token", 40);
  const r = await rpc("portal_solicitar", token, {
    p: { tipo: campo(fd, "tipo", 20), contrato_id: campo(fd, "contrato_id", 40), mensagem: campo(fd, "mensagem", 2000), data_desejada: campo(fd, "data_desejada", 10) },
  });
  if (r.erro) return { erro: r.erro };
  atualizar(token);
  return { ok: `Pedido nº ${(r.data as { numero: number }).numero} enviado. A equipe vai responder por aqui e pelos seus contatos.` };
}

type ChamadoAberto = { id: string; numero: number; envio: string; pasta: string; garantia: boolean };

/** Locatário pede conserto; devolve a pasta liberada para as fotos. */
export async function abrirChamadoPortal(token: string, dados: Record<string, string>): Promise<{ ok: true; chamado: ChamadoAberto } | { ok: false; erro: string }> {
  const p = Object.fromEntries(["contrato_id", "telefone", "titulo", "categoria", "urgencia", "local", "descricao"].map((k) => [k, String(dados[k] ?? "").slice(0, 4000)]));
  const r = await rpc("portal_abrir_chamado", token, { p });
  if (r.erro) return { ok: false, erro: r.erro };
  atualizar(token);
  return { ok: true, chamado: r.data as ChamadoAberto };
}

/** Libera uma pasta (2 horas) para mandar fotos de um chamado. */
export async function prepararEnvioPortal(token: string, chamadoId: string): Promise<{ ok: true; envio: string; pasta: string } | { ok: false; erro: string }> {
  const r = await rpc("portal_preparar_envio", token, { p_chamado: chamadoId });
  if (r.erro) return { ok: false, erro: r.erro };
  const d = r.data as { envio: string; pasta: string };
  return { ok: true, envio: d.envio, pasta: d.pasta };
}

/** Registra a foto/vídeo que o navegador já enviou para a pasta liberada. */
export async function registrarMidiaPortal(token: string, a: { envio: string; path: string; nome: string; tipo: string }): Promise<{ ok: boolean; erro?: string }> {
  const r = await rpc("portal_registrar_midia", token, { p_envio: a.envio, p_path: a.path.slice(0, 300), p_nome: a.nome.slice(0, 160), p_tipo: a.tipo });
  if (r.erro) return { ok: false, erro: r.erro };
  atualizar(token);
  return { ok: true };
}

/** Proprietário aprova ou recusa o orçamento (o banco confere se o valor visto ainda é o mesmo). */
export async function responderOrcamentoPortal(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const token = campo(fd, "token", 40);
  const { ip } = await visitante();
  const aprovar = campo(fd, "aprovar", 2) === "1";
  const r = await rpc("portal_responder_orcamento", token, {
    p: {
      chamado: campo(fd, "chamado", 40),
      orcamento: campo(fd, "orcamento", 40),
      valor: campo(fd, "valor", 20),
      parte: campo(fd, "parte", 20),
      aprovar,
      nome: campo(fd, "nome", 160),
      obs: campo(fd, "obs", 1000),
      ip,
    },
  });
  if (r.erro) return { erro: r.erro };
  atualizar(token);
  return { ok: aprovar ? "Orçamento aprovado. Obrigado! A equipe vai agendar o serviço." : "Resposta registrada: orçamento recusado. A equipe vai entrar em contato." };
}

/** Prestador manda (ou corrige) o orçamento pedido a ele. */
export async function enviarOrcamentoPortal(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const token = campo(fd, "token", 40);
  // Aceita "1.234,56", "1234,56" e "1234.56" (mesma regra de lib/form).
  const digitado = campo(fd, "valor", 20).trim();
  const valor = digitado.includes(",") ? digitado.replace(/\./g, "").replace(",", ".") : digitado;
  const r = await rpc("portal_enviar_orcamento", token, {
    p: {
      orcamento: campo(fd, "orcamento", 40),
      valor,
      prazo_dias: campo(fd, "prazo_dias", 5),
      garantia_dias: campo(fd, "garantia_dias", 5),
      validade: campo(fd, "validade", 10),
      descricao: campo(fd, "descricao", 4000),
    },
  });
  if (r.erro) return { erro: r.erro };
  atualizar(token);
  return { ok: "Orçamento enviado. A equipe vai comparar e avisar se for escolhido." };
}

/** Prestador: começou, terminou ou deixou um comentário. */
export async function execucaoPortal(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const token = campo(fd, "token", 40);
  const acao = campo(fd, "acao", 20);
  const r = await rpc("portal_execucao", token, { p: { chamado: campo(fd, "chamado", 40), acao, comentario: campo(fd, "comentario", 2000) } });
  if (r.erro) return { erro: r.erro };
  atualizar(token);
  return {
    ok:
      acao === "iniciar"
        ? "Registrado: serviço iniciado."
        : acao === "concluir"
          ? "Registrado: você terminou o serviço. A equipe vai conferir e aprovar a conclusão."
          : "Comentário enviado.",
  };
}
