"use server";

import { revalidatePath } from "next/cache";
import { obterContexto } from "@/lib/contexto";
import { hojeISO, somarDias } from "@/lib/dominio/datas";
import { ROTULO_TIPO_SOLICITACAO, STATUS_SOLICITACAO, VALIDADES_ARQUIVO, ehPerfilPortal, expiraEm, perfisDoModo, tituloTarefa, type TipoSolicitacao } from "@/lib/dominio/portal";
import { type EstadoAcao, ErroValidacao, inteiro, mensagemErro, texto, textoObrigatorio } from "@/lib/form";
import { arquivosParaCompartilhar } from "./dados";

type Resultado = { ok: boolean; erro?: string };
const MSG_PAPEL = "Só administradores, gestores e o financeiro cuidam do portal.";
const podePortal = (papel: string) => papel !== "corretor";
const falha = (e: unknown): Resultado => ({ ok: false, erro: mensagemErro(e) });

function revalidar(id?: string) {
  revalidatePath("/portais", "layout");
  if (id) revalidatePath(`/portais/${id}`);
}

/** Gera o link do portal (um ativo por pessoa e perfil). Proprietário só na imobiliária (o banco também confere). */
export async function gerarLinkPortal(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase, papel, organizacao } = await obterContexto();
  try {
    if (!podePortal(papel)) throw new ErroValidacao(MSG_PAPEL);
    const perfil = texto(fd, "perfil");
    if (!ehPerfilPortal(perfil) || !perfisDoModo(organizacao.modo).includes(perfil)) throw new ErroValidacao("Perfil inválido.");
    const pessoa = textoObrigatorio(fd, "pessoa_id", "a pessoa");
    const dias = inteiro(fd, "validade") ?? 0;
    const { data: atual } = await supabase.from("portal_acessos").select("id").eq("pessoa_id", pessoa).eq("perfil", perfil).eq("ativo", true).maybeSingle();
    if (atual) throw new ErroValidacao("Esta pessoa já tem link ativo para este perfil. Use “Trocar link” se precisar de um endereço novo.");
    const { error } = await supabase.from("portal_acessos").insert({ pessoa_id: pessoa, perfil, expira_em: expiraEm(dias) });
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Link gerado. Copie ou envie pelo WhatsApp." };
}

/** Endereço novo: o antigo para de funcionar e quem estava dentro precisa entrar de novo. */
export async function trocarLinkPortal(id: string): Promise<Resultado> {
  const { supabase, papel } = await obterContexto();
  if (!podePortal(papel)) return { ok: false, erro: MSG_PAPEL };
  const { error } = await supabase.from("portal_acessos").update({ token: crypto.randomUUID(), ativo: true }).eq("id", id);
  if (error) return falha(error);
  revalidar(id);
  return { ok: true };
}

export async function desativarLinkPortal(id: string): Promise<Resultado> {
  const { supabase, papel } = await obterContexto();
  if (!podePortal(papel)) return { ok: false, erro: MSG_PAPEL };
  const { error } = await supabase.from("portal_acessos").update({ ativo: false }).eq("id", id);
  if (error) return falha(error);
  revalidar(id);
  return { ok: true };
}

export async function reativarLinkPortal(id: string): Promise<Resultado> {
  const { supabase, papel } = await obterContexto();
  if (!podePortal(papel)) return { ok: false, erro: MSG_PAPEL };
  const { data: a } = await supabase.from("portal_acessos").select("expira_em").eq("id", id).maybeSingle();
  const extra = a?.expira_em && a.expira_em <= new Date().toISOString() ? { expira_em: expiraEm(90) } : {};
  const { error } = await supabase.from("portal_acessos").update({ ativo: true, ...extra }).eq("id", id);
  if (error) return falha(error);
  revalidar(id);
  return { ok: true };
}

/** Muda a validade do link (0 = sem data para expirar). */
export async function validadeLinkPortal(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase, papel } = await obterContexto();
  const id = String(fd.get("id") ?? "");
  try {
    if (!podePortal(papel)) throw new ErroValidacao(MSG_PAPEL);
    const { error } = await supabase.from("portal_acessos").update({ expira_em: expiraEm(inteiro(fd, "validade") ?? 0) }).eq("id", id);
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar(id);
  return { ok: "Validade salva." };
}

