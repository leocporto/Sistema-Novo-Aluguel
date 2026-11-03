import type { obterContexto } from "@/lib/contexto";

type Supabase = Awaited<ReturnType<typeof obterContexto>>["supabase"];
export type OpcaoNome = { id: string; nome: string };

export const SELECT_VISTORIA =
  "*, imovel:imoveis(id, codigo, tipo, logradouro, numero, complemento, bairro, cidade, uf, quartos, banheiros, vagas), contrato:contratos(id, numero, status), responsavel:pessoas(id, nome, telefone, documento)";

export type ImovelVistoria = {
  id: string;
  codigo: string;
  tipo: string;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  quartos: number | null;
  banheiros: number | null;
  vagas: number | null;
};

export type Vistoria = {
  id: string;
  numero: number;
  tipo: string;
  status: string;
  imovel_id: string;
  contrato_id: string | null;
  desocupacao_id: string | null;
  visita_id: string | null;
  referencia_id: string | null;
  data: string;
  responsavel_id: string | null;
  responsavel_nome: string | null;
  acompanhante: string | null;
  observacoes: string | null;
  conclusao: string | null;
  iniciada_em: string | null;
  concluida_em: string | null;
  assinada_em: string | null;
  documento_id: string | null;
  contestacao_token: string;
  contestacao_dias: number;
  contestacao_ate: string | null;
  created_at: string;
  imovel: ImovelVistoria | null;
  contrato: { id: string; numero: number; status: string } | null;
  responsavel: { id: string; nome: string; telefone: string | null; documento: string | null } | null;
};

export type Item = { id: string; nome: string; ordem: number; estado: string | null; observacao: string | null };
export type Ambiente = { id: string; nome: string; tipo: string; ordem: number; observacoes: string | null; created_at: string; vistoria_itens: Item[] };
export type Medidor = { id: string; tipo: string; numero: string | null; leitura: number | null; observacao: string | null };
export type Midia = {
  id: string;
  tipo: "foto" | "video";
  path: string;
  nome_arquivo: string | null;
  legenda: string | null;
  tirada_em: string;
  ambiente_id: string | null;
  item_id: string | null;
  medidor_id: string | null;
};

export const enderecoImovel = (i: Pick<ImovelVistoria, "logradouro" | "numero" | "complemento" | "bairro" | "cidade" | "uf"> | null) =>
  i ? [[i.logradouro, i.numero].filter(Boolean).join(", "), i.complemento, i.bairro, [i.cidade, i.uf].filter(Boolean).join("/")].filter(Boolean).join(" · ") : "";

export const quemFez = (v: Pick<Vistoria, "responsavel" | "responsavel_nome">) => v.responsavel?.nome ?? v.responsavel_nome ?? null;

export async function carregarVistoria(sb: Supabase, id: string) {
  const { data } = await sb.from("vistorias").select(SELECT_VISTORIA).eq("id", id).maybeSingle();
  return (data as unknown as Vistoria | null) ?? null;
}

/** Ambientes com os itens, na ordem do checklist. */
export async function carregarAmbientes(sb: Supabase, vistoriaId: string): Promise<Ambiente[]> {
  const { data } = await sb
    .from("vistoria_ambientes")
    .select("id, nome, tipo, ordem, observacoes, created_at, vistoria_itens(id, nome, ordem, estado, observacao)")
    .eq("vistoria_id", vistoriaId)
    .order("ordem")
    .order("created_at");
  const lista = (data ?? []) as unknown as Ambiente[];
  for (const a of lista) a.vistoria_itens.sort((x, y) => x.ordem - y.ordem || x.nome.localeCompare(y.nome, "pt-BR"));
  return lista;
}

export async function carregarMedidores(sb: Supabase, vistoriaId: string): Promise<Medidor[]> {
  const { data } = await sb.from("vistoria_medidores").select("id, tipo, numero, leitura, observacao").eq("vistoria_id", vistoriaId).order("tipo").order("created_at");
  return ((data ?? []) as Medidor[]).map((m) => ({ ...m, leitura: m.leitura === null ? null : Number(m.leitura) }));
}

export async function carregarMidias(sb: Supabase, vistoriaId: string): Promise<Midia[]> {
  const { data } = await sb
    .from("vistoria_midias")
    .select("id, tipo, path, nome_arquivo, legenda, tirada_em, ambiente_id, item_id, medidor_id")
    .eq("vistoria_id", vistoriaId)
    .order("tirada_em");
  return (data ?? []) as Midia[];
}

