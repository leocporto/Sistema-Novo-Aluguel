import { SubAbas } from "@/components/sub-abas";

/** Abas da gestão de repasses (só imobiliária). */
export function AbasRepasses() {
  return (
    <div className="nao-imprimir">
      <SubAbas
        rotulo="Repasses"
        itens={[
          { href: "/repasses", rotulo: "Repasses" },
          { href: "/repasses/despesas", rotulo: "Despesas a descontar" },
          { href: "/repasses/demonstrativo", rotulo: "Demonstrativo mensal" },
          { href: "/repasses/extrato", rotulo: "Extrato anual" },
          { href: "/repasses/historico", rotulo: "Histórico" },
        ]}
      />
    </div>
  );
}
