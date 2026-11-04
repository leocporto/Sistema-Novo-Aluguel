"use server";

import { revalidatePath } from "next/cache";
import { obterContexto } from "@/lib/contexto";
import { type EstadoAcao, ErroValidacao, mensagemErro, texto, textoObrigatorio } from "@/lib/form";

type Resultado = { ok: boolean; erro?: string };

function bloquearPessoal(modo: string) {
  if (modo === "pessoal") throw new ErroValidacao("O portal do corretor só existe no modo imobiliária.");
}

/** Registra contato com o lead (o banco confere que o lead é do corretor). */
export async function registrarContatoCorretor(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase, organizacao } = await obterContexto();
  try {
    bloquearPessoal(organizacao.modo);
    const { error } = await supabase.rpc("corretor_registrar_contato", {
      p_lead: textoObrigatorio(fd, "lead_id", "o lead"),
      p: { tipo: texto(fd, "tipo") ?? "nota", descricao: textoObrigatorio(fd, "descricao", "o que foi conversado"), proximo_contato: texto(fd, "proximo_contato") },
    });
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidatePath("/corretor", "layout");
  revalidatePath("/comercial", "layout");
  return { ok: "Contato registrado." };
}

/** Liga o usuário do sistema ao cadastro de corretor (só administrador e gestor; o banco confere). */
export async function ligarUsuarioCorretor(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase, organizacao } = await obterContexto();
  try {
    bloquearPessoal(organizacao.modo);
    const { error } = await supabase.rpc("ligar_membro_pessoa", { p_user: textoObrigatorio(fd, "user_id", "o usuário"), p_pessoa: texto(fd, "pessoa_id") });
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidatePath("/corretor", "layout");
  return { ok: "Salvo." };
}

/** Registra o documento que o navegador já enviou para corretores/<org>/<corretor>/ (RLS: o corretor só na pasta dele). */
export async function registrarDocumentoCorretor(d: { corretor_id: string; titulo: string; categoria: string; path: string; nome: string; lead_id?: string | null }): Promise<Resultado> {
  const { supabase, organizacao } = await obterContexto();
  try {
    bloquearPessoal(organizacao.modo);
    if (!d.titulo.trim()) throw new ErroValidacao("Dê um nome ao documento.");
    const { error } = await supabase.from("corretor_documentos").insert({
      corretor_id: d.corretor_id,
      titulo: d.titulo.slice(0, 160),
      categoria: ["pessoal", "cliente", "imovel", "proposta", "outro"].includes(d.categoria) ? d.categoria : "outro",
      path: d.path,
      nome: d.nome.slice(0, 160),
      lead_id: d.lead_id || null,
    });
    if (error) {
      await supabase.storage.from("corretores").remove([d.path]);
      throw error;
    }
  } catch (e) {
    return { ok: false, erro: mensagemErro(e) };
  }
  revalidatePath("/corretor/documentos");
  return { ok: true };
}

export async function excluirDocumentoCorretor(id: string): Promise<Resultado> {
  const { supabase } = await obterContexto();
  const { data } = await supabase.from("corretor_documentos").select("path").eq("id", id).maybeSingle();
  if (!data) return { ok: false, erro: "Documento não encontrado." };
  const { error } = await supabase.from("corretor_documentos").delete().eq("id", id);
  if (error) return { ok: false, erro: mensagemErro(error) };
  await supabase.storage.from("corretores").remove([data.path as string]);
  revalidatePath("/corretor/documentos");
  return { ok: true };
}
