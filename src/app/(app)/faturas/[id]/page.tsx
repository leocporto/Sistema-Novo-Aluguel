import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BotaoEnviar, BotaoImprimir, Formulario } from "@/components/formulario";
import { Cabecalho, Campo, Cartao, Entrada, Selecao, Selo, classeBotao } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { formatarCompetencia, formatarDataBR, hojeISO } from "@/lib/dominio/datas";
import { formatarReais, paraReais } from "@/lib/dominio/dinheiro";
import { formatarDocumento } from "@/lib/dominio/documentos";
import { carregarContrato, locatarioPrincipal, simularLiquidacao } from "@/lib/servicos/locacao";
import type { Fatura, FaturaItem } from "@/lib/tipos";
import { cancelarFatura, darBaixa } from "../actions";

export const metadata: Metadata = { title: "Fatura" };

export default async function FaturaPage({ params, searchParams }: PageProps<"/faturas/[id]">) {
  const { id } = await params;
  const sp = await searchParams;
  const { supabase, organizacao } = await obterContexto();
  const { data } = await supabase.from("faturas").select("*").eq("id", id).maybeSingle();
  if (!data) notFound();
  const fatura = data as Fatura;
  const dados = await carregarContrato(supabase, fatura.contrato_id);
  if (!dados) notFound();
  const { data: itensRaw } = await supabase.from("fatura_itens").select("*").eq("fatura_id", id);
  const itens = (itensRaw ?? []) as FaturaItem[];
  const locatario = locatarioPrincipal(dados);
  const hoje = hojeISO();

  const dataPagamento = typeof sp.pago_em === "string" && sp.pago_em ? sp.pago_em : hoje;
  const simulacao = fatura.status === "aberta" ? simularLiquidacao(fatura, dados.contrato, dataPagamento) : null;
  const atrasada = fatura.status === "aberta" && fatura.vencimento < hoje;

  return (
    <>
      <Cabecalho
        titulo={`Fatura #${fatura.numero}`}
        descricao={
          <Link href={`/contratos/${dados.contrato.id}`} className="text-acento hover:underline">
            Contrato #{dados.contrato.numero} · {dados.imovel.codigo}
          </Link>
        }
        acoes={
          <>
            <Selo cor={atrasada ? "vermelho" : fatura.status === "paga" ? "verde" : fatura.status === "aberta" ? "amarelo" : "cinza"}>
              {atrasada ? "em atraso" : fatura.status}
            </Selo>
            <BotaoImprimir />
          </>
        }
      />
      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        {/* Documento de cobrança (2ª via) */}
        <article className="rounded-xl border border-borda bg-card p-8 shadow-sm print:border-0 print:shadow-none">
          <div className="flex justify-between gap-4 border-b border-borda pb-4">
            <div>
              <div className="text-lg font-semibold">{organizacao.nome}</div>
              <div className="text-xs text-mudo">{formatarDocumento(organizacao.documento)}</div>
            </div>
            <div className="text-right text-sm">
              <div>Fatura nº {fatura.numero}</div>
              <div>Competência {formatarCompetencia(fatura.competencia)}</div>
              <div className="font-semibold">Vencimento {formatarDataBR(fatura.vencimento)}</div>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-2 py-4 text-sm sm:grid-cols-2">
            <div>
              <div className="text-xs uppercase text-mudo">Locatário</div>
              {locatario?.nome} · {formatarDocumento(locatario?.documento)}
            </div>
            <div>
              <div className="text-xs uppercase text-mudo">Imóvel</div>
              {[dados.imovel.logradouro, dados.imovel.numero, dados.imovel.complemento, dados.imovel.cidade].filter(Boolean).join(", ")}
            </div>
            <div>
              <div className="text-xs uppercase text-mudo">Período de uso</div>
              {formatarDataBR(fatura.periodo_inicio)} a {formatarDataBR(fatura.periodo_fim)}
            </div>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-borda text-left text-xs uppercase text-mudo">
                <th className="py-2">Descrição</th>
                <th className="py-2 text-right">Valor</th>
              </tr>
            </thead>
            <tbody>
              {itens.map((i) => (
                <tr key={i.id} className="border-b border-borda-suave">
                  <td className="py-2">{i.descricao}</td>
                  <td className="py-2 text-right">{formatarReais(i.valor)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td className="py-2 font-semibold">Total{fatura.status === "paga" ? " pago" : ""}</td>
                <td className="py-2 text-right text-lg font-semibold">{formatarReais(fatura.valor_pago ?? fatura.valor_total)}</td>
              </tr>
            </tfoot>
          </table>
          <p className="mt-4 text-xs text-mudo">
            Após o vencimento: multa de {Number(dados.contrato.multa_atraso_pct)}% e juros de {Number(dados.contrato.juros_mes_pct)}% ao mês pro rata.
          </p>
          {fatura.pix_copia_cola && (
            <div className="mt-4 break-all rounded-lg bg-elev p-3 font-mono text-xs">Pix copia e cola: {fatura.pix_copia_cola}</div>
          )}
          {fatura.linha_digitavel && (
            <div className="mt-2 rounded-lg bg-elev p-3 font-mono text-xs">Linha digitável: {fatura.linha_digitavel}</div>
          )}
          {fatura.status === "paga" && (
            <p className="mt-4 text-sm text-acento">
              Pago em {formatarDataBR(fatura.pago_em)} via {fatura.forma_pagamento}.
            </p>
          )}
        </article>

        {fatura.status === "aberta" && simulacao && (
          <div className="nao-imprimir space-y-6">
            <Cartao titulo="Registrar pagamento">
              <form className="mb-3 flex items-end gap-2">
                <Campo rotulo="Data do pagamento">
                  <Entrada type="date" name="pago_em" defaultValue={dataPagamento} />
                </Campo>
                <button className={classeBotao("secundario")}>Recalcular</button>
              </form>
              <div className="mb-4 space-y-1 text-sm">
                <div className="flex justify-between">
                  <span>Valor da fatura</span>
                  <span>{formatarReais(fatura.valor_total)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Multa</span>
                  <span>{formatarReais(paraReais(simulacao.multa))}</span>
                </div>
                <div className="flex justify-between">
                  <span>Juros ({simulacao.diasAtraso > 0 ? simulacao.diasAtraso : 0} dias)</span>
                  <span>{formatarReais(paraReais(simulacao.juros))}</span>
                </div>
                <div className="flex justify-between border-t border-borda-suave pt-1 font-semibold">
                  <span>Total a receber</span>
                  <span>{formatarReais(paraReais(simulacao.total))}</span>
                </div>
              </div>
              <Formulario acao={darBaixa} className="space-y-3">
                <input type="hidden" name="fatura_id" value={fatura.id} />
                <input type="hidden" name="pago_em" value={dataPagamento} />
                <Campo rotulo="Forma de pagamento">
                  <Selecao name="forma_pagamento" defaultValue="pix">
                    <option value="pix">Pix</option>
                    <option value="boleto">Boleto</option>
                    <option value="transferencia">Transferência</option>
                    <option value="dinheiro">Dinheiro</option>
                    <option value="cartao">Cartão</option>
                    <option value="outro">Outro</option>
                  </Selecao>
                </Campo>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="dispensar" /> Dispensar multa e juros
                </label>
                <BotaoEnviar>Dar baixa em {formatarDataBR(dataPagamento)}</BotaoEnviar>
              </Formulario>
            </Cartao>
            <Cartao titulo="Cancelar fatura">
              <Formulario acao={cancelarFatura} className="space-y-3">
                <input type="hidden" name="fatura_id" value={fatura.id} />
                <Campo rotulo="Motivo">
                  <Entrada name="motivo" placeholder="Ex.: valor incorreto, será reemitida" />
                </Campo>
                <BotaoEnviar variante="perigo" confirmar="Cancelar esta fatura?">
                  Cancelar
                </BotaoEnviar>
              </Formulario>
            </Cartao>
          </div>
        )}
      </div>
    </>
  );
}
