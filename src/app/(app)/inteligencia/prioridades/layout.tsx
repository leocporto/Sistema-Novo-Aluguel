import { redirect } from "next/navigation";
import { obterContexto } from "@/lib/contexto";
import { podeVer } from "@/lib/permissoes";

/** Prioridades de leads: só na imobiliária (as actions e o banco conferem de novo). */
export default async function PrioridadesLayout({ children }: LayoutProps<"/inteligencia/prioridades">) {
  const { organizacao } = await obterContexto();
  if (organizacao.modo === "pessoal") redirect("/");
  if (!(await podeVer("comercial"))) redirect("/inteligencia");
  return children;
}
