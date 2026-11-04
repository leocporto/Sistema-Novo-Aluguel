"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { obterContexto } from "@/lib/contexto";
import { hojeISO } from "@/lib/dominio/datas";
import {
  ALVOS_META,
  CATEGORIAS_TAREFA,
  MODELO_ONBOARDING_PADRAO,
  MODULOS,
  OPERACOES,
  PAPEIS_USUARIO,
  PRIORIDADES_TAREFA,
  RESPONSAVEIS_ONBOARDING,
  STATUS_TAREFA,
  TIPOS_APROVACAO,
  TIPOS_META_EQUIPE,
  TIPOS_REDISTRIBUICAO,
  TIPO_QUALQUER,
  UFS,
  emailValido,
  mensagemSemPermissao,
  permissoesPadrao,
  validarCreci,
  type Modulo,
  type Operacao,
} from "@/lib/dominio/equipe";
import { type EstadoAcao, ErroValidacao, inteiro, mensagemErro, numero, texto, textoObrigatorio } from "@/lib/form";
import { pode } from "@/lib/permissoes";

type Resultado = { ok: boolean; erro?: string };

function revalidar() {
  revalidatePath("/equipe", "layout");
  revalidatePath("/");
}
const falha = (e: unknown): Resultado => ({ ok: false, erro: mensagemErro(e) });

/** Contexto com a trava do modo (só imobiliária) e, se pedir, da permissão. */
async function ctx(modulo?: Modulo, operacao?: Operacao) {
  const c = await obterContexto();
  if (c.organizacao.modo === "pessoal") throw new ErroValidacao("A gestão de equipe só existe no modo imobiliária.");
  if (modulo && operacao && !(await pode(modulo, operacao))) throw new ErroValidacao(mensagemSemPermissao(modulo, operacao));
  return c;
}

const umDe = <T extends string>(v: string | null, lista: readonly T[], padrao: T): T => ((lista as readonly string[]).includes(v ?? "") ? (v as T) : padrao);
const marcado = (fd: FormData, campo: string) => fd.getAll(campo).includes("on");

// =============================================================================
// Usuários e convites
// =============================================================================

