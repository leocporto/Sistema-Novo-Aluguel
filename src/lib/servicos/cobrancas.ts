import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  analisarRecebimento,
  distribuirParcela,
  itensDaQuitacao,
  situacaoFatura,
  type PagamentoFatura,
  type SituacaoFatura,
} from "@/lib/dominio/cobrancas";
import { paraCentavos, paraReais } from "@/lib/dominio/dinheiro";
import { ErroValidacao, verificar } from "@/lib/form";
import type { Contrato, Fatura, FaturaItem } from "@/lib/tipos";
import { carregarContrato, destinoEncargos, prepararLiquidacao, type Liquidacao } from "./locacao";

/** Linha de `fatura_pagamentos` como vem do banco. */
export interface PagamentoDb {
  id: string;
  fatura_id: string;
  pago_em: string;
  valor: number | string;
  principal: number | string;
  multa: number | string;
  juros: number | string;
  desconto: number | string;
  forma: string | null;
  conta_id: string | null;
  origem: string;
  acordo_parcela_id: string | null;
  observacao: string | null;
  comprovante_path: string | null;
  created_at: string;
}

export const FORMAS_VALIDAS = ["pix", "boleto", "transferencia", "dinheiro", "cartao", "outro"];

export function paraPagamento(p: Pick<PagamentoDb, "pago_em" | "valor" | "principal" | "multa" | "juros" | "desconto">): PagamentoFatura {
  return {
    data: p.pago_em,
    valor: paraCentavos(p.valor),
    principal: paraCentavos(p.principal),
    multa: paraCentavos(p.multa),
    juros: paraCentavos(p.juros),
    desconto: paraCentavos(p.desconto),
  };
}

/**
 * O que o "Desfazer" da fatura paga tira (estornar_baixa): só o último
 * recebimento (data mais recente; no empate, o último lançado). Os anteriores
 * continuam registrados. Fatura paga antes dos recebimentos separados: a baixa
 * inteira. Valores em reais.
 */
