import { Copiar } from "@/components/copiar";
import { enderecoImovel, MEIOS_COBRANCA, type ImovelEndereco, type SituacaoFatura } from "@/lib/dominio/cobrancas";
import { formatarCompetencia, formatarDataBR } from "@/lib/dominio/datas";
import { formatarReais, paraReais } from "@/lib/dominio/dinheiro";
import { formatarDocumento } from "@/lib/dominio/documentos";

const FORMA: Record<string, string> = { boleto: "boleto", pix: "Pix", transferencia: "transferência", dinheiro: "dinheiro", cartao: "cartão", outro: "outro meio" };

export interface DadosDocumentoCobranca {
  organizacao: { nome: string; documento?: string | null; telefone?: string | null; email?: string | null };
  numero: number;
  competencia: string;
  vencimento: string;
  periodoInicio?: string | null;
  periodoFim?: string | null;
  locatario: { nome: string; documento?: string | null } | null;
  imovel: ImovelEndereco;
  itens: { descricao: string; valor: number | string }[];
  status: string;
  pagoEm?: string | null;
  valorPago?: number | string | null;
  formaPagamento?: string | null;
  /** Situação para pagar hoje (centavos); null quando paga. */
  sit: SituacaoFatura | null;
  hoje: string;
  multaPct: number;
  jurosMesPct: number;
  carenciaDias: number;
  pix: string | null;
  linhaDigitavel?: string | null;
  urlPagamento?: string | null;
  meios: string[];
  banco?: { banco: string | null; agencia: string | null; conta: string | null } | null;
  instrucoes?: string | null;
}

/**
 * Corpo da cobrança / 2ª via (tela, impressão e link público): identificação
 * do imóvel sempre visível, itens, multa e juros em linhas separadas e como pagar.
 */
