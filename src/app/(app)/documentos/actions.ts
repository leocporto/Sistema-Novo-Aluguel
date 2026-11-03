"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { obterContexto } from "@/lib/contexto";
import { type EstadoAcao, ErroValidacao, booleano, inteiro, lista, mensagemErro, texto, textoObrigatorio } from "@/lib/form";
import { CHECKLIST_DOCUMENTO, ROTULO_STATUS_DOCUMENTO, TIPOS_DOC_SO_IMOBILIARIA, preencherModelo } from "@/lib/dominio/modelos";
import { MODELOS_PADRAO } from "@/lib/dominio/modelos-padrao";
import { dadosDoDocumento, signatariosSugeridos, type Vinculos } from "@/lib/servicos/documentos";

type Supabase = Awaited<ReturnType<typeof obterContexto>>["supabase"];
type Resultado = { ok: boolean; erro?: string; url?: string };

function revalidar(id?: string) {
  revalidatePath("/documentos", "layout");
  if (id) revalidatePath(`/documentos/${id}`);
  revalidatePath("/");
}

async function evento(supabase: Supabase, documentoId: string, tipo: string, descricao: string) {
  await supabase.from("documento_eventos").insert({ documento_id: documentoId, tipo, descricao });
}

const podeAprovar = (papel: string) => papel === "admin" || papel === "gestor";

function lerVinculos(fd: FormData): Vinculos {
  return {
    imovel_id: texto(fd, "imovel_id"),
    pessoa_id: texto(fd, "pessoa_id"),
    contrato_id: texto(fd, "contrato_id"),
    venda_id: texto(fd, "venda_id"),
    captacao_id: texto(fd, "captacao_id"),
  };
}

// Modelos ------------------------------------------------------------------------
/** Coloca na conta os modelos-base que ainda não existem (respeitando o modo). */
export async function instalarModelosPadrao(): Promise<Resultado> {
  const { supabase, organizacao } = await obterContexto();
  const { data } = await supabase.from("documento_modelos").select("padrao_sistema");
  const ja = new Set((data ?? []).map((m) => m.padrao_sistema));
  const novos = MODELOS_PADRAO.filter((m) => !ja.has(m.chave) && !(organizacao.modo === "pessoal" && TIPOS_DOC_SO_IMOBILIARIA.includes(m.tipo))).map((m) => ({
    nome: m.nome,
    tipo: m.tipo,
    conteudo: m.conteudo,
    padrao_sistema: m.chave,
  }));
  if (novos.length) {
    const { error } = await supabase.from("documento_modelos").insert(novos);
    if (error) return { ok: false, erro: mensagemErro(error) };
  }
  revalidar();
  return { ok: true };
}

