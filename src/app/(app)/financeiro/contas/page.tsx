import type { Metadata } from "next";
import { ArrowLeftRight, Landmark, Plus } from "lucide-react";
import { Contador } from "@/components/abas-segmentadas";
import { BotaoExcluir } from "@/components/botao-excluir";
import { JanelaCadastro } from "@/components/janela-cadastro";
import { LinhaLink } from "@/components/linha-link";
import { Cabecalho, Campo, Cartao, Celula, Entrada, Indicador, LinhaVazia, Selecao, Selo, Tabela } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { formatarDataBR, hojeISO } from "@/lib/dominio/datas";
import { formatarReais, paraCentavos, paraReais } from "@/lib/dominio/dinheiro";
import { ROTULO_TIPO_CONTA } from "@/lib/dominio/financeiro";
import { AbasFinanceiro } from "../abas";
import { criarConta, criarTransferencia, excluirConta, excluirTransferencia } from "../actions";
import { movimentosDasContas, opcoesFinanceiro, saldosDasContas } from "../dados";

export const metadata: Metadata = { title: "Contas e conciliação" };

export default async function ContasPage() {
  const { supabase, organizacao } = await obterContexto();
  const pessoal = organizacao.modo === "pessoal";
  const op = await opcoesFinanceiro(supabase);
  const [saldos, { transferencias }, { data: pend }] = await Promise.all([
    saldosDasContas(supabase, op.contas),
    movimentosDasContas(supabase),
    supabase.from("extrato_itens").select("conta_id").is("lancamento_id", null).is("fatura_id", null).is("repasse_id", null).eq("ignorado", false),
  ]);
  const pendentes = new Map<string, number>();
  for (const p of pend ?? []) pendentes.set(p.conta_id, (pendentes.get(p.conta_id) ?? 0) + 1);
  const somar = (f: (c: (typeof op.contas)[number]) => boolean) => paraReais(op.contas.filter((c) => c.ativa && f(c)).reduce((a, c) => a + paraCentavos(saldos.get(c.id) ?? 0), 0));
  const nome = new Map(op.contas.map((c) => [c.id, c.nome]));

  return (
    <>
      <Cabecalho
        titulo="Contas e conciliação"
        trilha="Financeiro"
        descricao="Suas contas bancárias, caixa e carteiras, com saldo atualizado. Entre numa conta para importar o extrato do banco e conciliar com os lançamentos."
        acoes={
          <>
            {op.contas.length > 1 && (
              <JanelaCadastro rotuloBotao={<><ArrowLeftRight className="size-4" /> Transferência</>} titulo="Transferência entre contas" acao={criarTransferencia} variante="secundario" rotuloSalvar="Registrar">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Campo rotulo="Sai de">
                    <Selecao name="origem_id" required defaultValue="">
                      <option value="">Selecione…</option>
                      {op.contas.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.nome}
                        </option>
                      ))}
                    </Selecao>
                  </Campo>
                  <Campo rotulo="Entra em">
                    <Selecao name="destino_id" required defaultValue="">
                      <option value="">Selecione…</option>
                      {op.contas.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.nome}
                        </option>
                      ))}
                    </Selecao>
                  </Campo>
                  <Campo rotulo="Valor (R$)">
                    <Entrada name="valor" required inputMode="decimal" />
                  </Campo>
                  <Campo rotulo="Data">
                    <Entrada type="date" name="data" defaultValue={hojeISO()} />
                  </Campo>
                </div>
                <Campo rotulo="Descrição (opcional)">
                  <Entrada name="descricao" placeholder="Ex.: aplicação, saque para o caixa…" />
                </Campo>
              </JanelaCadastro>
            )}
            <JanelaCadastro rotuloBotao={<><Plus className="size-4" /> Nova conta</>} titulo="Nova conta" acao={criarConta} icone={<Landmark />}>
              <div className="grid gap-4 sm:grid-cols-2">
                <Campo rotulo="Nome" className="sm:col-span-2">
                  <Entrada name="nome" required placeholder="Ex.: Itaú empresa, Caixa da loja" />
                </Campo>
                <Campo rotulo="Tipo">
                  <Selecao name="tipo" defaultValue="corrente">
                    {Object.entries(ROTULO_TIPO_CONTA).map(([k, r]) => (
                      <option key={k} value={k}>
                        {r}
                      </option>
                    ))}
                  </Selecao>
                </Campo>
                <Campo rotulo="Banco">
                  <Entrada name="banco" />
                </Campo>
                <Campo rotulo="Agência">
                  <Entrada name="agencia" />
                </Campo>
                <Campo rotulo="Conta">
                  <Entrada name="conta" />
                </Campo>
                <Campo rotulo="Chave Pix">
                  <Entrada name="pix_chave" />
                </Campo>
                <Campo rotulo="Saldo inicial (R$)">
                  <Entrada name="saldo_inicial" inputMode="decimal" placeholder="0,00" />
                </Campo>
                <Campo rotulo="Saldo inicial em" dica="Movimentos antes desta data não entram no saldo.">
                  <Entrada type="date" name="saldo_inicial_em" defaultValue={hojeISO()} />
                </Campo>
              </div>
              {!pessoal && (
                <label className="flex items-center gap-2 text-sm text-texto-2">
                  <input type="checkbox" name="terceiros" /> Conta de terceiros (aluguéis que serão repassados aos proprietários)
                </label>
              )}
            </JanelaCadastro>
          </>
        }
      />
      <AbasFinanceiro pessoal={pessoal} />

      <div className="entrar-cascata mb-6 grid grid-cols-2 gap-4 xl:grid-cols-3">
        <Indicador rotulo={pessoal ? "Saldo total" : "Saldo da empresa"} icone={<Landmark />} valor={<Contador valor={somar((c) => !c.terceiros)} formato="moeda" />} />
        {!pessoal && <Indicador rotulo="Saldo de terceiros" icone={<Landmark />} valor={<Contador valor={somar((c) => c.terceiros)} formato="moeda" />} detalhe="dinheiro dos proprietários" tom="alerta" />}
        <Indicador rotulo="Linhas do extrato a conciliar" icone={<ArrowLeftRight />} valor={<Contador valor={[...pendentes.values()].reduce((a, b) => a + b, 0)} />} tom={pendentes.size ? "alerta" : "sucesso"} />
      </div>

      <Tabela colunas={["Conta", "Tipo", "Banco", "Saldo atual", "A conciliar", ""]}>
        {op.contas.map((c) => (
          <LinhaLink key={c.id} href={`/financeiro/contas/${c.id}`}>
            <Celula>
              <span className="font-medium text-texto">{c.nome}</span>
              {c.terceiros && (
                <span className="ml-2">
                  <Selo cor="amarelo">terceiros</Selo>
                </span>
              )}
              {!c.ativa && (
                <span className="ml-2">
                  <Selo>inativa</Selo>
                </span>
              )}
            </Celula>
            <Celula>{ROTULO_TIPO_CONTA[c.tipo] ?? c.tipo}</Celula>
            <Celula>
              <span className="text-xs text-texto-2">{[c.banco, c.agencia && `ag. ${c.agencia}`, c.conta && `cc ${c.conta}`].filter(Boolean).join(" · ") || "—"}</span>
            </Celula>
            <Celula className={`font-semibold tabular-nums ${(saldos.get(c.id) ?? 0) < 0 ? "text-ruim" : "text-texto"}`}>{formatarReais(saldos.get(c.id) ?? 0)}</Celula>
            <Celula>{pendentes.get(c.id) ? <Selo cor="amarelo">{pendentes.get(c.id)} linha(s)</Selo> : "—"}</Celula>
            <Celula>
              <BotaoExcluir acao={excluirConta} id={c.id} rotulo="Excluir conta" confirmar={`Excluir a conta "${c.nome}"? Os lançamentos continuam, só perdem a conta. O extrato importado dela é apagado.`} />
            </Celula>
          </LinhaLink>
        ))}
        {op.contas.length === 0 && <LinhaVazia colunas={6}>Nenhuma conta ainda. Cadastre o banco, o caixa ou a carteira onde o dinheiro entra e sai.</LinhaVazia>}
      </Tabela>

      {transferencias.length > 0 && (
        <Cartao titulo="Transferências entre contas" className="mt-6">
          <ul className="divide-y divide-borda-suave text-sm">
            {transferencias.slice(0, 50).map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3 py-2">
                <span>
                  {formatarDataBR(t.data)} · {nome.get(t.origem_id) ?? "?"} → {nome.get(t.destino_id) ?? "?"}
                  {t.descricao && <span className="text-mudo"> · {t.descricao}</span>}
                </span>
                <span className="flex items-center gap-2 font-medium tabular-nums">
                  {formatarReais(t.valor)}
                  <BotaoExcluir acao={excluirTransferencia} id={t.id} rotulo="Excluir transferência" confirmar="Excluir esta transferência?" />
                </span>
              </li>
            ))}
          </ul>
        </Cartao>
      )}
    </>
  );
}
