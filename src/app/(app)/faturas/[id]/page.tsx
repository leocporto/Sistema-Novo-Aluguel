import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Copiar } from "@/components/copiar";
import { BotaoEnviar, Formulario } from "@/components/formulario";
import { Aviso, Campo, Cartao, Entrada } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { formatarDataBR } from "@/lib/dominio/datas";
import { formatarReais, paraReais } from "@/lib/dominio/dinheiro";
import { configCobranca, linkPagar, pixDaCobranca, recebedorPix, urlBase } from "../../cobrancas/dados";
import { cancelarFatura, salvarMeiosDaFatura } from "../actions";
import { DocumentoCobranca } from "../documento-cobranca";
import { carregarFicha } from "../ficha";

export const metadata: Metadata = { title: "Cobrança" };

export default async function FaturaPage({ params }: PageProps<"/faturas/[id]">) {
  const { id } = await params;
  const ficha = await carregarFicha(id);
  if (!ficha) notFound();
  const { supabase, organizacao } = await obterContexto();
  const { fatura, dados, itens, sit, locatario, hoje } = ficha;
  const cfg = configCobranca(organizacao);
  const [recebedor, base, conta] = await Promise.all([
    recebedorPix(supabase, organizacao),
    urlBase(),
    cfg.contaId ? supabase.from("contas_financeiras").select("banco, agencia, conta").eq("id", cfg.contaId).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const aberta = fatura.status === "aberta";
  const totalHoje = sit ? (sit.diasAtraso > 0 ? sit.totalComEncargos : sit.saldo) : 0;
  const pix = aberta ? pixDaCobranca(recebedor, totalHoje, `FAT${fatura.numero}`) : null;
  const link = linkPagar(base, fatura.token_publico);

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
      <DocumentoCobranca
        d={{
          organizacao: { nome: organizacao.nome, documento: organizacao.documento, telefone: organizacao.telefone, email: organizacao.email },
          numero: fatura.numero,
          competencia: fatura.competencia,
          vencimento: fatura.vencimento,
          periodoInicio: fatura.periodo_inicio,
          periodoFim: fatura.periodo_fim,
          locatario: locatario ? { nome: locatario.nome, documento: locatario.documento } : null,
          imovel: dados.imovel,
          itens,
          status: fatura.status,
          pagoEm: fatura.pago_em,
          valorPago: fatura.valor_pago,
          formaPagamento: fatura.forma_pagamento,
          sit,
          hoje,
          multaPct: Number(dados.contrato.multa_atraso_pct),
          jurosMesPct: Number(dados.contrato.juros_mes_pct),
          carenciaDias: dados.contrato.carencia_dias,
          pix,
          linhaDigitavel: fatura.linha_digitavel,
          urlPagamento: fatura.url_pagamento,
          meios: cfg.meios,
          banco: conta.data as { banco: string | null; agencia: string | null; conta: string | null } | null,
          instrucoes: cfg.instrucoes,
        }}
      />

      <div className="nao-imprimir space-y-6">
        {sit && (
          <Cartao titulo="Situação hoje">
            <dl className="space-y-1.5 text-sm">
              {[
                ["Valor da cobrança", formatarReais(fatura.valor_total)],
                ["Já recebido", formatarReais(paraReais(sit.recebido))],
                ["Saldo do aluguel", formatarReais(paraReais(sit.saldo))],
                ...(sit.diasAtraso > 0
                  ? [
                      [`Multa (${Number(dados.contrato.multa_atraso_pct)}%)`, formatarReais(paraReais(sit.multa))],
                      [`Juros (${sit.diasJuros} dias)`, formatarReais(paraReais(sit.juros))],
                    ]
                  : []),
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-2">
                  <dt className="text-texto-2">{k}</dt>
                  <dd className="tabular-nums">{v}</dd>
                </div>
              ))}
              <div className="flex justify-between gap-2 border-t border-borda pt-1.5 font-semibold">
                <dt>Para quitar hoje</dt>
                <dd className="tabular-nums">{formatarReais(paraReais(totalHoje))}</dd>
              </div>
            </dl>
            {fatura.status === "renegociada" && <p className="mt-3 text-sm text-texto-2">Esta cobrança está num acordo: o recebimento é feito pelas parcelas do acordo.</p>}
            {sit.diasAtraso > 0 && <p className="mt-3 text-xs text-mudo">Multa e juros são sugestões pelo contrato. Na hora de receber, você decide se cobra.</p>}
          </Cartao>
        )}

        {aberta && (
          <Cartao titulo="Link da 2ª via">
            {cfg.linkPublico ? (
              <>
                <p className="mb-2 break-all font-mono text-xs text-texto-2">{link}</p>
                <div className="flex flex-wrap items-center gap-2">
                  <Copiar texto={link} rotulo="Copiar link" />
                  <a href={link} target="_blank" rel="noreferrer" className="text-xs font-medium text-acento hover:underline">
                    abrir como o locatário vê
                  </a>
                </div>
                <p className="mt-2 text-xs text-mudo">
                  {fatura.segunda_via_vista_em
                    ? `Link aberto fora do sistema em ${new Date(fatura.segunda_via_vista_em).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })} (provavelmente pelo locatário).`
                    : "O link ainda não foi aberto fora do sistema."}{" "}
                  Quem está logado aqui e as prévias de link do WhatsApp não contam.
                </p>
              </>
            ) : (
              <p className="text-sm text-texto-2">O link público está desligado em Cobranças → Régua e Pix.</p>
            )}
            {!recebedor && cfg.meios.includes("pix") && <p className="mt-3 text-xs text-alerta">Cadastre a chave Pix em Cobranças → Régua e Pix para o código Pix sair na cobrança.</p>}
          </Cartao>
        )}

        {aberta && (
          <Cartao titulo="Boleto ou link de pagamento">
            <Formulario acao={salvarMeiosDaFatura} automatico className="space-y-3">
              <input type="hidden" name="id" value={fatura.id} />
              <Campo rotulo="Linha digitável do boleto" dica="Boleto emitido no site do seu banco: cole a linha aqui para ela sair na 2ª via.">
                <Entrada name="linha_digitavel" defaultValue={fatura.linha_digitavel ?? ""} inputMode="numeric" />
              </Campo>
              <Campo rotulo="Link de pagamento (cartão/boleto)">
                <Entrada name="url_pagamento" defaultValue={fatura.url_pagamento ?? ""} placeholder="https://" />
              </Campo>
            </Formulario>
            <p className="mt-2 text-xs text-mudo">Boleto registrado e Pix com baixa automática pelo banco ficam prontos para ligar quando houver contrato de cobrança com um banco.</p>
          </Cartao>
        )}

        {aberta && (
          <Cartao titulo="Cancelar cobrança">
            {Number(fatura.valor_recebido) > 0 ? (
              <Aviso tipo="info">Esta cobrança já tem recebimento ({formatarReais(fatura.valor_recebido)}). Para cancelar, desfaça os recebimentos na aba Recebimentos.</Aviso>
            ) : (
              <Formulario acao={cancelarFatura} className="space-y-3">
                <input type="hidden" name="fatura_id" value={fatura.id} />
                <Campo rotulo="Motivo">
                  <Entrada name="motivo" required placeholder="Ex.: valor incorreto, será reemitida" />
                </Campo>
                <BotaoEnviar variante="perigo" confirmar={`Cancelar a cobrança nº ${fatura.numero} de ${formatarReais(fatura.valor_total)}? Ela deixa de ser cobrada.`}>
                  Cancelar cobrança
                </BotaoEnviar>
              </Formulario>
            )}
          </Cartao>
        )}

        {fatura.status === "cancelada" && fatura.observacoes && (
          <Aviso tipo="info">
            Cancelada. Motivo: {fatura.observacoes}
          </Aviso>
        )}
        {fatura.status === "paga" && (
          <Aviso tipo="info">
            Quitada em {formatarDataBR(fatura.pago_em)}. Veja cada recebimento na aba Recebimentos.
          </Aviso>
        )}
      </div>
    </div>
  );
}
