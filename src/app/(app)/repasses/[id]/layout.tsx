import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarClock, CheckCircle2, MessageCircle, Printer, Undo2, Wallet, XCircle } from "lucide-react";
import { BotaoAcao } from "@/components/botao-acao";
import { BotaoExcluir } from "@/components/botao-excluir";
import { JanelaCadastro } from "@/components/janela-cadastro";
import { SubAbas } from "@/components/sub-abas";
import { AreaTexto, BotaoLink, Campo, Entrada, Selecao, Selo, classeBotao } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { formatarCompetencia, formatarDataBR, hojeISO } from "@/lib/dominio/datas";
import { formatarReais, paraCentavos, paraReais } from "@/lib/dominio/dinheiro";
import { COR_SITUACAO_REPASSE, FORMAS_REPASSE, ROTULO_SITUACAO_REPASSE, dataDoPagamento, podeAprovarRepasse, repasseAtrasado, situacaoRepasse } from "@/lib/dominio/repasses";
import { linkWhatsapp } from "@/lib/whatsapp";
import { aprovarRepasse, cancelarRepasse, desfazerAprovacao, desfazerPagamento, excluirRepasse, pagarRepasse, reabrirRepasse, reagendarRepasse } from "../actions";
import { carregarRepasse, planoDoRepasse } from "../dados";

