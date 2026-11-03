/**
 * Regras puras das comissões (só modo imobiliária). Espelham o que o banco faz
 * em aceitar_proposta, concluir_venda e gerar_comissoes_administracao
 * (supabase/migrations/20261106000002_repasses_comissoes.sql) — os textos das
 * telas saem daqui para nunca prometer um cálculo diferente.
 */
import { type DataISO, somarDias } from "./datas";
import { paraCentavos, paraReais } from "./dinheiro";

export type TipoComissao = "venda" | "locacao" | "angariacao" | "administracao" | "outro";
export type TipoRegra = Exclude<TipoComissao, "outro">;
export type StatusComissao = "prevista" | "a_pagar" | "paga" | "estornada" | "cancelada";

export const ROTULO_TIPO_COMISSAO: Record<TipoComissao, string> = {
  venda: "Venda",
  locacao: "Locação",
  angariacao: "Angariação (captação)",
  administracao: "Administração",
  outro: "Avulsa",
};

/** Sobre o que o % da regra incide — o mesmo que o banco usa. */
export const BASE_REGRA: Record<TipoRegra, string> = {
  venda: "% da comissão da venda que fica com o corretor que vendeu (sem regra: 100% menos a parte do captador, se houver regra de angariação)",
  locacao: "% do aluguel proposto (vale quando a proposta não traz o %)",
  angariacao: "na venda, % da comissão da venda; na locação, % do aluguel — para o corretor responsável pelo imóvel (captador), quando ele não é quem fechou o negócio",
  administracao: "% da taxa de administração retida em cada repasse do mês, para o corretor responsável pelo imóvel (a taxa já foi recebida na baixa do aluguel, então não espera recebimento)",
};

/** O que acontece quando não há regra para o tipo de negócio — igual ao banco. */
export const SEM_REGRA: Record<TipoRegra, string> = {
  venda: "o corretor que vendeu fica com 100% da comissão da venda menos a parte do captador (se houver regra de angariação); paga em 30 dias, sem esperar o recebimento. Dá para mudar a divisão na venda.",
  locacao: "vale o % informado na proposta; paga em 30 dias, sem esperar o recebimento.",
  angariacao: "o captador não recebe comissão.",
  administracao: "não gera comissão de administração.",
};

/** Regra de administração nunca espera recebimento (a taxa já foi recebida na baixa do aluguel). */
export const regraAceitaCondicao = (tipo: TipoRegra) => tipo !== "administracao";

export const ROTULO_STATUS_COMISSAO: Record<StatusComissao, string> = {
  prevista: "Prevista",
  a_pagar: "A pagar",
  paga: "Paga",
  estornada: "Estornada",
  cancelada: "Cancelada",
};

export const COR_STATUS_COMISSAO: Record<StatusComissao, "azul" | "amarelo" | "verde" | "vermelho" | "cinza"> = {
  prevista: "azul",
  a_pagar: "amarelo",
  paga: "verde",
  estornada: "vermelho",
  cancelada: "cinza",
};

/** Prazo padrão para pagar a comissão quando não há regra (o banco usa o mesmo). */
export const DIAS_PAGAMENTO_PADRAO = 30;
/** Comissão padrão da venda quando a proposta não informa o % (o banco usa o mesmo). */
export const COMISSAO_VENDA_PADRAO_PCT = 6;

export interface RegraComissao {
  id: string;
  tipo: TipoRegra;
  pessoa_id: string | null;
  equipe_id: string | null;
  percentual: number;
  condicionada: boolean;
  dias_pagamento: number;
  ativa: boolean;
  created_at: string;
}

/**
 * Regra que vale para a pessoa: a dela > a da equipe dela > a geral; empate:
 * a mais nova. Igual a privado.regra_comissao no banco.
 */
