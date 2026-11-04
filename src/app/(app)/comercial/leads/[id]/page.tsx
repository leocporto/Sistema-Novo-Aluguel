import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import {
  ArrowRightLeft,
  CalendarDays,
  CalendarPlus,
  Flag,
  Handshake,
  ListTodo,
  Mail,
  MessageCircle,
  MessageSquarePlus,
  Phone,
  RotateCcw,
  StickyNote,
  UserPlus,
  Users,
  XCircle,
} from "lucide-react";
import { BotaoExcluir } from "@/components/botao-excluir";
import { Formulario } from "@/components/formulario";
import { JanelaCadastro } from "@/components/janela-cadastro";
import { AreaTexto, Campo, Cartao, Entrada, Selecao, Selo, classeBotao } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { MOTIVOS_PERDA, ROTULO_FUNIL, TODAS_ETAPAS, horasAtePrimeiroAtendimento, perfilDoLead, rotuloEtapa, textoHoras, type Funil } from "@/lib/dominio/crm";
import { formatarDataBR, hojeISO } from "@/lib/dominio/datas";
import { formatarReais } from "@/lib/dominio/dinheiro";
import { imoveisQueCombinam, type ImovelOferta } from "@/lib/dominio/pessoas";
import { ROTULO_ORIGEM_LEAD, ROTULO_STATUS_PROPOSTA, ROTULO_STATUS_VISITA, ROTULO_TIPO_PROPOSTA, type Lead } from "@/lib/tipos";
import { linkWhatsapp } from "@/lib/whatsapp";
import {
  atualizarLead,
  criarProposta,
  criarTarefa,
  desassociarImovelLead,
  excluirEventoLead,
  excluirLead,
  registrarContatoLead,
  transferirLead,
} from "../../actions";
import { AdicionarImovelLead, AssociarSugestao, BotaoReativar } from "../../botoes-lead";
import { AbasComercial, CamposLead, CamposProposta, CamposTarefa, rotuloImovel } from "../../campos";
import { criarCompromisso } from "../../../agenda/actions";
import { CamposCompromisso } from "../../../agenda/campos";
import { carregarOpcoes } from "../../dados";

export const metadata: Metadata = { title: "Lead" };

const dataHora = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });

const ICONE_EVENTO: Record<string, ReactNode> = {
  entrada: <UserPlus />,
  ligacao: <Phone />,
  whatsapp: <MessageCircle />,
  email: <Mail />,
  reuniao: <Users />,
  nota: <StickyNote />,
  etapa: <Flag />,
  transferencia: <ArrowRightLeft />,
  perda: <XCircle />,
  reativacao: <RotateCcw />,
  mensagem: <MessageCircle />,
};
const ROTULO_EVENTO: Record<string, string> = {
  entrada: "Entrada",
  ligacao: "Ligação",
  whatsapp: "WhatsApp",
  email: "E-mail",
  reuniao: "Reunião",
  nota: "Anotação",
  etapa: "Mudou de etapa",
  transferencia: "Atendimento transferido",
  perda: "Negócio perdido",
  reativacao: "Reativado",
  mensagem: "Nova mensagem",
};

