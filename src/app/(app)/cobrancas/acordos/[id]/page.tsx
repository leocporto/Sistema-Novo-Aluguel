import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CircleDollarSign, FileText, MessageCircle, Undo2 } from "lucide-react";
import { BotaoAcao } from "@/components/botao-acao";
import { BotaoExcluir } from "@/components/botao-excluir";
import { Copiar } from "@/components/copiar";
import { Formulario } from "@/components/formulario";
import { JanelaCadastro } from "@/components/janela-cadastro";
import { AreaTexto, Aviso, BotaoLink, Campo, Cartao, Celula, Entrada, LinhaVazia, Selecao, Selo, Tabela, classeBotao } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { acordoEmRisco, FORMAS_RECEBIMENTO, identificacaoImovel, ROTULO_STATUS_ACORDO, textoDias, type ImovelEndereco } from "@/lib/dominio/cobrancas";
import { diasEntre, formatarCompetencia, formatarDataBR, hojeISO } from "@/lib/dominio/datas";
import { formatarReais, paraCentavos } from "@/lib/dominio/dinheiro";
import { linkWhatsapp } from "@/lib/whatsapp";
import { atualizarAcordo, estornarParcela, excluirAcordo, quebrarAcordo, receberParcela } from "../../actions";
import { JanelaContato, ListaContatos, ListaEventos, SELECT_CONTATO, type ContatoDb, type EventoDb } from "../../campos";
import { configCobranca, contasAtivas, linkPagar, pixDaCobranca, recebedorPix, urlBase } from "../../dados";

export const metadata: Metadata = { title: "Acordo" };

const COR = { ativo: "azul", cumprido: "verde", quebrado: "vermelho", cancelado: "cinza" } as const;

type Acordo = {
  id: string;
  numero: number;
  status: keyof typeof COR;
  data: string;
  principal: number;
  multa: number;
  juros: number;
  desconto: number;
  total: number;
  entrada: number;
  parcelas: number;
  condicoes: string | null;
  observacoes: string | null;
  cumprido_em: string | null;
  quebrado_em: string | null;
  quebra_motivo: string | null;
  contrato: { id: string; numero: number; imovel: ImovelEndereco | null } | null;
  pessoa: { id: string; nome: string; telefone: string | null } | null;
};
type Parcela = { id: string; numero: number; vencimento: string; valor: number; status: string; pago_em: string | null; forma: string | null; token_publico: string };
type AF = { fatura_id: string; principal: number; multa: number; juros: number; desconto: number; total: number; fatura: { numero: number; competencia: string; status: string } | null };

