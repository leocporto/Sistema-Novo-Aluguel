/**
 * Erro de "função/tabela/coluna ainda não existe no banco": a tela foi publicada
 * antes da migração dela ser aplicada no Supabase. Quem chama mostra um aviso
 * (<AvisoBancoPendente>) em vez de quebrar a página.
 */
export function faltaNoBanco(e: { code?: string; message?: string } | null | undefined): boolean {
  if (!e) return false;
  if (e.code === "PGRST202" || e.code === "PGRST205" || e.code === "42883" || e.code === "42P01" || e.code === "42703") return true;
  return /could not find the (function|table)|does not exist|schema cache/i.test(e.message ?? "");
}
