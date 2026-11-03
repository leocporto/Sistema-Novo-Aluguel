import type { Metadata } from "next";
import Link from "next/link";
import { UserPlus } from "lucide-react";
import { BotaoExcluir } from "@/components/botao-excluir";
import { Formulario } from "@/components/formulario";
import { JanelaCadastro } from "@/components/janela-cadastro";
import { Campo, Cartao, Celula, Entrada, LinhaVazia, Selecao, Selo, Tabela } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { formatarReais } from "@/lib/dominio/dinheiro";
import { ROTULO_PAPEL_COMISSAO, comissaoTotal, dividirComissao } from "@/lib/dominio/vendas";
import { adicionarComissaoVenda, atualizarVenda, excluirComissaoVenda } from "../../actions";
import { carregarOpcoesVenda } from "../../dados";

export const metadata: Metadata = { title: "Comissões da venda" };

type C = { id: string; papel: string; percentual: number; lancamento_id: string | null; pessoa: { id: string; nome: string } | null; lancamento: { status: string } | null };

export default async function ComissoesVenda({ params }: PageProps<"/vendas/[id]/comissoes">) {
  const { id } = await params;
  const { supabase } = await obterContexto();
  const [{ data: v }, { data }, opcoes] = await Promise.all([
    supabase.from("vendas").select("valor, comissao_pct, comissao_valor, status").eq("id", id).single(),
    supabase.from("venda_comissoes").select("id, papel, percentual, lancamento_id, pessoa:pessoas(id, nome), lancamento:lancamentos(status)").eq("venda_id", id),
    carregarOpcoesVenda(supabase),
  ]);
  const lista = ((data ?? []) as unknown as C[]).filter((c) => c.papel !== "imobiliaria");
  const total = comissaoTotal(Number(v?.valor ?? 0), Number(v?.comissao_pct ?? 0), v?.comissao_valor == null ? null : Number(v.comissao_valor));
  let divisao = { porPessoa: lista.map(() => 0), imobiliaria: total, distribuido: 0 };
  try {
    divisao = dividirComissao(total, lista.map((c) => ({ percentual: Number(c.percentual) })));
  } catch {
    /* soma > 100%: mostra o aviso abaixo */
  }
  const soma = lista.reduce((s, c) => s + Number(c.percentual), 0);
  const val = (n: unknown) => (n === null || n === undefined ? "" : String(n));

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
      <Cartao
        titulo="Divisão da comissão"
        acoes={
          v?.status !== "concluida" && (
            <JanelaCadastro rotuloBotao={<><UserPlus className="size-3.5" /> Incluir</>} tamanho="sm" titulo="Incluir na divisão" acao={adicionarComissaoVenda} rotuloSalvar="Incluir">
              <input type="hidden" name="venda_id" value={id} />
              <Campo rotulo="Pessoa (corretor ou parceiro)">
                <Selecao name="pessoa_id" required defaultValue="">
                  <option value="">Selecione…</option>
                  {opcoes.corretores.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nome}
                    </option>
                  ))}
                </Selecao>
              </Campo>
              <div className="grid grid-cols-2 gap-3">
                <Campo rotulo="Papel">
                  <Selecao name="papel" defaultValue="vendedor">
                    {Object.entries(ROTULO_PAPEL_COMISSAO)
                      .filter(([k]) => k !== "imobiliaria")
                      .map(([k, r]) => (
                        <option key={k} value={k}>
                          {r}
                        </option>
                      ))}
                  </Selecao>
                </Campo>
                <Campo rotulo="% da comissão">
                  <Entrada name="percentual" inputMode="decimal" required defaultValue={String(Math.max(0, 100 - soma) || "")} />
                </Campo>
              </div>
              {opcoes.corretores.length === 0 && (
                <p className="text-xs text-mudo">
                  Cadastre corretores e parceiros em{" "}
                  <Link href="/pessoas/novo?papel=corretor" className="text-acento hover:underline">
                    Pessoas
                  </Link>
                  .
                </p>
              )}
            </JanelaCadastro>
          )
        }
      >
        {soma > 100 && <p className="mb-3 rounded-[12px] border border-ruim-bd bg-ruim-bg px-3 py-2 text-sm text-ruim">A divisão passa de 100% da comissão ({soma}%). Ajuste antes de concluir.</p>}
        <Tabela colunas={["Quem", "Papel", "% da comissão", "Valor", "Financeiro", ""]}>
          {lista.map((c, i) => (
            <tr key={c.id}>
              <Celula>
                {c.pessoa ? (
                  <Link href={`/pessoas/${c.pessoa.id}`} className="font-medium text-texto hover:underline">
                    {c.pessoa.nome}
                  </Link>
                ) : (
                  "—"
                )}
              </Celula>
              <Celula>{ROTULO_PAPEL_COMISSAO[c.papel]}</Celula>
              <Celula className="tabular-nums">{String(Number(c.percentual)).replace(".", ",")}%</Celula>
              <Celula className="tabular-nums">{formatarReais(divisao.porPessoa[i] ?? 0)}</Celula>
              <Celula>{c.lancamento ? <Selo cor={c.lancamento.status === "liquidado" ? "verde" : "amarelo"}>{c.lancamento.status === "liquidado" ? "paga" : "a pagar"}</Selo> : <Selo>prevista</Selo>}</Celula>
              <Celula>
                <BotaoExcluir acao={excluirComissaoVenda} id={c.id} rotulo="Tirar da divisão" confirmar="Tirar esta pessoa da divisão?" />
              </Celula>
            </tr>
          ))}
          <tr className="bg-elev/50">
            <Celula>
              <span className="font-medium text-texto">Imobiliária</span>
            </Celula>
            <Celula>Fica com o resto</Celula>
            <Celula className="tabular-nums">{String(Math.max(0, Math.round((100 - soma) * 1000) / 1000)).replace(".", ",")}%</Celula>
            <Celula className="tabular-nums font-semibold">{formatarReais(divisao.imobiliaria)}</Celula>
            <Celula>{" "}</Celula>
            <Celula>{" "}</Celula>
          </tr>
          {lista.length === 0 && <LinhaVazia colunas={6}>Ninguém na divisão: a comissão inteira fica com a imobiliária.</LinhaVazia>}
        </Tabela>
        <p className="mt-3 text-xs text-mudo">
          Ao concluir a venda, a comissão total entra em Financeiro como “a receber” e a parte de cada pessoa como “a pagar” (vencimento em 30 dias).
        </p>
      </Cartao>

      <Cartao titulo="Comissão da venda">
        <div className="mb-4 text-[26px] font-semibold tabular-nums text-texto">{formatarReais(total)}</div>
        <Formulario acao={atualizarVenda} automatico className="space-y-4">
          <input type="hidden" name="id" value={id} />
          <Campo rotulo="Percentual sobre a venda (%)">
            <Entrada name="comissao_pct" inputMode="decimal" defaultValue={val(v?.comissao_pct)} disabled={v?.status === "concluida"} />
          </Campo>
          <Campo rotulo="Ou valor combinado (R$)" dica="Se preencher, vale este valor no lugar do %.">
            <Entrada name="comissao_valor" inputMode="decimal" defaultValue={val(v?.comissao_valor)} disabled={v?.status === "concluida"} />
          </Campo>
        </Formulario>
      </Cartao>
    </div>
  );
}
