import "server-only";
import type { obterContexto } from "@/lib/contexto";
import { TIPOS_CONTA, celulaCsvCond, previstoRealizado } from "@/lib/dominio/condominios";
import { fimDoMes, formatarCompetencia, formatarDataBR, hojeISO, somarDias } from "@/lib/dominio/datas";
import { formatarReais, paraReais } from "@/lib/dominio/dinheiro";
import { todas } from "../../../financeiro/dados";

type Supabase = Awaited<ReturnType<typeof obterContexto>>["supabase"];

export const RELATORIOS_COND = {
  balancete: "Balancete do mês",
  previsto: "Previsto × realizado",
  inadimplencia: "Inadimplência",
  fundo: "Fundo de reserva",
  extrato: "Extrato da conta",
} as const;
export type RelatorioCond = keyof typeof RELATORIOS_COND;

export interface TabelaRelatorio {
  titulo: string;
  subtitulo: string;
  colunas: string[];
  linhas: string[][];
  /** Linhas em destaque (totais). */
  rodape?: string[][];
}

export interface ParametrosRelatorio {
  mes: string;
  ano: number;
  conta?: string | null;
}

const reais = (v: unknown) => formatarReais(Number(v) || 0);

/** A mesma tabela serve a tela, a impressão e o CSV. Tudo agregado no banco (sem limite de 1.000 linhas). */
export async function montarRelatorioCond(supabase: Supabase, condominio: string, r: RelatorioCond, p: ParametrosRelatorio): Promise<TabelaRelatorio> {
  const comp = `${p.mes}-01`;
  if (r === "balancete") {
    const { data } = await supabase.rpc("cond_balancete", { p_condominio: condominio, p_competencia: comp });
    const b = (data ?? {}) as {
      receitas: { categoria: string; valor: number }[];
      despesas: { categoria: string; valor: number }[];
      total_receitas: number;
      total_despesas: number;
      contas: { nome: string; tipo: string; saldo_anterior: number; entradas: number; saidas: number; saldo_final: number }[];
      cotas: { emitidas: number; valor_emitido: number; recebido: number };
      inadimplencia: { em?: string; unidades: number; valor: number };
      fechado: boolean;
    };
    const linhas: string[][] = [
      ...(b.receitas ?? []).map((x) => ["Receita", x.categoria, reais(x.valor)]),
      ...(b.despesas ?? []).map((x) => ["Despesa", x.categoria, reais(-Number(x.valor))]),
      ...(b.contas ?? []).map((x) => [
        "Conta",
        `${x.nome} (${TIPOS_CONTA[x.tipo as keyof typeof TIPOS_CONTA] ?? x.tipo}): saldo anterior ${reais(x.saldo_anterior)} + entradas ${reais(x.entradas)} − saídas ${reais(x.saidas)}`,
        reais(x.saldo_final),
      ]),
      ["Cotas", `${b.cotas?.emitidas ?? 0} cota(s) emitidas no mês`, reais(b.cotas?.valor_emitido)],
      ["Cotas", "Recebido de cotas no mês (com multa e juros)", reais(b.cotas?.recebido)],
      [
        "Inadimplência",
        `${b.inadimplencia?.unidades ?? 0} unidade(s) com cota vencida e não paga em ${b.inadimplencia?.em ? formatarDataBR(b.inadimplencia.em) : "fim do mês"}`,
        reais(b.inadimplencia?.valor),
      ],
    ];
    return {
      titulo: `Balancete de ${formatarCompetencia(comp)}`,
      subtitulo: `Regime de caixa (o que foi pago no mês)${b.fechado ? " · mês fechado" : " · mês ainda aberto (pode mudar)"}`,
      colunas: ["Grupo", "Descrição", "Valor"],
      linhas,
      rodape: [
        ["Total", "Receitas do mês", reais(b.total_receitas)],
        ["Total", "Despesas do mês", reais(-Number(b.total_despesas ?? 0))],
        ["Resultado", "Receitas − despesas", reais(Number(b.total_receitas ?? 0) - Number(b.total_despesas ?? 0))],
      ],
    };
  }

  if (r === "previsto") {
    const { data } = await supabase.rpc("cond_previsto_realizado", { p_condominio: condominio, p_ano: p.ano });
    const d = (data ?? { previsto: [], realizado: [] }) as { previsto: { categoria: string; tipo: string; mensal: number }[]; realizado: { categoria: string; tipo: string; mes: number; valor: number }[] };
    const hoje = hojeISO();
    const ate = p.ano < Number(hoje.slice(0, 4)) ? 12 : Number(hoje.slice(5, 7));
    const ls = previstoRealizado(d.previsto, d.realizado, ate);
    return {
      titulo: `Previsto × realizado de ${p.ano}`,
      subtitulo: `Até ${String(ate).padStart(2, "0")}/${p.ano} · orçamento aprovado × lançamentos pagos`,
      colunas: ["Categoria", "Tipo", "Previsto", "Realizado", "Diferença", "% do previsto"],
      linhas: ls.map((l) => [l.categoria, l.tipo, formatarReais(paraReais(l.previstoAte)), formatarReais(paraReais(l.realizadoAte)), formatarReais(paraReais(l.diferenca)), l.pct == null ? "fora do orçamento" : `${l.pct.toLocaleString("pt-BR")}%`]),
    };
  }

  if (r === "inadimplencia") {
    const { data } = await supabase.rpc("cond_inadimplencia", { p_condominio: condominio });
    const ls = (data ?? []) as { unidade: string; responsavel: { nome: string } | null; cotas: number; competencias: string[]; dias: number; saldo: number; multa: number; juros: number; corrigido: number; juridico: boolean }[];
    const total = ls.reduce((a, l) => a + Number(l.corrigido), 0);
    return {
      titulo: "Inadimplência",
      subtitulo: `Posição de ${formatarDataBR(hojeISO())}, com multa e juros do dia`,
      colunas: ["Unidade", "Responsável", "Cotas", "Atraso (dias)", "Saldo", "Multa", "Juros", "Total", "Jurídico"],
      linhas: ls.map((l) => [l.unidade, l.responsavel?.nome ?? "", `${l.cotas} (${l.competencias.join(", ")})`, String(l.dias), reais(l.saldo), reais(l.multa), reais(l.juros), reais(l.corrigido), l.juridico ? "sim" : ""]),
      rodape: [["Total", "", "", "", "", "", "", reais(total), ""]],
    };
  }

  // Fundo de reserva e extrato: movimentos pagos de uma (ou das contas de fundo) no período.
  const { data: contas } = await supabase.from("cond_contas").select("id, nome, tipo").eq("condominio_id", condominio);
  const lista = (contas ?? []) as { id: string; nome: string; tipo: string }[];
  const alvo = r === "fundo" ? lista.filter((c) => c.tipo !== "corrente") : lista.filter((c) => c.id === (p.conta ?? lista.find((x) => x.tipo === "corrente")?.id));
  const ids = alvo.map((c) => c.id);
  const de = r === "fundo" ? `${p.ano}-01-01` : comp;
  const ate = r === "fundo" ? `${p.ano}-12-31` : fimDoMes(comp);
  const { data: saldoAntes } = await supabase.rpc("cond_saldos", { p_condominio: condominio, p_ate: somarDias(de, -1) });
  const inicial = ((saldoAntes ?? []) as { id: string; saldo: number }[]).filter((s) => ids.includes(s.id)).reduce((a, s) => a + Number(s.saldo), 0);
  const movs = ids.length
    ? await todas<{ id: string; tipo: string; descricao: string; categoria: string; valor: number; pago_em: string; conta_id: string; conta_destino_id: string | null; aprovacao_texto: string | null }>(() =>
        supabase
          .from("cond_lancamentos")
          .select("id, tipo, descricao, categoria, valor, pago_em, conta_id, conta_destino_id, aprovacao_texto")
          .eq("condominio_id", condominio)
          .eq("status", "pago")
          .gte("pago_em", de)
          .lte("pago_em", ate)
          .or(`conta_id.in.(${ids.join(",")}),conta_destino_id.in.(${ids.join(",")})`)
          .order("id"),
      )
    : [];
  movs.sort((a, b) => a.pago_em.localeCompare(b.pago_em));
  let saldo = Math.round(inicial * 100);
  const linhas = movs.map((m) => {
    const entra = (m.tipo === "receita" && ids.includes(m.conta_id)) || (m.tipo === "transferencia" && ids.includes(m.conta_destino_id ?? "") && !ids.includes(m.conta_id));
    const sai = !entra && !(m.tipo === "transferencia" && ids.includes(m.conta_id) && ids.includes(m.conta_destino_id ?? ""));
    const v = Math.round(Number(m.valor) * 100);
    saldo += entra ? v : sai ? -v : 0;
    return [formatarDataBR(m.pago_em), m.descricao + (m.aprovacao_texto ? ` (aprovação: ${m.aprovacao_texto})` : ""), m.categoria, entra ? formatarReais(v / 100) : "", sai ? formatarReais(v / 100) : "", formatarReais(saldo / 100)];
  });
  return {
    titulo: r === "fundo" ? `Fundo de reserva — ${p.ano}` : `Extrato — ${alvo[0]?.nome ?? "conta"} — ${formatarCompetencia(comp)}`,
    subtitulo: `${alvo.map((c) => c.nome).join(", ") || "Sem conta"} · saldo inicial ${formatarReais(inicial)}`,
    colunas: ["Data", "Descrição", "Categoria", "Entrada", "Saída", "Saldo"],
    linhas,
    rodape: [["", "Saldo final", "", "", "", formatarReais(saldo / 100)]],
  };
}

/** CSV para Excel: BOM + ponto e vírgula; texto que viraria fórmula no Excel ganha apóstrofo (celulaCsvCond). */
export function paraCsv(t: TabelaRelatorio): string {
  const linhas = [[t.titulo], [t.subtitulo], [], t.colunas, ...t.linhas, ...(t.rodape ?? [])];
  return "﻿" + linhas.map((l) => l.map((c) => celulaCsvCond(c)).join(";")).join("\r\n");
}
