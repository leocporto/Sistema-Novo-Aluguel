import Link from "next/link";
import { MessageSquarePlus } from "lucide-react";
import { BotaoAcao } from "@/components/botao-acao";
import { BotaoExcluir } from "@/components/botao-excluir";
import { JanelaCadastro } from "@/components/janela-cadastro";
import { AreaTexto, Campo, Entrada, Selecao, Selo } from "@/components/ui";
import { ROTULO_CANAL, ROTULO_RESULTADO } from "@/lib/dominio/cobrancas";
import { formatarDataBR } from "@/lib/dominio/datas";
import { formatarReais } from "@/lib/dominio/dinheiro";
import { concluirRetorno, excluirContato, marcarPromessa, registrarContato } from "./actions";

export type ContatoDb = {
  id: string;
  contrato_id: string | null;
  fatura_id: string | null;
  acordo_id: string | null;
  data: string;
  canal: string;
  direcao: string;
  resultado: string;
  descricao: string | null;
  promessa_data: string | null;
  promessa_valor: number | null;
  promessa_status: string | null;
  proximo_contato: string | null;
  automatico: boolean;
  contrato?: { numero: number; imovel: { codigo: string } | null } | null;
  pessoa?: { nome: string } | null;
};

export const SELECT_CONTATO =
  "id, contrato_id, fatura_id, acordo_id, data, canal, direcao, resultado, descricao, promessa_data, promessa_valor, promessa_status, proximo_contato, automatico, contrato:contratos(numero, imovel:imoveis(codigo)), pessoa:pessoas(nome)";

const dataHora = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

/** Botão "Registrar contato" com a janela de cadastro (ligação, conversa, promessa…). */
export function JanelaContato({
  contratoId,
  faturaId,
  acordoId,
  juridicoId,
  contratos,
  hoje,
  rotulo = "Registrar contato",
  variante = "secundario",
}: {
  contratoId?: string;
  faturaId?: string | null;
  acordoId?: string | null;
  juridicoId?: string | null;
  /** Quando não há contrato fixo, escolhe numa lista. */
  contratos?: { id: string; rotulo: string }[];
  hoje: string;
  rotulo?: string;
  variante?: "primario" | "secundario" | "fantasma";
}) {
  return (
    <JanelaCadastro rotuloBotao={<><MessageSquarePlus className="size-3.5" /> {rotulo}</>} variante={variante} tamanho="sm" titulo="Registrar contato de cobrança" acao={registrarContato} rotuloSalvar="Registrar" icone={<MessageSquarePlus />}>
      {contratoId ? (
        <input type="hidden" name="contrato_id" value={contratoId} />
      ) : (
        <Campo rotulo="Contrato">
          <Selecao name="contrato_id" required defaultValue="">
            <option value="" disabled>
              Escolha…
            </option>
            {(contratos ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.rotulo}
              </option>
            ))}
          </Selecao>
        </Campo>
      )}
      {faturaId && <input type="hidden" name="fatura_id" value={faturaId} />}
      {acordoId && <input type="hidden" name="acordo_id" value={acordoId} />}
      {juridicoId && <input type="hidden" name="juridico_id" value={juridicoId} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo rotulo="Como foi">
          <Selecao name="canal" defaultValue="telefone">
            {Object.entries(ROTULO_CANAL).map(([k, r]) => (
              <option key={k} value={k}>
                {r}
              </option>
            ))}
          </Selecao>
        </Campo>
        <Campo rotulo="Resultado">
          <Selecao name="resultado" defaultValue="falou">
            {Object.entries(ROTULO_RESULTADO)
              .filter(([k]) => k !== "informou_pagamento")
              .map(([k, r]) => (
                <option key={k} value={k}>
                  {r}
                </option>
              ))}
          </Selecao>
        </Campo>
        <Campo rotulo="Quando">
          <Entrada type="date" name="data" defaultValue={hoje} max={hoje} />
        </Campo>
        <Campo rotulo="Próximo contato (opcional)">
          <Entrada type="date" name="proximo_contato" min={hoje} />
        </Campo>
        <Campo rotulo="Prometeu pagar em" dica="Preencha se houve promessa de pagamento.">
          <Entrada type="date" name="promessa_data" min={hoje} />
        </Campo>
        <Campo rotulo="Valor prometido (R$)">
          <Entrada name="promessa_valor" inputMode="decimal" placeholder="0,00" />
        </Campo>
      </div>
      <Campo rotulo="O que foi conversado">
        <AreaTexto name="descricao" rows={3} placeholder="Ex.: disse que recebe o salário dia 5 e paga no dia 6." />
      </Campo>
    </JanelaCadastro>
  );
}

