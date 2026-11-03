import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2, EyeOff, Link2, Sparkles, Undo2 } from "lucide-react";
import { Contador } from "@/components/abas-segmentadas";
import { BotaoAcao } from "@/components/botao-acao";
import { BotaoExcluir } from "@/components/botao-excluir";
import { Formulario } from "@/components/formulario";
import { JanelaCadastro } from "@/components/janela-cadastro";
import { PilulasLink } from "@/components/pilulas-link";
import { Aviso, Campo, Cartao, Celula, Entrada, Indicador, LinhaVazia, Selecao, Selo, Tabela } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { formatarDataBR } from "@/lib/dominio/datas";
import { formatarReais } from "@/lib/dominio/dinheiro";
import { ROTULO_TIPO_CONTA, type CandidatoConciliacao } from "@/lib/dominio/financeiro";
import { atualizarConta, conciliarItem, conciliarSugestoes, desfazerConciliacao, excluirConta, excluirItemExtrato, ignorarItemExtrato, lancarItemExtrato } from "../../actions";
import { ImportarExtrato } from "../../campos";
import { opcoesFinanceiro, saldosDasContas, sugestoesDeConciliacao } from "../../dados";

export const metadata: Metadata = { title: "Conta" };

type Item = {
  id: string;
  data: string;
  descricao: string;
  valor: number;
  documento: string | null;
  lancamento_id: string | null;
  fatura_id: string | null;
  repasse_id: string | null;
  ignorado: boolean;
};

const FILTROS: Record<string, string> = { "": "A conciliar", conciliados: "Conciliados", ignorados: "Ignorados", todos: "Todos" };

