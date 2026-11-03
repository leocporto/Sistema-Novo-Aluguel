import "server-only";
import { cache } from "react";
import { obterContexto } from "@/lib/contexto";
import { identificacaoImovel } from "@/lib/dominio/cobrancas";
import { hojeISO } from "@/lib/dominio/datas";
import { paraReais } from "@/lib/dominio/dinheiro";
import { aluguelDaFatura, paraPagamento, situacaoDaFatura, ultimoRecebimento, type PagamentoDb } from "@/lib/servicos/cobrancas";
import { carregarContrato, locatarioPrincipal } from "@/lib/servicos/locacao";
import type { Fatura, FaturaItem } from "@/lib/tipos";
import type { AlvoRecebimento } from "./recebimento";

export type FaturaCompleta = Fatura & {
  valor_recebido: number | string;
  valor_abatido: number | string;
  token_publico: string;
  acordo_id: string | null;
  juridico_id: string | null;
  url_pagamento: string | null;
  comprovante_path: string | null;
  segunda_via_vista_em: string | null;
  conta_id: string | null;
};

/** Tudo da ficha da fatura (layout e abas usam a mesma leitura no mesmo pedido). */
export const carregarFicha = cache(async (id: string) => {
  const { supabase } = await obterContexto();
  const { data } = await supabase.from("faturas").select("*").eq("id", id).maybeSingle();
  if (!data) return null;
  const fatura = data as FaturaCompleta;
  const [dados, { data: itensRaw }, { data: pgRaw }, { data: acordoRaw }] = await Promise.all([
    carregarContrato(supabase, fatura.contrato_id),
    supabase.from("fatura_itens").select("*").eq("fatura_id", id).order("valor", { ascending: false }),
    supabase.from("fatura_pagamentos").select("*").eq("fatura_id", id).order("pago_em").order("created_at"),
    fatura.acordo_id ? supabase.from("acordos").select("id, numero, status").eq("id", fatura.acordo_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  if (!dados) return null;
  const hoje = hojeISO();
  const itens = (itensRaw ?? []) as FaturaItem[];
  const pagamentos = (pgRaw ?? []) as PagamentoDb[];
  const aluguel = aluguelDaFatura(itens, dados.contrato);
  const sit = fatura.status === "aberta" || fatura.status === "renegociada" ? situacaoDaFatura(fatura, dados.contrato, pagamentos.map(paraPagamento), hoje, aluguel) : null;
  const locatario = locatarioPrincipal(dados);
  const alvo: AlvoRecebimento = {
    faturaId: fatura.id,
    contratoId: dados.contrato.id,
    competencia: fatura.competencia,
    titulo: locatario?.nome ?? "Locatário",
    subtitulo: `${dados.imovel.codigo} · contrato #${dados.contrato.numero}`,
    vencimento: fatura.vencimento,
    valorTotal: Number(fatura.valor_total),
    pagamentos: pagamentos.map((p) => ({ data: p.pago_em, valor: Number(p.valor), principal: Number(p.principal), multa: Number(p.multa), juros: Number(p.juros), desconto: Number(p.desconto) })),
    multaPct: Number(dados.contrato.multa_atraso_pct),
    jurosMesPct: Number(dados.contrato.juros_mes_pct),
    carenciaDias: dados.contrato.carencia_dias,
    pontualidadePct: Number((dados.contrato as { desconto_pontualidade_pct?: number | string }).desconto_pontualidade_pct ?? 0),
    aluguel: paraReais(aluguel),
  };
  const acordo = (acordoRaw ?? null) as { id: string; numero: number; status: string } | null;
  /** Acordo em andamento ou cumprido: recebimentos de antes dele só saem depois de desfazer as parcelas e quebrar/excluir o acordo. */
  const travadoPeloAcordo = Boolean(acordo && (acordo.status === "ativo" || acordo.status === "cumprido"));
  const ultimo = pagamentos.at(-1);
  // "Desfazer" (estornar_baixa) tira o último recebimento; não vale se ele veio de parcela de acordo ou se o acordo trava.
  const desfazer = fatura.status === "paga" && !(ultimo?.acordo_parcela_id || (ultimo && travadoPeloAcordo)) ? ultimoRecebimento(fatura, pagamentos) : null;
  return { fatura, dados, itens, pagamentos, sit, locatario, alvo, hoje, imovelTexto: identificacaoImovel(dados.imovel), acordo, travadoPeloAcordo, desfazer };
});
