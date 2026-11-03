import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MinusCircle } from "lucide-react";
import { Copiar } from "@/components/copiar";
import { BotaoExcluir } from "@/components/botao-excluir";
import { JanelaCadastro } from "@/components/janela-cadastro";
import { Aviso, Campo, Cartao, Definicao, Entrada, Selo } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { formatarCompetencia, formatarDataBR, hojeISO } from "@/lib/dominio/datas";
import { formatarReais, paraReais } from "@/lib/dominio/dinheiro";
import { FORMAS_REPASSE, ROTULO_TIPO_CHAVE_PIX, analisarChavePix, dataDoPagamento, pixCopiaECola, podeAprovarRepasse } from "@/lib/dominio/repasses";
import { descontarAjuste, removerAjuste } from "../actions";
import { carregarRepasse, dadosBancarios, nomesDosMembros, planoDoRepasse } from "../dados";
import { ComprovanteRepasse } from "./comprovante";

export const metadata: Metadata = { title: "Repasse" };

const ROTULO_EVENTO: Record<string, string> = {
  criado: "Gerado",
  desconto: "Desconto",
  desconto_devolvido: "Desconto devolvido",
  valor_alterado: "Valor alterado",
  aprovado: "Aprovado",
  aprovacao_desfeita: "Aprovação desfeita",
  agendado: "Reagendado",
  pago: "Pago",
  pagamento_desfeito: "Pagamento desfeito",
  cancelado: "Cancelado",
  reaberto: "Reaberto",
  conciliado: "Conciliado",
  excluido: "Excluído",
};
const COR_EVENTO: Record<string, "azul" | "verde" | "amarelo" | "vermelho" | "cinza"> = {
  pago: "verde",
  aprovado: "verde",
  desconto: "amarelo",
  cancelado: "vermelho",
  pagamento_desfeito: "vermelho",
  aprovacao_desfeita: "amarelo",
};

