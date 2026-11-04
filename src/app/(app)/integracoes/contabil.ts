import "server-only";
import { fimDoMes, hojeISO, inicioDoMes, somarMeses } from "@/lib/dominio/datas";
import { valorRealizado } from "@/lib/dominio/financeiro";
import { linhaContabil, type ItemMapa, type LancamentoContabil, type LinhaContabil } from "@/lib/dominio/integracoes";
import { todas } from "../financeiro/dados";
import type { Supabase } from "./dados";

export type FiltroContabil = { de: string; ate: string; regime: "caixa" | "competencia"; terceiros: boolean };

const dataOk = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

/**
 * Período padrão: o mês passado (o contador costuma fechar o mês anterior).
 * "Valores de terceiros" só existem na imobiliária: no modo pessoal ficam sempre de fora.
 */
export function lerFiltroContabil(sp: Record<string, string | string[] | undefined> | URLSearchParams, modo?: string | null): FiltroContabil {
  const get = (k: string) => (sp instanceof URLSearchParams ? sp.get(k) : typeof sp[k] === "string" ? (sp[k] as string) : null);
  const passado = somarMeses(inicioDoMes(hojeISO()), -1);
  let de = dataOk(get("de")) ?? passado;
  let ate = dataOk(get("ate")) ?? fimDoMes(passado);
  if (ate < de) [de, ate] = [ate, de];
  return { de, ate, regime: get("regime") === "competencia" ? "competencia" : "caixa", terceiros: modo !== "pessoal" && get("terceiros") === "sim" };
}

type Bruto = {
  tipo: "receber" | "pagar";
  descricao: string;
  categoria: string | null;
  valor: number;
  valor_pago: number | null;
  vencimento: string;
  liquidado_em: string | null;
  documento_numero: string | null;
  plano_id: string | null;
  conta_id: string | null;
  plano: { codigo: string } | null;
  conta: { nome: string } | null;
  pessoa: { nome: string } | null;
};

/**
 * Lançamentos do período no formato contábil (todas as páginas, sem o corte de 1.000 linhas).
 * A pessoa vem pela chave lancamentos_pessoa_id_fkey: lancamentos tem duas ligações com
 * pessoas (pessoa_id e descontar_de_id) e, sem dizer qual, o PostgREST recusa a consulta.
 */
export async function lancamentosContabeis(supabase: Supabase, f: FiltroContabil): Promise<{ lancamentos: LancamentoContabil[]; mapa: ItemMapa[]; linhas: LinhaContabil[] }> {
  const campoData = f.regime === "caixa" ? "liquidado_em" : "vencimento";
  const [brutos, mapaBruto] = await Promise.all([
    todas<Bruto>(() => {
      let q = supabase
        .from("lancamentos")
        .select("tipo, descricao, categoria, valor, valor_pago, vencimento, liquidado_em, documento_numero, plano_id, conta_id, plano:plano_contas(codigo), conta:contas_financeiras(nome), pessoa:pessoas!lancamentos_pessoa_id_fkey(nome)")
        .gte(campoData, f.de)
        .lte(campoData, f.ate);
      q = f.regime === "caixa" ? q.eq("status", "liquidado") : q.neq("status", "cancelado");
      if (!f.terceiros) q = q.eq("terceiros", false);
      return q.order(campoData).order("id");
    }),
    supabase.from("contabil_contas_mapa").select("origem_tipo, origem_id, origem_texto, conta_contabil, historico_padrao"),
  ]);
  const mapa = (mapaBruto.data ?? []) as ItemMapa[];
  const lancamentos: LancamentoContabil[] = brutos.map((l) => ({
    data: (f.regime === "caixa" ? l.liquidado_em : l.vencimento) ?? l.vencimento,
    tipo: l.tipo,
    descricao: l.descricao,
    categoria: l.categoria,
    valor: f.regime === "caixa" ? valorRealizado({ valor: Number(l.valor), valor_pago: l.valor_pago === null ? null : Number(l.valor_pago) }) : Number(l.valor),
    documento: l.documento_numero,
    pessoa: l.pessoa?.nome ?? null,
    plano_id: l.plano_id,
    plano_codigo: l.plano?.codigo ?? null,
    conta_id: l.conta_id,
    conta_nome: l.conta?.nome ?? null,
  }));
  return { lancamentos, mapa, linhas: lancamentos.map((l) => linhaContabil(l, mapa)) };
}