/** Cabeçalho e abas da ficha do repasse: situação, aprovação, agendamento e pagamento. */
export default async function RepasseLayout({ children, params }: LayoutProps<"/repasses/[id]">) {
  const { id } = await params;
  const { supabase, papel } = await obterContexto();
  const r = await carregarRepasse(supabase, id);
  if (!r) notFound();
  const hoje = hojeISO();
  const sit = situacaoRepasse(r, hoje);
  const pode = podeAprovarRepasse(papel);
  const [plano, { data: contas }] = await Promise.all([
    r.status === "pendente" && !r.aprovado_em ? planoDoRepasse(supabase, r) : Promise.resolve([]),
    supabase.from("contas_financeiras").select("id, nome").eq("ativa", true).order("nome"),
  ]);
  const aDescontar = plano.filter((d) => d.valor > 0);
  const base = `/repasses/${id}`;
  const tel = r.pessoa.telefone;
  const msg =
    r.status === "pago"
      ? `Olá ${r.pessoa.nome.split(" ")[0]}! O repasse de ${formatarCompetencia(r.competencia)} (${r.contrato.imovel.codigo}), de ${formatarReais(r.valor_liquido)}, foi pago em ${formatarDataBR(r.pago_em)}.`
      : `Olá ${r.pessoa.nome.split(" ")[0]}! O repasse de ${formatarCompetencia(r.competencia)} (${r.contrato.imovel.codigo}), de ${formatarReais(r.valor_liquido)}, está programado para ${formatarDataBR(dataDoPagamento(r))}.`;

  return (
    <>
      <div className="nao-imprimir mb-[clamp(14px,1.5vw,18px)] flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[13px] text-mudo">
            <span>Novo Aluguel</span>
            <span className="text-fraco">›</span>
            <Link href="/repasses" className="text-acento-hot hover:underline">
              Repasses
            </Link>
            <span className="text-fraco">›</span>
            <span>{formatarCompetencia(r.competencia)}</span>
          </div>
          <h1 className="mt-1.5 text-[clamp(26px,2.8vw,36px)] font-semibold leading-[1.05] tracking-[-0.025em] text-texto">
            {r.pessoa.nome} · {r.contrato.imovel.codigo}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[13.5px] text-texto-2">
            <Selo cor={COR_SITUACAO_REPASSE[sit]}>{ROTULO_SITUACAO_REPASSE[sit]}</Selo>
            {repasseAtrasado(r, hoje) && <Selo cor="vermelho">atrasado</Selo>}
            <span className="font-semibold tabular-nums text-texto">{formatarReais(r.valor_liquido)}</span>
            <span>
              {r.status === "pago" ? `pago em ${formatarDataBR(r.pago_em)}` : r.status === "pendente" ? `pagar em ${formatarDataBR(dataDoPagamento(r))}` : ""}
            </span>
            <Link href={`/contratos/${r.contrato.id}`} className="text-acento hover:underline">
              contrato #{r.contrato.numero}
            </Link>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {tel && (
            <a href={linkWhatsapp(tel, msg)} target="_blank" rel="noreferrer" className={classeBotao("secundario")}>
              <MessageCircle className="size-4" /> Avisar no WhatsApp
            </a>
          )}
          <BotaoLink href={`${base}/recibo`} variante="secundario">
            <Printer className="size-4" /> Recibo
          </BotaoLink>
          {pode && r.status === "pendente" && !r.aprovado_em && (
            <JanelaCadastro rotuloBotao={<><CheckCircle2 className="size-4" /> Aprovar</>} titulo="Aprovar repasse" acao={aprovarRepasse} icone={<CheckCircle2 />} rotuloSalvar="Aprovar">
              <input type="hidden" name="id" value={id} />
              <Campo rotulo="Pagar em" dica="Data programada para o pagamento (agendamento).">
                <Entrada type="date" name="programado_para" defaultValue={dataDoPagamento(r) < hoje ? hoje : dataDoPagamento(r)} required />
              </Campo>
              {aDescontar.length > 0 ? (
                <div className="space-y-2 rounded-[14px] border border-borda bg-elev p-3 text-sm">
                  <label className="flex items-center gap-2 font-medium text-texto">
                    <input type="hidden" name="descontar" value="" />
                    <input type="checkbox" name="descontar" defaultChecked /> Descontar as despesas autorizadas do imóvel
                  </label>
                  <ul className="space-y-1 text-texto-2">
                    {aDescontar.map((d) => (
                      <li key={d.lancamentoId} className="flex justify-between gap-3">
                        <span>{d.descricao}</span>
                        <span className="tabular-nums">−{formatarReais(paraReais(d.valor))}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="text-xs text-mudo">
                    Líquido depois dos descontos: {formatarReais(paraReais(paraCentavos(r.valor_liquido) - aDescontar.reduce((s, d) => s + d.valor, 0)))}
                  </p>
                </div>
              ) : (
                <input type="hidden" name="descontar" value="" />
              )}
            </JanelaCadastro>
          )}
          {pode && r.status === "pendente" && r.aprovado_em && (
            <>
              <JanelaCadastro rotuloBotao={<><Wallet className="size-4" /> Registrar pagamento</>} titulo="Registrar pagamento do repasse" acao={pagarRepasse} icone={<Wallet />} rotuloSalvar="Marcar como pago">
                <input type="hidden" name="id" value={id} />
                <div className="grid gap-4 sm:grid-cols-2">
                  <Campo rotulo="Forma">
                    <Selecao name="forma_pagamento" defaultValue={r.pessoa.pix_chave ? "pix" : "transferencia"}>
                      {Object.entries(FORMAS_REPASSE).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </Selecao>
                  </Campo>
                  <Campo rotulo="Pago em">
                    <Entrada type="date" name="pago_em" defaultValue={hoje} required />
                  </Campo>
                </div>
                <Campo rotulo="Saiu da conta">
                  <Selecao name="conta_id" defaultValue="">
                    <option value="">—</option>
                    {(contas ?? []).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nome}
                      </option>
                    ))}
                  </Selecao>
                </Campo>
                <Campo rotulo="Comprovante / ID da transação" dica="Você também pode anexar o arquivo do comprovante na ficha.">
                  <Entrada name="comprovante" placeholder="E1234567890…" />
                </Campo>
              </JanelaCadastro>
              <JanelaCadastro
                rotuloBotao={<><CalendarClock className="size-4" /> Reagendar</>}
                variante="secundario"
                titulo="Mudar a data do pagamento"
                acao={reagendarRepasse}
                icone={<CalendarClock />}
                rotuloSalvar="Salvar"
              >
                <input type="hidden" name="id" value={id} />
                <Campo rotulo="Pagar em">
                  <Entrada type="date" name="programado_para" defaultValue={dataDoPagamento(r)} required />
                </Campo>
              </JanelaCadastro>
              <BotaoAcao acao={desfazerAprovacao} id={id} confirmar="Desfazer a aprovação? As despesas descontadas voltam a ficar a descontar.">
                <Undo2 className="size-4" /> Desfazer aprovação
              </BotaoAcao>
            </>
          )}
          {pode && r.status === "pago" && (
            <BotaoAcao acao={desfazerPagamento} id={id} confirmar="Desfazer o pagamento deste repasse? Ele volta para pendente (aprovado).">
              <Undo2 className="size-4" /> Desfazer pagamento
            </BotaoAcao>
          )}
          {pode && r.status === "pendente" && (
            <JanelaCadastro rotuloBotao={<><XCircle className="size-4" /> Cancelar</>} variante="secundario" titulo="Cancelar repasse" acao={cancelarRepasse} icone={<XCircle />} rotuloSalvar="Cancelar repasse">
              <input type="hidden" name="id" value={id} />
              <Campo rotulo="Motivo">
                <AreaTexto name="motivo" required placeholder="Ex.: aluguel devolvido ao locatário, contrato rescindido…" />
              </Campo>
            </JanelaCadastro>
          )}
          {pode && r.status === "cancelado" && (
            <BotaoAcao acao={reabrirRepasse} id={id} confirmar="Reabrir este repasse (volta para pendente, a aprovar)?">
              <Undo2 className="size-4" /> Reabrir
            </BotaoAcao>
          )}
          <BotaoExcluir acao={excluirRepasse} id={id} variante="botao" rotulo="Excluir" confirmar="Excluir este repasse? O histórico continua guardado." depois="/repasses" />
        </div>
      </div>
      <div className="nao-imprimir">
        <SubAbas
          rotulo="Repasse"
          itens={[
            { href: base, rotulo: "Resumo" },
            { href: `${base}/recibo`, rotulo: "Recibo" },
          ]}
        />
      </div>
      {children}
    </>
  );
}
