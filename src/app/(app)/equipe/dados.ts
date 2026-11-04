import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { obterContexto } from "@/lib/contexto";
import { lerLinhaProdutividade, temPermissao, type LinhaProdutividade, type Modulo, type Operacao } from "@/lib/dominio/equipe";
import { permissoesDoUsuario } from "@/lib/permissoes";

type Supabase = Awaited<ReturnType<typeof obterContexto>>["supabase"];

export type Membro = {
  user_id: string;
  papel: string;
  nome: string | null;
  email: string | null;
  cargo: string | null;
  pessoa_id: string | null;
  perfil_id: string | null;
  created_at: string;
};

export const nomeDoMembro = (m: Pick<Membro, "nome" | "email"> | null | undefined) => m?.nome || m?.email || "Usuário";

/** Usuários da imobiliária (membros). */
export async function carregarMembros(supabase: Supabase): Promise<Membro[]> {
  const { data } = await supabase.from("membros").select("user_id, papel, nome, email, cargo, pessoa_id, perfil_id, created_at").order("created_at").limit(500);
  return (data ?? []) as Membro[];
}

export async function nomesUsuarios(supabase: Supabase): Promise<Map<string, string>> {
  return new Map((await carregarMembros(supabase)).map((m) => [m.user_id, nomeDoMembro(m)]));
}

export const SELECT_COLABORADOR =
  "id, nome, email, telefone, papeis, colaborador, cargo, admissao, desligamento, creci_numero, creci_uf, creci_validade, creci_tipo, filial_id, recebe_leads";

export type Colaborador = {
  id: string;
  nome: string;
  email: string | null;
  telefone: string | null;
  papeis: string[];
  colaborador: boolean;
  cargo: string | null;
  admissao: string | null;
  desligamento: string | null;
  creci_numero: string | null;
  creci_uf: string | null;
  creci_validade: string | null;
  creci_tipo: string | null;
  filial_id: string | null;
  recebe_leads: boolean;
};

/** Colaboradores: corretores, quem foi marcado como colaborador e quem tem usuário. */
export async function carregarColaboradores(supabase: Supabase, membros: Membro[]): Promise<Colaborador[]> {
  const ligados = membros.map((m) => m.pessoa_id).filter(Boolean);
  const filtro = ["colaborador.eq.true", "papeis.cs.{corretor}", ...(ligados.length ? [`id.in.(${ligados.join(",")})`] : [])].join(",");
  const { data } = await supabase.from("pessoas").select(SELECT_COLABORADOR).or(filtro).order("nome").limit(1000);
  return (data ?? []) as Colaborador[];
}

export type Filial = { id: string; nome: string; codigo: string | null; cidade: string | null; uf: string | null; endereco: string | null; telefone: string | null; email: string | null; gestor_id: string | null; ativa: boolean };
export type Equipe = { id: string; nome: string; descricao: string | null; lider_id: string | null; filial_id: string | null; ativa: boolean };
export type Perfil = { id: string; nome: string; descricao: string | null; papel_base: string; padrao: boolean; permissoes: Record<string, string[]>; updated_at: string };

/** Filiais, equipes (com quem está em cada uma) e perfis de acesso. */
export async function carregarEstrutura(supabase: Supabase) {
  const [{ data: filiais }, { data: equipes }, { data: membrosEquipe }, { data: perfis }] = await Promise.all([
    supabase.from("filiais").select("id, nome, codigo, cidade, uf, endereco, telefone, email, gestor_id, ativa").order("nome"),
    supabase.from("equipes").select("id, nome, descricao, lider_id, filial_id, ativa").order("nome"),
    supabase.from("equipe_membros").select("id, equipe_id, pessoa_id"),
    supabase.from("perfis_acesso").select("id, nome, descricao, papel_base, padrao, permissoes, updated_at").order("padrao", { ascending: false }).order("nome"),
  ]);
  const lista = (membrosEquipe ?? []) as { id: string; equipe_id: string; pessoa_id: string }[];
  return {
    filiais: (filiais ?? []) as Filial[],
    equipes: (equipes ?? []) as Equipe[],
    membrosEquipe: lista,
    equipeDe: new Map(lista.map((m) => [m.pessoa_id, m.equipe_id])),
    perfis: (perfis ?? []) as Perfil[],
  };
}

/** Números por colaborador no período (agregado no banco). */
export async function carregarProdutividade(supabase: Supabase, inicio: string, fim: string): Promise<LinhaProdutividade[]> {
  const { data, error } = await supabase.rpc("equipe_produtividade", { p_inicio: inicio, p_fim: fim });
  if (error || !Array.isArray(data)) return [];
  return (data as Record<string, unknown>[]).map(lerLinhaProdutividade);
}

