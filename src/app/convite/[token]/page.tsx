import type { Metadata } from "next";
import Link from "next/link";
import { Users } from "lucide-react";
import { BotaoEnviar, Formulario } from "@/components/formulario";
import { BotaoTema } from "@/components/menu-lateral";
import { Aviso, classeBotao } from "@/components/ui";
import { obterUsuarioSemOrganizacao } from "@/lib/contexto";
import { ROTULO_PAPEL_USUARIO } from "@/lib/dominio/equipe";
import { sair } from "../../login/actions";
import { aceitarConvite } from "./actions";

export const metadata: Metadata = { title: "Convite da equipe" };

type Info = {
  situacao: "valido" | "usado" | "vencido" | "cancelado" | "invalido";
  organizacao?: string;
  papel?: string;
  email?: string;
  meu_email?: boolean;
  email_confirmado?: boolean;
};

/**
 * Convite para entrar na equipe de uma imobiliária. Precisa estar logado (o
 * login/criar conta é em /login); a conta tem de ter o e-mail do convite.
 */
export default async function ConvitePage({ params }: PageProps<"/convite/[token]">) {
  const { token } = await params;
  const { supabase, usuario } = await obterUsuarioSemOrganizacao();
  const valido = /^[0-9a-f-]{36}$/i.test(token);
  const { data } = valido ? await supabase.rpc("info_convite", { p_token: token }) : { data: null };
  const info = (data ?? { situacao: "invalido" }) as Info;

  return (
    <main className="relative flex min-h-screen items-center justify-center px-4">
      <BotaoTema className="absolute right-4 top-4" />
      <div className="entrar w-full max-w-md rounded-card border border-borda bg-card p-8 shadow-card">
        <span className="mb-4 flex size-12 items-center justify-center rounded-[13px] border border-acento-bd bg-acento-bg text-acento-hot">
          <Users className="size-6" />
        </span>
        {info.situacao === "valido" ? (
          <>
            <h1 className="text-[24px] font-semibold tracking-[-0.025em]">Convite para a equipe</h1>
            <p className="mb-5 mt-2 text-sm text-texto-2">
              <strong>{info.organizacao}</strong> convidou você para usar o sistema como <strong>{ROTULO_PAPEL_USUARIO[info.papel ?? ""] ?? info.papel}</strong>.
            </p>
            {info.meu_email && info.email_confirmado === false ? (
              <Aviso tipo="alerta">
                Antes de aceitar, confirme o seu e-mail: abra a mensagem de confirmação que chegou na caixa de entrada de <strong>{info.email}</strong> e clique no
                link. Depois abra este convite de novo.
              </Aviso>
            ) : info.meu_email ? (
              <Formulario acao={aceitarConvite} className="space-y-4">
                <input type="hidden" name="token" value={token} />
                <BotaoEnviar>Aceitar e entrar</BotaoEnviar>
              </Formulario>
            ) : (
              <div className="space-y-4">
                <Aviso tipo="alerta">
                  Este convite é para o e-mail <strong>{info.email}</strong>, mas você entrou como <strong>{usuario.email ?? "outra conta"}</strong>. Saia e entre (ou crie a
                  conta) com o e-mail do convite; depois abra este link de novo.
                </Aviso>
                <form action={sair}>
                  <button type="submit" className={classeBotao("secundario")}>
                    Sair desta conta
                  </button>
                </form>
              </div>
            )}
          </>
        ) : (
          <>
            <h1 className="text-[24px] font-semibold tracking-[-0.025em]">Convite indisponível</h1>
            <p className="mt-2 text-sm text-texto-2">
              {info.situacao === "usado"
                ? "Este convite já foi usado."
                : info.situacao === "vencido"
                  ? "Este convite venceu. Peça um novo a quem convidou você."
                  : info.situacao === "cancelado"
                    ? "Este convite foi cancelado. Peça um novo a quem convidou você."
                    : "Link de convite inválido."}
            </p>
            <Link href="/" className={`${classeBotao("secundario")} mt-5`}>
              Ir para o início
            </Link>
          </>
        )}
      </div>
    </main>
  );
}
