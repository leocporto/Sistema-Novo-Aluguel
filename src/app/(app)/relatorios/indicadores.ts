import "server-only";
import {
  inadimplenciaPorVencimento,
  receitaImobiliaria,
  resultadoFinanceiro,
  somarFinanceiro,
  taxa,
  taxaOcupacao,
  tempoParaAlugar,
  tempoParaVender,
  vacanciaMedia,
  variacao,
  type Intervalo,
  type Sentido,
  type TipoColuna,
} from "@/lib/dominio/bi";
import { carregarFinanceiro, carregarFunil, carregarOcupacao, type Supabase } from "./dados";

export type Indicador = {
  chave: string;
  rotulo: string;
  tipo: Extract<TipoColuna, "dinheiro" | "pct" | "dias" | "inteiro">;
  valor: number | null;
  anterior: number | null;
  variacao: number | null;
  sentido: Sentido;
  explicacao: string;
  detalhe?: string;
};

const fmtR = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/**
 * Indicador com a comparação: variação em % (ou em pontos percentuais quando o
 * próprio indicador já é uma porcentagem).
 */
export function montarIndicador(
  chave: string,
  rotulo: string,
  tipo: Indicador["tipo"],
  valor: number | null,
  anterior: number | null,
  explicacao: string,
  sentido: Sentido = "maior_melhor",
  detalhe?: string,
): Indicador {
  const v = valor === null || anterior === null ? null : tipo === "pct" ? Math.round((valor - anterior) * 10) / 10 : variacao(valor, anterior);
  return { chave, rotulo, tipo, valor, anterior, variacao: v, sentido, explicacao, detalhe };
}

/**
 * Indicadores da Visão geral do período, com o período anterior para
 * comparar. Tudo agregado no banco (public.bi_*); aqui só as contas finais.
 */