/** Ficha do repasse: cálculo, descontos, dados para pagar (Pix/transferência), comprovante e histórico. */
export default async function RepassePage({ params }: PageProps<"/repasses/[id]">) {
  const { id } = await params;
  const { supabase, organizacao, papel } = await obterContexto();
  const r = await carregarRepasse(supabase, id);
  if (!r) notFound();
  const hoje = hojeISO();
  const pode = podeAprovarRepasse(papel);
  const [{ data: descontos }, { data: eventos }, nomes, plano, { data: conta }] = await Promise.all([
    supabase.from("repasse_descontos").select("id, tipo, descricao, valor, lancamento_id, created_at").eq("repasse_id", id).order("created_at"),
    supabase.from("repasse_eventos").select("id, tipo, descricao, valor, usuario_id, data").eq("repasse_id", id).order("data", { ascending: false }).limit(100),
    nomesDosMembros(supabase),
    r.status === "pendente" && !r.aprovado_em ? planoDoRepasse(supabase, r) : Promise.resolve([]),
    r.conta_id ? supabase.from("contas_financeiras").select("nome").eq("id", r.conta_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const chavePix = analisarChavePix(r.pessoa.pix_chave);
  const chave = chavePix?.chave ?? null;
  let pix: string | null = null;
  if (chave && r.status !== "cancelado" && Number(r.valor_liquido) > 0) {
    try {
      pix = pixCopiaECola({ chave, nome: r.pessoa.nome, cidade: r.pessoa.cidade, valor: Number(r.valor_liquido), txid: `REP${r.id.replace(/-/g, "").slice(0, 20)}` });
    } catch {
      pix = null;
    }
  }
  const banco = dadosBancarios(r.pessoa);
  const aDescontar = plano.filter((d) => d.valor > 0);
  const linhaCalc = (rotulo: string, valor: number, sinal: "+" | "−" | "=" = "−", destaque = false) => (
    <tr key={rotulo} className={destaque ? "font-semibold text-texto" : "text-texto-2"}>
      <td className="py-1.5 pr-3">{rotulo}</td>
      <td className="py-1.5 text-right tabular-nums">
        {sinal === "−" && valor ? "−" : ""}
        {formatarReais(valor)}
      </td>
    </tr>
  );

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
      <div className="space-y-6">
        <Cartao titulo="Como o valor foi calculado">
          <table className="w-full text-sm">
            <tbody className="divide-y divide-borda-suave">
              {linhaCalc(`Aluguel (parte de ${String(Number(r.percentual)).replace(".", ",")}%)`, Number(r.aluguel), "+")}
              {Number(r.encargos) !== 0 && linhaCalc("Encargos do proprietário", Number(r.encargos), "+")}
              {Number(r.multa_juros) !== 0 && linhaCalc("Multa e juros pagos pelo locatário", Number(r.multa_juros), "+")}
              {linhaCalc("Valor bruto", Number(r.valor_bruto), "=", true)}
              {linhaCalc("Taxa de administração", Number(r.taxa_administracao))}
              {Number(r.taxa_intermediacao) !== 0 && linhaCalc("Taxa de intermediação (1º aluguel)", Number(r.taxa_intermediacao))}
              {Number(r.irrf) !== 0 && linhaCalc("IRRF retido pelo locatário PJ", Number(r.irrf))}
              {Number(r.imposto ?? 0) !== 0 && linhaCalc(`Imposto do proprietário (${String(Number(r.imposto_pct)).replace(".", ",")}%)`, Number(r.imposto))}
              {Number(r.outros_descontos ?? 0) !== 0 && linhaCalc("Despesas e descontos", Number(r.outros_descontos))}
              {linhaCalc("Líquido a repassar", Number(r.valor_liquido), "=", true)}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-mudo">
            Competência {formatarCompetencia(r.competencia)}
            {r.fatura ? (
              <>
                {" "}
                · gerado na baixa da{" "}
                <Link href={`/faturas/${r.fatura.id}`} className="text-acento hover:underline">
                  fatura #{r.fatura.numero}
                </Link>
                {r.fatura.pago_em ? ` (paga em ${formatarDataBR(r.fatura.pago_em)})` : ""}
              </>
            ) : null}
            . As taxas e o imposto vêm do contrato e do cadastro do proprietário.
          </p>
        </Cartao>

        <Cartao
          titulo="Descontos no repasse"
          acoes={
            pode &&
            r.status === "pendente" && (
              <JanelaCadastro rotuloBotao={<><MinusCircle className="size-3.5" /> Desconto avulso</>} variante="secundario" tamanho="sm" titulo="Desconto avulso no repasse" acao={descontarAjuste} rotuloSalvar="Descontar">
                <input type="hidden" name="id" value={id} />
                <p className="text-sm text-texto-2">
                  Para despesas do imóvel pagas pela imobiliária, prefira cadastrar em{" "}
                  <Link href="/repasses/despesas" className="text-acento hover:underline">
                    Despesas a descontar
                  </Link>{" "}
                  (o sistema rateia entre os donos e desconta na aprovação).
                </p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Campo rotulo="Valor (R$)">
                    <Entrada name="valor" inputMode="decimal" required />
                  </Campo>
                  <Campo rotulo="Motivo">
                    <Entrada name="motivo" required placeholder="Acerto combinado com o proprietário" />
                  </Campo>
                </div>
              </JanelaCadastro>
            )
          }
        >
          <ul className="divide-y divide-borda-suave text-sm">
            {(descontos ?? []).map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 py-2">
                <span>
                  {d.descricao} <span className="text-xs text-mudo">· {d.tipo === "despesa" ? "despesa autorizada" : "desconto avulso"}</span>
                </span>
                <span className="flex items-center gap-2">
                  <span className="tabular-nums">−{formatarReais(d.valor)}</span>
                  {pode && r.status === "pendente" && d.tipo === "ajuste" && (
                    <BotaoExcluir acao={removerAjuste} id={d.id} rotulo="Devolver desconto" confirmar="Devolver este desconto ao repasse?" />
                  )}
                </span>
              </li>
            ))}
            {!descontos?.length && <li className="py-2 text-mudo">Nenhum desconto lançado neste repasse.</li>}
          </ul>
          {aDescontar.length > 0 && (
            <div className="mt-4">
              <Aviso tipo="alerta">
                Ao aprovar, serão descontadas as despesas autorizadas do imóvel:{" "}
                {aDescontar.map((d) => `${d.descricao} (${formatarReais(paraReais(d.valor))})`).join(", ")}.
              </Aviso>
            </div>
          )}
          {r.observacoes && <p className="mt-3 text-xs text-mudo">Observações: {r.observacoes}</p>}
        </Cartao>

        <Cartao titulo="Histórico">
          <ol className="space-y-3 text-sm">
            {(eventos ?? []).map((e) => (
              <li key={e.id} className="flex flex-wrap items-start gap-3">
                <span className="w-32 shrink-0 text-xs text-mudo">
                  {new Date(e.data).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" })}
                </span>
                <Selo cor={COR_EVENTO[e.tipo] ?? "cinza"}>{ROTULO_EVENTO[e.tipo] ?? e.tipo}</Selo>
                <span className="min-w-0 flex-1 text-texto-2">
                  {e.descricao}
                  {e.valor !== null && e.tipo !== "aprovado" ? ` · ${formatarReais(e.valor)}` : ""}
                  {e.usuario_id ? <span className="text-xs text-mudo"> · {nomes.get(e.usuario_id) ?? "usuário"}</span> : null}
                </span>
              </li>
            ))}
            {!eventos?.length && <li className="text-mudo">Sem registros.</li>}
          </ol>
          <p className="mt-3 text-xs text-mudo">Registro automático (não pode ser alterado nem apagado).</p>
        </Cartao>
      </div>

      <div className="space-y-6">
        <Cartao titulo="Pagar ao proprietário">
          <div className="space-y-4 text-sm">
            <div>
              <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-mudo">Favorecido</div>
              <div className="mt-1 text-texto">
                <Link href={`/pessoas/${r.pessoa.id}`} className="hover:underline">
                  {r.pessoa.nome}
                </Link>
              </div>
            </div>
            <div>
              <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-mudo">Chave Pix</div>
              {chave ? (
                <>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <span className="break-all font-mono text-[13px] text-texto">{chave}</span>
                    {chavePix && <span className="text-xs text-mudo">({ROTULO_TIPO_CHAVE_PIX[chavePix.tipo]})</span>}
                    <Copiar texto={chave} rotulo="Copiar chave" />
                  </div>
                  {chavePix?.aviso && <p className="mt-1 text-xs text-alerta">{chavePix.aviso}</p>}
                </>
              ) : (
                <div className="mt-1 text-mudo">
                  Sem chave Pix.{" "}
                  <Link href={`/pessoas/${r.pessoa.id}`} className="text-acento hover:underline">
                    Cadastrar
                  </Link>
                </div>
              )}
            </div>
            {pix && r.status === "pendente" && (
              <div>
                <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-mudo">Pix copia e cola (com o valor)</div>
                <div className="mt-1 break-all rounded-[10px] bg-elev p-2 font-mono text-[11px] text-texto-2">{pix}</div>
                <div className="mt-2">
                  <Copiar texto={pix} rotulo="Copiar Pix copia e cola" />
                </div>
                <p className="mt-1 text-xs text-mudo">Cole no app do banco da imobiliária: chave, nome e valor já vêm preenchidos. Confira o favorecido antes de confirmar.</p>
              </div>
            )}
            <div>
              <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-mudo">Transferência</div>
              {banco ? (
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <span className="text-texto">{banco}</span>
                  <Copiar texto={`${r.pessoa.nome}${r.pessoa.documento ? ` · CPF/CNPJ ${r.pessoa.documento}` : ""} · ${banco}`} rotulo="Copiar dados" />
                </div>
              ) : (
                <div className="mt-1 text-mudo">Sem dados bancários no cadastro.</div>
              )}
            </div>
            <Definicao
              itens={[
                ["Valor", <b key="v">{formatarReais(r.valor_liquido)}</b>],
                ["Pagar em", r.status === "pago" ? `pago em ${formatarDataBR(r.pago_em)}` : formatarDataBR(dataDoPagamento(r))],
                ["Forma", r.forma_pagamento ? FORMAS_REPASSE[r.forma_pagamento] : "—"],
                ["Conta de saída", conta?.nome ?? "—"],
                ["Comprovante / ID", r.comprovante ?? "—"],
                ["Conciliado", r.conciliado_em ? "sim" : "não"],
              ]}
            />
            {r.status !== "cancelado" && <ComprovanteRepasse repasseId={r.id} organizacaoId={organizacao.id} temArquivo={!!r.comprovante_path} />}
            <p className="text-xs text-mudo">
              Pagamento automático pelo banco (Pix/TED pela API) fica pronto para ligar quando houver integração bancária contratada; hoje o pagamento é feito no app do banco e registrado aqui.
            </p>
          </div>
        </Cartao>

        <Cartao titulo="Aprovação">
          <Definicao
            itens={[
              ["Previsto na baixa", formatarDataBR(r.previsto_para)],
              ["Programado para", formatarDataBR(r.programado_para)],
              ["Aprovado em", r.aprovado_em ? new Date(r.aprovado_em).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }) : "—"],
              ["Aprovado por", r.aprovado_por ? (nomes.get(r.aprovado_por) ?? "usuário") : "—"],
              ["Pago por", r.pago_por ? (nomes.get(r.pago_por) ?? "usuário") : "—"],
              ...(r.status === "cancelado" ? ([["Motivo do cancelamento", r.cancelado_motivo ?? "—"]] as [string, string][]) : []),
            ]}
          />
          {!pode && r.status === "pendente" && <p className="mt-3 text-xs text-mudo">Só administrador, gestor ou financeiro aprovam e pagam repasses.</p>}
          {r.status === "pendente" && dataDoPagamento(r) < hoje && <p className="mt-3 text-xs font-medium text-ruim">Pagamento atrasado.</p>}
        </Cartao>
      </div>
    </div>
  );
}