export default async function ContaPage({ params, searchParams }: PageProps<"/financeiro/contas/[id]">) {
  const { id } = await params;
  const sp = await searchParams;
  const filtro = typeof sp.filtro === "string" && sp.filtro in FILTROS ? sp.filtro : "";
  const { supabase, organizacao } = await obterContexto();
  const pessoal = organizacao.modo === "pessoal";
  const op = await opcoesFinanceiro(supabase);
  const conta = op.contas.find((c) => c.id === id);
  if (!conta) notFound();
  const { data: itensRaw } = await supabase.from("extrato_itens").select("*").eq("conta_id", id).order("data", { ascending: false }).limit(1000);
  const todos = (itensRaw ?? []) as Item[];
  const conciliado = (i: Item) => !!(i.lancamento_id || i.fatura_id || i.repasse_id);
  const abertos = todos.filter((i) => !conciliado(i) && !i.ignorado);
  const itens = filtro === "conciliados" ? todos.filter(conciliado) : filtro === "ignorados" ? todos.filter((i) => i.ignorado) : filtro === "todos" ? todos : abertos;

  const sugestoes = await sugestoesDeConciliacao(supabase, pessoal, abertos);
  const saldo = (await saldosDasContas(supabase, [conta])).get(conta.id) ?? 0;
  const url = (k: string) => (k ? `/financeiro/contas/${id}?filtro=${k}` : `/financeiro/contas/${id}`);
  const rotuloCand = (c: CandidatoConciliacao) => `${c.descricao} · ${formatarReais(c.status === "liquidado" ? (c.valor_pago ?? c.valor) : c.valor)} · ${c.status === "liquidado" ? `pago ${formatarDataBR(c.liquidado_em)}` : `vence ${formatarDataBR(c.vencimento)}`}`;

  return (
    <>
      <div className="mb-[clamp(14px,1.5vw,18px)] flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[13px] text-mudo">
            <span>Novo Aluguel</span>
            <span className="text-fraco">›</span>
            <Link href="/financeiro/contas" className="text-acento-hot hover:underline">
              Contas
            </Link>
          </div>
          <h1 className="mt-1.5 text-[clamp(26px,2.8vw,36px)] font-semibold leading-[1.05] tracking-[-0.025em] text-texto">{conta.nome}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[13.5px] text-texto-2">
            <Selo cor="azul">{ROTULO_TIPO_CONTA[conta.tipo] ?? conta.tipo}</Selo>
            {conta.terceiros && <Selo cor="amarelo">terceiros</Selo>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {[...sugestoes.values()].some((x) => x.length === 1) && (
            <BotaoAcao acao={conciliarSugestoes} id={conta.id} confirmar="Conciliar de uma vez todas as linhas que têm uma única correspondência (mesmo valor e data próxima)? Lançamentos e repasses em aberto recebem a baixa.">
              <Sparkles className="size-4" /> Conciliar automático
            </BotaoAcao>
          )}
          <ImportarExtrato contaId={conta.id} />
          <BotaoExcluir acao={excluirConta} id={conta.id} variante="botao" rotulo="Excluir conta" confirmar={`Excluir a conta "${conta.nome}"? Os lançamentos continuam, só perdem a conta; o extrato importado dela é apagado e o que estava conciliado com ele volta a ficar a conciliar. Conta com transferências não pode ser excluída (desative-a).`} depois="/financeiro/contas" />
        </div>
      </div>

      <div className="entrar-cascata mb-6 grid grid-cols-2 gap-4 xl:grid-cols-3">
        <Indicador rotulo="Saldo no sistema" icone={<CheckCircle2 />} valor={<Contador valor={saldo} formato="moeda" />} tom={saldo < 0 ? "perigo" : "neutro"} detalhe={`desde ${formatarDataBR(conta.saldo_inicial_em)}`} />
        <Indicador rotulo="A conciliar" icone={<Link2 />} valor={<Contador valor={abertos.length} />} tom={abertos.length ? "alerta" : "sucesso"} href={url("")} />
        <Indicador rotulo="Conciliadas" icone={<CheckCircle2 />} valor={<Contador valor={todos.filter(conciliado).length} />} href={url("conciliados")} tom="sucesso" />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <div>
          {todos.length === 0 && (
            <div className="mb-4">
              <Aviso tipo="info">
                No site ou app do banco, procure &quot;Extrato&quot; → &quot;Exportar&quot; e escolha <b>OFX</b> (ou &quot;Money/Quicken&quot;). CSV também serve. Depois clique em
                &quot;Importar extrato&quot;: o sistema sugere qual lançamento corresponde a cada linha. Importar de novo não duplica.
              </Aviso>
            </div>
          )}
          <PilulasLink className="mb-4" rotulo="Extrato" ativo={url(filtro)} itens={Object.entries(FILTROS).map(([k, r]) => ({ href: url(k), rotulo: r }))} />
          <Tabela colunas={["Data", "Linha do extrato", "Valor", "Corresponde a", ""]}>
            {itens.map((i) => {
              const sug = sugestoes.get(i.id) ?? [];
              return (
                <tr key={i.id} className="align-top">
                  <Celula>{formatarDataBR(i.data)}</Celula>
                  <Celula>
                    <span className="text-texto">{i.descricao}</span>
                    {i.documento && <span className="block text-xs text-mudo">doc. {i.documento}</span>}
                  </Celula>
                  <Celula className={`font-medium tabular-nums ${i.valor >= 0 ? "text-ok" : "text-texto"}`}>{formatarReais(i.valor)}</Celula>
                  <Celula>
                    {conciliado(i) ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <Selo cor="verde">conciliado</Selo>
                        {i.lancamento_id && (
                          <Link href={`/financeiro/lancamentos/${i.lancamento_id}`} className="text-xs text-acento hover:underline">
                            ver lançamento
                          </Link>
                        )}
                        {i.fatura_id && (
                          <Link href={`/faturas/${i.fatura_id}`} className="text-xs text-acento hover:underline">
                            ver aluguel
                          </Link>
                        )}
                        {i.repasse_id && <span className="text-xs text-mudo">repasse</span>}
                        <BotaoAcao acao={desfazerConciliacao} id={i.id} tamanho="sm" variante="fantasma">
                          <Undo2 className="size-3.5" /> desfazer
                        </BotaoAcao>
                      </div>
                    ) : i.ignorado ? (
                      <div className="flex items-center gap-2">
                        <Selo>ignorado</Selo>
                        <BotaoAcao acao={ignorarItemExtrato} id={i.id} tamanho="sm" variante="fantasma">
                          voltar
                        </BotaoAcao>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {sug.map((c, k) => (
                          <div key={c.id} className="flex flex-wrap items-center gap-2">
                            <BotaoAcao acao={conciliarItem} id={`${i.id}|${c.id}`} tamanho="sm" variante={k === 0 ? "primario" : "secundario"}>
                              <Link2 className="size-3.5" /> Conciliar
                            </BotaoAcao>
                            <span className="text-xs text-texto-2">{rotuloCand(c)}</span>
                          </div>
                        ))}
                        {!sug.length && <span className="text-xs text-mudo">Nenhum lançamento com esse valor e data.</span>}
                        <div className="flex flex-wrap gap-2">
                          <JanelaCadastro rotuloBotao="Lançar" titulo="Lançar a partir do extrato" acao={lancarItemExtrato} variante="secundario" tamanho="sm" rotuloSalvar="Lançar e conciliar">
                            <input type="hidden" name="item_id" value={i.id} />
                            <p className="text-sm text-texto-2">
                              {formatarDataBR(i.data)} · <b>{formatarReais(i.valor)}</b> · {i.valor >= 0 ? "entrada (receita)" : "saída (despesa)"}
                            </p>
                            <Campo rotulo="Descrição">
                              <Entrada name="descricao" defaultValue={i.descricao} />
                            </Campo>
                            <Campo rotulo="Plano de contas">
                              <Selecao name="plano_id" defaultValue="">
                                <option value="">— sem classificação —</option>
                                {op.planos
                                  .filter((p) => p.ativo && p.tipo === (i.valor >= 0 ? "receita" : "despesa"))
                                  .map((p) => (
                                    <option key={p.id} value={p.id}>
                                      {p.codigo} · {p.nome}
                                    </option>
                                  ))}
                              </Selecao>
                            </Campo>
                            {!pessoal && (
                              <label className="flex items-center gap-2 text-sm text-texto-2">
                                <input type="hidden" name="terceiros" value="" />
                                <input type="checkbox" name="terceiros" defaultChecked={conta.terceiros} /> Dinheiro de terceiros (fica fora do resultado)
                              </label>
                            )}
                            <Campo rotulo="Pessoa">
                              <Selecao name="pessoa_id" defaultValue="">
                                <option value="">—</option>
                                {op.pessoas.map((p) => (
                                  <option key={p.id} value={p.id}>
                                    {p.nome}
                                  </option>
                                ))}
                              </Selecao>
                            </Campo>
                          </JanelaCadastro>
                          <BotaoAcao acao={ignorarItemExtrato} id={i.id} tamanho="sm" variante="fantasma">
                            <EyeOff className="size-3.5" /> Ignorar
                          </BotaoAcao>
                        </div>
                      </div>
                    )}
                  </Celula>
                  <Celula>
                    <BotaoExcluir acao={excluirItemExtrato} id={i.id} rotulo="Excluir linha" confirmar="Excluir esta linha do extrato importado?" />
                  </Celula>
                </tr>
              );
            })}
            {itens.length === 0 && <LinhaVazia colunas={5}>{filtro ? "Nada aqui." : todos.length ? "Tudo conciliado. 🎉" : "Nenhum extrato importado ainda."}</LinhaVazia>}
          </Tabela>
        </div>
        <Cartao titulo="Dados da conta">
          <Formulario acao={atualizarConta} automatico className="space-y-3">
            <input type="hidden" name="id" value={conta.id} />
            <Campo rotulo="Nome">
              <Entrada name="nome" defaultValue={conta.nome} />
            </Campo>
            <Campo rotulo="Tipo">
              <Selecao name="tipo" defaultValue={conta.tipo}>
                {Object.entries(ROTULO_TIPO_CONTA).map(([k, r]) => (
                  <option key={k} value={k}>
                    {r}
                  </option>
                ))}
              </Selecao>
            </Campo>
            <Campo rotulo="Banco">
              <Entrada name="banco" defaultValue={conta.banco ?? ""} />
            </Campo>
            <div className="grid grid-cols-2 gap-3">
              <Campo rotulo="Agência">
                <Entrada name="agencia" defaultValue={conta.agencia ?? ""} />
              </Campo>
              <Campo rotulo="Conta">
                <Entrada name="conta" defaultValue={conta.conta ?? ""} />
              </Campo>
            </div>
            <Campo rotulo="Chave Pix">
              <Entrada name="pix_chave" defaultValue={conta.pix_chave ?? ""} />
            </Campo>
            <div className="grid grid-cols-2 gap-3">
              <Campo rotulo="Saldo inicial">
                <Entrada name="saldo_inicial" inputMode="decimal" defaultValue={String(conta.saldo_inicial).replace(".", ",")} />
              </Campo>
              <Campo rotulo="Em">
                <Entrada type="date" name="saldo_inicial_em" defaultValue={conta.saldo_inicial_em} />
              </Campo>
            </div>
            {!pessoal && (
              <label className="flex items-center gap-2 text-sm text-texto-2">
                <input type="hidden" name="terceiros" value="" />
                <input type="checkbox" name="terceiros" defaultChecked={conta.terceiros} /> Conta de terceiros
              </label>
            )}
            <label className="flex items-center gap-2 text-sm text-texto-2">
              <input type="hidden" name="ativa" value="" />
              <input type="checkbox" name="ativa" defaultChecked={conta.ativa} /> Conta ativa
            </label>
          </Formulario>
        </Cartao>
      </div>
    </>
  );
}
