import type { Metadata } from "next";
import { Plus } from "lucide-react";
import { BarraProgresso } from "@/components/barra-progresso";
import { BotaoExcluir } from "@/components/botao-excluir";
import { BotaoEnviar, Formulario } from "@/components/formulario";
import { JanelaCadastro } from "@/components/janela-cadastro";
import { AreaTexto, Campo, Cartao, Celula, Entrada, LinhaVazia, Selecao, Selo, Tabela } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { formatarDataBR, hojeISO } from "@/lib/dominio/datas";
import { formatarReais } from "@/lib/dominio/dinheiro";
import { ETAPAS_FINANCIAMENTO, ROTULO_FINANCIAMENTO, ROTULO_TIPO_PAGAMENTO, resumoPagamentos } from "@/lib/dominio/vendas";
import { adicionarPagamento, alternarPagamento, atualizarVenda, excluirPagamento } from "../../actions";

export const metadata: Metadata = { title: "Pagamentos da venda" };

type Pg = { id: string; tipo: string; descricao: string | null; valor: number; vencimento: string | null; pago_em: string | null };

export default async function PagamentosVenda({ params }: PageProps<"/vendas/[id]/pagamentos">) {
  const { id } = await params;
  const { supabase } = await obterContexto();
  const hoje = hojeISO();
  const [{ data: v }, { data }] = await Promise.all([
    supabase.from("vendas").select("valor, forma_pagamento, banco, valor_financiado, fin_status, fin_observacoes").eq("id", id).single(),
    supabase.from("venda_pagamentos").select("*").eq("venda_id", id).order("vencimento", { nullsFirst: false }),
  ]);
  const lista = ((data ?? []) as Pg[]).map((p) => ({ ...p, valor: Number(p.valor) }));
  const r = resumoPagamentos(lista, Number(v?.valor ?? 0), hoje);
  const passoFin = (ETAPAS_FINANCIAMENTO as readonly string[]).indexOf(v?.fin_status ?? "");

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
      <div className="space-y-6">
        <div className="entrar-cascata grid gap-4 sm:grid-cols-4">
          {[
            ["Pago", r.pago, "text-ok"],
            ["A receber", r.aReceber, "text-texto"],
            ["Em atraso", r.atrasado, r.atrasado ? "text-ruim" : "text-texto"],
            ["Sem cronograma", r.semCronograma, r.semCronograma ? "text-alerta" : "text-texto"],
          ].map(([rot, val, cor]) => (
            <div key={rot as string} className="rounded-card border border-borda bg-card p-4">
              <div className="text-[13px] font-medium text-texto-2">{rot}</div>
              <div className={`mt-1 text-[20px] font-semibold tabular-nums ${cor}`}>{formatarReais(val as number)}</div>
            </div>
          ))}
        </div>
        <Cartao
          titulo="Cronograma do comprador"
          acoes={
            <JanelaCadastro rotuloBotao={<><Plus className="size-3.5" /> Incluir</>} tamanho="sm" titulo="Incluir pagamento" acao={adicionarPagamento} rotuloSalvar="Incluir">
              <input type="hidden" name="venda_id" value={id} />
              <div className="grid gap-4 sm:grid-cols-2">
                <Campo rotulo="Tipo">
                  <Selecao name="tipo" defaultValue="sinal">
                    {Object.entries(ROTULO_TIPO_PAGAMENTO).map(([k, r2]) => (
                      <option key={k} value={k}>
                        {r2}
                      </option>
                    ))}
                  </Selecao>
                </Campo>
                <Campo rotulo="Valor de cada (R$)">
                  <Entrada name="valor" inputMode="decimal" required />
                </Campo>
                <Campo rotulo="Vencimento (1ª)">
                  <Entrada type="date" name="vencimento" defaultValue={hoje} />
                </Campo>
                <Campo rotulo="Quantas vezes" dica="Mensais a partir da 1ª">
                  <Entrada type="number" name="vezes" min={1} max={120} defaultValue={1} />
                </Campo>
              </div>
              <Campo rotulo="Descrição">
                <Entrada name="descricao" placeholder="Sinal no compromisso, parcela intermediária…" />
              </Campo>
              <label className="flex items-center gap-2 text-sm text-texto-2">
                <input type="checkbox" name="ja_pago" /> Já foi pago (só quando for 1 vez)
              </label>
            </JanelaCadastro>
          }
        >
          <BarraProgresso pct={r.pctPago} atingida={r.pctPago >= 100} />
          <p className="mb-3 mt-1 text-xs text-mudo">{r.pctPago}% do valor da venda já pago</p>
          <Tabela colunas={["Tipo", "Vencimento", "Valor", "Situação", ""]}>
            {lista.map((p) => {
              const atrasado = !p.pago_em && p.vencimento && p.vencimento < hoje;
              return (
                <tr key={p.id}>
                  <Celula>
                    <span className="font-medium text-texto">{ROTULO_TIPO_PAGAMENTO[p.tipo]}</span>
                    {p.descricao && <span className="block text-xs text-mudo">{p.descricao}</span>}
                  </Celula>
                  <Celula className={atrasado ? "text-ruim" : ""}>{formatarDataBR(p.vencimento)}</Celula>
                  <Celula className="tabular-nums">{formatarReais(p.valor)}</Celula>
                  <Celula>{p.pago_em ? <Selo cor="verde">pago {formatarDataBR(p.pago_em)}</Selo> : atrasado ? <Selo cor="vermelho">atrasado</Selo> : <Selo cor="amarelo">a receber</Selo>}</Celula>
                  <Celula>
                    <div className="flex items-center justify-end gap-2">
                      <form action={alternarPagamento}>
                        <input type="hidden" name="id" value={p.id} />
                        <input type="hidden" name="pagar" value={p.pago_em ? "0" : "1"} />
                        <BotaoEnviar variante={p.pago_em ? "fantasma" : "secundario"}>{p.pago_em ? "Desfazer" : "Recebido"}</BotaoEnviar>
                      </form>
                      <BotaoExcluir acao={excluirPagamento} id={p.id} rotulo="Excluir pagamento" confirmar="Excluir este pagamento do cronograma?" />
                    </div>
                  </Celula>
                </tr>
              );
            })}
            {lista.length === 0 && <LinhaVazia colunas={5}>Nenhum pagamento no cronograma. Comece pelo sinal.</LinhaVazia>}
          </Tabela>
        </Cartao>
      </div>

      <Cartao titulo="Financiamento bancário">
        {v?.forma_pagamento !== "financiamento" && v?.forma_pagamento !== "misto" && (
          <p className="mb-3 text-xs text-mudo">A forma de pagamento desta venda não usa financiamento — preencha só se mudar.</p>
        )}
        <ol className="mb-4 space-y-1.5">
          {ETAPAS_FINANCIAMENTO.map((e, i) => (
            <li key={e} className={`flex items-center gap-2 text-sm ${i <= passoFin ? "text-ok" : "text-mudo"}`}>
              <span className={`grid size-5 place-items-center rounded-full border text-[10px] font-semibold ${i <= passoFin ? "border-ok-bd bg-ok-bg" : "border-borda"}`}>{i + 1}</span>
              {ROTULO_FINANCIAMENTO[e]}
            </li>
          ))}
          {v?.fin_status === "negado" && <li className="text-sm font-semibold text-ruim">Crédito negado</li>}
        </ol>
        <Formulario acao={atualizarVenda} automatico className="space-y-4">
          <input type="hidden" name="id" value={id} />
          <Campo rotulo="Situação">
            <Selecao name="fin_status" defaultValue={v?.fin_status ?? "nao_se_aplica"}>
              {Object.entries(ROTULO_FINANCIAMENTO).map(([k, r2]) => (
                <option key={k} value={k}>
                  {r2}
                </option>
              ))}
            </Selecao>
          </Campo>
          <div className="grid grid-cols-2 gap-3">
            <Campo rotulo="Banco">
              <Entrada name="banco" defaultValue={v?.banco ?? ""} placeholder="Caixa, Itaú…" />
            </Campo>
            <Campo rotulo="Valor financiado">
              <Entrada name="valor_financiado" inputMode="decimal" defaultValue={v?.valor_financiado == null ? "" : String(v.valor_financiado)} />
            </Campo>
          </div>
          <Campo rotulo="Anotações do financiamento">
            <AreaTexto name="fin_observacoes" rows={3} defaultValue={v?.fin_observacoes ?? ""} placeholder="Gerente, protocolo, pendências do banco…" />
          </Campo>
        </Formulario>
      </Cartao>
    </div>
  );
}
