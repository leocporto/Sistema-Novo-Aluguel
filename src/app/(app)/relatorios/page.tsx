import type { Metadata } from "next";
import { GraficoComparativo } from "@/components/grafico-comparativo";
import { Cabecalho, Cartao } from "@/components/ui";
import { lerPeriodo, queryPeriodo, receitaImobiliaria } from "@/lib/dominio/bi";
import { fimDoMes, hojeISO, somarMeses } from "@/lib/dominio/datas";
import { AbasRelatorios } from "./abas";
import { BotoesExportar, ComoCalculamos, KpiBi } from "./componentes";
import { carregarFinanceiro, contextoRelatorios } from "./dados";
import { DESTINO_KPI, ICONE_KPI } from "./icones";
import { calcularIndicadores } from "./indicadores";
import { PeriodoImpresso, SeletorPeriodo } from "./periodo";

export const metadata: Metadata = { title: "Relatórios" };

export default async function RelatoriosPage({ searchParams }: PageProps<"/relatorios">) {
  const sp = await searchParams;
  const hoje = hojeISO();
  const periodo = lerPeriodo(sp, hoje);
  const { supabase, imob } = await contextoRelatorios();
  const mesFim = `${periodo.fim.slice(0, 7)}-01`;
  const [kpis, serie] = await Promise.all([
    calcularIndicadores(supabase, periodo, periodo.anterior, imob),
    carregarFinanceiro(supabase, somarMeses(mesFim, -23), fimDoMes(mesFim)),
  ]);
  const valor = (l: (typeof serie)[number]) => (imob ? receitaImobiliaria(l) : l.aluguel_recebido);
  const ultimos = serie.slice(-12);
  const antes = serie.slice(0, Math.max(0, serie.length - 12)).slice(-12);
  const q = queryPeriodo(periodo);

  return (
    <>
      <Cabecalho
        titulo="Relatórios"
        descricao={
          imob
            ? "Os números da imobiliária no período, comparados com o período anterior: receitas, aluguéis, inadimplência, imóveis e o comercial. Passe o mouse num indicador para ver como ele é calculado."
            : "Os números dos seus imóveis no período, comparados com o período anterior: aluguéis recebidos, resultado, inadimplência, ocupação e vacância. Passe o mouse num indicador para ver como ele é calculado."
        }
        acoes={<BotoesExportar consulta={`r=visao_geral&${q}`} rotulo="a visão geral" />}
      />
      <AbasRelatorios />
      <SeletorPeriodo caminho="/relatorios" periodo={periodo} hoje={hoje} />
      <PeriodoImpresso periodo={periodo} />

      <div className="entrar-cascata mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((k) => (
          <KpiBi key={k.chave} k={k} icone={ICONE_KPI[k.chave]} href={DESTINO_KPI[k.chave] ? `${DESTINO_KPI[k.chave]}?${q}` : undefined} />
        ))}
      </div>

      {ultimos.length > 0 && (
        <Cartao titulo={imob ? "Receita da imobiliária — últimos 12 meses" : "Aluguéis recebidos — últimos 12 meses"}>
          <GraficoComparativo
            meses={ultimos.map((l) => l.mes.slice(0, 7))}
            atual={ultimos.map(valor)}
            anterior={ultimos.map((_, i) => (antes[i] ? valor(antes[i]) : 0))}
          />
        </Cartao>
      )}

      <ComoCalculamos
        itens={kpis.map((k) => [k.rotulo, k.explicacao] as [string, string]).concat([
          ["Comparação", "Cada número é comparado com o período anterior do mesmo tamanho. Se o período ainda não terminou, a comparação vai só até o mesmo ponto do anterior (ex.: dia 1 a 4 contra dia 1 a 4)."],
        ])}
      />
    </>
  );
}
