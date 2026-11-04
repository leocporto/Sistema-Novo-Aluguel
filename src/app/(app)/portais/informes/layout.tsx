import { redirect } from "next/navigation";
import { obterContexto } from "@/lib/contexto";

/** Informe de rendimentos do proprietário: só existe no modo imobiliária (docs/MODOS.md). */
export default async function InformesLayout({ children }: LayoutProps<"/portais/informes">) {
  const { organizacao } = await obterContexto();
  if (organizacao.modo === "pessoal") redirect("/");
  return children;
}
