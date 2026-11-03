import { redirect } from "next/navigation";
import { obterContexto } from "@/lib/contexto";
import { rotaPermitida } from "@/lib/modos";

/** Empreendimentos, blocos e unidades: só no modo imobiliária (docs/MODOS.md). */
export default async function EmpreendimentosLayout({ children }: LayoutProps<"/empreendimentos">) {
  const { organizacao } = await obterContexto();
  if (!rotaPermitida("/empreendimentos", organizacao.modo)) redirect("/");
  return children;
}
