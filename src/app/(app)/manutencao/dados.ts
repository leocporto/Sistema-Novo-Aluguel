import "server-only";
import { headers } from "next/headers";
import type { obterContexto } from "@/lib/contexto";
import { diaLocal } from "@/lib/dominio/agenda";
import { formatarDataBR } from "@/lib/dominio/datas";

type Supabase = Awaited<ReturnType<typeof obterContexto>>["supabase"];
export type OpcaoNome = { id: string; nome: string };

type ImovelResumo = { id: string; codigo: string; logradouro: string | null; numero: string | null; complemento: string | null; bairro: string | null; cidade: string | null; uf: string | null };

export type Chamado = {
  id: string;
  organizacao_id: string;
  numero: number;
  imovel_id: string;
  contrato_id: string | null;
  origem: "interno" | "link";
  aberto_por: string;
  solicitante_pessoa_id: string | null;
  solicitante_nome: string | null;
  solicitante_telefone: string | null;
  categoria: string;
  urgencia: string;
  prazo_atendimento: string | null;
  titulo: string;
  descricao: string | null;
  local: string | null;
  status: string;
  motivo: string | null;
  responsabilidade: string | null;
  pct_locatario: number;
  pct_proprietario: number;
  pct_imobiliaria: number;
  pago_direto: boolean;
  prestador_id: string | null;
  orcamento_id: string | null;
  valor_aprovado: number | null;
  aprovacao_status: string;
  status_antes_aprovacao: string | null;
  aprovacao_token: string;
  aprovacao_em: string | null;
  aprovacao_nome: string | null;
  aprovacao_obs: string | null;
  aprovacao_canal: string | null;
  agendado_para: string | null;
  duracao_min: number;
  visita_id: string | null;
  iniciado_em: string | null;
  locatario_confirmou_em: string | null;
  locatario_comentario: string | null;
  concluido_em: string | null;
  valor_final: number | null;
  conclusao_aprovada_em: string | null;
  conclusao_aprovada_por: string | null;
  conclusao_obs: string | null;
  garantia_dias: number | null;
  garantia_ate: string | null;
  chamado_origem_id: string | null;
  cobranca_locatario: string | null;
  fatura_item_id: string | null;
  avaliacao_nota: number | null;
  avaliacao_comentario: string | null;
  avaliado_em: string | null;
  created_at: string;
  imovel: ImovelResumo | null;
  contrato: { id: string; numero: number; codigo: string | null } | null;
  prestador: { id: string; nome: string; telefone: string | null; especialidade: string | null; documento: string | null } | null;
  solicitante: { id: string; nome: string; telefone: string | null } | null;
};

export const SELECT_CHAMADO =
  "*, imovel:imoveis(id, codigo, logradouro, numero, complemento, bairro, cidade, uf), contrato:contratos(id, numero, codigo), prestador:pessoas!chamados_prestador_id_fkey(id, nome, telefone, especialidade, documento), solicitante:pessoas!chamados_solicitante_pessoa_id_fkey(id, nome, telefone)";

export const SELECT_LISTA =
  "id, numero, titulo, categoria, urgencia, status, prazo_atendimento, created_at, concluido_em, valor_final, valor_aprovado, garantia_ate, origem, imovel_id, contrato_id, prestador_id, avaliacao_nota, imovel:imoveis(id, codigo, logradouro, numero), prestador:pessoas!chamados_prestador_id_fkey(id, nome)";

export type ChamadoLista = Pick<
  Chamado,
  "id" | "numero" | "titulo" | "categoria" | "urgencia" | "status" | "prazo_atendimento" | "created_at" | "concluido_em" | "valor_final" | "valor_aprovado" | "garantia_ate" | "origem" | "imovel_id" | "contrato_id" | "prestador_id" | "avaliacao_nota"
> & { imovel: { id: string; codigo: string; logradouro: string | null; numero: string | null } | null; prestador: { id: string; nome: string } | null };

export type Orcamento = {
  id: string;
  chamado_id: string;
  prestador_id: string | null;
  prestador_nome: string | null;
  status: string;
  valor: number | null;
  prazo_dias: number | null;
  garantia_dias: number | null;
  validade: string | null;
  descricao: string | null;
  solicitado_em: string;
  recebido_em: string | null;
  prestador: { id: string; nome: string; telefone: string | null; especialidade: string | null } | null;
};

