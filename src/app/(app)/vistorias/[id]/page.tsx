import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, CalendarPlus, Camera, CheckCircle2, ListChecks, MessageSquarePlus, Play, RotateCcw, Signature, Wrench } from "lucide-react";
import { Contador } from "@/components/abas-segmentadas";
import { BarraProgresso } from "@/components/barra-progresso";
import { BotaoAcao } from "@/components/botao-acao";
import { Formulario } from "@/components/formulario";
import { JanelaCadastro } from "@/components/janela-cadastro";
import { AreaTexto, Campo, Cartao, Entrada, Indicador, Selecao, Selo } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { formatarDataBR, hojeISO } from "@/lib/dominio/datas";
import { formatarReais, paraReais } from "@/lib/dominio/dinheiro";
import { COR_STATUS_VISTORIA, ROTULO_STATUS_VISTORIA, ROTULO_TIPO_VISTORIA, progressoVistoria, totaisReparos } from "@/lib/dominio/vistorias";
import { agendarVistoria, atualizarVistoria, concluirVistoria, iniciarVistoria, marcarAssinadaPapel, reabrirVistoria, registrarNotaVistoria } from "../actions";
import { carregarAmbientes, carregarPendencias, carregarVistoria, partesDaVistoria, quemFez } from "../dados";

export const metadata: Metadata = { title: "Vistoria" };

const quando = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
const ETAPAS = ["rascunho", "em_andamento", "concluida", "assinada"] as const;

