import type { Metadata } from "next";
import { formatarDataBR } from "@/lib/dominio/datas";
import { ROTULO_ESTADO, ROTULO_MEDIDOR, ROTULO_RESPONSAVEL, ROTULO_TIPO_VISTORIA, UNIDADE_MEDIDOR } from "@/lib/dominio/vistorias";
import { clienteAnonimo } from "@/lib/supabase/anonimo";
import { FormContestacao } from "./form";

export const metadata: Metadata = { title: "Contestar vistoria", robots: { index: false } };

type Info = {
  organizacao: string;
  organizacao_id: string;
  numero: number;
  tipo: string;
  data: string;
  status: string;
  prazo: string | null;
  aberta: boolean;
  imovel: string | null;
  conclusao: string | null;
  ambientes: { nome: string; observacoes: string | null; itens: { id: string; nome: string; estado: string | null; observacao: string | null }[] }[];
  medidores: { tipo: string; numero: string | null; leitura: number | null }[];
  pendencias: { descricao: string; responsavel: string; status: string }[];
  contestacoes: { nome: string; texto: string; criada_em: string; status: string; decisao: string | null; resposta: string | null; respondida_em: string | null }[];
};

const quando = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
const DECISAO: Record<string, string> = { aceita: "Aceita", parcial: "Aceita em parte", mantida: "Laudo mantido" };

/** Página pública: o locatário confere a vistoria e contesta dentro do prazo (link único). */
export default async function ContestarPage({ params }: PageProps<"/contestar/[token]">) {
  const { token } = await params;
  const valido = /^[0-9a-f-]{36}$/i.test(token);
  const { data } = valido ? await clienteAnonimo().rpc("info_contestacao_vistoria", { p_token: token }) : { data: null };
  const info = data as Info | null;

  return (
    <main className="min-h-screen bg-app px-4 py-8">
      <div className="mx-auto max-w-3xl space-y-5">
        {!info ? (
          <div className="rounded-card border border-borda bg-card p-8 text-center text-texto-2">Link de vistoria inválido ou ainda não liberado.</div>
        ) : (
          <>
            <header className="rounded-card border border-borda bg-card p-5">
              <div className="text-sm text-mudo">{info.organizacao}</div>
              <h1 className="mt-1 text-[24px] font-semibold text-texto">
                Vistoria de {ROTULO_TIPO_VISTORIA[info.tipo]?.toLowerCase()} nº {info.numero}
              </h1>
              <p className="mt-1 text-sm text-texto-2">
                {info.imovel ?? ""} · feita em {formatarDataBR(info.data)}
              </p>
              <p className={`mt-3 text-sm font-medium ${info.aberta ? "text-texto" : "text-ruim"}`}>
                {info.aberta
                  ? info.prazo
                    ? `Confira o laudo abaixo. Se não concordar com algum item, conteste até ${formatarDataBR(info.prazo)}.`
                    : "Confira o laudo abaixo. Se não concordar com algum item, conteste aqui."
                  : `O prazo para contestar terminou em ${formatarDataBR(info.prazo)}.`}
              </p>
            </header>

            {info.medidores.length > 0 && (
              <section className="rounded-card border border-borda bg-card p-5">
                <h2 className="mb-2 text-[16px] font-semibold text-texto">Medidores</h2>
                <ul className="space-y-1 text-sm text-texto-2">
                  {info.medidores.map((m, i) => (
                    <li key={i}>
                      {ROTULO_MEDIDOR[m.tipo]}
                      {m.numero ? ` (nº ${m.numero})` : ""}: {m.leitura === null ? "sem leitura" : `${Number(m.leitura).toLocaleString("pt-BR")} ${UNIDADE_MEDIDOR[m.tipo]}`}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section className="space-y-4 rounded-card border border-borda bg-card p-5">
              <h2 className="text-[16px] font-semibold text-texto">Estado do imóvel, ambiente por ambiente</h2>
              {info.ambientes.map((a, i) => (
                <div key={i}>
                  <h3 className="mb-1 font-semibold text-texto">
                    {i + 1}. {a.nome}
                  </h3>
                  <ul className="divide-y divide-borda-suave text-sm">
                    {a.itens.map((it) => (
                      <li key={it.id} className="flex flex-wrap justify-between gap-2 py-1.5">
                        <span className="text-texto">{it.nome}</span>
                        <span className={`text-right ${it.estado === "ruim" || it.estado === "danificado" ? "font-semibold text-ruim" : "text-texto-2"}`}>
                          {it.estado ? ROTULO_ESTADO[it.estado] : "não avaliado"}
                          {it.observacao ? ` — ${it.observacao}` : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {a.observacoes && <p className="mt-1 text-sm text-texto-2">Observações: {a.observacoes}</p>}
                </div>
              ))}
              {info.conclusao && <p className="text-sm text-texto">Conclusão: {info.conclusao}</p>}
            </section>

            {info.pendencias.length > 0 && (
              <section className="rounded-card border border-borda bg-card p-5">
                <h2 className="mb-2 text-[16px] font-semibold text-texto">Danos e pendências apontados</h2>
                <ul className="list-disc space-y-1 pl-5 text-sm text-texto-2">
                  {info.pendencias.map((p, i) => (
                    <li key={i}>
                      {p.descricao} — responsável: {ROTULO_RESPONSAVEL[p.responsavel] ?? p.responsavel}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {info.contestacoes.length > 0 && (
              <section className="rounded-card border border-borda bg-card p-5">
                <h2 className="mb-2 text-[16px] font-semibold text-texto">Contestações enviadas</h2>
                <ul className="space-y-3 text-sm">
                  {info.contestacoes.map((c, i) => (
                    <li key={i} className="rounded-[12px] border border-borda p-3">
                      <div className="text-xs text-mudo">
                        {c.nome} · {quando(c.criada_em)}
                      </div>
                      <p className="mt-1 whitespace-pre-line text-texto">{c.texto}</p>
                      {c.resposta ? (
                        <div className="mt-2 rounded-[10px] border border-ok-bd bg-ok-bg px-3 py-2">
                          <strong className="text-ok">Resposta: {DECISAO[c.decisao ?? ""] ?? ""}</strong>
                          <p className="whitespace-pre-line text-texto">{c.resposta}</p>
                        </div>
                      ) : (
                        <p className="mt-2 text-xs text-alerta">Aguardando resposta.</p>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {info.aberta && (
              <section className="rounded-card border border-borda bg-card p-5">
                <h2 className="mb-3 text-[16px] font-semibold text-texto">Contestar a vistoria</h2>
                <FormContestacao
                  token={token}
                  organizacaoId={info.organizacao_id}
                  itens={info.ambientes.flatMap((a) => a.itens.map((it) => ({ id: it.id, nome: it.nome, ambiente: a.nome })))}
                />
                <p className="mt-4 text-[11px] text-mudo">A contestação registra data, hora e IP. As fotos ficam guardadas só para quem fez a vistoria.</p>
              </section>
            )}
          </>
        )}
      </div>
    </main>
  );
}
