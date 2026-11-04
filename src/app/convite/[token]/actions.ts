"use server";

import { redirect } from "next/navigation";
import { obterUsuarioSemOrganizacao } from "@/lib/contexto";
import { type EstadoAcao, mensagemErro, textoObrigatorio } from "@/lib/form";

/** Aceita o convite da equipe (a conta logada precisa ter o e-mail do convite; o banco confere). */
export async function aceitarConvite(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  try {
    const { supabase } = await obterUsuarioSemOrganizacao();
    const token = textoObrigatorio(fd, "token");
    if (!/^[0-9a-f-]{36}$/i.test(token)) return { erro: "Convite inválido." };
    const { error } = await supabase.rpc("aceitar_convite", { p_token: token });
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  redirect("/");
}
