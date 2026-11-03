import "server-only";
import type { obterContexto } from "@/lib/contexto";
import { type AjustesComissao, escolherRegra, type RegraComissao, type StatusComissao, type TipoComissao } from "@/lib/dominio/comissoes";
import { paraCentavos, paraReais } from "@/lib/dominio/dinheiro";

type Supabase = Awaited<ReturnType<typeof obterContexto>>["supabase"];
export type OpcaoNome = { id: string; nome: string };

export type Comissao = {
  id: string;
  pessoa_id: string;
  tipo: TipoComissao;
  papel: string | null;
  descricao: string;
  base: number | null;
  percentual: number | null;
  valor: number;
  valor_original: number;
  status: StatusComissao;
  condicionada: boolean;
  dias_pagamento: number;
  previsao: string | null;
  liberada_em: string | null;
  vencimento: string | null;
  motivo: string | null;
  lancamento_id: string | null;
  devolucao_lancamento_id: string | null;
  regra_id: string | null;
  equipe_id: string | null;
  venda_id: string | null;
  proposta_id: string | null;
  contrato_id: string | null;
  repasse_id: string | null;
  imovel_id: string | null;
  origem_id: string | null;
  /** Complemento de ajuste: aponta para a comissão ajustada depois de paga. */
  ajuste_de: string | null;
  /** Fatura de aluguel cujo pagamento liberou esta comissão condicionada. */
  fatura_id: string | null;
  origem_chave: string | null;
  created_at: string;
};

export type ComissaoLista = Comissao & {
  pessoa: { id: string; nome: string; telefone: string | null } | null;
  imovel: { id: string; codigo: string } | null;
  venda: { id: string; numero: number } | null;
};

export const SELECT_COMISSAO = "*, pessoa:pessoas(id, nome, telefone), imovel:imoveis(id, codigo), venda:vendas(id, numero)";

export type Regra = RegraComissao & { nome: string | null; pessoa: { nome: string } | null; equipe: { nome: string } | null };

/**
 * Ajustes de cada comissão depois de paga (complementos ainda valendo e
 * devoluções do corretor), para mostrar o valor efetivo. São poucos registros:
 * carrega todos de uma vez.
 */
export async function carregarAjustes(supabase: Supabase): Promise<Map<string, AjustesComissao>> {
  const [{ data: comps }, { data: devs }] = await Promise.all([
    supabase.from("comissoes").select("ajuste_de, valor").not("ajuste_de", "is", null).not("status", "in", "(cancelada,estornada)").limit(5000),
    supabase.from("lancamentos").select("comissao_devolucao_id, valor").not("comissao_devolucao_id", "is", null).neq("status", "cancelado").limit(5000),
  ]);
  const m = new Map<string, { complementos: number; devolucoes: number }>();
  const pegar = (id: string) => m.get(id) ?? m.set(id, { complementos: 0, devolucoes: 0 }).get(id)!;
  for (const c of comps ?? []) pegar(c.ajuste_de as string).complementos += paraCentavos(c.valor);
  for (const d of devs ?? []) pegar(d.comissao_devolucao_id as string).devolucoes += paraCentavos(d.valor);
  return new Map([...m].map(([id, v]) => [id, { complementos: paraReais(v.complementos), devolucoes: paraReais(v.devolucoes) }]));
}

/**
 * Divisão inicial da comissão de uma venda nova — igual ao aceitar_proposta do
 * banco: captador do imóvel com a parte da regra de angariação (se houver) e o
 * corretor que vende com a parte da regra de venda (sem regra: 100% menos a parte do captador).
 */
export async function divisaoInicialDaVenda(supabase: Supabase, corretorId: string | null, imovelId: string | null) {
  const { data: im } = imovelId ? await supabase.from("imoveis").select("corretor_id").eq("id", imovelId).maybeSingle() : { data: null };
  const captador = (im?.corretor_id as string | null) ?? null;
  if (!corretorId && !captador) return [];
  const base = await carregarBaseComissoes(supabase);
  const partes: { pessoa_id: string; papel: "captador" | "vendedor"; percentual: number }[] = [];
  let cap = 0;
  if (captador && captador !== corretorId) {
    const ga = escolherRegra(base.regras, "angariacao", captador, base.equipeDe.get(captador) ?? null);
    if (ga && ga.percentual > 0) {
      cap = ga.percentual;
      partes.push({ pessoa_id: captador, papel: "captador", percentual: cap });
    }
  }
  if (corretorId) {
    const g = escolherRegra(base.regras, "venda", corretorId, base.equipeDe.get(corretorId) ?? null);
    const pct = Math.min(g?.percentual ?? 100, 100 - cap);
    if (pct > 0) partes.push({ pessoa_id: corretorId, papel: "vendedor", percentual: pct });
  }
  return partes;
}

/** Corretores e parceiros (quem recebe comissão), equipes, regras e a equipe de cada pessoa. */
export async function carregarBaseComissoes(supabase: Supabase) {
  const [{ data: pessoas }, { data: equipes }, { data: membros }, { data: regras }] = await Promise.all([
    supabase.from("pessoas").select("id, nome").overlaps("papeis", ["corretor", "parceiro"]).order("nome"),
    supabase.from("equipes").select("id, nome, lider_id, ativa").order("nome"),
    supabase.from("equipe_membros").select("id, equipe_id, pessoa_id"),
    supabase.from("comissao_regras").select("*, pessoa:pessoas(nome), equipe:equipes(nome)").order("tipo").order("created_at"),
  ]);
  const equipeDe = new Map((membros ?? []).map((m) => [m.pessoa_id as string, m.equipe_id as string]));
  return {
    corretores: (pessoas ?? []) as OpcaoNome[],
    equipes: (equipes ?? []) as { id: string; nome: string; lider_id: string | null; ativa: boolean }[],
    membros: (membros ?? []) as { id: string; equipe_id: string; pessoa_id: string }[],
    regras: ((regras ?? []) as unknown as Regra[]).map((r) => ({ ...r, percentual: Number(r.percentual) })),
    equipeDe,
  };
}
