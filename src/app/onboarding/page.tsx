import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BotaoEnviar, Formulario } from "@/components/formulario";
import { Campo, Entrada } from "@/components/ui";
import { obterUsuarioSemOrganizacao } from "@/lib/contexto";
import { type EstadoAcao, mensagemErro, texto } from "@/lib/form";

export const metadata: Metadata = { title: "Cadastrar imobiliária" };

async function criar(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  "use server";
  const { supabase } = await obterUsuarioSemOrganizacao();
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
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-xl font-semibold">Cadastre sua imobiliária</h1>
        <p className="mb-6 mt-1 text-sm text-slate-500">
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
