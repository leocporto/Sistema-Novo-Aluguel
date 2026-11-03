import type { Metadata } from "next";
import Link from "next/link";
import { Copy, Target } from "lucide-react";
import { Contador } from "@/components/abas-segmentadas";
import { BotaoAcao } from "@/components/botao-acao";
import { Formulario } from "@/components/formulario";
import { NavegadorMes, lerMes } from "@/components/navegador-mes";
import { Cabecalho, Celula, Entrada, Indicador, LinhaVazia, Tabela } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { fimDoMes, hojeISO } from "@/lib/dominio/datas";
import { formatarReais, paraCentavos, paraReais } from "@/lib/dominio/dinheiro";
import { orcadoRealizado } from "@/lib/dominio/financeiro";
import { AbasFinanceiro } from "../abas";
import { copiarOrcamento, salvarOrcamento } from "../actions";
import { linhasRealizadas } from "../dre/dados";

export const metadata: Metadata = { title: "Orçamento" };

export default async function OrcamentoPage({ searchParams }: PageProps<"/financeiro/orcamento">) {
  const sp = await searchParams;
  const hoje = hojeISO();
  const mes = lerMes(sp.mes, hoje);
  const competencia = `${mes}-01`;
  const { supabase, organizacao } = await obterContexto();
  const pessoal = organizacao.modo === "pessoal";
  const [{ data: planos }, { data: orc }, linhas] = await Promise.all([
    supabase.from("plano_contas").select("id, codigo, nome, tipo, grupo_dre").eq("ativo", true).neq("grupo_dre", "nao_dre").order("codigo"),
    supabase.from("orcamentos").select("plano_id, valor").eq("competencia", competencia),
    linhasRealizadas(supabase, pessoal, competencia, fimDoMes(competencia)),
  ]);
  const orcado = new Map((orc ?? []).map((o) => [o.plano_id, Number(o.valor)]));
  const lista = planos ?? [];
  const tipoDoPlano = new Map(lista.map((p) => [p.id, p.tipo as string]));
  // Soma com sinal: um recebimento numa conta de despesa (reembolso, estorno) abate a despesa.
  const realizado = new Map<string, number>();
  for (const l of linhas) {
    if (!l.plano_id) continue;
    const tipo = tipoDoPlano.get(l.plano_id) ?? (l.tipo === "receber" ? "receita" : "despesa");
    const sinal = (l.tipo === "receber") === (tipo === "receita") ? 1 : -1;
    realizado.set(l.plano_id, paraReais(paraCentavos(realizado.get(l.plano_id) ?? 0) + sinal * paraCentavos(l.valor)));
  }
  const total = (tipo: string, m: Map<string, number>) => paraReais(lista.filter((p) => p.tipo === tipo).reduce((a, p) => a + paraCentavos(m.get(p.id) ?? 0), 0));
  const despOrc = total("despesa", orcado);
  const despReal = total("despesa", realizado);
  const recOrc = total("receita", orcado);
  const recReal = total("receita", realizado) + (pessoal ? (realizado.get("alugueis") ?? 0) : 0);

  const linha = (p: (typeof lista)[number]) => {
    const o = orcado.get(p.id) ?? 0;
    const r = realizado.get(p.id) ?? 0;
    const c = orcadoRealizado(o, r);
    const ruim = p.tipo === "despesa" ? c.estourou : o > 0 && r < o;
    return (
      <tr key={p.id}>
        <Celula>
          <span className="text-texto">
            {p.codigo} · {p.nome}
          </span>
        </Celula>
        <Celula>
          <Formulario acao={salvarOrcamento} automatico semAviso className="w-36">
            <input type="hidden" name="competencia" value={competencia} />
            <input type="hidden" name="plano_id" value={p.id} />
            <Entrada name="valor" aria-label={`Orçado para ${p.nome}`} inputMode="decimal" defaultValue={o ? String(o).replace(".", ",") : ""} placeholder="0,00" />
          </Formulario>
        </Celula>
        <Celula className="tabular-nums">{formatarReais(r)}</Celula>
        <Celula>
          {o > 0 ? (
            <div className="w-40">
              <div className="h-2 overflow-hidden rounded-full bg-elev">
                <div className={`h-full rounded-full ${ruim ? "bg-ruim" : "bg-ok"}`} style={{ width: `${Math.min(100, c.pct ?? 0)}%` }} />
              </div>
              <span className={`text-xs ${ruim ? "text-ruim" : "text-mudo"}`}>{c.pct}% {p.tipo === "despesa" ? "usado" : "atingido"}</span>
            </div>
          ) : (
            <span className="text-xs text-mudo">sem orçamento</span>
          )}
        </Celula>
      </tr>
    );
  };

  return (
    <>
      <Cabecalho
        titulo="Orçamento"
        trilha="Financeiro"
        descricao="Defina quanto pretende receber e gastar em cada conta do plano e acompanhe o realizado no mês. O valor salva sozinho."
        acoes={
          <BotaoAcao acao={copiarOrcamento} id={competencia} confirmar="Copiar o orçamento deste mês para os próximos 11 meses? O que já estiver preenchido lá será substituído.">
            <Copy className="size-4" /> Copiar para os próximos meses
          </BotaoAcao>
        }
      />
      <AbasFinanceiro pessoal={pessoal} />
      <div className="mb-5">
        <NavegadorMes caminho="/financeiro/orcamento" mes={mes} hoje={hoje} />
      </div>
      <div className="entrar-cascata mb-6 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Indicador rotulo="Receita orçada" icone={<Target />} valor={<Contador valor={recOrc} formato="moeda" />} />
        <Indicador rotulo="Receita realizada" icone={<Target />} valor={<Contador valor={recReal} formato="moeda" />} tom="sucesso" />
        <Indicador rotulo="Despesa orçada" icone={<Target />} valor={<Contador valor={despOrc} formato="moeda" />} />
        <Indicador rotulo="Despesa realizada" icone={<Target />} valor={<Contador valor={despReal} formato="moeda" />} tom={despOrc > 0 && despReal > despOrc ? "perigo" : "neutro"} detalhe={despOrc > 0 ? `${Math.round((despReal / despOrc) * 100)}% do orçado` : undefined} />
      </div>
      {lista.length === 0 ? (
        <Tabela colunas={["Conta"]}>
          <LinhaVazia colunas={1}>
            O orçamento usa o plano de contas.{" "}
            <Link href="/financeiro/plano" className="text-acento hover:underline">
              Instale o plano padrão
            </Link>{" "}
            primeiro.
          </LinhaVazia>
        </Tabela>
      ) : (
        <div className="space-y-6">
          <div>
            <h3 className="mb-2 text-[15px] font-semibold text-texto">Receitas</h3>
            <Tabela colunas={["Conta", "Orçado", "Realizado", "Andamento"]}>{lista.filter((p) => p.tipo === "receita").map(linha)}</Tabela>
          </div>
          <div>
            <h3 className="mb-2 text-[15px] font-semibold text-texto">Despesas</h3>
            <Tabela colunas={["Conta", "Orçado", "Realizado", "Andamento"]}>{lista.filter((p) => p.tipo === "despesa").map(linha)}</Tabela>
          </div>
          {pessoal && (realizado.get("alugueis") ?? 0) > 0 && (
            <p className="text-xs text-mudo">Aluguéis recebidos no mês: {formatarReais(realizado.get("alugueis") ?? 0)} (já somados na receita realizada).</p>
          )}
        </div>
      )}
    </>
  );
}