export function escolherRegra<R extends RegraComissao>(regras: R[], tipo: TipoRegra, pessoaId: string | null, equipeId: string | null): R | null {
  const candidatas = regras.filter(
    (r) =>
      r.ativa &&
      r.tipo === tipo &&
      ((pessoaId && r.pessoa_id === pessoaId) || (!r.pessoa_id && r.equipe_id && r.equipe_id === equipeId) || (!r.pessoa_id && !r.equipe_id)),
  );
  const peso = (r: R) => (r.pessoa_id ? 2 : r.equipe_id ? 1 : 0);
  candidatas.sort((a, b) => peso(b) - peso(a) || b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id));
  return candidatas[0] ?? null;
}

/** Valor da comissão: % sobre a base, arredondado no centavo (como round(x, 2) do banco). */
export function valorComissao(base: number, pct: number): number {
  return paraReais(Math.round((paraCentavos(base) * pct) / 100));
}

/** Texto curto da regra para listas: "40% · paga em 30 dias · só depois de receber". */
export function descreverRegra(r: Pick<RegraComissao, "percentual" | "condicionada" | "dias_pagamento"> & { tipo?: TipoRegra }): string {
  const pct = `${String(Number(r.percentual)).replace(".", ",")}%`;
  const condicao = r.tipo === "administracao" ? "taxa já recebida na baixa" : r.condicionada ? "só depois que a imobiliária receber" : "sem esperar o recebimento";
  return [pct, `paga em ${r.dias_pagamento} dia${r.dias_pagamento === 1 ? "" : "s"}`, condicao].join(" · ");
}

/** Explica o que acontece com a comissão de locação ao aceitar a proposta. */
export function textoComissaoLocacao(regra: Pick<RegraComissao, "condicionada" | "dias_pagamento"> | null): string {
  const dias = regra?.dias_pagamento ?? DIAS_PAGAMENTO_PADRAO;
  return regra?.condicionada
    ? `Fica prevista até o próximo aluguel do imóvel ser recebido (normalmente o 1º do novo contrato); aí vira conta a pagar com vencimento em ${dias} dias. Se a baixa desse aluguel for desfeita, volta a ficar prevista.`
    : `Vira conta a pagar ao corretor quando a proposta é aceita, com vencimento em ${dias} dias.`;
}

// ---------------------------------------------------------------------------
// Ajustes depois de paga: valor efetivo
// ---------------------------------------------------------------------------

export interface AjustesComissao {
  /** Complementos de ajuste ainda valendo (a pagar ou pagos). */
  complementos: number | string;
  /** Devoluções do corretor (abertas ou já recebidas). */
  devolucoes: number | string;
}

/**
 * Quanto o corretor recebe de fato por esta comissão: valor + complementos −
 * devoluções (igual ao ajustar_comissao do banco). Estornada ou cancelada: zero.
 */
export function valorEfetivo(c: { status: StatusComissao | string; valor: number | string }, a?: AjustesComissao | null): number {
  if (c.status === "estornada" || c.status === "cancelada") return 0;
  return paraReais(paraCentavos(c.valor) + paraCentavos(a?.complementos ?? 0) - paraCentavos(a?.devolucoes ?? 0));
}

// ---------------------------------------------------------------------------
// Situação, totais e previsão
// ---------------------------------------------------------------------------

export interface ComissaoResumo {
  status: StatusComissao | string;
  valor: number | string;
  vencimento?: DataISO | null;
  previsao?: DataISO | null;
  liberada_em?: DataISO | null;
  created_at?: string;
}

export interface TotaisComissoes {
  previstas: number;
  aPagar: number;
  pagas: number;
  estornadas: number;
  vencidas: number;
  quantidade: number;
}

/** Totais (em reais, conta em centavos). Canceladas não entram. */
export function totaisComissoes(lista: ComissaoResumo[], hoje: DataISO): TotaisComissoes {
  const t = { previstas: 0, aPagar: 0, pagas: 0, estornadas: 0, vencidas: 0, quantidade: 0 };
  for (const c of lista) {
    const v = paraCentavos(c.valor);
    if (c.status === "cancelada") continue;
    t.quantidade++;
    if (c.status === "prevista") t.previstas += v;
    else if (c.status === "a_pagar") {
      t.aPagar += v;
      if (c.vencimento && c.vencimento < hoje) t.vencidas += v;
    } else if (c.status === "paga") t.pagas += v;
    else if (c.status === "estornada") t.estornadas += v;
  }
  return {
    previstas: paraReais(t.previstas),
    aPagar: paraReais(t.aPagar),
    pagas: paraReais(t.pagas),
    estornadas: paraReais(t.estornadas),
    vencidas: paraReais(t.vencidas),
    quantidade: t.quantidade,
  };
}

