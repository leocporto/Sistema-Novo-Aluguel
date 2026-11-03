import { redirect } from "next/navigation";
import { obterContexto } from "@/lib/contexto";
import { rotaPermitida } from "@/lib/modos";

/** Repasses, despesas a descontar, demonstrativos e extratos só existem no modo imobiliária (docs/MODOS.md). */
export default async function RepassesLayout({ children }: LayoutProps<"/repasses">) {
  const { organizacao } = await obterContexto();
  if (!rotaPermitida("/repasses", organizacao.modo)) redirect("/");
  return children;
}
