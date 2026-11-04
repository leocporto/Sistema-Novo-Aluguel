import "server-only";
import { cache } from "react";
import { obterContexto } from "@/lib/contexto";
import {
  lerData,
  lerFunil,
  lerLinhaFinanceira,
  lerLinhaPrevisao,
  lerOcupacao,
  permissoesBi,
  type DefinicaoRelatorio,
  type Funil,
  type LinhaFinanceira,
  type LinhaPrevisao,
  type ResumoOcupacao,
} from "@/lib/dominio/bi";
import { lerLinhaProdutividade, type LinhaProdutividade } from "@/lib/dominio/equipe";
import { permissoesDoUsuario } from "@/lib/permissoes";

export type Supabase = Awaited<ReturnType<typeof obterContexto>>["supabase"];

/** A função não existe no banco (migração 20261107000008 ainda não aplicada). */
export const funcaoAusente = (e: { code?: string; message?: string } | null | undefined) =>
  !!e && (e.code === "PGRST202" || e.code === "42883" || /could not find the function|does not exist/i.test(e.message ?? ""));

/** Contexto das telas de relatórios: modo, papel e o que o usuário pode fazer. */
export const contextoRelatorios = cache(async () => {
  const ctx = await obterContexto();
  const perms = await permissoesDoUsuario();
  const bi = permissoesBi(ctx.papel, perms);
  const imob = ctx.organizacao.modo !== "pessoal";
  return { ...ctx, perms, bi, imob, pessoal: !imob, corretor: ctx.papel === "corretor" && imob };
});

/** A atualização do banco dos relatórios já foi aplicada? (para avisar na tela) */
export const bancoPronto = cache(async () => {
  const { supabase } = await obterContexto();
  const { error } = await supabase.rpc("bi_minhas_permissoes");
  return !funcaoAusente(error);
});

function linhas(data: unknown): Record<string, unknown>[] {
  return Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
}

export async function carregarFinanceiro(supabase: Supabase, inicio: string, fim: string): Promise<LinhaFinanceira[]> {
  const { data, error } = await supabase.rpc("bi_financeiro_mensal", { p_inicio: inicio, p_fim: fim });
  if (error) return [];
  return linhas(data).map(lerLinhaFinanceira);
}

export async function carregarOcupacao(supabase: Supabase, inicio: string, fim: string): Promise<ResumoOcupacao> {
  const { data, error } = await supabase.rpc("bi_ocupacao", { p_inicio: inicio, p_fim: fim });
  return lerOcupacao(error ? null : linhas(data)[0]);
}

export async function carregarFunil(supabase: Supabase, inicio: string, fim: string): Promise<Funil> {
  const { data, error } = await supabase.rpc("bi_funil", { p_inicio: inicio, p_fim: fim });
  return lerFunil(error ? null : linhas(data)[0]);
}

export type Canal = { origem: string; leads: number; atendidos: number; com_visita: number; com_proposta: number; fechados: number; perdidos: number };
export async function carregarCanais(supabase: Supabase, inicio: string, fim: string): Promise<Canal[]> {
  const { data, error } = await supabase.rpc("bi_leads_canais", { p_inicio: inicio, p_fim: fim });
  if (error) return [];
  return linhas(data).map((r) => ({
    origem: String(r.origem ?? "outro"),
    leads: Number(r.leads) || 0,
    atendidos: Number(r.atendidos) || 0,
    com_visita: Number(r.com_visita) || 0,
    com_proposta: Number(r.com_proposta) || 0,
    fechados: Number(r.fechados) || 0,
    perdidos: Number(r.perdidos) || 0,
  }));
}

export type LinhaEquipeBi = LinhaProdutividade & { comissoes: number };
export async function carregarEquipe(supabase: Supabase, inicio: string, fim: string): Promise<LinhaEquipeBi[]> {
  const { data, error } = await supabase.rpc("bi_equipe", { p_inicio: inicio, p_fim: fim });
  if (error) return [];
  return linhas(data).map((r) => ({ ...lerLinhaProdutividade(r), comissoes: Number(r.comissoes) || 0 }));
}

export type LinhaFilial = {
  filial_id: string | null;
  nome: string;
  imoveis: number;
  contratos_ativos: number;
  carteira_aluguel: number;
  receita_administracao: number;
  receita_intermediacao: number;
  leads: number;
  vendas: number;
  valor_vendas: number;
  comissao_vendas: number;
};
export async function carregarFiliais(supabase: Supabase, inicio: string, fim: string): Promise<LinhaFilial[]> {
  const { data, error } = await supabase.rpc("bi_filiais", { p_inicio: inicio, p_fim: fim });
  if (error) return [];
  return linhas(data).map((r) => ({
    filial_id: (r.filial_id as string | null) ?? null,
    nome: String(r.nome ?? ""),
    imoveis: Number(r.imoveis) || 0,
    contratos_ativos: Number(r.contratos_ativos) || 0,
    carteira_aluguel: Number(r.carteira_aluguel) || 0,
    receita_administracao: Number(r.receita_administracao) || 0,
    receita_intermediacao: Number(r.receita_intermediacao) || 0,
    leads: Number(r.leads) || 0,
    vendas: Number(r.vendas) || 0,
    valor_vendas: Number(r.valor_vendas) || 0,
    comissao_vendas: Number(r.comissao_vendas) || 0,
  }));
}

