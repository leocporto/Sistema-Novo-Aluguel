import "server-only";
import type { obterContexto } from "@/lib/contexto";
import { somarDias } from "@/lib/dominio/datas";
import { saldoConta, sugerirConciliacao, type CandidatoConciliacao, type MovConta } from "@/lib/dominio/financeiro";

type Supabase = Awaited<ReturnType<typeof obterContexto>>["supabase"];

export type Conta = {
  id: string;
  nome: string;
  tipo: string;
  banco: string | null;
  agencia: string | null;
  conta: string | null;
  pix_chave: string | null;
  saldo_inicial: number;
  saldo_inicial_em: string;
  terceiros: boolean;
  ativa: boolean;
};

export type Plano = { id: string; codigo: string; nome: string; tipo: "receita" | "despesa"; grupo_dre: string; ativo: boolean };
export type Centro = { id: string; nome: string; ativo: boolean };

export type Lancamento = {
  id: string;
  tipo: "receber" | "pagar";
  descricao: string;
  categoria: string | null;
  valor: number;
  vencimento: string;
  status: string;
  liquidado_em: string | null;
  pessoa_id: string | null;
  contrato_id: string | null;
  fatura_id: string | null;
  imovel_id: string | null;
  venda_id: string | null;
  serie_id: string | null;
  conta_id: string | null;
  plano_id: string | null;
  centro_custo_id: string | null;
  forma: string | null;
  documento_numero: string | null;
  parcela: number | null;
  parcelas: number | null;
  valor_pago: number | null;
  juros: number;
  desconto: number;
  conciliado_em: string | null;
  terceiros: boolean;
  adiantamento: boolean;
  compensado_em: string | null;
  requer_aprovacao: boolean;
  aprovado_em: string | null;
  cancelado_motivo: string | null;
  observacoes: string | null;
  created_at: string;
};

/** Opções para os formulários (contas, plano, centros, pessoas). */
export async function opcoesFinanceiro(supabase: Supabase) {
  const [{ data: contas }, { data: planos }, { data: centros }, { data: pessoas }] = await Promise.all([
    supabase.from("contas_financeiras").select("*").order("nome"),
    supabase.from("plano_contas").select("*").order("codigo"),
    supabase.from("centros_custo").select("*").order("nome"),
    supabase.from("pessoas").select("id, nome").order("nome").limit(2000),
  ]);
  return {
    contas: (contas ?? []) as Conta[],
    planos: (planos ?? []) as Plano[],
    centros: (centros ?? []) as Centro[],
    pessoas: (pessoas ?? []) as { id: string; nome: string }[],
  };
}

/**
 * Movimentos que mexem no saldo das contas: lançamentos baixados, aluguéis
 * recebidos e repasses pagos que foram ligados a uma conta, e transferências.
 */
export async function movimentosDasContas(supabase: Supabase) {
  const [{ data: l }, { data: f }, { data: r }, { data: t }] = await Promise.all([
    supabase.from("lancamentos").select("tipo, valor, valor_pago, liquidado_em, conta_id, status").not("conta_id", "is", null).eq("status", "liquidado"),
    supabase.from("faturas").select("valor_total, valor_pago, pago_em, conta_id").not("conta_id", "is", null).eq("status", "paga"),
    supabase.from("repasses").select("valor_liquido, pago_em, conta_id").not("conta_id", "is", null).eq("status", "pago"),
    supabase.from("transferencias").select("id, origem_id, destino_id, valor, data, descricao").order("data", { ascending: false }),
  ]);
  const movs: MovConta[] = [
    ...((l ?? []) as MovConta[]),
    ...(f ?? []).map((x) => ({ tipo: "receber" as const, valor: Number(x.valor_pago ?? x.valor_total), liquidado_em: x.pago_em, conta_id: x.conta_id, status: "liquidado" })),
    ...(r ?? []).map((x) => ({ tipo: "pagar" as const, valor: Number(x.valor_liquido), liquidado_em: x.pago_em, conta_id: x.conta_id, status: "liquidado" })),
  ];
  const transferencias = (t ?? []) as { id: string; origem_id: string; destino_id: string; valor: number; data: string; descricao: string | null }[];
  return { movs, transferencias };
}

