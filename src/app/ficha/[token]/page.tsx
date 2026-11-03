import type { Metadata } from "next";
import { formatarDataBR } from "@/lib/dominio/datas";
import { formatarReais } from "@/lib/dominio/dinheiro";
import { clienteAnonimo } from "@/lib/supabase/anonimo";
import { FichaDados, FichaDocumentos } from "./form";

export const metadata: Metadata = { title: "Ficha cadastral", robots: { index: false } };

type Info = {
  organizacao: string;
  nome: string;
  tipo_pessoa: string;
  imovel: { codigo: string; endereco: string } | null;
  aluguel: number;
  encargos: number;
  enviada_em: string | null;
  consentimento_em: string | null;
  texto_consentimento: string;
  documentos: { id: string; rotulo: string; status: string; obrigatorio: boolean; parte: string; motivo: string | null }[];
  arquivos: number;
};

/** Página pública: o candidato preenche a ficha, autoriza a consulta (LGPD) e envia os documentos. */
export default async function FichaPage({ params }: PageProps<"/ficha/[token]">) {
  const { token } = await params;
  const valido = /^[0-9a-f-]{36}$/i.test(token);
  const { data } = valido ? await clienteAnonimo().rpc("ficha_info", { p_token: token }) : { data: null };
  const info = data as Info | null;

  return (
    <main className="min-h-screen bg-app px-4 py-8">
      <div className="mx-auto max-w-2xl space-y-5">
        {!info ? (
          <div className="rounded-card border border-borda bg-card p-8 text-center text-texto-2">Este link não está mais ativo. Fale com quem enviou para receber um novo.</div>
        ) : (
          <>
            <header className="rounded-card border border-borda bg-card p-5">
              <div className="text-sm text-mudo">{info.organizacao} · ficha cadastral para locação</div>
              <h1 className="mt-1 text-[24px] font-semibold tracking-[-0.02em] text-texto">Olá, {info.nome.split(" ")[0]}!</h1>
              <p className="mt-2 text-sm text-texto-2">
                {info.imovel ? `Imóvel ${info.imovel.codigo}${info.imovel.endereco ? ` — ${info.imovel.endereco}` : ""}. ` : ""}
                {info.aluguel > 0 && `Aluguel ${formatarReais(info.aluguel)}${info.encargos > 0 ? ` + encargos ${formatarReais(info.encargos)}` : ""} por mês.`}
              </p>
              {info.enviada_em && <p className="mt-2 text-sm font-medium text-ok">Ficha recebida em {formatarDataBR(info.enviada_em.slice(0, 10))}. Você pode atualizar e enviar mais documentos.</p>}
            </header>
            <section className="rounded-card border border-borda bg-card p-5">
              <h2 className="mb-4 text-[16px] font-semibold text-texto">1. Seus dados e sua renda</h2>
              <FichaDados token={token} textoConsentimento={info.texto_consentimento} jaEnviou={Boolean(info.enviada_em)} />
            </section>
            <section className="rounded-card border border-borda bg-card p-5">
              <h2 className="mb-1 text-[16px] font-semibold text-texto">2. Documentos</h2>
              <p className="mb-4 text-sm text-texto-2">Envie uma foto legível ou PDF de cada documento.{info.arquivos ? ` Já recebemos ${info.arquivos} arquivo(s).` : ""}</p>
              <FichaDocumentos token={token} documentos={info.documentos} organizacao={info.organizacao} />
            </section>
          </>
        )}
      </div>
    </main>
  );
}
