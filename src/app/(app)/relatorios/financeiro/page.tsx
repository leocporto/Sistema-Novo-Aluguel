import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeftRight, Building2, CalendarClock, HandCoins, Handshake, Receipt, TrendingDown, TrendingUp, TriangleAlert, Wallet } from "lucide-react";
import { LinhaLink } from "@/components/linha-link";
import { PilulasLink } from "@/components/pilulas-link";
import { Cabecalho, Cartao, Celula, LinhaVazia, Tabela } from "@/components/ui";
import {
  diasDoIntervalo,
  formatarPct,
  inadimplenciaPorCompetencia,
  inadimplenciaPorVencimento,
  lerPeriodo,
  queryPeriodo,
  receitaImobiliaria,
  rendimentoAnual,
  resultadoFinanceiro,
  somarFinanceiro,
  type TotaisFinanceiro,
} from "@/lib/dominio/bi";
import { diasEntre, formatarCompetencia, formatarDataBR, hojeISO } from "@/lib/dominio/datas";
import { formatarReais } from "@/lib/dominio/dinheiro";
import { AbasRelatorios } from "../abas";
import { BotoesExportar, ComoCalculamos, KpiBi, TabelaRelatorioView } from "../componentes";
import { carregarFinanceiro, carregarRentabilidade, contextoRelatorios } from "../dados";
import { montarIndicador, type Indicador } from "../indicadores";
import { PeriodoImpresso, SeletorPeriodo } from "../periodo";
import { montarRelatorio } from "../tabelas";

export const metadata: Metadata = { title: "Relatórios · Financeiro" };

type Inad = {
  id: string;
  numero: number;
  competencia: string;
  vencimento: string;
  valor_total: number;
  valor_abatido: number;
  status: string;
  contrato: { id: string; numero: number; imovel: { codigo: string } | null; contrato_partes: { papel: string; pessoa: { nome: string; telefone: string | null } | null }[] } | null;
};

