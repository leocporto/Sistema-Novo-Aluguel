import { redirect } from "next/navigation";
import { obterContexto } from "@/lib/contexto";
import { rotaPermitida } from "@/lib/modos";

/**
 * Comissões (regras, equipes, previsão, relatório por corretor) só existem no
 * modo imobiliária (docs/MODOS.md). A checagem direta do modo garante o
 * bloqueio mesmo antes de "/comissoes" entrar em ROTAS_SO_IMOBILIARIA.
 */
export default async function ComissoesLayout({ children }: LayoutProps<"/comissoes">) {
  const { organizacao } = await obterContexto();
  if (organizacao.modo === "pessoal" || !rotaPermitida("/comissoes", organizacao.modo)) redirect("/");
  return children;
}
