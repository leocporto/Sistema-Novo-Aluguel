import { type Centavos, percentual, ratear } from "./dinheiro";
import type { ItemFatura } from "./fatura";

export type TipoRepasse = "automatico" | "garantido" | "manual";

export interface ConfigRepasse {
  taxaAdministracaoPct: number;
  /** % sobre o aluguel cheio cobrada uma única vez (primeiro repasse). */
  taxaIntermediacaoPct: number;
  /** Indica se esta é a primeira fatura do contrato (cobra intermediação). */
  primeiraFatura: boolean;
  /** Valor cheio do aluguel do contrato (base da intermediação). */
  valorAluguelContrato: Centavos;
  /** Multa e juros pagos pelo locatário vão para o proprietário? */
  repassarMultaJuros: boolean;
  /**
   * impostoPct: % de imposto descontado no repasse de cada proprietário
   * (definido no cadastro da pessoa ou pelo padrão PF/PJ da imobiliária).
   */
  proprietarios: { pessoaId: string; percentual: number; impostoPct?: number }[];
}

export interface RepasseCalculado {
  pessoaId: string;
  percentual: number;
  aluguel: Centavos;
  encargos: Centavos;
  multaJuros: Centavos;
  valorBruto: Centavos;
  taxaAdministracao: Centavos;
  taxaIntermediacao: Centavos;
  irrf: Centavos;
  /** Imposto descontado pela imobiliária (% do cadastro do proprietário). */
  imposto: Centavos;
  impostoPct: number;
  valorLiquido: Centavos;
}

export interface ResultadoRepasse {
  repasses: RepasseCalculado[];
  /** Receita da imobiliária nesta fatura (taxas + itens destinados a ela). */
  receitaImobiliaria: Centavos;
  /** Valores a pagar a terceiros (ex.: IPTU recolhido pela imobiliária). */
  valorTerceiros: Centavos;
}

/**
 * Calcula quanto cada proprietário recebe a partir dos itens efetivamente
 * pagos de uma fatura (incluindo multa/juros lançados na liquidação).
 *
 * Líquido = aluguel + encargos do proprietário (+ multa/juros, se repassados)
 *           − taxa de administração − intermediação (1ª fatura) − IRRF retido
 *           − imposto do proprietário.
 *
 * O imposto do proprietário incide sobre o rendimento do aluguel da parte dele
 * (aluguel + multa/juros repassados − taxa de administração − intermediação),
 * nunca negativo.
 */
export function calcularRepasse(itens: ItemFatura[], cfg: ConfigRepasse): ResultadoRepasse {
  const soma = (f: (i: ItemFatura) => boolean) => itens.filter(f).reduce((s, i) => s + i.valor, 0);

  const aluguel = soma((i) => i.tipo === "aluguel");
  const encargosProp = soma(
    (i) => i.destino === "proprietario" && (i.tipo === "encargo" || i.tipo === "outro" || i.tipo === "desconto"),
  );
  const multaJuros = soma((i) => i.tipo === "multa" || i.tipo === "juros");
  const irrfTotal = -soma((i) => i.tipo === "irrf");
  const imobiliariaItens = soma((i) => i.destino === "imobiliaria" && i.tipo !== "multa" && i.tipo !== "juros");
  const terceiros = soma((i) => i.destino === "terceiro");

  const taxaAdm = percentual(aluguel, cfg.taxaAdministracaoPct);
  const intermediacao = cfg.primeiraFatura ? percentual(cfg.valorAluguelContrato, cfg.taxaIntermediacaoPct) : 0;

  const pcts = cfg.proprietarios.map((p) => p.percentual);
  const pAluguel = ratear(aluguel, pcts);
  const pEnc = ratear(encargosProp, pcts);
  const pMJ = ratear(cfg.repassarMultaJuros ? multaJuros : 0, pcts);
  const pAdm = ratear(taxaAdm, pcts);
  const pInt = ratear(intermediacao, pcts);
  // O IRRF é calculado por proprietário na geração da fatura; aqui ratear
  // apenas preserva o total quando não houver detalhamento individual.
  const pIr = ratear(irrfTotal, pcts);

  const repasses = cfg.proprietarios.map((p, i) => {
    const valorBruto = pAluguel[i] + pEnc[i] + pMJ[i];
    const impostoPct = p.impostoPct ?? 0;
    const imposto = calcularImpostoProprietario(pAluguel[i] + pMJ[i] - pAdm[i] - pInt[i], impostoPct);
    const valorLiquido = valorBruto - pAdm[i] - pInt[i] - pIr[i] - imposto;
    return {
      pessoaId: p.pessoaId,
      percentual: p.percentual,
      aluguel: pAluguel[i],
      encargos: pEnc[i],
      multaJuros: pMJ[i],
      valorBruto,
      taxaAdministracao: pAdm[i],
      taxaIntermediacao: pInt[i],
      irrf: pIr[i],
      imposto,
      impostoPct,
      valorLiquido,
    };
  });

  return {
    repasses,
    receitaImobiliaria: taxaAdm + intermediacao + imobiliariaItens + (cfg.repassarMultaJuros ? 0 : multaJuros),
    valorTerceiros: terceiros,
  };
}

/** Ajusta o IRRF rateado para os valores exatos calculados por proprietário. */
export function aplicarIrrfIndividual(
  r: ResultadoRepasse,
  irrfPorProprietario: Record<string, Centavos>,
): ResultadoRepasse {
  if (Object.keys(irrfPorProprietario).length === 0) return r;
  return {
    ...r,
    repasses: r.repasses.map((rep) => {
      const irrf = irrfPorProprietario[rep.pessoaId] ?? 0;
      return {
        ...rep,
        irrf,
        valorLiquido: rep.valorBruto - rep.taxaAdministracao - rep.taxaIntermediacao - irrf - rep.imposto,
      };
    }),
  };
}

/** Imposto do proprietário sobre a base informada (nunca negativo). */
export function calcularImpostoProprietario(base: Centavos, impostoPct: number): Centavos {
  if (base <= 0 || !impostoPct || impostoPct <= 0) return 0;
  return percentual(base, impostoPct);
}

/** % efetivo: o do cadastro da pessoa; em branco, o padrão da imobiliária para PF ou PJ. */
export function impostoEfetivo(
  impostoPessoa: number | string | null | undefined,
  tipoPessoa: "PF" | "PJ",
  padrao: { pf: number; pj: number },
): number {
  if (impostoPessoa !== null && impostoPessoa !== undefined && impostoPessoa !== "") return Number(impostoPessoa);
  return tipoPessoa === "PJ" ? padrao.pj : padrao.pf;
}
