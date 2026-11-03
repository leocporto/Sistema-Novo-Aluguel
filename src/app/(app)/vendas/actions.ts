"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { obterContexto } from "@/lib/contexto";
import { divisaoInicialDaVenda } from "../comissoes/dados";
import { type EstadoAcao, ErroValidacao, inteiro, lista, mensagemErro, numero, texto, textoObrigatorio } from "@/lib/form";
import { somarMeses } from "@/lib/dominio/datas";
import { formatarReais } from "@/lib/dominio/dinheiro";
import { CHECKLIST_DOCS_VENDA, CHECKLIST_POSSE, ROTULO_ETAPA_VENDA, TODAS_ETAPAS_VENDA, calcularItbi } from "@/lib/dominio/vendas";

type Supabase = Awaited<ReturnType<typeof obterContexto>>["supabase"];
type Resultado = { ok: boolean; erro?: string; url?: string };

function revalidarTudo() {
  revalidatePath("/vendas", "layout");
  revalidatePath("/comercial", "layout");
  revalidatePath("/imoveis", "layout");
  revalidatePath("/financeiro");
  revalidatePath("/despesas");
  revalidatePath("/");
}

async function evento(supabase: Supabase, vendaId: string, tipo: string, descricao: string) {
  await supabase.from("venda_eventos").insert({ venda_id: vendaId, tipo, descricao });
}

const pct = (v: number | null, rotulo: string) => {
  if (v !== null && (v < 0 || v > 100)) throw new ErroValidacao(`${rotulo} deve ficar entre 0% e 100%.`);
  return v;
};

