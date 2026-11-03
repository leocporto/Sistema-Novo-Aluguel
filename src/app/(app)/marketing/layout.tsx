import { redirect } from "next/navigation";
import { obterContexto } from "@/lib/contexto";

/** Marketing e comunicação só existe no modo imobiliária (docs/MODOS.md). */
export default async function MarketingLayout({ children }: LayoutProps<"/marketing">) {
  const { organizacao } = await obterContexto();
  if (organizacao.modo === "pessoal") redirect("/");
  return children;
}
