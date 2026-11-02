import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BotaoEnviar, Formulario } from "@/components/formulario";
import { BotaoTema } from "@/components/menu-lateral";
import { Campo, Entrada } from "@/components/ui";
import { obterUsuarioSemOrganizacao } from "@/lib/contexto";
import { type EstadoAcao, mensagemErro, texto } from "@/lib/form";

export const metadata: Metadata = { title: "Cadastrar imobiliária" };

async function criar(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  "use server";
  const { supabase, usuario } = await obterUsuarioSemOrganizacao();
  // Quem já faz parte de uma imobiliária não cria outra por esta tela.
  const { count } = await supabase
    .from("membros")
    .select("*", { count: "exact", head: true })
    .eq("user_id", usuario.id);
  if (count && count > 0) redirect("/");
  const nome = texto(fd, "nome");
  if (!nome) return { erro: "Informe o nome da imobiliária." };
  const { error } = await supabase.rpc("criar_organizacao", {
    p_nome: nome,
    p_documento: texto(fd, "documento"),
  });
  if (error) return { erro: mensagemErro(error) };
  redirect("/");
}

export default async function OnboardingPage() {
  const { supabase, usuario } = await obterUsuarioSemOrganizacao();
  const { count } = await supabase
    .from("membros")
    .select("*", { count: "exact", head: true })
    .eq("user_id", usuario.id);
  if (count && count > 0) redirect("/");

  return (
    <main className="relative flex min-h-screen items-center justify-center px-4">
      <BotaoTema className="absolute right-4 top-4" />
      <div className="entrar w-full max-w-md rounded-card border border-borda bg-card p-8 shadow-card">
        <h1 className="text-[26px] font-semibold tracking-[-0.025em]">Cadastre sua imobiliária</h1>
        <p className="mb-6 mt-1 text-sm text-mudo">
          Você será o administrador. Depois é possível ajustar taxas e padrões em Configurações.
        </p>
        <Formulario acao={criar}>
          <Campo rotulo="Nome da imobiliária">
            <Entrada name="nome" required />
          </Campo>
          <Campo rotulo="CNPJ / CPF (opcional)">
            <Entrada name="documento" />
          </Campo>
          <BotaoEnviar>Começar</BotaoEnviar>
        </Formulario>
      </div>
    </main>
  );
}
