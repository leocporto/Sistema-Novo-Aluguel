"use server";

import type { EstadoAcao } from "@/lib/form";
import { clienteAnonimo } from "@/lib/supabase/anonimo";

const CANAIS = ["whatsapp", "email", "sms", "ofertas"] as const;

/**
 * A própria pessoa escolhe por onde recebe (ou sai da lista). Fica registrado (LGPD).
 * Só vão os canais que a página mostrou: o que não apareceu (sem telefone/e-mail, ou
 * bloqueado pela equipe) não muda.
 */
export async function salvarPreferenciasPublicas(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const nada = fd.get("nada") === "1";
  const p: Record<string, boolean> = { nada };
  for (const k of CANAIS) if (fd.has(k)) p[k] = fd.getAll(k).includes("on");
  const { data, error } = await clienteAnonimo().rpc("salvar_preferencias", { p_token: String(fd.get("token") ?? ""), p });
  if (error) {
    if (error.message.includes("inválido")) return { erro: "Este link não é válido." };
    if (error.message.includes("Muitas alterações")) return { erro: "Muitas alterações seguidas. Espere um pouco e tente de novo." };
    return { erro: "Não foi possível salvar agora. Tente de novo." };
  }
  if (nada) return { ok: "Pronto: você não vai mais receber nossas mensagens." };
  const depois = (data ?? {}) as Record<string, boolean>;
  const travados = CANAIS.filter((k) => p[k] === true && depois[k] === false);
  if (travados.length) return { ok: "Preferências salvas. Algum canal continua bloqueado a um pedido feito à imobiliária: para voltar a receber por ele, fale com a gente." };
  return { ok: "Preferências salvas. Obrigado!" };
}