export async function criarModelo(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  let id: string;
  try {
    let conteudo = "";
    const base = texto(fd, "base");
    if (base) {
      const { data } = await supabase.from("documento_modelos").select("conteudo").eq("id", base).maybeSingle();
      conteudo = data?.conteudo ?? "";
    }
    const { data, error } = await supabase
      .from("documento_modelos")
      .insert({ nome: textoObrigatorio(fd, "nome", "o nome do modelo"), tipo: texto(fd, "tipo") ?? "outro", conteudo })
      .select("id")
      .single();
    if (error) throw error;
    id = data.id;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  redirect(`/documentos/modelos/${id}`);
}

export async function atualizarModelo(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  try {
    const d: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (fd.has("nome")) d.nome = textoObrigatorio(fd, "nome", "o nome");
    if (fd.has("tipo")) d.tipo = texto(fd, "tipo") ?? "outro";
    if (fd.has("conteudo")) d.conteudo = String(fd.get("conteudo") ?? "");
    if (fd.has("_ativo")) d.ativo = booleano(fd, "ativo");
    const { error } = await supabase.from("documento_modelos").update(d).eq("id", String(fd.get("id")));
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Modelo salvo." };
}

export async function excluirModelo(id: string): Promise<Resultado> {
  const { supabase } = await obterContexto();
  const { error } = await supabase.from("documento_modelos").delete().eq("id", id);
  if (error) return { ok: false, erro: mensagemErro(error) };
  revalidar();
  return { ok: true };
}

// Documentos ------------------------------------------------------------------------
/** Gera o documento a partir do modelo, já preenchido com os dados do sistema. */
export async function gerarDocumento(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase, organizacao } = await obterContexto();
  let id: string;
  try {
    const modeloId = texto(fd, "modelo_id");
    const v = lerVinculos(fd);
    let conteudo = "";
    let tipo = texto(fd, "tipo") ?? "outro";
    let titulo = texto(fd, "titulo");
    if (modeloId) {
      const { data: m, error } = await supabase.from("documento_modelos").select("nome, tipo, conteudo").eq("id", modeloId).single();
      if (error) throw error;
      conteudo = preencherModelo(m.conteudo, await dadosDoDocumento(supabase, v, organizacao));
      tipo = m.tipo;
      titulo = titulo ?? m.nome;
    }
    if (!titulo) throw new ErroValidacao("Dê um título ou escolha um modelo.");
    const { data, error } = await supabase
      .from("documentos")
      .insert({ ...v, titulo, tipo, modelo_id: modeloId, conteudo, validade: texto(fd, "validade"), restrito: booleano(fd, "restrito") })
      .select("id")
      .single();
    if (error) throw error;
    id = data.id;
    await supabase.from("documento_versoes").insert({ documento_id: id, versao: 1, conteudo, observacao: modeloId ? "Gerado pelo modelo" : "Criado em branco" });
    await evento(supabase, id, "criado", `Documento criado${modeloId ? " a partir do modelo" : ""}`);
    if (booleano(fd, "com_partes")) {
      const sug = await signatariosSugeridos(supabase, v);
      if (sug.length) await supabase.from("documento_signatarios").insert(sug.map((s, i) => ({ ...s, documento_id: id, ordem: i + 1 })));
    }
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  redirect(`/documentos/${id}`);
}

/** Registra um arquivo já enviado ao Storage como documento (organização por imóvel/cliente). */
export async function registrarArquivoDocumento(a: { path: string; nome: string; titulo: string; tipo: string; imovelId?: string | null; pessoaId?: string | null; contratoId?: string | null; validade?: string | null }): Promise<Resultado> {
  const { supabase } = await obterContexto();
  const { data, error } = await supabase
    .from("documentos")
    .insert({
      titulo: a.titulo || a.nome,
      tipo: a.tipo || "outro",
      status: "arquivo",
      arquivo_path: a.path,
      arquivo_nome: a.nome,
      imovel_id: a.imovelId || null,
      pessoa_id: a.pessoaId || null,
      contrato_id: a.contratoId || null,
      validade: a.validade || null,
    })
    .select("id")
    .single();
  if (error) return { ok: false, erro: mensagemErro(error) };
  await evento(supabase, data.id, "enviado", `Arquivo enviado: ${a.nome}`);
  revalidar();
  return { ok: true };
}

export async function linkArquivoDocumento(id: string): Promise<Resultado> {
  const { supabase } = await obterContexto();
  const { data } = await supabase.from("documentos").select("arquivo_path").eq("id", id).single();
  if (!data?.arquivo_path) return { ok: false, erro: "Este documento não tem arquivo." };
  const { data: u, error } = await supabase.storage.from("documentos").createSignedUrl(data.arquivo_path, 300);
  if (error) return { ok: false, erro: mensagemErro(error) };
  await evento(supabase, id, "baixado", "Arquivo aberto/baixado");
  return { ok: true, url: u.signedUrl };
}

export async function atualizarDocumento(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase, papel } = await obterContexto();
  const id = String(fd.get("id"));
  try {
    const d: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (fd.has("titulo")) d.titulo = textoObrigatorio(fd, "titulo", "o título");
    for (const c of ["validade", "imovel_id", "pessoa_id", "contrato_id", "venda_id"]) if (fd.has(c)) d[c] = texto(fd, c);
    if (fd.has("alerta_dias")) d.alerta_dias = Math.max(0, inteiro(fd, "alerta_dias") ?? 30);
    if (fd.has("_restrito") && podeAprovar(papel)) d.restrito = booleano(fd, "restrito");
    const { error } = await supabase.from("documentos").update(d).eq("id", id);
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar(id);
  return { ok: "Salvo." };
}

/** Salva o texto como nova versão (a anterior fica guardada no histórico). */
export async function salvarConteudo(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  const id = String(fd.get("id"));
  try {
    const { data: d, error: e1 } = await supabase.from("documentos").select("status, versao, conteudo").eq("id", id).single();
    if (e1) throw e1;
    if (["aguardando_assinatura", "assinado", "cancelado"].includes(d.status)) throw new ErroValidacao("Documento enviado para assinatura ou assinado não pode ser editado. Cancele e gere outro, se precisar.");
    const conteudo = String(fd.get("conteudo") ?? "");
    if (conteudo === (d.conteudo ?? "")) return { ok: "Nada mudou." };
    const versao = d.versao + 1;
    const { error } = await supabase
      .from("documentos")
      .update({ conteudo, versao, status: d.status === "aprovado" || d.status === "recusado" ? "rascunho" : d.status, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw error;
    await supabase.from("documento_versoes").insert({ documento_id: id, versao, conteudo, observacao: texto(fd, "observacao") });
    await evento(supabase, id, "editado", `Versão ${versao} salva${texto(fd, "observacao") ? `: ${texto(fd, "observacao")}` : ""}`);
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar(id);
  return { ok: "Nova versão salva." };
}

/** Fluxo: rascunho → em revisão → aprovado → aguardando assinatura → assinado (ou cancelado). */
export async function mudarStatusDocumento(fd: FormData) {
  const { supabase, papel } = await obterContexto();
  const id = String(fd.get("id"));
  const para = String(fd.get("para"));
  const { data: d } = await supabase.from("documentos").select("status").eq("id", id).single();
  if (!d) return;
  const permitido: Record<string, string[]> = {
    em_revisao: ["rascunho", "recusado"],
    aprovado: ["em_revisao", "rascunho"],
    rascunho: ["em_revisao", "aprovado", "recusado", "aguardando_assinatura"],
    aguardando_assinatura: ["aprovado", "rascunho", "recusado"],
    cancelado: ["rascunho", "em_revisao", "aprovado", "aguardando_assinatura", "recusado"],
  };
  if (!permitido[para]?.includes(d.status)) return;
  if (para === "aprovado" && !podeAprovar(papel)) return;
  const extra: Record<string, unknown> = {};
  if (para === "aprovado") Object.assign(extra, { aprovado_em: new Date().toISOString(), aprovado_por: (await supabase.auth.getUser()).data.user?.id ?? null });
  if (para === "aguardando_assinatura") {
    const { count } = await supabase.from("documento_signatarios").select("id", { count: "exact", head: true }).eq("documento_id", id);
    if (!count) return;
    // Reenvio depois de recusa: zera as recusas.
    await supabase.from("documento_signatarios").update({ recusado_em: null, motivo_recusa: null }).eq("documento_id", id).is("assinado_em", null);
  }
  if (para === "rascunho" && d.status === "aguardando_assinatura") {
    // Voltar para edição invalida assinaturas já feitas (o texto vai mudar).
    await supabase.from("documento_signatarios").update({ assinado_em: null, nome_assinado: null, cpf_assinado: null, hash_documento: null, ip: null, user_agent: null }).eq("documento_id", id);
  }
  const obs = texto(fd, "obs");
  await supabase.from("documentos").update({ status: para, revisor_obs: obs ?? undefined, ...extra }).eq("id", id);
  await evento(supabase, id, para, `${ROTULO_STATUS_DOCUMENTO[d.status]} → ${ROTULO_STATUS_DOCUMENTO[para]}${obs ? ` · ${obs}` : ""}`);
  revalidar(id);
}

export async function salvarChecklistDocumento(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  const id = String(fd.get("id"));
  const tipo = String(fd.get("tipo"));
  const marc = new Set(lista(fd, "item"));
  const checklist = Object.fromEntries((CHECKLIST_DOCUMENTO[tipo] ?? []).map((i) => [i.id, marc.has(i.id)]));
  const { error } = await supabase.from("documentos").update({ checklist }).eq("id", id);
  if (error) return { erro: mensagemErro(error) };
  revalidar(id);
  return { ok: "Salvo." };
}

export async function excluirDocumento(id: string): Promise<Resultado> {
  const { supabase } = await obterContexto();
  const { data } = await supabase.from("documentos").select("status, arquivo_path").eq("id", id).single();
  if (data?.status === "assinado") return { ok: false, erro: "Documento assinado não pode ser excluído (fica para a trilha de auditoria). Use “Cancelar” se não vale mais." };
  if (data?.arquivo_path) await supabase.storage.from("documentos").remove([data.arquivo_path]);
  const { error } = await supabase.from("documentos").delete().eq("id", id);
  if (error) return { ok: false, erro: mensagemErro(error) };
  revalidar();
  return { ok: true };
}

// Signatários --------------------------------------------------------------------
export async function adicionarSignatario(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  const documento_id = String(fd.get("documento_id"));
  try {
    const pessoa_id = texto(fd, "pessoa_id");
    let nome = texto(fd, "nome");
    let cpf = texto(fd, "cpf");
    let telefone = texto(fd, "telefone");
    let email = texto(fd, "email");
    if (pessoa_id) {
      const { data: p } = await supabase.from("pessoas").select("nome, documento, telefone, email").eq("id", pessoa_id).single();
      nome = nome ?? p?.nome ?? null;
      cpf = cpf ?? p?.documento ?? null;
      telefone = telefone ?? p?.telefone ?? null;
      email = email ?? p?.email ?? null;
    }
    if (!nome) throw new ErroValidacao("Escolha a pessoa ou digite o nome.");
    const { count } = await supabase.from("documento_signatarios").select("id", { count: "exact", head: true }).eq("documento_id", documento_id);
    const { error } = await supabase.from("documento_signatarios").insert({ documento_id, pessoa_id, nome, cpf, telefone, email, papel: texto(fd, "papel") ?? "parte", ordem: (count ?? 0) + 1 });
    if (error) throw error;
    await evento(supabase, documento_id, "signatario", `Signatário incluído: ${nome}`);
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar(documento_id);
  return { ok: "Signatário incluído." };
}

export async function adicionarPartesComoSignatarios(id: string): Promise<Resultado> {
  const { supabase } = await obterContexto();
  const { data: d } = await supabase.from("documentos").select("imovel_id, pessoa_id, contrato_id, venda_id, captacao_id").eq("id", id).single();
  if (!d) return { ok: false, erro: "Documento não encontrado." };
  const sug = await signatariosSugeridos(supabase, d);
  const { data: ja } = await supabase.from("documento_signatarios").select("pessoa_id, papel").eq("documento_id", id);
  const novos = sug.filter((s) => !(ja ?? []).some((j) => j.pessoa_id === s.pessoa_id && j.papel === s.papel));
  if (!novos.length) return { ok: false, erro: "Não há partes novas para incluir (vincule um contrato, venda ou imóvel)." };
  const { error } = await supabase.from("documento_signatarios").insert(novos.map((s, i) => ({ ...s, documento_id: id, ordem: (ja?.length ?? 0) + i + 1 })));
  if (error) return { ok: false, erro: mensagemErro(error) };
  await evento(supabase, id, "signatario", `${novos.length} parte(s) incluída(s) como signatárias`);
  revalidar(id);
  return { ok: true };
}

export async function excluirSignatario(id: string): Promise<Resultado> {
  const { supabase } = await obterContexto();
  const { data } = await supabase.from("documento_signatarios").select("documento_id, nome, assinado_em").eq("id", id).single();
  if (data?.assinado_em) return { ok: false, erro: "Quem já assinou não pode ser removido." };
  const { error } = await supabase.from("documento_signatarios").delete().eq("id", id);
  if (error) return { ok: false, erro: mensagemErro(error) };
  if (data) {
    await evento(supabase, data.documento_id, "signatario", `Signatário removido: ${data.nome}`);
    revalidar(data.documento_id);
  }
  return { ok: true };
}
