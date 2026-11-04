import { SubAbas } from "@/components/sub-abas";

/** Abas de Assistente e automações (Prioridades só na imobiliária). */
export function AbasInteligencia({ modo }: { modo: string }) {
  const itens = [
    { href: "/inteligencia", rotulo: "Assistente" },
    ...(modo === "pessoal" ? [] : [{ href: "/inteligencia/prioridades", rotulo: "Prioridades" }]),
    { href: "/inteligencia/acoes", rotulo: "Ações para aprovar" },
    { href: "/inteligencia/automacoes", rotulo: "Automações" },
    { href: "/inteligencia/inconsistencias", rotulo: "Inconsistências" },
    { href: "/inteligencia/riscos", rotulo: "Riscos" },
    { href: "/inteligencia/historico", rotulo: "Histórico" },
    { href: "/inteligencia/configuracoes", rotulo: "Configurações da IA" },
  ];
  return <SubAbas rotulo="Assistente e automações" itens={itens} />;
}
