import "server-only";
import { cache } from "react";
import type { obterContexto } from "@/lib/contexto";
import { paraCentavos } from "@/lib/dominio/dinheiro";
import { type DescontoPlanejado, type DespesaADescontar, planejarDescontos } from "@/lib/dominio/repasses";

type Supabase = Awaited<ReturnType<typeof obterContexto>>["supabase"];

export type PessoaRepasse = {
  id: string;
  nome: string;
  documento: string | null;
  email: string | null;
  telefone: string | null;
  banco: string | null;
  agencia: string | null;
  conta: string | null;
  tipo_conta: string | null;
  pix_chave: string | null;
  cidade: string | null;
};

export type RepasseCompleto = {
  id: string;
  contrato_id: string;
  fatura_id: string | null;
  pessoa_id: string;
  competencia: string;
  percentual: number;
  aluguel: number;
  encargos: number;
  multa_juros: number;
  valor_bruto: number;
  taxa_administracao: number;
  taxa_intermediacao: number;
  irrf: number;
  imposto: number;
  imposto_pct: number;
  outros_descontos: number;
  valor_liquido: number;
  previsto_para: string;
  programado_para: string | null;
  status: "pendente" | "pago" | "cancelado";
  pago_em: string | null;
  comprovante: string | null;
  comprovante_path: string | null;
  forma_pagamento: string | null;
  conta_id: string | null;
  aprovado_em: string | null;
  aprovado_por: string | null;
  pago_por: string | null;
  cancelado_motivo: string | null;
  observacoes: string | null;
  conciliado_em: string | null;
  created_at: string;
  pessoa: PessoaRepasse;
  contrato: { id: string; numero: number; imovel: { id: string; codigo: string; logradouro: string | null; numero: string | null; cidade: string | null } };
  fatura: { id: string; numero: number; pago_em: string | null } | null;
};

export const SELECT_REPASSE =
  "*, pessoa:pessoas(id, nome, documento, email, telefone, banco, agencia, conta, tipo_conta, pix_chave, cidade), contrato:contratos(id, numero, imovel:imoveis(id, codigo, logradouro, numero, cidade)), fatura:faturas(id, numero, pago_em)";

/** Repasse com proprietário, contrato e fatura (uma ida ao banco por requisição, mesmo usado no layout e na página). */
export const carregarRepasse = cache(async (supabase: Supabase, id: string): Promise<RepasseCompleto | null> => {
  const { data } = await supabase.from("repasses").select(SELECT_REPASSE).eq("id", id).maybeSingle();
  return (data as unknown as RepasseCompleto) ?? null;
});

/**
 * Donos do imóvel: os do cadastro do imóvel e os proprietários dos contratos dele
 * (de quem uma despesa autorizada pode ser descontada).
 */
export async function donosDoImovel(supabase: Supabase, imovelId: string): Promise<Set<string>> {
  const [{ data: cad }, { data: partes }] = await Promise.all([
    supabase.from("imovel_proprietarios").select("pessoa_id").eq("imovel_id", imovelId),
    supabase.from("contrato_partes").select("pessoa_id, contrato:contratos!inner(imovel_id)").eq("papel", "proprietario").eq("contrato.imovel_id", imovelId),
  ]);
  return new Set([...(cad ?? []), ...(partes ?? [])].map((p) => p.pessoa_id as string).filter(Boolean));
}

/** Proprietários do contrato e a participação de cada um (base do rateio das despesas). */
export async function participacoesDoContrato(supabase: Supabase, contratoId: string) {
  const { data } = await supabase.from("contrato_partes").select("pessoa_id, percentual").eq("contrato_id", contratoId).eq("papel", "proprietario");
  return (data ?? []).map((p) => ({ pessoaId: p.pessoa_id as string, percentual: Number(p.percentual ?? 0) }));
}

export type DespesaAutorizada = {
  id: string;
  descricao: string;
  valor: number;
  vencimento: string;
  status: string;
  liquidado_em: string | null;
  imovel_id: string | null;
  descontar_de_id: string | null;
  repasse_id: string | null;
  pessoa_id: string | null;
  observacoes: string | null;
  created_at: string;
};

/** Despesas autorizadas ainda não descontadas de um imóvel, com o que já foi descontado por proprietário. */
export async function despesasDoImovel(supabase: Supabase, imovelId: string): Promise<DespesaADescontar[]> {
  const { data } = await supabase
    .from("lancamentos")
    .select("id, descricao, valor, vencimento, imovel_id, descontar_de_id")
    .eq("descontar_repasse", true)
    .eq("imovel_id", imovelId)
    .is("repasse_id", null)
    .neq("status", "cancelado")
    .order("vencimento");
  const lista = data ?? [];
  const ids = lista.map((l) => l.id as string);
  const { data: feitos } = ids.length
    ? await supabase.from("repasse_descontos").select("lancamento_id, valor, repasse:repasses(pessoa_id)").in("lancamento_id", ids)
    : { data: [] };
  const porDespesa = new Map<string, Record<string, number>>();
  for (const f of (feitos ?? []) as unknown as { lancamento_id: string; valor: number; repasse: { pessoa_id: string } | null }[]) {
    const m = porDespesa.get(f.lancamento_id) ?? {};
    const p = f.repasse?.pessoa_id ?? "?";
    m[p] = (m[p] ?? 0) + paraCentavos(f.valor);
    porDespesa.set(f.lancamento_id, m);
  }
  return lista.map((l) => ({
    id: l.id as string,
    descricao: l.descricao as string,
    valor: paraCentavos(l.valor),
    vencimento: l.vencimento as string,
    imovelId: l.imovel_id as string | null,
    descontarDeId: l.descontar_de_id as string | null,
    descontadoPorPessoa: porDespesa.get(l.id as string) ?? {},
  }));
}

/** O que será descontado deste repasse ao aprovar (prévia na tela e gravação usam a mesma conta). */
export async function planoDoRepasse(
  supabase: Supabase,
  r: Pick<RepasseCompleto, "contrato_id" | "pessoa_id" | "valor_liquido"> & { contrato: { imovel: { id: string } } },
): Promise<DescontoPlanejado[]> {
  const [despesas, participacoes] = await Promise.all([despesasDoImovel(supabase, r.contrato.imovel.id), participacoesDoContrato(supabase, r.contrato_id)]);
  return planejarDescontos({ pessoaId: r.pessoa_id, imovelId: r.contrato.imovel.id, liquido: paraCentavos(r.valor_liquido) }, despesas, participacoes);
}

/** Nomes dos usuários (membros) para mostrar quem aprovou/pagou. */
export async function nomesDosMembros(supabase: Supabase): Promise<Map<string, string>> {
  const { data } = await supabase.from("membros").select("user_id, nome").limit(500);
  return new Map((data ?? []).map((m) => [m.user_id as string, (m.nome as string | null) ?? "usuário"]));
}

export const dadosBancarios = (p: Pick<PessoaRepasse, "banco" | "agencia" | "conta" | "tipo_conta">) =>
  [p.banco && `Banco ${p.banco}`, p.agencia && `Ag. ${p.agencia}`, p.conta && `${p.tipo_conta === "poupanca" ? "Poupança" : "Conta"} ${p.conta}`].filter(Boolean).join(" · ");
