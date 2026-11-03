import type { Metadata } from "next";
import { clienteAnonimo } from "@/lib/supabase/anonimo";
import { FormPesquisa } from "./form";

export const metadata: Metadata = { title: "Pesquisa de satisfação", robots: { index: false } };

type Info = { imobiliaria: string; nome: string | null; pergunta: string; respondida: boolean; nota: number | null };

/** Página pública da pesquisa de satisfação (link único por cliente). */
export default async function PesquisaPublicaPage({ params }: PageProps<"/pesquisa/[token]">) {
  const { token } = await params;
  const valido = /^[0-9a-f-]{36}$/i.test(token);
  const { data } = valido ? await clienteAnonimo().rpc("info_pesquisa", { p_token: token }) : { data: null };
  const info = data as Info | null;

  return (
    <main className="flex min-h-screen items-center justify-center bg-app px-4 py-10">
      <div className="w-full max-w-lg rounded-card border border-borda bg-card p-6 shadow-[0_24px_60px_-30px_rgba(0,0,0,.35)]">
        {!info ? (
          <p className="text-center text-sm text-texto-2">Este link de pesquisa não é válido.</p>
        ) : (
          <>
            <div className="text-sm font-medium text-acento">{info.imobiliaria}</div>
            <h1 className="mt-1 text-[22px] font-semibold leading-snug tracking-[-0.02em] text-texto">
              {info.nome ? `${info.nome.split(" ")[0]}, ` : ""}
              {info.pergunta.charAt(0).toLowerCase() + info.pergunta.slice(1)}
            </h1>
            <div className="mt-5">
              {info.respondida ? (
                <p className="rounded-[14px] border border-ok-bd bg-ok-bg px-4 py-5 text-center text-[15px] font-medium text-ok">Você já respondeu esta pesquisa. Obrigado!</p>
              ) : (
                <FormPesquisa token={token} />
              )}
            </div>
          </>
        )}
      </div>
    </main>
  );
}
