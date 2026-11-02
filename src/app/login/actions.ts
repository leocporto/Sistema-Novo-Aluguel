"use server";

import { redirect } from "next/navigation";
import { criarClienteServidor } from "@/lib/supabase/server";
import { type EstadoAcao, texto } from "@/lib/form";

export async function entrar(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const email = texto(fd, "email");
  const senha = texto(fd, "senha");
  if (!email || !senha) return { erro: "Informe e-mail e senha." };
  const supabase = await criarClienteServidor();

  if (fd.get("modo") === "cadastrar") {
    const { data, error } = await supabase.auth.signUp({ email, password: senha });
    if (error) return { erro: error.message };
    if (!data.session) return { ok: "Cadastro criado. Confirme o e-mail recebido e depois entre." };
    redirect("/onboarding");
  }

  const { error } = await supabase.auth.signInWithPassword({ email, password: senha });
  if (error) return { erro: "E-mail ou senha inválidos." };
  redirect("/");
}

export async function sair() {
  const supabase = await criarClienteServidor();
  await supabase.auth.signOut();
  redirect("/login");
}
