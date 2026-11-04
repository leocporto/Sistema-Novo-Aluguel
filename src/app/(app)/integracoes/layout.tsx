import { redirect } from "next/navigation";
import { obterContexto } from "@/lib/contexto";
import { podeVer } from "@/lib/permissoes";

/**
 * Integrações e API (nos dois modos): só administrador (tudo) e gestor (só
 * leitura). O banco garante o mesmo (RLS por papel nas tabelas e nas funções).
 * Perfil de acesso: enquanto não houver um módulo "Integrações" na lista de
 * permissões, a tela segue o módulo Configurações (o banco faz a mesma conta
 * em privado.integracoes_pode).
 */
export default async function IntegracoesLayout({ children }: LayoutProps<"/integracoes">) {
  const { papel } = await obterContexto();
  if (papel !== "admin" && papel !== "gestor") redirect("/");
  if (!(await podeVer("configuracoes"))) redirect("/");
  return children;
}
