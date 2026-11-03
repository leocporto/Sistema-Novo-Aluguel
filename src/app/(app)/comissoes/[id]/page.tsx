import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2, MessageCircle, PencilLine, RotateCcw, Split } from "lucide-react";
import { BotaoAcao } from "@/components/botao-acao";
import { BotaoExcluir } from "@/components/botao-excluir";
import { JanelaCadastro } from "@/components/janela-cadastro";
import { AreaTexto, Campo, Cartao, Definicao, Entrada, Selecao, Selo, classeBotao } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { formatarDataBR, hojeISO } from "@/lib/dominio/datas";
import { formatarReais, paraCentavos, paraReais } from "@/lib/dominio/dinheiro";
import { COR_STATUS_COMISSAO, ROTULO_STATUS_COMISSAO, ROTULO_TIPO_COMISSAO, dataEsperada, descreverRegra, valorEfetivo, type StatusComissao, type TipoRegra } from "@/lib/dominio/comissoes";
import { podeAprovarRepasse } from "@/lib/dominio/repasses";
import { linkWhatsapp } from "@/lib/whatsapp";
import { ajustarComissao, dividirComissao, estornarComissao, excluirComissao, liberarComissao } from "../actions";
import { carregarBaseComissoes, type Comissao } from "../dados";

export const metadata: Metadata = { title: "Comissão" };

const ROTULO_EVENTO: Record<string, string> = {
  criada: "Criada",
  liberada: "Liberada",
  paga: "Paga",
  ajuste: "Ajuste",
  estornada: "Estornada",
  cancelada: "Cancelada",
  pagamento_desfeito: "Pagamento desfeito",
  voltou_prevista: "Voltou a prevista",
  transferida: "Transferida",
  excluida: "Excluída",
};
const COR_EVENTO: Record<string, "azul" | "verde" | "amarelo" | "vermelho" | "cinza"> = {
  liberada: "azul",
  paga: "verde",
  ajuste: "amarelo",
  estornada: "vermelho",
  cancelada: "cinza",
  pagamento_desfeito: "vermelho",
  voltou_prevista: "amarelo",
};

type C = Comissao & {
  pessoa: { id: string; nome: string; telefone: string | null } | null;
  imovel: { id: string; codigo: string } | null;
  venda: { id: string; numero: number } | null;
  contrato: { id: string; numero: number } | null;
  regra: { tipo: TipoRegra; percentual: number; condicionada: boolean; dias_pagamento: number; nome: string | null } | null;
  equipe: { nome: string } | null;
  lancamento: { id: string; status: string; vencimento: string; liquidado_em: string | null } | null;
  devolucao: { id: string; status: string; valor: number } | null;
};