/** Apaga o link e os arquivos compartilhados. O registro de acessos e os pedidos ficam (o banco anota "Link excluído"). */
export async function excluirLinkPortal(id: string): Promise<Resultado> {
  const { supabase, papel } = await obterContexto();
  if (!podePortal(papel)) return { ok: false, erro: MSG_PAPEL };
  const { error } = await supabase.from("portal_acessos").delete().eq("id", id);
  if (error) return falha(error);
  revalidar();
  return { ok: true };
}

/**
 * Compartilha um arquivo do Storage no portal: gera um link assinado com
 * validade (no máximo 90 dias) e registra em portal_arquivos. Só arquivos
 * ligados à pessoa (documentos, comprovantes, fotos dos chamados dela).
 */
export async function compartilharArquivoPortal(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase, papel } = await obterContexto();
  const acessoId = String(fd.get("acesso_id") ?? "");
  try {
    if (!podePortal(papel)) throw new ErroValidacao(MSG_PAPEL);
    const { data: a } = await supabase.from("portal_acessos").select("id, pessoa_id, perfil, ativo").eq("id", acessoId).maybeSingle();
    if (!a || !ehPerfilPortal(a.perfil)) throw new ErroValidacao("Link do portal não encontrado.");
    const chave = textoObrigatorio(fd, "arquivo", "o arquivo");
    const candidato = (await arquivosParaCompartilhar(supabase, { pessoa_id: a.pessoa_id as string, perfil: a.perfil })).find((c) => c.chave === chave);
    if (!candidato) throw new ErroValidacao("Arquivo não encontrado entre os desta pessoa.");
    const dias = inteiro(fd, "dias") ?? 7;
    if (!(VALIDADES_ARQUIVO as readonly number[]).includes(dias)) throw new ErroValidacao("Escolha a validade.");
    const { data: assinado, error: e1 } = await supabase.storage.from(candidato.bucket).createSignedUrl(candidato.path, dias * 86_400);
    if (e1 || !assinado?.signedUrl) throw new ErroValidacao(`Não foi possível gerar o link do arquivo${e1 ? `: ${e1.message}` : ""}.`);
    const { error } = await supabase.from("portal_arquivos").insert({
      acesso_id: a.id,
      titulo: texto(fd, "titulo") ?? candidato.titulo,
      bucket: candidato.bucket,
      path: candidato.path,
      url: assinado.signedUrl,
      expira_em: new Date(Date.now() + dias * 86_400_000 - 60_000).toISOString(),
    });
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar(acessoId);
  return { ok: "Arquivo compartilhado no portal." };
}

