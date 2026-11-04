import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BotaoEnviar, Formulario } from "@/components/formulario";
import { BotaoTema } from "@/components/menu-lateral";
import { Aviso, Campo, Entrada } from "@/components/ui";
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
  // Convites de equipe esperando este e-mail (Equipe → Convidar usuário). Só o
  // aviso: para entrar é preciso abrir o link que a imobiliária mandou.
  const { data: convites } = await supabase.rpc("meus_convites");
  const pendentes = Array.isArray(convites) ? (convites as { organizacao: string; papel: string }[]) : [];

  return (
    <main className="relative flex min-h-screen items-center justify-center px-4">
      <BotaoTema className="absolute right-4 top-4" />
      <div className="entrar w-full max-w-md rounded-card border border-borda bg-card p-8 shadow-card">
        <h1 className="text-[26px] font-semibold tracking-[-0.025em]">Cadastre sua imobiliária</h1>
        <p className="mb-6 mt-1 text-sm text-mudo">
          Você será o administrador. Depois é possível ajustar taxas e padrões em Configurações.
        </p>
        {pendentes.length > 0 && (
          <div className="mb-6 space-y-2">
            {pendentes.map((c, i) => (
              <Aviso key={`${c.organizacao}-${i}`}>
                Você foi convidado para a equipe de <strong>{c.organizacao}</strong>. Abra o link do convite que a imobiliária mandou para você (por e-mail ou
                WhatsApp) para entrar.
              </Aviso>
            ))}
            <p className="text-xs text-mudo">Se não for o caso, cadastre uma imobiliária nova abaixo.</p>
          </div>
        )}
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
