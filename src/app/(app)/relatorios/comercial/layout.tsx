import { redirect } from "next/navigation";
import { obterContexto } from "@/lib/contexto";

/** Relatórios comerciais (leads, funil, canais) só existem no modo imobiliária. */
export default async function ComercialRelatorioLayout({ children }: LayoutProps<"/relatorios/comercial">) {
  const { organizacao } = await obterContexto();
  if (organizacao.modo === "pessoal") redirect("/relatorios");
  return children;
}
