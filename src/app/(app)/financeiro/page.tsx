import type { Metadata } from "next";
import { revalidatePath } from "next/cache";
import { BotaoExcluir } from "@/components/botao-excluir";
import { BotaoEnviar, Formulario } from "@/components/formulario";
import { Cabecalho, Campo, Cartao, Celula, Entrada, Indicador, LinhaVazia, Selecao, Selo, Tabela } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { fimDoMes, formatarDataBR, hojeISO } from "@/lib/dominio/datas";
import { formatarReais } from "@/lib/dominio/dinheiro";
import { type EstadoAcao, ErroValidacao, mensagemErro, numero, texto, textoObrigatorio } from "@/lib/form";
import { FiltroAutomatico } from "@/components/filtro-automatico";
import { ArrowLeftRight, Scale, TrendingDown, TrendingUp } from "lucide-react";
import { Contador } from "@/components/abas-segmentadas";

export const metadata: Metadata = { title: "Financeiro" };

type Lanc = {
  id: string;
  tipo: "receber" | "pagar";
  descricao: string;
  categoria: string | null;
  valor: number;
  vencimento: string;
  status: string;
  liquidado_em: string | null;
};

async function novoLancamento(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  "use server";
  const { supabase } = await obterContexto();
  try {
    const valor = numero(fd, "valor");
    if (!valor || valor <= 0) throw new ErroValidacao("Informe o valor.");
    const { error } = await supabase.from("lancamentos").insert({
      tipo: texto(fd, "tipo") === "receber" ? "receber" : "pagar",
      descricao: textoObrigatorio(fd, "descricao", "a descrição"),
      categoria: texto(fd, "categoria"),
      valor,
      vencimento: textoObrigatorio(fd, "vencimento", "o vencimento"),
    });
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidatePath("/financeiro");
  return { ok: "Lançamento criado." };
}

async function liquidar(fd: FormData) {
  "use server";
  const { supabase } = await obterContexto();
  await supabase
    .from("lancamentos")
    .update({ status: "liquidado", liquidado_em: hojeISO() })
    .eq("id", String(fd.get("id")))
    .eq("status", "aberto");
  revalidatePath("/financeiro");
}

async function excluirLancamento(id: string): Promise<{ ok: boolean; erro?: string }> {
  "use server";
  const { supabase } = await obterContexto();
  const { data } = await supabase.from("lancamentos").select("fatura_id").eq("id", id).maybeSingle();
  if (data?.fatura_id)
    return { ok: false, erro: "Este lançamento foi gerado pelo pagamento de um aluguel. Para tirar, desfaça o pagamento em Aluguéis do mês." };
  const { error } = await supabase.from("lancamentos").delete().eq("id", id);
  if (error) return { ok: false, erro: mensagemErro(error) };
  revalidatePath("/financeiro");
  revalidatePath("/despesas");
  revalidatePath("/");
  return { ok: true };
}

export default async function FinanceiroPage({ searchParams }: PageProps<"/financeiro">) {
  const sp = await searchParams;
  const mes = typeof sp.mes === "string" && sp.mes ? sp.mes : hojeISO().slice(0, 7);
  const { supabase, organizacao } = await obterContexto();
  const [{ data: lancRaw }, { data: repassesPend }] = await Promise.all([
    supabase.from("lancamentos").select("*").gte("vencimento", `${mes}-01`).lte("vencimento", fimDoMes(`${mes}-01`)).neq("status", "cancelado").order("vencimento"),
    supabase.from("repasses").select("valor_liquido").eq("status", "pendente").lte("previsto_para", fimDoMes(`${mes}-01`)),
  ]);
  const lanc = (lancRaw ?? []) as Lanc[];
  const soma = (f: (l: Lanc) => boolean) => lanc.filter(f).reduce((s, l) => s + Number(l.valor), 0);
  const receitas = soma((l) => l.tipo === "receber");
  const despesas = soma((l) => l.tipo === "pagar");
  const aRepassar = (repassesPend ?? []).reduce((s, r) => s + Number(r.valor_liquido), 0);

  return (
    <>
      <Cabecalho
        titulo="Financeiro da imobiliária"
        descricao="Contas a pagar e a receber. As taxas de administração entram automaticamente na baixa das faturas."
      />
      <div className="entrar-cascata mb-6 grid grid-cols-1 gap-4 sm:grid-cols-4">
        <Indicador rotulo="Receitas do mês" icone={<TrendingUp />} valor={<Contador valor={receitas} formato="moeda" />} tom="sucesso" />
        <Indicador rotulo="Despesas do mês" icone={<TrendingDown />} valor={<Contador valor={despesas} formato="moeda" />} tom="perigo" />
        <Indicador rotulo="Resultado" icone={<Scale />} valor={<Contador valor={receitas - despesas} formato="moeda" />} tom={receitas - despesas >= 0 ? "sucesso" : "perigo"} />
        {organizacao.modo !== "pessoal" && (
          <Indicador rotulo="Repasses pendentes até o fim do mês" icone={<ArrowLeftRight />} valor={<Contador valor={aRepassar} formato="moeda" />} href="/repasses" tom="alerta" />
        )}
      </div>
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div>
          <FiltroAutomatico className="mb-4 flex gap-2">
            <Entrada type="month" name="mes" defaultValue={mes} className="w-44" />
          </FiltroAutomatico>
          <Tabela colunas={["Vencimento", "Descrição", "Categoria", "Tipo", "Valor", "Situação", ""]}>
            {lanc.length === 0 && <LinhaVazia colunas={7}>Nenhum lançamento no mês.</LinhaVazia>}
            {lanc.map((l) => (
              <tr key={l.id}>
                <Celula>{formatarDataBR(l.vencimento)}</Celula>
                <Celula>{l.descricao}</Celula>
                <Celula>{l.categoria ?? "—"}</Celula>
                <Celula>
                  <Selo cor={l.tipo === "receber" ? "verde" : "vermelho"}>{l.tipo === "receber" ? "receita" : "despesa"}</Selo>
                </Celula>
                <Celula className="font-medium">{formatarReais(l.valor)}</Celula>
                <Celula>
                  {l.status === "liquidado" ? (
                    <span className="text-xs text-mudo">liquidado {formatarDataBR(l.liquidado_em)}</span>
                  ) : (
                    <form action={liquidar}>
                      <input type="hidden" name="id" value={l.id} />
                      <button className="text-sm text-acento hover:underline">Liquidar</button>
                    </form>
                  )}
                </Celula>
                <Celula>
                  <BotaoExcluir acao={excluirLancamento} id={l.id} rotulo="Excluir lançamento" confirmar={`Excluir "${l.descricao}"?`} />
                </Celula>
              </tr>
            ))}
          </Tabela>
        </div>
        <Cartao titulo="Novo lançamento">
          <Formulario acao={novoLancamento} className="space-y-3">
            <Campo rotulo="Tipo">
              <Selecao name="tipo" defaultValue="pagar">
                <option value="pagar">Conta a pagar</option>
                <option value="receber">Conta a receber</option>
              </Selecao>
            </Campo>
            <Campo rotulo="Descrição">
              <Entrada name="descricao" required />
            </Campo>
            <Campo rotulo="Categoria">
              <Entrada name="categoria" placeholder="Aluguel do escritório, comissão…" />
            </Campo>
            <Campo rotulo="Valor (R$)">
              <Entrada name="valor" required inputMode="decimal" />
            </Campo>
            <Campo rotulo="Vencimento">
              <Entrada type="date" name="vencimento" required defaultValue={hojeISO()} />
            </Campo>
            <BotaoEnviar>Adicionar</BotaoEnviar>
          </Formulario>
        </Cartao>
      </div>
    </>
  );
}
