"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { obterContexto } from "@/lib/contexto";
import { hojeISO, somarDias } from "@/lib/dominio/datas";
import { podeAprovarRepasse } from "@/lib/dominio/repasses";
import { type EstadoAcao, ErroValidacao, inteiro, mensagemErro, numero, texto, textoObrigatorio } from "@/lib/form";

type Resultado = { ok: boolean; erro?: string };

const TIPOS = ["venda", "locacao", "angariacao", "administracao", "outro"];
const TIPOS_REGRA = ["venda", "locacao", "angariacao", "administracao"];

function revalidar() {
  revalidatePath("/comissoes", "layout");
  revalidatePath("/vendas", "layout");
  revalidatePath("/comercial", "layout");
  revalidatePath("/financeiro", "layout");
  revalidatePath("/despesas");
  revalidatePath("/");
}

const falha = (e: unknown): Resultado => ({ ok: false, erro: mensagemErro(e) });

/** Comissões só existem na imobiliária; mexer em valores é de administrador, gestor ou financeiro. */
async function contexto(sensivel = true) {
  const ctx = await obterContexto();
  if (ctx.organizacao.modo === "pessoal") throw new ErroValidacao("Comissões só existem no modo imobiliária.");
  if (sensivel && !podeAprovarRepasse(ctx.papel)) throw new ErroValidacao("Só administrador, gestor ou financeiro mexem em comissões.");
  return ctx;
}

function pct(v: number | null, rotulo = "O percentual") {
  if (v === null || v < 0 || v > 100) throw new ErroValidacao(`${rotulo} deve ficar entre 0% e 100%.`);
  return v;
}

// ---------------------------------------------------------------------------
// Comissões
// ---------------------------------------------------------------------------

