import { redirect } from "next/navigation";
import { obterContexto } from "@/lib/contexto";

/** Desempenho de corretores e filiais só existe no modo imobiliária. */
export default async function EquipeRelatorioLayout({ children }: LayoutProps<"/relatorios/equipe">) {
  const { organizacao } = await obterContexto();
  if (organizacao.modo === "pessoal") redirect("/relatorios");
  return children;
}
