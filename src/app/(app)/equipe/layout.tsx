import { redirect } from "next/navigation";
import { AvisoBancoPendente } from "@/components/aviso-banco-pendente";
import { faltaNoBanco } from "@/lib/banco-pendente";
import { obterContexto } from "@/lib/contexto";
import { rotaPermitida } from "@/lib/modos";

/**
 * Gestão de equipe e administração só existe no modo imobiliária
 * (docs/MODOS.md). A checagem direta do modo garante o bloqueio mesmo antes de
 * "/equipe" entrar em ROTAS_SO_IMOBILIARIA. Cada tela confere a permissão do
 * módulo dela (Equipe, Aprovações ou Histórico de ações).
 */
export default async function EquipeLayout({ children }: LayoutProps<"/equipe">) {
  const { organizacao, supabase } = await obterContexto();
  if (organizacao.modo === "pessoal" || !rotaPermitida("/equipe", organizacao.modo)) redirect("/");
  // Publicado antes da migração da Equipe chegar ao banco: avisa em vez de quebrar.
  const { error } = await supabase.from("perfis_acesso").select("id").limit(1);
  if (faltaNoBanco(error)) return <AvisoBancoPendente titulo="Equipe" />;
  return children;
}