export function ultimoRecebimento(
  fatura: { valor_pago: number | string | null; valor_total: number | string; pago_em: string | null },
  pagamentos: Pick<PagamentoDb, "pago_em" | "valor" | "created_at">[],
): { valor: number; pagoEm: string | null; restante: number; outros: number } {
  if (!pagamentos.length) return { valor: Number(fatura.valor_pago ?? fatura.valor_total), pagoEm: fatura.pago_em, restante: 0, outros: 0 };
  const ord = [...pagamentos].sort((a, b) => a.pago_em.localeCompare(b.pago_em) || String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")));
  const ultimo = ord[ord.length - 1];
  const restante = ord.slice(0, -1).reduce((s, p) => s + paraCentavos(p.valor), 0);
  return { valor: Number(ultimo.valor), pagoEm: ultimo.pago_em, restante: paraReais(restante), outros: ord.length - 1 };
}

/** Valor do aluguel na fatura (base do desconto de pontualidade). */
export function aluguelDaFatura(itens: Pick<FaturaItem, "tipo" | "valor">[], contrato: Pick<Contrato, "valor_aluguel">): number {
  const it = itens.filter((i) => i.tipo === "aluguel").reduce((s, i) => s + paraCentavos(i.valor), 0);
  return it > 0 ? it : paraCentavos(contrato.valor_aluguel);
}

/** Situação da fatura (saldo, multa e juros sugeridos) numa data. */
export function situacaoDaFatura(
  fatura: Pick<Fatura, "valor_total" | "vencimento">,
  contrato: Pick<Contrato, "multa_atraso_pct" | "juros_mes_pct" | "carencia_dias" | "valor_aluguel"> & { desconto_pontualidade_pct?: number | string | null },
  pagamentos: PagamentoFatura[],
  data: string,
  aluguel?: number,
): SituacaoFatura {
  return situacaoFatura(
    { valorTotal: paraCentavos(fatura.valor_total), vencimento: fatura.vencimento },
    pagamentos,
    { multaPct: Number(contrato.multa_atraso_pct), jurosMesPct: Number(contrato.juros_mes_pct), carenciaDias: contrato.carencia_dias },
    data,
    { pct: Number(contrato.desconto_pontualidade_pct ?? 0), aluguel: aluguel ?? paraCentavos(contrato.valor_aluguel) },
  );
}

export interface NovoRecebimento {
  pagoEm: string;
  /** Valores em reais. */
  valor: number;
  multa: number;
  juros: number;
  desconto: number;
  forma: string;
  contaId?: string | null;
  origem?: "manual" | "extrato" | "arquivo" | "automatica";
  observacao?: string | null;
  extratoItemId?: string | null;
  /** Linha do extrato/arquivo que gerou a baixa (a mesma linha não baixa duas vezes). */
  chaveBaixa?: string | null;
  comprovantePath?: string | null;
  /** Como o desconto aparece na fatura (ex.: "Desconto de pontualidade (5%)"). */
  rotuloDesconto?: string | null;
}

/**
 * Registra um recebimento numa fatura (parcial ou total). Se o saldo zera,
 * a fatura é quitada na mesma transação: multa, juros e descontos entram como
 * itens, e o repasse e a taxa (imobiliária) ou o lançamento no financeiro
 * (imóveis pessoais) são gerados sobre a fatura inteira.
 */
export async function registrarRecebimentoFatura(sb: SupabaseClient, faturaId: string, r: NovoRecebimento) {
  const fatura = verificar(await sb.from("faturas").select("*").eq("id", faturaId).single()) as Fatura & { status: string };
  if (fatura.status === "renegociada") throw new ErroValidacao("Esta cobrança está num acordo: receba pelas parcelas do acordo.");
  if (fatura.status !== "aberta") throw new ErroValidacao("Esta cobrança não está em aberto.");
  if (!r.pagoEm) throw new ErroValidacao("Informe a data do pagamento.");
  const forma = FORMAS_VALIDAS.includes(r.forma) ? r.forma : "outro";
  const c = await carregarContrato(sb, fatura.contrato_id);
  if (!c) throw new ErroValidacao("Contrato não encontrado.");
  const [{ data: pgRaw }, { data: itensRaw }] = await Promise.all([
    sb.from("fatura_pagamentos").select("*").eq("fatura_id", faturaId).order("pago_em"),
    sb.from("fatura_itens").select("*").eq("fatura_id", faturaId),
  ]);
  const anteriores = ((pgRaw ?? []) as PagamentoDb[]).map(paraPagamento);
  const saldo = Math.max(0, paraCentavos(fatura.valor_total) - anteriores.reduce((s, p) => s + p.principal + p.desconto, 0));
  const novo = { valor: paraCentavos(r.valor), multa: paraCentavos(r.multa), juros: paraCentavos(r.juros), desconto: paraCentavos(r.desconto) };
  const an = analisarRecebimento(saldo, novo);
  if (an.erro) throw new ErroValidacao(an.erro);

  const pagamento = {
    fatura_id: faturaId,
    pago_em: r.pagoEm,
    valor: paraReais(novo.valor),
    principal: paraReais(an.principal),
    multa: paraReais(novo.multa),
    juros: paraReais(novo.juros),
    desconto: paraReais(novo.desconto),
    forma,
    conta_id: r.contaId || null,
    origem: r.origem ?? "manual",
    extrato_item_id: r.extratoItemId || null,
    observacao: r.observacao || null,
    comprovante_path: r.comprovantePath || null,
  };

  const liquidacoes: (Liquidacao & { conciliado: boolean })[] = [];
  if (an.quita) {
    const todos = [...anteriores, { data: r.pagoEm, ...novo, principal: an.principal }];
    const extras = itensDaQuitacao(todos, {
      multaPct: Number(c.contrato.multa_atraso_pct),
      destinoEncargos: destinoEncargos(c.contrato),
      rotuloDesconto: r.rotuloDesconto ?? undefined,
    });
    const lq = await prepararLiquidacao(sb, c, fatura, (itensRaw ?? []) as FaturaItem[], extras, {
      pagoEm: r.pagoEm,
      formaPagamento: forma,
      valorPago: paraReais(todos.reduce((s, p) => s + p.valor, 0)),
    });
    liquidacoes.push({ ...lq, conciliado: Boolean(r.extratoItemId) });
  }

  const { data, error } = await sb.rpc("registrar_recebimento", { p: { pagamentos: [pagamento], liquidacoes, chave_baixa: r.chaveBaixa || null } });
  if (error) throw new Error(error.message);
  const ids = ((data as { pagamentos?: string[] } | null)?.pagamentos ?? []) as string[];
  return { quitou: an.quita, falta: paraReais(an.falta), pagamentoId: ids[0] ?? null };
}

type ParcelaDb = { id: string; acordo_id: string; numero: number; vencimento: string; valor: number | string; status: string };
type AcordoFaturaDb = { fatura_id: string; principal: number | string; multa: number | string; juros: number | string; desconto: number | string; total: number | string };

/**
 * Recebe uma parcela do acordo: o valor é distribuído nas faturas do acordo
 * (da mais antiga para a mais nova) e cada fatura coberta é quitada, com o
 * repasse ao proprietário. Quando a última parcela é paga, o acordo fica
 * "cumprido".
 */
export async function receberParcelaAcordo(
  sb: SupabaseClient,
  parcelaId: string,
  r: { pagoEm: string; forma: string; contaId?: string | null; extratoItemId?: string | null; chaveBaixa?: string | null; observacao?: string | null },
) {
  const parcela = verificar(await sb.from("acordo_parcelas").select("id, acordo_id, numero, vencimento, valor, status").eq("id", parcelaId).single()) as ParcelaDb;
  if (parcela.status !== "aberta") throw new ErroValidacao("Esta parcela não está em aberto.");
  const acordo = verificar(await sb.from("acordos").select("id, numero, status").eq("id", parcela.acordo_id).single()) as { id: string; numero: number; status: string };
  if (acordo.status !== "ativo") throw new ErroValidacao("Este acordo não está em andamento.");
  if (!r.pagoEm) throw new ErroValidacao("Informe a data do pagamento.");
  const forma = FORMAS_VALIDAS.includes(r.forma) ? r.forma : "outro";

  const [{ data: afRaw }, { data: parcelasRaw }] = await Promise.all([
    sb.from("acordo_faturas").select("fatura_id, principal, multa, juros, desconto, total").eq("acordo_id", acordo.id),
    sb.from("acordo_parcelas").select("id").eq("acordo_id", acordo.id),
  ]);
  const af = (afRaw ?? []) as AcordoFaturaDb[];
  const faturaIds = af.map((a) => a.fatura_id);
  const parcelaIds = (parcelasRaw ?? []).map((p) => p.id as string);
  const [{ data: fatRaw }, { data: pgRaw }, { data: itensRaw }] = await Promise.all([
    sb.from("faturas").select("*").in("id", faturaIds),
    sb.from("fatura_pagamentos").select("*").in("fatura_id", faturaIds),
    sb.from("fatura_itens").select("*").in("fatura_id", faturaIds),
  ]);
  const faturas = new Map(((fatRaw ?? []) as (Fatura & { status: string })[]).map((f) => [f.id, f]));
  const pagamentos = (pgRaw ?? []) as PagamentoDb[];
  const doAcordo = (fid: string) => pagamentos.filter((p) => p.fatura_id === fid && p.acordo_parcela_id && parcelaIds.includes(p.acordo_parcela_id));

  const { rateio, sobra } = distribuirParcela(
    af
      .filter((a) => faturas.get(a.fatura_id)?.status === "renegociada")
      .map((a) => {
        const pg = doAcordo(a.fatura_id).map(paraPagamento);
        return {
          faturaId: a.fatura_id,
          vencimento: faturas.get(a.fatura_id)!.vencimento,
          principal: paraCentavos(a.principal),
          multa: paraCentavos(a.multa),
          juros: paraCentavos(a.juros),
          desconto: paraCentavos(a.desconto),
          pago: {
            principal: pg.reduce((s, p) => s + p.principal, 0),
            multa: pg.reduce((s, p) => s + p.multa, 0),
            juros: pg.reduce((s, p) => s + p.juros, 0),
          },
        };
      }),
    paraCentavos(parcela.valor),
  );
  if (sobra > 0) throw new ErroValidacao("O valor desta parcela passa do que falta nas cobranças do acordo. Confira o acordo.");
  if (!rateio.length) throw new ErroValidacao("Não há cobranças em aberto neste acordo.");

  const novos = rateio.map((x, i) => ({
    fatura_id: x.faturaId,
    pago_em: r.pagoEm,
    valor: paraReais(x.valor),
    principal: paraReais(x.principal),
    multa: paraReais(x.multa),
    juros: paraReais(x.juros),
    desconto: paraReais(x.desconto),
    forma,
    conta_id: r.contaId || null,
    origem: "acordo",
    acordo_parcela_id: parcela.id,
    // O item do extrato fica ligado a uma fatura só (a primeira do rateio).
    extrato_item_id: i === 0 ? r.extratoItemId || null : null,
    observacao: `Parcela ${parcela.numero === 0 ? "de entrada" : parcela.numero} do acordo nº ${acordo.numero}${r.observacao ? ` · ${r.observacao}` : ""}`,
  }));

  const liquidacoes: (Liquidacao & { conciliado: boolean })[] = [];
  for (const x of rateio.filter((y) => y.quita)) {
    const f = faturas.get(x.faturaId)!;
    const c = await carregarContrato(sb, f.contrato_id);
    if (!c) throw new ErroValidacao("Contrato não encontrado.");
    const todos = [...pagamentos.filter((p) => p.fatura_id === x.faturaId).map(paraPagamento), { data: r.pagoEm, valor: x.valor, principal: x.principal, multa: x.multa, juros: x.juros, desconto: x.desconto }];
    const extras = itensDaQuitacao(todos, {
      multaPct: Number(c.contrato.multa_atraso_pct),
      destinoEncargos: destinoEncargos(c.contrato),
      rotuloDesconto: `Desconto do acordo nº ${acordo.numero}`,
    });
    const lq = await prepararLiquidacao(sb, c, f, ((itensRaw ?? []) as FaturaItem[]).filter((i) => i.fatura_id === f.id), extras, {
      pagoEm: r.pagoEm,
      formaPagamento: forma,
      valorPago: paraReais(todos.reduce((s, p) => s + p.valor, 0)),
    });
    liquidacoes.push({ ...lq, conciliado: Boolean(r.extratoItemId) });
  }

  const { error } = await sb.rpc("registrar_recebimento", {
    p: { pagamentos: novos, liquidacoes, parcela: { id: parcela.id, pago_em: r.pagoEm, forma, conta_id: r.contaId || null }, chave_baixa: r.chaveBaixa || null },
  });
  if (error) throw new Error(error.message);
  return { quitadas: liquidacoes.length };
}
