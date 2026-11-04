import { SubAbas } from "@/components/sub-abas";

/** Reajustes e os índices usados no cálculo (nos dois modos). */
export function AbasReajustes() {
  return (
    <SubAbas
      rotulo="Reajustes"
      itens={[
        { href: "/reajustes", rotulo: "Contratos a reajustar" },
        { href: "/indices", rotulo: "Índices econômicos" },
      ]}
    />
  );
}