export default async function FinanceiroRelatorioPage({ searchParams }: PageProps<"/relatorios/financeiro">) {
  const sp = await searchParams;
  const hoje = hojeISO();
  const periodo = lerPeriodo(sp, hoje);
  const por = sp.rent === "contrato" ? "contrato" : "imovel";
  const { supabase, imob } = await contextoRelatorios();
  const [linA, linB, tabela, rent, inadRes] = await Promise.all([
    carregarFinanceiro(supabase, periodo.inicio, periodo.fim),
    carregarFinanceiro(supabase, periodo.anterior.inicio, periodo.anterior.fim),
    montarRelatorio(supabase, "financeiro_mensal", { periodo, anterior: periodo.anterior, imob, hoje }),
    carregarRentabilidade(supabase, periodo.inicio, periodo.fim, por, 50),
    supabase
      .from("faturas")
      .select("id, numero, competencia, vencimento, valor_total, valor_abatido, status, contrato:contratos(id, numero, imovel:imoveis(codigo), contrato_partes(papel, pessoa:pessoas(nome, telefone)))", {
        count: "exact",
      })
      .in("status", ["aberta", "renegociada"])
      .lt("vencimento", hoje)
      .order("vencimento")
      .limit(20),
  ]);
  const a = somarFinanceiro(linA);
  const b = somarFinanceiro(linB);
  const iv = inadimplenciaPorVencimento(a);
  const ic = inadimplenciaPorCompetencia(a);
  const inad = (inadRes.data ?? []) as unknown as Inad[];
  const q = queryPeriodo(periodo);
  const dias = diasDoIntervalo(periodo);

  const k = (chave: string, rotulo: string, tipo: Indicador["tipo"], f: (t: TotaisFinanceiro) => number | null, explicacao: string, sentido: Indicador["sentido"] = "maior_melhor", detalhe?: string) =>
    montarIndicador(chave, rotulo, tipo, f(a), f(b), explicacao, sentido, detalhe);
  const kpis: [Indicador, ReactNode][] = [
    [k("aluguel_recebido", "Aluguéis recebidos", "dinheiro", (t) => t.aluguel_recebido, "Tudo o que os locatários pagaram no período, na data de cada pagamento (inclui os parciais)."), <HandCoins key="i" />],
    [k("faturado", "Aluguéis faturados", "dinheiro", (t) => t.faturado, "Cobranças de aluguel pela competência (mês de referência), menos as canceladas."), <Receipt key="i" />],
    [
      k("inadimplencia", "Inadimplência por vencimento", "pct", (t) => inadimplenciaPorVencimento(t).pct, "Cobranças que venceram no período (até ontem): o que ainda não foi pago hoje ÷ o valor que venceu.", "menor_melhor", `${formatarReais(iv.naoPago)} de ${formatarReais(iv.vencido)} (${formatarReais(iv.emAcordo)} em acordo)`),
      <TriangleAlert key="i" />,
    ],
    [
      k("inadimplencia_comp", "Inadimplência por competência", "pct", (t) => inadimplenciaPorCompetencia(t).pct, "Cobranças dos meses de referência do período que já venceram: o que ainda não foi pago ÷ o valor dessas cobranças.", "menor_melhor", `${formatarReais(ic.naoPago)} de ${formatarReais(ic.vencido)}`),
      <CalendarClock key="i" />,
    ],
  ];
  if (imob)
    kpis.push(
      [k("receita_imobiliaria", "Receita da imobiliária", "dinheiro", receitaImobiliaria, "Administração + intermediação + comissão de vendas + outras receitas."), <Wallet key="i" />],
      [k("taxa_administracao", "Receita de administração", "dinheiro", (t) => t.taxa_administracao, "Taxas de administração retidas nos repasses (recorrente), pela data em que o aluguel foi pago."), <Building2 key="i" />],
      [
        k("intermediacao", "Receita de intermediação", "dinheiro", (t) => t.taxa_intermediacao + t.comissao_vendas, "Taxas de intermediação de locação retidas nos repasses + comissão da imobiliária nas vendas concluídas.", "maior_melhor", `${formatarReais(a.taxa_intermediacao)} de locação · ${formatarReais(a.comissao_vendas)} de vendas`),
        <Handshake key="i" />,
      ],
      [k("repasses_pagos", "Repasses pagos", "dinheiro", (t) => t.repasses_pagos, "Valor líquido pago aos proprietários no período."), <ArrowLeftRight key="i" />],
    );
  else
    kpis.push(
      [k("outras", "Outras receitas", "dinheiro", (t) => t.outras_receitas, "Lançamentos a receber pagos no período que não são aluguel."), <Wallet key="i" />],
      [k("despesas", "Despesas pagas", "dinheiro", (t) => t.despesas, "Contas pagas no período (manutenção, IPTU, condomínio, impostos…).", "menor_melhor"), <TrendingDown key="i" />],
      [k("resultado", "Resultado", "dinheiro", (t) => resultadoFinanceiro(t, true), "Aluguéis recebidos + outras receitas − despesas pagas."), <TrendingUp key="i" />],
    );
  const urlRent = (r: string) => `/relatorios/financeiro?${queryPeriodo(periodo, { rent: r })}`;

  return (
    <>
      <Cabecalho
        titulo="Relatórios financeiros"
        trilha="Relatórios"
        descricao="Faturamento, receitas, inadimplência e rentabilidade por imóvel ou contrato, mês a mês."
        acoes={<BotoesExportar consulta={`r=financeiro_mensal&${q}`} rotulo="o financeiro mês a mês" />}
      />
      <AbasRelatorios />
      <SeletorPeriodo caminho="/relatorios/financeiro" periodo={periodo} hoje={hoje} extra={{ rent: por === "contrato" ? "contrato" : undefined }} />
      <PeriodoImpresso periodo={periodo} />

      <div className="entrar-cascata mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map(([kpi, icone]) => (
          <KpiBi key={kpi.chave} k={kpi} icone={icone} />
        ))}
      </div>

      <div className="mb-6">
        <Cartao titulo="Mês a mês">
          <TabelaRelatorioView t={tabela} />
          {tabela.rodape && <p className="mt-3 text-xs text-mudo">{tabela.rodape}</p>}
        </Cartao>
      </div>

      <div className="mb-6">
        <Cartao
          titulo={`Rentabilidade por ${por === "imovel" ? "imóvel" : "contrato"}${rent.total > rent.lista.length ? ` — os ${rent.lista.length} melhores de ${rent.total}` : ""}`}
          acoes={
            <div className="nao-imprimir flex flex-wrap gap-2">
              <BotoesExportar consulta={`r=rentabilidade&rent=${por}&${q}`} rotulo="a rentabilidade" />
            </div>
          }
        >
          <PilulasLink
            className="nao-imprimir mb-4"
            rotulo="Rentabilidade por"
            ativo={urlRent(por)}
            itens={[
              { href: urlRent("imovel"), rotulo: "Por imóvel" },
              { href: urlRent("contrato"), rotulo: "Por contrato" },
            ]}
          />
          <Tabela colunas={[por === "imovel" ? "Imóvel" : "Contrato", "Receitas", ...(imob ? ["Taxas da imobiliária"] : []), "Despesas", "Resultado", "Rendimento ao ano"]}>
            {rent.lista.length === 0 && <LinhaVazia colunas={imob ? 6 : 5}>Nenhuma receita ou despesa ligada a imóveis no período.</LinhaVazia>}
            {rent.lista.map((r) => {
              const rend = rendimentoAnual(r.resultado, r.valor_referencia, dias);
              return (
                <LinhaLink key={r.chave} href={por === "imovel" ? `/imoveis/${r.chave}` : `/contratos/${r.chave}`}>
                  <Celula>
                    <span className="font-medium">{r.codigo}</span>
                    {r.descricao && <span className="block text-xs text-mudo">{r.descricao}</span>}
                  </Celula>
                  <Celula className="text-right tabular-nums">{formatarReais(r.receitas)}</Celula>
                  {imob && <Celula className="text-right tabular-nums">{formatarReais(r.taxas)}</Celula>}
                  <Celula className="text-right tabular-nums">{formatarReais(r.despesas)}</Celula>
                  <Celula className={`text-right font-semibold tabular-nums ${r.resultado < 0 ? "text-ruim" : ""}`}>{formatarReais(r.resultado)}</Celula>
                  <Celula className="text-right tabular-nums">
                    <span title={r.valor_referencia ? `Sobre ${formatarReais(r.valor_referencia)}` : "Sem valor de venda ou avaliação no cadastro"}>{formatarPct(rend, 2)}</span>
                  </Celula>
                </LinhaLink>
              );
            })}
          </Tabela>
        </Cartao>
      </div>

      <Cartao
        titulo={`Cobranças vencidas e não pagas — ${inadRes.count ?? inad.length} hoje`}
        acoes={
          <div className="nao-imprimir flex flex-wrap gap-2">
            <BotoesExportar consulta={`r=inadimplencia&${q}`} rotulo="a lista de inadimplência" />
          </div>
        }
      >
        <Tabela colunas={["Fatura", "Contrato", "Locatário", "Competência", "Vencimento", "Dias", "Saldo"]}>
          {inad.length === 0 && <LinhaVazia colunas={7}>Nenhuma cobrança em atraso.</LinhaVazia>}
          {inad.map((f) => {
            const loc = f.contrato?.contrato_partes.find((x) => x.papel === "locatario")?.pessoa;
            return (
              <LinhaLink href={`/faturas/${f.id}`} key={f.id}>
                <Celula>#{f.numero}</Celula>
                <Celula>
                  {f.contrato ? (
                    <Link className="hover:underline" href={`/contratos/${f.contrato.id}`}>
                      #{f.contrato.numero} · {f.contrato.imovel?.codigo}
                    </Link>
                  ) : (
                    "—"
                  )}
                </Celula>
                <Celula>
                  {loc?.nome ?? "—"}
                  {loc?.telefone && <div className="text-xs text-mudo">{loc.telefone}</div>}
                </Celula>
                <Celula>{formatarCompetencia(f.competencia)}</Celula>
                <Celula>{formatarDataBR(f.vencimento)}</Celula>
                <Celula className="text-ruim tabular-nums">{diasEntre(f.vencimento, hoje)}</Celula>
                <Celula className="text-right tabular-nums">
                  {formatarReais(Math.max(0, Number(f.valor_total) - Number(f.valor_abatido)))}
                  {f.status === "renegociada" && <span className="block text-xs text-mudo">em acordo</span>}
                </Celula>
              </LinhaLink>
            );
          })}
        </Tabela>
        {(inadRes.count ?? 0) > inad.length && (
          <p className="mt-3 text-sm">
            <Link href="/cobrancas" className="text-acento hover:underline">
              Ver todas em Cobranças →
            </Link>
          </p>
        )}
      </Cartao>

      <ComoCalculamos
        itens={[
          ["Aluguéis recebidos", "Cada pagamento de aluguel na data em que entrou (pagamentos parciais contam no dia de cada um)."],
          ["Aluguéis faturados", "Cobranças de aluguel pelo mês de referência (competência), sem as canceladas."],
          ["Inadimplência", "Valor vencido e ainda não pago (em aberto + em acordo) ÷ valor que venceu. Por vencimento: cobranças que venceram no período. Por competência: cobranças dos meses de referência do período que já venceram."],
          ...(imob
            ? ([
                ["Receita de administração", "Taxas de administração retidas nos repasses, pela data em que o locatário pagou."],
                ["Receita de intermediação", "Taxa de intermediação da locação (retida no repasse) + comissão da imobiliária nas vendas concluídas no período."],
                ["Despesas", "Contas do escritório pagas no período. As despesas do proprietário (de terceiros ou descontadas no repasse, como um conserto) ficam fora daqui: entram na rentabilidade do imóvel."],
                ["Resultado", "Receita da imobiliária (administração + intermediação + comissão de vendas + outras receitas) − despesas do escritório. O aluguel é do proprietário e não entra."],
              ] as [string, string][])
            : ([["Resultado", "Aluguéis recebidos + outras receitas − despesas pagas no período."]] as [string, string][])),
          ["Rentabilidade", `Receitas do imóvel/contrato (aluguel recebido e outras receitas ligadas a ele)${imob ? " − taxas da imobiliária" : ""} − despesas ligadas a ele (manutenção, IPTU, condomínio…${imob ? "; na imobiliária, as do proprietário: de terceiros ou descontadas no repasse" : ""}). Rendimento ao ano = resultado ÷ valor de venda (ou avaliação da captação) × 365 ÷ dias do período.`],
        ]}
      />
    </>
  );
}
