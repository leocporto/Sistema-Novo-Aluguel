import { AvisoBancoPendente } from "@/components/aviso-banco-pendente";
import { faltaNoBanco } from "@/lib/banco-pendente";
import { obterContexto } from "@/lib/contexto";

/**
 * Assistente e automações (nos dois modos; Prioridades e Atendimento só na
 * imobiliária — cada um com seu layout). As automações por regras rodam pelo
 * layout do app (agendarAutomacoesIA). Publicado antes da migração chegar ao
 * banco, mostra um aviso em vez de quebrar.
 */
export default async function InteligenciaLayout({ children }: LayoutProps<"/inteligencia">) {
  const { supabase } = await obterContexto();
  const { error } = await supabase.from("ia_config").select("organizacao_id").limit(1);
  if (faltaNoBanco(error)) return <AvisoBancoPendente titulo="Assistente e automações" />;
  return children;
}
