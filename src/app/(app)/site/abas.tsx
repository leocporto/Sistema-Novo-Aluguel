import { SubAbas } from "@/components/sub-abas";

/** Abas do módulo Site e portais. */
export function AbasSite() {
  return (
    <SubAbas
      rotulo="Site e portais"
      itens={[
        { href: "/site", rotulo: "Configuração" },
        { href: "/site/imoveis", rotulo: "Imóveis no site" },
        { href: "/site/empreendimentos", rotulo: "Lançamentos" },
        { href: "/site/contatos", rotulo: "Contatos recebidos" },
        { href: "/site/portais", rotulo: "Portais" },
        { href: "/site/portais/imoveis", rotulo: "Publicação nos portais" },
        { href: "/site/portais/historico", rotulo: "Envios e falhas" },
      ]}
    />
  );
}