/** Links temporários (1 hora) das fotos e vídeos do bucket privado. */
export async function linksAssinados(sb: Supabase, caminhos: string[]): Promise<Record<string, string>> {
  if (!caminhos.length) return {};
  const { data } = await sb.storage.from("vistorias").createSignedUrls(caminhos, 3600);
  const mapa: Record<string, string> = {};
  for (const d of data ?? []) if (d.path && d.signedUrl) mapa[d.path] = d.signedUrl;
  return mapa;
}

export type Pendencia = {
  id: string;
  tipo: string;
  descricao: string;
  responsavel: string;
  status: string;
  prazo: string | null;
  valor_estimado: number | null;
  resolvida_em: string | null;
  observacao: string | null;
  ambiente_id: string | null;
  item_id: string | null;
  created_at: string;
  vistoria_orcamentos: Orcamento[];
};
export type Orcamento = {
  id: string;
  prestador_id: string | null;
  prestador_nome: string | null;
  valor: number;
  prazo_dias: number | null;
  validade: string | null;
  descricao: string | null;
  aprovado: boolean;
  aprovado_em: string | null;
  prestador: { id: string; nome: string; telefone: string | null } | null;
};

export async function carregarPendencias(sb: Supabase, vistoriaId: string): Promise<Pendencia[]> {
  const { data } = await sb
    .from("vistoria_pendencias")
    .select("*, vistoria_orcamentos(*, prestador:pessoas(id, nome, telefone))")
    .eq("vistoria_id", vistoriaId)
    .order("created_at");
  return (data ?? []) as unknown as Pendencia[];
}

/** Locatários do contrato e proprietários do imóvel (para o laudo e as assinaturas). */
export async function partesDaVistoria(sb: Supabase, v: Pick<Vistoria, "contrato_id" | "imovel_id">) {
  type P = { id: string; nome: string; documento: string | null; telefone: string | null; email: string | null };
  const [cp, ip] = await Promise.all([
    v.contrato_id ? sb.from("contrato_partes").select("papel, pessoa:pessoas(id, nome, documento, telefone, email)").eq("contrato_id", v.contrato_id) : Promise.resolve({ data: [] }),
    sb.from("imovel_proprietarios").select("pessoa:pessoas(id, nome, documento, telefone, email)").eq("imovel_id", v.imovel_id),
  ]);
  const partes = (cp.data ?? []) as unknown as { papel: string; pessoa: P | null }[];
  const locatarios = partes.filter((p) => p.papel === "locatario" && p.pessoa).map((p) => p.pessoa!);
  const doContrato = partes.filter((p) => p.papel === "proprietario" && p.pessoa).map((p) => p.pessoa!);
  const doImovel = ((ip.data ?? []) as unknown as { pessoa: P | null }[]).filter((p) => p.pessoa).map((p) => p.pessoa!);
  return { locatarios, proprietarios: doContrato.length ? doContrato : doImovel };
}

/**
 * Opções dos filtros e da nova vistoria. Imóveis inativos ficam de fora,
 * menos os pedidos em "incluir" (ex.: o histórico de um imóvel inativo).
 */
export async function carregarOpcoesVistoria(sb: Supabase, pessoal: boolean, incluir: string[] = []) {
  const extras = incluir.filter(Boolean);
  const [imoveis, contratos, vistoriadores, inativos] = await Promise.all([
    sb.from("imoveis").select("id, codigo, logradouro, numero").neq("status", "inativo").order("codigo").limit(3000),
    sb.from("contratos").select("id, numero, status, imovel_id, imovel:imoveis(codigo)").in("status", ["ativo", "rascunho", "encerrado", "rescindido"]).order("numero", { ascending: false }).limit(3000),
    pessoal ? Promise.resolve({ data: [] }) : sb.from("pessoas").select("id, nome").overlaps("papeis", ["corretor", "prestador", "parceiro"]).order("nome"),
    extras.length ? sb.from("imoveis").select("id, codigo, logradouro, numero").in("id", extras) : Promise.resolve({ data: [] }),
  ]);
  type Im = { id: string; codigo: string; logradouro: string | null; numero: string | null };
  const lista = (imoveis.data ?? []) as Im[];
  for (const i of (inativos.data ?? []) as Im[]) if (!lista.some((x) => x.id === i.id)) lista.push(i);
  return {
    imoveis: lista,
    contratos: (contratos.data ?? []) as unknown as { id: string; numero: number; status: string; imovel_id: string; imovel: { codigo: string } | null }[],
    vistoriadores: (vistoriadores.data ?? []) as OpcaoNome[],
  };
}
