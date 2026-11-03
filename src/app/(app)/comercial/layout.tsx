import { redirect } from "next/navigation";
import { obterContexto } from "@/lib/contexto";
import { rotaPermitida } from "@/lib/modos";

/** A parte comercial só existe no modo imobiliária (docs/MODOS.md). */
export default async function ComercialLayout({ children }: LayoutProps<"/comercial">) {
  const { organizacao } = await obterContexto();
  if (!rotaPermitida("/comercial", organizacao.modo)) redirect("/");
  return children;
}
