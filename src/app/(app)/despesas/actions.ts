"use server";

import { revalidatePath } from "next/cache";
import { obterContexto } from "@/lib/contexto";
import { hojeISO, somarMeses } from "@/lib/dominio/datas";
import { type EstadoAcao, ErroValidacao, booleano, inteiro, mensagemErro, numero, texto, textoObrigatorio } from "@/lib/form";

function revalidar() {
  revalidatePath("/despesas");
  revalidatePath("/financeiro");
  revalidatePath("/");
}

function lerDespesa(fd: FormData, pessoal: boolean) {
  const valor = numero(fd, "valor");
  if (!valor || valor <= 0) throw new ErroValidacao("Informe o valor.");
  const imovel_id = texto(fd, "imovel_id");
  if (pessoal && !imovel_id) throw new ErroValidacao("Escolha o imóvel da despesa.");
  return {
    descricao: textoObrigatorio(fd, "descricao", "a descrição"),
    categoria: texto(fd, "categoria") ?? "Outros",
    valor,
    vencimento: textoObrigatorio(fd, "vencimento", "o vencimento"),
    imovel_id,
  };
}

export async function criarDespesa(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase, organizacao } = await obterContexto();
  try {
    const base = lerDespesa(fd, organizacao.modo === "pessoal");
    const repetir = texto(fd, "repetir") === "mensal";
    const vezes = repetir ? (inteiro(fd, "meses") ?? 12) : 1;
    if (vezes < 1 || vezes > 60) throw new ErroValidacao("Repita entre 1 e 60 meses.");
    const serie_id = vezes > 1 ? crypto.randomUUID() : null;
    const pago = booleano(fd, "pago");
    const linhas = Array.from({ length: vezes }, (_, i) => ({
      ...base,
      tipo: "pagar" as const,
      vencimento: somarMeses(base.vencimento, i),
      descricao: vezes > 1 ? `${base.descricao} (${i + 1}/${vezes})` : base.descricao,
      serie_id,
      status: pago && i === 0 ? "liquidado" : "aberto",
      liquidado_em: pago && i === 0 ? hojeISO() : null,
    }));
    const { error } = await supabase.from("lancamentos").insert(linhas);
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Despesa lançada." };
}

export async function atualizarDespesa(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase, organizacao } = await obterContexto();
  try {
    const { error } = await supabase
      .from("lancamentos")
      .update(lerDespesa(fd, organizacao.modo === "pessoal"))
      .eq("id", String(fd.get("id")))
      .eq("tipo", "pagar");
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Despesa salva." };
}

export async function marcarDespesaPaga(id: string, pago: boolean): Promise<{ ok: boolean; erro?: string }> {
  const { supabase } = await obterContexto();
  const { error } = await supabase
    .from("lancamentos")
    .update(pago ? { status: "liquidado", liquidado_em: hojeISO() } : { status: "aberto", liquidado_em: null })
    .eq("id", id)
    .eq("tipo", "pagar");
  if (error) return { ok: false, erro: mensagemErro(error) };
  revalidar();
  return { ok: true };
}

export async function excluirDespesa(id: string, proximas: boolean): Promise<{ ok: boolean; erro?: string }> {
  const { supabase } = await obterContexto();
  const { data: d } = await supabase.from("lancamentos").select("serie_id, vencimento").eq("id", id).maybeSingle();
  const r =
    proximas && d?.serie_id
      ? await supabase.from("lancamentos").delete().eq("serie_id", d.serie_id).gte("vencimento", d.vencimento).eq("tipo", "pagar")
      : await supabase.from("lancamentos").delete().eq("id", id).eq("tipo", "pagar");
  if (r.error) return { ok: false, erro: mensagemErro(r.error) };
  revalidar();
  return { ok: true };
}

export async function salvarComprovanteDespesa(id: string, caminho: string): Promise<{ ok: boolean; erro?: string }> {
  const { supabase, organizacao } = await obterContexto();
  if (!caminho.startsWith(`${organizacao.id}/despesas/${id}/`)) return { ok: false, erro: "Caminho de comprovante inválido." };
  const { error } = await supabase.from("lancamentos").update({ comprovante_path: caminho }).eq("id", id);
  if (error) return { ok: false, erro: mensagemErro(error) };
  revalidar();
  return { ok: true };
}

export async function linkComprovanteDespesa(id: string): Promise<{ ok: boolean; url?: string; erro?: string }> {
  const { supabase } = await obterContexto();
  const { data: l } = await supabase.from("lancamentos").select("comprovante_path").eq("id", id).maybeSingle();
  if (!l?.comprovante_path) return { ok: false, erro: "Esta despesa não tem comprovante." };
  const { data, error } = await supabase.storage.from("comprovantes").createSignedUrl(l.comprovante_path as string, 300);
  if (error || !data) return { ok: false, erro: "Não foi possível abrir o comprovante." };
  return { ok: true, url: data.signedUrl };
}
