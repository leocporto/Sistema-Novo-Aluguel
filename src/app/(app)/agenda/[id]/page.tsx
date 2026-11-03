import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import {
  Ban,
  CalendarClock,
  CalendarPlus,
  Check,
  CheckCheck,
  Download,
  Flag,
  KeyRound,
  LogIn,
  LogOut,
  MessageCircle,
  MessageSquarePlus,
  RotateCcw,
  StickyNote,
  Star,
  UserPlus,
  Video,
  XCircle,
} from "lucide-react";
import { BotaoExcluir } from "@/components/botao-excluir";
import { BotaoEnviar, Formulario } from "@/components/formulario";
import { JanelaCadastro } from "@/components/janela-cadastro";
import { AreaTexto, BotaoLink, Campo, Cartao, Entrada, Selecao, Selo, classeBotao } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { ROTULO_INTERESSE, ROTULO_TIPO_COMPROMISSO, TIPOS_COMPROMISSO, TIPOS_SO_IMOBILIARIA, diaLocal, horaLocal, linkGoogleAgenda } from "@/lib/dominio/agenda";
import { formatarDataBR, hojeISO } from "@/lib/dominio/datas";
import { linkWhatsapp } from "@/lib/whatsapp";
import {
  adicionarParticipante,
  atualizarCompromisso,
  cancelarCompromisso,
  excluirCompromisso,
  excluirEventoCompromisso,
  excluirParticipante,
  marcarCompromisso,
  reagendarCompromisso,
  registrarNotaCompromisso,
} from "../actions";
import { AbasAgenda, OPCOES_LEMBRETE } from "../campos";
import { SELECT_COMPROMISSO, carregarOpcoesAgenda, clienteDo, enderecoDo, tituloDo, type CompromissoTela } from "../dados";

export const metadata: Metadata = { title: "Compromisso" };

const dataHora = (iso: string) => `${formatarDataBR(diaLocal(iso))} ${horaLocal(iso)}`;

const ICONE: Record<string, ReactNode> = {
  criada: <CalendarPlus />,
  reagendada: <CalendarClock />,
  cancelada: <XCircle />,
  confirmada: <CheckCheck />,
  checkin: <LogIn />,
  checkout: <LogOut />,
  feedback: <Star />,
  chave: <KeyRound />,
  nota: <StickyNote />,
  realizada: <Flag />,
};

function Passo({ feito, titulo, detalhe, children }: { feito: boolean; titulo: string; detalhe?: string | null; children?: ReactNode }) {
  return (
    <li className="flex flex-wrap items-center gap-3 py-2.5">
      <span className={`grid size-7 shrink-0 place-items-center rounded-full border ${feito ? "border-ok-bd bg-ok-bg text-ok" : "border-borda bg-card text-fraco"}`}>
        <Check className="size-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-texto">{titulo}</div>
        {detalhe && <div className="text-xs text-mudo">{detalhe}</div>}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">{children}</div>
    </li>
  );
}

function Acao({ id, acao, children, variante = "secundario" }: { id: string; acao: string; children: ReactNode; variante?: "secundario" | "primario" | "fantasma" }) {
  return (
    <form action={marcarCompromisso}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="acao" value={acao} />
      <BotaoEnviar variante={variante}>{children}</BotaoEnviar>
    </form>
  );
}

