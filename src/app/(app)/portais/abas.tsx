import { SubAbas } from "@/components/sub-abas";

/** Abas do Portal de clientes (o informe de rendimentos só existe na imobiliária). */
export function AbasPortais({ modo }: { modo: "imobiliaria" | "pessoal" }) {
  return (
    <SubAbas
      rotulo="Portal de clientes"
      itens={[
        { href: "/portais", rotulo: "Links" },
        { href: "/portais/solicitacoes", rotulo: "Pedidos" },
        { href: "/portais/registro", rotulo: "Registro de acessos" },
        ...(modo === "pessoal" ? [] : [{ href: "/portais/informes", rotulo: "Informe de rendimentos" }]),
      ]}
    />
  );
}