export default async function LeadPage({ params }: PageProps<"/comercial/leads/[id]">) {
  const { id } = await params;
  const { supabase } = await obterContexto();
  const hoje = hojeISO();
  const [{ data }, opcoes, { data: eventos }, { data: visitas }, { data: propostas }, { data: tarefas }, { data: vinculados }, { data: disponiveis }] =
    await Promise.all([
      supabase.from("leads").select("*, corretor:pessoas!leads_corretor_id_fkey(id, nome, telefone)").eq("id", id).maybeSingle(),
      carregarOpcoes(supabase),
      supabase.from("lead_eventos").select("id, tipo, descricao, data").eq("lead_id", id).order("data", { ascending: false }).limit(300),
      supabase.from("visitas").select("id, data_hora, status, imovel:imoveis(codigo)").eq("lead_id", id).order("data_hora", { ascending: false }),
      supabase.from("propostas").select("id, tipo, valor, status, created_at, imovel:imoveis(codigo)").eq("lead_id", id).order("created_at", { ascending: false }),
      supabase.from("tarefas").select("id, titulo, vencimento, concluida").eq("lead_id", id).order("vencimento"),
      supabase.from("lead_imoveis").select("imovel:imoveis(id, codigo, logradouro, numero, bairro, valor_aluguel, valor_venda, status)").eq("lead_id", id),
      supabase.from("imoveis").select("id, codigo, tipo, finalidades, status, bairro, cidade, quartos, valor_aluguel, valor_venda, logradouro, numero").eq("status", "disponivel"),
    ]);
  if (!data) notFound();
  const lead = data as unknown as Lead & { corretor: { id: string; nome: string; telefone: string | null } | null };
  const funil = lead.funil as Funil;
  const leads = opcoes.leads.some((l) => l.id === lead.id) ? opcoes.leads : [{ id: lead.id, nome: lead.nome }, ...opcoes.leads];

  type ImV = { id: string; codigo: string; logradouro: string | null; numero: string | null; bairro: string | null; valor_aluguel: number | null; valor_venda: number | null; status: string };
  const imoveisLead = ((vinculados ?? []) as unknown as { imovel: ImV }[]).map((v) => v.imovel).filter(Boolean);
  const idsLead = new Set(imoveisLead.map((i) => i.id));
  type Disp = ImovelOferta & { codigo: string; logradouro: string | null; numero: string | null };
  const temPerfil = lead.tipos?.length || lead.regioes || lead.orcamento_max || lead.orcamento_min || lead.quartos_min;
  const sugestoes = funil !== "captacao" && temPerfil ? imoveisQueCombinam(perfilDoLead(lead), (disponiveis ?? []) as Disp[]).filter((i) => !idsLead.has(i.id)).slice(0, 8) : [];
  const espera = horasAtePrimeiroAtendimento(lead.created_at, lead.atendido_em);

  type V = { id: string; data_hora: string; status: string; imovel: { codigo: string } | null };
  type P = { id: string; tipo: string; valor: number; status: string; created_at: string; imovel: { codigo: string } | null };
  type T = { id: string; titulo: string; vencimento: string | null; concluida: boolean };
  type Item = { data: string; icone: ReactNode; titulo: string; detalhe?: string | null; eventoId?: string };
  const linha: Item[] = [
    ...(eventos ?? []).map((e) => ({ data: e.data, icone: ICONE_EVENTO[e.tipo] ?? <StickyNote />, titulo: ROTULO_EVENTO[e.tipo] ?? e.tipo, detalhe: e.descricao, eventoId: e.id })),
    ...((visitas ?? []) as unknown as V[]).map((v) => ({ data: v.data_hora, icone: <CalendarDays />, titulo: `Visita ${ROTULO_STATUS_VISITA[v.status]?.toLowerCase() ?? v.status}`, detalhe: v.imovel?.codigo })),
    ...((propostas ?? []) as unknown as P[]).map((p) => ({
      data: p.created_at,
      icone: <Handshake />,
      titulo: `Proposta de ${ROTULO_TIPO_PROPOSTA[p.tipo]?.toLowerCase()}`,
      detalhe: `${formatarReais(p.valor)}${p.imovel ? ` · ${p.imovel.codigo}` : ""} · ${ROTULO_STATUS_PROPOSTA[p.status]}`,
    })),
  ].sort((a, b) => b.data.localeCompare(a.data));

  return (
    <>
      <div className="mb-[clamp(14px,1.5vw,18px)] flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[13px] text-mudo">
            <span>Novo Aluguel</span>
            <span className="text-fraco">›</span>
            <Link href={funil === "locacao" ? "/comercial" : `/comercial?funil=${funil}`} className="text-acento-hot hover:underline">
              Funil de {ROTULO_FUNIL[funil]?.toLowerCase()}
            </Link>
          </div>
          <h1 className="mt-1.5 text-[clamp(28px,3vw,38px)] font-semibold leading-[1.05] tracking-[-0.025em] text-texto">{lead.nome}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[13.5px] text-texto-2">
            <Selo cor={lead.status === "ganho" ? "verde" : lead.status === "perdido" ? "cinza" : "azul"}>{rotuloEtapa(funil, lead.status)}</Selo>
            {lead.prioridade === "quente" && <Selo cor="vermelho">Prioridade alta</Selo>}
            {lead.etiquetas?.map((t) => (
              <Selo key={t}>#{t}</Selo>
            ))}
            <span>
              {ROTULO_ORIGEM_LEAD[lead.origem] ?? lead.origem} · chegou em {dataHora(lead.created_at)}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {lead.telefone && (
            <a href={linkWhatsapp(lead.telefone, `Olá ${lead.nome.split(" ")[0]}! Tudo bem?`)} target="_blank" rel="noreferrer" className={classeBotao("secundario")}>
              <MessageCircle className="size-4" /> WhatsApp
            </a>
          )}
          <JanelaCadastro rotuloBotao={<><CalendarPlus className="size-4" /> Agendar visita</>} variante="secundario" titulo="Agendar visita" acao={criarCompromisso} rotuloSalvar="Agendar" icone={<CalendarPlus />} larguraMax="max-w-2xl">
            <input type="hidden" name="voltar" value="1" />
            <CamposCompromisso opcoes={{ ...opcoes, leads, pessoas: [] }} pessoal={false} hoje={hoje} padrao={{ leadId: lead.id, imovelId: imoveisLead[0]?.id }} />
          </JanelaCadastro>
          <JanelaCadastro rotuloBotao={<><Handshake className="size-4" /> Proposta</>} titulo="Nova proposta" acao={criarProposta} rotuloSalvar="Registrar" icone={<Handshake />}>
            <CamposProposta imoveis={opcoes.imoveis} leads={leads} corretores={opcoes.corretores} leadId={lead.id} imovelId={imoveisLead[0]?.id} tipo={funil === "venda" ? "venda" : "locacao"} pessoal={false} />
          </JanelaCadastro>
          <BotaoExcluir acao={excluirLead} id={lead.id} variante="botao" rotulo="Excluir" confirmar="Excluir este lead? Visitas e propostas continuam salvas." depois="/comercial" />
        </div>
      </div>
      <AbasComercial />

      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <Cartao
            titulo={`Histórico (${linha.length})`}
            acoes={
              <JanelaCadastro rotuloBotao={<><MessageSquarePlus className="size-3.5" /> Registrar contato</>} tamanho="sm" titulo="Registrar contato" acao={registrarContatoLead} rotuloSalvar="Salvar" icone={<MessageSquarePlus />}>
                <input type="hidden" name="lead_id" value={lead.id} />
                <div className="grid gap-4 sm:grid-cols-2">
                  <Campo rotulo="Tipo">
                    <Selecao name="tipo" defaultValue="whatsapp">
                      <option value="whatsapp">WhatsApp</option>
                      <option value="ligacao">Ligação</option>
                      <option value="email">E-mail</option>
                      <option value="reuniao">Reunião</option>
                      <option value="nota">Anotação interna</option>
                    </Selecao>
                  </Campo>
                  <Campo rotulo="Próximo contato (opcional)">
                    <Entrada type="date" name="proximo_contato" min={hoje} />
                  </Campo>
                </div>
                <Campo rotulo="O que foi conversado">
                  <AreaTexto name="descricao" rows={4} required />
                </Campo>
              </JanelaCadastro>
            }
          >
            {linha.length === 0 ? (
              <p className="text-sm text-mudo">Nada registrado ainda.</p>
            ) : (
              <ol className="relative max-h-[520px] space-y-3.5 overflow-y-auto pr-1 before:absolute before:bottom-2 before:left-[15px] before:top-2 before:w-px before:bg-borda">
                {linha.map((e, i) => (
                  <li key={i} className="relative flex gap-3">
                    <span className="relative z-10 grid size-8 shrink-0 place-items-center rounded-full border border-borda bg-card text-texto-2 [&>svg]:size-4">{e.icone}</span>
                    <div className="min-w-0 flex-1 pt-1">
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-sm font-medium text-texto">{e.titulo}</span>
                        <span className="flex shrink-0 items-center gap-2 text-xs text-mudo">
                          {dataHora(e.data)}
                          {e.eventoId && <BotaoExcluir acao={excluirEventoLead} id={e.eventoId} rotulo="Excluir registro" confirmar="Excluir este registro do histórico?" />}
                        </span>
                      </div>
                      {e.detalhe && <p className="mt-0.5 whitespace-pre-line text-[13px] text-texto-2">{e.detalhe}</p>}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Cartao>

          <Cartao titulo={`Imóveis do lead (${imoveisLead.length})`}>
            <ul className="mb-3 divide-y divide-borda-suave">
              {imoveisLead.map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-2 py-2">
                  <Link href={`/imoveis/${i.id}`} className="min-w-0">
                    <span className="font-semibold text-acento hover:underline">{i.codigo}</span>
                    <span className="block truncate text-xs text-mudo">{rotuloImovel(i)}</span>
                  </Link>
                  <span className="flex items-center gap-2 text-sm tabular-nums">
                    {i.valor_aluguel ? `${formatarReais(i.valor_aluguel)}/mês` : i.valor_venda ? formatarReais(i.valor_venda) : ""}
                    <BotaoExcluir acao={desassociarImovelLead} id={`${lead.id}|${i.id}`} rotulo="Tirar do lead" confirmar={`Tirar ${i.codigo} deste lead?`} />
                  </span>
                </li>
              ))}
              {imoveisLead.length === 0 && <li className="py-2 text-sm text-mudo">Nenhum imóvel associado.</li>}
            </ul>
            <AdicionarImovelLead leadId={lead.id} opcoes={opcoes.imoveis.filter((i) => !idsLead.has(i.id)).map((i) => ({ id: i.id, rotulo: rotuloImovel(i) }))} />
            {funil !== "captacao" && (
              <div className="mt-5">
                <h4 className="mb-2 text-sm font-semibold text-texto">Sugestões compatíveis</h4>
                {!temPerfil ? (
                  <p className="text-xs text-mudo">Preencha “O que procura” (tipo, orçamento, bairros) para ver imóveis que combinam.</p>
                ) : sugestoes.length === 0 ? (
                  <p className="text-xs text-mudo">Nenhum imóvel disponível dentro do perfil.</p>
                ) : (
                  <ul className="divide-y divide-borda-suave">
                    {sugestoes.map((i) => (
                      <li key={i.id} className="flex items-center justify-between gap-2 py-2">
                        <Link href={`/imoveis/${i.id}`} className="min-w-0">
                          <span className="font-semibold text-acento hover:underline">{i.codigo}</span>
                          <span className="block truncate text-xs capitalize text-mudo">
                            {i.tipo}
                            {i.quartos ? ` · ${i.quartos} qto(s)` : ""}
                            {i.bairro ? ` · ${i.bairro}` : ""}
                          </span>
                        </Link>
                        <span className="flex items-center gap-2 text-sm tabular-nums">
                          {funil === "venda" && i.valor_venda ? formatarReais(i.valor_venda) : i.valor_aluguel ? `${formatarReais(i.valor_aluguel)}/mês` : ""}
                          <AssociarSugestao leadId={lead.id} imovelId={i.id} />
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </Cartao>

          <Formulario acao={atualizarLead} automatico>
            <input type="hidden" name="id" value={lead.id} />
            <Cartao titulo="Dados do lead">
              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Campo rotulo="Etapa do funil">
                    <Selecao name="status" defaultValue={lead.status}>
                      {TODAS_ETAPAS.map((k) => (
                        <option key={k} value={k}>
                          {rotuloEtapa(funil, k)}
                        </option>
                      ))}
                    </Selecao>
                  </Campo>
                  <Campo rotulo="Motivo (se perdido)">
                    <Selecao name="motivo_perda" defaultValue={lead.motivo_perda ?? MOTIVOS_PERDA[0]}>
                      {MOTIVOS_PERDA.map((m) => (
                        <option key={m}>{m}</option>
                      ))}
                    </Selecao>
                  </Campo>
                </div>
                <CamposLead imoveis={opcoes.imoveis} lead={lead} />
              </div>
            </Cartao>
          </Formulario>
        </div>

        <div className="space-y-6">
          <Cartao titulo="Atendimento">
            <dl className="space-y-2.5 text-sm">
              <div className="flex justify-between gap-2">
                <dt className="text-mudo">Corretor</dt>
                <dd className="font-medium text-texto">
                  {lead.corretor ? (
                    <Link href={`/pessoas/${lead.corretor.id}`} className="hover:underline">
                      {lead.corretor.nome}
                    </Link>
                  ) : (
                    "—"
                  )}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-mudo">Tempo até o 1º atendimento</dt>
                <dd className={`font-medium ${espera === null ? "text-ruim" : espera > 24 ? "text-ruim" : espera > 2 ? "text-alerta" : "text-ok"}`}>
                  {espera === null ? "ainda não atendido" : textoHoras(espera)}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-mudo">Último contato</dt>
                <dd className="text-texto">{lead.ultimo_contato ? dataHora(lead.ultimo_contato) : "—"}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-mudo">Próximo contato</dt>
                <dd className={lead.proximo_contato && lead.proximo_contato <= hoje ? "font-semibold text-alerta" : "text-texto"}>{formatarDataBR(lead.proximo_contato)}</dd>
              </div>
              {lead.status === "perdido" && (
                <div className="flex justify-between gap-2">
                  <dt className="text-mudo">Motivo da perda</dt>
                  <dd className="text-right text-ruim">{lead.motivo_perda ?? "—"}</dd>
                </div>
              )}
            </dl>
            <div className="mt-4 flex flex-wrap gap-2">
              <JanelaCadastro rotuloBotao={<><ArrowRightLeft className="size-3.5" /> Transferir</>} variante="secundario" tamanho="sm" titulo="Transferir atendimento" acao={transferirLead} rotuloSalvar="Transferir" icone={<ArrowRightLeft />}>
                <input type="hidden" name="lead_id" value={lead.id} />
                <Campo rotulo="Novo corretor">
                  <Selecao name="corretor_id" defaultValue="">
                    <option value="">— sem corretor —</option>
                    {opcoes.corretores.length > 0 && <option value="auto">Próximo do rodízio</option>}
                    {opcoes.corretores.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nome}
                      </option>
                    ))}
                  </Selecao>
                </Campo>
                <Campo rotulo="Motivo (opcional)">
                  <Entrada name="motivo" placeholder="Férias, especialista na região…" />
                </Campo>
              </JanelaCadastro>
              {(lead.status === "perdido" || lead.status === "ganho") && <BotaoReativar id={lead.id} telefone={lead.telefone} nome={lead.nome} />}
            </div>
          </Cartao>

          <Cartao
            titulo="Tarefas e lembretes"
            acoes={
              <JanelaCadastro rotuloBotao={<><ListTodo className="size-3.5" /> Nova</>} variante="fantasma" tamanho="sm" titulo="Nova tarefa" acao={criarTarefa} rotuloSalvar="Criar" icone={<ListTodo />}>
                <CamposTarefa leadId={lead.id} hoje={hoje} />
              </JanelaCadastro>
            }
          >
            <ul className="space-y-2 text-sm">
              {((tarefas ?? []) as T[]).map((t) => (
                <li key={t.id} className={`flex justify-between gap-2 ${t.concluida ? "text-mudo line-through" : ""}`}>
                  <span>{t.titulo}</span>
                  <span className={!t.concluida && t.vencimento && t.vencimento < hoje ? "text-ruim" : "text-mudo"}>{formatarDataBR(t.vencimento)}</span>
                </li>
              ))}
              {!tarefas?.length && <li className="text-mudo">Nenhuma tarefa.</li>}
            </ul>
          </Cartao>

          <Cartao titulo="Visitas">
            <ul className="space-y-2 text-sm">
              {((visitas ?? []) as unknown as V[]).map((v) => (
                <li key={v.id} className="flex items-center justify-between gap-2">
                  <Link href={`/agenda/${v.id}`} className="hover:underline">
                    {dataHora(v.data_hora)}
                    {v.imovel ? ` · ${v.imovel.codigo}` : ""}
                  </Link>
                  <Selo cor={v.status === "realizada" ? "verde" : v.status === "cancelada" ? "cinza" : "azul"}>{ROTULO_STATUS_VISITA[v.status]}</Selo>
                </li>
              ))}
              {!visitas?.length && <li className="text-mudo">Nenhuma visita.</li>}
            </ul>
          </Cartao>

          <Cartao titulo="Propostas" acoes={<Link href="/comercial/propostas" className="text-xs text-acento">ver todas</Link>}>
            <ul className="space-y-2 text-sm">
              {((propostas ?? []) as unknown as P[]).map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2">
                  <span>
                    {ROTULO_TIPO_PROPOSTA[p.tipo]} · {formatarReais(p.valor)}
                    {p.imovel ? ` · ${p.imovel.codigo}` : ""}
                  </span>
                  <Selo cor={p.status === "aceita" ? "verde" : p.status === "em_negociacao" ? "amarelo" : "cinza"}>{ROTULO_STATUS_PROPOSTA[p.status]}</Selo>
                </li>
              ))}
              {!propostas?.length && <li className="text-mudo">Nenhuma proposta.</li>}
            </ul>
          </Cartao>
        </div>
      </div>
    </>
  );
}