/** Contexto das telas da equipe: quem sou eu, minhas permissões e meu cadastro. */
export const contextoEquipe = cache(async () => {
  const ctx = await obterContexto();
  const perms = await permissoesDoUsuario();
  const { data: eu } = await ctx.supabase.from("membros").select("pessoa_id, perfil_id, cargo").eq("user_id", ctx.usuario.id).eq("organizacao_id", ctx.organizacao.id).maybeSingle();
  const pode = (m: Modulo, o: Operacao) => temPermissao(perms, m, o);
  return {
    ...ctx,
    perms,
    pode,
    admin: ctx.papel === "admin",
    minhaPessoa: (eu?.pessoa_id as string | null) ?? null,
    meuPerfil: (eu?.perfil_id as string | null) ?? null,
  };
});

/** Perfil que vale para o usuário (o próprio ou o padrão do papel), para saber se ele aprova "por perfil". */
export function perfilEfetivo(perfis: Perfil[], papel: string, perfilId: string | null): string | null {
  return perfilId ?? perfis.find((p) => p.padrao && p.papel_base === papel)?.id ?? null;
}

/** Listas para os vínculos das tarefas internas. */
export async function carregarOpcoesTarefa(supabase: Supabase) {
  const [membros, { data: imoveis }, { data: contratos }, { data: pessoas }, { data: equipes }] = await Promise.all([
    carregarMembros(supabase),
    supabase.from("imoveis").select("id, codigo").neq("status", "inativo").order("codigo").limit(3000),
    supabase.from("contratos").select("id, numero").in("status", ["ativo", "rascunho"]).order("numero", { ascending: false }).limit(3000),
    supabase.from("pessoas").select("id, nome").order("nome").limit(3000),
    supabase.from("equipes").select("id, nome").order("nome"),
  ]);
  return {
    membros,
    imoveis: (imoveis ?? []) as { id: string; codigo: string }[],
    contratos: (contratos ?? []) as { id: string; numero: number }[],
    pessoas: (pessoas ?? []) as { id: string; nome: string }[],
    equipes: (equipes ?? []) as { id: string; nome: string }[],
  };
}

/**
 * As listas da tarefa vêm filtradas (imóveis ativos, contratos em vigor…).
 * Como o formulário salva sozinho, o vínculo atual entra sempre na lista —
 * senão o <select> cairia em "—" e o próximo salvamento apagaria o vínculo.
 */
export function comVinculosDaTarefa<
  O extends {
    membros: Membro[];
    imoveis: { id: string; codigo: string }[];
    contratos: { id: string; numero: number }[];
    pessoas: { id: string; nome: string }[];
  },
>(
  opcoes: O,
  t: {
    responsavel_id: string | null;
    imovel: { id: string; codigo: string } | null;
    contrato: { id: string; numero: number } | null;
    pessoa: { id: string; nome: string } | null;
  },
): O {
  const falta = <T extends { id: string }>(lista: T[], item: T | null) => (item && !lista.some((x) => x.id === item.id) ? [item, ...lista] : lista);
  const membros =
    t.responsavel_id && !opcoes.membros.some((m) => m.user_id === t.responsavel_id)
      ? [
          ...opcoes.membros,
          { user_id: t.responsavel_id, papel: "", nome: "Ex-usuário (sem acesso)", email: null, cargo: null, pessoa_id: null, perfil_id: null, created_at: "" },
        ]
      : opcoes.membros;
  return {
    ...opcoes,
    membros,
    imoveis: falta(opcoes.imoveis, t.imovel),
    contratos: falta(opcoes.contratos, t.contrato),
    pessoas: falta(opcoes.pessoas, t.pessoa),
  };
}

/** Endereço do sistema (para o link do convite). */
export async function urlBase() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  return `${host.startsWith("localhost") ? "http" : "https"}://${host}`;
}

/** Opções de colaborador para seletores (ativos primeiro). */
export function opcoesColaboradores(lista: Colaborador[], hoje: string) {
  return [...lista]
    .sort((a, b) => Number(Boolean(a.desligamento && a.desligamento <= hoje)) - Number(Boolean(b.desligamento && b.desligamento <= hoje)) || a.nome.localeCompare(b.nome, "pt-BR"))
    .map((c) => ({ id: c.id, nome: c.desligamento && c.desligamento <= hoje ? `${c.nome} (desligado)` : c.nome, corretor: c.papeis.includes("corretor") }));
}
