import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarPlus, CheckCircle2, DoorOpen, MessageCircle } from "lucide-react";
import { BotaoAcao } from "@/components/botao-acao";
import { BotaoExcluir } from "@/components/botao-excluir";
import { Formulario } from "@/components/formulario";
import { JanelaCadastro } from "@/components/janela-cadastro";
import { AreaTexto, Campo, Cartao, Entrada, Selecao, classeBotao } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { formatarCompetencia, formatarDataBR, hojeISO, somarDias } from "@/lib/dominio/datas";
import { formatarReais, paraCentavos, paraReais } from "@/lib/dominio/dinheiro";
import { acertoDeSaida } from "@/lib/dominio/rescisao";
import { carregarContrato } from "@/lib/servicos/locacao";
import { linkWhatsapp } from "@/lib/whatsapp";
import { atualizarDesocupacao, concluirDesocupacao, excluirDesocupacao, iniciarDesocupacao } from "../../locacao-actions";
import { ROTULO_MOTIVO_DESOCUPACAO } from "../rotulos";

export const metadata: Metadata = { title: "Desocupação e rescisão" };

const ETAPAS = [
  ["aviso", "Aviso de saída"],
  ["vistoria", "Vistoria de saída"],
  ["acerto", "Entrega e acerto"],
  ["concluida", "Concluída"],
] as const;

type D = {
  id: string;
  status: string;
  motivo: string;
  aviso_em: string;
  entrega_prevista: string | null;
  entrega_em: string | null;
  pago_ate: string | null;
  vistoria_data: string | null;
  vistoria_resultado: string | null;
  vistoria_obs: string | null;
  chaves_devolvidas_em: string | null;
  isentar_multa: boolean;
  aviso_previo_cumprido: boolean;
  reparos: number;
  outros_debitos: number;
  caucao_devolver: number;
  acerto: { total: number; itens?: { descricao: string; valor: number }[] } | null;
  lancamento_id: string | null;
  concluida_em: string | null;
};

