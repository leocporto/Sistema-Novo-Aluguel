import "server-only";
import { headers } from "next/headers";
import type { obterContexto } from "@/lib/contexto";
import type { PerfilPortal } from "@/lib/dominio/portal";

type Supabase = Awaited<ReturnType<typeof obterContexto>>["supabase"];
export type Opcao = { id: string; nome: string };

export type Acesso = {
  id: string;
  pessoa_id: string;
  perfil: PerfilPortal;
  token: string;
  ativo: boolean;
  expira_em: string | null;
  ultimo_acesso: string | null;
  acessos: number;
  bloqueado_ate: string | null;
  revogado_em: string | null;
  created_at: string;
  pessoa: { id: string; nome: string; telefone: string | null; email: string | null; documento: string | null } | null;
};

export const SELECT_ACESSO = "id, pessoa_id, perfil, token, ativo, expira_em, ultimo_acesso, acessos, bloqueado_ate, revogado_em, created_at, pessoa:pessoas(id, nome, telefone, email, documento)";

/** Endereço do sistema (para montar o link do portal). */
export async function urlBase(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  return `${host.startsWith("localhost") ? "http" : "https"}://${host}`;
}

/**
 * Quem pode receber link de cada perfil: proprietários (dono de imóvel ou com
 * o papel), locatários de contrato (ativo ou não) e prestadores de serviço.
 */
export async function pessoasDoPerfil(supabase: Supabase): Promise<Record<PerfilPortal, Opcao[]>> {
  const [{ data: donos }, { data: partes }, { data: papeis }] = await Promise.all([
    supabase.from("imovel_proprietarios").select("pessoa:pessoas(id, nome)").limit(5000),
    supabase.from("contrato_partes").select("pessoa:pessoas(id, nome)").eq("papel", "locatario").limit(5000),
    supabase.from("pessoas").select("id, nome, papeis").overlaps("papeis", ["proprietario", "locatario", "prestador"]).order("nome").limit(5000),
  ]);
  const juntar = (lista: (Opcao | null)[]) => [...new Map(lista.filter((p): p is Opcao => Boolean(p)).map((p) => [p.id, p])).values()].sort((a, b) => a.nome.localeCompare(b.nome));
  const pessoa = (x: { pessoa: unknown }) => x.pessoa as Opcao | null;
  const comPapel = (papel: string) => (papeis ?? []).filter((p) => (p.papeis as string[]).includes(papel)).map((p) => ({ id: p.id as string, nome: p.nome as string }));
  return {
    proprietario: juntar([...(donos ?? []).map(pessoa), ...comPapel("proprietario")]),
    locatario: juntar([...(partes ?? []).map(pessoa), ...comPapel("locatario")]),
    prestador: juntar(comPapel("prestador")),
  };
}

export type ArquivoCandidato = { chave: string; bucket: string; path: string; titulo: string; grupo: string };

/**
 * Arquivos que a equipe pode compartilhar no portal desta pessoa (link
 * assinado com validade): documentos dela e dos contratos/imóveis ligados,
 * comprovantes de repasse (proprietário) e de pagamento (locatário) e fotos
 * dos chamados (prestador).
 */
export async function arquivosParaCompartilhar(supabase: Supabase, a: { pessoa_id: string; perfil: PerfilPortal }): Promise<ArquivoCandidato[]> {
  const out: ArquivoCandidato[] = [];
  const add = (bucket: string, path: string | null | undefined, titulo: string, grupo: string) => {
    if (path) out.push({ chave: `${bucket}|${path}`, bucket, path, titulo: titulo.slice(0, 160), grupo });
  };
  const { data: arquivosPessoa } = await supabase.from("pessoa_arquivos").select("path, nome, categoria").eq("pessoa_id", a.pessoa_id).order("created_at", { ascending: false }).limit(100);
  for (const f of arquivosPessoa ?? []) add("pessoas", f.path as string, `${f.categoria}: ${f.nome ?? "arquivo"}`, "Documentos da pessoa");

  const papel = a.perfil === "proprietario" ? "proprietario" : "locatario";
  const { data: partes } = a.perfil === "prestador" ? { data: [] } : await supabase.from("contrato_partes").select("contrato_id").eq("pessoa_id", a.pessoa_id).eq("papel", papel);
  const contratos = (partes ?? []).map((p) => p.contrato_id as string);
  const { data: donos } = a.perfil === "proprietario" ? await supabase.from("imovel_proprietarios").select("imovel_id").eq("pessoa_id", a.pessoa_id) : { data: [] };
  const imoveis = (donos ?? []).map((d) => d.imovel_id as string);

  const filtros = [`pessoa_id.eq.${a.pessoa_id}`];
  if (contratos.length) filtros.push(`contrato_id.in.(${contratos.join(",")})`);
  if (imoveis.length) filtros.push(`imovel_id.in.(${imoveis.join(",")})`);
  if (a.perfil !== "prestador") {
    const { data: docs } = await supabase.from("documentos").select("titulo, arquivo_path, arquivo_nome, tipo").not("arquivo_path", "is", null).eq("restrito", false).or(filtros.join(",")).limit(100);
    for (const d of docs ?? []) {
      if (a.perfil === "locatario" && ["venda", "administracao", "intermediacao", "exclusividade", "autorizacao", "proposta"].includes(d.tipo as string)) continue;
      add("documentos", d.arquivo_path as string, `${d.titulo}${d.arquivo_nome ? ` (${d.arquivo_nome})` : ""}`, "Documentos e contratos");
    }
  }
  if (a.perfil === "proprietario") {
    const { data: reps } = await supabase.from("repasses").select("competencia, comprovante_path").eq("pessoa_id", a.pessoa_id).not("comprovante_path", "is", null).order("competencia", { ascending: false }).limit(24);
    for (const r of reps ?? []) add("comprovantes", r.comprovante_path as string, `Comprovante do repasse ${String(r.competencia).slice(5, 7)}/${String(r.competencia).slice(0, 4)}`, "Comprovantes de repasse");
  }
  if (a.perfil === "locatario" && contratos.length) {
    const { data: pags } = await supabase
      .from("fatura_pagamentos")
      .select("pago_em, comprovante_path, fatura:faturas!inner(numero, contrato_id)")
      .in("fatura.contrato_id", contratos)
      .not("comprovante_path", "is", null)
      .order("pago_em", { ascending: false })
      .limit(24);
    for (const p of pags ?? []) add("comprovantes", p.comprovante_path as string, `Comprovante de pagamento de ${String(p.pago_em).split("-").reverse().join("/")}`, "Comprovantes de pagamento");
  }
  if (a.perfil === "prestador") {
    const { data: chamados } = await supabase.from("chamados").select("id, numero").eq("prestador_id", a.pessoa_id).order("created_at", { ascending: false }).limit(20);
    const ids = (chamados ?? []).map((c) => c.id as string);
    const numero = new Map((chamados ?? []).map((c) => [c.id as string, c.numero as number]));
    const { data: midias } = ids.length ? await supabase.from("chamado_midias").select("chamado_id, path, nome, momento").in("chamado_id", ids).order("created_at", { ascending: false }).limit(100) : { data: [] };
    for (const m of midias ?? []) add("manutencao", m.path as string, `Chamado nº ${numero.get(m.chamado_id as string)}: ${m.nome || "foto"} (${m.momento})`, "Fotos dos chamados");
  }
  return out;
}
