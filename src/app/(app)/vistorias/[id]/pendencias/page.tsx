import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, CheckCircle2, Hammer, ListPlus, MessageCircle, Scale, Undo2, User, Wrench } from "lucide-react";
import { Contador } from "@/components/abas-segmentadas";
import { BotaoAcao } from "@/components/botao-acao";
import { BotaoExcluir } from "@/components/botao-excluir";
import { Formulario } from "@/components/formulario";
import { JanelaCadastro } from "@/components/janela-cadastro";
import { AreaTexto, Aviso, Campo, Cartao, Entrada, Indicador, Selecao, Selo, classeBotao } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { formatarDataBR } from "@/lib/dominio/datas";
import { formatarReais, paraReais } from "@/lib/dominio/dinheiro";
import { ROTULO_RESPONSAVEL, ROTULO_STATUS_PENDENCIA, responsaveisDoModo, totaisReparos } from "@/lib/dominio/vistorias";
import { linkWhatsapp } from "@/lib/whatsapp";
import {
  aprovarOrcamento,
  atualizarPendencia,
  criarOrcamento,
  criarPendencia,
  desaprovarOrcamento,
  excluirOrcamento,
  excluirPendencia,
  gerarPendenciasDosDanos,
  levarParaAcerto,
} from "../../actions";
import { carregarAmbientes, carregarPendencias, carregarVistoria, enderecoImovel } from "../../dados";

export const metadata: Metadata = { title: "Danos e orçamentos" };

const COR_PEND: Record<string, "vermelho" | "amarelo" | "verde" | "cinza"> = { aberta: "vermelho", em_reparo: "amarelo", resolvida: "verde", cancelada: "cinza" };