export const enderecoImovel = (i: Partial<ImovelResumo> | null | undefined) =>
  i ? [[i.logradouro, i.numero].filter(Boolean).join(", "), i.complemento, i.bairro, [i.cidade, i.uf].filter(Boolean).join("/")].filter(Boolean).join(" · ") : "";

export const nomeImovel = (i: { codigo: string; logradouro?: string | null; numero?: string | null } | null | undefined) =>
  i ? `${i.codigo}${i.logradouro ? ` · ${[i.logradouro, i.numero].filter(Boolean).join(", ")}` : ""}` : "Imóvel removido";

/** Endereço do site (para os links públicos). */
export async function urlBase() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  return `${host.startsWith("localhost") ? "http" : "https"}://${host}`;
}

export async function carregarChamado(supabase: Supabase, id: string): Promise<Chamado | null> {
  const { data } = await supabase.from("chamados").select(SELECT_CHAMADO).eq("id", id).maybeSingle();
  return (data as unknown as Chamado) ?? null;
}

export type ContratoOpcao = { id: string; numero: number; codigo: string | null; imovel_id: string; imovel: string; locatario: string | null; locatarioTelefone: string | null; locatarioId: string | null };

const SELECT_CONTRATO_OPCAO = "id, numero, codigo, status, imovel_id, imovel:imoveis(codigo), contrato_partes(papel, percentual, pessoa:pessoas(id, nome, telefone))";
type ContratoLido = { id: string; numero: number; codigo: string | null; status: string; imovel_id: string; imovel: { codigo: string } | null; contrato_partes: { papel: string; percentual: number | null; pessoa: { id: string; nome: string; telefone: string | null } | null }[] };

function paraOpcao(c: ContratoLido): ContratoOpcao {
  const loc = c.contrato_partes.filter((p) => p.papel === "locatario").sort((a, b) => Number(b.percentual ?? 0) - Number(a.percentual ?? 0))[0]?.pessoa ?? null;
  const imovel = c.imovel?.codigo ?? "—";
  return { id: c.id, numero: c.numero, codigo: c.codigo, imovel_id: c.imovel_id, imovel: c.status === "ativo" ? imovel : `${imovel} (${c.status})`, locatario: loc?.nome ?? null, locatarioTelefone: loc?.telefone ?? null, locatarioId: loc?.id ?? null };
}

/** Contratos ativos com o imóvel e o locatário principal. */
export async function contratosAtivos(supabase: Supabase): Promise<ContratoOpcao[]> {
  const { data } = await supabase.from("contratos").select(SELECT_CONTRATO_OPCAO).eq("status", "ativo").order("numero").limit(2000);
  return ((data ?? []) as unknown as ContratoLido[]).map(paraOpcao);
}

/** Um contrato em qualquer situação (para abrir chamado de um contrato já encerrado). */
export async function contratoOpcao(supabase: Supabase, id: string): Promise<ContratoOpcao | null> {
  const { data } = await supabase.from("contratos").select(SELECT_CONTRATO_OPCAO).eq("id", id).maybeSingle();
  return data ? paraOpcao(data as unknown as ContratoLido) : null;
}

export type PrestadorOpcao = { id: string; nome: string; especialidade: string | null; telefone: string | null };

export async function prestadores(supabase: Supabase): Promise<PrestadorOpcao[]> {
  const { data } = await supabase.from("pessoas").select("id, nome, especialidade, telefone").contains("papeis", ["prestador"]).order("nome").limit(2000);
  return (data ?? []) as PrestadorOpcao[];
}