export async function calcularIndicadores(supabase: Supabase, periodo: Intervalo, anterior: Intervalo, imob: boolean): Promise<Indicador[]> {
  const [finA, finB, ocA, ocB, fuA, fuB] = await Promise.all([
    carregarFinanceiro(supabase, periodo.inicio, periodo.fim),
    carregarFinanceiro(supabase, anterior.inicio, anterior.fim),
    carregarOcupacao(supabase, periodo.inicio, periodo.fim),
    carregarOcupacao(supabase, anterior.inicio, anterior.fim),
    imob ? carregarFunil(supabase, periodo.inicio, periodo.fim) : Promise.resolve(null),
    imob ? carregarFunil(supabase, anterior.inicio, anterior.fim) : Promise.resolve(null),
  ]);
  const a = somarFinanceiro(finA);
  const b = somarFinanceiro(finB);
  const ia = inadimplenciaPorVencimento(a);
  const ib = inadimplenciaPorVencimento(b);
  const ind = montarIndicador;

  const lista: Indicador[] = [];
  if (imob) {
    lista.push(
      ind(
        "receita_imobiliaria",
        "Receita da imobiliária",
        "dinheiro",
        receitaImobiliaria(a),
        receitaImobiliaria(b),
        "Administração + intermediação + comissão de vendas + outras receitas recebidas no período.",
      ),
      ind(
        "taxa_administracao",
        "Receita de administração",
        "dinheiro",
        a.taxa_administracao,
        b.taxa_administracao,
        "Taxas de administração retidas nos repasses (receita recorrente), pela data em que o aluguel foi pago.",
      ),
      ind(
        "intermediacao",
        "Receita de intermediação",
        "dinheiro",
        a.taxa_intermediacao + a.comissao_vendas,
        b.taxa_intermediacao + b.comissao_vendas,
        "Taxas de intermediação de locação retidas nos repasses + comissão da imobiliária nas vendas concluídas.",
        "maior_melhor",
        `${fmtR(a.taxa_intermediacao)} de locação · ${fmtR(a.comissao_vendas)} de vendas`,
      ),
    );
  }
  lista.push(
    ind("aluguel_recebido", "Aluguéis recebidos", "dinheiro", a.aluguel_recebido, b.aluguel_recebido, "Tudo o que os locatários pagaram no período, na data de cada pagamento (inclui os parciais)."),
    ind("faturado", "Aluguéis faturados", "dinheiro", a.faturado, b.faturado, "Soma das cobranças de aluguel pela competência (mês de referência), menos as canceladas."),
  );
  if (!imob) {
    lista.push(
      ind("resultado", "Resultado", "dinheiro", resultadoFinanceiro(a, true), resultadoFinanceiro(b, true), "Aluguéis recebidos + outras receitas − despesas pagas no período."),
      ind("despesas", "Despesas pagas", "dinheiro", a.despesas, b.despesas, "Contas pagas no período (manutenção, IPTU, condomínio, impostos…).", "menor_melhor"),
    );
  } else {
    lista.push(ind("repasses_pagos", "Repasses pagos", "dinheiro", a.repasses_pagos, b.repasses_pagos, "Valor líquido pago aos proprietários no período."));
  }
  lista.push(
    ind(
      "inadimplencia",
      "Inadimplência",
      "pct",
      ia.pct,
      ib.pct,
      "Das cobranças que venceram no período (até ontem), quanto ainda não foi pago hoje (em aberto + em acordo) ÷ o valor que venceu.",
      "menor_melhor",
      `${fmtR(ia.naoPago)} sem pagar de ${fmtR(ia.vencido)}`,
    ),
    ind("ocupacao", "Taxa de ocupação", "pct", taxaOcupacao(ocA), taxaOcupacao(ocB), "Dias com contrato ÷ dias disponíveis dos imóveis de locação no período (até hoje).", "maior_melhor", `${ocA.alugados_hoje} alugados e ${ocA.vagos_hoje} vagos hoje`),
    ind(
      "vacancia",
      "Vacância média",
      "dias",
      vacanciaMedia(ocA),
      vacanciaMedia(ocB),
      "Dias entre o fim de um contrato e o início do próximo, nos imóveis que voltaram a ser alugados no período; imóvel vago hoje conta até hoje.",
      "menor_melhor",
      `${ocA.vacancia_qtd} caso(s)`,
    ),
    ind(
      "tempo_alugar",
      "Tempo médio para alugar",
      "dias",
      tempoParaAlugar(ocA),
      tempoParaAlugar(ocB),
      "Da entrada como disponível (fim do contrato anterior ou captação) até o início do contrato, nos contratos que começaram no período.",
      "menor_melhor",
      `${ocA.alugar_qtd} contrato(s)`,
    ),
    ind("contratos_novos", "Contratos novos", "inteiro", ocA.contratos_novos, ocB.contratos_novos, "Contratos de locação que começaram no período.", "maior_melhor", `${ocA.contratos_ativos} ativos · ${ocA.contratos_encerrados} encerrados no período`),
  );
  if (imob && fuA && fuB) {
    lista.push(
      ind("leads", "Leads", "inteiro", fuA.leads, fuB.leads, "Leads que chegaram no período (de todos os canais)."),
      ind(
        "conversao",
        "Conversão em negócio",
        "pct",
        taxa(fuA.fechados, fuA.leads),
        taxa(fuB.fechados, fuB.leads),
        "Dos leads que chegaram no período, quantos fecharam negócio (lead ganho, proposta aceita ou venda concluída).",
        "maior_melhor",
        `${fuA.fechados} de ${fuA.leads}`,
      ),
      ind("vendas", "Vendas concluídas", "dinheiro", fuA.valor_vendas, fuB.valor_vendas, "Valor das vendas concluídas no período.", "maior_melhor", `${fuA.vendas_concluidas} venda(s)`),
      ind("tempo_vender", "Tempo médio para vender", "dias", tempoParaVender(ocA), tempoParaVender(ocB), "Da captação ou do primeiro anúncio do imóvel até a venda concluída no período.", "menor_melhor", `${ocA.vender_qtd} venda(s)`),
    );
  }
  return lista;
}
