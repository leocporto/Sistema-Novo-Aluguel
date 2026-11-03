import { redirect } from "next/navigation";
import { obterContexto } from "@/lib/contexto";

/** Site imobiliário e portais só existem no modo imobiliária (docs/MODOS.md). */
export default async function SiteLayout({ children }: LayoutProps<"/site">) {
  const { organizacao } = await obterContexto();
  if (organizacao.modo === "pessoal") redirect("/");
  return children;
}
