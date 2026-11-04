import type { Metadata } from "next";
import Link from "next/link";
import { CalendarCheck, CheckSquare, Clock, Handshake, Home, Inbox, KeyRound, Wrench } from "lucide-react";
import { Contador } from "@/components/abas-segmentadas";
import { BarraProgresso } from "@/components/barra-progresso";
import { PilulasLink } from "@/components/pilulas-link";
import { Cartao, Indicador } from "@/components/ui";
import { hojeISO } from "@/lib/dominio/datas";
import { formatarReais } from "@/lib/dominio/dinheiro";
import {
  ROTULO_META_EQUIPE,
  formatarDuracao,
  linhasDoAlvo,
  periodoPorChave,
  realizadoMeta,
  ritmoDoMes,
  somarProdutividade,
  taxaConversao,
  tempoMedioResposta,
  type TipoMetaEquipe,
} from "@/lib/dominio/equipe";
import { progressoMeta } from "@/lib/dominio/painel";
import { carregarProdutividade, contextoEquipe } from "../../../dados";

export const metadata: Metadata = { title: "Desempenho do colaborador" };

const PERIODOS = ["mes", "mes_passado", "90d", "ano"] as const;

export default async function DesempenhoColaboradorPage({ params, searchParams }: PageProps<"/equipe/colaboradores/[id]/desempenho">) {
  const { id } = await params;
  const sp = await searchParams;
  const chave = typeof sp.periodo === "string" && (PERIODOS as readonly string[]).includes(sp.periodo) ? sp.periodo : "mes";
  const hoje = hojeISO();
  const per = periodoPorChave(chave, hoje);
  const mesAtual = `${hoje.slice(0, 7)}-01`;
  const { supabase } = await contextoEquipe();
  const [linhas, linhasMes, { data: metas }] = await Promise.all([
    carregarProdutividade(supabase, per.inicio, per.fim),
    chave === "mes" ? Promise.resolve(null) : carregarProdutividade(supabase, mesAtual, hoje),
    supabase.from("equipe_metas").select("id, tipo, valor").eq("pessoa_id", id).eq("competencia", mesAtual),
  ]);
  const t = somarProdutividade(linhasDoAlvo(linhas, "pessoa", id));
  const tMes = linhasMes ? somarProdutividade(linhasDoAlvo(linhasMes, "pessoa", id)) : t;
  const ritmo = ritmoDoMes(mesAtual, hoje);
  const base = `/equipe/colaboradores/${id}/desempenho`;
  const conv = taxaConversao(t);

  return (
    <div className="space-y-6">
      <PilulasLink
        rotulo="Período"
        ativo={`${base}?periodo=${chave}`}
        itens={PERIODOS.map((p) => ({ href: `${base}?periodo=${p}`, rotulo: periodoPorChave(p, hoje).rotulo }))}
      />
      <div className="entrar-cascata grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Indicador rotulo="Leads atendidos" icone={<Inbox />} valor={<Contador valor={t.leads_atendidos} />} detalhe={`${t.leads_recebidos} recebidos no período`} />
        <Indicador rotulo="Tempo até o 1º atendimento" icone={<Clock />} valor={formatarDuracao(tempoMedioResposta(t))} detalhe="média dos leads atendidos" />
        <Indicador rotulo="Visitas feitas" icone={<CalendarCheck />} valor={<Contador valor={t.visitas} />} />
        <Indicador rotulo="Propostas" icone={<Handshake />} valor={<Contador valor={t.propostas} />} detalhe={conv === null ? "nenhuma no período" : `${conv}% viraram negócio`} />
        <Indicador rotulo="Locações fechadas" icone={<KeyRound />} valor={<Contador valor={t.locacoes} />} tom={t.locacoes ? "sucesso" : "neutro"} />
        <Indicador rotulo="Vendas concluídas" icone={<Home />} valor={<Contador valor={t.vendas} />} detalhe={t.valor_vendas ? formatarReais(t.valor_vendas) : undefined} tom={t.vendas ? "sucesso" : "neutro"} />
        <Indicador rotulo="Tarefas concluídas" icone={<CheckSquare />} valor={<Contador valor={t.tarefas} />} detalhe={`${t.captacoes} imóvel(is) captado(s)`} />
        <Indicador rotulo="Chamados resolvidos" icone={<Wrench />} valor={<Contador valor={t.chamados} />} />
      </div>

      <Cartao
        titulo="Metas individuais deste mês"
        acoes={
          <Link href="/equipe/metas" className="text-sm text-acento hover:underline">
            Definir metas
          </Link>
        }
      >
        {(metas ?? []).length === 0 ? (
          <p className="text-sm text-mudo">Sem metas individuais neste mês.</p>
        ) : (
          <ul className="space-y-4">
            {((metas ?? []) as { id: string; tipo: TipoMetaEquipe; valor: number }[]).map((m) => {
              const feito = realizadoMeta(m.tipo, tMes);
              const prog = progressoMeta(feito, Number(m.valor));
              const fmt = (v: number) => (m.tipo === "valor_vendas" ? formatarReais(v) : String(v));
              return (
                <li key={m.id} className="grid items-center gap-3 md:grid-cols-[240px_1fr_120px]">
                  <div>
                    <div className="font-medium text-texto">{ROTULO_META_EQUIPE[m.tipo]}</div>
                    <div className="text-xs text-mudo">
                      {fmt(feito)} de {fmt(Number(m.valor))}
                    </div>
                  </div>
                  <BarraProgresso pct={prog?.pct ?? 0} atingida={Boolean(prog?.atingida)} />
                  <span className={`text-right text-sm font-semibold tabular-nums ${prog?.atingida ? "text-ok" : (prog?.pct ?? 0) < ritmo ? "text-alerta" : "text-texto-2"}`}>{prog?.pct ?? 0}%</span>
                </li>
              );
            })}
            <li className="text-xs text-mudo">O mês está {ritmo}% andado: abaixo disso, a meta aparece em amarelo.</li>
          </ul>
        )}
      </Cartao>
    </div>
  );
}
