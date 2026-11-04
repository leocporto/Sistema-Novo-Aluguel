import { SubAbas } from "@/components/sub-abas";
import type { Modulo } from "@/lib/dominio/equipe";
import { permissoesDoUsuario } from "@/lib/permissoes";

const ABAS: { href: string; rotulo: string; modulo: Modulo }[] = [
  { href: "/equipe", rotulo: "Colaboradores", modulo: "equipe" },
  { href: "/equipe/equipes", rotulo: "Equipes e filiais", modulo: "equipe" },
  { href: "/equipe/perfis", rotulo: "Perfis de acesso", modulo: "equipe" },
  { href: "/equipe/metas", rotulo: "Metas", modulo: "equipe" },
  { href: "/equipe/distribuicao", rotulo: "Distribuição", modulo: "equipe" },
  { href: "/equipe/desempenho", rotulo: "Desempenho", modulo: "equipe" },
  { href: "/equipe/tarefas", rotulo: "Tarefas internas", modulo: "equipe" },
  { href: "/equipe/aprovacoes", rotulo: "Aprovações", modulo: "aprovacoes" },
  { href: "/equipe/comunicacao", rotulo: "Comunicação", modulo: "equipe" },
  { href: "/equipe/onboarding", rotulo: "Onboarding", modulo: "equipe" },
  { href: "/equipe/historico", rotulo: "Histórico de ações", modulo: "auditoria" },
];

/** Abas da gestão de equipe (só imobiliária); some a aba do módulo que o perfil não vê. */
export async function AbasEquipe() {
  const perms = await permissoesDoUsuario();
  return (
    <div className="nao-imprimir">
      <SubAbas rotulo="Equipe" itens={ABAS.filter((a) => perms[a.modulo]?.includes("ver")).map(({ href, rotulo }) => ({ href, rotulo }))} />
    </div>
  );
}
