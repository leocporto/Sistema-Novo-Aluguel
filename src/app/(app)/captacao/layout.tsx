import { redirect } from "next/navigation";
import { obterContexto } from "@/lib/contexto";
import { rotaPermitida } from "@/lib/modos";

/** Captação de imóveis só existe no modo imobiliária (docs/MODOS.md). */
export default async function CaptacaoLayout({ children }: LayoutProps<"/captacao">) {
  const { organizacao } = await obterContexto();
  if (!rotaPermitida("/captacao", organizacao.modo)) redirect("/");
  return children;
}