export default async function CompromissoPage({ params }: PageProps<"/agenda/[id]">) {
  const { id } = await params;
  const { supabase, organizacao } = await obterContexto();
  const pessoal = organizacao.modo === "pessoal";
  const hoje = hojeISO();
  const [{ data }, { data: eventos }, { data: participantes }, opcoes] = await Promise.all([
    supabase.from("visitas").select(SELECT_COMPROMISSO).eq("id", id).maybeSingle(),
    supabase.from("visita_eventos").select("id, tipo, descricao, data").eq("visita_id", id).order("data", { ascending: false }),
    supabase.from("visita_participantes").select("id, nome, papel, pessoa:pessoas(id, nome, telefone)").eq("visita_id", id),
    carregarOpcoesAgenda(supabase),
  ]);
  if (!data) notFound();
  const v = data as unknown as CompromissoTela;
  const { data: chaves } = v.imovel_id
    ? await supabase.from("chaves").select("id, codigo, identificacao, local, chave_movimentacoes(id, retirada_por, devolvida_em, visita_id)").eq("imovel_id", v.imovel_id)
    : { data: [] };
  // Compromisso marcado pela tela de vistorias: leva de volta à vistoria.
  const { data: vistoria } = v.tipo === "vistoria" ? await supabase.from("vistorias").select("id, numero").eq("visita_id", id).limit(1).maybeSingle() : { data: null };

  const cliente = clienteDo(v);
  const endereco = enderecoDo(v);
  const titulo = tituloDo(v);
  const quando = `${formatarDataBR(diaLocal(v.data_hora))} às ${horaLocal(v.data_hora)}`;
  const proprietarios = pessoal ? [] : (v.imovel?.imovel_proprietarios ?? []).map((p) => p.pessoa).filter((p): p is NonNullable<typeof p> => !!p);
  const passou = diaLocal(v.data_hora) < hoje;
  const evCal = { id: v.id, titulo, inicio: v.data_hora, duracao_min: v.duracao_min, local: endereco, descricao: [cliente?.nome, cliente?.telefone, v.link_virtual, v.observacoes].filter(Boolean).join("\n"), lembrete_min: v.lembrete_min };
  const tipoTexto = (ROTULO_TIPO_COMPROMISSO[v.tipo] ?? "compromisso").toLowerCase();
  const msgCliente = cliente
    ? `Olá ${cliente.nome.split(" ")[0]}! Confirmando a nossa ${tipoTexto} em ${quando}${endereco ? ` — ${endereco}` : ""}${v.modalidade === "virtual" && v.link_virtual ? ` pelo link ${v.link_virtual}` : ""}. Podemos confirmar?`
    : "";
  const tipos = TIPOS_COMPROMISSO.filter((t) => !(pessoal && TIPOS_SO_IMOBILIARIA.includes(t)) || t === v.tipo);
  type Part = { id: string; nome: string | null; papel: string | null; pessoa: { id: string; nome: string; telefone: string | null } | null };
  type Ch = { id: string; codigo: string | null; identificacao: string; local: string | null; chave_movimentacoes: { id: string; retirada_por: string; devolvida_em: string | null; visita_id: string | null }[] };

  return (
    <>
      <div className="mb-[clamp(14px,1.5vw,18px)] flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[13px] text-mudo">
            <span>Novo Aluguel</span>
            <span className="text-fraco">›</span>
            <Link href={`/agenda?vista=dia&dia=${diaLocal(v.data_hora)}`} className="text-acento-hot hover:underline">
              Agenda
            </Link>
          </div>
          <h1 className="mt-1.5 text-[clamp(26px,2.8vw,36px)] font-semibold leading-[1.05] tracking-[-0.025em] text-texto">{titulo}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[13.5px] text-texto-2">
            <Selo cor={v.status === "realizada" ? "verde" : v.status === "cancelada" ? "cinza" : "azul"}>{v.status}</Selo>
            {v.modalidade === "virtual" && <Selo>virtual</Selo>}
            {!v.compartilhada && <Selo>só na minha agenda</Selo>}
            <span className="capitalize">
              {quando} · {v.duracao_min} min
            </span>
            {vistoria && (
              <Link href={`/vistorias/${vistoria.id}`} className="text-acento hover:underline">
                abrir a vistoria nº {vistoria.numero}
              </Link>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {cliente?.telefone && v.status === "agendada" && (
            <a href={linkWhatsapp(cliente.telefone, msgCliente)} target="_blank" rel="noreferrer" className={classeBotao("secundario")}>
              <MessageCircle className="size-4" /> Confirmar pelo WhatsApp
            </a>
          )}
          <a href={linkGoogleAgenda(evCal)} target="_blank" rel="noreferrer" className={classeBotao("secundario")}>
            <CalendarPlus className="size-4" /> Google Agenda
          </a>
          <a href={`/agenda/${v.id}/ics`} className={classeBotao("secundario")}>
            <Download className="size-4" /> .ics
          </a>
          {v.status !== "cancelada" && (
            <>
              <JanelaCadastro rotuloBotao={<><CalendarClock className="size-4" /> Reagendar</>} variante="secundario" titulo="Reagendar" acao={reagendarCompromisso} rotuloSalvar="Reagendar" icone={<CalendarClock />}>
                <input type="hidden" name="id" value={v.id} />
                <div className="grid gap-4 sm:grid-cols-2">
                  <Campo rotulo="Nova data">
                    <Entrada type="date" name="data" required defaultValue={diaLocal(v.data_hora)} />
                  </Campo>
                  <Campo rotulo="Nova hora">
                    <Entrada type="time" name="hora" required defaultValue={horaLocal(v.data_hora)} />
                  </Campo>
                </div>
                <Campo rotulo="Motivo (opcional)">
                  <Entrada name="motivo" placeholder="Cliente pediu outro horário…" />
                </Campo>
                <label className="flex items-center gap-2 text-sm text-texto-2">
                  <input type="checkbox" name="agendar_mesmo_assim" /> Reagendar mesmo se houver conflito
                </label>
              </JanelaCadastro>
              <JanelaCadastro rotuloBotao={<><Ban className="size-4" /> Cancelar</>} variante="secundario" titulo="Cancelar compromisso" acao={cancelarCompromisso} rotuloSalvar="Cancelar compromisso" icone={<Ban />}>
                <input type="hidden" name="id" value={v.id} />
                <Campo rotulo="Motivo">
                  <Selecao name="motivo" defaultValue="Cliente desmarcou">
                    {["Cliente desmarcou", "Cliente não compareceu", "Proprietário/inquilino não liberou", "Imóvel indisponível", "Corretor indisponível", "Imóvel já foi alugado/vendido", "Outro"].map((m) => (
                      <option key={m}>{m}</option>
                    ))}
                  </Selecao>
                </Campo>
              </JanelaCadastro>
            </>
          )}
          <BotaoExcluir acao={excluirCompromisso} id={v.id} variante="botao" rotulo="Excluir" confirmar="Excluir este compromisso?" depois="/agenda" />
        </div>
      </div>
      <AbasAgenda />

      {v.status === "cancelada" && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-borda bg-elev px-4 py-3 text-sm text-texto-2">
          <span>Cancelado: {v.motivo_cancelamento ?? "—"}</span>
          <Acao id={v.id} acao="reabrir">
            <RotateCcw className="size-4" /> Reabrir
          </Acao>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <Cartao titulo="Andamento">
            <ol className="divide-y divide-borda-suave">
              <Passo feito={!!v.cliente_confirmado_em} titulo={cliente ? `Confirmação de ${cliente.nome}` : "Confirmação do cliente"} detalhe={v.cliente_confirmado_em ? `confirmado em ${dataHora(v.cliente_confirmado_em)}` : cliente?.telefone ?? "sem telefone"}>
                {cliente?.telefone && !v.cliente_confirmado_em && v.status === "agendada" && (
                  <a href={linkWhatsapp(cliente.telefone, msgCliente)} target="_blank" rel="noreferrer" className={classeBotao("secundario", "sm")}>
                    <MessageCircle className="size-3.5" /> WhatsApp
                  </a>
                )}
                <Acao id={v.id} acao={v.cliente_confirmado_em ? "desconfirmar_cliente" : "confirmar_cliente"} variante={v.cliente_confirmado_em ? "fantasma" : "secundario"}>
                  {v.cliente_confirmado_em ? "Desfazer" : "Marcar confirmado"}
                </Acao>
              </Passo>
              {(proprietarios.length > 0 || v.proprietario_confirmado_em) && (
                <Passo
                  feito={!!v.proprietario_confirmado_em}
                  titulo={`Confirmação do proprietário${proprietarios[0] ? ` (${proprietarios[0].nome})` : ""}`}
                  detalhe={v.proprietario_confirmado_em ? `confirmado em ${dataHora(v.proprietario_confirmado_em)}` : "avise quem precisa liberar o acesso"}
                >
                  {proprietarios[0]?.telefone && !v.proprietario_confirmado_em && (
                    <a
                      href={linkWhatsapp(proprietarios[0].telefone, `Olá ${proprietarios[0].nome.split(" ")[0]}! Temos ${tipoTexto} no seu imóvel ${v.imovel?.codigo ?? ""} em ${quando}. Tudo certo?`)}
                      target="_blank"
                      rel="noreferrer"
                      className={classeBotao("secundario", "sm")}
                    >
                      <MessageCircle className="size-3.5" /> WhatsApp
                    </a>
                  )}
                  <Acao id={v.id} acao={v.proprietario_confirmado_em ? "desconfirmar_proprietario" : "confirmar_proprietario"} variante={v.proprietario_confirmado_em ? "fantasma" : "secundario"}>
                    {v.proprietario_confirmado_em ? "Desfazer" : "Marcar confirmado"}
                  </Acao>
                </Passo>
              )}
              <Passo feito={!!v.checkin_em} titulo="Check-in (chegada)" detalhe={v.checkin_em ? dataHora(v.checkin_em) : null}>
                {!v.checkin_em && v.status !== "cancelada" && (
                  <Acao id={v.id} acao="checkin">
                    <LogIn className="size-4" /> Cheguei
                  </Acao>
                )}
              </Passo>
              <Passo feito={!!v.checkout_em || v.status === "realizada"} titulo="Check-out (saída)" detalhe={v.checkout_em ? dataHora(v.checkout_em) : v.status === "realizada" ? "realizado" : null}>
                {!v.checkout_em && v.status === "agendada" && (
                  <Acao id={v.id} acao="checkout">
                    <LogOut className="size-4" /> Saí
                  </Acao>
                )}
              </Passo>
              <Passo feito={!!v.feedback_interesse} titulo="Retorno pós-visita" detalhe={v.feedback_interesse ? ROTULO_INTERESSE[v.feedback_interesse] : passou ? "falta registrar o que o cliente achou" : "preencha depois da visita"} />
            </ol>
          </Cartao>

          <Cartao titulo="Feedback pós-visita">
            <Formulario acao={atualizarCompromisso} automatico className="space-y-4">
              <input type="hidden" name="id" value={v.id} />
              <div className="grid gap-4 sm:grid-cols-[1fr_160px]">
                <Campo rotulo="O que o cliente achou">
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(ROTULO_INTERESSE).map(([k, r]) => (
                      <label
                        key={k}
                        className="flex cursor-pointer items-center rounded-full border border-borda px-3 py-1.5 text-[13px] text-texto-2 transition hover:border-borda-forte has-[:checked]:border-acento has-[:checked]:bg-acento-bg has-[:checked]:text-acento-hot"
                      >
                        <input type="radio" name="feedback_interesse" value={k} defaultChecked={v.feedback_interesse === k} className="sr-only" />
                        {r}
                      </label>
                    ))}
                  </div>
                </Campo>
                <Campo rotulo="Nota da visita">
                  <Selecao name="feedback_nota" defaultValue={v.feedback_nota ? String(v.feedback_nota) : ""}>
                    <option value="">—</option>
                    {[5, 4, 3, 2, 1].map((n) => (
                      <option key={n} value={n}>
                        {"★".repeat(n)}
                      </option>
                    ))}
                  </Selecao>
                </Campo>
              </div>
              <Campo rotulo="Comentários do cliente">
                <AreaTexto name="feedback_texto" rows={3} defaultValue={v.feedback_texto ?? ""} placeholder="Gostou da cozinha, achou o quarto pequeno, quer ver outro com vaga…" />
              </Campo>
              <Campo rotulo="Retorno para o proprietário">
                <AreaTexto name="feedback_proprietario" rows={2} defaultValue={v.feedback_proprietario ?? ""} placeholder="O que repassar ao proprietário sobre a visita" />
              </Campo>
            </Formulario>
          </Cartao>

          <Cartao
            titulo={`Histórico (${eventos?.length ?? 0})`}
            acoes={
              <JanelaCadastro rotuloBotao={<><MessageSquarePlus className="size-3.5" /> Anotar</>} tamanho="sm" titulo="Anotação" acao={registrarNotaCompromisso} rotuloSalvar="Salvar" icone={<MessageSquarePlus />}>
                <input type="hidden" name="visita_id" value={v.id} />
                <Campo rotulo="Anotação">
                  <AreaTexto name="descricao" rows={3} required />
                </Campo>
              </JanelaCadastro>
            }
          >
            <ol className="space-y-3">
              {(eventos ?? []).map((e) => (
                <li key={e.id} className="flex gap-3">
                  <span className="grid size-8 shrink-0 place-items-center rounded-full border border-borda bg-card text-texto-2 [&>svg]:size-4">{ICONE[e.tipo] ?? <StickyNote />}</span>
                  <div className="min-w-0 flex-1 pt-1">
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-sm text-texto">{e.descricao}</span>
                      <span className="flex shrink-0 items-center gap-2 text-xs text-mudo">
                        {dataHora(e.data)}
                        <BotaoExcluir acao={excluirEventoCompromisso} id={e.id} rotulo="Excluir registro" confirmar="Excluir este registro?" />
                      </span>
                    </div>
                  </div>
                </li>
              ))}
              {!eventos?.length && <li className="text-sm text-mudo">Nada registrado.</li>}
            </ol>
          </Cartao>
        </div>

        <div className="space-y-6">
          <Cartao titulo="Detalhes">
            <dl className="mb-4 space-y-2 text-sm">
              {cliente && (
                <div className="flex justify-between gap-2">
                  <dt className="text-mudo">Cliente</dt>
                  <dd className="text-right font-medium text-texto">
                    {cliente.href ? (
                      <Link href={cliente.href} className="hover:underline">
                        {cliente.nome}
                      </Link>
                    ) : (
                      cliente.nome
                    )}
                    {cliente.telefone && <span className="block text-xs font-normal text-mudo">{cliente.telefone}</span>}
                  </dd>
                </div>
              )}
              {v.imovel && (
                <div className="flex justify-between gap-2">
                  <dt className="text-mudo">Imóvel</dt>
                  <dd className="text-right">
                    <Link href={`/imoveis/${v.imovel.id}`} className="font-medium text-acento hover:underline">
                      {v.imovel.codigo}
                    </Link>
                    {endereco && <span className="block text-xs text-mudo">{endereco}</span>}
                    {v.imovel.horario_visitas && <span className="block text-xs text-mudo">Visitas: {v.imovel.horario_visitas}</span>}
                  </dd>
                </div>
              )}
              {v.modalidade === "virtual" && v.link_virtual && (
                <div className="flex justify-between gap-2">
                  <dt className="text-mudo">Chamada</dt>
                  <dd>
                    <a href={v.link_virtual} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-acento hover:underline">
                      <Video className="size-3.5" /> entrar
                    </a>
                  </dd>
                </div>
              )}
            </dl>
            <Formulario acao={atualizarCompromisso} automatico className="space-y-4">
              <input type="hidden" name="id" value={v.id} />
              <input type="hidden" name="_privada" value="1" />
              <Campo rotulo="Título">
                <Entrada name="titulo" defaultValue={v.titulo ?? ""} placeholder={titulo} />
              </Campo>
              <div className="grid grid-cols-2 gap-3">
                <Campo rotulo="Tipo">
                  <Selecao name="tipo" defaultValue={v.tipo}>
                    {tipos.map((t) => (
                      <option key={t} value={t}>
                        {ROTULO_TIPO_COMPROMISSO[t]}
                      </option>
                    ))}
                  </Selecao>
                </Campo>
                <Campo rotulo="Duração (min)">
                  <Entrada name="duracao_min" type="number" min={5} max={1440} step={5} defaultValue={v.duracao_min} />
                </Campo>
                <Campo rotulo="Como">
                  <Selecao name="modalidade" defaultValue={v.modalidade}>
                    <option value="presencial">Presencial</option>
                    <option value="virtual">Virtual</option>
                  </Selecao>
                </Campo>
                <Campo rotulo="Lembrete">
                  <Selecao name="lembrete_min" defaultValue={String(v.lembrete_min)}>
                    {OPCOES_LEMBRETE.map(([x, r]) => (
                      <option key={x} value={x}>
                        {r}
                      </option>
                    ))}
                  </Selecao>
                </Campo>
              </div>
              <Campo rotulo="Link da chamada">
                <Entrada name="link_virtual" type="url" defaultValue={v.link_virtual ?? ""} />
              </Campo>
              <Campo rotulo="Imóvel">
                <Selecao name="imovel_id" defaultValue={v.imovel_id ?? ""}>
                  <option value="">— nenhum —</option>
                  {opcoes.imoveis.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.codigo}
                    </option>
                  ))}
                </Selecao>
              </Campo>
              {!pessoal && (
                <Campo rotulo="Corretor">
                  <Selecao name="corretor_id" defaultValue={v.corretor_id ?? ""}>
                    <option value="">— nenhum —</option>
                    {opcoes.corretores.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nome}
                      </option>
                    ))}
                  </Selecao>
                </Campo>
              )}
              <Campo rotulo="Observações">
                <AreaTexto name="observacoes" rows={2} defaultValue={v.observacoes ?? ""} />
              </Campo>
              <label className="flex items-center gap-2 text-sm text-texto-2">
                <input type="checkbox" name="privada" defaultChecked={!v.compartilhada} /> Só na minha agenda
              </label>
            </Formulario>
          </Cartao>

          <Cartao
            titulo={`Participantes (${participantes?.length ?? 0})`}
            acoes={
              <JanelaCadastro rotuloBotao={<><UserPlus className="size-3.5" /> Adicionar</>} variante="fantasma" tamanho="sm" titulo="Participante" acao={adicionarParticipante} rotuloSalvar="Adicionar" icone={<UserPlus />}>
                <input type="hidden" name="visita_id" value={v.id} />
                <Campo rotulo="Pessoa cadastrada">
                  <Selecao name="pessoa_id" defaultValue="">
                    <option value="">— escolher —</option>
                    {opcoes.pessoas.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.nome}
                      </option>
                    ))}
                  </Selecao>
                </Campo>
                <Campo rotulo="Ou nome">
                  <Entrada name="nome" placeholder="Acompanhante, vistoriador…" />
                </Campo>
                <Campo rotulo="Papel">
                  <Entrada name="papel" placeholder="Cônjuge, vistoriador, síndico…" />
                </Campo>
              </JanelaCadastro>
            }
          >
            <ul className="space-y-2 text-sm">
              {((participantes ?? []) as unknown as Part[]).map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2">
                  <span>
                    {p.pessoa ? (
                      <Link href={`/pessoas/${p.pessoa.id}`} className="font-medium text-texto hover:underline">
                        {p.pessoa.nome}
                      </Link>
                    ) : (
                      <span className="font-medium text-texto">{p.nome}</span>
                    )}
                    {p.papel && <span className="text-mudo"> · {p.papel}</span>}
                  </span>
                  <BotaoExcluir acao={excluirParticipante} id={p.id} rotulo="Tirar participante" confirmar="Tirar este participante?" />
                </li>
              ))}
              {!participantes?.length && <li className="text-mudo">Só o responsável e o cliente.</li>}
            </ul>
          </Cartao>

          {v.imovel_id && (
            <Cartao titulo="Chaves do imóvel" acoes={<Link href="/chaves" className="text-xs text-acento hover:underline">ver todas</Link>}>
              <ul className="space-y-2.5 text-sm">
                {((chaves ?? []) as Ch[]).map((c) => {
                  const aberta = c.chave_movimentacoes.find((m) => !m.devolvida_em);
                  return (
                    <li key={c.id} className="flex items-center justify-between gap-2">
                      <span className="min-w-0">
                        <span className="font-medium text-texto">{c.codigo} · {c.identificacao}</span>
                        <span className="block text-xs text-mudo">{aberta ? `com ${aberta.retirada_por}` : (c.local ?? "disponível")}</span>
                      </span>
                      {!aberta && (
                        <BotaoLink href={`/chaves?retirar=${c.id}&visita=${v.id}`} variante="secundario">
                          <KeyRound className="size-4" /> Retirar
                        </BotaoLink>
                      )}
                    </li>
                  );
                })}
                {!chaves?.length && <li className="text-mudo">Nenhuma chave cadastrada para este imóvel.</li>}
              </ul>
            </Cartao>
          )}
        </div>
      </div>
    </>
  );
}