export default async function EncerramentoContrato({ params }: PageProps<"/contratos/[id]/encerramento">) {
  const { id } = await params;
  const { supabase } = await obterContexto();
  const dados = await carregarContrato(supabase, id);
  if (!dados) notFound();
  const { contrato: c, partes, imovel } = dados;
  const hoje = hojeISO();
  const [{ data: dRaw }, { data: ultimaPaga }, { data: abertas }, { data: caucoes }] = await Promise.all([
    supabase.from("contrato_desocupacoes").select("*").eq("contrato_id", id).maybeSingle(),
    supabase.from("faturas").select("periodo_fim").eq("contrato_id", id).eq("status", "paga").order("competencia", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("faturas").select("id, numero, competencia, periodo_inicio, valor_total").eq("contrato_id", id).eq("status", "aberta").order("competencia"),
    supabase.from("contrato_garantias").select("valor").eq("contrato_id", id).eq("tipo", "caucao").eq("status", "ativa"),
  ]);
  const d = dRaw as D | null;
  const loc = partes.find((p) => p.papel === "locatario")?.pessoa;
  const encerrado = c.status === "encerrado" || c.status === "rescindido";
  const caucaoTotal = (caucoes ?? []).reduce((s, g) => s + Number(g.valor ?? 0), 0);

  if (!d) {
    return (
      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <Cartao titulo="Desocupação do imóvel">
          {encerrado ? (
            <p className="text-sm text-texto-2">Contrato {c.status} em {formatarDataBR(c.data_rescisao)}.</p>
          ) : (
            <>
              <p className="mb-4 text-sm text-texto-2">
                Quando o locatário avisar que vai sair (ou o prazo acabar), comece a desocupação aqui. O sistema acompanha a vistoria de saída, a entrega das chaves e calcula o acerto: saldo de aluguel,
                multa rescisória proporcional (Lei do Inquilinato), reparos e devolução da caução.
              </p>
              <JanelaCadastro rotuloBotao={<><DoorOpen className="size-4" /> Iniciar desocupação</>} titulo="Iniciar desocupação" acao={iniciarDesocupacao} rotuloSalvar="Iniciar" icone={<DoorOpen />}>
                <input type="hidden" name="contrato_id" value={id} />
                <Campo rotulo="Motivo">
                  <Selecao name="motivo" defaultValue={hoje >= c.data_fim ? "fim_prazo" : "rescisao_locatario"}>
                    {Object.entries(ROTULO_MOTIVO_DESOCUPACAO).map(([k, r]) => (
                      <option key={k} value={k}>
                        {r}
                      </option>
                    ))}
                  </Selecao>
                </Campo>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Campo rotulo="Aviso recebido em">
                    <Entrada type="date" name="aviso_em" defaultValue={hoje} />
                  </Campo>
                  <Campo rotulo="Entrega prevista das chaves">
                    <Entrada type="date" name="entrega_prevista" defaultValue={somarDias(hoje, 30)} />
                  </Campo>
                </div>
                <label className="flex items-center gap-2 text-sm text-texto-2">
                  <input type="checkbox" name="sem_aviso" /> Saída sem os 30 dias de aviso prévio
                </label>
              </JanelaCadastro>
            </>
          )}
        </Cartao>
      </div>
    );
  }

  const concluida = d.status === "concluida";
  const entrega = d.entrega_em ?? d.chaves_devolvidas_em ?? d.entrega_prevista ?? hoje;
  const pagoAte = d.pago_ate ?? ultimaPaga?.periodo_fim ?? somarDias(c.data_inicio, -1);
  const isenta = d.isentar_multa || ["fim_prazo", "rescisao_locador", "acordo"].includes(d.motivo);
  const a = acertoDeSaida(
    {
      valorAluguel: paraCentavos(c.valor_aluguel),
      dataInicio: c.data_inicio,
      prazoMeses: c.prazo_meses,
      dataEntrega: entrega,
      pagoAte,
      multaAlugueis: Number(c.multa_rescisoria_alugueis),
      isentarMulta: isenta,
      avisoPrevioCumprido: d.aviso_previo_cumprido,
    },
    { reparos: paraCentavos(d.reparos), outros: paraCentavos(d.outros_debitos), caucao: paraCentavos(d.caucao_devolver) },
  );
  const continuaAberto = (abertas ?? []).filter((f) => (f.periodo_inicio ?? f.competencia) <= pagoAte);
  const seraoCanceladas = (abertas ?? []).filter((f) => (f.periodo_inicio ?? f.competencia) > pagoAte);
  const passo = ETAPAS.findIndex(([k]) => k === d.status);
  const v = (n: unknown) => (n === null || n === undefined ? "" : String(n));
  const resumoMsg = `Olá ${loc?.nome.split(" ")[0] ?? ""}! Segue o acerto de saída do imóvel ${imovel.codigo}: ${a.linhas.map((l) => `${l.descricao}: ${formatarReais(paraReais(l.valor))}`).join("; ")}. Total: ${a.total >= 0 ? "a pagar" : "a devolver"} ${formatarReais(Math.abs(paraReais(a.total)))}.`;

  return (
    <>
      <ol className="entrar-cascata mb-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {ETAPAS.map(([k, r], i) => (
          <li
            key={k}
            className={`rounded-[12px] border px-3 py-2 text-[13px] font-medium ${i === passo ? "border-acento bg-acento-bg text-acento-hot" : i < passo ? "border-ok-bd bg-ok-bg text-ok" : "border-borda bg-card text-mudo"}`}
          >
            <span className="mr-1 font-mono text-[11px] opacity-70">{i + 1}</span>
            {r}
          </li>
        ))}
      </ol>

      <div className="grid gap-6 xl:grid-cols-[1fr_400px]">
        <div className="space-y-6">
          {concluida ? (
            <Cartao titulo="Desocupação concluída">
              <p className="text-sm text-texto-2">
                Concluída em {formatarDataBR(d.concluida_em?.slice(0, 10))}. Chaves entregues em {formatarDataBR(d.entrega_em)}. Contrato {c.status}; o imóvel voltou a ficar disponível (se não houver outro contrato
                ativo).
              </p>
              {d.acerto && (
                <ul className="mt-3 space-y-1 text-sm">
                  {(d.acerto.itens ?? []).map((l, i) => (
                    <li key={i} className="flex justify-between gap-2">
                      <span>{l.descricao}</span>
                      <span className="tabular-nums">{formatarReais(l.valor)}</span>
                    </li>
                  ))}
                  <li className="flex justify-between gap-2 border-t border-borda-suave pt-1 font-semibold">
                    <span>{d.acerto.total >= 0 ? "Cobrado do locatário" : "Devolvido ao locatário"}</span>
                    <span className="tabular-nums">{formatarReais(Math.abs(d.acerto.total))}</span>
                  </li>
                </ul>
              )}
              {d.lancamento_id && (
                <Link href="/financeiro" className="mt-3 inline-block text-sm text-acento hover:underline">
                  Ver o lançamento no Financeiro
                </Link>
              )}
            </Cartao>
          ) : (
            <Formulario acao={atualizarDesocupacao} automatico>
              <input type="hidden" name="id" value={d.id} />
              <input type="hidden" name="_flags" value="1" />
              <Cartao titulo="Andamento da desocupação">
                <div className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-3">
                    <Campo rotulo="Motivo">
                      <Selecao name="motivo" defaultValue={d.motivo}>
                        {Object.entries(ROTULO_MOTIVO_DESOCUPACAO).map(([k, r]) => (
                          <option key={k} value={k}>
                            {r}
                          </option>
                        ))}
                      </Selecao>
                    </Campo>
                    <Campo rotulo="Aviso em">
                      <Entrada type="date" name="aviso_em" defaultValue={d.aviso_em} />
                    </Campo>
                    <Campo rotulo="Entrega prevista">
                      <Entrada type="date" name="entrega_prevista" defaultValue={d.entrega_prevista ?? ""} />
                    </Campo>
                  </div>
                  <fieldset className="rounded-[14px] border border-borda-suave p-3">
                    <legend className="px-1 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-mudo">Vistoria de saída</legend>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Campo rotulo="Feita em">
                        <Entrada type="date" name="vistoria_data" defaultValue={d.vistoria_data ?? ""} />
                      </Campo>
                      <Campo rotulo="Resultado">
                        <Selecao name="vistoria_resultado" defaultValue={d.vistoria_resultado ?? ""}>
                          <option value="">—</option>
                          <option value="ok">Imóvel em ordem</option>
                          <option value="com_reparos">Precisa de reparos</option>
                        </Selecao>
                      </Campo>
                    </div>
                    <Campo rotulo="O que foi encontrado">
                      <AreaTexto name="vistoria_obs" rows={2} defaultValue={d.vistoria_obs ?? ""} placeholder="Pintura da sala, torneira da cozinha, falta uma chave…" />
                    </Campo>
                    <Link href={`/agenda?novo=1&imovel_novo=${imovel.id}`} className="mt-2 inline-flex items-center gap-1 text-xs text-acento hover:underline">
                      <CalendarPlus className="size-3.5" /> agendar a vistoria na agenda
                    </Link>
                  </fieldset>
                  <fieldset className="rounded-[14px] border border-borda-suave p-3">
                    <legend className="px-1 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-mudo">Entrega e valores do acerto</legend>
                    <div className="grid gap-4 sm:grid-cols-3">
                      <Campo rotulo="Chaves entregues em">
                        <Entrada type="date" name="entrega_em" defaultValue={d.entrega_em ?? ""} />
                      </Campo>
                      <Campo rotulo="Aluguel pago até" dica="Padrão: fim da última fatura paga">
                        <Entrada type="date" name="pago_ate" defaultValue={d.pago_ate ?? ""} placeholder={pagoAte} />
                      </Campo>
                      <Campo rotulo="Reparos (R$)">
                        <Entrada name="reparos" inputMode="decimal" defaultValue={v(d.reparos)} />
                      </Campo>
                      <Campo rotulo="Outros débitos (R$)" dica="Contas, condomínio, IPTU do período">
                        <Entrada name="outros_debitos" inputMode="decimal" defaultValue={v(d.outros_debitos)} />
                      </Campo>
                      <Campo rotulo="Caução a devolver (R$)" dica={caucaoTotal ? `Caução cadastrada: ${formatarReais(caucaoTotal)}` : "Sem caução cadastrada"}>
                        <Entrada name="caucao_devolver" inputMode="decimal" defaultValue={v(d.caucao_devolver)} />
                      </Campo>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm text-texto-2">
                      <label className="flex items-center gap-2">
                        <input type="checkbox" name="isentar_multa" defaultChecked={d.isentar_multa} /> Isentar a multa rescisória
                      </label>
                      <label className="flex items-center gap-2">
                        <input type="checkbox" name="sem_aviso" defaultChecked={!d.aviso_previo_cumprido} /> Saiu sem os 30 dias de aviso prévio
                      </label>
                    </div>
                  </fieldset>
                </div>
              </Cartao>
            </Formulario>
          )}
        </div>

        <div className="space-y-6">
          <Cartao titulo={concluida ? "Acerto (calculado na conclusão)" : "Acerto de saída"}>
            {!concluida && (
              <>
                <p className="mb-3 text-xs text-mudo">
                  Entrega em {formatarDataBR(entrega)} · aluguel pago até {formatarDataBR(pagoAte)} · {a.rescisao.mesesCumpridos} de {c.prazo_meses} meses cumpridos
                </p>
                <ul className="space-y-1.5 text-sm">
                  {a.linhas.map((l, i) => (
                    <li key={i} className="flex justify-between gap-3">
                      <span className="text-texto-2">{l.descricao}</span>
                      <span className={`shrink-0 tabular-nums ${l.valor < 0 ? "text-ok" : "text-texto"}`}>{formatarReais(paraReais(l.valor))}</span>
                    </li>
                  ))}
                  {a.linhas.length === 0 && <li className="text-mudo">Nada a acertar.</li>}
                  <li className="flex justify-between gap-3 border-t border-borda-suave pt-2 text-[15px] font-semibold">
                    <span>{a.total >= 0 ? "Locatário paga" : "Devolver ao locatário"}</span>
                    <span className="tabular-nums">{formatarReais(Math.abs(paraReais(a.total)))}</span>
                  </li>
                </ul>
                {seraoCanceladas.length > 0 && (
                  <p className="mt-3 text-xs text-texto-2">
                    Ao concluir, {seraoCanceladas.length} fatura(s) em aberto depois de {formatarDataBR(pagoAte)} são canceladas (o saldo já está no acerto):{" "}
                    {seraoCanceladas.map((f) => `#${f.numero} (${formatarCompetencia(f.competencia)})`).join(", ")}.
                  </p>
                )}
                {continuaAberto.length > 0 && (
                  <p className="mt-2 text-xs text-alerta">
                    Continuam em aberto e devem ser cobradas à parte: {continuaAberto.map((f) => `#${f.numero} (${formatarReais(f.valor_total)})`).join(", ")}.
                  </p>
                )}
                <div className="mt-4 flex flex-wrap gap-2">
                  {loc?.telefone && (
                    <a href={linkWhatsapp(loc.telefone, resumoMsg)} target="_blank" rel="noreferrer" className={classeBotao("secundario", "sm")}>
                      <MessageCircle className="size-3.5" /> Enviar ao locatário
                    </a>
                  )}
                  {d.entrega_em ? (
                    <BotaoAcao
                      acao={concluirDesocupacao}
                      id={d.id}
                      variante="primario"
                      tamanho="sm"
                      confirmar={`Concluir a desocupação? O contrato será encerrado em ${formatarDataBR(d.entrega_em)}, o acerto vai para o Financeiro e o imóvel volta a ficar disponível.`}
                    >
                      <CheckCircle2 className="size-3.5" /> Concluir desocupação
                    </BotaoAcao>
                  ) : (
                    <p className="text-xs text-mudo">Informe a data em que as chaves foram entregues para concluir.</p>
                  )}
                </div>
              </>
            )}
            {concluida && <p className="text-sm text-texto-2">O acerto ficou registrado ao lado.</p>}
          </Cartao>
          {!concluida && (
            <BotaoExcluir acao={excluirDesocupacao} id={d.id} variante="botao" rotulo="Cancelar desocupação" confirmar="Cancelar esta desocupação? (o locatário desistiu de sair)" />
          )}
        </div>
      </div>
    </>
  );
}
