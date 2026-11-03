import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarDays, CheckCircle2, MessageCircle, Printer, Receipt, RotateCcw } from "lucide-react";
import { BotaoAcao } from "@/components/botao-acao";
import { BotaoEnviar, Formulario } from "@/components/formulario";
import { JanelaCadastro } from "@/components/janela-cadastro";
import { AreaTexto, Aviso, BotaoLink, Campo, Cartao, Definicao, Entrada, Selecao, Selo, classeBotao } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { diaLocal, horaLocal } from "@/lib/dominio/agenda";
import { formatarCompetencia, formatarDataBR, hojeISO } from "@/lib/dominio/datas";
import { formatarReais } from "@/lib/dominio/dinheiro";
import { ROTULO_SITUACAO, situacaoLancamento } from "@/lib/dominio/financeiro";
import { estrelas, mensagemAgendamento, planoFinanceiro, sugerirResponsabilidade, textoGarantia } from "@/lib/dominio/manutencao";
import { linkWhatsapp } from "@/lib/whatsapp";
import { agendarChamado, avaliarChamado, concluirChamado, desfazerConclusao, gerarContaReceber, lancarNaFatura } from "../../actions";
import { carregarChamado, contatoDoSolicitante, enderecoImovel, faturasAbertas, midiasDoChamado } from "../../dados";
import { MidiasChamado } from "../midias";

export const metadata: Metadata = { title: "Agenda e conclusão do chamado" };

