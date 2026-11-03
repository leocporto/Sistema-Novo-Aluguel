import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { obterContexto } from "@/lib/contexto";
import { formatarDataBR } from "@/lib/dominio/datas";
import { ROTULO_TIPO_VISTORIA } from "@/lib/dominio/vistorias";
import { carregarAmbientes, carregarMedidores, carregarVistoria, enderecoImovel } from "../../dados";
import { AppCampo } from "./app-campo";

export const metadata: Metadata = { title: "Vistoria em campo" };

/** App de campo (celular): a tela carrega tudo e depois funciona sem internet. */
export default async function CampoVistoria({ params }: PageProps<"/vistorias/campo/[id]">) {
  const { id } = await params;
  const { supabase, organizacao } = await obterContexto();
  const v = await carregarVistoria(supabase, id);
  if (!v) notFound();
  const [ambientes, medidores, { data: midias }] = await Promise.all([
    carregarAmbientes(supabase, id),
    carregarMedidores(supabase, id),
    supabase.from("vistoria_midias").select("ambiente_id, item_id, medidor_id").eq("vistoria_id", id),
  ]);
  const fotos: Record<string, number> = {};
  for (const m of (midias ?? []) as { ambiente_id: string | null; item_id: string | null; medidor_id: string | null }[]) {
    const k = m.medidor_id ? `m:${m.medidor_id}` : (m.ambiente_id ?? "geral");
    fotos[k] = (fotos[k] ?? 0) + 1;
    if (m.item_id) fotos[`i:${m.item_id}`] = (fotos[`i:${m.item_id}`] ?? 0) + 1;
  }

  return (
    <AppCampo
      vistoriaId={id}
      organizacaoId={organizacao.id}
      titulo={`Vistoria de ${ROTULO_TIPO_VISTORIA[v.tipo].toLowerCase()} · ${v.imovel?.codigo ?? ""}`}
      subtitulo={[enderecoImovel(v.imovel), formatarDataBR(v.data)].filter(Boolean).join(" · ")}
      statusInicial={v.status}
      ambientes={ambientes.map((a) => ({ id: a.id, nome: a.nome, tipo: a.tipo, observacoes: a.observacoes, itens: a.vistoria_itens.map((i) => ({ id: i.id, nome: i.nome, estado: i.estado, observacao: i.observacao })) }))}
      medidores={medidores.map((m) => ({ id: m.id, tipo: m.tipo, numero: m.numero, leitura: m.leitura }))}
      fotos={fotos}
    />
  );
}
