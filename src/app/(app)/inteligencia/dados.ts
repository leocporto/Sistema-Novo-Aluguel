import "server-only";
import { redirect } from "next/navigation";
import type { obterContexto } from "@/lib/contexto";
import type { Modulo, Operacao } from "@/lib/dominio/equipe";
import { lerConfigIA, type ConfigIA } from "@/lib/dominio/ia";
import { pode } from "@/lib/permissoes";
import { iaConfigurada } from "@/lib/servicos/ia";

type Supabase = Awaited<ReturnType<typeof obterContexto>>["supabase"];

/** Configuração da IA da conta (com os padrões quando ainda não foi salva). */
export async function carregarConfigIA(supabase: Supabase): Promise<ConfigIA> {
  const { data } = await supabase.from("ia_config").select("*").maybeSingle();
  return lerConfigIA(data as Record<string, unknown> | null);
}

export type EstadoIA = { configurada: boolean; config: ConfigIA; disponivel: boolean };

/** A IA pode ser usada agora? (chave + modelo no servidor e ligada na conta) */
export async function estadoIA(supabase: Supabase): Promise<EstadoIA> {
  const config = await carregarConfigIA(supabase);
  const configurada = iaConfigurada();
  return { configurada, config, disponivel: configurada && config.ativa };
}

/** Configurar a IA e as automações: administrador ou gestor (o banco confere Configurações → editar). */
export const podeConfigurarIA = (papel: string) => papel === "admin" || papel === "gestor";

/** Link interno de uma referência (ação, inconsistência, automação). */
export function linkReferencia(tipo: string | null | undefined, id: string | null | undefined): string | null {
  if (!tipo || !id) return null;
  const mapa: Record<string, string> = {
    lead: `/comercial/leads/${id}`,
    pessoa: `/pessoas/${id}`,
    imovel: `/imoveis/${id}`,
    contrato: `/contratos/${id}`,
    fatura: `/faturas/${id}`,
    conversa: `/marketing/conversas/${id}`,
    chamado: `/manutencao/${id}`,
    analise: `/analise/${id}`,
    lancamento: `/financeiro/lancamentos/${id}`,
    repasse: `/repasses/${id}`,
    conta: `/financeiro/contas/${id}`,
    venda: `/vendas/${id}`,
  };
  return mapa[tipo] ?? null;
}

/** Nomes dos usuários da conta (para o histórico e as ações). */
export async function nomesUsuarios(supabase: Supabase): Promise<Map<string, string>> {
  const { data } = await supabase.from("membros").select("user_id, nome, email");
  return new Map(((data ?? []) as { user_id: string; nome: string | null; email: string | null }[]).map((m) => [m.user_id, m.nome || m.email || "Usuário"]));
}

/**
 * Busca em lotes de 100 ids: o filtro "in" vai na URL, e mil UUIDs passam do
 * limite do gateway (a consulta falharia ou voltaria vazia).
 */
export async function porLotes<T>(ids: string[], buscar: (lote: string[]) => Promise<T[]>, tamanho = 100): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += tamanho) out.push(...(await buscar(ids.slice(i, i + tamanho))));
  return out;
}

/** Instante formatado no fuso de Brasília. */
export function quando(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** Para as páginas: sem a permissão, volta para o Assistente (as actions e o banco conferem de novo). */
export async function exigirOuVoltar(modulo: Modulo, operacao: Operacao): Promise<void> {
  if (!(await pode(modulo, operacao))) redirect("/inteligencia");
}
