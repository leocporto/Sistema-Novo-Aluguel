import { redirect } from "next/navigation";
import { obterContexto } from "@/lib/contexto";
import { podeVer } from "@/lib/permissoes";

/** Atendimento e qualificação de leads: só na imobiliária (as actions e o banco conferem de novo). */
export default async function AtendimentoLayout({ children }: LayoutProps<"/inteligencia/atendimento">) {
  const { organizacao } = await obterContexto();
  if (organizacao.modo === "pessoal") redirect("/");
  if (!(await podeVer("comercial"))) redirect("/inteligencia");
  return children;
}
