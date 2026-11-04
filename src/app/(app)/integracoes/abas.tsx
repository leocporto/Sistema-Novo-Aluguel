import { SubAbas } from "@/components/sub-abas";

/** Abas das Integrações (nos dois modos). */
export function AbasIntegracoes() {
  return (
    <SubAbas
      rotulo="Integrações"
      itens={[
        { href: "/integracoes", rotulo: "Catálogo" },
        { href: "/integracoes/chaves", rotulo: "Chaves de API" },
        { href: "/integracoes/webhooks", rotulo: "Webhooks" },
        { href: "/integracoes/monitoramento", rotulo: "Monitoramento" },
        { href: "/integracoes/importar", rotulo: "Importar de outro sistema" },
        { href: "/integracoes/exportar", rotulo: "Exportar e contabilidade" },
        { href: "/integracoes/api", rotulo: "Documentação da API" },
      ]}
    />
  );
}