/** Ficha da comissão: origem, cálculo, regra aplicada, situação no financeiro, ajustes, divisão, estorno e histórico. */
export default async function ComissaoPage({ params }: PageProps<"/comissoes/[id]">) {
  const { id } = await params;
  const { supabase, papel } = await obterContexto();
  const [{ data }, { data: eventos }, base, { data: membros }, { data: complementos }, { data: devolucoes }] = await Promise.all([
    supabase
      .from("comissoes")
      .select(
        "*, pessoa:pessoas(id, nome, telefone), imovel:imoveis(id, codigo), venda:vendas(id, numero), contrato:contratos(id, numero), regra:comissao_regras(tipo, percentual, condicionada, dias_pagamento, nome), equipe:equipes(nome), lancamento:lancamentos!comissoes_lancamento_id_fkey(id, status, vencimento, liquidado_em), devolucao:lancamentos!comissoes_devolucao_lancamento_id_fkey(id, status, valor)",
      )
      .eq("id", id)
      .maybeSingle(),
    supabase.from("comissao_eventos").select("id, tipo, descricao, valor, usuario_id, data").eq("comissao_id", id).order("data", { ascending: false }).limit(100),
    carregarBaseComissoes(supabase),
    supabase.from("membros").select("user_id, nome").limit(500),
    supabase.from("comissoes").select("id, valor, status, created_at, motivo").eq("ajuste_de", id).order("created_at"),
    supabase.from("lancamentos").select("id, valor, status, created_at, descricao").eq("comissao_devolucao_id", id).order("created_at"),
  ]);
  if (!data) notFound();
  const c = data as unknown as C;
  const nomes = new Map((membros ?? []).map((m) => [m.user_id as string, (m.nome as string | null) ?? "usuário"]));
  const hoje = hojeISO();
  const pode = podeAprovarRepasse(papel);
  const aberta = c.status === "prevista" || c.status === "a_pagar";
  const quando = dataEsperada(c);
  // Ajustes feitos depois de paga: complementos (a pagar/pagos) e devoluções do corretor.
  const comps = (complementos ?? []) as { id: string; valor: number; status: StatusComissao; created_at: string; motivo: string | null }[];
  const devs = (devolucoes ?? []) as { id: string; valor: number; status: string; created_at: string; descricao: string }[];
  const somaC = (l: { valor: number }[]) => paraReais(l.reduce((t, x) => t + paraCentavos(x.valor), 0));
  const ajustes = {
    complementos: somaC(comps.filter((x) => x.status !== "cancelada" && x.status !== "estornada")),
    devolucoes: somaC(devs.filter((x) => x.status !== "cancelado")),
  };
  const efetivo = valorEfetivo(c, ajustes);
  const temAjustes = comps.length > 0 || devs.length > 0;
  const complemento = Boolean(c.ajuste_de);
  const tel = c.pessoa?.telefone;
  const msg = `Olá ${c.pessoa?.nome.split(" ")[0] ?? ""}! Sua comissão "${c.descricao}" de ${formatarReais(temAjustes ? efetivo : c.valor)} está ${ROTULO_STATUS_COMISSAO[c.status].toLowerCase()}${quando && c.status !== "paga" ? ` (previsão ${formatarDataBR(quando)})` : ""}.`;

  return (
    <>
      <div className="mb-[clamp(14px,1.5vw,18px)] flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[13px] text-mudo">
            <span>Novo Aluguel</span>
            <span className="text-fraco">›</span>
            <Link href="/comissoes" className="text-acento-hot hover:underline">
              Comissões
            </Link>
            <span className="text-fraco">›</span>
            <span>{ROTULO_TIPO_COMISSAO[c.tipo]}</span>
          </div>
          <h1 className="mt-1.5 text-[clamp(26px,2.8vw,36px)] font-semibold leading-[1.05] tracking-[-0.025em] text-texto">{c.pessoa?.nome ?? "Comissão"}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[13.5px] text-texto-2">
            <Selo cor={COR_STATUS_COMISSAO[c.status]}>{ROTULO_STATUS_COMISSAO[c.status]}</Selo>
            <span className="font-semibold tabular-nums text-texto">{formatarReais(temAjustes ? efetivo : c.valor)}</span>
            {temAjustes && <span className="text-xs text-mudo">(pago {formatarReais(c.valor)}, com ajustes)</span>}
            <span>{c.descricao}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {tel && (
            <a href={linkWhatsapp(tel, msg)} target="_blank" rel="noreferrer" className={classeBotao("secundario")}>
              <MessageCircle className="size-4" /> WhatsApp
            </a>
          )}
          {pode && c.status === "prevista" && (
            <BotaoAcao acao={liberarComissao} id={id} variante="primario" confirmar="Liberar agora? A comissão vira conta a pagar no Financeiro (use quando a imobiliária já recebeu por fora do sistema).">
              <CheckCircle2 className="size-4" /> Liberar para pagar
            </BotaoAcao>
          )}
          {pode && (aberta || c.status === "paga") && !complemento && (
            <JanelaCadastro rotuloBotao={<><PencilLine className="size-4" /> Ajustar valor</>} variante="secundario" titulo="Ajustar a comissão" acao={ajustarComissao} icone={<PencilLine />} rotuloSalvar="Ajustar">
              <input type="hidden" name="id" value={id} />
              <Campo
                rotulo="Novo valor (R$) — o total que o corretor deve receber"
                dica={
                  c.status === "paga"
                    ? `Hoje vale ${formatarReais(efetivo)} (pago ${formatarReais(c.valor)}${temAjustes ? " + ajustes" : ""}). Para mais: primeiro diminui a devolução em aberto e o resto vira complemento a pagar. Para menos: primeiro diminui o complemento ainda não pago e o resto vira conta a receber do corretor.`
                    : "Muda também a conta a pagar no Financeiro."
                }
              >
                <Entrada name="valor" inputMode="decimal" required defaultValue={String(efetivo).replace(".", ",")} />
              </Campo>
              <Campo rotulo="Motivo">
                <AreaTexto name="motivo" required placeholder="Ex.: desconto negociado com o cliente" />
              </Campo>
            </JanelaCadastro>
          )}
          {pode && aberta && (
            <JanelaCadastro rotuloBotao={<><Split className="size-4" /> Dividir</>} variante="secundario" titulo="Dividir com outro corretor" acao={dividirComissao} icone={<Split />} rotuloSalvar="Dividir">
              <input type="hidden" name="id" value={id} />
              <Campo rotulo="Outro corretor ou parceiro">
                <Selecao name="pessoa_id" required defaultValue="">
                  <option value="">Selecione…</option>
                  {base.corretores
                    .filter((p) => p.id !== c.pessoa_id)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.nome}
                      </option>
                    ))}
                </Selecao>
              </Campo>
              <Campo rotulo="Parte dele (% desta comissão)" dica={`Ex.: 50 = metade de ${formatarReais(c.valor)}. Arredonda no centavo.`}>
                <Entrada name="percentual" inputMode="decimal" required defaultValue="50" />
              </Campo>
            </JanelaCadastro>
          )}
          {pode && (aberta || c.status === "paga") && (
            <JanelaCadastro rotuloBotao={<><RotateCcw className="size-4" /> Estornar</>} variante="secundario" titulo="Estornar comissão" acao={estornarComissao} icone={<RotateCcw />} rotuloSalvar="Estornar">
              <input type="hidden" name="id" value={id} />
              <p className="text-sm text-texto-2">
                {c.status === "paga"
                  ? `Já foi paga: o sistema cria uma conta a receber do corretor (devolução) no Financeiro do que ele recebeu de fato${temAjustes ? " (pago + complementos pagos − devoluções já lançadas); complementos ainda não pagos são cancelados" : ""}.`
                  : c.status === "a_pagar"
                    ? "A conta a pagar no Financeiro é cancelada."
                    : "A comissão prevista é cancelada."}
              </p>
              <Campo rotulo="Motivo">
                <AreaTexto name="motivo" required placeholder="Ex.: negócio desfeito, distrato…" />
              </Campo>
            </JanelaCadastro>
          )}
          <BotaoExcluir acao={excluirComissao} id={id} variante="botao" rotulo="Excluir" confirmar="Excluir esta comissão? A conta a pagar ainda aberta sai junto. O histórico continua guardado." depois="/comissoes" />
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <Cartao titulo="Detalhes">
            <Definicao
              itens={[
                ["Tipo", ROTULO_TIPO_COMISSAO[c.tipo]],
                ["Papel", c.papel ?? "—"],
                ["Equipe na época", c.equipe?.nome ?? "—"],
                ["Base", c.base !== null ? formatarReais(c.base) : "—"],
                ["Percentual", c.percentual !== null ? `${String(Number(c.percentual)).replace(".", ",")}%` : "—"],
                ["Valor original", formatarReais(c.valor_original)],
                [c.status === "paga" ? "Valor pago" : "Valor atual", <b key="v">{formatarReais(c.valor)}</b>],
                ...(temAjustes
                  ? ([
                      ["Complementos", formatarReais(ajustes.complementos)],
                      ["Devoluções do corretor", formatarReais(ajustes.devolucoes)],
                      ["Valor efetivo (com ajustes)", <b key="e">{formatarReais(efetivo)}</b>],
                    ] as [string, ReactNode][])
                  : []),
                ["Condição", c.condicionada ? (c.proposta_id || c.venda_id ? "Só depois que a imobiliária receber" : "Prevista até alguém liberar") : "Sem condição"],
                ["Regra aplicada", c.regra ? `${c.regra.nome ? `${c.regra.nome}: ` : ""}${descreverRegra({ ...c.regra, percentual: Number(c.regra.percentual) })}` : "sem regra (valor da proposta/venda ou avulsa)"],
                [c.status === "prevista" ? "Previsão" : "Vencimento", formatarDataBR(quando ?? c.vencimento)],
                ["Liberada em", formatarDataBR(c.liberada_em)],
                ["Motivo / observação", c.motivo ?? "—"],
              ]}
            />
          </Cartao>
          {temAjustes && (
            <Cartao titulo="Ajustes depois de paga">
              <ul className="divide-y divide-borda-suave text-sm">
                {comps.map((x) => (
                  <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <Link href={`/comissoes/${x.id}`} className="text-acento hover:underline">
                      Complemento a pagar · {formatarDataBR(x.created_at.slice(0, 10))}
                    </Link>
                    <span className="flex items-center gap-2">
                      <span className="tabular-nums">+{formatarReais(x.valor)}</span>
                      <Selo cor={COR_STATUS_COMISSAO[x.status]}>{ROTULO_STATUS_COMISSAO[x.status]}</Selo>
                    </span>
                  </li>
                ))}
                {devs.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <Link href={`/financeiro/lancamentos/${d.id}`} className="text-acento hover:underline">
                      Devolução do corretor · {formatarDataBR(d.created_at.slice(0, 10))}
                    </Link>
                    <span className="flex items-center gap-2">
                      <span className="tabular-nums">−{formatarReais(d.valor)}</span>
                      <Selo cor={d.status === "liquidado" ? "verde" : d.status === "cancelado" ? "cinza" : "amarelo"}>
                        {d.status === "liquidado" ? "recebida" : d.status === "cancelado" ? "cancelada" : "a receber"}
                      </Selo>
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-mudo">
                Valor efetivo = pago {formatarReais(c.valor)} + complementos {formatarReais(ajustes.complementos)} − devoluções {formatarReais(ajustes.devolucoes)} ={" "}
                <b>{formatarReais(efetivo)}</b>.
              </p>
            </Cartao>
          )}
          <Cartao titulo="Histórico">
            <ol className="space-y-3 text-sm">
              {(eventos ?? []).map((e) => (
                <li key={e.id} className="flex flex-wrap items-start gap-3">
                  <span className="w-32 shrink-0 text-xs text-mudo">
                    {new Date(e.data).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" })}
                  </span>
                  <Selo cor={COR_EVENTO[e.tipo] ?? "cinza"}>{ROTULO_EVENTO[e.tipo] ?? e.tipo}</Selo>
                  <span className="min-w-0 flex-1 text-texto-2">
                    {e.descricao}
                    {e.valor !== null ? ` · ${formatarReais(e.valor)}` : ""}
                    {e.usuario_id ? <span className="text-xs text-mudo"> · {nomes.get(e.usuario_id) ?? "usuário"}</span> : null}
                  </span>
                </li>
              ))}
              {!eventos?.length && <li className="text-mudo">Sem registros.</li>}
            </ol>
            <p className="mt-3 text-xs text-mudo">Registro automático (não pode ser alterado nem apagado).</p>
          </Cartao>
        </div>
        <div className="space-y-6">
          <Cartao titulo="Origem">
            <ul className="space-y-2 text-sm">
              {c.venda && (
                <li>
                  <Link href={`/vendas/${c.venda.id}/comissoes`} className="text-acento hover:underline">
                    Venda #{c.venda.numero}
                  </Link>
                </li>
              )}
              {c.proposta_id && (
                <li>
                  <Link href="/comercial/propostas" className="text-acento hover:underline">
                    Proposta de locação aceita
                  </Link>
                </li>
              )}
              {c.contrato && (
                <li>
                  <Link href={`/contratos/${c.contrato.id}`} className="text-acento hover:underline">
                    Contrato #{c.contrato.numero}
                  </Link>
                </li>
              )}
              {c.repasse_id && (
                <li>
                  <Link href={`/repasses/${c.repasse_id}`} className="text-acento hover:underline">
                    Repasse (taxa de administração)
                  </Link>
                </li>
              )}
              {c.imovel && (
                <li>
                  <Link href={`/imoveis/${c.imovel.id}`} className="text-acento hover:underline">
                    Imóvel {c.imovel.codigo}
                  </Link>
                </li>
              )}
              {c.origem_id && (
                <li>
                  <Link href={`/comissoes/${c.origem_id}`} className="text-acento hover:underline">
                    {complemento ? "Comissão ajustada (este é um complemento dela)" : "Comissão de origem (dividida com este corretor)"}
                  </Link>
                  {complemento && <span className="block text-xs text-mudo">Para mudar o valor, ajuste pela comissão de origem.</span>}
                </li>
              )}
              {!c.venda && !c.proposta_id && !c.contrato && !c.repasse_id && !c.imovel && !c.origem_id && <li className="text-mudo">Comissão avulsa.</li>}
            </ul>
          </Cartao>
          <Cartao titulo="No financeiro">
            <div className="space-y-2 text-sm">
              {c.lancamento ? (
                <p>
                  <Link href={`/financeiro/lancamentos/${c.lancamento.id}`} className="text-acento hover:underline">
                    Conta a pagar
                  </Link>{" "}
                  · {c.lancamento.status === "liquidado" ? `paga em ${formatarDataBR(c.lancamento.liquidado_em)}` : c.lancamento.status === "cancelado" ? "cancelada" : `vence ${formatarDataBR(c.lancamento.vencimento)}`}
                  {c.lancamento.status === "aberto" && c.lancamento.vencimento < hoje && <span className="text-ruim"> (vencida)</span>}
                </p>
              ) : (
                <p className="text-mudo">{c.status === "prevista" ? "Ainda não foi para o Financeiro (prevista)." : "Sem conta a pagar ligada."}</p>
              )}
              {c.devolucao && (
                <p>
                  <Link href={`/financeiro/lancamentos/${c.devolucao.id}`} className="text-acento hover:underline">
                    Devolução do corretor
                  </Link>{" "}
                  · {formatarReais(c.devolucao.valor)} · {c.devolucao.status === "liquidado" ? "recebida" : "a receber"}
                </p>
              )}
              <p className="text-xs text-mudo">Pagou no Financeiro? A comissão fica “paga” sozinha. Desfez a baixa? Ela volta para “a pagar”.</p>
            </div>
          </Cartao>
        </div>
      </div>
    </>
  );
}
