import "server-only";
import { headers } from "next/headers";
import type { obterContexto } from "@/lib/contexto";
import { configComPadrao, type ConfigAnalise, type DadosRegra } from "@/lib/dominio/analise";

type Supabase = Awaited<ReturnType<typeof obterContexto>>["supabase"];
export type OpcaoNome = { id: string; nome: string };

export type PessoaResumo = {
  id: string;
  nome: string;
  tipo_pessoa: string;
  documento: string | null;
  telefone: string | null;
  email: string | null;
  profissao: string | null;
  estado_civil: string | null;
};

export type Analise = {
  id: string;
  numero: number;
  candidato_id: string;
  imovel_id: string | null;
  corretor_id: string | null;
  finalidade: string;
  valor_aluguel: number;
  valor_encargos: number;
  moradores: number | null;
  moradores_obs: string | null;
  renda_declarada: number | null;
  status: string;
  desistencia_motivo: string | null;
  decisao: string | null;
  decisao_justificativa: string | null;
  decisao_condicoes: string | null;
  fora_da_regra: string[];
  excecao: boolean;
  excecao_justificativa: string | null;
  decidido_em: string | null;
  decidido_por: string | null;
  validade_ate: string | null;
  proprietario_ciente_em: string | null;
  contrato_id: string | null;
  identidade_conferida_em: string | null;
  identidade_conferida_por: string | null;
  consentimento_em: string | null;
  consentimento_origem: string | null;
  consentimento_ip: string | null;
  consentimento_texto: string | null;
  token: string;
  ficha_ativa: boolean;
  ficha_expira_em: string | null;
  ficha_enviada_em: string | null;
  ficha_dados: Record<string, string> | null;
  observacoes: string | null;
  created_at: string;
  candidato: PessoaResumo | null;
  imovel: { id: string; codigo: string; logradouro: string | null; numero: string | null; bairro: string | null; cidade: string | null } | null;
  corretor: { id: string; nome: string } | null;
  contrato: { id: string; numero: number; status: string } | null;
};

export const SELECT_ANALISE =
  "*, candidato:pessoas!analises_candidato_id_fkey(id, nome, tipo_pessoa, documento, telefone, email, profissao, estado_civil), imovel:imoveis(id, codigo, logradouro, numero, bairro, cidade), corretor:pessoas!analises_corretor_id_fkey(id, nome), contrato:contratos(id, numero, status)";

export type Fiador = {
  id: string;
  pessoa_id: string;
  parentesco: string | null;
  conjuge_nome: string | null;
  conjuge_documento: string | null;
  outorga_conjuge: boolean;
  imovel_descricao: string | null;
  imovel_matricula: string | null;
  imovel_cartorio: string | null;
  imovel_valor: number | null;
  imovel_onus: boolean;
  status: string;
  parecer: string | null;
  analisado_em: string | null;
  analisado_por: string | null;
  consentimento_em: string | null;
  consentimento_origem: string | null;
  identidade_conferida_em: string | null;
  identidade_conferida_por: string | null;
  pessoa: PessoaResumo | null;
};

export type Renda = {
  id: string;
  fiador_id: string | null;
  titular: string | null;
  tipo: string;
  fonte: string | null;
  valor_declarado: number;
  valor_comprovado: number | null;
  comprovante: string | null;
  comprovado_em: string | null;
  comprovado_por: string | null;
  origem: string;
};

export type Documento = {
  id: string;
  fiador_id: string | null;
  parte: string;
  item: string | null;
  rotulo: string;
  obrigatorio: boolean;
  ordem: number;
  status: string;
  motivo_recusa: string | null;
  validado_em: string | null;
  validado_por: string | null;
};

export type Consulta = {
  id: string;
  fiador_id: string | null;
  documento_consultado: string | null;
  bureau: string;
  bureau_nome: string | null;
  consultado_em: string;
  score: number | null;
  faixa_risco: string | null;
  restricoes: boolean;
  restricoes_qtd: number | null;
  restricoes_valor: number | null;
  restricoes_descricao: string | null;
  protocolo: string | null;
  base_legal: string;
  consentimento_em: string | null;
  origem: string;
  observacoes: string | null;
  consultado_por: string | null;
  created_at: string;
};

export type GarantiaProposta = {
  id: string;
  fiador_id: string | null;
  tipo: string;
  garantidora: string | null;
  proposta_numero: string | null;
  apolice_numero: string | null;
  valor: number | null;
  premio: number | null;
  parcelas: number | null;
  vigencia_inicio: string | null;
  vigencia_fim: string | null;
  conta: string | null;
  status: string;
  solicitada_em: string | null;
  respondida_em: string | null;
  resposta: string | null;
  contrato_garantia_id: string | null;
  observacoes: string | null;
  created_at: string;
};

