import { SubAbas } from "@/components/sub-abas";

export function AbasComunicacao() {
  return (
    <SubAbas
      rotulo="Comunicação interna"
      itens={[
        { href: "/equipe/comunicacao", rotulo: "Mural de avisos" },
        { href: "/equipe/comunicacao/mensagens", rotulo: "Mensagens" },
      ]}
    />
  );
}
