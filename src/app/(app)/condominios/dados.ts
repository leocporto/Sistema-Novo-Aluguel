import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import type { obterContexto } from "@/lib/contexto";
import type { Organizacao } from "@/lib/tipos";
import { todas } from "../financeiro/dados";

type Supabase = Awaited<ReturnType<typeof obterContexto>>["supabase"];

/** Módulo de condomínios em uso: ligado pelo admin E conta no modo imobiliária (o banco confere o mesmo em privado.cond_ativo). */
export function moduloCondominios(o: Organizacao): boolean {
  return o.modo === "imobiliaria" && o.modulo_condominios === true;
}

/** Equipe que cuida dos condomínios (o corretor não). */
export const equipeCondominio = (papel: string) => papel === "admin" || papel === "gestor" || papel === "financeiro";

export type Condominio = {
  id: string;
  nome: string;
  cnpj: string | null;
  cep: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  sindico_id: string | null;
  responsavel_user_id: string | null;
  dia_vencimento: number;
  multa_pct: number;
  juros_mes_pct: number;
  criterio_rateio: "fracao" | "igual" | "area";
  fundo_reserva_pct: number;
  voto_peso: "fracao" | "unidade";
  pix_chave: string | null;
  pix_nome: string | null;
  pix_cidade: string | null;
  banco: string | null;
  agencia: string | null;
  conta: string | null;
  taxa_administracao: number;
  ativo: boolean;
  observacoes: string | null;
  sindico: { id: string; nome: string; telefone: string | null } | null;
};

export const carregarCondominio = cache(async (supabase: Supabase, id: string): Promise<Condominio | null> => {
  const { data } = await supabase.from("cond_condominios").select("*, sindico:pessoas(id, nome, telefone)").eq("id", id).maybeSingle();
  return (data as unknown as Condominio | null) ?? null;
});

export type Unidade = {
  id: string;
  numero: string;
  tipo: string;
  area_privativa: number | null;
  fracao_ideal: number | null;
  vaga: string | null;
  situacao: string;
  observacoes: string | null;
  bloco_id: string | null;
  bloco: { id: string; nome: string } | null;
};

/** Unidades do condomínio em ordem (bloco, número). Todas, de 1.000 em 1.000. */
export const unidadesDo = cache(async (supabase: Supabase, condominio: string): Promise<Unidade[]> => {
  const us = await todas<Unidade & { bloco: { id: string; nome: string; ordem: number } | null }>(() =>
    supabase
      .from("cond_unidades")
      .select("id, numero, tipo, area_privativa, fracao_ideal, vaga, situacao, observacoes, bloco_id, bloco:cond_blocos(id, nome, ordem)")
      .eq("condominio_id", condominio)
      .order("id"),
  );
  return us.sort(
    (a, b) =>
      (a.bloco?.ordem ?? 0) - (b.bloco?.ordem ?? 0) ||
      (a.bloco?.nome ?? "").localeCompare(b.bloco?.nome ?? "", "pt-BR") ||
      a.numero.localeCompare(b.numero, "pt-BR", { numeric: true }),
  );
});

export const blocosDo = cache(async (supabase: Supabase, condominio: string) => {
  const { data } = await supabase.from("cond_blocos").select("id, nome, ordem").eq("condominio_id", condominio).order("ordem").order("nome");
  return (data ?? []) as { id: string; nome: string; ordem: number }[];
});

export const contasDo = cache(async (supabase: Supabase, condominio: string) => {
  const { data } = await supabase.from("cond_contas").select("id, nome, tipo, saldo_inicial, banco, agencia, conta, ativa").eq("condominio_id", condominio).order("created_at");
  return (data ?? []) as { id: string; nome: string; tipo: string; saldo_inicial: number; banco: string | null; agencia: string | null; conta: string | null; ativa: boolean }[];
});

/** Saldos (agregados no banco) até hoje. */
export async function saldosDo(supabase: Supabase, condominio: string, ate?: string) {
  const { data } = await supabase.rpc("cond_saldos", { p_condominio: condominio, p_ate: ate ?? null });
  return ((data ?? []) as { id: string; nome: string; tipo: string; ativa: boolean; saldo: number }[]).map((s) => ({ ...s, saldo: Number(s.saldo) }));
}

/** Vínculos em vigor (pessoa × unidade × papel). */
export type Vinculo = {
  id: string;
  unidade_id: string | null;
  pessoa_id: string;
  papel: string;
  inicio: string;
  fim: string | null;
  responsavel_financeiro: boolean;
  pessoa: { id: string; nome: string; telefone: string | null; email: string | null; documento: string | null } | null;
};

/** Vínculos do condomínio (só os em vigor, ou todos). Todos, de 1.000 em 1.000; os mais novos primeiro. */
export async function vinculosDo(supabase: Supabase, condominio: string, todos = false): Promise<Vinculo[]> {
  const montar = () => {
    const q = supabase
      .from("cond_pessoas_unidade")
      .select("id, unidade_id, pessoa_id, papel, inicio, fim, responsavel_financeiro, pessoa:pessoas(id, nome, telefone, email, documento)")
      .eq("condominio_id", condominio);
    return (todos ? q : q.is("fim", null)).order("inicio", { ascending: false }).order("id");
  };
  return todas<Vinculo>(montar);
}

/** Pessoas para escolher (cadastro geral de Pessoas). Todas, de 1.000 em 1.000. */
export const opcoesPessoas = cache(async (supabase: Supabase) =>
  todas<{ id: string; nome: string; papeis: string[] | null }>(() => supabase.from("pessoas").select("id, nome, papeis").order("nome").order("id")),
);

/** Equipe (para o responsável). */
export const opcoesEquipe = cache(async (supabase: Supabase) => {
  const { data } = await supabase.from("membros").select("user_id, nome, papel").in("papel", ["admin", "gestor", "financeiro"]).order("nome");
  return (data ?? []) as { user_id: string; nome: string | null; papel: string }[];
});

export async function urlBase(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  return `${host.startsWith("localhost") ? "http" : "https"}://${host}`;
}

/** "AAAA-MM" → "AAAA-MM-01". */
export const competenciaDe = (mes: string) => `${mes}-01`;
