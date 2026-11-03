import type { Metadata } from "next";
import { TextoDocumento } from "@/app/(app)/documentos/campos";
import { clienteAnonimo } from "@/lib/supabase/anonimo";
import { FormAssinatura } from "./form";

export const metadata: Metadata = { title: "Assinatura de documento", robots: { index: false } };

type Info = {
  titulo: string;
  conteudo: string | null;
  status: string;
  versao: number;
  organizacao: string;
  hash: string;
  signatario: { nome: string; papel: string; assinado_em: string | null; recusado_em: string | null };
  signatarios: { nome: string; papel: string; assinado_em: string | null }[];
};

/** Página pública: a pessoa lê o documento e assina com nome e CPF (link único dela). */
export default async function AssinarPage({ params }: PageProps<"/assinar/[token]">) {
  const { token } = await params;
  const valido = /^[0-9a-f-]{36}$/i.test(token);
  const { data } = valido ? await clienteAnonimo().rpc("info_assinatura", { p_token: token }) : { data: null };
  const info = data as Info | null;

  return (
    <main className="min-h-screen bg-app px-4 py-8">
      <div className="mx-auto max-w-3xl space-y-5">
        {!info ? (
          <div className="rounded-card border border-borda bg-card p-8 text-center text-texto-2">Link de assinatura inválido ou expirado.</div>
        ) : (
          <>
            <header className="rounded-card border border-borda bg-card p-5">
              <div className="text-sm text-mudo">{info.organizacao} enviou para sua assinatura</div>
              <h1 className="mt-1 text-[24px] font-semibold text-texto">{info.titulo}</h1>
              <div className="mt-2 flex flex-wrap gap-2 text-xs text-texto-2">
                {info.signatarios.map((s, i) => (
                  <span key={i} className={`rounded-full border px-2 py-0.5 ${s.assinado_em ? "border-ok-bd bg-ok-bg text-ok" : "border-borda"}`}>
                    {s.nome} {s.assinado_em ? "✓" : ""}
                  </span>
                ))}
              </div>
            </header>
            <article className="max-h-[60vh] overflow-y-auto rounded-card border border-borda bg-card p-6 sm:p-8">
              <TextoDocumento texto={info.conteudo ?? ""} />
            </article>
            <section className="rounded-card border border-borda bg-card p-5">
              {info.signatario.assinado_em ? (
                <p className="text-[15px] font-medium text-ok">Você já assinou este documento. Obrigado!</p>
              ) : info.status !== "aguardando_assinatura" ? (
                <p className="text-[15px] text-texto-2">Este documento não está mais disponível para assinatura.</p>
              ) : (
                <>
                  <h2 className="mb-3 text-[16px] font-semibold text-texto">Assinar como {info.signatario.nome}</h2>
                  <FormAssinatura token={token} nome={info.signatario.nome} />
                </>
              )}
              <p className="mt-4 break-all text-[11px] text-mudo">
                Versão {info.versao} · código de integridade do texto (SHA-256): {info.hash}. A assinatura registra data, hora e IP.
              </p>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
