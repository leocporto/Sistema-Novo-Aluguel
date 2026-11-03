"use server";

import { revalidatePath } from "next/cache";
import { obterContexto } from "@/lib/contexto";
import { type EstadoAcao, ErroValidacao, inteiro, mensagemErro, texto, textoObrigatorio } from "@/lib/form";
import { instante } from "@/lib/dominio/agenda";

type Resultado = { ok: boolean; erro?: string };

function revalidar() {
  revalidatePath("/chaves", "layout");
  revalidatePath("/agenda", "layout");
  revalidatePath("/imoveis", "layout");
  revalidatePath("/");
}

export async function cadastrarChave(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  try {
    const codigo = textoObrigatorio(fd, "codigo", "o código").toUpperCase();
    const { error } = await supabase.from("chaves").insert({
      imovel_id: textoObrigatorio(fd, "imovel_id", "o imóvel"),
      codigo,
      identificacao: texto(fd, "identificacao") ?? "Chave",
      local: texto(fd, "local"),
      quantidade: Math.max(1, inteiro(fd, "quantidade") ?? 1),
      responsavel_id: texto(fd, "responsavel_id"),
      observacoes: texto(fd, "observacoes"),
    });
    if (error) throw error.code === "23505" ? new ErroValidacao(`Já existe uma chave com o código ${codigo}.`) : error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Chave cadastrada." };
}

export async function atualizarChave(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  try {
    const d: Record<string, unknown> = {};
    if (fd.has("codigo")) d.codigo = textoObrigatorio(fd, "codigo", "o código").toUpperCase();
    for (const c of ["identificacao", "local", "responsavel_id", "observacoes"]) if (fd.has(c)) d[c] = texto(fd, c);
    if (fd.has("identificacao") && !d.identificacao) d.identificacao = "Chave";
    if (fd.has("quantidade")) d.quantidade = Math.max(1, inteiro(fd, "quantidade") ?? 1);
    const { error } = await supabase.from("chaves").update(d).eq("id", String(fd.get("id")));
    if (error) throw error.code === "23505" ? new ErroValidacao("Já existe outra chave com esse código.") : error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Salvo." };
}

export async function retirarChave(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  try {
    const chave_id = textoObrigatorio(fd, "chave_id");
    const pessoa_id = texto(fd, "pessoa_id");
    let retirada_por = texto(fd, "retirada_por");
    if (pessoa_id) {
      const { data } = await supabase.from("pessoas").select("nome").eq("id", pessoa_id).single();
      retirada_por = data?.nome ?? retirada_por;
    }
    if (!retirada_por) throw new ErroValidacao("Diga quem está retirando a chave.");
    const data = texto(fd, "previsao_data");
    const visita_id = texto(fd, "visita_id");
    const { error } = await supabase.from("chave_movimentacoes").insert({
      chave_id,
      pessoa_id,
      retirada_por,
      motivo: texto(fd, "motivo"),
      visita_id,
      previsao_devolucao: data ? instante(data, texto(fd, "previsao_hora") ?? "18:00") : null,
    });
    if (error) throw error.code === "23505" ? new ErroValidacao("Esta chave já está retirada. Registre a devolução antes.") : error;
    if (visita_id) {
      const { data: c } = await supabase.from("chaves").select("codigo").eq("id", chave_id).single();
      await supabase.from("visita_eventos").insert({ visita_id, tipo: "chave", descricao: `Chave ${c?.codigo ?? ""} retirada por ${retirada_por}` });
    }
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Retirada registrada." };
}

export async function devolverChave(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  try {
    const id = textoObrigatorio(fd, "mov_id");
    const { data: m, error } = await supabase
      .from("chave_movimentacoes")
      .update({ devolvida_em: new Date().toISOString(), observacao_devolucao: texto(fd, "observacao_devolucao") })
      .eq("id", id)
      .select("visita_id, retirada_por, chave:chaves(codigo)")
      .single();
    if (error) throw error;
    if (m?.visita_id)
      await supabase.from("visita_eventos").insert({ visita_id: m.visita_id, tipo: "chave", descricao: `Chave ${(m.chave as unknown as { codigo: string } | null)?.codigo ?? ""} devolvida` });
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Devolução registrada." };
}

export async function excluirChave(id: string): Promise<Resultado> {
  const { supabase } = await obterContexto();
  const { error } = await supabase.from("chaves").delete().eq("id", id);
  if (error) return { ok: false, erro: mensagemErro(error) };
  revalidar();
  return { ok: true };
}

/** Apaga um registro de retirada feito por engano. */
export async function excluirMovimentacao(id: string): Promise<Resultado> {
  const { supabase } = await obterContexto();
  const { error } = await supabase.from("chave_movimentacoes").delete().eq("id", id);
  if (error) return { ok: false, erro: mensagemErro(error) };
  revalidar();
  return { ok: true };
}