export type ImovelVago = { imovel_id: string; codigo: string; titulo: string | null; bairro: string | null; valor_aluguel: number | null; vago_desde: string | null; dias: number; ja_alugado: boolean; proximo_inicio: string | null };
export async function carregarVagos(supabase: Supabase, limite: number): Promise<{ lista: ImovelVago[]; total: number }> {
  const { data, error } = await supabase.rpc("bi_imoveis_vagos", { p_limite: limite });
  if (error) return { lista: [], total: 0 };
  const l = linhas(data);
  return {
    total: Number(l[0]?.total ?? 0),
    lista: l.map((r) => ({
      imovel_id: String(r.imovel_id),
      codigo: String(r.codigo ?? ""),
      titulo: (r.titulo as string | null) ?? null,
      bairro: (r.bairro as string | null) ?? null,
      valor_aluguel: r.valor_aluguel === null || r.valor_aluguel === undefined ? null : Number(r.valor_aluguel),
      vago_desde: lerData(r.vago_desde),
      dias: Number(r.dias) || 0,
      ja_alugado: r.ja_alugado === true,
      proximo_inicio: lerData(r.proximo_inicio),
    })),
  };
}

export type ImovelProcura = { imovel_id: string; codigo: string; titulo: string | null; status: string; leads: number; visitas: number; propostas: number; contatos_site: number; pontos: number };
export async function carregarProcura(supabase: Supabase, inicio: string, fim: string, limite: number): Promise<{ lista: ImovelProcura[]; total: number }> {
  const { data, error } = await supabase.rpc("bi_imoveis_procura", { p_inicio: inicio, p_fim: fim, p_limite: limite });
  if (error) return { lista: [], total: 0 };
  const l = linhas(data);
  return {
    total: Number(l[0]?.total ?? 0),
    lista: l.map((r) => ({
      imovel_id: String(r.imovel_id),
      codigo: String(r.codigo ?? ""),
      titulo: (r.titulo as string | null) ?? null,
      status: String(r.status ?? ""),
      leads: Number(r.leads) || 0,
      visitas: Number(r.visitas) || 0,
      propostas: Number(r.propostas) || 0,
      contatos_site: Number(r.contatos_site) || 0,
      pontos: Number(r.pontos) || 0,
    })),
  };
}

export type ImovelSemVisita = { imovel_id: string; codigo: string; titulo: string | null; finalidades: string; bairro: string | null; captado_em: string | null; ultima_visita: string | null };
export async function carregarSemVisitas(supabase: Supabase, inicio: string, fim: string, limite: number): Promise<{ lista: ImovelSemVisita[]; total: number }> {
  const { data, error } = await supabase.rpc("bi_imoveis_sem_visitas", { p_inicio: inicio, p_fim: fim, p_limite: limite });
  if (error) return { lista: [], total: 0 };
  const l = linhas(data);
  return {
    total: Number(l[0]?.total ?? 0),
    lista: l.map((r) => ({
      imovel_id: String(r.imovel_id),
      codigo: String(r.codigo ?? ""),
      titulo: (r.titulo as string | null) ?? null,
      finalidades: String(r.finalidades ?? ""),
      bairro: (r.bairro as string | null) ?? null,
      captado_em: lerData(r.captado_em),
      ultima_visita: lerData(r.ultima_visita),
    })),
  };
}

export type LinhaRentabilidade = { chave: string; codigo: string; descricao: string | null; receitas: number; taxas: number; despesas: number; resultado: number; valor_referencia: number | null };
export async function carregarRentabilidade(
  supabase: Supabase,
  inicio: string,
  fim: string,
  por: "imovel" | "contrato",
  limite: number,
): Promise<{ lista: LinhaRentabilidade[]; total: number }> {
  // O Supabase devolve no máximo 1.000 linhas por chamada: pede de 1.000 em 1.000
  // (ordem estável: resultado, código e chave, a mesma da função).
  const l: Record<string, unknown>[] = [];
  for (let i = 0; i < limite; i += 1000) {
    const { data, error } = await supabase
      .rpc("bi_rentabilidade", { p_inicio: inicio, p_fim: fim, p_por: por, p_limite: limite })
      .order("resultado", { ascending: false })
      .order("codigo")
      .order("chave")
      .range(i, Math.min(limite, i + 1000) - 1);
    if (error) {
      if (i === 0) return { lista: [], total: 0 };
      break;
    }
    const pagina = linhas(data);
    l.push(...pagina);
    if (pagina.length < 1000) break;
  }
  return {
    total: Number(l[0]?.total ?? 0),
    lista: l.map((r) => ({
      chave: String(r.chave),
      codigo: String(r.codigo ?? ""),
      descricao: (r.descricao as string | null) ?? null,
      receitas: Number(r.receitas) || 0,
      taxas: Number(r.taxas) || 0,
      despesas: Number(r.despesas) || 0,
      resultado: Number(r.resultado) || 0,
      valor_referencia: r.valor_referencia === null || r.valor_referencia === undefined ? null : Number(r.valor_referencia),
    })),
  };
}