export async function convidarUsuario(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  try {
    const { supabase, papel } = await ctx("equipe", "criar");
    const email = textoObrigatorio(fd, "email", "o e-mail").toLowerCase();
    if (!emailValido(email)) throw new ErroValidacao("E-mail inválido.");
    const papelConvite = umDe(texto(fd, "papel"), PAPEIS_USUARIO, "corretor");
    if (papel !== "admin" && (papelConvite === "admin" || papelConvite === "gestor")) throw new ErroValidacao("Só o administrador convida gestores e administradores.");
    const perfil = papel === "admin" ? texto(fd, "perfil_id") : null;
    const { error } = await supabase.from("equipe_convites").insert({ email, nome: texto(fd, "nome"), papel: papelConvite, perfil_id: perfil, pessoa_id: texto(fd, "pessoa_id") });
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Convite criado. Copie o link na lista de convites e mande para a pessoa." };
}

export async function cancelarConvite(id: string): Promise<Resultado> {
  try {
    const { supabase } = await ctx("equipe", "criar");
    const { error } = await supabase.from("equipe_convites").update({ revogado_em: new Date().toISOString() }).eq("id", id).is("aceito_em", null).is("revogado_em", null);
    if (error) throw error;
  } catch (e) {
    return falha(e);
  }
  revalidar();
  return { ok: true };
}

/** Acesso do usuário (papel, perfil, nome, cargo). Papel e perfil: só o administrador (o banco confere). */
export async function salvarAcessoUsuario(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  try {
    const { supabase, papel } = await ctx("equipe", "editar");
    const userId = textoObrigatorio(fd, "user_id");
    const dados: Record<string, string | null> = {};
    if (fd.has("nome")) dados.nome = texto(fd, "nome");
    if (fd.has("cargo")) dados.cargo = texto(fd, "cargo");
    if (papel === "admin") {
      if (fd.has("papel")) dados.papel = umDe(texto(fd, "papel"), PAPEIS_USUARIO, "corretor");
      if (fd.has("perfil_id")) dados.perfil_id = texto(fd, "perfil_id") ?? "";
    }
    const { error } = await supabase.rpc("equipe_salvar_membro", { p_user: userId, p: dados });
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Acesso salvo." };
}

export async function removerAcesso(userId: string): Promise<Resultado> {
  try {
    const { supabase, papel } = await ctx();
    if (papel !== "admin") throw new ErroValidacao("Só o administrador tira o acesso de um usuário.");
    const { error } = await supabase.rpc("equipe_remover_membro", { p_user: userId });
    if (error) throw error;
  } catch (e) {
    return falha(e);
  }
  revalidar();
  return { ok: true };
}

export async function criarFichaUsuario(userId: string): Promise<Resultado> {
  let id: string | null = null;
  try {
    const { supabase } = await ctx();
    const { data, error } = await supabase.rpc("equipe_criar_ficha", { p_user: userId });
    if (error) throw error;
    id = data as string;
  } catch (e) {
    return falha(e);
  }
  revalidar();
  redirect(`/equipe/colaboradores/${id}`);
}

/** Liga um usuário a um cadastro de Pessoas que já existe. */
export async function ligarUsuarioPessoa(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  try {
    const { supabase } = await ctx("equipe", "editar");
    const { error } = await supabase.rpc("equipe_salvar_membro", { p_user: textoObrigatorio(fd, "user_id"), p: { pessoa_id: textoObrigatorio(fd, "pessoa_id", "o cadastro") } });
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Usuário ligado ao cadastro." };
}

// =============================================================================
// Colaboradores (cadastro de Pessoas) e dados profissionais
// =============================================================================

function lerCreci(fd: FormData) {
  const numero_ = texto(fd, "creci_numero");
  const uf = texto(fd, "creci_uf")?.toUpperCase() ?? null;
  const erro = validarCreci(numero_, uf);
  if (erro) throw new ErroValidacao(erro);
  return {
    creci_numero: numero_,
    creci_uf: numero_ ? uf : null,
    creci_validade: numero_ ? texto(fd, "creci_validade") : null,
    creci_tipo: numero_ ? texto(fd, "creci_tipo") : null,
  };
}

export async function novoColaborador(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  let id: string;
  try {
    const { supabase } = await ctx("equipe", "criar");
    const corretor = marcado(fd, "corretor");
    const { data, error } = await supabase
      .from("pessoas")
      .insert({
        nome: textoObrigatorio(fd, "nome", "o nome"),
        email: texto(fd, "email"),
        telefone: texto(fd, "telefone"),
        papeis: corretor ? ["corretor"] : [],
        colaborador: true,
        cargo: texto(fd, "cargo"),
        admissao: texto(fd, "admissao"),
        filial_id: texto(fd, "filial_id"),
        ...lerCreci(fd),
      })
      .select("id")
      .single();
    if (error) throw error;
    id = data.id as string;
    const equipe = texto(fd, "equipe_id");
    if (equipe) {
      const { error: e2 } = await supabase.rpc("equipe_definir_equipe", { p_pessoa: id, p_equipe: equipe });
      if (e2) throw e2;
    }
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  redirect(`/equipe/colaboradores/${id}`);
}

/**
 * Dados profissionais (salva sozinho). Quem tem Equipe → editar muda tudo; o
 * próprio colaborador, só o contato e o CRECI (equipe, filial, cargo,
 * admissão, desligamento, papel de corretor e fila de leads são do gestor).
 * O banco confere de novo (privado.pessoas_equipe_guarda e privado.equipes_guarda).
 */
export async function salvarDadosProfissionais(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  try {
    const { supabase, usuario, organizacao } = await ctx();
    const id = textoObrigatorio(fd, "id");
    const gestor = await pode("equipe", "editar");
    if (!gestor) {
      const { data: eu } = await supabase.from("membros").select("pessoa_id").eq("user_id", usuario.id).eq("organizacao_id", organizacao.id).maybeSingle();
      if (eu?.pessoa_id !== id) throw new ErroValidacao(mensagemSemPermissao("equipe", "editar"));
    }
    const contato = {
      nome: textoObrigatorio(fd, "nome", "o nome"),
      email: texto(fd, "email"),
      telefone: texto(fd, "telefone"),
      ...lerCreci(fd),
    };
    if (!gestor) {
      const { error } = await supabase.from("pessoas").update(contato).eq("id", id);
      if (error) throw error;
    } else {
      const { data: atual } = await supabase.from("pessoas").select("papeis").eq("id", id).single();
      const papeis = new Set<string>((atual?.papeis as string[] | null) ?? []);
      if (marcado(fd, "corretor")) papeis.add("corretor");
      else papeis.delete("corretor");
      const { error } = await supabase
        .from("pessoas")
        .update({
          ...contato,
          cargo: texto(fd, "cargo"),
          admissao: texto(fd, "admissao"),
          desligamento: texto(fd, "desligamento"),
          filial_id: texto(fd, "filial_id"),
          recebe_leads: marcado(fd, "recebe_leads"),
          papeis: [...papeis],
          colaborador: true,
        })
        .eq("id", id);
      if (error) throw error;
      // Equipe: só grava quando muda (sem apagar e recriar a cada salvamento).
      if (fd.has("equipe_id")) {
        const { error: e2 } = await supabase.rpc("equipe_definir_equipe", { p_pessoa: id, p_equipe: texto(fd, "equipe_id") });
        if (e2) throw e2;
      }
    }
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Dados salvos." };
}

// Carteira de clientes (pessoas.corretor_id) -------------------------------------

/** Põe um cliente na carteira do corretor (ref = "corretor:pessoa"). Fica no Histórico de ações. */
export async function porNaCarteira(ref: string): Promise<Resultado> {
  try {
    const { supabase } = await ctx("equipe", "editar");
    const [corretor, pessoa] = ref.split(":");
    if (!corretor || !pessoa) throw new ErroValidacao("Escolha o cliente.");
    if (corretor === pessoa) throw new ErroValidacao("A pessoa não pode ser corretora da própria carteira.");
    const { data, error } = await supabase.from("pessoas").update({ corretor_id: corretor }).eq("id", pessoa).select("id");
    if (error) throw error;
    if (!data?.length) throw new ErroValidacao("Cliente não encontrado.");
  } catch (e) {
    return falha(e);
  }
  revalidar();
  return { ok: true };
}

/** Tira o cliente da carteira (ele fica sem corretor responsável). */
export async function tirarDaCarteira(pessoa: string): Promise<Resultado> {
  try {
    const { supabase } = await ctx("equipe", "editar");
    const { error } = await supabase.from("pessoas").update({ corretor_id: null }).eq("id", pessoa);
    if (error) throw error;
  } catch (e) {
    return falha(e);
  }
  revalidar();
  return { ok: true };
}

/** Tira a pessoa da lista de colaboradores (o cadastro em Pessoas continua). */
export async function deixarDeSerColaborador(id: string): Promise<Resultado> {
  try {
    const { supabase } = await ctx("equipe", "excluir");
    const { data: m } = await supabase.from("membros").select("user_id").eq("pessoa_id", id).maybeSingle();
    if (m) throw new ErroValidacao("Esta pessoa tem acesso ao sistema. Tire o acesso primeiro.");
    const { data: atual } = await supabase.from("pessoas").select("papeis").eq("id", id).single();
    const papeis = ((atual?.papeis as string[] | null) ?? []).filter((p) => p !== "corretor");
    const { error } = await supabase.from("pessoas").update({ colaborador: false, papeis }).eq("id", id);
    if (error) throw error;
    await supabase.from("equipe_membros").delete().eq("pessoa_id", id);
  } catch (e) {
    return falha(e);
  }
  revalidar();
  return { ok: true };
}

// Documentos profissionais ------------------------------------------------------

async function podeMexerNoColaborador(pessoaId: string) {
  const { supabase, usuario } = await ctx();
  const { data: eu } = await supabase.from("membros").select("pessoa_id").eq("user_id", usuario.id).maybeSingle();
  if (eu?.pessoa_id !== pessoaId && !(await pode("equipe", "editar"))) throw new ErroValidacao(mensagemSemPermissao("equipe", "editar"));
}

export async function registrarDocumento(d: { pessoaId: string; tipo: string; numero: string | null; emissao: string | null; validade: string | null; path: string | null; nome: string | null }): Promise<Resultado> {
  const { supabase, organizacao } = await obterContexto();
  try {
    await podeMexerNoColaborador(d.pessoaId);
    if (d.path && !d.path.startsWith(`${organizacao.id}/${d.pessoaId}/`)) throw new ErroValidacao("Arquivo inválido.");
    if (!d.tipo.trim()) throw new ErroValidacao("Escolha o tipo do documento.");
    const { error } = await supabase.from("equipe_documentos").insert({
      pessoa_id: d.pessoaId,
      tipo: d.tipo.trim().slice(0, 120),
      numero: d.numero?.trim() || null,
      emissao: d.emissao || null,
      validade: d.validade || null,
      path: d.path,
      nome_arquivo: d.nome,
    });
    if (error) throw error;
  } catch (e) {
    if (d.path) await supabase.storage.from("equipe").remove([d.path]);
    return falha(e);
  }
  revalidar();
  return { ok: true };
}

export async function salvarDocumento(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  try {
    const { supabase } = await ctx();
    const id = textoObrigatorio(fd, "id");
    const { data: doc } = await supabase.from("equipe_documentos").select("pessoa_id").eq("id", id).single();
    if (!doc) throw new ErroValidacao("Documento não encontrado.");
    await podeMexerNoColaborador(doc.pessoa_id as string);
    const { error } = await supabase.from("equipe_documentos").update({ numero: texto(fd, "numero"), emissao: texto(fd, "emissao"), validade: texto(fd, "validade") }).eq("id", id);
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Documento salvo." };
}

export async function linkDocumento(id: string): Promise<Resultado & { url?: string }> {
  const { supabase } = await obterContexto();
  const { data } = await supabase.from("equipe_documentos").select("path").eq("id", id).maybeSingle();
  if (!data?.path) return { ok: false, erro: "Este documento não tem arquivo." };
  const { data: u, error } = await supabase.storage.from("equipe").createSignedUrl(data.path as string, 300);
  if (error) return { ok: false, erro: mensagemErro(error) };
  return { ok: true, url: u.signedUrl };
}

export async function excluirDocumento(id: string): Promise<Resultado> {
  try {
    const { supabase } = await ctx();
    const { data } = await supabase.from("equipe_documentos").select("pessoa_id, path").eq("id", id).maybeSingle();
    if (!data) throw new ErroValidacao("Documento não encontrado.");
    await podeMexerNoColaborador(data.pessoa_id as string);
    if (data.path) {
      const { error: e1 } = await supabase.storage.from("equipe").remove([data.path as string]);
      if (e1) throw new ErroValidacao(`Não foi possível apagar o arquivo (${e1.message}). Tente de novo.`);
    }
    const { error } = await supabase.from("equipe_documentos").delete().eq("id", id);
    if (error) throw error;
  } catch (e) {
    return falha(e);
  }
  revalidar();
  return { ok: true };
}

// =============================================================================
// Filiais e equipes
// =============================================================================

function dadosFilial(fd: FormData) {
  const uf = texto(fd, "uf")?.toUpperCase() ?? null;
  if (uf && !UFS.includes(uf)) throw new ErroValidacao("UF inválida.");
  return {
    nome: textoObrigatorio(fd, "nome", "o nome da filial"),
    codigo: texto(fd, "codigo"),
    cidade: texto(fd, "cidade"),
    uf,
    endereco: texto(fd, "endereco"),
    telefone: texto(fd, "telefone"),
    email: texto(fd, "email"),
    gestor_id: texto(fd, "gestor_id"),
  };
}

export async function criarFilial(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  try {
    const { supabase } = await ctx("equipe", "editar");
    const { error } = await supabase.from("filiais").insert(dadosFilial(fd));
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Filial cadastrada." };
}

export async function salvarFilial(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  try {
    const { supabase } = await ctx("equipe", "editar");
    const { error } = await supabase
      .from("filiais")
      .update({ ...dadosFilial(fd), ativa: marcado(fd, "ativa") })
      .eq("id", textoObrigatorio(fd, "id"));
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Filial salva." };
}

export async function excluirFilial(id: string): Promise<Resultado> {
  try {
    const { supabase } = await ctx("equipe", "editar");
    const { error } = await supabase.from("filiais").delete().eq("id", id);
    if (error) throw error;
  } catch (e) {
    return falha(e);
  }
  revalidar();
  return { ok: true };
}

export async function criarEquipe(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  try {
    const { supabase } = await ctx("equipe", "editar");
    const { error } = await supabase.from("equipes").insert({
      nome: textoObrigatorio(fd, "nome", "o nome da equipe"),
      descricao: texto(fd, "descricao"),
      filial_id: texto(fd, "filial_id"),
      lider_id: texto(fd, "lider_id"),
    });
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  revalidatePath("/comissoes", "layout");
  return { ok: "Equipe criada." };
}

export async function salvarEquipe(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  try {
    const { supabase } = await ctx("equipe", "editar");
    const { error } = await supabase
      .from("equipes")
      .update({
        nome: textoObrigatorio(fd, "nome", "o nome da equipe"),
        descricao: texto(fd, "descricao"),
        filial_id: texto(fd, "filial_id"),
        lider_id: texto(fd, "lider_id"),
        ativa: marcado(fd, "ativa"),
      })
      .eq("id", textoObrigatorio(fd, "id"));
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  revalidatePath("/comissoes", "layout");
  return { ok: "Equipe salva." };
}

export async function excluirEquipe(id: string): Promise<Resultado> {
  try {
    const { supabase } = await ctx("equipe", "editar");
    const { count } = await supabase.from("comissao_regras").select("id", { count: "exact", head: true }).eq("equipe_id", id);
    if (count) throw new ErroValidacao("Esta equipe tem regras de comissão. Apague as regras em Comissões → Regras e equipes antes.");
    const { error } = await supabase.from("equipes").delete().eq("id", id);
    if (error) throw error;
  } catch (e) {
    return falha(e);
  }
  revalidar();
  revalidatePath("/comissoes", "layout");
  return { ok: true };
}

export async function colocarNaEquipe(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  try {
    const { supabase } = await ctx("equipe", "editar");
    const pessoa = textoObrigatorio(fd, "pessoa_id", "quem entra na equipe");
    // Sai da equipe anterior e entra nesta numa operação só (sem ficar sem equipe se der erro).
    const { error } = await supabase.rpc("equipe_definir_equipe", { p_pessoa: pessoa, p_equipe: textoObrigatorio(fd, "equipe_id") });
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  revalidatePath("/comissoes", "layout");
  return { ok: "Colaborador colocado na equipe." };
}

export async function tirarDaEquipe(id: string): Promise<Resultado> {
  try {
    const { supabase } = await ctx("equipe", "editar");
    const { error } = await supabase.from("equipe_membros").delete().eq("id", id);
    if (error) throw error;
  } catch (e) {
    return falha(e);
  }
  revalidar();
  revalidatePath("/comissoes", "layout");
  return { ok: true };
}

// =============================================================================
// Perfis de acesso (só administrador; o banco confere)
// =============================================================================

async function soAdmin() {
  const c = await ctx();
  if (c.papel !== "admin") throw new ErroValidacao("Só o administrador muda os perfis de acesso.");
  return c;
}

export async function criarPerfil(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  let id: string;
  try {
    const { supabase } = await soAdmin();
    const papel = umDe(texto(fd, "papel_base"), PAPEIS_USUARIO, "corretor");
    const copiar = texto(fd, "copiar_de");
    let permissoes: unknown = permissoesPadrao(papel);
    if (copiar) {
      const { data } = await supabase.from("perfis_acesso").select("permissoes").eq("id", copiar).maybeSingle();
      if (data) permissoes = data.permissoes;
    }
    const { data, error } = await supabase
      .from("perfis_acesso")
      .insert({ nome: textoObrigatorio(fd, "nome", "o nome do perfil"), descricao: texto(fd, "descricao"), papel_base: papel, permissoes })
      .select("id")
      .single();
    if (error) throw error;
    id = data.id as string;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  redirect(`/equipe/perfis/${id}`);
}

/** Matriz módulo × operação (caixas "perm" com valor "modulo:operacao"). */
export async function salvarPerfil(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  try {
    const { supabase } = await soAdmin();
    const marcadas = fd.getAll("perm").map(String);
    const permissoes: Record<string, string[]> = {};
    for (const m of MODULOS) permissoes[m.id] = OPERACOES.filter((o) => marcadas.includes(`${m.id}:${o}`));
    const { error } = await supabase
      .from("perfis_acesso")
      .update({ nome: textoObrigatorio(fd, "nome", "o nome do perfil"), descricao: texto(fd, "descricao"), permissoes })
      .eq("id", textoObrigatorio(fd, "id"));
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Perfil salvo. Vale na próxima tela que a pessoa abrir." };
}

export async function restaurarPerfil(id: string): Promise<Resultado> {
  try {
    const { supabase } = await soAdmin();
    const { data } = await supabase.from("perfis_acesso").select("papel_base").eq("id", id).single();
    if (!data) throw new ErroValidacao("Perfil não encontrado.");
    const { error } = await supabase.from("perfis_acesso").update({ permissoes: permissoesPadrao(data.papel_base as string) }).eq("id", id);
    if (error) throw error;
  } catch (e) {
    return falha(e);
  }
  revalidar();
  return { ok: true };
}

export async function excluirPerfil(id: string): Promise<Resultado> {
  try {
    const { supabase } = await soAdmin();
    // Regra de aprovação que tem este perfil como aprovador: troque antes (o banco confere de novo).
    const { count } = await supabase.from("aprovacao_regras").select("id", { count: "exact", head: true }).eq("aprovador_perfil_id", id);
    if (count)
      throw new ErroValidacao(
        `Este perfil é o aprovador de ${count} regra(s) de aprovação. Exclua essas regras em Equipe → Aprovações → Regras (e crie de novo com outro aprovador) antes de excluir o perfil.`,
      );
    const { error } = await supabase.from("perfis_acesso").delete().eq("id", id);
    if (error) throw error;
  } catch (e) {
    return falha(e);
  }
  revalidar();
  return { ok: true };
}

// =============================================================================
// Metas individuais e coletivas
// =============================================================================

export async function criarMeta(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  try {
    const { supabase } = await ctx("equipe", "editar");
    const mes = textoObrigatorio(fd, "mes", "o mês");
    if (!/^\d{4}-\d{2}$/.test(mes)) throw new ErroValidacao("Mês inválido.");
    const alvo = umDe(texto(fd, "alvo"), ALVOS_META, "pessoa");
    const quem = textoObrigatorio(fd, `${alvo}_id`, alvo === "pessoa" ? "o colaborador" : alvo === "equipe" ? "a equipe" : "a filial");
    const valor = numero(fd, "valor");
    if (!valor || valor <= 0) throw new ErroValidacao("Informe o número da meta.");
    const { error } = await supabase.from("equipe_metas").insert({
      competencia: `${mes}-01`,
      tipo: umDe(texto(fd, "tipo"), TIPOS_META_EQUIPE, "visitas"),
      alvo,
      [`${alvo}_id`]: quem,
      valor,
    });
    if (error) {
      if (error.message.includes("duplicate key")) throw new ErroValidacao("Já existe meta desse tipo para quem você escolheu neste mês. Mude o número na lista.");
      throw error;
    }
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Meta criada." };
}

export async function salvarMeta(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  try {
    const { supabase } = await ctx("equipe", "editar");
    const valor = numero(fd, "valor");
    if (!valor || valor <= 0) throw new ErroValidacao("A meta precisa ser maior que zero (para tirar, use o X).");
    const { error } = await supabase.from("equipe_metas").update({ valor }).eq("id", textoObrigatorio(fd, "id"));
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Meta salva." };
}

export async function excluirMeta(id: string): Promise<Resultado> {
  try {
    const { supabase } = await ctx("equipe", "editar");
    const { error } = await supabase.from("equipe_metas").delete().eq("id", id);
    if (error) throw error;
  } catch (e) {
    return falha(e);
  }
  revalidar();
  return { ok: true };
}

/** Copia as metas do mês anterior para o mês informado (id = "AAAA-MM"); não repete as que já existem. */
export async function copiarMetasDoMesAnterior(mes: string): Promise<Resultado> {
  try {
    const { supabase } = await ctx("equipe", "editar");
    if (!/^\d{4}-\d{2}$/.test(mes)) throw new ErroValidacao("Mês inválido.");
    const [a, m] = mes.split("-").map(Number);
    const anterior = m === 1 ? `${a - 1}-12-01` : `${a}-${String(m - 1).padStart(2, "0")}-01`;
    const [{ data: antes }, { data: agora }] = await Promise.all([
      supabase.from("equipe_metas").select("tipo, alvo, pessoa_id, equipe_id, filial_id, valor").eq("competencia", anterior),
      supabase.from("equipe_metas").select("tipo, alvo, pessoa_id, equipe_id, filial_id").eq("competencia", `${mes}-01`),
    ]);
    const chave = (x: { tipo: string; alvo: string; pessoa_id: string | null; equipe_id: string | null; filial_id: string | null }) =>
      `${x.tipo}|${x.alvo}|${x.pessoa_id ?? x.equipe_id ?? x.filial_id}`;
    const ja = new Set((agora ?? []).map(chave));
    const novas = (antes ?? []).filter((x) => !ja.has(chave(x))).map((x) => ({ ...x, competencia: `${mes}-01` }));
    if (!novas.length) throw new ErroValidacao("Não há metas novas para copiar do mês anterior.");
    const { error } = await supabase.from("equipe_metas").insert(novas);
    if (error) throw error;
  } catch (e) {
    return falha(e);
  }
  revalidar();
  return { ok: true };
}

// =============================================================================
// Distribuição
// =============================================================================

export async function redistribuir(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  try {
    const { supabase } = await ctx("equipe", "editar");
    const destino = textoObrigatorio(fd, "destino", "para quem vai");
    const [tipoDestino, idDestino] = destino.split(":");
    const ids = fd.getAll("ids").map(String).filter(Boolean);
    const p: Record<string, unknown> = {
      tipo: umDe(texto(fd, "tipo"), Object.keys(TIPOS_REDISTRIBUICAO), "leads"),
      de: textoObrigatorio(fd, "de", "de quem sai a carteira"),
      motivo: textoObrigatorio(fd, "motivo", "o motivo"),
      abertos: true,
    };
    if (tipoDestino === "p") p.para = idDestino;
    else if (tipoDestino === "e") p.equipe_id = idDestino;
    else if (tipoDestino === "f") p.filial_id = idDestino;
    if (ids.length) p.ids = ids;
    const { data, error } = await supabase.rpc("equipe_redistribuir", { p });
    if (error) throw error;
    const n = (data as { quantidade: number }).quantidade;
    revalidar();
    revalidatePath("/comercial", "layout");
    revalidatePath("/captacao", "layout");
    revalidatePath("/imoveis", "layout");
    revalidatePath("/agenda", "layout");
    return { ok: `${n} ${n === 1 ? "item redistribuído" : "itens redistribuídos"}. Está no histórico da distribuição.` };
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
}

export async function criarRegraDistribuicao(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  try {
    const { supabase } = await ctx("equipe", "editar");
    const grupo = textoObrigatorio(fd, "grupo", "a equipe ou filial");
    const [t, id] = grupo.split(":");
    const funil = texto(fd, "funil");
    const { error } = await supabase.from("equipe_distribuicao_regras").insert({
      funil: funil && ["locacao", "venda", "captacao"].includes(funil) ? funil : null,
      origem: texto(fd, "origem"),
      equipe_id: t === "e" ? id : null,
      filial_id: t === "f" ? id : null,
    });
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Regra criada." };
}

export async function alternarRegraDistribuicao(id: string): Promise<Resultado> {
  try {
    const { supabase } = await ctx("equipe", "editar");
    const { data } = await supabase.from("equipe_distribuicao_regras").select("ativa").eq("id", id).single();
    const { error } = await supabase.from("equipe_distribuicao_regras").update({ ativa: !data?.ativa }).eq("id", id);
    if (error) throw error;
  } catch (e) {
    return falha(e);
  }
  revalidar();
  return { ok: true };
}

export async function excluirRegraDistribuicao(id: string): Promise<Resultado> {
  try {
    const { supabase } = await ctx("equipe", "editar");
    const { error } = await supabase.from("equipe_distribuicao_regras").delete().eq("id", id);
    if (error) throw error;
  } catch (e) {
    return falha(e);
  }
  revalidar();
  return { ok: true };
}

/** Modo de distribuição (manual/rodízio) e quem participa da fila (salva sozinho). */
export async function salvarFila(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  try {
    const { supabase, organizacao } = await ctx("equipe", "editar");
    const modo = texto(fd, "distribuicao_leads") === "rodizio" ? "rodizio" : "manual";
    const { error } = await supabase.from("organizacoes").update({ distribuicao_leads: modo }).eq("id", organizacao.id);
    if (error) throw error;
    const recebem = new Set(fd.getAll("recebe").map(String));
    const { data: corretores } = await supabase.from("pessoas").select("id, recebe_leads").contains("papeis", ["corretor"]).limit(1000);
    for (const c of corretores ?? []) {
      const quer = recebem.has(c.id as string);
      if (quer !== c.recebe_leads) await supabase.from("pessoas").update({ recebe_leads: quer }).eq("id", c.id);
    }
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  revalidatePath("/comercial", "layout");
  return { ok: "Fila salva." };
}

// =============================================================================
// Tarefas internas
// =============================================================================

function dadosTarefa(fd: FormData) {
  return {
    titulo: textoObrigatorio(fd, "titulo", "o que precisa ser feito"),
    descricao: texto(fd, "descricao"),
    categoria: umDe(texto(fd, "categoria"), Object.keys(CATEGORIAS_TAREFA), "geral"),
    prioridade: umDe(texto(fd, "prioridade"), PRIORIDADES_TAREFA, "normal"),
    responsavel_id: texto(fd, "responsavel_id"),
    prazo: texto(fd, "prazo"),
    imovel_id: texto(fd, "imovel_id"),
    contrato_id: texto(fd, "contrato_id"),
    pessoa_id: texto(fd, "pessoa_id"),
    equipe_id: texto(fd, "equipe_id"),
  };
}

export async function criarTarefaInterna(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  let id: string;
  try {
    const { supabase } = await ctx("equipe", "ver");
    const { data, error } = await supabase.from("equipe_tarefas").insert(dadosTarefa(fd)).select("id").single();
    if (error) throw error;
    id = data.id as string;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  if (marcado(fd, "abrir")) redirect(`/equipe/tarefas/${id}`);
  return { ok: "Tarefa criada." };
}

export async function salvarTarefaInterna(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  try {
    const { supabase } = await ctx("equipe", "ver");
    const { error } = await supabase
      .from("equipe_tarefas")
      .update({ ...dadosTarefa(fd), status: umDe(texto(fd, "status"), STATUS_TAREFA, "a_fazer") })
      .eq("id", textoObrigatorio(fd, "id"));
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Tarefa salva." };
}

async function mudarStatusTarefa(id: string, status: string): Promise<Resultado> {
  try {
    const { supabase } = await ctx("equipe", "ver");
    const { error } = await supabase.from("equipe_tarefas").update({ status }).eq("id", id);
    if (error) throw error;
  } catch (e) {
    return falha(e);
  }
  revalidar();
  return { ok: true };
}
export async function concluirTarefaInterna(id: string) {
  return mudarStatusTarefa(id, "concluida");
}
export async function reabrirTarefaInterna(id: string) {
  return mudarStatusTarefa(id, "a_fazer");
}
export async function comecarTarefaInterna(id: string) {
  return mudarStatusTarefa(id, "em_andamento");
}

export async function excluirTarefaInterna(id: string): Promise<Resultado> {
  try {
    const { supabase } = await ctx("equipe", "ver");
    const { data, error } = await supabase.from("equipe_tarefas").delete().eq("id", id).select("id");
    if (error) throw error;
    if (!data?.length) throw new ErroValidacao("Tarefa não encontrada.");
  } catch (e) {
    return falha(e);
  }
  revalidar();
  return { ok: true };
}

export async function comentarTarefa(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  try {
    const { supabase, usuario } = await ctx("equipe", "ver");
    const { error } = await supabase.from("equipe_tarefa_comentarios").insert({ tarefa_id: textoObrigatorio(fd, "tarefa_id"), texto: textoObrigatorio(fd, "texto", "o comentário"), usuario_id: usuario.id });
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Comentário publicado." };
}

export async function excluirComentarioTarefa(id: string): Promise<Resultado> {
  try {
    const { supabase } = await ctx();
    const { data, error } = await supabase.from("equipe_tarefa_comentarios").delete().eq("id", id).select("id");
    if (error) throw error;
    if (!data?.length) throw new ErroValidacao("Só quem escreveu apaga o comentário.");
  } catch (e) {
    return falha(e);
  }
  revalidar();
  return { ok: true };
}

// =============================================================================
// Aprovações
// =============================================================================

export async function novaSolicitacao(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  try {
    const { supabase } = await ctx("aprovacoes", "criar");
    const valor = numero(fd, "valor");
    if (valor !== null && valor < 0) throw new ErroValidacao("O valor não pode ser negativo.");
    const { error } = await supabase.from("aprovacoes").insert({
      tipo: umDe(texto(fd, "tipo"), Object.keys(TIPOS_APROVACAO), "outro"),
      titulo: textoObrigatorio(fd, "titulo", "o que precisa ser aprovado"),
      descricao: texto(fd, "descricao"),
      valor,
      prazo: texto(fd, "prazo"),
      aprovador_id: texto(fd, "aprovador_id"),
    });
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Solicitação enviada para aprovação." };
}

/** Aprovar ou recusar (o banco confere quem pode e exige o motivo da recusa). */
export async function decidirSolicitacao(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  try {
    const { supabase } = await ctx("aprovacoes", "aprovar");
    const aprovar = texto(fd, "decisao") === "aprovar";
    const comentario = texto(fd, "comentario");
    if (!aprovar && !comentario) throw new ErroValidacao("Diga o motivo da recusa.");
    const { data, error } = await supabase
      .from("aprovacoes")
      .update({ status: aprovar ? "aprovada" : "recusada", comentario })
      .eq("id", textoObrigatorio(fd, "id"))
      .eq("status", "pendente")
      .select("id");
    if (error) throw error;
    if (!data?.length) throw new ErroValidacao("Esta solicitação não está mais pendente.");
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Decisão registrada." };
}

export async function cancelarSolicitacao(id: string): Promise<Resultado> {
  try {
    const { supabase } = await ctx();
    const { error } = await supabase.from("aprovacoes").update({ status: "cancelada" }).eq("id", id).eq("status", "pendente");
    if (error) throw error;
  } catch (e) {
    return falha(e);
  }
  revalidar();
  return { ok: true };
}

export async function excluirSolicitacao(id: string): Promise<Resultado> {
  try {
    const { supabase } = await ctx();
    const { data, error } = await supabase.from("aprovacoes").delete().eq("id", id).select("id");
    if (error) throw error;
    if (!data?.length) throw new ErroValidacao("Solicitação não encontrada.");
  } catch (e) {
    return falha(e);
  }
  revalidar();
  return { ok: true };
}

export async function criarRegraAprovacao(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  try {
    const { supabase } = await ctx("aprovacoes", "editar");
    const quem = textoObrigatorio(fd, "aprovador", "quem aprova");
    const [t, id] = quem.split(":");
    const tipo = texto(fd, "tipo");
    const { error } = await supabase.from("aprovacao_regras").insert({
      tipo: tipo && (tipo === TIPO_QUALQUER || tipo in TIPOS_APROVACAO) ? tipo : TIPO_QUALQUER,
      descricao: texto(fd, "descricao"),
      valor_minimo: numero(fd, "valor_minimo") ?? 0,
      aprovador_papel: t === "papel" ? id : null,
      aprovador_perfil_id: t === "perfil" ? id : null,
      aprovador_id: t === "usuario" ? id : null,
    });
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Regra criada." };
}

export async function alternarRegraAprovacao(id: string): Promise<Resultado> {
  try {
    const { supabase } = await ctx("aprovacoes", "editar");
    const { data } = await supabase.from("aprovacao_regras").select("ativa").eq("id", id).single();
    const { error } = await supabase.from("aprovacao_regras").update({ ativa: !data?.ativa }).eq("id", id);
    if (error) throw error;
  } catch (e) {
    return falha(e);
  }
  revalidar();
  return { ok: true };
}

export async function excluirRegraAprovacao(id: string): Promise<Resultado> {
  try {
    const { supabase } = await ctx("aprovacoes", "editar");
    const { error } = await supabase.from("aprovacao_regras").delete().eq("id", id);
    if (error) throw error;
  } catch (e) {
    return falha(e);
  }
  revalidar();
  return { ok: true };
}

// =============================================================================
// Comunicação interna
// =============================================================================

export async function publicarAviso(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  try {
    const { supabase } = await ctx("equipe", "criar");
    const para = umDe(texto(fd, "para"), ["todos", "equipe", "filial", "papel"] as const, "todos");
    const { error } = await supabase.from("equipe_avisos").insert({
      titulo: textoObrigatorio(fd, "titulo", "o título"),
      texto: textoObrigatorio(fd, "texto", "o aviso"),
      importante: marcado(fd, "importante"),
      fixado: marcado(fd, "fixado"),
      exige_leitura: marcado(fd, "exige_leitura"),
      para,
      equipe_id: para === "equipe" ? texto(fd, "equipe_id") : null,
      filial_id: para === "filial" ? texto(fd, "filial_id") : null,
      papel: para === "papel" ? texto(fd, "papel") : null,
      expira_em: texto(fd, "expira_em"),
    });
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Aviso publicado no mural." };
}

export async function confirmarLeitura(id: string): Promise<Resultado> {
  try {
    const { supabase, usuario } = await ctx();
    const { error } = await supabase.from("equipe_aviso_leituras").upsert({ aviso_id: id, user_id: usuario.id }, { onConflict: "aviso_id,user_id", ignoreDuplicates: true });
    if (error) throw error;
  } catch (e) {
    return falha(e);
  }
  revalidar();
  return { ok: true };
}

export async function alternarFixado(id: string): Promise<Resultado> {
  try {
    const { supabase } = await ctx();
    const { data } = await supabase.from("equipe_avisos").select("fixado").eq("id", id).single();
    const { error } = await supabase.from("equipe_avisos").update({ fixado: !data?.fixado }).eq("id", id);
    if (error) throw error;
  } catch (e) {
    return falha(e);
  }
  revalidar();
  return { ok: true };
}

export async function excluirAviso(id: string): Promise<Resultado> {
  try {
    const { supabase } = await ctx();
    const { error } = await supabase.from("equipe_avisos").delete().eq("id", id);
    if (error) throw error;
  } catch (e) {
    return falha(e);
  }
  revalidar();
  return { ok: true };
}

export async function enviarMensagem(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  try {
    const { supabase } = await ctx();
    const { error } = await supabase.from("equipe_mensagens").insert({ para_id: textoObrigatorio(fd, "para_id", "para quem"), texto: textoObrigatorio(fd, "texto", "a mensagem") });
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Mensagem enviada." };
}

/** Marca como lidas as mensagens recebidas deste colega. */
export async function marcarConversaLida(deUsuario: string): Promise<Resultado> {
  try {
    const { supabase, usuario } = await ctx();
    const { error } = await supabase.from("equipe_mensagens").update({ lida_em: new Date().toISOString() }).eq("para_id", usuario.id).eq("de_id", deUsuario).is("lida_em", null);
    if (error) throw error;
  } catch (e) {
    return falha(e);
  }
  revalidatePath("/equipe/comunicacao", "layout");
  return { ok: true };
}

export async function excluirMensagem(id: string): Promise<Resultado> {
  try {
    const { supabase } = await ctx();
    const { data, error } = await supabase.from("equipe_mensagens").delete().eq("id", id).select("id");
    if (error) throw error;
    if (!data?.length) throw new ErroValidacao("Só quem mandou apaga a mensagem.");
  } catch (e) {
    return falha(e);
  }
  revalidar();
  return { ok: true };
}

// =============================================================================
// Onboarding
// =============================================================================

export async function criarModeloOnboarding(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  let id: string;
  try {
    const { supabase } = await ctx("equipe", "editar");
    const papel = texto(fd, "papel");
    const { data, error } = await supabase
      .from("equipe_onboarding_modelos")
      .insert({ nome: textoObrigatorio(fd, "nome", "o nome do modelo"), descricao: texto(fd, "descricao"), papel: papel && (PAPEIS_USUARIO as readonly string[]).includes(papel) ? papel : null })
      .select("id")
      .single();
    if (error) throw error;
    id = data.id as string;
    if (marcado(fd, "sugerido")) {
      const { error: e2 } = await supabase.from("equipe_onboarding_modelo_itens").insert(MODELO_ONBOARDING_PADRAO.map((i, k) => ({ ...i, modelo_id: id, ordem: k + 1 })));
      if (e2) throw e2;
    }
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  redirect(`/equipe/onboarding/modelos/${id}`);
}

export async function salvarModeloOnboarding(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  try {
    const { supabase } = await ctx("equipe", "editar");
    const papel = texto(fd, "papel");
    const { error } = await supabase
      .from("equipe_onboarding_modelos")
      .update({
        nome: textoObrigatorio(fd, "nome", "o nome do modelo"),
        descricao: texto(fd, "descricao"),
        papel: papel && (PAPEIS_USUARIO as readonly string[]).includes(papel) ? papel : null,
        ativo: marcado(fd, "ativo"),
      })
      .eq("id", textoObrigatorio(fd, "id"));
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Modelo salvo." };
}

export async function excluirModeloOnboarding(id: string): Promise<Resultado> {
  try {
    const { supabase } = await ctx("equipe", "editar");
    const { error } = await supabase.from("equipe_onboarding_modelos").delete().eq("id", id);
    if (error) throw error;
  } catch (e) {
    return falha(e);
  }
  revalidar();
  return { ok: true };
}

function dadosItemModelo(fd: FormData) {
  return {
    titulo: textoObrigatorio(fd, "titulo", "o item"),
    descricao: texto(fd, "descricao"),
    responsavel: umDe(texto(fd, "responsavel"), Object.keys(RESPONSAVEIS_ONBOARDING), "gestor"),
    prazo_dias: Math.max(0, Math.min(365, inteiro(fd, "prazo_dias") ?? 7)),
  };
}

export async function adicionarItemModelo(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  try {
    const { supabase } = await ctx("equipe", "editar");
    const modelo = textoObrigatorio(fd, "modelo_id");
    const { count } = await supabase.from("equipe_onboarding_modelo_itens").select("id", { count: "exact", head: true }).eq("modelo_id", modelo);
    const { error } = await supabase.from("equipe_onboarding_modelo_itens").insert({ ...dadosItemModelo(fd), modelo_id: modelo, ordem: (count ?? 0) + 1 });
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Item incluído." };
}

export async function salvarItemModelo(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  try {
    const { supabase } = await ctx("equipe", "editar");
    const { error } = await supabase
      .from("equipe_onboarding_modelo_itens")
      .update({ ...dadosItemModelo(fd), ordem: inteiro(fd, "ordem") ?? 0 })
      .eq("id", textoObrigatorio(fd, "id"));
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Item salvo." };
}

export async function excluirItemModelo(id: string): Promise<Resultado> {
  try {
    const { supabase } = await ctx("equipe", "editar");
    const { error } = await supabase.from("equipe_onboarding_modelo_itens").delete().eq("id", id);
    if (error) throw error;
  } catch (e) {
    return falha(e);
  }
  revalidar();
  return { ok: true };
}

export async function iniciarOnboarding(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  let id: string;
  try {
    const { supabase } = await ctx("equipe", "editar");
    const { data, error } = await supabase.rpc("iniciar_onboarding", {
      p_pessoa: textoObrigatorio(fd, "pessoa_id", "o colaborador"),
      p_modelo: texto(fd, "modelo_id"),
      p_inicio: texto(fd, "inicio") ?? hojeISO(),
      p_responsavel: texto(fd, "responsavel_id"),
    });
    if (error) throw error;
    id = data as string;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  redirect(`/equipe/onboarding/${id}`);
}

async function marcarItem(id: string, feito: boolean): Promise<Resultado> {
  try {
    const { supabase } = await ctx();
    const { data, error } = await supabase
      .from("equipe_onboarding_itens")
      .update({ concluido_em: feito ? new Date().toISOString() : null })
      .eq("id", id)
      .select("id");
    if (error) throw error;
    if (!data?.length) throw new ErroValidacao("Item não encontrado.");
  } catch (e) {
    return falha(e);
  }
  revalidar();
  return { ok: true };
}
export async function concluirItemOnboarding(id: string) {
  return marcarItem(id, true);
}
export async function reabrirItemOnboarding(id: string) {
  return marcarItem(id, false);
}

export async function adicionarItemOnboarding(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  try {
    const { supabase } = await ctx("equipe", "editar");
    const onb = textoObrigatorio(fd, "onboarding_id");
    const { count } = await supabase.from("equipe_onboarding_itens").select("id", { count: "exact", head: true }).eq("onboarding_id", onb);
    const { error } = await supabase.from("equipe_onboarding_itens").insert({
      onboarding_id: onb,
      ordem: (count ?? 0) + 1,
      titulo: textoObrigatorio(fd, "titulo", "o item"),
      descricao: texto(fd, "descricao"),
      responsavel: umDe(texto(fd, "responsavel"), Object.keys(RESPONSAVEIS_ONBOARDING), "gestor"),
      prazo: texto(fd, "prazo"),
    });
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Item incluído." };
}

export async function excluirItemOnboarding(id: string): Promise<Resultado> {
  try {
    const { supabase } = await ctx("equipe", "editar");
    const { error } = await supabase.from("equipe_onboarding_itens").delete().eq("id", id);
    if (error) throw error;
  } catch (e) {
    return falha(e);
  }
  revalidar();
  return { ok: true };
}

export async function cancelarOnboarding(id: string): Promise<Resultado> {
  try {
    const { supabase } = await ctx("equipe", "editar");
    const { error } = await supabase.from("equipe_onboardings").update({ status: "cancelado" }).eq("id", id);
    if (error) throw error;
  } catch (e) {
    return falha(e);
  }
  revalidar();
  return { ok: true };
}

export async function excluirOnboarding(id: string): Promise<Resultado> {
  try {
    const { supabase } = await ctx("equipe", "editar");
    const { error } = await supabase.from("equipe_onboardings").delete().eq("id", id);
    if (error) throw error;
  } catch (e) {
    return falha(e);
  }
  revalidar();
  return { ok: true };
}
