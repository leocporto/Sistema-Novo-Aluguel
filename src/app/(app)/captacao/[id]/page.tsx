import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import {
  CalendarDays,
  CalendarPlus,
  Calculator,
  Flag,
  Handshake,
  Home,
  Mail,
  MessageCircle,
  MessageSquarePlus,
  Phone,
  Plus,
  Printer,
  StickyNote,
  UserPlus,
  Users,
  XCircle,
} from "lucide-react";
import { BarraProgresso } from "@/components/barra-progresso";
import { BotaoExcluir } from "@/components/botao-excluir";
import { BotaoEnviar, Formulario } from "@/components/formulario";
import { JanelaCadastro } from "@/components/janela-cadastro";
import { AreaTexto, BotaoLink, Campo, Cartao, Entrada, Selecao, Selo, classeBotao } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import {
  CHECKLIST_CAPTACAO,
  ETAPAS_CAPTACAO,
  MOTIVOS_NAO_CAPTADO,
  ORIGENS_CAPTACAO,
  ROTULO_ETAPA_CAPTACAO,
  avaliacaoMercado,
  ordemEtapaCaptacao,
  progressoChecklist,
  sugerirCodigo,
  type Amostra,
} from "@/lib/dominio/captacao";
import { formatarDataBR, hojeISO } from "@/lib/dominio/datas";
import { formatarReais } from "@/lib/dominio/dinheiro";
import { linkWhatsapp } from "@/lib/whatsapp";
import {
  adicionarComparativo,
  agendarAvaliacao,
  atualizarCaptacao,
  converterCaptacao,
  excluirAvaliacao,
  excluirCaptacao,
  excluirComparativo,
  excluirEventoCaptacao,
  mudarStatusAvaliacao,
  registrarContatoCaptacao,
  salvarChecklist,
  usarValorSugerido,
} from "../actions";
import { AbasCaptacao, CamposImovelPreliminar, CamposProprietario, chip, enderecoCaptacao, type Captacao } from "../campos";
import { carregarCorretores } from "../dados";

export const metadata: Metadata = { title: "Captação" };

const dataHora = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });

const ICONE: Record<string, ReactNode> = {
  entrada: <UserPlus />,
  ligacao: <Phone />,
  whatsapp: <MessageCircle />,
  email: <Mail />,
  reuniao: <Users />,
  nota: <StickyNote />,
  etapa: <Flag />,
  negociacao: <Handshake />,
  proposta: <Handshake />,
  perda: <XCircle />,
  conversao: <Home />,
};
const ROTULO: Record<string, string> = {
  entrada: "Entrada",
  ligacao: "Ligação",
  whatsapp: "WhatsApp",
  email: "E-mail",
  reuniao: "Reunião / visita",
  nota: "Anotação",
  etapa: "Mudou de etapa",
  negociacao: "Negociação",
  proposta: "Proposta",
  perda: "Não captado",
  conversao: "Virou imóvel",
};
const ROTULO_STATUS_AVALIACAO: Record<string, string> = { agendada: "Agendada", realizada: "Realizada", cancelada: "Cancelada" };

