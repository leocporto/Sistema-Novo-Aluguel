import "server-only";
import type { obterContexto } from "@/lib/contexto";
import { agruparInadimplencia, indicadoresRecuperacao, type GrupoInadimplencia } from "@/lib/dominio/cobrancas";
import { fimDoMes, inicioDoMes, somarMeses } from "@/lib/dominio/datas";
import { paraCentavos } from "@/lib/dominio/dinheiro";
import { carregarCobrancas } from "../dados";

type Supabase = Awaited<ReturnType<typeof obterContexto>>["supabase"];

export const PERIODOS: Record<string, string> = { mes: "Este mês", "3m": "Últimos 3 meses", "12m": "Últimos 12 meses", ano: "Este ano" };
export const AGRUPAR: Record<string, string> = { locatario: "Por locatário", imovel: "Por imóvel", contrato: "Por contrato" };

export function intervalo(periodo: string, hoje: string): [string, string] {
  const ini = inicioDoMes(hoje);
  if (periodo === "3m") return [somarMeses(ini, -2), fimDoMes(hoje)];
  if (periodo === "12m") return [somarMeses(ini, -11), fimDoMes(hoje)];
  if (periodo === "ano") return [`${hoje.slice(0, 4)}-01-01`, `${hoje.slice(0, 4)}-12-31`];
  return [ini, fimDoMes(hoje)];
}

/** Dados dos relatórios de inadimplência e recuperação. */
export async function relatorioCobrancas(supabase: Supabase, hoje: string, periodo: string, agrupar: string) {
  const [de, ate] = intervalo(periodo, hoje);
  const [abertas, { data: fat }, { data: acordos }] = await Promise.all([
    carregarCobrancas(supabase, hoje, { venceAte: hoje, status: ["aberta", "renegociada"] }),
    supabase.from("faturas").select("id, vencimento, valor_total, status, pago_em, valor_pago").neq("status", "cancelada").gte("vencimento", somarMeses(de, -12)).lte("vencimento", ate).limit(20000),
    supabase.from("acordos").select("status, data, cumprido_em, quebrado_em, total").limit(5000),
  ]);
  const faturas = (fat ?? []) as { id: string; vencimento: string; valor_total: number; status: string; pago_em: string | null; valor_pago: number | null }[];
  const ids = faturas.map((f) => f.id);
  const pagamentos: { fatura_id: string; pago_em: string; valor: number; principal: number; multa: number; juros: number; desconto: number }[] = [];
  for (let i = 0; i < ids.length; i += 300) {
    const { data } = await supabase.from("fatura_pagamentos").select("fatura_id, pago_em, valor, principal, multa, juros, desconto").in("fatura_id", ids.slice(i, i + 300));
    pagamentos.push(...((data ?? []) as typeof pagamentos));
  }
  const comPagamento = new Set(pagamentos.map((p) => p.fatura_id));
  // Faturas pagas antes dos pagamentos parciais existirem: um recebimento só, na data da baixa.
  const recebimentos = [
    ...pagamentos.map((p) => ({
      faturaId: p.fatura_id,
      data: p.pago_em,
      valor: paraCentavos(p.valor),
      principal: paraCentavos(p.principal),
      multa: paraCentavos(p.multa),
      juros: paraCentavos(p.juros),
      desconto: paraCentavos(p.desconto),
    })),
    ...faturas
      .filter((f) => f.status === "paga" && f.pago_em && !comPagamento.has(f.id))
      .map((f) => ({
        faturaId: f.id,
        data: f.pago_em!,
        valor: paraCentavos(f.valor_pago ?? f.valor_total),
        principal: paraCentavos(f.valor_total),
        multa: Math.max(0, paraCentavos(f.valor_pago ?? f.valor_total) - paraCentavos(f.valor_total)),
        juros: 0,
        desconto: 0,
      })),
  ];
  const ind = indicadoresRecuperacao({
    faturas: faturas.map((f) => ({ id: f.id, vencimento: f.vencimento, valorTotal: paraCentavos(f.valor_total), status: f.status })),
    recebimentos,
    acordos: ((acordos ?? []) as { status: string; data: string; cumprido_em: string | null; quebrado_em: string | null; total: number }[]).map((a) => ({
      status: a.status,
      data: a.data,
      cumpridoEm: a.cumprido_em,
      quebradoEm: a.quebrado_em,
      total: paraCentavos(a.total),
    })),
    de,
    ate,
    hoje,
  });
  const vencidas = abertas.filter((c) => c.dias > 0 && c.status === "aberta").map((c) => ({ ...c, valor: c.sit.saldo }));
  const emAcordo = abertas.filter((c) => c.status === "renegociada").reduce((s, c) => s + c.sit.saldo, 0);
  const chave = (c: (typeof vencidas)[number]) => (agrupar === "imovel" ? c.imovelId : agrupar === "contrato" ? c.contratoId : (c.locatario?.id ?? c.contratoId));
  const rotulo = (c: (typeof vencidas)[number]) =>
    agrupar === "imovel" ? c.imovelTexto : agrupar === "contrato" ? `Contrato #${c.contratoNumero} · ${c.locatario?.nome ?? "—"}` : (c.locatario?.nome ?? "Locatário sem cadastro");
  const grupos: GrupoInadimplencia[] = agruparInadimplencia(vencidas, chave, rotulo);
  return { de, ate, ind, vencidas, grupos, emAcordo };
}
