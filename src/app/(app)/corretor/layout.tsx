import { redirect } from "next/navigation";
import { AvisoBancoPendente } from "@/components/aviso-banco-pendente";
import { faltaNoBanco } from "@/lib/banco-pendente";
import { obterContexto } from "@/lib/contexto";

/** Portal do corretor: só existe no modo imobiliária (o banco também recusa no pessoal). */
export default async function CorretorLayout({ children }: LayoutProps<"/corretor">) {
  const { organizacao, supabase } = await obterContexto();
  if (organizacao.modo === "pessoal") redirect("/");
  // Publicado antes da migração da Equipe chegar ao banco: avisa em vez de quebrar.
  const { error } = await supabase.rpc("corretor_portal", { p_secao: "resumo", p_pessoa: null, p: {} });
  if (faltaNoBanco(error)) return <AvisoBancoPendente titulo="Meu portal (corretor)" />;
  return children;
}
