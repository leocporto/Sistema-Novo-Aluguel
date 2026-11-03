import { SubAbas } from "@/components/sub-abas";

/** Abas do financeiro. Proprietários e Notas fiscais só na imobiliária. */
export function AbasFinanceiro({ pessoal }: { pessoal: boolean }) {
  const itens = [
    { href: "/financeiro", rotulo: "Lançamentos" },
    { href: "/financeiro/fluxo", rotulo: "Fluxo de caixa" },
    { href: "/financeiro/contas", rotulo: "Contas e conciliação" },
    { href: "/financeiro/dre", rotulo: "DRE e balancete" },
    { href: "/financeiro/orcamento", rotulo: "Orçamento" },
    ...(pessoal
      ? []
      : [
          { href: "/financeiro/proprietarios", rotulo: "Proprietários" },
          { href: "/financeiro/notas", rotulo: "Notas fiscais" },
        ]),
    { href: "/financeiro/plano", rotulo: "Plano de contas" },
    { href: "/financeiro/historico", rotulo: "Histórico" },
  ];
  return <SubAbas rotulo="Financeiro" itens={itens} />;
}
