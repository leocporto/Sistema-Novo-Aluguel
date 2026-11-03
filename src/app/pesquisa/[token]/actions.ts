"use server";

import type { EstadoAcao } from "@/lib/form";
import { clienteAnonimo } from "@/lib/supabase/anonimo";

/** Resposta pública da pesquisa de satisfação (uma vez só, pelo token). */
export async function responderPesquisa(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const nota = Number(fd.get("nota"));
  if (!Number.isInteger(nota) || nota < 0 || nota > 10) return { erro: "Escolha uma nota de 0 a 10." };
  const { error } = await clienteAnonimo().rpc("responder_pesquisa", {
    p_token: String(fd.get("token") ?? ""),
    p_nota: nota,
    p_comentario: String(fd.get("comentario") ?? "").slice(0, 2000),
  });
  if (error) return { erro: error.message.includes("já foi respondida") ? "Esta pesquisa já foi respondida. Obrigado!" : "Não foi possível enviar agora. Tente de novo." };
  return { ok: "Obrigado pela sua resposta!" };
}