export default async function ExecucaoChamado({ params }: PageProps<"/manutencao/[id]/execucao">) {
  const { id } = await params;
  const { supabase, organizacao, papel } = await obterContexto();
  const modo = organizacao.modo;
  const c = await carregarChamado(supabase, id);
  if (!c) notFound();
  const hoje = hojeISO();
  const [midias, contato, faturas, { data: lancs }] = await Promise.all([
    midiasDoChamado(supabase, id),
    contatoDoSolicitante(supabase, c),
    faturasAbertas(supabase, c.contrato_id),
    supabase.from("lancamentos").select("id, tipo, descricao, valor, vencimento, status, requer_aprovacao, aprovado_em, descontar_repasse").eq("chamado_id", id).order("tipo"),
  ]);
  const podeAgendar = ["aprovado", "agendado", "em_execucao"].includes(c.status);
  const concluido = ["concluido", "avaliado"].includes(c.status);
  const podeDecidir = papel !== "corretor";
  const endereco = enderecoImovel(c.imovel) || c.imovel?.codigo || "";
  const quando = c.agendado_para ? `${formatarDataBR(diaLocal(c.agendado_para))} às ${horaLocal(c.agendado_para)}` : null;
  const valorRef = Number(c.valor_final ?? c.valor_aprovado ?? 0);
  let plano: ReturnType<typeof planoFinanceiro> | null = null;
  let erroPlano: string | null = null;
  if (valorRef > 0) {
    try {
      plano = planoFinanceiro({
        modo,
        valor: valorRef,
        responsabilidade: c.responsabilidade ?? sugerirResponsabilidade(c.categoria).responsavel,
        partes: { locatario: Number(c.pct_locatario), proprietario: Number(c.pct_proprietario), imobiliaria: Number(c.pct_imobiliaria) },
        pagoDireto: c.pago_direto,
        titulo: c.titulo,
      });
    } catch (e) {
      erroPlano = e instanceof Error ? e.message : String(e);
    }
  }
  const lancamentos = (lancs ?? []) as { id: string; tipo: string; descricao: string; valor: number; vencimento: string; status: string; requer_aprovacao: boolean; aprovado_em: string | null; descontar_repasse: boolean }[];
  const temReceber = lancamentos.some((l) => l.tipo === "receber");
  const cobrancaPendente = concluido && (plano?.cobrarLocatario ?? 0) > 0 && !c.fatura_item_id && !temReceber;
  const faturasFuturas = faturas.filter((f) => f.vencimento >= hoje);

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
      <div className="space-y-6">
        <Cartao
          titulo="Agendamento do serviço"
          acoes={
            c.visita_id && (
              <Link href={`/agenda/${c.visita_id}`} className="inline-flex items-center gap-1 text-sm text-acento hover:underline">
                <CalendarDays className="size-4" /> ver na agenda
              </Link>
            )
          }
        >
          {!podeAgendar && !concluido ? (
            <p className="text-sm text-texto-2">Escolha e aprove um orçamento (aba Orçamentos) para marcar o serviço.</p>
          ) : (
            <div className="space-y-4">
              {quando && (
                <p className="text-[15px] text-texto">
                  Marcado para <b>{quando}</b>
                  {c.prestador ? ` com ${c.prestador.nome}` : ""}.
                </p>
              )}
              {podeAgendar && (
                <Formulario acao={agendarChamado} className="space-y-3">
                  <input type="hidden" name="id" value={id} />
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Campo rotulo="Dia">
                      <Entrada type="date" name="data" required defaultValue={c.agendado_para ? diaLocal(c.agendado_para) : hoje} />
                    </Campo>
                    <Campo rotulo="Hora">
                      <Entrada type="time" name="hora" required defaultValue={c.agendado_para ? horaLocal(c.agendado_para) : "09:00"} />
                    </Campo>
                    <Campo rotulo="Duração (min)">
                      <Entrada name="duracao_min" inputMode="numeric" defaultValue={c.duracao_min} />
                    </Campo>
                  </div>
                  <BotaoEnviar variante={quando ? "secundario" : "primario"}>
                    <CalendarDays className="size-4" /> {quando ? "Remarcar" : "Agendar e pôr na agenda"}
                  </BotaoEnviar>
                </Formulario>
              )}
              {quando && (
                <div className="flex flex-wrap gap-2">
                  {contato && (
                    <a
                      href={linkWhatsapp(contato.telefone, mensagemAgendamento({ nome: contato.nome, numero: c.numero, titulo: c.titulo, quando, endereco, prestador: c.prestador?.nome }))}
                      target="_blank"
                      rel="noreferrer"
                      className={classeBotao("secundario")}
                    >
                      <MessageCircle className="size-4" /> Avisar quem pediu
                    </a>
                  )}
                  {c.prestador?.telefone && (
                    <a
                      href={linkWhatsapp(c.prestador.telefone, mensagemAgendamento({ nome: c.prestador.nome, numero: c.numero, titulo: c.titulo, quando, endereco }))}
                      target="_blank"
                      rel="noreferrer"
                      className={classeBotao("secundario")}
                    >
                      <MessageCircle className="size-4" /> Avisar o prestador
                    </a>
                  )}
                  <BotaoLink href={`/manutencao/${id}/os`} variante="secundario">
                    <Printer className="size-4" /> Ordem de serviço
                  </BotaoLink>
                </div>
              )}
            </div>
          )}
        </Cartao>

        <Cartao titulo="Aprovação da conclusão e financeiro">
          {concluido ? (
            <div className="space-y-4">
              <Definicao
                itens={[
                  ["Concluído em", formatarDataBR(c.concluido_em)],
                  ["Conclusão aprovada por", c.conclusao_aprovada_por ?? "—"],
                  ["Valor final", c.valor_final != null ? formatarReais(c.valor_final) : "—"],
                  ["Garantia", textoGarantia(c.concluido_em, c.garantia_ate)],
                  ["Observação", c.conclusao_obs ?? "—"],
                  ["Locatário confirmou", c.locatario_confirmou_em ? formatarDataBR(c.locatario_confirmou_em.slice(0, 10)) : "não"],
                ]}
              />
              <div>
                <div className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-mudo">Lançamentos no Financeiro</div>
                {lancamentos.length === 0 && !c.fatura_item_id ? (
                  <p className="text-sm text-mudo">{c.pago_direto ? "Nenhum: o responsável pagou direto ao prestador." : "Nenhum lançamento."}</p>
                ) : (
                  <ul className="divide-y divide-borda-suave rounded-[14px] border border-borda">
                    {lancamentos.map((l) => {
                      const sit = situacaoLancamento(l, hoje);
                      return (
                        <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-sm">
                          <Link href={`/financeiro/lancamentos/${l.id}`} className="min-w-0 flex-1 text-texto hover:underline">
                            {l.tipo === "receber" ? "A receber" : "A pagar"} · {l.descricao}
                            {l.descontar_repasse && <span className="block text-xs text-mudo">descontar no próximo repasse</span>}
                          </Link>
                          <span className="flex items-center gap-2">
                            <b className="tabular-nums">{formatarReais(l.valor)}</b>
                            <Selo cor={sit === "liquidado" ? "verde" : sit === "aguardando_aprovacao" ? "amarelo" : sit === "vencido" ? "vermelho" : "azul"}>{ROTULO_SITUACAO[sit]}</Selo>
                          </span>
                        </li>
                      );
                    })}
                    {c.fatura_item_id && (
                      <li className="px-3 py-2.5 text-sm text-texto-2">
                        <Receipt className="mr-1 inline size-4" /> Parte do locatário ({formatarReais(plano?.cobrarLocatario ?? 0)}) lançada na fatura do contrato.
                      </li>
                    )}
                  </ul>
                )}
              </div>
              {cobrancaPendente && (
                <Aviso tipo="alerta">
                  <div className="space-y-2">
                    <p>
                      <b>Cobrança do locatário pendente: {formatarReais(plano!.cobrarLocatario)}.</b> Não havia fatura em aberto quando o chamado foi concluído.
                    </p>
                    {podeDecidir && (
                      <div className="flex flex-wrap gap-2">
                        {c.contrato_id && (
                          <BotaoAcao acao={lancarNaFatura} id={id} tamanho="sm" variante="primario" confirmar={`Lançar ${formatarReais(plano!.cobrarLocatario)} na próxima fatura em aberto do contrato?`}>
                            <Receipt className="size-3.5" /> Lançar na fatura
                          </BotaoAcao>
                        )}
                        <BotaoAcao acao={gerarContaReceber} id={id} tamanho="sm" confirmar={`Criar conta a receber de ${formatarReais(plano!.cobrarLocatario)} do locatário no Financeiro?`}>
                          Gerar conta a receber
                        </BotaoAcao>
                      </div>
                    )}
                  </div>
                </Aviso>
              )}
              {podeDecidir && (
                <BotaoAcao acao={desfazerConclusao} id={id} confirmar="Desfazer a conclusão? Os lançamentos ainda em aberto saem do Financeiro e a cobrança sai da fatura em aberto. Pagamentos já feitos impedem desfazer.">
                  <RotateCcw className="size-4" /> Desfazer conclusão
                </BotaoAcao>
              )}
            </div>
          ) : !podeAgendar ? (
            <p className="text-sm text-texto-2">A conclusão fica disponível depois que o serviço for aprovado.</p>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-texto-2">
                Quando o prestador terminar: confira o serviço (de preferência com quem pediu), envie as fotos do depois e aprove a conclusão. Os lançamentos entram no Financeiro <b>em aberto</b>; o pagamento é feito lá (pagamentos acima do limite precisam de aprovação de um administrador ou gestor).
              </p>
              {c.locatario_confirmou_em && <Aviso>O locatário confirmou pelo link que o serviço foi feito{c.locatario_comentario ? `: “${c.locatario_comentario}”` : "."}</Aviso>}
              {erroPlano && <Aviso tipo="erro">{erroPlano} Ajuste em “Quem paga o conserto” (aba Resumo).</Aviso>}
              {plano && (
                <ul className="space-y-1 text-sm text-texto-2">
                  {plano.pagar.map((l, i) => (
                    <li key={i}>
                      • Conta a pagar ao prestador: <b className="text-texto">{formatarReais(l.valor)}</b>
                      {l.descontarRepasse ? " (descontada do próximo repasse ao proprietário)" : ""}
                    </li>
                  ))}
                  {plano.cobrarLocatario > 0 && (
                    <li>
                      • Cobrar do locatário: <b className="text-texto">{formatarReais(plano.cobrarLocatario)}</b>
                    </li>
                  )}
                  {plano.pagar.length === 0 && <li>• Nada é lançado: o responsável paga direto ao prestador.</li>}
                  <li className="text-xs text-mudo">Valores do orçamento escolhido; se o valor final mudar, a divisão é refeita.</li>
                </ul>
              )}
              {podeDecidir ? (
                <JanelaCadastro
                  rotuloBotao={
                    <>
                      <CheckCircle2 className="size-4" /> Aprovar conclusão
                    </>
                  }
                  titulo="Aprovar a conclusão do serviço"
                  acao={concluirChamado}
                  icone={<CheckCircle2 />}
                  rotuloSalvar="Aprovar e lançar no financeiro"
                  larguraMax="max-w-2xl"
                >
                  <input type="hidden" name="id" value={id} />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Campo rotulo="Concluído em">
                      <Entrada type="date" name="concluido_em" required defaultValue={hoje} max={hoje} />
                    </Campo>
                    <Campo rotulo="Valor final (R$)" dica="Do orçamento escolhido; mude se houve diferença.">
                      <Entrada name="valor_final" inputMode="decimal" required defaultValue={valorRef ? String(valorRef).replace(".", ",") : ""} />
                    </Campo>
                    <Campo rotulo="Quem aprovou a conclusão">
                      <Entrada name="aprovado_por" required placeholder={modo === "pessoal" ? "Eu / o locatário" : "Locatário, vistoriador, gestor…"} />
                    </Campo>
                    <Campo rotulo="Garantia do serviço (dias)">
                      <Entrada name="garantia_dias" inputMode="numeric" defaultValue={c.garantia_dias ?? ""} placeholder="90" />
                    </Campo>
                    {!c.pago_direto && (
                      <Campo rotulo="Vencimento do pagamento ao prestador">
                        <Entrada type="date" name="vencimento" defaultValue={hoje} />
                      </Campo>
                    )}
                  </div>
                  {(plano?.cobrarLocatario ?? 0) > 0 && (
                    <div className="grid gap-4 rounded-[14px] border border-borda-suave p-3 sm:grid-cols-2">
                      <Campo rotulo="Como cobrar o locatário">
                        <Selecao name="cobranca" defaultValue={c.contrato_id ? "fatura" : "receber"}>
                          {c.contrato_id && <option value="fatura">Na próxima fatura do aluguel</option>}
                          <option value="receber">Conta a receber separada</option>
                        </Selecao>
                      </Campo>
                      {c.contrato_id && (
                        <Campo rotulo="Fatura" dica={faturasFuturas.length ? undefined : "Sem fatura a vencer: fica pendente para a próxima."}>
                          <Selecao name="fatura_id" defaultValue="">
                            <option value="">A próxima a vencer</option>
                            {faturas.map((f) => (
                              <option key={f.id} value={f.id}>
                                #{f.numero} · {formatarCompetencia(f.competencia)} · vence {formatarDataBR(f.vencimento)}
                              </option>
                            ))}
                          </Selecao>
                        </Campo>
                      )}
                      <Campo rotulo="Vencimento (se conta a receber)">
                        <Entrada type="date" name="vencimento_receber" defaultValue={hoje} />
                      </Campo>
                    </div>
                  )}
                  <Campo rotulo="Observação">
                    <AreaTexto name="obs" rows={2} placeholder="Trocado o sifão; prestador deixou nota fiscal…" />
                  </Campo>
                </JanelaCadastro>
              ) : (
                <p className="text-sm text-mudo">Peça a um administrador, gestor ou ao financeiro para aprovar a conclusão.</p>
              )}
            </div>
          )}
        </Cartao>

        <Cartao titulo={`Fotos do depois (${midias.filter((m) => m.momento === "depois").length})`}>
          <MidiasChamado organizacaoId={organizacao.id} chamadoId={id} midias={midias.filter((m) => m.momento !== "antes")} momentoInicial="depois" />
        </Cartao>
      </div>

      <div className="space-y-6">
        <Cartao titulo="Avaliação do prestador">
          {!concluido ? (
            <p className="text-sm text-texto-2">Depois de concluir, dê uma nota de 1 a 5 ao prestador. A média aparece na lista de prestadores.</p>
          ) : (
            <Formulario acao={avaliarChamado} automatico className="space-y-4">
              <input type="hidden" name="id" value={id} />
              <p className="text-sm text-texto-2">{c.prestador?.nome ?? "Prestador"}</p>
              <Campo rotulo="Nota">
                <Selecao name="avaliacao_nota" defaultValue={c.avaliacao_nota ?? ""}>
                  <option value="">— sem nota —</option>
                  {[5, 4, 3, 2, 1].map((n) => (
                    <option key={n} value={n}>
                      {estrelas(n)} ({n})
                    </option>
                  ))}
                </Selecao>
              </Campo>
              <Campo rotulo="Comentário">
                <AreaTexto name="avaliacao_comentario" rows={3} defaultValue={c.avaliacao_comentario ?? ""} placeholder="Pontual, deixou tudo limpo, preço justo…" />
              </Campo>
            </Formulario>
          )}
        </Cartao>
        {c.prestador && (
          <Cartao titulo="Prestador">
            <Definicao
              itens={[
                ["Nome", <Link key="n" href={`/pessoas/${c.prestador.id}`} className="text-acento hover:underline">{c.prestador.nome}</Link>],
                ["Especialidade", c.prestador.especialidade ?? "—"],
                ["Telefone", c.prestador.telefone ?? "—"],
              ]}
            />
          </Cartao>
        )}
      </div>
    </div>
  );
}