const SELECT_PESSOA = "id, nome, tipo_pessoa, documento, telefone, email, profissao, estado_civil";

/** Análise com tudo o que as abas usam. */
export async function carregarAnalise(supabase: Supabase, id: string) {
  const [{ data }, { data: fiadores }, { data: rendas }, { data: documentos }, { data: consultas }, { data: garantias }] = await Promise.all([
    supabase.from("analises").select(SELECT_ANALISE).eq("id", id).maybeSingle(),
    supabase.from("analise_fiadores").select(`*, pessoa:pessoas(${SELECT_PESSOA})`).eq("analise_id", id).order("created_at"),
    supabase.from("analise_rendas").select("*").eq("analise_id", id).order("created_at"),
    supabase.from("analise_documentos").select("*").eq("analise_id", id).order("ordem").order("created_at"),
    supabase.from("analise_consultas").select("*").eq("analise_id", id).order("consultado_em", { ascending: false }).order("created_at", { ascending: false }),
    supabase.from("analise_garantias").select("*").eq("analise_id", id).order("created_at"),
  ]);
  if (!data) return null;
  return {
    analise: data as unknown as Analise,
    fiadores: (fiadores ?? []) as unknown as Fiador[],
    rendas: (rendas ?? []) as Renda[],
    documentos: (documentos ?? []) as Documento[],
    consultas: (consultas ?? []) as Consulta[],
    garantias: (garantias ?? []) as GarantiaProposta[],
  };
}

/** Monta os dados que a regra de aprovação usa. */
export function dadosDaRegra(c: NonNullable<Awaited<ReturnType<typeof carregarAnalise>>>): DadosRegra {
  return {
    aluguel: c.analise.valor_aluguel,
    encargos: c.analise.valor_encargos,
    documentoCandidato: c.analise.candidato?.documento,
    rendas: c.rendas,
    consultas: c.consultas,
    documentos: c.documentos,
    garantias: c.garantias,
    fiadores: c.fiadores.map((f) => ({ id: f.id, nome: f.pessoa?.nome ?? "fiador", status: f.status })),
  };
}

export type ConfigCompleta = ConfigAnalise & { existe: boolean; texto_consentimento: string | null; bureau_padrao: string | null };

export async function carregarConfig(supabase: Supabase, organizacaoId: string): Promise<ConfigCompleta> {
  const { data } = await supabase.from("analise_config").select("*").eq("organizacao_id", organizacaoId).maybeSingle();
  return {
    ...configComPadrao(data),
    existe: Boolean(data),
    texto_consentimento: (data?.texto_consentimento as string | null) ?? null,
    bureau_padrao: (data?.bureau_padrao as string | null) ?? null,
  };
}

/** Nomes da equipe (para "validado por", "decidido por"…). */
export async function nomesEquipe(supabase: Supabase, eu: string) {
  const { data } = await supabase.from("membros").select("user_id, nome").limit(500);
  const mapa = new Map((data ?? []).map((m) => [m.user_id as string, (m.nome as string | null) ?? null]));
  return (id: string | null | undefined) => (!id ? "sistema" : id === eu ? "você" : (mapa.get(id) ?? "outro usuário"));
}

export async function carregarOpcoes(supabase: Supabase) {
  const [pessoas, imoveis, corretores] = await Promise.all([
    supabase.from("pessoas").select("id, nome").order("nome").limit(3000),
    supabase.from("imoveis").select("id, codigo, logradouro, numero, valor_aluguel, valor_condominio, valor_iptu, status").contains("finalidades", ["locacao"]).neq("status", "inativo").order("codigo").limit(3000),
    supabase.from("pessoas").select("id, nome").contains("papeis", ["corretor"]).order("nome"),
  ]);
  return {
    pessoas: (pessoas.data ?? []) as OpcaoNome[],
    imoveis: (imoveis.data ?? []) as {
      id: string;
      codigo: string;
      logradouro: string | null;
      numero: string | null;
      valor_aluguel: number | null;
      valor_condominio: number | null;
      valor_iptu: number | null;
      status: string;
    }[],
    corretores: (corretores.data ?? []) as OpcaoNome[],
  };
}

/** Endereço do site (para os links públicos da ficha). */
export async function enderecoSite() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  return `${host.startsWith("localhost") ? "http" : "https"}://${host}`;
}

export const enderecoImovel = (i: Analise["imovel"]) => (i ? [i.codigo, [i.logradouro, i.numero].filter(Boolean).join(", ")].filter(Boolean).join(" — ") : "—");

export const quando = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
    : "—";
