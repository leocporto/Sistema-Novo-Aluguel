import { redirect } from "next/navigation";
import { obterContexto } from "@/lib/contexto";
import { rotaPermitida } from "@/lib/modos";

/** Notas fiscais de serviço só existem no modo imobiliária (docs/MODOS.md). */
export default async function Layout({ children }: LayoutProps<"/financeiro/notas">) {
  const { organizacao } = await obterContexto();
  if (!rotaPermitida("/financeiro/notas", organizacao.modo)) redirect("/financeiro");
  return children;
}
