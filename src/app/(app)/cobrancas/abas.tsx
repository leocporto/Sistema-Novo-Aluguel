import { SubAbas } from "@/components/sub-abas";

/** Abas da central de cobranças (nos dois modos). */
export function AbasCobrancas() {
  return (
    <SubAbas
      rotulo="Cobranças"
      itens={[
        { href: "/cobrancas", rotulo: "Quem deve" },
        { href: "/cobrancas/fila", rotulo: "Avisos de hoje" },
        { href: "/cobrancas/acordos", rotulo: "Acordos" },
        { href: "/cobrancas/contatos", rotulo: "Contatos" },
        { href: "/cobrancas/juridico", rotulo: "Jurídico" },
        { href: "/cobrancas/baixa", rotulo: "Baixa automática" },
        { href: "/cobrancas/relatorios", rotulo: "Relatórios" },
        { href: "/cobrancas/configuracoes", rotulo: "Régua e Pix" },
      ]}
    />
  );
}
