import type { Metadata } from "next";
import type { ReactNode } from "react";
import { BadgeDollarSign, CalendarCheck, Handshake, Inbox, Target } from "lucide-react";
import { Cabecalho, Cartao, Celula, Definicao, LinhaVazia, Tabela, Aviso } from "@/components/ui";
import { ROTULO_ORIGEM, etapasFunil, formatarPct, lerPeriodo, queryPeriodo, taxa, type Funil } from "@/lib/dominio/bi";
import { hojeISO } from "@/lib/dominio/datas";
import { formatarReais } from "@/lib/dominio/dinheiro";
import { AbasRelatorios } from "../abas";
import { BotoesExportar, ComoCalculamos, KpiBi } from "../componentes";
import { carregarCanais, carregarFunil, contextoRelatorios } from "../dados";
import { montarIndicador, type Indicador } from "../indicadores";
import { PeriodoImpresso, SeletorPeriodo } from "../periodo";

export const metadata: Metadata = { title: "Relatórios · Comercial" };

export default async function ComercialRelatorioPage({ searchParams }: PageProps<"/relatorios/comercial">) {
  const sp = await searchParams;
  const hoje = hojeISO();
  const periodo = lerPeriodo(sp, hoje);
  const { supabase, corretor } = await contextoRelatorios();
  const [a, b, canais] = await Promise.all([
    carregarFunil(supabase, periodo.inicio, periodo.fim),
    carregarFunil(supabase, periodo.anterior.inicio, periodo.anterior.fim),
    carregarCanais(supabase, periodo.inicio, periodo.fim),
  ]);
  const q = queryPeriodo(periodo);
  const k = (chave: string, rotulo: string, tipo: Indicador["tipo"], f: (x: Funil) => number | null, explicacao: string, detalhe?: string) =>
    montarIndicador(chave, rotulo, tipo, f(a), f(b), explicacao, "maior_melhor", detalhe);
  const kpis: [Indicador, ReactNode][] = [
    [k("leads", "Leads", "inteiro", (x) => x.leads, "Leads que chegaram no período.", `${a.perdidos} perdido(s)`), <Inbox key="i" />],
    [k("lead_visita", "Leads → visitas", "pct", (x) => taxa(x.com_visita, x.leads), "Dos leads que chegaram, quantos fizeram visita (realizada) ou chegaram à etapa de visita.", `${a.com_visita} de ${a.leads}`), <CalendarCheck key="i" />],
    [
      k("visita_proposta", "Visitas → propostas", "pct", (x) => taxa(x.propostas_feitas, x.visitas_realizadas), "Propostas feitas ÷ visitas realizadas no período.", `${a.propostas_feitas} propostas · ${a.visitas_realizadas} visitas`),
      <Handshake key="i" />,
    ],
    [
      k("proposta_contrato", "Propostas → contratos", "pct", (x) => taxa(x.propostas_aceitas, x.propostas_feitas), "Propostas aceitas ÷ propostas feitas no período.", `${a.propostas_aceitas} aceitas · ${a.contratos_locacao} contratos de locação`),
      <Target key="i" />,
    ],
    [k("vendas", "Vendas concluídas", "dinheiro", (x) => x.valor_vendas, "Valor das vendas concluídas no período.", `${a.vendas_concluidas} venda(s)`), <BadgeDollarSign key="i" />],
  ];
  const etapas = etapasFunil(a);
  const max = Math.max(1, a.leads);

  return (
    <>
      <Cabecalho
        titulo="Relatórios comerciais"
        trilha="Relatórios"
        descricao="Leads por canal de origem e a conversão de leads em visitas, de visitas em propostas e de propostas em contratos."
        acoes={<BotoesExportar consulta={`r=leads_canais&${q}`} rotulo="os leads por canal" />}
      />
      <AbasRelatorios />
      {corretor && (
        <div className="mb-4">
          <Aviso>Você está vendo só os seus leads, visitas, propostas e vendas.</Aviso>
        </div>
      )}
      <SeletorPeriodo caminho="/relatorios/comercial" periodo={periodo} hoje={hoje} />
      <PeriodoImpresso periodo={periodo} />

      <div className="entrar-cascata mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {kpis.map(([kpi, icone]) => (
          <KpiBi key={kpi.chave} k={kpi} icone={icone} />
        ))}
      </div>

      <div className="mb-6 grid gap-6 xl:grid-cols-[1.1fr_1fr]">
        <Cartao titulo="Funil dos leads que chegaram no período">
          <ul className="space-y-3">
            {etapas.map((e) => (
              <li key={e.chave}>
                <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
                  <span className="font-medium text-texto">{e.rotulo}</span>
                  <span className="tabular-nums text-texto-2">
                    <strong className="text-texto">{e.valor}</strong>
                    {e.daAnterior !== null && <span className="ml-2 text-xs text-mudo">{formatarPct(e.daAnterior)} da etapa anterior</span>}
                  </span>
                </div>
                <div className="h-3 w-full overflow-hidden rounded-full bg-elev">
                  <div className="h-full rounded-full bg-acento transition-[width] duration-700" style={{ width: `${(e.valor / max) * 100}%` }} />
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs text-mudo">
            Conversão total (lead → negócio): <strong>{formatarPct(taxa(a.fechados, a.leads))}</strong>. O funil é acumulado: quem fechou também conta como visita e proposta.
          </p>
        </Cartao>
        <Cartao titulo="Atividade no período">
          <Definicao
            itens={[
              ["Visitas realizadas", a.visitas_realizadas],
              ["Propostas feitas", a.propostas_feitas],
              ["Propostas aceitas", a.propostas_aceitas],
              [corretor ? "Locações fechadas" : "Contratos de locação iniciados", a.contratos_locacao],
              ["Vendas concluídas", `${a.vendas_concluidas} · ${formatarReais(a.valor_vendas)}`],
              ["Leads atendidos", `${a.atendidos} de ${a.leads}`],
            ]}
          />
        </Cartao>
      </div>

      <Cartao titulo="Leads por canal de origem">
        <Tabela colunas={["Canal", "Leads", "Atendidos", "Visitaram", "Fizeram proposta", "Fecharam", "Conversão", "Perdidos"]} direita="resto">
          {canais.length === 0 && <LinhaVazia colunas={8}>Nenhum lead no período.</LinhaVazia>}
          {canais.map((c) => (
            <tr key={c.origem}>
              <Celula className="font-medium">{ROTULO_ORIGEM[c.origem] ?? c.origem}</Celula>
              <Celula className="text-right tabular-nums">{c.leads}</Celula>
              <Celula className="text-right tabular-nums">{c.atendidos}</Celula>
              <Celula className="text-right tabular-nums">{c.com_visita}</Celula>
              <Celula className="text-right tabular-nums">{c.com_proposta}</Celula>
              <Celula className="text-right tabular-nums">{c.fechados}</Celula>
              <Celula className="text-right font-semibold tabular-nums">{formatarPct(taxa(c.fechados, c.leads))}</Celula>
              <Celula className="text-right tabular-nums">{c.perdidos}</Celula>
            </tr>
          ))}
        </Tabela>
      </Cartao>

      <ComoCalculamos
        itens={[
          ["Leads", "Leads que chegaram (foram cadastrados) no período, de todos os canais."],
          ["Leads → visitas", "Dos leads que chegaram no período, os que fizeram visita (realizada) ou chegaram à etapa de visita do funil."],
          ["Visitas → propostas", "Propostas feitas no período ÷ visitas realizadas no período."],
          ["Propostas → contratos", "Propostas aceitas no período ÷ propostas feitas no período."],
          ["Fecharam", "Lead marcado como ganho, com proposta aceita ou com venda concluída."],
          ["Canal", "A origem gravada no lead (site, WhatsApp, portal, indicação…)."],
        ]}
      />
    </>
  );
}
