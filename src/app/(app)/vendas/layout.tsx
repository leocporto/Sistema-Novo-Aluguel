import { redirect } from "next/navigation";
import { obterContexto } from "@/lib/contexto";
import { rotaPermitida } from "@/lib/modos";

/** Gestão de vendas só existe no modo imobiliária (docs/MODOS.md). */
export default async function VendasLayout({ children }: LayoutProps<"/vendas">) {
  const { organizacao } = await obterContexto();
  if (!rotaPermitida("/vendas", organizacao.modo)) redirect("/");
  return children;
}