/** Quando a comissão deve sair do caixa: vencimento (a pagar) ou a previsão (prevista). */
export function dataEsperada(c: ComissaoResumo): DataISO | null {
  if (c.status === "a_pagar") return c.vencimento ?? null;
  if (c.status === "prevista") return c.previsao ?? (c.created_at ? somarDias(c.created_at.slice(0, 10), DIAS_PAGAMENTO_PADRAO) : null);
  return null;
}

export interface ItemPrevisao {
  data: DataISO | null;
  valor: number;
  origem: "a_pagar" | "prevista" | "venda_aberta" | "administracao";
}

export interface MesPrevisao {
  mes: string; // AAAA-MM
  aPagar: number;
  previstas: number;
  vendasAbertas: number;
  administracao: number;
  total: number;
}

/**
 * Agrupa as comissões futuras por mês (a partir do mês de hoje). O que está
 * atrasado entra no mês atual; o que não tem data vai para `semData`.
 */
export function previsaoPorMes(itens: ItemPrevisao[], hoje: DataISO, meses = 6): { meses: MesPrevisao[]; semData: number; total: number } {
  const inicio = hoje.slice(0, 7);
  const lista: MesPrevisao[] = [];
  let [a, m] = inicio.split("-").map(Number);
  for (let i = 0; i < meses; i++) {
    lista.push({ mes: `${a}-${String(m).padStart(2, "0")}`, aPagar: 0, previstas: 0, vendasAbertas: 0, administracao: 0, total: 0 });
    m++;
    if (m > 12) {
      m = 1;
      a++;
    }
  }
  const idx = new Map(lista.map((x, i) => [x.mes, i]));
  const chave = { a_pagar: "aPagar", prevista: "previstas", venda_aberta: "vendasAbertas", administracao: "administracao" } as const;
  const cents = new Map<string, number>();
  let semData = 0;
  let total = 0;
  for (const it of itens) {
    const v = paraCentavos(it.valor);
    if (v <= 0) continue;
    if (!it.data) {
      semData += v;
      total += v;
      continue;
    }
    const mes = it.data.slice(0, 7) < inicio ? inicio : it.data.slice(0, 7);
    const i = idx.get(mes);
    if (i === undefined) continue;
    const k = `${i}|${chave[it.origem]}`;
    cents.set(k, (cents.get(k) ?? 0) + v);
    total += v;
  }
  for (const [k, v] of cents) {
    const [i, campo] = k.split("|");
    const linha = lista[Number(i)] as unknown as Record<string, number>;
    linha[campo] = paraReais(v);
  }
  for (const l of lista) l.total = paraReais(paraCentavos(l.aPagar) + paraCentavos(l.previstas) + paraCentavos(l.vendasAbertas) + paraCentavos(l.administracao));
  return { meses: lista, semData: paraReais(semData), total: paraReais(total) };
}

/** Parte de um valor ao dividir a comissão com outro corretor (igual ao banco). */
export function dividirValor(valor: number, pctOutro: number): { outro: number; fica: number } {
  const outro = valorComissao(valor, pctOutro);
  return { outro, fica: paraReais(paraCentavos(valor) - paraCentavos(outro)) };
}

/** Mensagem pronta para o corretor com o resumo do período. */
export function mensagemCorretor(nome: string, periodo: string, t: TotaisComissoes): string {
  const r = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  return [
    `Olá ${nome.split(" ")[0]}! Resumo das suas comissões (${periodo}):`,
    `Pagas: ${r(t.pagas)}`,
    `A pagar: ${r(t.aPagar)}`,
    `Previstas (aguardando recebimento): ${r(t.previstas)}`,
    t.estornadas ? `Estornadas: ${r(t.estornadas)}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}
