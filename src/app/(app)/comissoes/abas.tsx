import { SubAbas } from "@/components/sub-abas";

/** Abas das comissões (só imobiliária). */
export function AbasComissoes() {
  return (
    <div className="nao-imprimir">
      <SubAbas
        rotulo="Comissões"
        itens={[
          { href: "/comissoes", rotulo: "Comissões" },
          { href: "/comissoes/previsao", rotulo: "Previsão" },
          { href: "/comissoes/corretores", rotulo: "Por corretor" },
          { href: "/comissoes/regras", rotulo: "Regras e equipes" },
          { href: "/comissoes/historico", rotulo: "Histórico" },
        ]}
      />
    </div>
  );
}
