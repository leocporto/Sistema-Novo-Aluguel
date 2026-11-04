import { redirect } from "next/navigation";
import { obterContexto } from "@/lib/contexto";

/** Portal do corretor: só existe no modo imobiliária (o banco também recusa no pessoal). */
export default async function CorretorLayout({ children }: LayoutProps<"/corretor">) {
  const { organizacao } = await obterContexto();
  if (organizacao.modo === "pessoal") redirect("/");
  return children;
}