/** Linha do tempo dos contatos de cobrança. */
export function ListaContatos({ contatos, hoje, mostrarContrato = false }: { contatos: ContatoDb[]; hoje: string; mostrarContrato?: boolean }) {
  if (!contatos.length) return <p className="text-sm text-mudo">Nenhum contato registrado.</p>;
  return (
    <ul className="divide-y divide-borda-suave">
      {contatos.map((c) => {
        const promessaVencida = c.promessa_status === "pendente" && c.promessa_data && c.promessa_data < hoje;
        return (
          <li key={c.id} className="flex flex-wrap items-start gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0">
            <div className="min-w-[220px] flex-1">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-semibold text-texto">{ROTULO_RESULTADO[c.resultado] ?? c.resultado}</span>
                <Selo cor={c.direcao === "entrada" ? "azul" : "cinza"}>{ROTULO_CANAL[c.canal] ?? c.canal}</Selo>
                {c.automatico && <Selo cor="cinza">automático</Selo>}
                <span className="text-xs text-mudo">{dataHora(c.data)}</span>
              </div>
              {mostrarContrato && c.contrato && (
                <div className="text-xs text-texto-2">
                  {c.pessoa?.nome ?? "—"} ·{" "}
                  <Link href={`/contratos/${c.contrato_id}/cobrancas`} className="hover:text-acento hover:underline">
                    contrato #{c.contrato.numero} {c.contrato.imovel ? `· ${c.contrato.imovel.codigo}` : ""}
                  </Link>
                  {c.fatura_id && (
                    <>
                      {" · "}
                      <Link href={`/faturas/${c.fatura_id}`} className="hover:text-acento hover:underline">
                        ver cobrança
                      </Link>
                    </>
                  )}
                </div>
              )}
              {c.descricao && <p className="mt-1 line-clamp-3 whitespace-pre-line text-[13px] text-texto-2">{c.descricao}</p>}
              <div className="mt-1 flex flex-wrap gap-2 text-xs">
                {c.promessa_data && (
                  <Selo cor={c.promessa_status === "cumprida" ? "verde" : c.promessa_status === "quebrada" || promessaVencida ? "vermelho" : "amarelo"}>
                    {c.resultado === "informou_pagamento" ? "disse que pagou" : "promessa"} {formatarDataBR(c.promessa_data)}
                    {c.promessa_valor ? ` · ${formatarReais(c.promessa_valor)}` : ""} · {c.promessa_status === "pendente" && promessaVencida ? "não cumprida" : (c.promessa_status ?? "")}
                  </Selo>
                )}
                {c.proximo_contato && <Selo cor={c.proximo_contato <= hoje ? "vermelho" : "azul"}>retornar {formatarDataBR(c.proximo_contato)}</Selo>}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {c.promessa_status === "pendente" && (
                <>
                  <BotaoAcao acao={marcarPromessa} id={`${c.id}|cumprida`} tamanho="sm">
                    {c.resultado === "informou_pagamento" ? "Conferido" : "Cumpriu"}
                  </BotaoAcao>
                  <BotaoAcao acao={marcarPromessa} id={`${c.id}|quebrada`} tamanho="sm" variante="fantasma">
                    Não cumpriu
                  </BotaoAcao>
                </>
              )}
              {c.proximo_contato && c.promessa_status !== "pendente" && (
                <BotaoAcao acao={concluirRetorno} id={c.id} tamanho="sm" variante={c.proximo_contato <= hoje ? "secundario" : "fantasma"}>
                  Retorno feito
                </BotaoAcao>
              )}
              <BotaoExcluir acao={excluirContato} id={c.id} rotulo="Excluir contato" confirmar="Excluir este registro de contato?" />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export type EventoDb = { id: string; tipo: string; descricao: string | null; valor: number | null; data: string; fatura_id: string | null };

/** Trilha de auditoria (gravada pelo banco, não se apaga). */
export function ListaEventos({ eventos }: { eventos: EventoDb[] }) {
  if (!eventos.length) return <p className="text-sm text-mudo">Sem registros ainda.</p>;
  return (
    <ol className="space-y-2 text-sm">
      {eventos.map((e) => (
        <li key={e.id} className="flex flex-wrap justify-between gap-2 border-b border-borda-suave pb-2 last:border-b-0">
          <span>
            <span className="text-texto">{e.descricao ?? e.tipo}</span>
            <span className="block text-xs text-mudo">{dataHora(e.data)}</span>
          </span>
          {e.valor != null && <span className="tabular-nums text-texto-2">{formatarReais(e.valor)}</span>}
        </li>
      ))}
    </ol>
  );
}
