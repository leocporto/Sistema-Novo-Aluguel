import "server-only";
import type { obterContexto } from "@/lib/contexto";
import { somarDias } from "@/lib/dominio/datas";
import { saldoConta, sugerirConciliacao, type CandidatoConciliacao, type MovConta } from "@/lib/dominio/financeiro";

type Supabase = Awaited<ReturnType<typeof obterContexto>>["supabase"];

type Consulta = { range: (de: number, ate: number) => PromiseLike<{ data: unknown; error: { message: string } | null }> };

/**
 * Busca TODAS as linhas de uma consulta, de 1.000 em 1.000 (o Supabase corta
 * cada resposta em 1.000 linhas sem avisar). A consulta precisa ter `.order()`
 * por uma coluna única (ex.: id) para a paginação não pular nem repetir linhas.
 */
export async function todas<T>(montar: () => Consulta, maximo = 100_000): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < maximo; i += 1000) {
    const { data, error } = await montar().range(i, i + 999);
    if (error) throw new Error(error.message);
    const pagina = (data ?? []) as T[];
    out.push(...pagina);
    if (pagina.length < 1000) break;
  }
  return out;
}

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
  const [{ data: contas }, { data: planos }, { data: centros }, pessoas] = await Promise.all([
    supabase.from("contas_financeiras").select("*").order("nome"),
    supabase.from("plano_contas").select("*").order("codigo"),
    supabase.from("centros_custo").select("*").order("nome"),
    todas<{ id: string; nome: string }>(() => supabase.from("pessoas").select("id, nome").order("nome").order("id"), 10_000),
  ]);
  return {
    contas: (contas ?? []) as Conta[],
    planos: (planos ?? []) as Plano[],
    centros: (centros ?? []) as Centro[],
    pessoas,
  };
}

/**
 * Movimentos que mexem no saldo das contas: lançamentos baixados, aluguéis
 * recebidos (cada recebimento na sua data, inclusive os parciais — visão
 * `alugueis_recebidos`, que não conta duas vezes o que já virou lançamento no
 * modo pessoal) e repasses pagos que foram ligados a uma conta, e transferências.
 */
export async function movimentosDasContas(supabase: Supabase) {
  type L = MovConta;
  type A = { valor: number; data: string; conta_id: string };
  type R = { valor_liquido: number; pago_em: string; conta_id: string };
  type T = { id: string; origem_id: string; destino_id: string; valor: number; data: string; descricao: string | null };
  const [l, f, r, transferencias] = await Promise.all([
    // A taxa de administração (lançamento com fatura_id na imobiliária) está dentro do aluguel recebido: não conta de novo.
    // O lançamento "Aluguel" do modo pessoal conta (a visão abaixo tira a conta dele para não somar duas vezes).
    todas<L>(() =>
      supabase.from("lancamentos").select("tipo, valor, valor_pago, liquidado_em, conta_id, status").not("conta_id", "is", null).eq("status", "liquidado").or("fatura_id.is.null,categoria.eq.Aluguel").order("id"),
    ),
    // Cada recebimento de aluguel (inclusive parcial) na sua data e na sua conta.
    todas<A>(() => supabase.from("alugueis_recebidos").select("valor, data, conta_id").not("conta_id", "is", null).order("id")),
    todas<R>(() => supabase.from("repasses").select("valor_liquido, pago_em, conta_id").not("conta_id", "is", null).eq("status", "pago").order("id")),
    todas<T>(() => supabase.from("transferencias").select("id, origem_id, destino_id, valor, data, descricao").order("data", { ascending: false }).order("id")),
  ]);
  const movs: MovConta[] = [
    ...l,
    ...f.map((x) => ({ tipo: "receber" as const, valor: Number(x.valor), liquidado_em: x.data, conta_id: x.conta_id, status: "liquidado" })),
    ...r.map((x) => ({ tipo: "pagar" as const, valor: Number(x.valor_liquido), liquidado_em: x.pago_em, conta_id: x.conta_id, status: "liquidado" })),
  ];
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
  type F = { id: string; numero: number; valor_total: number; valor_pago: number | null; vencimento: string; pago_em: string | null; status: string; contrato: { imovel: { codigo: string } | null } | null };
  type R = { id: string; valor_liquido: number; previsto_para: string; pago_em: string | null; status: string; pessoa: { nome: string } | null };
  // Aluguéis e repasses entram só depois de pagos no sistema (a baixa deles tem regras próprias).
  // Lançamentos derivados de aluguel (fatura_id) ficam de fora: concilia-se a fatura.
  const [lanc, fat, rep] = await Promise.all([
    todas<CandidatoConciliacao>(() =>
      supabase
        .from("lancamentos")
        .select("id, tipo, descricao, valor, valor_pago, vencimento, liquidado_em, status, conciliado_em")
        .is("conciliado_em", null)
        .is("fatura_id", null)
        .neq("status", "cancelado")
        .or(`and(vencimento.gte.${de},vencimento.lte.${ate}),and(liquidado_em.gte.${de},liquidado_em.lte.${ate})`)
        .order("id"),
    ),
    todas<F>(() =>
      supabase
        .from("faturas")
        .select("id, numero, valor_total, valor_pago, vencimento, pago_em, status, contrato:contratos(imovel:imoveis(codigo))")
        .is("conciliado_em", null)
        .eq("status", "paga")
        .gte("pago_em", de)
        .lte("pago_em", ate)
        .order("id"),
    ),
    pessoal
      ? Promise.resolve([] as R[])
      : todas<R>(() =>
          supabase.from("repasses").select("id, valor_liquido, previsto_para, pago_em, status, pessoa:pessoas(nome)").is("conciliado_em", null).eq("status", "pago").gte("pago_em", de).lte("pago_em", ate).order("id"),
        ),
  ]);
  const candidatos: CandidatoConciliacao[] = [];
  for (const l of lanc) candidatos.push({ ...l, id: `l:${l.id}` });
  for (const f of fat)
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
  for (const r of rep)
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
