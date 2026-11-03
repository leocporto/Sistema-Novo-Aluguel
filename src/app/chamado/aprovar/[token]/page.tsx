import type { Metadata } from "next";
import { formatarDataBR } from "@/lib/dominio/datas";
import { formatarReais } from "@/lib/dominio/dinheiro";
import { ROTULO_CATEGORIA_CURTO, ROTULO_URGENCIA } from "@/lib/dominio/manutencao";
import { clienteAnonimo } from "@/lib/supabase/anonimo";
import { FormAprovacao } from "./form";

export const metadata: Metadata = { title: "Aprovar orçamento de manutenção", robots: { index: false } };

type Info = {
  organizacao: string;
  numero: number;
  titulo: string;
  descricao: string | null;
  categoria: string;
  urgencia: string;
  status: string;
  aprovacao_status: string;
  aprovacao_nome: string | null;
  aprovacao_em: string | null;
  imovel: string;
  endereco: string | null;
  responsabilidade: string | null;
  pct_proprietario: number;
  pago_direto: boolean | null;
  valor: number | null;
  parte_proprietario: number;
  orcamentos: { prestador: string; especialidade: string | null; valor: number; prazo_dias: number | null; garantia_dias: number | null; descricao: string | null; escolhido: boolean }[];
};

/** Página pública do proprietário: ver os orçamentos do conserto e aprovar ou recusar o escolhido. */
export default async function AprovarOrcamento({ params }: PageProps<"/chamado/aprovar/[token]">) {
  const { token } = await params;
  const valido = /^[0-9a-f-]{36}$/i.test(token);
  const { data } = valido ? await clienteAnonimo().rpc("info_aprovacao_chamado", { p_token: token }) : { data: null };
  const info = data as Info | null;
  const pct = info ? Number(info.pct_proprietario) : 0;

  return (
    <main className="min-h-screen bg-app px-4 py-8">
      <div className="mx-auto max-w-2xl space-y-5">
        {!info ? (
          <div className="rounded-card border border-borda bg-card p-8 text-center text-texto-2">Link de aprovação inválido ou expirado.</div>
        ) : (
          <>
            <header className="rounded-card border border-borda bg-card p-5">
              <div className="text-sm text-mudo">{info.organizacao} pede a sua aprovação</div>
              <h1 className="mt-1 text-[24px] font-semibold text-texto">
                Conserto nº {info.numero}: {info.titulo}
              </h1>
              <p className="mt-1 text-sm text-texto-2">
                {info.imovel}
                {info.endereco ? ` — ${info.endereco}` : ""}
              </p>
              <p className="mt-2 text-sm text-texto-2">
                {ROTULO_CATEGORIA_CURTO[info.categoria] ?? info.categoria} · urgência {(ROTULO_URGENCIA[info.urgencia] ?? info.urgencia).toLowerCase()}
              </p>
              {info.descricao && <p className="mt-3 whitespace-pre-line text-[15px] text-texto">{info.descricao}</p>}
            </header>
            <section className="rounded-card border border-borda bg-card p-5">
              <h2 className="mb-3 text-[16px] font-semibold text-texto">Orçamentos recebidos</h2>
              <ul className="space-y-2">
                {info.orcamentos.map((o, i) => (
                  <li key={i} className={`rounded-[14px] border px-4 py-3 ${o.escolhido ? "border-acento bg-acento-bg" : "border-borda"}`}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium text-texto">
                        {o.prestador}
                        {o.especialidade ? <span className="text-sm font-normal text-mudo"> · {o.especialidade}</span> : null}
                      </span>
                      <b className="tabular-nums text-texto">{formatarReais(o.valor)}</b>
                    </div>
                    <div className="mt-1 text-xs text-texto-2">
                      {[o.prazo_dias != null ? `prazo ${o.prazo_dias} dia(s)` : null, o.garantia_dias != null ? `garantia ${o.garantia_dias} dias` : null, o.escolhido ? "escolhido pela administração" : null].filter(Boolean).join(" · ")}
                    </div>
                    {o.descricao && <p className="mt-1 text-sm text-texto-2">{o.descricao}</p>}
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-[15px] text-texto">
                Valor do serviço: <b>{formatarReais(info.valor)}</b>
                {pct < 100 && (
                  <>
                    {" "}
                    · sua parte ({String(pct).replace(".", ",")}%): <b>{formatarReais(info.parte_proprietario)}</b>
                  </>
                )}
                .{" "}
                {info.pago_direto
                  ? "Você paga direto ao prestador (nada é descontado do seu repasse)."
                  : "O valor é descontado do seu próximo repasse."}
              </p>
            </section>
            <section className="rounded-card border border-borda bg-card p-5">
              {info.aprovacao_status === "pendente" && info.status === "aguardando_aprovacao" ? (
                <>
                  <h2 className="mb-3 text-[16px] font-semibold text-texto">Sua resposta</h2>
                  <FormAprovacao token={token} nome="" />
                  <p className="mt-3 text-[11px] text-mudo">Registramos seu nome, a data, a hora e o IP da resposta.</p>
                </>
              ) : (
                <p className="text-[15px] text-texto-2">
                  {info.aprovacao_status === "aprovado" ? "Orçamento aprovado" : info.aprovacao_status === "recusado" ? "Orçamento recusado" : "Este orçamento não está mais aguardando resposta"}
                  {info.aprovacao_nome ? ` por ${info.aprovacao_nome}` : ""}
                  {info.aprovacao_em ? ` em ${formatarDataBR(info.aprovacao_em.slice(0, 10))}` : ""}. Obrigado!
                </p>
              )}
            </section>
          </>
        )}
      </div>
    </main>
  );
}