/** Comissão avulsa (bônus, acerto, negócio fora do sistema). */
export async function criarComissaoAvulsa(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  let id: string;
  try {
    const { supabase } = await contexto();
    const valor = numero(fd, "valor");
    if (!valor || valor <= 0) throw new ErroValidacao("Informe o valor.");
    const tipo = texto(fd, "tipo") ?? "outro";
    if (!TIPOS.includes(tipo)) throw new ErroValidacao("Tipo inválido.");
    const prevista = fd.getAll("prevista").includes("on");
    const dias = inteiro(fd, "dias_pagamento") ?? 30;
    if (dias < 0 || dias > 365) throw new ErroValidacao("Prazo de pagamento entre 0 e 365 dias.");
    const pessoa_id = textoObrigatorio(fd, "pessoa_id", "o corretor");
    const { data: m } = await supabase.from("equipe_membros").select("equipe_id").eq("pessoa_id", pessoa_id).maybeSingle();
    const { data, error } = await supabase
      .from("comissoes")
      .insert({
        pessoa_id,
        tipo,
        papel: "corretor",
        descricao: textoObrigatorio(fd, "descricao", "a descrição"),
        valor,
        valor_original: valor,
        status: "prevista",
        condicionada: prevista,
        dias_pagamento: dias,
        previsao: texto(fd, "previsao") ?? somarDias(hojeISO(), dias),
        imovel_id: texto(fd, "imovel_id"),
        equipe_id: m?.equipe_id ?? null,
        motivo: texto(fd, "motivo"),
      })
      .select("id")
      .single();
    if (error) throw error;
    id = data.id;
    if (!prevista) {
      const { error: e2 } = await supabase.rpc("liberar_comissao", { p_id: id });
      if (e2) throw e2;
    }
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  redirect(`/comissoes/${id}`);
}

export async function liberarComissao(id: string): Promise<Resultado> {
  try {
    const { supabase } = await contexto();
    const { error } = await supabase.rpc("liberar_comissao", { p_id: id });
    if (error) throw error;
  } catch (e) {
    return falha(e);
  }
  revalidar();
  return { ok: true };
}

export async function ajustarComissao(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  try {
    const { supabase } = await contexto();
    const valor = numero(fd, "valor");
    if (valor === null || valor < 0) throw new ErroValidacao("Informe o novo valor.");
    const { error } = await supabase.rpc("ajustar_comissao", { p_id: textoObrigatorio(fd, "id"), p_valor: valor, p_motivo: textoObrigatorio(fd, "motivo", "o motivo do ajuste") });
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Ajuste registrado." };
}

export async function estornarComissao(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  try {
    const { supabase } = await contexto();
    const { error } = await supabase.rpc("estornar_comissao", { p_id: textoObrigatorio(fd, "id"), p_motivo: textoObrigatorio(fd, "motivo", "o motivo do estorno") });
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Comissão estornada." };
}

export async function dividirComissao(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  try {
    const { supabase } = await contexto();
    const parte = pct(numero(fd, "percentual"), "A parte do outro corretor");
    const { error } = await supabase.rpc("dividir_comissao", { p_id: textoObrigatorio(fd, "id"), p_pessoa: textoObrigatorio(fd, "pessoa_id", "o outro corretor"), p_pct: parte });
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Comissão dividida." };
}

/** Exclui a comissão (a conta a pagar ainda aberta sai junto). Paga: estorne antes. */
export async function excluirComissao(id: string): Promise<Resultado> {
  try {
    const { supabase } = await contexto();
    const { data: c } = await supabase.from("comissoes").select("status, lancamento_id, devolucao_lancamento_id").eq("id", id).maybeSingle();
    if (!c) throw new ErroValidacao("Comissão não encontrada.");
    if (c.status === "paga") throw new ErroValidacao("Comissão paga não pode ser excluída: estorne (com o motivo) para registrar a devolução.");
    if (c.lancamento_id) {
      const { error: e1 } = await supabase.from("lancamentos").delete().eq("id", c.lancamento_id).eq("status", "aberto");
      if (e1) throw e1;
    }
    const { error } = await supabase.from("comissoes").delete().eq("id", id);
    if (error) throw error;
  } catch (e) {
    return falha(e);
  }
  revalidar();
  return { ok: true };
}

export async function gerarComissoesAdministracao(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  try {
    const { supabase } = await contexto();
    const mes = textoObrigatorio(fd, "mes", "o mês");
    if (!/^\d{4}-\d{2}$/.test(mes)) throw new ErroValidacao("Mês inválido.");
    const { data, error } = await supabase.rpc("gerar_comissoes_administracao", { p_competencia: `${mes}-01` });
    if (error) throw error;
    revalidar();
    return { ok: data ? `${data} comissão(ões) de administração criada(s).` : "Nada novo para gerar neste mês (sem regra de administração, sem corretor responsável nos imóveis ou já gerado)." };
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
}

// ---------------------------------------------------------------------------
// Regras
// ---------------------------------------------------------------------------

function dadosRegra(fd: FormData, parcial: boolean) {
  const d: Record<string, unknown> = {};
  if (!parcial || fd.has("nome")) d.nome = texto(fd, "nome");
  if (!parcial || fd.has("tipo")) {
    const t = texto(fd, "tipo") ?? "";
    if (!TIPOS_REGRA.includes(t)) throw new ErroValidacao("Escolha o tipo de negócio.");
    d.tipo = t;
  }
  if (!parcial || fd.has("percentual")) d.percentual = pct(numero(fd, "percentual"));
  if (!parcial || fd.has("dias_pagamento")) {
    const dias = inteiro(fd, "dias_pagamento") ?? 30;
    if (dias < 0 || dias > 365) throw new ErroValidacao("Prazo de pagamento entre 0 e 365 dias.");
    d.dias_pagamento = dias;
  }
  if (!parcial || fd.has("condicionada")) d.condicionada = fd.getAll("condicionada").includes("on");
  // Administração não espera recebimento: a taxa já foi recebida na baixa do aluguel (o banco também recusa).
  if (d.tipo === "administracao") d.condicionada = false;
  if (fd.has("ativa")) d.ativa = fd.getAll("ativa").includes("on");
  if (!parcial || fd.has("quem")) {
    const quem = texto(fd, "quem") ?? "";
    d.pessoa_id = quem.startsWith("p:") ? quem.slice(2) : null;
    d.equipe_id = quem.startsWith("e:") ? quem.slice(2) : null;
  }
  return d;
}

export async function criarRegra(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  try {
    const { supabase } = await contexto();
    const { error } = await supabase.from("comissao_regras").insert(dadosRegra(fd, false));
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Regra criada." };
}

export async function atualizarRegra(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  try {
    const { supabase } = await contexto();
    const id = textoObrigatorio(fd, "id");
    const d = dadosRegra(fd, true);
    if (d.condicionada === true) {
      const { data: r } = await supabase.from("comissao_regras").select("tipo").eq("id", id).maybeSingle();
      if (r?.tipo === "administracao") d.condicionada = false;
    }
    const { error } = await supabase.from("comissao_regras").update(d).eq("id", id);
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Salvo." };
}

export async function excluirRegra(id: string): Promise<Resultado> {
  try {
    const { supabase } = await contexto();
    const { error } = await supabase.from("comissao_regras").delete().eq("id", id);
    if (error) throw error;
  } catch (e) {
    return falha(e);
  }
  revalidar();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Equipes
// ---------------------------------------------------------------------------

export async function criarEquipe(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  try {
    const { supabase } = await contexto();
    const { error } = await supabase.from("equipes").insert({ nome: textoObrigatorio(fd, "nome", "o nome da equipe"), lider_id: texto(fd, "lider_id") });
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Equipe criada." };
}

export async function atualizarEquipe(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  try {
    const { supabase } = await contexto();
    const d: Record<string, unknown> = {};
    if (fd.has("nome")) d.nome = textoObrigatorio(fd, "nome", "o nome da equipe");
    if (fd.has("lider_id")) d.lider_id = texto(fd, "lider_id");
    if (fd.has("ativa")) d.ativa = fd.getAll("ativa").includes("on");
    const { error } = await supabase.from("equipes").update(d).eq("id", textoObrigatorio(fd, "id"));
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Salvo." };
}

export async function excluirEquipe(id: string): Promise<Resultado> {
  try {
    const { supabase } = await contexto();
    const { error } = await supabase.from("equipes").delete().eq("id", id);
    if (error) throw error;
  } catch (e) {
    return falha(e);
  }
  revalidar();
  return { ok: true };
}

/** Põe o corretor na equipe (cada um fica em uma equipe só: sai da anterior). */
export async function adicionarMembro(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  try {
    const { supabase } = await contexto();
    const pessoa_id = textoObrigatorio(fd, "pessoa_id", "o corretor");
    await supabase.from("equipe_membros").delete().eq("pessoa_id", pessoa_id);
    const { error } = await supabase.from("equipe_membros").insert({ equipe_id: textoObrigatorio(fd, "equipe_id"), pessoa_id });
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Corretor incluído na equipe." };
}

export async function removerMembro(id: string): Promise<Resultado> {
  try {
    const { supabase } = await contexto();
    const { error } = await supabase.from("equipe_membros").delete().eq("id", id);
    if (error) throw error;
  } catch (e) {
    return falha(e);
  }
  revalidar();
  return { ok: true };
}
