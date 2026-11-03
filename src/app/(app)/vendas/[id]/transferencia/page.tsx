import type { Metadata } from "next";
import { Calculator, Plus } from "lucide-react";
import { BotaoExcluir } from "@/components/botao-excluir";
import { BotaoEnviar, Formulario } from "@/components/formulario";
import { JanelaCadastro } from "@/components/janela-cadastro";
import { Campo, Cartao, Celula, Entrada, LinhaVazia, Selecao, Selo, Tabela } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { formatarDataBR } from "@/lib/dominio/datas";
import { formatarReais } from "@/lib/dominio/dinheiro";
import { ROTULO_TIPO_DESPESA } from "@/lib/dominio/vendas";
import { adicionarDespesaVenda, alternarDespesaVenda, atualizarVenda, calcularItbiVenda, excluirDespesaVenda } from "../../actions";

export const metadata: Metadata = { title: "ITBI, escritura e registro" };

type D = { id: string; tipo: string; descricao: string | null; valor: number; responsavel: string; vencimento: string | null; pago_em: string | null };
const RESP: Record<string, string> = { comprador: "Comprador", vendedor: "Vendedor", imobiliaria: "Imobiliária" };

export default async function TransferenciaVenda({ params }: PageProps<"/vendas/[id]/transferencia">) {
  const { id } = await params;
  const { supabase } = await obterContexto();
  const [{ data: v }, { data }] = await Promise.all([
    supabase.from("vendas").select("valor, itbi_aliquota, itbi_valor, itbi_pago_em, cartorio, escritura_data, registro_data, matricula").eq("id", id).single(),
    supabase.from("venda_despesas").select("*").eq("venda_id", id).order("tipo"),
  ]);
  const despesas = ((data ?? []) as D[]).map((d) => ({ ...d, valor: Number(d.valor) }));
  const porResp = Object.keys(RESP).map((k) => [k, despesas.filter((d) => d.responsavel === k).reduce((s, d) => s + d.valor, 0)] as const);
  const val = (n: unknown) => (n === null || n === undefined ? "" : String(n));

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
      <div className="space-y-6">
        <Cartao
          titulo="Despesas de transferência"
          acoes={
            <JanelaCadastro rotuloBotao={<><Plus className="size-3.5" /> Incluir</>} tamanho="sm" titulo="Despesa da transferência" acao={adicionarDespesaVenda} rotuloSalvar="Incluir">
              <input type="hidden" name="venda_id" value={id} />
              <div className="grid gap-4 sm:grid-cols-2">
                <Campo rotulo="Tipo">
                  <Selecao name="tipo" defaultValue="escritura">
                    {Object.entries(ROTULO_TIPO_DESPESA).map(([k, r]) => (
                      <option key={k} value={k}>
                        {r}
                      </option>
                    ))}
                  </Selecao>
                </Campo>
                <Campo rotulo="Valor (R$)">
                  <Entrada name="valor" inputMode="decimal" required />
                </Campo>
                <Campo rotulo="Quem paga">
                  <Selecao name="responsavel" defaultValue="comprador">
                    {Object.entries(RESP).map(([k, r]) => (
                      <option key={k} value={k}>
                        {r}
                      </option>
                    ))}
                  </Selecao>
                </Campo>
                <Campo rotulo="Vencimento">
                  <Entrada type="date" name="vencimento" />
                </Campo>
              </div>
              <Campo rotulo="Descrição">
                <Entrada name="descricao" placeholder="Tabelionato X, certidões do vendedor…" />
              </Campo>
            </JanelaCadastro>
          }
        >
          <Tabela colunas={["Despesa", "Quem paga", "Vencimento", "Valor", "Situação", ""]}>
            {despesas.map((d) => (
              <tr key={d.id}>
                <Celula>
                  <span className="font-medium text-texto">{ROTULO_TIPO_DESPESA[d.tipo]}</span>
                  {d.descricao && <span className="block text-xs text-mudo">{d.descricao}</span>}
                </Celula>
                <Celula>{RESP[d.responsavel]}</Celula>
                <Celula>{formatarDataBR(d.vencimento)}</Celula>
                <Celula className="tabular-nums">{formatarReais(d.valor)}</Celula>
                <Celula>{d.pago_em ? <Selo cor="verde">pago {formatarDataBR(d.pago_em)}</Selo> : <Selo cor="amarelo">a pagar</Selo>}</Celula>
                <Celula>
                  <div className="flex items-center justify-end gap-2">
                    <form action={alternarDespesaVenda}>
                      <input type="hidden" name="id" value={d.id} />
                      <input type="hidden" name="pagar" value={d.pago_em ? "0" : "1"} />
                      <BotaoEnviar variante={d.pago_em ? "fantasma" : "secundario"}>{d.pago_em ? "Desfazer" : "Pago"}</BotaoEnviar>
                    </form>
                    <BotaoExcluir acao={excluirDespesaVenda} id={d.id} rotulo="Excluir despesa" confirmar="Excluir esta despesa?" />
                  </div>
                </Celula>
              </tr>
            ))}
            {despesas.length === 0 && <LinhaVazia colunas={6}>Nenhuma despesa. Calcule o ITBI ao lado e inclua escritura e registro.</LinhaVazia>}
          </Tabela>
          <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-sm text-texto-2">
            {porResp.map(([k, total]) => (
              <span key={k}>
                {RESP[k]}: <strong className="tabular-nums text-texto">{formatarReais(total)}</strong>
              </span>
            ))}
          </div>
        </Cartao>

        <Formulario acao={atualizarVenda} automatico>
          <input type="hidden" name="id" value={id} />
          <Cartao titulo="Escritura e registro">
            <div className="grid gap-4 sm:grid-cols-2">
              <Campo rotulo="Tabelionato / cartório">
                <Entrada name="cartorio" defaultValue={v?.cartorio ?? ""} placeholder="2º Tabelião de Notas de Santos" />
              </Campo>
              <Campo rotulo="Matrícula">
                <Entrada name="matricula" defaultValue={v?.matricula ?? ""} />
              </Campo>
              <Campo rotulo="Escritura assinada em">
                <Entrada type="date" name="escritura_data" defaultValue={v?.escritura_data ?? ""} />
              </Campo>
              <Campo rotulo="Registrada em">
                <Entrada type="date" name="registro_data" defaultValue={v?.registro_data ?? ""} />
              </Campo>
            </div>
          </Cartao>
        </Formulario>
      </div>

      <Cartao titulo="ITBI">
        <Formulario acao={atualizarVenda} automatico className="space-y-4">
          <input type="hidden" name="id" value={id} />
          <div className="grid grid-cols-2 gap-3">
            <Campo rotulo="Alíquota (%)" dica="Varia por cidade (2% a 3%)">
              <Entrada name="itbi_aliquota" inputMode="decimal" defaultValue={val(v?.itbi_aliquota)} />
            </Campo>
            <Campo rotulo="Valor do ITBI">
              <Entrada name="itbi_valor" inputMode="decimal" defaultValue={val(v?.itbi_valor)} />
            </Campo>
          </div>
          <Campo rotulo="Pago em">
            <Entrada type="date" name="itbi_pago_em" defaultValue={v?.itbi_pago_em ?? ""} />
          </Campo>
        </Formulario>
        <form action={calcularItbiVenda} className="mt-4 space-y-3 border-t border-borda-suave pt-4">
          <input type="hidden" name="id" value={id} />
          <Campo rotulo="Valor venal (opcional)" dica="A prefeitura cobra sobre o maior entre o valor da venda e o venal.">
            <Entrada name="valor_venal" inputMode="decimal" />
          </Campo>
          <BotaoEnviar variante="secundario">
            <Calculator className="size-4" /> Calcular sobre {formatarReais(v?.valor)}
          </BotaoEnviar>
        </form>
      </Cartao>
    </div>
  );
}
