"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import type { EstadoAcao } from "@/lib/form";
import { clienteAnonimo } from "@/lib/supabase/anonimo";

const TOKEN = /^[0-9a-f-]{36}$/i;

function amigavel(msg: string) {
  if (msg.includes("autorização") || msg.includes("expirado") || msg.includes("Limite") || msg.includes("inválido")) return msg;
  return "Não foi possível enviar agora. Tente de novo em instantes.";
}

/** O candidato envia a ficha (dados, renda e autorização LGPD) pela RPC pública ficha_enviar. */
export async function enviarFicha(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  // Campo escondido: robôs preenchem, pessoas não.
  if (String(fd.get("site_url") ?? "")) return { ok: "Recebemos sua ficha. Obrigado!" };
  const token = String(fd.get("token") ?? "");
  if (!TOKEN.test(token)) return { erro: "Link inválido ou expirado." };
  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip") || "";
  const campo = (k: string) => String(fd.get(k) ?? "").trim().slice(0, 2000);
  const rendas = [0, 1, 2].map((i) => ({ tipo: campo(`renda_tipo_${i}`), fonte: campo(`renda_fonte_${i}`), valor: campo(`renda_valor_${i}`) })).filter((r) => r.valor);
  const { error } = await clienteAnonimo().rpc("ficha_enviar", {
    p_token: token,
    p: {
      telefone: campo("telefone"),
      email: campo("email"),
      profissao: campo("profissao"),
      estado_civil: campo("estado_civil"),
      empregador: campo("empregador"),
      moradores: campo("moradores"),
      moradores_obs: campo("moradores_obs"),
      observacoes: campo("observacoes"),
      rendas,
      consentimento: fd.getAll("consentimento").includes("on"),
      ip,
      ua: h.get("user-agent") ?? "",
    },
  });
  if (error) return { erro: amigavel(error.message) };
  revalidatePath(`/ficha/${token}`);
  return { ok: "Recebemos sua ficha! Agora envie os documentos logo abaixo." };
}

/** Registra um arquivo que o candidato acabou de subir para ficha/<token>/. */
export async function registrarArquivoFicha(token: string, path: string, nome: string, documentoId: string | null): Promise<{ ok: boolean; erro?: string }> {
  if (!TOKEN.test(token)) return { ok: false, erro: "Link inválido ou expirado." };
  const { error } = await clienteAnonimo().rpc("ficha_registrar_arquivo", { p_token: token, p: { path, nome, documento_id: documentoId } });
  if (error) return { ok: false, erro: amigavel(error.message) };
  return { ok: true };
}