export default async function AcordoPage({ params }: PageProps<"/cobrancas/acordos/[id]">) {
  const { id } = await params;
  const { supabase, organizacao } = await obterContexto();
  const hoje = hojeISO();
  const cfg = configCobranca(organizacao);
  const { data } = await supabase
    .from("acordos")
    .select("*, contrato:contratos(id, numero, imovel:imoveis(codigo, logradouro, numero, complemento, bairro, cidade, uf)), pessoa:pessoas(id, nome, telefone)")
    .eq("id", id)
    .maybeSingle();
  if (!data) notFound();
  const a = data as unknown as Acordo;
  const [{ data: parcRaw }, { data: afRaw }, { data: contatos }, { data: eventos }, contas, recebedor, base] = await Promise.all([
    supabase.from("acordo_parcelas").select("id, numero, vencimento, valor, status, pago_em, forma, token_publico").eq("acordo_id", id).order("numero"),
    supabase.from("acordo_faturas").select("fatura_id, principal, multa, juros, desconto, total, fatura:faturas(numero, competencia, status)").eq("acordo_id", id),
    supabase.from("cobranca_contatos").select(SELECT_CONTATO).eq("acordo_id", id).order("data", { ascending: false }).limit(100),
    supabase.from("cobranca_eventos").select("id, tipo, descricao, valor, data, fatura_id").eq("acordo_id", id).order("data", { ascending: false }).limit(100),
    contasAtivas(supabase),
    recebedorPix(supabase, organizacao),
    urlBase(),
  ]);
  const parcelas = (parcRaw ?? []) as Parcela[];
  const faturas = (afRaw ?? []) as unknown as AF[];
  const pagas = parcelas.filter((p) => p.status === "paga");
  const pago = pagas.reduce((s, p) => s + Number(p.valor), 0);
  const abertas = parcelas.filter((p) => p.status === "aberta");
  const proxima = abertas[0];
  const risco = a.status === "ativo" ? acordoEmRisco(parcelas, hoje, cfg.quebraDias) : null;
  const ativo = a.status === "ativo";
  const mensagem = proxima
    ? `Olá ${a.pessoa?.nome.split(" ")[0] ?? ""}! Lembrete do acordo nº ${a.numero}: a ${proxima.numero === 0 ? "entrada" : `${proxima.numero}ª parcela`} de ${formatarReais(proxima.valor)} vence em ${formatarDataBR(proxima.vencimento)}.${cfg.linkPublico ? `\n\n2ª via: ${linkPagar(base, proxima.token_publico)}` : ""}${(() => {
        const pix = pixDaCobranca(recebedor, paraCentavos(proxima.valor), `AC${a.numero}P${proxima.numero}`);
        return pix ? `\n\nPix copia e cola:\n${pix}` : "";
      })()}`
    : "";

  return (
    <>
      <div className="mb-[clamp(14px,1.5vw,18px)] flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[13px] text-mudo">
            <span>Novo Aluguel</span>
            <span className="text-fraco">›</span>
            <Link href="/cobrancas/acordos" className="text-acento-hot hover:underline">
              Acordos
            </Link>
            <span className="text-fraco">›</span>
            <span>nº {a.numero}</span>
          </div>
          <h1 className="mt-1.5 text-[clamp(26px,2.8vw,36px)] font-semibold leading-[1.05] tracking-[-0.025em] text-texto">
            Acordo nº {a.numero} · {a.pessoa?.nome ?? "Locatário"}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[13.5px] text-texto-2">
            <Selo cor={COR[a.status] ?? "cinza"}>{ROTULO_STATUS_ACORDO[a.status] ?? a.status}</Selo>
            <span className="font-semibold tabular-nums text-texto">{formatarReais(a.total)}</span>
            {a.contrato && (
              <>
                <span>{identificacaoImovel(a.contrato.imovel)}</span>
                <Link href={`/contratos/${a.contrato.id}/cobrancas`} className="text-acento hover:underline">
                  contrato #{a.contrato.numero}
                </Link>
              </>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {ativo && proxima && a.pessoa?.telefone && (
            <a href={linkWhatsapp(a.pessoa.telefone, mensagem)} target="_blank" rel="noreferrer" className={classeBotao("secundario")}>
              <MessageCircle className="size-4" /> Lembrar parcela
            </a>
          )}
          <BotaoLink href={`/cobrancas/acordos/${id}/termo`} variante="secundario">
            <FileText className="size-4" /> Termo do acordo
          </BotaoLink>
          {ativo && (
            <JanelaCadastro rotuloBotao="Quebrar acordo" variante="perigo" titulo={`Quebrar o acordo nº ${a.numero}`} acao={quebrarAcordo} rotuloSalvar="Quebrar acordo" icone={<Undo2 />}>
              <input type="hidden" name="acordo_id" value={id} />
              <p className="text-sm text-texto-2">
                As parcelas em aberto ({abertas.length}, {formatarReais(abertas.reduce((s, p) => s + Number(p.valor), 0))}) são canceladas e os aluguéis que ainda não foram quitados voltam para a cobrança normal, com o saldo que restou. O que já foi pago continua registrado.
              </p>
              <Campo rotulo="Motivo">
                <Entrada name="motivo" required placeholder="Ex.: 2ª parcela 40 dias atrasada, sem resposta" />
              </Campo>
            </JanelaCadastro>
          )}
          {pagas.length === 0 && <BotaoExcluir acao={excluirAcordo} id={id} variante="botao" rotulo="Excluir" confirmar="Excluir este acordo? As cobranças voltam para a cobrança normal." depois="/cobrancas/acordos" />}
        </div>
      </div>

      {risco?.sugerirQuebra && (
        <div className="mb-5">
          <Aviso tipo="erro">
            Parcela atrasada há {risco.maiorAtraso} dias (o limite combinado na configuração é {cfg.quebraDias}). Avalie cobrar ou quebrar o acordo.
          </Aviso>
        </div>
      )}
      {a.status === "quebrado" && (
        <div className="mb-5">
          <Aviso tipo="alerta">
            Quebrado em {formatarDataBR(a.quebrado_em)}
            {a.quebra_motivo ? ` — ${a.quebra_motivo}` : ""}. O saldo voltou para a cobrança normal.
          </Aviso>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <Cartao titulo={`Parcelas (${pagas.length} de ${parcelas.filter((p) => p.status !== "cancelada").length} pagas)`}>
            <Tabela colunas={["Parcela", "Vencimento", "Valor", "Situação", "Pago em", ""]}>
              {parcelas.length === 0 && <LinhaVazia colunas={6}>Sem parcelas.</LinhaVazia>}
              {parcelas.map((p) => {
                const d = diasEntre(p.vencimento, hoje);
                return (
                  <tr key={p.id}>
                    <Celula>{p.numero === 0 ? "Entrada" : `${p.numero}ª`}</Celula>
                    <Celula>{formatarDataBR(p.vencimento)}</Celula>
                    <Celula className="tabular-nums">{formatarReais(p.valor)}</Celula>
                    <Celula>
                      {p.status === "paga" ? (
                        <Selo cor="verde">paga</Selo>
                      ) : p.status === "cancelada" ? (
                        <Selo cor="cinza">cancelada</Selo>
                      ) : (
                        <Selo cor={d > 0 ? "vermelho" : d === 0 ? "amarelo" : "azul"}>{textoDias(d)}</Selo>
                      )}
                    </Celula>
                    <Celula>
                      {p.pago_em ? formatarDataBR(p.pago_em) : "—"}
                      {p.forma && <span className="block text-xs text-mudo">{FORMAS_RECEBIMENTO[p.forma] ?? p.forma}</span>}
                    </Celula>
                    <Celula>
                      <span className="flex flex-wrap items-center justify-end gap-1.5">
                        {p.status === "aberta" && ativo && (
                          <>
                            <JanelaCadastro
                              rotuloBotao={<><CircleDollarSign className="size-3.5" /> Receber</>}
                              tamanho="sm"
                              titulo={`Receber ${p.numero === 0 ? "a entrada" : `a ${p.numero}ª parcela`} (${formatarReais(p.valor)})`}
                              acao={receberParcela}
                              rotuloSalvar={`Confirmar ${formatarReais(p.valor)}`}
                              icone={<CircleDollarSign />}
                            >
                              <input type="hidden" name="parcela_id" value={p.id} />
                              <p className="text-sm text-texto-2">O valor é distribuído nos aluguéis do acordo, do mais antigo para o mais novo; o aluguel que fica coberto é quitado.</p>
                              <div className="grid gap-4 sm:grid-cols-2">
                                <Campo rotulo="Pago em">
                                  <Entrada type="date" name="pago_em" required defaultValue={hoje} max={hoje} />
                                </Campo>
                                <Campo rotulo="Forma">
                                  <Selecao name="forma" defaultValue="pix">
                                    {Object.entries(FORMAS_RECEBIMENTO).map(([k, r]) => (
                                      <option key={k} value={k}>
                                        {r}
                                      </option>
                                    ))}
                                  </Selecao>
                                </Campo>
                              </div>
                              {contas.length > 0 && (
                                <Campo rotulo="Conta onde o dinheiro entrou">
                                  <Selecao name="conta_id" defaultValue={cfg.contaId ?? ""}>
                                    <option value="">— não informar —</option>
                                    {contas.map((c) => (
                                      <option key={c.id} value={c.id}>
                                        {c.nome}
                                      </option>
                                    ))}
                                  </Selecao>
                                </Campo>
                              )}
                            </JanelaCadastro>
                            {cfg.linkPublico && <Copiar texto={linkPagar(base, p.token_publico)} rotulo="Link" />}
                          </>
                        )}
                        {p.status === "paga" && a.status !== "quebrado" && (
                          <BotaoAcao
                            acao={estornarParcela}
                            id={p.id}
                            tamanho="sm"
                            variante="fantasma"
                            confirmar={`Desfazer o recebimento de ${formatarReais(p.valor)} (${formatarDataBR(p.pago_em)})? Os aluguéis quitados por esta parcela voltam para o acordo, e o repasse/taxa (ou o lançamento no Financeiro) deles é apagado.`}
                          >
                            <Undo2 className="size-3.5" /> Desfazer
                          </BotaoAcao>
                        )}
                      </span>
                    </Celula>
                  </tr>
                );
              })}
            </Tabela>
          </Cartao>

          <Cartao titulo="Aluguéis incluídos no acordo">
            <Tabela colunas={["Cobrança", "Aluguel", "Multa", "Juros", "Desconto", "No acordo", "Situação"]}>
              {faturas.map((f) => (
                <tr key={f.fatura_id}>
                  <Celula>
                    <Link href={`/faturas/${f.fatura_id}`} className="text-acento hover:underline">
                      #{f.fatura?.numero} · {formatarCompetencia(f.fatura?.competencia)}
                    </Link>
                  </Celula>
                  <Celula className="tabular-nums">{formatarReais(f.principal)}</Celula>
                  <Celula className="tabular-nums">{formatarReais(f.multa)}</Celula>
                  <Celula className="tabular-nums">{formatarReais(f.juros)}</Celula>
                  <Celula className="tabular-nums text-ok">{Number(f.desconto) ? `− ${formatarReais(f.desconto)}` : "—"}</Celula>
                  <Celula className="font-medium tabular-nums">{formatarReais(f.total)}</Celula>
                  <Celula>
                    <Selo cor={f.fatura?.status === "paga" ? "verde" : f.fatura?.status === "renegociada" ? "azul" : "amarelo"}>
                      {f.fatura?.status === "paga" ? "quitada" : f.fatura?.status === "renegociada" ? "em acordo" : "em aberto"}
                    </Selo>
                  </Celula>
                </tr>
              ))}
            </Tabela>
          </Cartao>

          <Cartao titulo="Contatos sobre o acordo" acoes={a.contrato && <JanelaContato contratoId={a.contrato.id} acordoId={id} hoje={hoje} />}>
            <ListaContatos contatos={(contatos ?? []) as unknown as ContatoDb[]} hoje={hoje} />
          </Cartao>
        </div>

        <div className="space-y-6">
          <Cartao titulo="Resumo">
            <dl className="space-y-1.5 text-sm">
              {[
                ["Data do acordo", formatarDataBR(a.data)],
                ["Aluguéis em aberto", formatarReais(a.principal)],
                ["Multa", formatarReais(a.multa)],
                ["Juros", formatarReais(a.juros)],
                ["Desconto concedido", Number(a.desconto) ? `− ${formatarReais(a.desconto)}` : "—"],
                ["Total do acordo", formatarReais(a.total)],
                ["Entrada", Number(a.entrada) ? formatarReais(a.entrada) : "—"],
                ["Já pago", formatarReais(pago)],
                ["Falta", formatarReais(Number(a.total) - pago)],
                ...(a.cumprido_em ? [["Cumprido em", formatarDataBR(a.cumprido_em)]] : []),
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-2">
                  <dt className="text-texto-2">{k}</dt>
                  <dd className="tabular-nums">{v}</dd>
                </div>
              ))}
            </dl>
          </Cartao>
          <Cartao titulo="Condições e observações">
            <Formulario acao={atualizarAcordo} automatico className="space-y-3">
              <input type="hidden" name="id" value={id} />
              <Campo rotulo="Condições (saem no termo)">
                <AreaTexto name="condicoes" rows={4} defaultValue={a.condicoes ?? ""} />
              </Campo>
              <Campo rotulo="Observações internas">
                <AreaTexto name="observacoes" rows={3} defaultValue={a.observacoes ?? ""} />
              </Campo>
            </Formulario>
          </Cartao>
          <Cartao titulo="Histórico (não se apaga)">
            <ListaEventos eventos={(eventos ?? []) as EventoDb[]} />
          </Cartao>
        </div>
      </div>
    </>
  );
}
