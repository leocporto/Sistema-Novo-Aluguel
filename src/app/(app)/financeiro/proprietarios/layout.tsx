import { redirect } from "next/navigation";
import { obterContexto } from "@/lib/contexto";
import { rotaPermitida } from "@/lib/modos";

/** Saldo com proprietários só existe no modo imobiliária (docs/MODOS.md). */
export default async function Layout({ children }: LayoutProps<"/financeiro/proprietarios">) {
  const { organizacao } = await obterContexto();
  if (!rotaPermitida("/financeiro/proprietarios", organizacao.modo)) redirect("/financeiro");
  return children;
}