export async function carregarPrevisao(supabase: Supabase, meses: number): Promise<LinhaPrevisao[]> {
  const { data, error } = await supabase.rpc("bi_previsao", { p_meses: meses });
  if (error) return [];
  return linhas(data).map(lerLinhaPrevisao);
}

export type ResultadoPersonalizado = { linhas: unknown[][]; total: number; totais: Record<string, unknown>; colunas: string[] };

/** Roda um relatório personalizado no banco (lista fechada de colunas; RLS vale). */
export async function executarPersonalizado(
  supabase: Supabase,
  def: DefinicaoRelatorio,
  limite: number,
): Promise<{ ok: true; resultado: ResultadoPersonalizado } | { ok: false; erro: string }> {
  const { data, error } = await supabase.rpc("bi_executar", {
    p: {
      fonte: def.fonte,
      colunas: def.colunas,
      filtros: def.filtros ?? [],
      agrupar_por: def.agrupar_por || null,
      totais: def.totais ?? [],
      ordenar_por: def.ordenar_por || null,
      ordem: def.ordem || "asc",
    },
    p_limite: limite,
  });
  if (error) return { ok: false, erro: funcaoAusente(error) ? "Os relatórios personalizados precisam da atualização do banco (migração 20261107000008)." : error.message };
  const r = (data ?? {}) as Partial<ResultadoPersonalizado>;
  return {
    ok: true,
    resultado: {
      linhas: Array.isArray(r.linhas) ? r.linhas : [],
      total: Number(r.total ?? 0),
      totais: (r.totais ?? {}) as Record<string, unknown>,
      colunas: Array.isArray(r.colunas) ? r.colunas : [],
    },
  };
}

export type RelatorioSalvo = {
  id: string;
  nome: string;
  descricao: string | null;
  fonte: string;
  colunas: string[];
  filtros: { campo: string; op: string; valor?: string | null }[];
  agrupar_por: string | null;
  totais: string[];
  ordenar_por: string | null;
  ordem: string;
  limite: number;
  updated_at: string;
};

export const SELECT_SALVO = "id, nome, descricao, fonte, colunas, filtros, agrupar_por, totais, ordenar_por, ordem, limite, updated_at";

export async function carregarSalvo(supabase: Supabase, id: string): Promise<RelatorioSalvo | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data } = await supabase.from("relatorios_salvos").select(SELECT_SALVO).eq("id", id).maybeSingle();
  return (data as RelatorioSalvo | null) ?? null;
}

export type Agendamento = {
  id: string;
  nome: string;
  relatorio_id: string | null;
  padrao: string | null;
  periodo: string;
  frequencia: string;
  dia_semana: number | null;
  dia_mes: number | null;
  hora: number;
  formato: string;
  emails: string[];
  whatsapps: string[];
  ativo: boolean;
  proxima_em: string | null;
  ultima_em: string | null;
  relatorio?: { nome: string } | null;
};

export const SELECT_AGENDAMENTO =
  "id, nome, relatorio_id, padrao, periodo, frequencia, dia_semana, dia_mes, hora, formato, emails, whatsapps, ativo, proxima_em, ultima_em, relatorio:relatorios_salvos(nome)";

export type Execucao = {
  id: string;
  agendamento_id: string | null;
  nome: string;
  origem: string;
  status: string;
  formato: string | null;
  linhas: number | null;
  resumo: string | null;
  arquivo_path: string | null;
  destinatarios: { emails?: string[]; whatsapps?: string[]; periodo?: string } | null;
  erro: string | null;
  data: string;
  usuario_id: string | null;
  arquivo_apagado_em: string | null;
};

export const SELECT_EXECUCAO = "id, agendamento_id, nome, origem, status, formato, linhas, resumo, arquivo_path, destinatarios, erro, data, usuario_id, arquivo_apagado_em";

/** Nome de quem gerou cada envio (usuários da organização). */
export async function nomesDosUsuarios(supabase: Supabase): Promise<Map<string, string>> {
  const { data } = await supabase.from("membros").select("user_id, nome, email").limit(500);
  return new Map((data ?? []).map((m) => [m.user_id as string, ((m.nome as string | null) || (m.email as string | null) || "Usuário") as string]));
}

/** Links assinados (7 dias) para baixar os arquivos gerados (os já apagados ficam de fora). */
export async function linksAssinados(supabase: Supabase, execucoes: Pick<Execucao, "arquivo_path" | "arquivo_apagado_em">[]): Promise<Map<string, string>> {
  const unicos = [...new Set(execucoes.filter((e) => e.arquivo_path && !e.arquivo_apagado_em).map((e) => e.arquivo_path as string))];
  if (!unicos.length) return new Map();
  const { data } = await supabase.storage.from("relatorios").createSignedUrls(unicos, 7 * 24 * 3600);
  const out = new Map<string, string>();
  for (const d of data ?? []) if (d.path && d.signedUrl) out.set(d.path, d.signedUrl);
  return out;
}
