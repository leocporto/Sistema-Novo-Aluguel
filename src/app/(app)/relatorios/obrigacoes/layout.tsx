import { redirect } from "next/navigation";
import { obterContexto } from "@/lib/contexto";

/** DIMOB e informe de rendimentos são obrigações da imobiliária. */
export default async function ObrigacoesLayout({ children }: LayoutProps<"/relatorios/obrigacoes">) {
  const { organizacao } = await obterContexto();
  if (organizacao.modo === "pessoal") redirect("/relatorios");
  return children;
}
