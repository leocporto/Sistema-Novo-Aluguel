import { SubAbas } from "@/components/sub-abas";

/** Telas irmãs da análise cadastral (nos dois modos). */
export function AbasAnalise() {
  return (
    <SubAbas
      rotulo="Análise cadastral"
      itens={[
        { href: "/analise", rotulo: "Candidatos" },
        { href: "/analise/garantidoras", rotulo: "Garantidoras" },
        { href: "/analise/garantias", rotulo: "Vencimentos e renovações" },
        { href: "/analise/auditoria", rotulo: "Auditoria" },
        { href: "/analise/regras", rotulo: "Regras" },
      ]}
    />
  );
}
