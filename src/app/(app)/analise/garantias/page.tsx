import type { Metadata } from "next";
import Link from "next/link";
import { CalendarCheck2, CalendarClock, CalendarX2, Mail, MessageCircle, RefreshCw, Send, ShieldAlert } from "lucide-react";
import { Contador } from "@/components/abas-segmentadas";
import { BotaoAcao } from "@/components/botao-acao";
import { BotaoExcluir } from "@/components/botao-excluir";
import { Copiar } from "@/components/copiar";
import { FiltroAutomatico } from "@/components/filtro-automatico";
import { JanelaCadastro } from "@/components/janela-cadastro";
import { PilulasLink } from "@/components/pilulas-link";
import { AreaTexto, Cabecalho, Campo, Celula, Entrada, Indicador, LinhaVazia, Selecao, Selo, Tabela, classeBotao } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import {
  CANAIS_RENOVACAO,
  COR_FAIXA,
  DESTINATARIOS_RENOVACAO,
  ROTULO_FAIXA,
  ROTULO_STATUS_RENOVACAO,
  diasParaVencer,
  faixaVencimento,
  mensagemRenovacao,
  type FaixaVencimento,
} from "@/lib/dominio/analise";
import { formatarDataBR, hojeISO } from "@/lib/dominio/datas";
import { formatarReais } from "@/lib/dominio/dinheiro";
import { ROTULO_TIPO_GARANTIA } from "@/lib/dominio/garantias";
import { normalizar } from "@/lib/dominio/imoveis";
import { linkWhatsapp } from "@/lib/whatsapp";
import { todas } from "../../financeiro/dados";
import { AbasAnalise } from "../abas";
import { cancelarRenovacao, concluirRenovacao, excluirRenovacao, recusarRenovacao, solicitarRenovacao } from "../actions";

export const metadata: Metadata = { title: "Vencimentos e renovações" };

type Parte = { papel: string; pessoa: { nome: string; telefone: string | null } | null };
type ContratoMin = { id: string; numero: number; status: string; imovel: { codigo: string } | null; contrato_partes: Parte[] };
type Item = {
  chave: string;
  objeto: "garantia" | "seguro_incendio";
  garantiaId: string | null;
  contrato: ContratoMin;
  tipo: string;
  instituicao: string | null;
  numero: string | null;
  valor: number | null;
  fim: string | null;
  fiador: string | null;
};
type Renovacao = {
  id: string;
  objeto: string;
  contrato_id: string;
  contrato_garantia_id: string | null;
  status: string;
  solicitada_em: string;
  canal: string;
  destinatario: string;
  destinatario_nome: string | null;
  fim_anterior: string | null;
  nova_fim: string | null;
  novo_numero: string | null;
  concluida_em: string | null;
  observacoes: string | null;
  contrato: { numero: number; imovel: { codigo: string } | null } | null;
};

const FILTROS: Record<string, string> = {
  "": "Vencidas e até 90 dias",
  vencida: "Vencidas",
  "30": "Até 30 dias",
  "60": "31 a 60 dias",
  "90": "61 a 90 dias",
  ativas: "Todas as ativas",
  renovacoes: "Pedidos de renovação",
};

const SELECT_CONTRATO = "id, numero, status, imovel:imoveis(codigo), contrato_partes(papel, pessoa:pessoas(nome, telefone))";

