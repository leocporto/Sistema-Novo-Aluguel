import "server-only";
import { NOMES_MES } from "@/components/navegador-mes";
import type { obterContexto } from "@/lib/contexto";
import { hojeISO } from "@/lib/dominio/datas";
import { compararVistorias, valorPendencia, type DadosLaudo } from "@/lib/dominio/vistorias";
import type { Organizacao } from "@/lib/tipos";
import { carregarAmbientes, carregarMedidores, carregarPendencias, enderecoImovel, partesDaVistoria, quemFez, type Vistoria } from "./dados";

type Supabase = Awaited<ReturnType<typeof obterContexto>>["supabase"];

export function dataPorExtenso(iso: string) {
  const [a, m, d] = iso.split("-").map(Number);
  return `${d} de ${NOMES_MES[m - 1]} de ${a}`;
}

/** Junta tudo o que vai no laudo (texto para assinatura e página de impressão). */
export async function dadosDoLaudo(sb: Supabase, v: Vistoria, org: Organizacao): Promise<DadosLaudo> {
  const pessoal = org.modo === "pessoal";
  const [ambientes, medidores, pendencias, partes, { data: midias }, ref] = await Promise.all([
    carregarAmbientes(sb, v.id),
    carregarMedidores(sb, v.id),
    carregarPendencias(sb, v.id),
    partesDaVistoria(sb, v),
    sb.from("vistoria_midias").select("tipo").eq("vistoria_id", v.id),
    v.referencia_id ? sb.from("vistorias").select("numero").eq("id", v.referencia_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const nomeAmb = new Map(ambientes.map((a) => [a.id, a.nome]));
  let comparacao: DadosLaudo["comparacao"] = null;
  if (v.referencia_id && ref.data) {
    const antes = await carregarAmbientes(sb, v.referencia_id);
    const r = compararVistorias(
      antes.map((a) => ({ nome: a.nome, itens: a.vistoria_itens })),
      ambientes.map((a) => ({ nome: a.nome, itens: a.vistoria_itens })),
    );
    comparacao = { referencia: Number(ref.data.numero), pioraram: r.linhas.filter((l) => l.situacao === "piorou") };
  }
  const tipos = (midias ?? []) as { tipo: string }[];
  return {
    numero: v.numero,
    tipo: v.tipo,
    data: v.data,
    imovel: { codigo: v.imovel?.codigo ?? "", endereco: enderecoImovel(v.imovel), cidade: v.imovel?.cidade ?? null },
    contratoNumero: v.contrato?.numero ?? null,
    locatarios: partes.locatarios.map((p) => p.nome),
    locadores: pessoal ? [org.nome] : partes.proprietarios.map((p) => p.nome),
    responsavel: quemFez(v) ?? (pessoal ? org.nome : null),
    acompanhante: v.acompanhante,
    organizacao: org.nome,
    ambientes: ambientes.map((a) => ({ nome: a.nome, observacoes: a.observacoes, itens: a.vistoria_itens })),
    medidores,
    pendencias: pendencias
      .filter((p) => p.status !== "cancelada")
      .map((p) => ({
        descricao: p.descricao,
        ambiente: p.ambiente_id ? (nomeAmb.get(p.ambiente_id) ?? null) : null,
        responsavel: pessoal && p.responsavel === "imobiliaria" ? "proprietario" : p.responsavel,
        valor: valorPendencia({ ...p, orcamentos: p.vistoria_orcamentos }),
      })),
    fotos: tipos.filter((m) => m.tipo === "foto").length,
    videos: tipos.filter((m) => m.tipo === "video").length,
    comparacao,
    observacoes: v.observacoes,
    conclusao: v.conclusao,
    contestacaoAte: v.contestacao_ate,
    dataExtenso: dataPorExtenso(hojeISO()),
  };
}