export function DocumentoCobranca({ d }: { d: DadosDocumentoCobranca }) {
  const endereco = enderecoImovel(d.imovel);
  const paga = d.status === "paga";
  const sit = d.sit;
  const atrasada = !paga && sit && sit.diasAtraso > 0;
  const totalHoje = sit ? (atrasada ? sit.totalComEncargos : sit.saldo) : 0;
  return (
    <article className="rounded-card border border-borda bg-card p-[clamp(20px,3vw,32px)] text-texto print:border-0 print:p-0 print:shadow-none">
      <div className="flex flex-wrap justify-between gap-4 border-b border-borda pb-4">
        <div>
          <div className="text-lg font-semibold">{d.organizacao.nome}</div>
          {d.organizacao.documento && <div className="text-xs text-mudo">CPF/CNPJ {formatarDocumento(d.organizacao.documento)}</div>}
          {(d.organizacao.telefone || d.organizacao.email) && <div className="text-xs text-mudo">{[d.organizacao.telefone, d.organizacao.email].filter(Boolean).join(" · ")}</div>}
        </div>
        <div className="text-right text-sm">
          <div>Cobrança nº {d.numero}</div>
          <div>Aluguel de {formatarCompetencia(d.competencia)}</div>
          <div className="font-semibold">Vencimento {formatarDataBR(d.vencimento)}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 py-4 text-sm sm:grid-cols-2">
        <div>
          <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-mudo">Locatário</div>
          {d.locatario ? (
            <>
              {d.locatario.nome}
              {d.locatario.documento ? ` · ${formatarDocumento(d.locatario.documento)}` : ""}
            </>
          ) : (
            "—"
          )}
        </div>
        <div>
          <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-mudo">Imóvel</div>
          <span className="font-medium">{d.imovel.codigo || "Imóvel"}</span>
          {endereco ? <span className="block text-texto-2">{endereco}</span> : <span className="block text-xs text-mudo">Endereço não cadastrado</span>}
        </div>
        {d.periodoInicio && d.periodoFim && (
          <div>
            <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-mudo">Período de uso</div>
            {formatarDataBR(d.periodoInicio)} a {formatarDataBR(d.periodoFim)}
          </div>
        )}
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-borda text-left font-mono text-[10.5px] uppercase tracking-[0.1em] text-mudo">
            <th className="py-2 font-semibold">Descrição</th>
            <th className="py-2 text-right font-semibold">Valor</th>
          </tr>
        </thead>
        <tbody>
          {d.itens.map((i, k) => (
            <tr key={k} className="border-b border-borda-suave">
              <td className="py-2">{i.descricao}</td>
              <td className={`py-2 text-right tabular-nums ${Number(i.valor) < 0 ? "text-ok" : ""}`}>{formatarReais(i.valor)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          {paga ? (
            <tr>
              <td className="py-2 font-semibold">Total pago</td>
              <td className="py-2 text-right text-lg font-semibold tabular-nums">{formatarReais(d.valorPago)}</td>
            </tr>
          ) : (
            sit && (
              <>
                {sit.abatido > 0 && (
                  <>
                    <tr>
                      <td className="pt-2 text-texto-2">Já recebido</td>
                      <td className="pt-2 text-right tabular-nums text-ok">− {formatarReais(paraReais(sit.abatido))}</td>
                    </tr>
                    <tr>
                      <td className="py-1 font-medium">Saldo do aluguel</td>
                      <td className="py-1 text-right tabular-nums">{formatarReais(paraReais(sit.saldo))}</td>
                    </tr>
                  </>
                )}
                {atrasada && (
                  <>
                    <tr>
                      <td className="py-1 text-ruim">Multa por atraso ({d.multaPct}%)</td>
                      <td className="py-1 text-right tabular-nums text-ruim">{formatarReais(paraReais(sit.multa))}</td>
                    </tr>
                    <tr>
                      <td className="py-1 text-ruim">
                        Juros de mora ({d.jurosMesPct}% ao mês · {sit.diasJuros} dia{sit.diasJuros === 1 ? "" : "s"})
                      </td>
                      <td className="py-1 text-right tabular-nums text-ruim">{formatarReais(paraReais(sit.juros))}</td>
                    </tr>
                  </>
                )}
                <tr className="border-t border-borda">
                  <td className="py-2 font-semibold">{atrasada ? `Total para pagar hoje (${formatarDataBR(d.hoje)})` : "Total a pagar"}</td>
                  <td className="py-2 text-right text-lg font-semibold tabular-nums">{formatarReais(paraReais(totalHoje))}</td>
                </tr>
                {sit.descontoPontualidade > 0 && (
                  <tr>
                    <td className="pb-1 text-xs text-ok" colSpan={2}>
                      Pagando até {formatarDataBR(d.vencimento)}: desconto de pontualidade de {formatarReais(paraReais(sit.descontoPontualidade))} (paga {formatarReais(paraReais(sit.saldo - sit.descontoPontualidade))}).
                    </td>
                  </tr>
                )}
              </>
            )
          )}
        </tfoot>
      </table>

      <p className="mt-3 text-xs text-mudo">
        Após o vencimento{d.carenciaDias ? ` (com ${d.carenciaDias} dia(s) de tolerância)` : ""}: multa de {d.multaPct}% (uma vez) e juros de {d.jurosMesPct}% ao mês, proporcionais aos dias de atraso.
      </p>

      {paga ? (
        <p className="mt-4 text-sm font-medium text-ok">
          Pago em {formatarDataBR(d.pagoEm)}
          {d.formaPagamento ? ` por ${FORMA[d.formaPagamento] ?? d.formaPagamento}` : ""}. Obrigado!
        </p>
      ) : d.status === "renegociada" ? (
        <p className="mt-4 text-sm font-medium text-acento">Este aluguel está num acordo de pagamento: ele é pago pelas parcelas do acordo.</p>
      ) : (
        d.status !== "cancelada" && (
          <div className="mt-5 space-y-3">
            <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-mudo">Como pagar</div>
            {d.pix && (
              <div className="rounded-[14px] border border-borda bg-elev p-3">
                <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-semibold">Pix copia e cola ({formatarReais(paraReais(totalHoje))})</span>
                  <span className="nao-imprimir">
                    <Copiar texto={d.pix} rotulo="Copiar código Pix" />
                  </span>
                </div>
                <div className="break-all font-mono text-[11px] leading-relaxed text-texto-2">{d.pix}</div>
                <p className="mt-1.5 text-xs text-mudo">No aplicativo do banco: Pix → “Pix copia e cola” → cole o código.</p>
              </div>
            )}
            {d.linhaDigitavel && (
              <div className="rounded-[14px] border border-borda bg-elev p-3 text-sm">
                <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold">Boleto — linha digitável</span>
                  <span className="nao-imprimir">
                    <Copiar texto={d.linhaDigitavel.replace(/\D/g, "")} rotulo="Copiar linha" />
                  </span>
                </div>
                <div className="break-all font-mono text-xs">{d.linhaDigitavel}</div>
              </div>
            )}
            {d.urlPagamento && (
              <a href={d.urlPagamento} target="_blank" rel="noreferrer" className="nao-imprimir inline-block text-sm font-medium text-acento underline">
                Pagar pelo link (cartão ou boleto)
              </a>
            )}
            {d.meios.includes("transferencia") && d.banco && (d.banco.banco || d.banco.conta) && (
              <div className="text-sm text-texto-2">
                Transferência/depósito: {[d.banco.banco, d.banco.agencia && `agência ${d.banco.agencia}`, d.banco.conta && `conta ${d.banco.conta}`].filter(Boolean).join(" · ")} — {d.organizacao.nome}
              </div>
            )}
            {d.meios.length > 0 && <div className="text-xs text-mudo">Meios aceitos: {d.meios.map((m) => MEIOS_COBRANCA[m] ?? m).join(", ")}.</div>}
            {d.instrucoes && <p className="whitespace-pre-line text-sm text-texto-2">{d.instrucoes}</p>}
          </div>
        )
      )}
    </article>
  );
}