export default async function CaptacaoFicha({ params, searchParams }: PageProps<"/captacao/[id]">) {
  const { id } = await params;
  const sp = await searchParams;
  const { supabase, organizacao } = await obterContexto();
  const hoje = hojeISO();
  const [{ data }, corretores, { data: eventos }, { data: comparativos }, { data: avaliacoes }, { data: cadastro }] = await Promise.all([
    supabase.from("captacoes").select("*, corretor:pessoas!captacoes_corretor_id_fkey(id, nome), imovel:imoveis(id, codigo)").eq("id", id).maybeSingle(),
    carregarCorretores(supabase),
    supabase.from("captacao_eventos").select("id, tipo, descricao, data").eq("captacao_id", id).order("data", { ascending: false }).limit(300),
    supabase.from("captacao_comparativos").select("*").eq("captacao_id", id).order("created_at"),
    supabase.from("visitas").select("id, data_hora, status, observacoes, corretor:pessoas(nome)").eq("captacao_id", id).order("data_hora", { ascending: false }),
    supabase.from("imoveis").select("codigo, tipo, bairro, cidade, area_util, quartos, valor_aluguel, valor_venda"),
  ]);
  if (!data) notFound();
  const c = data as unknown as Captacao & { corretor: { id: string; nome: string } | null; imovel: { id: string; codigo: string } | null };
  const captado = c.status === "captado" || !!c.imovel_id;
  const ordem = ordemEtapaCaptacao(c.status);
  const docs = progressoChecklist(c.checklist);

  type Comp = { id: string; descricao: string; valor: number; area: number | null; finalidade: "locacao" | "venda"; fonte: string | null };
  const comps = (comparativos ?? []) as Comp[];
  type Cad = { codigo: string; tipo: string; bairro: string | null; cidade: string | null; area_util: number | null; quartos: number | null; valor_aluguel: number | null; valor_venda: number | null };
  const cad = ((cadastro ?? []) as Cad[]).map((i) => ({ ...i, area: i.area_util == null ? null : Number(i.area_util) }));
  const manuais: Amostra[] = comps.map((x) => ({ descricao: x.descricao, valor: Number(x.valor), area: x.area == null ? null : Number(x.area), finalidade: x.finalidade, fonte: x.fonte ?? "" }));
  const aval = avaliacaoMercado({ tipo: c.tipo, bairro: c.bairro, cidade: c.cidade, area: c.area == null ? null : Number(c.area), quartos: c.quartos }, cad, manuais);
  const doCadastro = aval.amostras.filter((a) => a.fonte === "Cadastro");
  const quer = (f: "locacao" | "venda") => c.finalidades.includes(f);

  type Av = { id: string; data_hora: string; status: string; observacoes: string | null; corretor: { nome: string } | null };
  type Item = { data: string; icone: ReactNode; titulo: string; detalhe?: string | null; eventoId?: string };
  const linha: Item[] = (eventos ?? []).map((e) => ({ data: e.data, icone: ICONE[e.tipo] ?? <StickyNote />, titulo: ROTULO[e.tipo] ?? e.tipo, detalhe: e.descricao, eventoId: e.id }));
  const codigoSugerido = sugerirCodigo(cad.map((i) => i.codigo), c.tipo);
  const taxaAdm = c.proposta_taxa_adm ?? Number(organizacao.taxa_administracao_pct ?? 0);
  const taxaInt = c.proposta_taxa_intermediacao ?? Number(organizacao.taxa_intermediacao_pct ?? 0);
  const v = (n: unknown) => (n === null || n === undefined ? "" : String(n));

  return (
    <>
      <div className="mb-[clamp(14px,1.5vw,18px)] flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[13px] text-mudo">
            <span>Novo Aluguel</span>
            <span className="text-fraco">›</span>
            <Link href="/captacao" className="text-acento-hot hover:underline">
              Captação
            </Link>
            <span className="text-fraco">›</span>
            <span>#{c.numero}</span>
          </div>
          <h1 className="mt-1.5 text-[clamp(28px,3vw,38px)] font-semibold leading-[1.05] tracking-[-0.025em] text-texto">{c.proprietario_nome}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[13.5px] text-texto-2">
            <Selo cor={captado ? "verde" : c.status === "nao_captado" ? "vermelho" : "azul"}>{ROTULO_ETAPA_CAPTACAO[c.status]}</Selo>
            {c.exclusivo && <Selo cor="azul">exclusivo</Selo>}
            <span className="capitalize">{[c.tipo, enderecoCaptacao(c)].filter(Boolean).join(" · ")}</span>
            <span>· {ORIGENS_CAPTACAO[c.origem] ?? c.origem}</span>
          </div>
        </div>
        <div className="nao-imprimir flex flex-wrap items-center gap-2">
          {c.proprietario_telefone && (
            <a href={linkWhatsapp(c.proprietario_telefone, `Olá ${c.proprietario_nome.split(" ")[0]}! Tudo bem?`)} target="_blank" rel="noreferrer" className={classeBotao("secundario")}>
              <MessageCircle className="size-4" /> WhatsApp
            </a>
          )}
          {!captado && (
            <JanelaCadastro rotuloBotao={<><CalendarPlus className="size-4" /> Agendar avaliação</>} variante="secundario" titulo="Visita de avaliação" acao={agendarAvaliacao} rotuloSalvar="Agendar" icone={<CalendarPlus />}>
              <input type="hidden" name="captacao_id" value={c.id} />
              <div className="grid gap-4 sm:grid-cols-2">
                <Campo rotulo="Data">
                  <Entrada type="date" name="data" required defaultValue={hoje} min={hoje} />
                </Campo>
                <Campo rotulo="Hora">
                  <Entrada type="time" name="hora" required defaultValue="10:00" />
                </Campo>
              </div>
              <Campo rotulo="Corretor">
                <Selecao name="corretor_id" defaultValue={c.corretor_id ?? ""}>
                  <option value="">— nenhum —</option>
                  {corretores.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.nome}
                    </option>
                  ))}
                </Selecao>
              </Campo>
              <Campo rotulo="Observações">
                <AreaTexto name="observacoes" rows={2} placeholder="Levar trena, falar com o porteiro…" />
              </Campo>
            </JanelaCadastro>
          )}
          <BotaoLink href={`/captacao/${c.id}/proposta`} variante="secundario">
            <Printer className="size-4" /> Proposta
          </BotaoLink>
          {captado && c.imovel ? (
            <BotaoLink href={`/imoveis/${c.imovel.id}`}>
              <Home className="size-4" /> Abrir imóvel {c.imovel.codigo}
            </BotaoLink>
          ) : (
            <JanelaCadastro
              rotuloBotao={<><Home className="size-4" /> Converter em imóvel</>}
              titulo="Converter em imóvel ativo"
              acao={converterCaptacao}
              rotuloSalvar="Criar imóvel"
              icone={<Home />}
              abertaInicial={sp.converter === "1"}
            >
              <input type="hidden" name="id" value={c.id} />
              <p className="text-sm text-texto-2">
                O imóvel entra na carteira como <strong>disponível</strong>, com {c.proprietario_id ? "o proprietário já cadastrado" : `${c.proprietario_nome} cadastrado(a) em Pessoas como proprietário(a)`} (100%), os dados preliminares, a
                avaliação, a exclusividade e o corretor captador.
              </p>
              <Campo rotulo="Código do novo imóvel">
                <Entrada name="codigo" required defaultValue={codigoSugerido} className="uppercase" />
              </Campo>
              <ul className="space-y-1 rounded-[12px] border border-borda-suave bg-elev p-3 text-sm text-texto-2">
                <li>Aluguel: {formatarReais(c.valor_avaliado_aluguel ?? (quer("locacao") ? c.valor_pretendido : null))}</li>
                <li>Venda: {formatarReais(c.valor_avaliado_venda ?? (quer("venda") ? c.valor_pretendido : null))}</li>
                <li>
                  Documentos: {docs.feitos} de {docs.total}
                  {docs.feitos < docs.total && <span className="text-alerta"> — dá para completar depois</span>}
                </li>
              </ul>
            </JanelaCadastro>
          )}
          <BotaoExcluir acao={excluirCaptacao} id={c.id} variante="botao" rotulo="Excluir" confirmar="Excluir esta captação? (se já virou imóvel, o imóvel continua)" depois="/captacao" />
        </div>
      </div>
      <AbasCaptacao />

      {/* Etapas */}
      <ol className="entrar-cascata mb-6 grid grid-cols-3 gap-2 sm:grid-cols-6">
        {ETAPAS_CAPTACAO.map((e, i) => {
          const feito = captado || (c.status !== "nao_captado" && i <= ordem) || (c.status === "nao_captado" && i <= c.etapa_max);
          const atual = e === c.status;
          return (
            <li
              key={e}
              className={`rounded-[12px] border px-3 py-2 text-[13px] font-medium transition ${
                atual ? "border-acento bg-acento-bg text-acento-hot" : feito ? "border-ok-bd bg-ok-bg text-ok" : "border-borda bg-card text-mudo"
              }`}
            >
              <span className="mr-1.5 font-mono text-[11px] opacity-70">{i + 1}</span>
              {ROTULO_ETAPA_CAPTACAO[e]}
            </li>
          );
        })}
      </ol>
      {c.status === "nao_captado" && (
        <div className="mb-6 rounded-[14px] border border-ruim-bd bg-ruim-bg px-4 py-3 text-sm text-ruim">
          Não captado em {formatarDataBR(c.nao_captado_em?.slice(0, 10))}: {c.motivo_nao_captado ?? "—"}. Para retomar, mude a etapa em “Situação”.
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <Cartao
            titulo={`Histórico de contatos e negociação (${linha.length})`}
            acoes={
              <JanelaCadastro rotuloBotao={<><MessageSquarePlus className="size-3.5" /> Registrar contato</>} tamanho="sm" titulo="Registrar contato" acao={registrarContatoCaptacao} rotuloSalvar="Salvar" icone={<MessageSquarePlus />}>
                <input type="hidden" name="captacao_id" value={c.id} />
                <Campo rotulo="Tipo">
                  <Selecao name="tipo" defaultValue="whatsapp">
                    <option value="whatsapp">WhatsApp</option>
                    <option value="ligacao">Ligação</option>
                    <option value="email">E-mail</option>
                    <option value="reuniao">Reunião / visita</option>
                    <option value="negociacao">Negociação (valores, taxa, condições)</option>
                    <option value="nota">Anotação interna</option>
                  </Selecao>
                </Campo>
                <Campo rotulo="O que foi conversado">
                  <AreaTexto name="descricao" rows={4} required />
                </Campo>
              </JanelaCadastro>
            }
          >
            {linha.length === 0 ? (
              <p className="text-sm text-mudo">Nada registrado ainda.</p>
            ) : (
              <ol className="relative max-h-[440px] space-y-3.5 overflow-y-auto pr-1 before:absolute before:bottom-2 before:left-[15px] before:top-2 before:w-px before:bg-borda">
                {linha.map((e, i) => (
                  <li key={i} className="relative flex gap-3">
                    <span className="relative z-10 grid size-8 shrink-0 place-items-center rounded-full border border-borda bg-card text-texto-2 [&>svg]:size-4">{e.icone}</span>
                    <div className="min-w-0 flex-1 pt-1">
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-sm font-medium text-texto">{e.titulo}</span>
                        <span className="flex shrink-0 items-center gap-2 text-xs text-mudo">
                          {dataHora(e.data)}
                          {e.eventoId && <BotaoExcluir acao={excluirEventoCaptacao} id={e.eventoId} rotulo="Excluir registro" confirmar="Excluir este registro do histórico?" />}
                        </span>
                      </div>
                      {e.detalhe && <p className="mt-0.5 whitespace-pre-line text-[13px] text-texto-2">{e.detalhe}</p>}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Cartao>

          <Cartao
            titulo="Avaliação de mercado"
            acoes={
              <JanelaCadastro rotuloBotao={<><Plus className="size-3.5" /> Comparativo</>} variante="secundario" tamanho="sm" titulo="Imóvel comparável" acao={adicionarComparativo} rotuloSalvar="Adicionar" icone={<Calculator />}>
                <input type="hidden" name="captacao_id" value={c.id} />
                <Campo rotulo="Descrição" dica="Endereço, prédio ou link do anúncio">
                  <Entrada name="descricao" required />
                </Campo>
                <div className="grid gap-4 sm:grid-cols-3">
                  <Campo rotulo="Para">
                    <Selecao name="finalidade" defaultValue={quer("locacao") ? "locacao" : "venda"}>
                      <option value="locacao">Aluguel</option>
                      <option value="venda">Venda</option>
                    </Selecao>
                  </Campo>
                  <Campo rotulo="Valor (R$)">
                    <Entrada name="valor" inputMode="decimal" required />
                  </Campo>
                  <Campo rotulo="Área (m²)">
                    <Entrada name="area" inputMode="decimal" />
                  </Campo>
                </div>
                <Campo rotulo="Fonte">
                  <Entrada name="fonte" placeholder="ZAP, Viva Real, OLX, placa…" />
                </Campo>
              </JanelaCadastro>
            }
          >
            <div className="grid gap-4 sm:grid-cols-2">
              {(["locacao", "venda"] as const)
                .filter((fin) => quer(fin) || aval[fin].amostras > 0)
                .map((fin) => {
                  const r = aval[fin];
                  return (
                    <div key={fin} className="rounded-[14px] border border-borda-suave bg-elev p-4">
                      <div className="text-[13px] font-medium text-texto-2">{fin === "locacao" ? "Aluguel sugerido" : "Venda sugerida"}</div>
                      <div className="mt-1 text-[26px] font-semibold tabular-nums tracking-[-0.02em] text-texto">{r.sugerido ? formatarReais(r.sugerido) : "—"}</div>
                      <div className="mt-1 text-xs text-mudo">
                        {r.amostras ? `${r.amostras} amostra(s)` : "sem amostras"}
                        {r.precoM2 ? ` · ${formatarReais(r.precoM2)}/m²` : ""}
                        {r.minimo !== null && r.maximo !== null && r.amostras > 1 ? ` · de ${formatarReais(r.minimo)} a ${formatarReais(r.maximo)}` : ""}
                      </div>
                      {r.sugerido && !captado ? (
                        <form action={usarValorSugerido} className="mt-3">
                          <input type="hidden" name="id" value={c.id} />
                          <input type="hidden" name="campo" value={fin} />
                          <input type="hidden" name="valor" value={r.sugerido} />
                          <BotaoEnviar variante="secundario">Usar este valor</BotaoEnviar>
                        </form>
                      ) : null}
                    </div>
                  );
                })}
            </div>
            {!c.area && <p className="mt-3 text-xs text-alerta">Preencha a área do imóvel para a sugestão usar o valor por m².</p>}
            <h4 className="mb-2 mt-5 text-sm font-semibold text-texto">Comparativos ({comps.length + doCadastro.length})</h4>
            <ul className="divide-y divide-borda-suave text-sm">
              {comps.map((x) => (
                <li key={x.id} className="flex items-center justify-between gap-2 py-2">
                  <span className="min-w-0">
                    <span className="block truncate text-texto">{x.descricao}</span>
                    <span className="text-xs text-mudo">
                      {x.finalidade === "venda" ? "Venda" : "Aluguel"}
                      {x.area ? ` · ${Number(x.area)} m² · ${formatarReais(Number(x.valor) / Number(x.area))}/m²` : ""}
                      {x.fonte ? ` · ${x.fonte}` : ""}
                    </span>
                  </span>
                  <span className="flex items-center gap-2 tabular-nums">
                    {formatarReais(x.valor)}
                    <BotaoExcluir acao={excluirComparativo} id={x.id} rotulo="Excluir comparativo" confirmar="Excluir este comparativo?" />
                  </span>
                </li>
              ))}
              {doCadastro.map((x, i) => (
                <li key={`cad${i}`} className="flex items-center justify-between gap-2 py-2">
                  <span className="min-w-0">
                    <span className="block truncate text-texto">{x.descricao}</span>
                    <span className="text-xs text-mudo">
                      {x.finalidade === "venda" ? "Venda" : "Aluguel"} · da sua carteira{x.area ? ` · ${Number(x.area)} m²` : ""}
                    </span>
                  </span>
                  <span className="tabular-nums text-texto-2">{formatarReais(x.valor)}</span>
                </li>
              ))}
              {comps.length + doCadastro.length === 0 && (
                <li className="py-2 text-mudo">Nenhum comparativo. Adicione anúncios parecidos da região — imóveis da sua carteira do mesmo tipo e bairro entram sozinhos.</li>
              )}
            </ul>
            <Formulario acao={atualizarCaptacao} automatico className="mt-5 space-y-4">
              <input type="hidden" name="id" value={c.id} />
              <div className="grid gap-4 sm:grid-cols-3">
                <Campo rotulo="Valor avaliado — aluguel (R$)">
                  <Entrada name="valor_avaliado_aluguel" inputMode="decimal" defaultValue={v(c.valor_avaliado_aluguel)} />
                </Campo>
                <Campo rotulo="Valor avaliado — venda (R$)">
                  <Entrada name="valor_avaliado_venda" inputMode="decimal" defaultValue={v(c.valor_avaliado_venda)} />
                </Campo>
                <Campo rotulo="Avaliado em">
                  <Entrada type="date" name="avaliado_em" defaultValue={c.avaliado_em ?? ""} />
                </Campo>
              </div>
              <Campo rotulo="Notas da avaliação">
                <AreaTexto name="avaliacao_notas" rows={2} defaultValue={c.avaliacao_notas ?? ""} placeholder="Estado de conservação, reformas, vista, barulho…" />
              </Campo>
            </Formulario>
          </Cartao>

          <Cartao titulo="Proposta de administração / intermediação" acoes={<Link href={`/captacao/${c.id}/proposta`} className="text-xs text-acento hover:underline">imprimir</Link>}>
            <Formulario acao={atualizarCaptacao} automatico className="space-y-4">
              <input type="hidden" name="id" value={c.id} />
              <div className="grid gap-4 sm:grid-cols-2">
                <Campo rotulo="Serviço">
                  <Selecao name="proposta_tipo" defaultValue={c.proposta_tipo}>
                    <option value="administracao">Administração da locação</option>
                    <option value="intermediacao">Só intermediação (achar inquilino/comprador)</option>
                    <option value="ambos">Intermediação + administração</option>
                  </Selecao>
                </Campo>
                <Campo rotulo="Situação da proposta">
                  <Selecao name="proposta_status" defaultValue={c.proposta_status}>
                    <option value="rascunho">Rascunho</option>
                    <option value="enviada">Enviada</option>
                    <option value="aceita">Aceita</option>
                    <option value="recusada">Recusada</option>
                  </Selecao>
                </Campo>
              </div>
              <div className="grid gap-4 sm:grid-cols-4">
                <Campo rotulo="Taxa de adm. (%)">
                  <Entrada name="proposta_taxa_adm" inputMode="decimal" defaultValue={v(taxaAdm)} />
                </Campo>
                <Campo rotulo="Intermediação (%)" dica="sobre o 1º aluguel">
                  <Entrada name="proposta_taxa_intermediacao" inputMode="decimal" defaultValue={v(taxaInt)} />
                </Campo>
                <Campo rotulo="Comissão de venda (%)">
                  <Entrada name="proposta_comissao_venda" inputMode="decimal" defaultValue={v(c.proposta_comissao_venda ?? (quer("venda") ? 6 : ""))} />
                </Campo>
                <Campo rotulo="Enviada em">
                  <Entrada type="date" name="proposta_enviada_em" defaultValue={c.proposta_enviada_em ?? ""} />
                </Campo>
              </div>
              <Campo rotulo="Condições / observações da proposta">
                <AreaTexto name="proposta_texto" rows={3} defaultValue={c.proposta_texto ?? ""} placeholder="Garantia de aluguel, fotos profissionais, anúncio nos portais…" />
              </Campo>
            </Formulario>
          </Cartao>

          <Formulario acao={atualizarCaptacao} automatico>
            <input type="hidden" name="id" value={c.id} />
            <Cartao titulo="Proprietário e imóvel (cadastro preliminar)">
              <div className="space-y-4">
                <CamposProprietario c={c} corretores={corretores} />
                <CamposImovelPreliminar c={c} />
              </div>
            </Cartao>
          </Formulario>
        </div>

        <div className="space-y-6">
          <Cartao titulo="Situação">
            {captado ? (
              <p className="text-sm text-texto-2">
                Captado em {formatarDataBR(c.captado_em)}.{" "}
                {c.imovel && (
                  <Link href={`/imoveis/${c.imovel.id}`} className="text-acento hover:underline">
                    Ver imóvel {c.imovel.codigo}
                  </Link>
                )}
              </p>
            ) : (
              <Formulario acao={atualizarCaptacao} automatico className="space-y-4">
                <input type="hidden" name="id" value={c.id} />
                <Campo rotulo="Etapa">
                  <Selecao name="status" defaultValue={c.status}>
                    {ETAPAS_CAPTACAO.filter((e) => e !== "captado").map((e) => (
                      <option key={e} value={e}>
                        {ROTULO_ETAPA_CAPTACAO[e]}
                      </option>
                    ))}
                    <option value="nao_captado">Não captado</option>
                  </Selecao>
                </Campo>
                <Campo rotulo="Motivo (se não captado)">
                  <Selecao name="motivo_nao_captado" defaultValue={c.motivo_nao_captado ?? MOTIVOS_NAO_CAPTADO[0]}>
                    {MOTIVOS_NAO_CAPTADO.map((m) => (
                      <option key={m}>{m}</option>
                    ))}
                  </Selecao>
                </Campo>
              </Formulario>
            )}
            <dl className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between gap-2">
                <dt className="text-mudo">Corretor captador</dt>
                <dd className="font-medium text-texto">
                  {c.corretor ? (
                    <Link href={`/pessoas/${c.corretor.id}`} className="hover:underline">
                      {c.corretor.nome}
                    </Link>
                  ) : (
                    "—"
                  )}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-mudo">Entrou em</dt>
                <dd className="text-texto">{dataHora(c.created_at)}</dd>
              </div>
              {c.lead_id && (
                <div className="flex justify-between gap-2">
                  <dt className="text-mudo">Veio do lead</dt>
                  <dd>
                    <Link href={`/comercial/leads/${c.lead_id}`} className="text-acento hover:underline">
                      abrir
                    </Link>
                  </dd>
                </div>
              )}
            </dl>
          </Cartao>

          <Cartao titulo={`Documentos (${docs.feitos}/${docs.total})`}>
            <BarraProgresso pct={docs.pct} atingida={docs.feitos === docs.total} />
            <Formulario acao={salvarChecklist} automatico className="mt-4 space-y-1.5">
              <input type="hidden" name="id" value={c.id} />
              {CHECKLIST_CAPTACAO.map((d) => (
                <label key={d.id} className="flex cursor-pointer items-start gap-2.5 rounded-[10px] px-2 py-1.5 text-sm text-texto-2 transition hover:bg-elev has-[:checked]:text-texto">
                  <input type="checkbox" name="doc" value={d.id} defaultChecked={!!c.checklist?.[d.id]} className="mt-0.5 size-4 accent-[var(--accent)]" />
                  {d.rotulo}
                </label>
              ))}
            </Formulario>
          </Cartao>

          <Cartao titulo="Exclusividade, anúncio e fotos">
            <Formulario acao={atualizarCaptacao} automatico className="space-y-4">
              <input type="hidden" name="id" value={c.id} />
              <input type="hidden" name="_exclusivo" value="1" />
              <input type="hidden" name="_autorizacao" value="1" />
              <label className={`${chip} w-fit normal-case`}>
                <input type="checkbox" name="exclusivo" defaultChecked={c.exclusivo} className="sr-only" />
                Contrato de exclusividade
              </label>
              <div className="grid grid-cols-2 gap-3">
                <Campo rotulo="Exclusividade de">
                  <Entrada type="date" name="exclusividade_inicio" defaultValue={c.exclusividade_inicio ?? ""} />
                </Campo>
                <Campo rotulo="até">
                  <Entrada type="date" name="exclusividade_fim" defaultValue={c.exclusividade_fim ?? ""} />
                </Campo>
              </div>
              <label className={`${chip} w-fit normal-case`}>
                <input type="checkbox" name="autorizacao_anuncio" defaultChecked={c.autorizacao_anuncio} className="sr-only" />
                Autorização de anúncio assinada
              </label>
              <div className="grid grid-cols-2 gap-3">
                <Campo rotulo="Assinada em">
                  <Entrada type="date" name="autorizacao_data" defaultValue={c.autorizacao_data ?? ""} />
                </Campo>
                <Campo rotulo="Válida até">
                  <Entrada type="date" name="autorizacao_validade" defaultValue={c.autorizacao_validade ?? ""} />
                </Campo>
              </div>
              <Campo rotulo="Fotos e tratamento de imagens">
                <Selecao name="fotos_status" defaultValue={c.fotos_status}>
                  <option value="pendente">Fotos pendentes</option>
                  <option value="agendadas">Sessão de fotos agendada</option>
                  <option value="feitas">Fotos feitas (falta tratar)</option>
                  <option value="tratadas">Fotos tratadas — prontas para anunciar</option>
                </Selecao>
              </Campo>
            </Formulario>
            {c.exclusivo && c.exclusividade_fim && c.exclusividade_fim < hoje && <p className="mt-3 text-xs text-ruim">A exclusividade venceu em {formatarDataBR(c.exclusividade_fim)}.</p>}
          </Cartao>

          <Cartao titulo="Visitas de avaliação">
            <ul className="space-y-2.5 text-sm">
              {((avaliacoes ?? []) as unknown as Av[]).map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-2">
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5 text-texto">
                      <CalendarDays className="size-3.5 text-mudo" /> {dataHora(a.data_hora)}
                    </span>
                    {(a.corretor || a.observacoes) && <span className="block truncate text-xs text-mudo">{[a.corretor?.nome, a.observacoes].filter(Boolean).join(" · ")}</span>}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <form action={mudarStatusAvaliacao}>
                      <input type="hidden" name="id" value={a.id} />
                      <Selo cor={a.status === "realizada" ? "verde" : a.status === "cancelada" ? "cinza" : "azul"}>{ROTULO_STATUS_AVALIACAO[a.status]}</Selo>
                      {a.status === "agendada" && (
                        <button name="status" value="realizada" className={`ml-1.5 ${classeBotao("fantasma", "sm")}`}>
                          Marcar feita
                        </button>
                      )}
                    </form>
                    <BotaoExcluir acao={excluirAvaliacao} id={a.id} rotulo="Excluir visita" confirmar="Excluir esta visita de avaliação?" />
                  </span>
                </li>
              ))}
              {!avaliacoes?.length && <li className="text-mudo">Nenhuma visita de avaliação.</li>}
            </ul>
          </Cartao>
        </div>
      </div>
    </>
  );
}
