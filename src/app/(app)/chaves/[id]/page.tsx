import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LogOut } from "lucide-react";
import { BotaoExcluir } from "@/components/botao-excluir";
import { Formulario } from "@/components/formulario";
import { JanelaCadastro } from "@/components/janela-cadastro";
import { Cartao, Celula, LinhaVazia, Selo, Tabela } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { diaLocal, horaLocal, situacaoChave } from "@/lib/dominio/agenda";
import { formatarDataBR, hojeISO } from "@/lib/dominio/datas";
import { AbasAgenda } from "../../agenda/campos";
import { atualizarChave, excluirChave, excluirMovimentacao, retirarChave } from "../actions";
import { CamposChave, CamposRetirada } from "../campos";

export const metadata: Metadata = { title: "Chave" };

const quando = (iso: string | null) => (iso ? `${formatarDataBR(diaLocal(iso))} ${horaLocal(iso)}` : "—");

type Mov = {
  id: string;
  retirada_por: string;
  motivo: string | null;
  retirada_em: string;
  previsao_devolucao: string | null;
  devolvida_em: string | null;
  observacao_devolucao: string | null;
  visita_id: string | null;
  pessoa: { id: string; nome: string } | null;
};

/** Ficha da chave: dados (salvam sozinhos) e o histórico completo de retiradas e devoluções. */
export default async function ChavePage({ params }: PageProps<"/chaves/[id]">) {
  const { id } = await params;
  const { supabase } = await obterContexto();
  const [{ data }, { data: movs }, { data: pessoas }] = await Promise.all([
    supabase.from("chaves").select("*, imovel:imoveis(id, codigo, logradouro, numero)").eq("id", id).maybeSingle(),
    supabase.from("chave_movimentacoes").select("*, pessoa:pessoas(id, nome)").eq("chave_id", id).order("retirada_em", { ascending: false }),
    supabase.from("pessoas").select("id, nome").order("nome").limit(2000),
  ]);
  if (!data) notFound();
  const c = data as unknown as {
    id: string;
    codigo: string | null;
    identificacao: string;
    local: string | null;
    quantidade: number;
    responsavel_id: string | null;
    observacoes: string | null;
    imovel: { id: string; codigo: string; logradouro: string | null; numero: string | null } | null;
  };
  const lista = (movs ?? []) as unknown as Mov[];
  const { situacao } = situacaoChave(lista, new Date().toISOString());

  return (
    <>
      <div className="mb-[clamp(14px,1.5vw,18px)] flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-[13px] text-mudo">
            <span>Novo Aluguel</span>
            <span className="text-fraco">›</span>
            <Link href="/chaves" className="text-acento-hot hover:underline">
              Chaves
            </Link>
          </div>
          <h1 className="mt-1.5 text-[clamp(26px,2.8vw,36px)] font-semibold leading-[1.05] tracking-[-0.025em] text-texto">
            {c.codigo} · {c.identificacao}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[13.5px] text-texto-2">
            <Selo cor={situacao === "disponivel" ? "verde" : situacao === "atrasada" ? "vermelho" : "amarelo"}>
              {situacao === "disponivel" ? "no lugar" : situacao === "atrasada" ? "não devolvida" : "retirada"}
            </Selo>
            {c.imovel && (
              <Link href={`/imoveis/${c.imovel.id}`} className="text-acento hover:underline">
                {c.imovel.codigo} — {[c.imovel.logradouro, c.imovel.numero].filter(Boolean).join(", ")}
              </Link>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {situacao === "disponivel" && (
            <JanelaCadastro rotuloBotao={<><LogOut className="size-4" /> Retirar</>} titulo={`Retirar ${c.codigo}`} acao={retirarChave} rotuloSalvar="Registrar retirada" icone={<LogOut />}>
              <CamposRetirada chaveId={c.id} pessoas={pessoas ?? []} hoje={hojeISO()} />
            </JanelaCadastro>
          )}
          <BotaoExcluir acao={excluirChave} id={c.id} variante="botao" rotulo="Excluir" confirmar="Excluir esta chave e todo o histórico?" depois="/chaves" />
        </div>
      </div>
      <AbasAgenda />

      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <Cartao titulo={`Histórico (${lista.length})`}>
          <Tabela colunas={["Quem", "Motivo", "Retirada", "Previsão", "Devolução", ""]}>
            {lista.map((m) => {
              const atrasou = m.previsao_devolucao && (m.devolvida_em ?? new Date().toISOString()) > m.previsao_devolucao;
              return (
                <tr key={m.id}>
                  <Celula>
                    {m.pessoa ? (
                      <Link href={`/pessoas/${m.pessoa.id}`} className="font-medium text-texto hover:underline">
                        {m.pessoa.nome}
                      </Link>
                    ) : (
                      <span className="font-medium text-texto">{m.retirada_por}</span>
                    )}
                    {m.visita_id && (
                      <Link href={`/agenda/${m.visita_id}`} className="block text-xs text-acento hover:underline">
                        ver compromisso
                      </Link>
                    )}
                  </Celula>
                  <Celula>{m.motivo ?? "—"}</Celula>
                  <Celula>{quando(m.retirada_em)}</Celula>
                  <Celula>{quando(m.previsao_devolucao)}</Celula>
                  <Celula className={atrasou ? "text-ruim" : ""}>
                    {m.devolvida_em ? quando(m.devolvida_em) : <Selo cor={atrasou ? "vermelho" : "amarelo"}>em aberto</Selo>}
                    {m.observacao_devolucao && <span className="block text-xs text-mudo">{m.observacao_devolucao}</span>}
                  </Celula>
                  <Celula>
                    <BotaoExcluir acao={excluirMovimentacao} id={m.id} rotulo="Excluir registro" confirmar="Excluir este registro do histórico?" />
                  </Celula>
                </tr>
              );
            })}
            {lista.length === 0 && <LinhaVazia colunas={6}>Esta chave nunca foi retirada.</LinhaVazia>}
          </Tabela>
        </Cartao>
        <Formulario acao={atualizarChave} automatico>
          <input type="hidden" name="id" value={c.id} />
          <Cartao titulo="Dados da chave">
            <div className="space-y-4">
              <CamposChave pessoas={pessoas ?? []} chave={c} />
            </div>
          </Cartao>
        </Formulario>
      </div>
    </>
  );
}