function CamposConclusao({ item, renovacaoId }: { item: { objeto: string; contratoId: string; garantiaId: string | null; numero: string | null }; renovacaoId?: string }) {
  return (
    <>
      {renovacaoId && <input type="hidden" name="renovacao_id" value={renovacaoId} />}
      <input type="hidden" name="objeto" value={item.objeto} />
      <input type="hidden" name="contrato_id" value={item.contratoId} />
      {item.garantiaId && <input type="hidden" name="contrato_garantia_id" value={item.garantiaId} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo rotulo="Novo vencimento">
          <Entrada type="date" name="nova_fim" required />
        </Campo>
        <Campo rotulo="Nº da nova apólice / documento">
          <Entrada name="numero" defaultValue={item.numero ?? ""} />
        </Campo>
        <Campo rotulo="Novo valor / cobertura (R$)" dica="Em branco: mantém o atual.">
          <Entrada name="valor" inputMode="decimal" />
        </Campo>
        <Campo rotulo="Prêmio pago (R$)">
          <Entrada name="premio" inputMode="decimal" />
        </Campo>
      </div>
      <Campo rotulo="Observações">
        <AreaTexto name="observacoes" rows={2} />
      </Campo>
    </>
  );
}

/** Garantias e seguro incêndio dos contratos ativos: o que vence em 30/60/90 dias, pedido e registro da renovação. */
export default async function VencimentosPage({ searchParams }: PageProps<"/analise/garantias">) {
  const sp = await searchParams;
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const filtro = s("filtro") in FILTROS ? s("filtro") : "";
  const busca = s("busca");
  const { supabase, organizacao } = await obterContexto();
  const hoje = hojeISO();

  const [garantias, seguros, renovacoes] = await Promise.all([
    todas<{
      id: string;
      tipo: string;
      instituicao: string | null;
      numero: string | null;
      valor: number | null;
      fim: string | null;
      pessoa: { nome: string } | null;
      contrato: ContratoMin;
    }>(() =>
      supabase
        .from("contrato_garantias")
        .select(`id, tipo, instituicao, numero, valor, fim, pessoa:pessoas(nome), contrato:contratos!inner(${SELECT_CONTRATO})`)
        .in("status", ["ativa", "vencida"])
        .eq("contrato.status", "ativo")
        .order("id"),
    ),
    todas<ContratoMin & { seguro_incendio_apolice: string | null; seguro_incendio_vencimento: string | null }>(() =>
      supabase.from("contratos").select(`${SELECT_CONTRATO}, seguro_incendio_apolice, seguro_incendio_vencimento`).eq("status", "ativo").not("seguro_incendio_vencimento", "is", null).order("id"),
    ),
    todas<Renovacao>(() =>
      supabase
        .from("garantia_renovacoes")
        .select("id, objeto, contrato_id, contrato_garantia_id, status, solicitada_em, canal, destinatario, destinatario_nome, fim_anterior, nova_fim, novo_numero, concluida_em, observacoes, contrato:contratos(numero, imovel:imoveis(codigo))")
        .order("id"),
    ),
  ]);

  const itens: Item[] = [
    // Fiança sem data não vence: fica fora da lista de vencimentos.
    ...garantias
      .filter((g) => g.fim || g.tipo !== "fiador")
      .map((g) => ({
        chave: `g:${g.id}`,
        objeto: "garantia" as const,
        garantiaId: g.id,
        contrato: g.contrato,
        tipo: g.tipo,
        instituicao: g.instituicao,
        numero: g.numero,
        valor: g.valor === null ? null : Number(g.valor),
        fim: g.fim,
        fiador: g.tipo === "fiador" ? (g.pessoa?.nome ?? null) : null,
      })),
    ...seguros.map((c) => ({
      chave: `s:${c.id}`,
      objeto: "seguro_incendio" as const,
      garantiaId: null,
      contrato: c,
      tipo: "seguro_incendio",
      instituicao: null,
      numero: c.seguro_incendio_apolice,
      valor: null,
      fim: c.seguro_incendio_vencimento,
      fiador: null,
    })),
  ].sort((a, b) => (a.fim ?? "9999").localeCompare(b.fim ?? "9999"));

  const pendentes = new Map<string, Renovacao>();
  for (const r of [...renovacoes].sort((a, b) => a.solicitada_em.localeCompare(b.solicitada_em)))
    if (r.status === "solicitada") pendentes.set(r.objeto === "garantia" ? `g:${r.contrato_garantia_id}` : `s:${r.contrato_id}`, r);

  const conta: Record<FaixaVencimento, number> = { vencida: 0, "30": 0, "60": 0, "90": 0, depois: 0, sem_data: 0 };
  for (const i of itens) conta[faixaVencimento(i.fim, hoje)]++;

  let lista = itens.filter((i) => {
    const f = faixaVencimento(i.fim, hoje);
    if (filtro === "") return f === "vencida" || f === "30" || f === "60" || f === "90";
    if (filtro === "ativas") return true;
    return f === filtro;
  });
  const b = busca ? normalizar(busca) : "";
  const locatario = (c: ContratoMin) => c.contrato_partes.find((p) => p.papel === "locatario")?.pessoa ?? null;
  if (b) lista = lista.filter((i) => normalizar([i.instituicao, i.numero, i.fiador, i.contrato.imovel?.codigo, String(i.contrato.numero), locatario(i.contrato)?.nome].join(" ")).includes(b));
  const listaRenov = [...renovacoes]
    .sort((x, y) => y.solicitada_em.localeCompare(x.solicitada_em))
    .filter((r) => !b || normalizar([r.contrato?.imovel?.codigo, String(r.contrato?.numero), r.destinatario_nome].join(" ")).includes(b));
  const url = (k: string) => {
    const p = new URLSearchParams(Object.entries({ filtro: k, busca }).filter(([, v]) => v) as [string, string][]);
    const t = p.toString();
    return t ? `/analise/garantias?${t}` : "/analise/garantias";
  };
  const rotuloTipo = (t: string) => (t === "seguro_incendio" ? "Seguro incêndio" : (ROTULO_TIPO_GARANTIA[t] ?? t));

  return (
    <>
      <Cabecalho
        titulo="Vencimentos e renovações"
        trilha="Análise cadastral"
        descricao="Seguro-fiança, título, carta-fiança, caução e seguro incêndio dos contratos ativos: o que vence, mensagem pronta para pedir a renovação e o registro da renovação."
      />
      <AbasAnalise />
      <div className="entrar-cascata mb-6 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Indicador rotulo="Vencidas" icone={<CalendarX2 />} valor={<Contador valor={conta.vencida} />} tom={conta.vencida ? "perigo" : "sucesso"} href={url("vencida")} />
        <Indicador rotulo="Vencem em até 30 dias" icone={<ShieldAlert />} valor={<Contador valor={conta["30"]} />} tom={conta["30"] ? "perigo" : "neutro"} href={url("30")} />
        <Indicador rotulo="Em 31 a 60 dias" icone={<CalendarClock />} valor={<Contador valor={conta["60"]} />} tom={conta["60"] ? "alerta" : "neutro"} href={url("60")} />
        <Indicador rotulo="Em 61 a 90 dias" icone={<CalendarCheck2 />} valor={<Contador valor={conta["90"]} />} href={url("90")} detalhe={`${pendentes.size} pedido(s) de renovação em aberto`} />
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <PilulasLink rotulo="Vencimento" ativo={url(filtro)} itens={Object.entries(FILTROS).map(([k, r]) => ({ href: url(k), rotulo: r }))} />
        <FiltroAutomatico className="flex flex-wrap gap-2">
          {filtro && <input type="hidden" name="filtro" value={filtro} />}
          <Entrada name="busca" aria-label="Buscar garantia" defaultValue={busca} placeholder="Buscar imóvel, locatário, seguradora, apólice…" className="max-w-80" />
        </FiltroAutomatico>
      </div>

      {filtro === "renovacoes" ? (
        <Tabela colunas={["Pedido em", "Contrato", "O quê", "Para quem", "Vencimento", "Situação", ""]}>
          {listaRenov.map((r) => (
            <tr key={r.id} className="align-top">
              <Celula>{formatarDataBR(r.solicitada_em)}</Celula>
              <Celula>
                <Link href={`/contratos/${r.contrato_id}`} className="text-acento hover:underline">
                  #{r.contrato?.numero}
                </Link>
                <span className="block text-xs text-mudo">{r.contrato?.imovel?.codigo}</span>
              </Celula>
              <Celula>{r.objeto === "garantia" ? "Garantia" : "Seguro incêndio"}</Celula>
              <Celula>
                {DESTINATARIOS_RENOVACAO[r.destinatario] ?? r.destinatario}
                <span className="block text-xs text-mudo">
                  {r.destinatario_nome ? `${r.destinatario_nome} · ` : ""}
                  {CANAIS_RENOVACAO[r.canal] ?? r.canal}
                </span>
              </Celula>
              <Celula>
                {formatarDataBR(r.fim_anterior)}
                {r.nova_fim && <span className="block text-xs text-ok">→ {formatarDataBR(r.nova_fim)}</span>}
              </Celula>
              <Celula>
                <Selo cor={r.status === "renovada" ? "verde" : r.status === "solicitada" ? "azul" : r.status === "recusada" ? "vermelho" : "cinza"}>{ROTULO_STATUS_RENOVACAO[r.status]}</Selo>
                {r.observacoes && <span className="mt-1 block max-w-56 text-xs text-texto-2">{r.observacoes}</span>}
              </Celula>
              <Celula>
                <div className="flex flex-wrap items-center justify-end gap-1.5">
                  {r.status === "solicitada" && (
                    <>
                      <JanelaCadastro rotuloBotao="Renovada" tamanho="sm" titulo="Registrar renovação" acao={concluirRenovacao} rotuloSalvar="Registrar" icone={<RefreshCw />}>
                        <CamposConclusao item={{ objeto: r.objeto, contratoId: r.contrato_id, garantiaId: r.contrato_garantia_id, numero: null }} renovacaoId={r.id} />
                      </JanelaCadastro>
                      <BotaoAcao acao={recusarRenovacao} id={r.id} tamanho="sm" variante="fantasma" confirmar="Marcar que a renovação foi recusada?">
                        Recusada
                      </BotaoAcao>
                      <BotaoAcao acao={cancelarRenovacao} id={r.id} tamanho="sm" variante="fantasma" confirmar="Cancelar este pedido de renovação?">
                        Cancelar
                      </BotaoAcao>
                    </>
                  )}
                  <BotaoExcluir acao={excluirRenovacao} id={r.id} rotulo="Excluir pedido" confirmar="Excluir este pedido de renovação? (A auditoria guarda o registro.)" />
                </div>
              </Celula>
            </tr>
          ))}
          {listaRenov.length === 0 && <LinhaVazia colunas={7}>Nenhum pedido de renovação.</LinhaVazia>}
        </Tabela>
      ) : (
        <Tabela colunas={["Vence em", "Garantia", "Contrato / locatário", "Valor", "Renovação", ""]}>
          {lista.map((i) => {
            const faixa = faixaVencimento(i.fim, hoje);
            const dias = diasParaVencer(i.fim, hoje);
            const loc = locatario(i.contrato);
            const pend = pendentes.get(i.chave);
            const base = { tipo: i.tipo, apolice: i.numero, instituicao: i.instituicao, fim: i.fim, imovel: i.contrato.imovel?.codigo, contrato: i.contrato.numero, organizacao: organizacao.nome };
            const msgSeg = mensagemRenovacao({ ...base, para: "seguradora" });
            const msgLoc = mensagemRenovacao({ ...base, para: "locatario", nome: loc?.nome });
            const item = { objeto: i.objeto, contratoId: i.contrato.id, garantiaId: i.garantiaId, numero: i.numero };
            return (
              <tr key={i.chave} className="align-top">
                <Celula>
                  <span className="font-medium tabular-nums text-texto">{formatarDataBR(i.fim)}</span>
                  <span className="mt-1 block">
                    <Selo cor={COR_FAIXA[faixa]}>{dias === null ? ROTULO_FAIXA[faixa] : dias < 0 ? `vencida há ${-dias} dia(s)` : dias === 0 ? "vence hoje" : `em ${dias} dia(s)`}</Selo>
                  </span>
                </Celula>
                <Celula>
                  <span className="font-medium text-texto">{rotuloTipo(i.tipo)}</span>
                  <span className="block text-xs text-mudo">{[i.fiador, i.instituicao, i.numero ? `nº ${i.numero}` : null].filter(Boolean).join(" · ") || "—"}</span>
                </Celula>
                <Celula>
                  <Link href={`/contratos/${i.contrato.id}/partes`} className="text-acento hover:underline">
                    #{i.contrato.numero}
                  </Link>{" "}
                  <span className="text-xs text-mudo">{i.contrato.imovel?.codigo}</span>
                  <span className="block text-xs text-texto-2">{loc?.nome ?? "—"}</span>
                </Celula>
                <Celula className="tabular-nums">{i.valor !== null ? formatarReais(i.valor) : "—"}</Celula>
                <Celula>
                  {pend ? (
                    <span className="text-xs text-texto-2">
                      <Selo cor="azul">pedida</Selo> em {formatarDataBR(pend.solicitada_em)} ({CANAIS_RENOVACAO[pend.canal] ?? pend.canal})
                    </span>
                  ) : (
                    <span className="text-xs text-mudo">não pedida</span>
                  )}
                </Celula>
                <Celula>
                  <div className="flex flex-wrap items-center justify-end gap-1.5">
                    {loc?.telefone && (
                      <a href={linkWhatsapp(loc.telefone, msgLoc)} target="_blank" rel="noreferrer" className={classeBotao("secundario", "sm")} title="Avisar o locatário no WhatsApp">
                        <MessageCircle className="size-3.5" /> Locatário
                      </a>
                    )}
                    {i.objeto === "garantia" && i.tipo !== "fiador" && i.tipo !== "caucao" && (
                      <>
                        <Copiar texto={msgSeg} rotulo="Msg. seguradora" />
                        <a
                          href={`mailto:?subject=${encodeURIComponent(`Renovação ${rotuloTipo(i.tipo)}${i.numero ? ` nº ${i.numero}` : ""} — contrato ${i.contrato.numero}`)}&body=${encodeURIComponent(msgSeg)}`}
                          className={classeBotao("secundario", "sm")}
                          title="Pedir renovação por e-mail"
                        >
                          <Mail className="size-3.5" />
                        </a>
                      </>
                    )}
                    {!pend && (
                      <JanelaCadastro rotuloBotao={<><Send className="size-3.5" /> Pedir</>} tamanho="sm" variante="secundario" titulo={`Pedir renovação — ${rotuloTipo(i.tipo)}`} acao={solicitarRenovacao} rotuloSalvar="Registrar pedido" icone={<Send />}>
                        <input type="hidden" name="objeto" value={i.objeto} />
                        <input type="hidden" name="contrato_id" value={i.contrato.id} />
                        {i.garantiaId && <input type="hidden" name="contrato_garantia_id" value={i.garantiaId} />}
                        <div className="grid gap-4 sm:grid-cols-2">
                          <Campo rotulo="Para quem">
                            <Selecao name="destinatario" defaultValue={i.tipo === "seguro_incendio" || i.tipo === "caucao" || i.tipo === "fiador" ? "locatario" : "seguradora"}>
                              {Object.entries(DESTINATARIOS_RENOVACAO).map(([k, r]) => (
                                <option key={k} value={k}>
                                  {r}
                                </option>
                              ))}
                            </Selecao>
                          </Campo>
                          <Campo rotulo="Por onde">
                            <Selecao name="canal" defaultValue="whatsapp">
                              {Object.entries(CANAIS_RENOVACAO).map(([k, r]) => (
                                <option key={k} value={k}>
                                  {r}
                                </option>
                              ))}
                            </Selecao>
                          </Campo>
                          <Campo rotulo="Nome do contato">
                            <Entrada name="destinatario_nome" defaultValue={i.instituicao ?? loc?.nome ?? ""} />
                          </Campo>
                          <Campo rotulo="Pedido em">
                            <Entrada type="date" name="solicitada_em" defaultValue={hoje} max={hoje} />
                          </Campo>
                        </div>
                        <Campo rotulo="Observações">
                          <AreaTexto name="observacoes" rows={2} />
                        </Campo>
                        <p className="text-xs text-mudo">Envie a mensagem pronta (WhatsApp ou e-mail) e registre aqui o pedido. O envio automático fica pronto para ligar quando houver integração.</p>
                      </JanelaCadastro>
                    )}
                    <JanelaCadastro rotuloBotao={<><RefreshCw className="size-3.5" /> Renovada</>} tamanho="sm" titulo={`Registrar renovação — ${rotuloTipo(i.tipo)}`} acao={concluirRenovacao} rotuloSalvar="Registrar" icone={<RefreshCw />}>
                      <CamposConclusao item={item} renovacaoId={pend?.id} />
                    </JanelaCadastro>
                  </div>
                </Celula>
              </tr>
            );
          })}
          {lista.length === 0 && <LinhaVazia colunas={6}>Nada vencendo aqui.</LinhaVazia>}
        </Tabela>
      )}
    </>
  );
}