export async function criarVenda(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  let id: string;
  try {
    const imovel_id = textoObrigatorio(fd, "imovel_id", "o imóvel");
    const comprador_id = texto(fd, "comprador_id");
    const lead_id = texto(fd, "lead_id");
    let comprador_nome = texto(fd, "comprador_nome");
    let comprador_telefone = texto(fd, "comprador_telefone");
    if (!comprador_id && !lead_id && !comprador_nome) throw new ErroValidacao("Informe o comprador (pessoa, lead ou nome).");
    if (!comprador_nome && lead_id) {
      const { data } = await supabase.from("leads").select("nome, telefone").eq("id", lead_id).single();
      comprador_nome = data?.nome ?? null;
      comprador_telefone = comprador_telefone ?? data?.telefone ?? null;
    }
    const corretor_id = texto(fd, "corretor_id");
    const { data, error } = await supabase
      .from("vendas")
      .insert({
        imovel_id,
        comprador_id,
        comprador_nome,
        comprador_telefone,
        lead_id,
        corretor_id,
        valor: numero(fd, "valor") ?? 0,
        forma_pagamento: texto(fd, "forma_pagamento") ?? "a_vista",
        comissao_pct: pct(numero(fd, "comissao_pct"), "A comissão") ?? 6,
        status: "negociacao",
        observacoes: texto(fd, "observacoes"),
      })
      .select("id")
      .single();
    if (error) throw error;
    id = data.id;
    // Mesma divisão inicial do aceitar proposta: regras de venda e de angariação (Comissões › Regras).
    const partes = await divisaoInicialDaVenda(supabase, corretor_id, imovel_id);
    if (partes.length) await supabase.from("venda_comissoes").insert(partes.map((p) => ({ ...p, venda_id: id })));
    await evento(supabase, id, "entrada", "Negociação aberta");
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidarTudo();
  redirect(`/vendas/${id}`);
}

const TEXTOS = ["comprador_nome", "comprador_telefone", "banco", "fin_observacoes", "cartorio", "matricula", "pos_venda_texto", "observacoes"];
const DATAS = ["reserva_ate", "aprovado_proprietario_em", "itbi_pago_em", "escritura_data", "registro_data", "posse_data", "pos_venda_contato_em"];
const NUMEROS = ["valor", "valor_financiado", "itbi_valor", "comissao_valor"];

/** Salva sozinho a parte da ficha que veio no formulário. */
export async function atualizarVenda(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  const id = String(fd.get("id"));
  try {
    const d: Record<string, unknown> = {};
    for (const c of [...TEXTOS, ...DATAS]) if (fd.has(c)) d[c] = texto(fd, c);
    for (const c of NUMEROS) if (fd.has(c)) d[c] = numero(fd, c);
    if (fd.has("valor") && (d.valor === null || Number(d.valor) < 0)) d.valor = 0;
    for (const c of ["comprador_id", "lead_id", "corretor_id"]) if (fd.has(c)) d[c] = texto(fd, c);
    if (fd.has("forma_pagamento")) d.forma_pagamento = texto(fd, "forma_pagamento") ?? "a_vista";
    if (fd.has("fin_status")) d.fin_status = texto(fd, "fin_status") ?? "nao_se_aplica";
    if (fd.has("comissao_pct")) d.comissao_pct = pct(numero(fd, "comissao_pct"), "A comissão") ?? 0;
    if (fd.has("itbi_aliquota")) d.itbi_aliquota = pct(numero(fd, "itbi_aliquota"), "A alíquota do ITBI") ?? 0;
    if (fd.has("pos_venda_nota")) {
      const n = inteiro(fd, "pos_venda_nota");
      d.pos_venda_nota = n && n >= 1 && n <= 5 ? n : null;
    }
    const { data: antes } = await supabase.from("vendas").select("fin_status").eq("id", id).single();
    const { error } = await supabase.from("vendas").update(d).eq("id", id);
    if (error) throw error;
    if (d.fin_status && antes && antes.fin_status !== d.fin_status) await evento(supabase, id, "financiamento", `Financiamento: ${String(d.fin_status).replace(/_/g, " ")}`);
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidarTudo();
  return { ok: "Salvo." };
}

/** Muda a etapa (concluir e cancelar têm regras próprias). */
export async function moverVenda(id: string, status: string, motivo?: string | null): Promise<Resultado> {
  const { supabase } = await obterContexto();
  try {
    if (!(TODAS_ETAPAS_VENDA as readonly string[]).includes(status)) throw new ErroValidacao("Etapa inválida.");
    const { data: v, error: e1 } = await supabase.from("vendas").select("status").eq("id", id).single();
    if (e1) throw e1;
    if (v.status === status) return { ok: true };
    if (v.status === "concluida") throw new ErroValidacao("Venda concluída não muda de etapa.");
    if (status === "concluida") {
      const { error } = await supabase.rpc("concluir_venda", { p_id: id });
      if (error) throw error;
    } else {
      if (status === "cancelada" && !motivo) throw new ErroValidacao("Escolha o motivo do cancelamento.");
      const { error } = await supabase
        .from("vendas")
        .update({ status, motivo_cancelamento: status === "cancelada" ? motivo : null })
        .eq("id", id);
      if (error) throw error;
      await evento(supabase, id, status === "cancelada" ? "cancelamento" : "etapa", status === "cancelada" ? `Cancelada: ${motivo}` : `${ROTULO_ETAPA_VENDA[v.status]} → ${ROTULO_ETAPA_VENDA[status]}`);
    }
  } catch (e) {
    return { ok: false, erro: mensagemErro(e) };
  }
  revalidarTudo();
  return { ok: true };
}

export async function mudarEtapaVenda(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const r = await moverVenda(String(fd.get("id")), String(fd.get("status")), texto(fd, "motivo"));
  return r.ok ? { ok: "Etapa atualizada." } : { erro: r.erro };
}

/** Exclui a venda; comissões ainda não pagas saem junto (as pagas ficam no financeiro). */
export async function excluirVenda(id: string): Promise<Resultado> {
  const { supabase } = await obterContexto();
  const { data: v } = await supabase.from("vendas").select("status, imovel_id").eq("id", id).single();
  const { error: e1 } = await supabase.from("lancamentos").delete().eq("venda_id", id).eq("status", "aberto");
  if (e1) return { ok: false, erro: mensagemErro(e1) };
  const { error } = await supabase.from("vendas").delete().eq("id", id);
  if (error) return { ok: false, erro: mensagemErro(error) };
  // Imóvel reservado por esta venda volta a ficar disponível.
  if (v?.imovel_id && v.status !== "concluida") await supabase.from("imoveis").update({ status: "disponivel" }).eq("id", v.imovel_id).eq("status", "reservado");
  revalidarTudo();
  return { ok: true };
}

// Propostas e contrapropostas ----------------------------------------------
export async function criarPropostaVenda(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  try {
    const venda_id = textoObrigatorio(fd, "venda_id");
    const valor = numero(fd, "valor");
    if (!valor || valor <= 0) throw new ErroValidacao("Informe o valor.");
    const { data: v, error: e1 } = await supabase.from("vendas").select("imovel_id, lead_id, corretor_id, comissao_pct, status").eq("id", venda_id).single();
    if (e1) throw e1;
    if (v.status === "concluida" || v.status === "cancelada") throw new ErroValidacao("A venda já está encerrada.");
    const pai = texto(fd, "proposta_pai_id");
    const autor = texto(fd, "autor") === "proprietario" ? "proprietario" : "comprador";
    const { error } = await supabase.from("propostas").insert({
      venda_id,
      proposta_pai_id: pai,
      autor,
      tipo: "venda",
      valor,
      imovel_id: v.imovel_id,
      lead_id: v.lead_id,
      corretor_id: v.corretor_id,
      comissao_pct: v.comissao_pct,
      validade: texto(fd, "validade"),
      condicoes: texto(fd, "condicoes"),
      sinal_valor: numero(fd, "sinal_valor"),
      forma_pagamento: texto(fd, "forma_pagamento"),
    });
    if (error) throw error;
    if (pai) await supabase.from("propostas").update({ status: "contraproposta" }).eq("id", pai).eq("status", "em_negociacao");
    await evento(supabase, venda_id, "proposta", `${pai ? "Contraproposta" : "Proposta"} do ${autor === "proprietario" ? "proprietário" : "comprador"}: ${formatarReais(valor)}`);
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidarTudo();
  return { ok: "Proposta registrada." };
}

export async function aceitarPropostaVenda(id: string): Promise<Resultado> {
  const { supabase } = await obterContexto();
  await supabase.from("propostas").update({ aprovada_proprietario_em: new Date().toISOString().slice(0, 10) }).eq("id", id);
  const { error } = await supabase.rpc("aceitar_proposta", { p_id: id });
  if (error) return { ok: false, erro: mensagemErro(error) };
  revalidarTudo();
  return { ok: true };
}

export async function recusarPropostaVenda(id: string): Promise<Resultado> {
  const { supabase } = await obterContexto();
  const { data, error } = await supabase
    .from("propostas")
    .update({ status: "recusada", fechada_em: new Date().toISOString().slice(0, 10) })
    .eq("id", id)
    .in("status", ["em_negociacao", "contraproposta"])
    .select("venda_id, valor")
    .maybeSingle();
  if (error) return { ok: false, erro: mensagemErro(error) };
  if (data?.venda_id) await evento(supabase, data.venda_id, "proposta", `Proposta de ${formatarReais(data.valor)} recusada`);
  revalidarTudo();
  return { ok: true };
}

export async function concluirVenda(id: string): Promise<Resultado> {
  return moverVenda(id, "concluida");
}

export async function excluirPropostaVenda(id: string): Promise<Resultado> {
  const { supabase } = await obterContexto();
  const { error } = await supabase.from("propostas").delete().eq("id", id);
  if (error) return { ok: false, erro: mensagemErro(error) };
  revalidarTudo();
  return { ok: true };
}

// Pagamentos (sinal, entrada, parcelas, financiamento) ---------------------
export async function adicionarPagamento(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  try {
    const venda_id = textoObrigatorio(fd, "venda_id");
    const valor = numero(fd, "valor");
    if (!valor || valor <= 0) throw new ErroValidacao("Informe o valor.");
    const tipo = texto(fd, "tipo") ?? "parcela";
    const vezes = Math.min(120, Math.max(1, inteiro(fd, "vezes") ?? 1));
    const venc = texto(fd, "vencimento");
    const descricao = texto(fd, "descricao");
    const linhas = Array.from({ length: vezes }, (_, i) => ({
      venda_id,
      tipo,
      valor,
      vencimento: venc ? somarMeses(venc, i) : null,
      descricao: vezes > 1 ? `${descricao ?? "Parcela"} ${i + 1}/${vezes}` : descricao,
      pago_em: vezes === 1 && fd.get("ja_pago") ? (venc ?? new Date().toISOString().slice(0, 10)) : null,
    }));
    const { error } = await supabase.from("venda_pagamentos").insert(linhas);
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidarTudo();
  return { ok: "Pagamento incluído." };
}

export async function alternarPagamento(fd: FormData) {
  const { supabase } = await obterContexto();
  const pagar = String(fd.get("pagar")) === "1";
  const { data } = await supabase
    .from("venda_pagamentos")
    .update({ pago_em: pagar ? new Date().toISOString().slice(0, 10) : null })
    .eq("id", String(fd.get("id")))
    .select("venda_id, valor, tipo")
    .single();
  if (data && pagar) await evento(supabase, data.venda_id, "pagamento", `Recebido ${data.tipo}: ${formatarReais(data.valor)}`);
  revalidarTudo();
}

export async function excluirPagamento(id: string): Promise<Resultado> {
  const { supabase } = await obterContexto();
  const { error } = await supabase.from("venda_pagamentos").delete().eq("id", id);
  if (error) return { ok: false, erro: mensagemErro(error) };
  revalidarTudo();
  return { ok: true };
}

// Despesas de transferência (ITBI, escritura, registro…) --------------------
export async function adicionarDespesaVenda(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  try {
    const valor = numero(fd, "valor");
    if (valor === null || valor < 0) throw new ErroValidacao("Informe o valor.");
    const { error } = await supabase.from("venda_despesas").insert({
      venda_id: textoObrigatorio(fd, "venda_id"),
      tipo: texto(fd, "tipo") ?? "outro",
      descricao: texto(fd, "descricao"),
      valor,
      responsavel: texto(fd, "responsavel") ?? "comprador",
      vencimento: texto(fd, "vencimento"),
    });
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidarTudo();
  return { ok: "Despesa incluída." };
}

/** Calcula o ITBI pela alíquota e cria (ou atualiza) a despesa de ITBI. */
export async function calcularItbiVenda(fd: FormData) {
  const { supabase } = await obterContexto();
  const id = String(fd.get("id"));
  const { data: v } = await supabase.from("vendas").select("valor, itbi_aliquota").eq("id", id).single();
  if (!v) return;
  const valor = calcularItbi(Number(v.valor), Number(v.itbi_aliquota), numero(fd, "valor_venal"));
  await supabase.from("vendas").update({ itbi_valor: valor }).eq("id", id);
  const { data: ja } = await supabase.from("venda_despesas").select("id").eq("venda_id", id).eq("tipo", "itbi").maybeSingle();
  if (ja) await supabase.from("venda_despesas").update({ valor }).eq("id", ja.id);
  else await supabase.from("venda_despesas").insert({ venda_id: id, tipo: "itbi", valor, responsavel: "comprador", descricao: `ITBI ${String(v.itbi_aliquota).replace(".", ",")}%` });
  revalidarTudo();
}

export async function alternarDespesaVenda(fd: FormData) {
  const { supabase } = await obterContexto();
  const pagar = String(fd.get("pagar")) === "1";
  const hoje = new Date().toISOString().slice(0, 10);
  const { data } = await supabase.from("venda_despesas").update({ pago_em: pagar ? hoje : null }).eq("id", String(fd.get("id"))).select("venda_id, tipo").single();
  if (data?.tipo === "itbi") await supabase.from("vendas").update({ itbi_pago_em: pagar ? hoje : null }).eq("id", data.venda_id);
  revalidarTudo();
}

export async function excluirDespesaVenda(id: string): Promise<Resultado> {
  const { supabase } = await obterContexto();
  const { error } = await supabase.from("venda_despesas").delete().eq("id", id);
  if (error) return { ok: false, erro: mensagemErro(error) };
  revalidarTudo();
  return { ok: true };
}

// Comissões ----------------------------------------------------------------
export async function adicionarComissaoVenda(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  try {
    const venda_id = textoObrigatorio(fd, "venda_id");
    const percentual = numero(fd, "percentual");
    if (!percentual || percentual <= 0 || percentual > 100) throw new ErroValidacao("A parte deve ficar entre 0% e 100% da comissão.");
    const { data: atuais } = await supabase.from("venda_comissoes").select("percentual").eq("venda_id", venda_id).neq("papel", "imobiliaria");
    const soma = (atuais ?? []).reduce((s, c) => s + Number(c.percentual), 0);
    if (soma + percentual > 100.0001) throw new ErroValidacao(`Já foram divididos ${soma}% da comissão; sobram ${Math.max(0, 100 - soma)}%.`);
    const { error } = await supabase.from("venda_comissoes").insert({ venda_id, pessoa_id: textoObrigatorio(fd, "pessoa_id", "a pessoa"), papel: texto(fd, "papel") ?? "vendedor", percentual });
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidarTudo();
  return { ok: "Incluído na divisão." };
}

export async function excluirComissaoVenda(id: string): Promise<Resultado> {
  const { supabase } = await obterContexto();
  const { data } = await supabase.from("venda_comissoes").select("lancamento_id").eq("id", id).single();
  if (data?.lancamento_id) return { ok: false, erro: "Esta comissão já foi lançada no financeiro. Exclua o lançamento lá primeiro." };
  const { error } = await supabase.from("venda_comissoes").delete().eq("id", id);
  if (error) return { ok: false, erro: mensagemErro(error) };
  revalidarTudo();
  return { ok: true };
}

// Checklists, documentos e histórico ---------------------------------------
export async function salvarChecklistVenda(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  const qual = String(fd.get("qual")) === "posse" ? "checklist_posse" : "checklist_docs";
  const ids = qual === "checklist_posse" ? CHECKLIST_POSSE.map((i) => i.id) : CHECKLIST_DOCS_VENDA.flatMap((g) => g.itens.map((i) => i.id));
  const marcados = new Set(lista(fd, "item"));
  const { error } = await supabase
    .from("vendas")
    .update({ [qual]: Object.fromEntries(ids.map((i) => [i, marcados.has(i)])) })
    .eq("id", String(fd.get("id")));
  if (error) return { erro: mensagemErro(error) };
  revalidarTudo();
  return { ok: "Salvo." };
}

export async function registrarArquivoVenda(a: { vendaId: string; path: string; nome: string; categoria: string; parte: string }): Promise<Resultado> {
  const { supabase } = await obterContexto();
  const { error } = await supabase.from("venda_arquivos").insert({ venda_id: a.vendaId, path: a.path, nome: a.nome, categoria: a.categoria, parte: a.parte });
  if (error) return { ok: false, erro: mensagemErro(error) };
  revalidarTudo();
  return { ok: true };
}

export async function linkArquivoVenda(id: string): Promise<Resultado> {
  const { supabase } = await obterContexto();
  const { data } = await supabase.from("venda_arquivos").select("path").eq("id", id).single();
  if (!data) return { ok: false, erro: "Arquivo não encontrado." };
  const { data: u, error } = await supabase.storage.from("vendas").createSignedUrl(data.path, 300);
  if (error) return { ok: false, erro: mensagemErro(error) };
  return { ok: true, url: u.signedUrl };
}

export async function excluirArquivoVenda(id: string): Promise<Resultado> {
  const { supabase } = await obterContexto();
  const { data } = await supabase.from("venda_arquivos").select("path").eq("id", id).single();
  if (data?.path) await supabase.storage.from("vendas").remove([data.path]);
  const { error } = await supabase.from("venda_arquivos").delete().eq("id", id);
  if (error) return { ok: false, erro: mensagemErro(error) };
  revalidarTudo();
  return { ok: true };
}

export async function registrarNotaVenda(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  try {
    await evento(supabase, textoObrigatorio(fd, "venda_id"), texto(fd, "tipo") ?? "nota", textoObrigatorio(fd, "descricao", "a anotação"));
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidarTudo();
  return { ok: "Registrado." };
}

export async function excluirEventoVenda(id: string): Promise<Resultado> {
  const { supabase } = await obterContexto();
  const { error } = await supabase.from("venda_eventos").delete().eq("id", id);
  if (error) return { ok: false, erro: mensagemErro(error) };
  revalidarTudo();
  return { ok: true };
}