/** Opções do formulário de novo chamado. */
export async function opcoesChamado(supabase: Supabase, hoje: string) {
  const [{ data: imoveis }, contratos, prest, { data: garantias }] = await Promise.all([
    supabase.from("imoveis").select("id, codigo, logradouro, numero").neq("status", "inativo").order("codigo").limit(3000),
    contratosAtivos(supabase),
    prestadores(supabase),
    supabase
      .from("chamados")
      .select("id, numero, titulo, imovel_id, garantia_ate, imovel:imoveis(codigo)")
      .in("status", ["concluido", "avaliado"])
      .gte("garantia_ate", hoje)
      .order("garantia_ate")
      .limit(500),
  ]);
  type G = { id: string; numero: number; titulo: string; imovel_id: string; garantia_ate: string; imovel: { codigo: string } | null };
  return {
    imoveis: (imoveis ?? []) as { id: string; codigo: string; logradouro: string | null; numero: string | null }[],
    contratos,
    prestadores: prest,
    garantias: ((garantias ?? []) as unknown as G[]).map((g) => ({ id: g.id, nome: `#${g.numero} · ${g.imovel?.codigo ?? "—"} · ${g.titulo} (garantia até ${formatarDataBR(g.garantia_ate)})` })),
  };
}

/** Locatário principal do contrato (nome e telefone). */
export async function locatarioDoContrato(supabase: Supabase, contratoId: string | null) {
  if (!contratoId) return null;
  const { data } = await supabase.from("contrato_partes").select("percentual, pessoa:pessoas(id, nome, telefone)").eq("contrato_id", contratoId).eq("papel", "locatario");
  type P = { percentual: number | null; pessoa: { id: string; nome: string; telefone: string | null } | null };
  return ((data ?? []) as unknown as P[]).sort((a, b) => Number(b.percentual ?? 0) - Number(a.percentual ?? 0))[0]?.pessoa ?? null;
}

/** Proprietários do imóvel (para pedir aprovação). */
export async function proprietariosDoImovel(supabase: Supabase, imovelId: string) {
  const { data } = await supabase.from("imovel_proprietarios").select("percentual, pessoa:pessoas(id, nome, telefone)").eq("imovel_id", imovelId);
  type P = { percentual: number; pessoa: { id: string; nome: string; telefone: string | null } | null };
  return ((data ?? []) as unknown as P[]).filter((p) => p.pessoa).map((p) => ({ ...p.pessoa!, percentual: Number(p.percentual) }));
}

/** Faturas em aberto do contrato (para lançar a cobrança do locatário). */
export async function faturasAbertas(supabase: Supabase, contratoId: string | null) {
  if (!contratoId) return [];
  const { data } = await supabase.from("faturas").select("id, numero, competencia, vencimento, valor_total").eq("contrato_id", contratoId).eq("status", "aberta").order("vencimento");
  return (data ?? []) as { id: string; numero: number; competencia: string; vencimento: string; valor_total: number }[];
}

/** Telefone para falar com quem pediu (solicitante → locatário do contrato). */
export async function contatoDoSolicitante(supabase: Supabase, c: Chamado) {
  if (c.solicitante_telefone) return { nome: c.solicitante_nome ?? c.solicitante?.nome ?? "", telefone: c.solicitante_telefone };
  if (c.solicitante?.telefone) return { nome: c.solicitante.nome, telefone: c.solicitante.telefone };
  const loc = await locatarioDoContrato(supabase, c.contrato_id);
  return loc?.telefone ? { nome: loc.nome, telefone: loc.telefone } : null;
}

/** Fotos e vídeos do chamado com link temporário (1 hora) para abrir. */
export async function midiasDoChamado(supabase: Supabase, chamadoId: string) {
  const { data } = await supabase.from("chamado_midias").select("id, path, nome, tipo, momento, enviado_por, created_at").eq("chamado_id", chamadoId).order("created_at");
  const lista = (data ?? []) as { id: string; path: string; nome: string | null; tipo: string; momento: string; enviado_por: string; created_at: string }[];
  const { data: assinadas } = lista.length ? await supabase.storage.from("manutencao").createSignedUrls(lista.map((m) => m.path), 3600) : { data: [] };
  const url = new Map((assinadas ?? []).map((a) => [a.path, a.signedUrl]));
  return lista.map((m) => ({
    id: m.id,
    nome: m.nome,
    tipo: m.tipo,
    momento: m.momento,
    enviadoPor: m.enviado_por,
    url: url.get(m.path) ?? null,
    criado: formatarDataBR(diaLocal(m.created_at)),
  }));
}