export default async function VistoriaResumo({ params }: PageProps<"/vistorias/[id]">) {
  const { id } = await params;
  const { supabase, organizacao } = await obterContexto();
  const pessoal = organizacao.modo === "pessoal";
  const v = await carregarVistoria(supabase, id);
  if (!v) notFound();
  const [ambientes, pendencias, partes, { data: eventos }, { count: fotos }, { data: contratos }, { data: vistoriadores }, { data: visita }] = await Promise.all([
    carregarAmbientes(supabase, id),
    carregarPendencias(supabase, id),
    partesDaVistoria(supabase, v),
    supabase.from("vistoria_eventos").select("id, tipo, descricao, data").eq("vistoria_id", id).order("data", { ascending: false }).limit(200),
    supabase.from("vistoria_midias").select("id", { count: "exact", head: true }).eq("vistoria_id", id),
    supabase.from("contratos").select("id, numero, status").eq("imovel_id", v.imovel_id).order("numero", { ascending: false }),
    pessoal ? Promise.resolve({ data: [] }) : supabase.from("pessoas").select("id, nome").overlaps("papeis", ["corretor", "prestador", "parceiro"]).order("nome"),
    v.visita_id ? supabase.from("visitas").select("id, data_hora, status").eq("id", v.visita_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const itens = ambientes.flatMap((a) => a.vistoria_itens);
  const p = progressoVistoria(itens);
  const rep = totaisReparos(pendencias.map((x) => ({ ...x, orcamentos: x.vistoria_orcamentos })));
  const passo = v.status === "contestada" ? 2 : ETAPAS.indexOf(v.status as (typeof ETAPAS)[number]);
  const lista = (vistoriadores ?? []) as { id: string; nome: string }[];
  // Mantém na lista quem já está gravado (senão o salvamento automático apagaria).
  const vistoriadoresOp = v.responsavel && !lista.some((o) => o.id === v.responsavel!.id) ? [...lista, { id: v.responsavel.id, nome: v.responsavel.nome }] : lista;

  return (
    <>
      <ol className="entrar-cascata mb-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {ETAPAS.map((e, i) => (
          <li
            key={e}
            className={`rounded-[12px] border px-3 py-2 text-[13px] font-medium ${i === passo ? "border-acento bg-acento-bg text-acento-hot" : i < passo ? "border-ok-bd bg-ok-bg text-ok" : "border-borda bg-card text-mudo"}`}
          >
            <span className="mr-1 font-mono text-[11px] opacity-70">{i + 1}</span>
            {ROTULO_STATUS_VISTORIA[e]}
          </li>
        ))}
      </ol>
      {v.status === "contestada" && (
        <div className="mb-6 rounded-[14px] border border-ruim-bd bg-ruim-bg px-4 py-3 text-sm text-ruim">
          O locatário contestou esta vistoria.{" "}
          <Link href={`/vistorias/${id}/assinaturas`} className="font-semibold underline">
            Ver e responder
          </Link>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <div className="entrar-cascata grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Indicador
              rotulo="Checklist"
              icone={<ListChecks />}
              valor={<Contador valor={p.pct} formato="pct" />}
              tom={p.total > 0 && p.faltam === 0 ? "sucesso" : "neutro"}
              href={`/vistorias/${id}/ambientes`}
              detalhe={
                <div className="space-y-2">
                  <div>
                    {p.avaliados} de {p.total} itens avaliados em {ambientes.length} ambiente(s)
                  </div>
                  <BarraProgresso pct={p.pct} atingida={p.total > 0 && p.faltam === 0} />
                </div>
              }
            />
            <Indicador
              rotulo="Itens com dano"
              icone={<AlertTriangle />}
              valor={<Contador valor={p.danos} formato="inteiro" />}
              tom={p.danos ? "perigo" : "neutro"}
              detalhe="ruins ou danificados · ver comparação"
              href={`/vistorias/${id}/comparacao`}
            />
            <Indicador rotulo="Fotos e vídeos" icone={<Camera />} valor={<Contador valor={fotos ?? 0} formato="inteiro" />} detalhe="com ambiente e legenda · ver galeria" href={`/vistorias/${id}/fotos`} />
            <Indicador
              rotulo="Reparos"
              icone={<Wrench />}
              valor={<Contador valor={paraReais(rep.total)} formato="moeda" />}
              tom={rep.abertas ? "alerta" : "neutro"}
              detalhe={`${rep.abertas} pendência(s) em aberto · ${formatarReais(paraReais(rep.paraAcerto))} do locatário`}
              href={`/vistorias/${id}/pendencias`}
            />
          </div>

          <Formulario acao={atualizarVistoria} automatico>
            <input type="hidden" name="id" value={id} />
            <Cartao titulo="Dados da vistoria">
              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-3">
                  <Campo rotulo="Tipo">
                    <Selecao name="tipo" defaultValue={v.tipo}>
                      {Object.entries(ROTULO_TIPO_VISTORIA).map(([k, r]) => (
                        <option key={k} value={k}>
                          {r}
                        </option>
                      ))}
                    </Selecao>
                  </Campo>
                  <Campo rotulo="Data">
                    <Entrada type="date" name="data" defaultValue={v.data} required />
                  </Campo>
                  <Campo rotulo="Contrato">
                    <Selecao name="contrato_id" defaultValue={v.contrato_id ?? ""}>
                      <option value="">— sem contrato —</option>
                      {(contratos ?? []).map((c) => (
                        <option key={c.id} value={c.id}>
                          Nº {c.numero} ({c.status})
                        </option>
                      ))}
                    </Selecao>
                  </Campo>
                </div>
                <div className="grid gap-4 sm:grid-cols-3">
                  {!pessoal && (
                    <Campo rotulo="Vistoriador">
                      <Selecao name="responsavel_id" defaultValue={v.responsavel_id ?? ""}>
                        <option value="">— outro (digite ao lado) —</option>
                        {vistoriadoresOp.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.nome}
                          </option>
                        ))}
                      </Selecao>
                    </Campo>
                  )}
                  <Campo rotulo={pessoal ? "Feita por" : "Nome do vistoriador"}>
                    <Entrada name="responsavel_nome" defaultValue={v.responsavel_nome ?? ""} />
                  </Campo>
                  <Campo rotulo="Acompanhou">
                    <Entrada name="acompanhante" defaultValue={v.acompanhante ?? ""} />
                  </Campo>
                </div>
                <Campo rotulo="Observações gerais">
                  <AreaTexto name="observacoes" rows={3} defaultValue={v.observacoes ?? ""} />
                </Campo>
                <Campo rotulo="Conclusão (vai no laudo)">
                  <AreaTexto name="conclusao" rows={2} defaultValue={v.conclusao ?? ""} placeholder="Ex.: imóvel entregue limpo e em bom estado, com as ressalvas acima." />
                </Campo>
              </div>
            </Cartao>
          </Formulario>

          <Cartao
            titulo={`Histórico (${eventos?.length ?? 0})`}
            acoes={
              <JanelaCadastro rotuloBotao={<><MessageSquarePlus className="size-3.5" /> Registrar</>} tamanho="sm" titulo="Registrar no histórico" acao={registrarNotaVistoria} rotuloSalvar="Salvar" icone={<MessageSquarePlus />}>
                <input type="hidden" name="vistoria_id" value={id} />
                <Campo rotulo="O que aconteceu">
                  <AreaTexto name="descricao" rows={4} required />
                </Campo>
              </JanelaCadastro>
            }
          >
            <ol className="max-h-[420px] space-y-3 overflow-y-auto pr-1">
              {(eventos ?? []).map((e) => (
                <li key={e.id} className="flex items-start justify-between gap-3 border-b border-borda-suave pb-2.5 last:border-0">
                  <div className="min-w-0">
                    <div className="text-sm text-texto">{e.descricao}</div>
                    <div className="text-xs capitalize text-mudo">{String(e.tipo).replace(/_/g, " ")}</div>
                  </div>
                  <span className="shrink-0 text-xs text-mudo">{quando(e.data)}</span>
                </li>
              ))}
              {!eventos?.length && <li className="text-sm text-mudo">Nada registrado ainda.</li>}
            </ol>
            <p className="mt-3 text-xs text-mudo">O histórico não pode ser apagado nem alterado.</p>
          </Cartao>
        </div>

        <div className="space-y-6">
          <Cartao titulo="Situação">
            <div className="mb-3 flex items-center gap-2">
              <Selo cor={COR_STATUS_VISTORIA[v.status]}>{ROTULO_STATUS_VISTORIA[v.status]}</Selo>
              {v.concluida_em && <span className="text-xs text-mudo">concluída em {formatarDataBR(hojeISO(new Date(v.concluida_em)))}</span>}
            </div>
            <div className="flex flex-wrap gap-2">
              {v.status === "rascunho" && (
                <BotaoAcao acao={iniciarVistoria} id={id} variante="primario">
                  <Play className="size-4" /> Iniciar vistoria
                </BotaoAcao>
              )}
              {v.status === "em_andamento" && (
                <BotaoAcao
                  acao={concluirVistoria}
                  id={id}
                  variante="primario"
                  confirmar={`Concluir a vistoria?${p.faltam ? ` Ainda faltam ${p.faltam} item(ns) sem avaliação.` : ""} Depois dá para gerar o laudo e mandar para assinatura.`}
                >
                  <CheckCircle2 className="size-4" /> Concluir vistoria
                </BotaoAcao>
              )}
              {v.status === "concluida" && (
                <BotaoAcao acao={marcarAssinadaPapel} id={id} confirmar="Marcar como assinada? Use quando o laudo foi assinado em papel.">
                  <Signature className="size-4" /> Assinada no papel
                </BotaoAcao>
              )}
              {(v.status === "concluida" || v.status === "contestada" || v.status === "assinada") && (
                <BotaoAcao
                  acao={reabrirVistoria}
                  id={id}
                  variante="fantasma"
                  confirmar={
                    v.status === "assinada" || v.assinada_em
                      ? "Reabrir uma vistoria com laudo ASSINADO? O laudo assinado continua em Documentos como histórico, mas deixa de valer para a versão corrigida: depois de corrigir e concluir, gere um laudo novo e colha as assinaturas de novo."
                      : "Reabrir para corrigir? Um laudo enviado e ainda não assinado é cancelado (gere outro depois)."
                  }
                >
                  <RotateCcw className="size-4" /> Reabrir
                </BotaoAcao>
              )}
            </div>
            {v.assinada_em && (
              <p className="mt-2 text-sm text-ok">
                Laudo assinado em {formatarDataBR(hojeISO(new Date(v.assinada_em)))}.{v.status === "assinada" ? " Para corrigir (ex.: contestação aceita), use “Reabrir”." : ""}
              </p>
            )}
            {(v.status === "concluida" || v.status === "contestada") && (
              <Link href={`/vistorias/${id}/assinaturas`} className="mt-3 block text-sm text-acento hover:underline">
                Gerar laudo e mandar para assinatura →
              </Link>
            )}
          </Cartao>

          <Cartao titulo="Agenda">
            {visita ? (
              <p className="text-sm text-texto-2">
                Marcada para {quando(visita.data_hora)} ({visita.status}).{" "}
                <Link href={`/agenda/${visita.id}`} className="text-acento hover:underline">
                  abrir na agenda
                </Link>
              </p>
            ) : (
              <>
                <p className="mb-3 text-sm text-mudo">Ainda não está na agenda.</p>
                <JanelaCadastro rotuloBotao={<><CalendarPlus className="size-4" /> Marcar na agenda</>} variante="secundario" titulo="Marcar vistoria na agenda" acao={agendarVistoria} rotuloSalvar="Marcar" icone={<CalendarPlus />}>
                  <input type="hidden" name="vistoria_id" value={id} />
                  <div className="grid gap-4 sm:grid-cols-3">
                    <Campo rotulo="Data">
                      <Entrada type="date" name="data" defaultValue={v.data >= hojeISO() ? v.data : hojeISO()} required />
                    </Campo>
                    <Campo rotulo="Hora">
                      <Entrada type="time" name="hora" defaultValue="09:00" />
                    </Campo>
                    <Campo rotulo="Duração (min)">
                      <Entrada name="duracao_min" inputMode="numeric" defaultValue="90" />
                    </Campo>
                  </div>
                </JanelaCadastro>
              </>
            )}
          </Cartao>

          <Cartao titulo="Envolvidos">
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-xs text-mudo">Locatário(s)</dt>
                <dd>
                  {partes.locatarios.map((l) => (
                    <Link key={l.id} href={`/pessoas/${l.id}`} className="block font-medium text-texto hover:underline">
                      {l.nome}
                    </Link>
                  ))}
                  {!partes.locatarios.length && <span className="text-mudo">{v.contrato_id ? "Contrato sem locatário." : "Sem contrato vinculado."}</span>}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-mudo">{pessoal ? "Locador" : "Proprietário(s)"}</dt>
                <dd>
                  {pessoal ? (
                    <span className="font-medium text-texto">{organizacao.nome}</span>
                  ) : (
                    partes.proprietarios.map((l) => (
                      <Link key={l.id} href={`/pessoas/${l.id}`} className="block font-medium text-texto hover:underline">
                        {l.nome}
                      </Link>
                    ))
                  )}
                  {!pessoal && !partes.proprietarios.length && <span className="text-alerta">Imóvel sem proprietário cadastrado.</span>}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-mudo">{pessoal ? "Feita por" : "Vistoriador"}</dt>
                <dd className="font-medium text-texto">{quemFez(v) ?? "—"}</dd>
              </div>
            </dl>
          </Cartao>
        </div>
      </div>
    </>
  );
}