export async function saldosDasContas(supabase: Supabase, contas: Conta[], ate?: string) {
  const { movs, transferencias } = await movimentosDasContas(supabase);
  return new Map(contas.map((c) => [c.id, saldoConta({ ...c, saldo_inicial: Number(c.saldo_inicial) }, movs, transferencias, ate)]));
}

type ItemAberto = { id: string; data: string; valor: number; descricao: string };

/**
 * Para cada linha do extrato ainda não conciliada, os lançamentos, aluguéis
 * (faturas) e repasses que batem em sentido, valor e data — do melhor para o
 * pior. Ids dos candidatos vêm com prefixo: "l:" lançamento, "f:" fatura, "r:" repasse.
 * Um candidato só é sugerido como melhor opção para uma linha.
 */
export async function sugestoesDeConciliacao(supabase: Supabase, pessoal: boolean, abertos: ItemAberto[]) {
  const sugestoes = new Map<string, CandidatoConciliacao[]>();
  const datas = abertos.map((i) => i.data).sort();
  if (!datas.length) return sugestoes;
  const de = somarDias(datas[0], -15);
  const ate = somarDias(datas[datas.length - 1], 15);
  const [{ data: lanc }, { data: fat }, { data: rep }] = await Promise.all([
    supabase
      .from("lancamentos")
      .select("id, tipo, descricao, valor, valor_pago, vencimento, liquidado_em, status, conciliado_em")
      .is("conciliado_em", null)
      .neq("status", "cancelado")
      .or(`and(vencimento.gte.${de},vencimento.lte.${ate}),and(liquidado_em.gte.${de},liquidado_em.lte.${ate})`)
      .limit(2000),
    supabase
      .from("faturas")
      .select("id, numero, valor_total, valor_pago, vencimento, pago_em, status, contrato:contratos(imovel:imoveis(codigo))")
      .is("conciliado_em", null)
      .neq("status", "cancelada")
      .or(`and(vencimento.gte.${de},vencimento.lte.${ate}),and(pago_em.gte.${de},pago_em.lte.${ate})`)
      .limit(2000),
    pessoal
      ? Promise.resolve({ data: [] })
      : supabase
          .from("repasses")
          .select("id, valor_liquido, previsto_para, pago_em, status, pessoa:pessoas(nome)")
          .is("conciliado_em", null)
          .neq("status", "cancelado")
          .or(`and(previsto_para.gte.${de},previsto_para.lte.${ate}),and(pago_em.gte.${de},pago_em.lte.${ate})`)
          .limit(2000),
  ]);
  const candidatos: CandidatoConciliacao[] = [];
  for (const l of (lanc ?? []) as CandidatoConciliacao[]) candidatos.push({ ...l, id: `l:${l.id}` });
  for (const f of (fat ?? []) as unknown as { id: string; numero: number; valor_total: number; valor_pago: number | null; vencimento: string; pago_em: string | null; status: string; contrato: { imovel: { codigo: string } | null } | null }[])
    candidatos.push({
      id: `f:${f.id}`,
      tipo: "receber",
      descricao: `Aluguel · fatura #${f.numero}${f.contrato?.imovel ? ` · ${f.contrato.imovel.codigo}` : ""}`,
      valor: Number(f.valor_total),
      valor_pago: f.valor_pago,
      vencimento: f.vencimento,
      liquidado_em: f.pago_em,
      status: f.status === "paga" ? "liquidado" : "aberto",
    });
  for (const r of (rep ?? []) as unknown as { id: string; valor_liquido: number; previsto_para: string; pago_em: string | null; status: string; pessoa: { nome: string } | null }[])
    candidatos.push({
      id: `r:${r.id}`,
      tipo: "pagar",
      descricao: `Repasse · ${r.pessoa?.nome ?? "proprietário"}`,
      valor: Number(r.valor_liquido),
      vencimento: r.previsto_para,
      liquidado_em: r.pago_em,
      status: r.status === "pago" ? "liquidado" : "aberto",
    });
  const usados = new Set<string>();
  for (const i of [...abertos].sort((a, b) => a.data.localeCompare(b.data))) {
    const s = sugerirConciliacao(i, candidatos, usados).slice(0, 3);
    if (s[0]) usados.add(s[0].id);
    sugestoes.set(i.id, s);
  }
  return sugestoes;
}
