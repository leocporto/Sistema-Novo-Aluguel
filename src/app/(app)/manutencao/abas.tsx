import { SubAbas } from "@/components/sub-abas";

/** Abas da manutenção (nos dois modos). */
export function AbasManutencao() {
  return (
    <SubAbas
      rotulo="Manutenção"
      itens={[
        { href: "/manutencao", rotulo: "Chamados" },
        { href: "/manutencao/prestadores", rotulo: "Prestadores" },
        { href: "/manutencao/historico", rotulo: "Histórico por imóvel" },
        { href: "/manutencao/garantias", rotulo: "Garantias" },
        { href: "/manutencao/links", rotulo: "Link do locatário" },
      ]}
    />
  );
}
