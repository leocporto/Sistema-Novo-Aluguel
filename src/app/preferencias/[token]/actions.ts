"use server";

import type { EstadoAcao } from "@/lib/form";
import { clienteAnonimo } from "@/lib/supabase/anonimo";

const marcado = (fd: FormData, k: string) => fd.getAll(k).includes("on");

/** A própria pessoa escolhe por onde recebe (ou sai da lista). Fica registrado (LGPD). */
export async function salvarPreferenciasPublicas(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const nada = fd.get("nada") === "1";
  const { error } = await clienteAnonimo().rpc("salvar_preferencias", {
    p_token: String(fd.get("token") ?? ""),
    p: { whatsapp: marcado(fd, "whatsapp"), email: marcado(fd, "email"), sms: marcado(fd, "sms"), ofertas: marcado(fd, "ofertas"), nada },
  });
  if (error) return { erro: error.message.includes("inválido") ? "Este link não é válido." : "Não foi possível salvar agora. Tente de novo." };
  return { ok: nada ? "Pronto: você não vai mais receber nossas mensagens." : "Preferências salvas. Obrigado!" };
}
