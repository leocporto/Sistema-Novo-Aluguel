import "server-only";
import { somarDias, somarMeses } from "@/lib/dominio/datas";
import { somenteDigitos } from "@/lib/dominio/documentos";
import type { ContratoImportado } from "@/lib/dominio/integracoes";
import type { ModoUso } from "@/lib/modos";
import { todas } from "../financeiro/dados";
import type { Supabase } from "./dados";

/*
 * Importação de contratos de outro sistema: liga cada linha ao imóvel (pelo
 * código) e às pessoas (pelo CPF/CNPJ) já cadastrados e confere as regras do
 * cadastro de contrato (proprietários somando 100% na imobiliária, um contrato
 * ativo por imóvel no período).
 */

type ImovelRef = { id: string; codigo: string | null };
type PessoaRef = { id: string; documento: string | null; papeis: string[] };
type PropRef = { imovel_id: string; pessoa_id: string; percentual: number };
type AtivoRef = { imovel_id: string; data_inicio: string; data_fim: string | null; data_rescisao: string | null; numero: number };

export type Referencias = {
  imovelPorCodigo: Map<string, string>;
  pessoaPorDocumento: Map<string, PessoaRef>;
  proprietarios: Map<string, PropRef[]>;
  ativos: Map<string, AtivoRef[]>;
  codigosContrato: Set<string>;
};

export async function carregarReferencias(supabase: Supabase): Promise<Referencias> {
  const [imoveis, pessoas, props, ativos, codigos] = await Promise.all([
    todas<ImovelRef>(() => supabase.from("imoveis").select("id, codigo").order("id")),
    todas<PessoaRef>(() => supabase.from("pessoas").select("id, documento, papeis").not("documento", "is", null).order("id")),
    todas<PropRef>(() => supabase.from("imovel_proprietarios").select("imovel_id, pessoa_id, percentual").order("imovel_id").order("pessoa_id")),
    todas<AtivoRef>(() => supabase.from("contratos").select("imovel_id, data_inicio, data_fim, data_rescisao, numero").eq("status", "ativo").order("id")),
    todas<{ codigo: string | null }>(() => supabase.from("contratos").select("codigo").not("codigo", "is", null).order("id")),
  ]);
  const imovelPorCodigo = new Map<string, string>();
  for (const i of imoveis) if (i.codigo) imovelPorCodigo.set(i.codigo.trim().toLowerCase(), i.id);
  const pessoaPorDocumento = new Map<string, PessoaRef>();
  for (const p of pessoas) {
    const d = somenteDigitos(p.documento);
    if (d && !pessoaPorDocumento.has(d)) pessoaPorDocumento.set(d, p);
  }
  const proprietarios = new Map<string, PropRef[]>();
  for (const p of props) proprietarios.set(p.imovel_id, [...(proprietarios.get(p.imovel_id) ?? []), { ...p, percentual: Number(p.percentual) }]);
  const ativosMap = new Map<string, AtivoRef[]>();
  for (const a of ativos) ativosMap.set(a.imovel_id, [...(ativosMap.get(a.imovel_id) ?? []), a]);
  return {
    imovelPorCodigo,
    pessoaPorDocumento,
    proprietarios,
    ativos: ativosMap,
    codigosContrato: new Set(codigos.map((c) => (c.codigo ?? "").trim().toLowerCase()).filter(Boolean)),
  };
}

export const fimDoContrato = (d: ContratoImportado) => d.data_fim ?? somarDias(somarMeses(d.data_inicio, d.prazo_meses), -1);

export type LinhaConferida = {
  erros: string[];
  imovelId: string | null;
  locatarioId: string | null;
  fiadorId: string | null;
  proprietarios: PropRef[];
};

/** Confere uma linha já validada (formato) contra o cadastro. */
export function conferirLinha(d: ContratoImportado, refs: Referencias, modo: ModoUso): LinhaConferida {
  const erros: string[] = [];
  const imovelId = refs.imovelPorCodigo.get(d.imovel_codigo.trim().toLowerCase()) ?? null;
  if (!imovelId) erros.push(`imóvel ${d.imovel_codigo} não cadastrado`);
  const loc = refs.pessoaPorDocumento.get(d.locatario_documento) ?? null;
  if (!loc) erros.push("locatário não cadastrado (importe as pessoas antes)");
  const fia = d.fiador_documento ? (refs.pessoaPorDocumento.get(d.fiador_documento) ?? null) : null;
  if (d.fiador_documento && !fia) erros.push("fiador não cadastrado");
  const props = imovelId ? (refs.proprietarios.get(imovelId) ?? []) : [];
  if (imovelId && modo !== "pessoal") {
    if (!props.length) erros.push("imóvel sem proprietário vinculado");
    else {
      const soma = props.reduce((s, p) => s + p.percentual, 0);
      if (Math.abs(soma - 100) > 0.01) erros.push(`proprietários do imóvel somam ${soma}%`);
    }
  }
  if (imovelId && d.status === "ativo") {
    const fim = fimDoContrato(d);
    const choque = (refs.ativos.get(imovelId) ?? []).find((a) => a.data_inicio <= fim && (a.data_rescisao ?? a.data_fim ?? "9999-12-31") >= d.data_inicio);
    if (choque) erros.push(`imóvel já tem o contrato ativo #${choque.numero} no mesmo período`);
  }
  if (d.codigo && refs.codigosContrato.has(d.codigo.trim().toLowerCase())) erros.push(`já existe contrato com o código ${d.codigo}`);
  return { erros, imovelId, locatarioId: loc?.id ?? null, fiadorId: fia?.id ?? null, proprietarios: props };
}