export default async function PendenciasVistoria({ params }: PageProps<"/vistorias/[id]/pendencias">) {
  const { id } = await params;
  const { supabase, organizacao, papel } = await obterContexto();
  const pessoal = organizacao.modo === "pessoal";
  const v = await carregarVistoria(supabase, id);
  if (!v) notFound();
  const [pendencias, ambientes, { data: prestadores }, { data: des }] = await Promise.all([
    carregarPendencias(supabase, id),
    carregarAmbientes(supabase, id),
    supabase.from("pessoas").select("id, nome").contains("papeis", ["prestador"]).order("nome"),
    v.contrato_id ? supabase.from("contrato_desocupacoes").select("id, status, reparos").eq("contrato_id", v.contrato_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const t = totaisReparos(pendencias.map((p) => ({ ...p, orcamentos: p.vistoria_orcamentos })));
  const responsaveis = responsaveisDoModo(pessoal);
  const rotuloResp = Object.fromEntries(responsaveis.map((r) => [r.valor, r.rotulo]));
  const nomeAmb = new Map(ambientes.map((a) => [a.id, a.nome]));
  const decide = papel === "admin" || papel === "gestor" || papel === "financeiro";
  const endereco = enderecoImovel(v.imovel);

  return (
    <>
      <div className="entrar-cascata mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Indicador rotulo="Em aberto" icone={<AlertTriangle />} valor={<Contador valor={t.abertas} formato="inteiro" />} detalhe="abertas ou em reparo" tom={t.abertas ? "alerta" : "neutro"} />
        <Indicador rotulo="Total dos reparos" icone={<Wrench />} valor={<Contador valor={paraReais(t.total)} formato="moeda" />} detalhe={`${t.comOrcamentoAprovado} com orçamento aprovado`} />
        <Indicador rotulo="Do locatário" icone={<User />} valor={<Contador valor={paraReais(t.paraAcerto)} formato="moeda" />} detalhe="vai para o acerto de saída" tom={t.paraAcerto ? "perigo" : "neutro"} />
        <Indicador rotulo={pessoal ? "Por minha conta" : "Do proprietário"} icone={<Hammer />} valor={<Contador valor={paraReais(t.porResponsavel.proprietario)} formato="moeda" />} detalhe="manutenção do imóvel" />
      </div>

      {v.tipo === "saida" && (
        <Cartao className="mb-6" titulo="Acerto de saída do contrato">
          {!v.contrato_id ? (
            <p className="text-sm text-mudo">Vincule o contrato no Resumo para levar os reparos ao acerto de saída.</p>
          ) : !des ? (
            <Aviso tipo="alerta">
              O contrato ainda não tem desocupação iniciada.{" "}
              <Link href={`/contratos/${v.contrato_id}/encerramento`} className="font-semibold text-acento underline">
                Iniciar a desocupação
              </Link>{" "}
              e depois volte aqui.
            </Aviso>
          ) : des.status === "concluida" ? (
            <p className="text-sm text-texto-2">A desocupação já foi concluída (reparos lançados: {formatarReais(des.reparos)}).</p>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-texto-2">
                Reparos do locatário: <strong className="text-texto">{formatarReais(paraReais(t.paraAcerto))}</strong> (orçamento aprovado ou, sem ele, o valor estimado). No acerto hoje:{" "}
                {formatarReais(des.reparos)}.
              </p>
              <div className="flex flex-wrap gap-2">
                {decide ? (
                  <BotaoAcao acao={levarParaAcerto} id={id} variante="primario" confirmar={`Levar ${formatarReais(paraReais(t.paraAcerto))} de reparos para o acerto de saída? (substitui o valor de reparos que estiver lá)`}>
                    <Scale className="size-4" /> Levar para o acerto
                  </BotaoAcao>
                ) : (
                  <span className="text-xs text-mudo">Só administrador, gestor ou financeiro mexem no acerto.</span>
                )}
                <Link href={`/contratos/${v.contrato_id}/encerramento`} className={classeBotao("secundario")}>
                  Ver acerto
                </Link>
              </div>
            </div>
          )}
        </Cartao>
      )}

      <div className="mb-4 flex flex-wrap gap-2">
        <JanelaCadastro rotuloBotao={<><ListPlus className="size-4" /> Nova pendência</>} titulo="Novo dano ou pendência" acao={criarPendencia} icone={<Wrench />} larguraMax="max-w-xl" rotuloSalvar="Registrar">
          <input type="hidden" name="vistoria_id" value={id} />
          <Campo rotulo="O que precisa ser feito">
            <Entrada name="descricao" required placeholder="Ex.: Pintar a parede da sala, trocar a torneira da cozinha" />
          </Campo>
          <div className="grid gap-4 sm:grid-cols-3">
            <Campo rotulo="Tipo">
              <Selecao name="tipo" defaultValue="dano">
                <option value="dano">Dano</option>
                <option value="pendencia">Pendência</option>
              </Selecao>
            </Campo>
            <Campo rotulo="Responsável">
              <Selecao name="responsavel" defaultValue={v.tipo === "saida" ? "locatario" : "proprietario"}>
                {responsaveis.map((r) => (
                  <option key={r.valor} value={r.valor}>
                    {r.rotulo}
                  </option>
                ))}
              </Selecao>
            </Campo>
            <Campo rotulo="Ambiente">
              <Selecao name="ambiente_id" defaultValue="">
                <option value="">— geral —</option>
                {ambientes.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.nome}
                  </option>
                ))}
              </Selecao>
            </Campo>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo rotulo="Valor estimado (R$)">
              <Entrada name="valor_estimado" inputMode="decimal" />
            </Campo>
            <Campo rotulo="Prazo">
              <Entrada type="date" name="prazo" />
            </Campo>
          </div>
          <Campo rotulo="Observação">
            <AreaTexto name="observacao" rows={2} />
          </Campo>
        </JanelaCadastro>
        <BotaoAcao acao={gerarPendenciasDosDanos} id={id} confirmar="Criar uma pendência para cada item marcado como Ruim ou Danificado (que ainda não tenha)?">
          <AlertTriangle className="size-4" /> Criar dos itens com dano
        </BotaoAcao>
      </div>

      <div className="space-y-4">
        {pendencias.length === 0 && (
          <Cartao>
            <p className="text-sm text-mudo">Nenhum dano ou pendência registrado. Na saída, use a aba Comparação para criar pendências do que piorou desde a entrada.</p>
          </Cartao>
        )}
        {pendencias.map((p) => {
          const aprovado = p.vistoria_orcamentos.find((o) => o.aprovado);
          return (
            <Cartao
              key={p.id}
              titulo={
                <span className="flex flex-wrap items-center gap-2">
                  {p.descricao}
                  <Selo cor={COR_PEND[p.status]}>{ROTULO_STATUS_PENDENCIA[p.status]}</Selo>
                  <Selo cor={p.responsavel === "locatario" ? "vermelho" : "cinza"}>{rotuloResp[p.responsavel] ?? p.responsavel}</Selo>
                  {p.ambiente_id && <span className="text-xs font-normal text-mudo">{nomeAmb.get(p.ambiente_id)}</span>}
                </span>
              }
              acoes={<BotaoExcluir acao={excluirPendencia} id={p.id} rotulo="Excluir pendência" confirmar={`Excluir "${p.descricao}" e os orçamentos dela?`} />}
            >
              <Formulario acao={atualizarPendencia} automatico className="space-y-4">
                <input type="hidden" name="id" value={p.id} />
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  <Campo
                    rotulo="Situação"
                    dica={
                      p.responsavel === "proprietario" || p.responsavel === "imobiliaria"
                        ? p.status === "resolvida"
                          ? "Custo lançado em contas a pagar."
                          : "Ao resolver, o custo vai para contas a pagar."
                        : undefined
                    }
                  >
                    <Selecao name="status" defaultValue={p.status}>
                      {Object.entries(ROTULO_STATUS_PENDENCIA).map(([k, r]) => (
                        <option key={k} value={k}>
                          {r}
                        </option>
                      ))}
                    </Selecao>
                  </Campo>
                  <Campo rotulo="Responsável">
                    <Selecao name="responsavel" defaultValue={p.responsavel}>
                      {(responsaveis.some((r) => r.valor === p.responsavel) ? responsaveis : [...responsaveis, { valor: p.responsavel, rotulo: ROTULO_RESPONSAVEL[p.responsavel] ?? p.responsavel }]).map((r) => (
                        <option key={r.valor} value={r.valor}>
                          {r.rotulo}
                        </option>
                      ))}
                    </Selecao>
                  </Campo>
                  <Campo rotulo="Valor estimado (R$)" dica={aprovado ? `Vale o orçamento aprovado: ${formatarReais(aprovado.valor)}` : undefined}>
                    <Entrada name="valor_estimado" inputMode="decimal" defaultValue={p.valor_estimado === null ? "" : String(p.valor_estimado)} />
                  </Campo>
                  <Campo rotulo="Prazo">
                    <Entrada type="date" name="prazo" defaultValue={p.prazo ?? ""} />
                  </Campo>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Campo rotulo="Descrição">
                    <Entrada name="descricao" defaultValue={p.descricao} required />
                  </Campo>
                  <Campo rotulo="Observação">
                    <Entrada name="observacao" defaultValue={p.observacao ?? ""} />
                  </Campo>
                </div>
              </Formulario>
              {p.resolvida_em && <p className="mt-2 text-xs text-ok">Resolvida em {formatarDataBR(p.resolvida_em)}.</p>}

              <div className="mt-4 rounded-[14px] border border-borda-suave">
                <div className="flex items-center justify-between gap-2 border-b border-borda-suave px-4 py-2.5">
                  <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-mudo">Orçamentos de reparo ({p.vistoria_orcamentos.length})</span>
                  <JanelaCadastro rotuloBotao="+ Orçamento" tamanho="sm" variante="secundario" titulo={`Orçamento: ${p.descricao}`} acao={criarOrcamento} icone={<Hammer />} rotuloSalvar="Incluir">
                    <input type="hidden" name="pendencia_id" value={p.id} />
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Campo rotulo="Prestador (Pessoas)">
                        <Selecao name="prestador_id" defaultValue="">
                          <option value="">— digitar o nome —</option>
                          {(prestadores ?? []).map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.nome}
                            </option>
                          ))}
                        </Selecao>
                      </Campo>
                      <Campo rotulo="Ou nome do prestador">
                        <Entrada name="prestador_nome" />
                      </Campo>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-3">
                      <Campo rotulo="Valor (R$)">
                        <Entrada name="valor" inputMode="decimal" required />
                      </Campo>
                      <Campo rotulo="Prazo (dias)">
                        <Entrada name="prazo_dias" inputMode="numeric" />
                      </Campo>
                      <Campo rotulo="Válido até">
                        <Entrada type="date" name="validade" />
                      </Campo>
                    </div>
                    <Campo rotulo="O que inclui">
                      <AreaTexto name="descricao" rows={2} />
                    </Campo>
                  </JanelaCadastro>
                </div>
                {p.vistoria_orcamentos.length === 0 ? (
                  <p className="px-4 py-3 text-sm text-mudo">Nenhum orçamento. Sem orçamento aprovado, vale o valor estimado.</p>
                ) : (
                  <ul className="divide-y divide-borda-suave">
                    {p.vistoria_orcamentos.map((o) => {
                      const nome = o.prestador?.nome ?? o.prestador_nome ?? "Prestador";
                      const tel = o.prestador?.telefone;
                      return (
                        <li key={o.id} className={`flex flex-wrap items-center gap-3 px-4 py-3 ${o.aprovado ? "bg-ok-bg" : ""}`}>
                          <div className="min-w-0 flex-1">
                            <div className="font-medium text-texto">
                              {nome} <span className="tabular-nums">· {formatarReais(o.valor)}</span>
                            </div>
                            <div className="text-xs text-mudo">
                              {[o.prazo_dias !== null ? `${o.prazo_dias} dia(s)` : null, o.validade ? `válido até ${formatarDataBR(o.validade)}` : null, o.descricao].filter(Boolean).join(" · ") || "—"}
                            </div>
                          </div>
                          {o.aprovado && <Selo cor="verde">Aprovado</Selo>}
                          {tel && (
                            <a
                              href={linkWhatsapp(tel, `Olá ${nome.split(" ")[0]}! Sobre o reparo "${p.descricao}" no imóvel ${v.imovel?.codigo ?? ""}${endereco ? ` (${endereco})` : ""}: ${o.aprovado ? "seu orçamento foi aprovado. Podemos combinar a data?" : "pode confirmar o orçamento?"}`)}
                              target="_blank"
                              rel="noreferrer"
                              className={classeBotao("secundario", "sm")}
                            >
                              <MessageCircle className="size-3.5" /> WhatsApp
                            </a>
                          )}
                          {decide &&
                            (o.aprovado ? (
                              <BotaoAcao acao={desaprovarOrcamento} id={o.id} tamanho="sm" variante="fantasma">
                                <Undo2 className="size-3.5" /> Desfazer
                              </BotaoAcao>
                            ) : (
                              <BotaoAcao acao={aprovarOrcamento} id={o.id} tamanho="sm" variante="primario" confirmar={`Aprovar o orçamento de ${nome} (${formatarReais(o.valor)})?`}>
                                <CheckCircle2 className="size-3.5" /> Aprovar
                              </BotaoAcao>
                            ))}
                          <BotaoExcluir acao={excluirOrcamento} id={o.id} rotulo="Excluir orçamento" confirmar="Excluir este orçamento?" />
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </Cartao>
          );
        })}
      </div>
    </>
  );
}