/** Tira o arquivo do portal (o link assinado já enviado continua valendo até expirar). */
export async function removerArquivoPortal(id: string): Promise<Resultado> {
  const { supabase, papel } = await obterContexto();
  if (!podePortal(papel)) return { ok: false, erro: MSG_PAPEL };
  const { error } = await supabase.from("portal_arquivos").delete().eq("id", id);
  if (error) return falha(error);
  revalidar();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Pedidos que chegam pelo portal
// ---------------------------------------------------------------------------

/** Responde o pedido (a resposta aparece no portal da pessoa) e muda a situação. */
export async function tratarSolicitacao(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase, papel } = await obterContexto();
  try {
    if (!podePortal(papel)) throw new ErroValidacao(MSG_PAPEL);
    const status = texto(fd, "status");
    if (!status || !(STATUS_SOLICITACAO as readonly string[]).includes(status)) throw new ErroValidacao("Situação inválida.");
    const { error } = await supabase
      .from("portal_solicitacoes")
      .update({ status, resposta: texto(fd, "resposta") })
      .eq("id", String(fd.get("id") ?? ""));
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Salvo." };
}

type Pedido = { id: string; numero: number; tipo: string; mensagem: string; pessoa_id: string | null; contrato_id: string | null; imovel_id: string | null; tarefa_id: string | null; interacao_id: string | null; status: string; pessoa: { nome: string } | null };

async function pedido(supabase: Awaited<ReturnType<typeof obterContexto>>["supabase"], id: string): Promise<Pedido> {
  const { data } = await supabase.from("portal_solicitacoes").select("id, numero, tipo, mensagem, pessoa_id, contrato_id, imovel_id, tarefa_id, interacao_id, status, pessoa:pessoas(nome)").eq("id", id).maybeSingle();
  if (!data) throw new ErroValidacao("Pedido não encontrado.");
  return data as unknown as Pedido;
}

/** Vira tarefa (Comercial → Tarefas, só imobiliária) e passa para "em andamento". */
export async function criarTarefaDoPedido(id: string): Promise<Resultado> {
  const { supabase, papel, organizacao } = await obterContexto();
  try {
    if (!podePortal(papel)) throw new ErroValidacao(MSG_PAPEL);
    if (organizacao.modo === "pessoal") throw new ErroValidacao("Tarefas existem só no modo imobiliária. Use “Registrar na pessoa”.");
    const p = await pedido(supabase, id);
    if (p.tarefa_id) throw new ErroValidacao("Este pedido já virou tarefa.");
    const prazo = somarDias(hojeISO(), p.tipo === "contato" ? 2 : 5);
    const { data: t, error } = await supabase
      .from("tarefas")
      .insert({
        titulo: tituloTarefa({ numero: p.numero, tipo: p.tipo, nome: p.pessoa?.nome ?? null }),
        vencimento: prazo,
        prioridade: p.tipo === "desocupacao" ? "alta" : "normal",
        contrato_id: p.contrato_id,
        imovel_id: p.imovel_id,
      })
      .select("id")
      .single();
    if (error) throw error;
    const { error: e2 } = await supabase
      .from("portal_solicitacoes")
      .update({ tarefa_id: t.id, status: p.status === "nova" ? "em_andamento" : p.status })
      .eq("id", id);
    if (e2) throw e2;
  } catch (e) {
    return falha(e);
  }
  revalidar();
  revalidatePath("/comercial/tarefas");
  return { ok: true };
}

/** Registra o pedido na linha do tempo da pessoa (Pessoas → Relacionamento), nos dois modos. */
export async function registrarPedidoNaPessoa(id: string): Promise<Resultado> {
  const { supabase, papel } = await obterContexto();
  try {
    if (!podePortal(papel)) throw new ErroValidacao(MSG_PAPEL);
    const p = await pedido(supabase, id);
    if (!p.pessoa_id) throw new ErroValidacao("Este pedido não está ligado a um cadastro.");
    if (p.interacao_id) throw new ErroValidacao("Este pedido já está registrado na pessoa.");
    const rotulo = ROTULO_TIPO_SOLICITACAO[p.tipo as TipoSolicitacao] ?? "Pedido";
    const { data: i, error } = await supabase
      .from("pessoa_interacoes")
      .insert({ pessoa_id: p.pessoa_id, tipo: "nota", descricao: `Pelo portal (pedido nº ${p.numero} · ${rotulo}): ${p.mensagem}`.slice(0, 4000) })
      .select("id")
      .single();
    if (error) throw error;
    const { error: e2 } = await supabase
      .from("portal_solicitacoes")
      .update({ interacao_id: i.id, status: p.status === "nova" ? "em_andamento" : p.status })
      .eq("id", id);
    if (e2) throw e2;
    revalidatePath(`/pessoas/${p.pessoa_id}`, "layout");
  } catch (e) {
    return falha(e);
  }
  revalidar();
  return { ok: true };
}

export async function excluirSolicitacao(id: string): Promise<Resultado> {
  const { supabase, papel } = await obterContexto();
  if (!podePortal(papel)) return { ok: false, erro: MSG_PAPEL };
  const { error } = await supabase.from("portal_solicitacoes").delete().eq("id", id);
  if (error) return falha(error);
  revalidar();
  return { ok: true };
}
