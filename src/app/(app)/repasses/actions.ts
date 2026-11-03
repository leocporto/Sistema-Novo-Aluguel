"use server";

import { revalidatePath } from "next/cache";
import { obterContexto } from "@/lib/contexto";
import { hojeISO } from "@/lib/dominio/datas";
import { paraCentavos, paraReais } from "@/lib/dominio/dinheiro";
import { FORMAS_REPASSE, podeAprovarRepasse } from "@/lib/dominio/repasses";
import { type EstadoAcao, ErroValidacao, lista, mensagemErro, numero, texto, textoObrigatorio } from "@/lib/form";
import { carregarRepasse, donosDoImovel, planoDoRepasse } from "./dados";

type Resultado = { ok: boolean; erro?: string };
type Supabase = Awaited<ReturnType<typeof obterContexto>>["supabase"];

function revalidar() {
  revalidatePath("/repasses", "layout");
  revalidatePath("/financeiro", "layout");
  revalidatePath("/contratos", "layout");
  revalidatePath("/comissoes", "layout");
  revalidatePath("/");
}

const falha = (e: unknown): Resultado => ({ ok: false, erro: mensagemErro(e) });

/** Contexto das ações de repasse: só imobiliária e, quando pedido, só quem pode aprovar/pagar. */
async function contexto(sensivel = true) {
  const ctx = await obterContexto();
  if (ctx.organizacao.modo === "pessoal") throw new ErroValidacao("Repasse só existe no modo imobiliária.");
  if (sensivel && !podeAprovarRepasse(ctx.papel)) throw new ErroValidacao("Só administrador, gestor ou financeiro podem aprovar, pagar ou cancelar repasses.");
  return ctx;
}

/** Aprova um repasse descontando as despesas autorizadas do imóvel (mesma conta da prévia). */
async function aprovarUm(supabase: Supabase, id: string, programado: string | null, descontar: boolean) {
  const r = await carregarRepasse(supabase, id);
  if (!r) throw new ErroValidacao("Repasse não encontrado.");
  const plano = descontar ? (await planoDoRepasse(supabase, r)).filter((d) => d.valor > 0) : [];
  const { error } = await supabase.rpc("aprovar_repasse", {
    p_id: id,
    p: {
      programado_para: programado,
      descontos: plano.map((d) => ({ lancamento_id: d.lancamentoId, valor: paraReais(d.valor), descricao: d.descricao })),
    },
  });
  if (error) throw error;
  return plano.length;
}

export async function aprovarRepasse(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  try {
    const { supabase } = await contexto();
    const id = textoObrigatorio(fd, "id", "o repasse");
    const n = await aprovarUm(supabase, id, texto(fd, "programado_para"), fd.getAll("descontar").includes("on"));
    revalidar();
    return { ok: n ? `Aprovado, com ${n} despesa(s) descontada(s).` : "Aprovado." };
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
}

/** Aprova de uma vez os repasses marcados na lista (com desconto automático das despesas). */
export async function aprovarSelecionados(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  try {
    const { supabase } = await contexto();
    const ids = lista(fd, "ids");
    if (ids.length === 0) throw new ErroValidacao("Marque ao menos um repasse.");
    const programado = texto(fd, "programado_para");
    let feitos = 0;
    const erros: string[] = [];
    for (const id of ids) {
      try {
        await aprovarUm(supabase, id, programado, true);
        feitos++;
      } catch (e) {
        const m = mensagemErro(e);
        if (!erros.includes(m)) erros.push(m);
      }
    }
    revalidar();
    if (!feitos) return { erro: erros[0] ?? "Nenhum repasse aprovado." };
    return { ok: `${feitos} repasse(s) aprovado(s).${erros.length ? ` Não aprovados: ${erros.join(" ")}` : ""}` };
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
}

/** Barra de ações da lista: "aprovar" ou "pagar" os marcados (o botão clicado decide). */
export async function acaoEmLote(estado: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  return fd.get("acao") === "pagar" ? marcarRepassesPagos(estado, fd) : aprovarSelecionados(estado, fd);
}

export async function desfazerAprovacao(id: string): Promise<Resultado> {
  try {
    const { supabase } = await contexto();
    const { error } = await supabase.rpc("desfazer_aprovacao_repasse", { p_id: id });
    if (error) throw error;
  } catch (e) {
    return falha(e);
  }
  revalidar();
  return { ok: true };
}

export async function reagendarRepasse(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  try {
    const { supabase } = await contexto();
    const id = textoObrigatorio(fd, "id", "o repasse");
    const data = textoObrigatorio(fd, "programado_para", "a data do pagamento");
    const { error } = await supabase.from("repasses").update({ programado_para: data }).eq("id", id).eq("status", "pendente");
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Data do pagamento atualizada." };
}

function dadosPagamento(fd: FormData) {
  const forma = texto(fd, "forma_pagamento") ?? "pix";
  if (!(forma in FORMAS_REPASSE)) throw new ErroValidacao("Forma de pagamento inválida.");
  return {
    status: "pago",
    pago_em: texto(fd, "pago_em") ?? hojeISO(),
    forma_pagamento: forma,
    conta_id: texto(fd, "conta_id"),
    comprovante: texto(fd, "comprovante"),
  };
}

/**
 * Antes de pagar: repasse ainda não aprovado é aprovado agora, com o desconto
 * das despesas autorizadas (a mesma conta da aprovação). Se a imobiliária exige
 * aprovação separada, não aprova sozinho: pede para aprovar antes.
 * Devolve os ids prontos para pagar e as mensagens de quem ficou de fora.
 */
async function prepararPagamento(supabase: Supabase, organizacaoId: string, ids: string[]) {
  const [{ data: reps }, { data: org }] = await Promise.all([
    supabase.from("repasses").select("id, status, aprovado_em").in("id", ids),
    supabase.from("organizacoes").select("repasse_exige_aprovacao").eq("id", organizacaoId).maybeSingle(),
  ]);
  const prontos: string[] = [];
  const erros: string[] = [];
  let aprovados = 0;
  for (const r of reps ?? []) {
    if (r.status !== "pendente") continue;
    if (!r.aprovado_em) {
      if (org?.repasse_exige_aprovacao) {
        const m = "Repasse sem aprovação: aprove antes de pagar (a imobiliária exige aprovação).";
        if (!erros.includes(m)) erros.push(m);
        continue;
      }
      try {
        await aprovarUm(supabase, r.id as string, null, true);
        aprovados++;
      } catch (e) {
        const m = mensagemErro(e);
        if (!erros.includes(m)) erros.push(m);
        continue;
      }
    }
    prontos.push(r.id as string);
  }
  return { prontos, erros, aprovados };
}

export async function pagarRepasse(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  try {
    const { supabase, organizacao } = await contexto();
    const id = textoObrigatorio(fd, "id", "o repasse");
    const dados = dadosPagamento(fd);
    const { prontos, erros } = await prepararPagamento(supabase, organizacao.id, [id]);
    if (!prontos.length) throw new ErroValidacao(erros[0] ?? "Este repasse não está pendente.");
    const { error, count } = await supabase.from("repasses").update(dados, { count: "exact" }).eq("id", id).eq("status", "pendente");
    if (error) throw error;
    if (!count) throw new ErroValidacao("Este repasse não está pendente.");
  } catch (e) {
    revalidar();
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Pagamento registrado." };
}

/**
 * Marca como pagos os repasses selecionados na lista. Os ainda não aprovados são
 * aprovados antes (com o desconto das despesas autorizadas), para nenhuma
 * despesa ficar sem descontar.
 */
export async function marcarRepassesPagos(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  try {
    const { supabase, organizacao } = await contexto();
    const ids = lista(fd, "ids");
    if (ids.length === 0) throw new ErroValidacao("Marque ao menos um repasse.");
    const dados = dadosPagamento(fd);
    const { prontos, erros, aprovados } = await prepararPagamento(supabase, organizacao.id, ids);
    let count = 0;
    if (prontos.length) {
      const r = await supabase.from("repasses").update(dados, { count: "exact" }).in("id", prontos).eq("status", "pendente");
      if (r.error) throw r.error;
      count = r.count ?? prontos.length;
    }
    revalidar();
    if (!count) return { erro: erros[0] ?? "Nenhum repasse pendente entre os marcados." };
    return {
      ok: `${count} repasse(s) marcado(s) como pago(s)${aprovados ? ` (${aprovados} aprovado(s) agora, com as despesas autorizadas descontadas)` : ""}.${erros.length ? ` Não pagos: ${erros.join(" ")}` : ""}`,
    };
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
}

export async function desfazerPagamento(id: string): Promise<Resultado> {
  try {
    const { supabase } = await contexto();
    const { error, count } = await supabase
      .from("repasses")
      .update({ status: "pendente", pago_em: null, pago_por: null, conciliado_em: null }, { count: "exact" })
      .eq("id", id)
      .eq("status", "pago");
    if (error) throw error;
    if (!count) throw new ErroValidacao("Este repasse não está pago.");
    await supabase.from("extrato_itens").update({ repasse_id: null }).eq("repasse_id", id);
  } catch (e) {
    return falha(e);
  }
  revalidar();
  return { ok: true };
}

export async function cancelarRepasse(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  try {
    const { supabase } = await contexto();
    const { error } = await supabase.rpc("cancelar_repasse", { p_id: textoObrigatorio(fd, "id"), p_motivo: textoObrigatorio(fd, "motivo", "o motivo") });
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Repasse cancelado." };
}

export async function reabrirRepasse(id: string): Promise<Resultado> {
  try {
    const { supabase } = await contexto();
    const { error } = await supabase.from("repasses").update({ status: "pendente", cancelado_motivo: null }).eq("id", id).eq("status", "cancelado");
    if (error) throw error;
  } catch (e) {
    return falha(e);
  }
  revalidar();
  return { ok: true };
}

/** Exclui só repasse cancelado ou avulso (o que veio do aluguel se desfaz em Aluguéis do mês). */
export async function excluirRepasse(id: string): Promise<Resultado> {
  try {
    const { supabase } = await contexto();
    const { data: r } = await supabase.from("repasses").select("status, fatura_id").eq("id", id).maybeSingle();
    if (!r) throw new ErroValidacao("Repasse não encontrado.");
    if (r.status === "pago") throw new ErroValidacao("Repasse pago não pode ser excluído. Desfaça o pagamento antes.");
    if (r.status !== "cancelado" && r.fatura_id)
      throw new ErroValidacao("Este repasse veio do pagamento de um aluguel. Cancele o repasse (com o motivo) ou desfaça o pagamento em Aluguéis do mês.");
    // Os descontos saem junto e as despesas descontadas voltam a ficar "a descontar" (chaves do banco).
    const { error } = await supabase.from("repasses").delete().eq("id", id);
    if (error) throw error;
  } catch (e) {
    return falha(e);
  }
  revalidar();
  return { ok: true };
}

/** Lança um desconto avulso (com motivo) num repasse pendente. */
export async function descontarAjuste(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  try {
    const { supabase } = await contexto();
    const id = textoObrigatorio(fd, "id", "o repasse");
    const valor = numero(fd, "valor");
    if (!valor || valor <= 0) throw new ErroValidacao("Informe o valor.");
    const motivo = textoObrigatorio(fd, "motivo", "o motivo");
    const { data: r } = await supabase.from("repasses").select("status, outros_descontos, valor_liquido, observacoes").eq("id", id).single();
    if (!r || r.status !== "pendente") throw new ErroValidacao("Só repasses pendentes recebem desconto.");
    if (paraCentavos(r.valor_liquido) < paraCentavos(valor)) throw new ErroValidacao("O desconto é maior que o repasse.");
    const { error } = await supabase
      .from("repasses")
      .update({
        outros_descontos: paraReais(paraCentavos(r.outros_descontos) + paraCentavos(valor)),
        valor_liquido: paraReais(paraCentavos(r.valor_liquido) - paraCentavos(valor)),
        observacoes: [r.observacoes, `Desconto: ${motivo}`].filter(Boolean).join(" · "),
      })
      .eq("id", id)
      .eq("status", "pendente");
    if (error) throw error;
    await supabase.from("repasse_descontos").insert({ repasse_id: id, tipo: "ajuste", descricao: motivo, valor });
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Desconto lançado." };
}

/** Desfaz um desconto avulso (ajuste) enquanto o repasse estiver pendente. */
export async function removerAjuste(id: string): Promise<Resultado> {
  try {
    const { supabase } = await contexto();
    const { data: d } = await supabase.from("repasse_descontos").select("repasse_id, tipo, valor, descricao").eq("id", id).single();
    if (!d) throw new ErroValidacao("Desconto não encontrado.");
    if (d.tipo !== "ajuste") throw new ErroValidacao("Despesa descontada na aprovação: desfaça a aprovação do repasse para devolver.");
    const { data: r } = await supabase.from("repasses").select("status, outros_descontos, valor_liquido, observacoes").eq("id", d.repasse_id).single();
    if (!r || r.status !== "pendente") throw new ErroValidacao("O repasse já foi pago ou cancelado.");
    const { error } = await supabase
      .from("repasses")
      .update({
        outros_descontos: paraReais(paraCentavos(r.outros_descontos) - paraCentavos(d.valor)),
        valor_liquido: paraReais(paraCentavos(r.valor_liquido) + paraCentavos(d.valor)),
        observacoes: [r.observacoes, `Desconto devolvido: ${d.descricao}`].filter(Boolean).join(" · "),
      })
      .eq("id", d.repasse_id);
    if (error) throw error;
    await supabase.from("repasse_descontos").delete().eq("id", id);
  } catch (e) {
    return falha(e);
  }
  revalidar();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Comprovante do pagamento (arquivo no bucket privado "comprovantes")
// ---------------------------------------------------------------------------

export async function salvarComprovanteRepasse(id: string, caminho: string): Promise<Resultado> {
  try {
    const { supabase, organizacao } = await contexto();
    if (!caminho.startsWith(`${organizacao.id}/repasses/${id}/`)) throw new ErroValidacao("Caminho de comprovante inválido.");
    const { error } = await supabase.from("repasses").update({ comprovante_path: caminho }).eq("id", id);
    if (error) throw error;
  } catch (e) {
    return falha(e);
  }
  revalidar();
  return { ok: true };
}

export async function linkComprovanteRepasse(id: string): Promise<{ ok: boolean; url?: string; erro?: string }> {
  const { supabase } = await contexto(false);
  const { data: r } = await supabase.from("repasses").select("comprovante_path").eq("id", id).maybeSingle();
  if (!r?.comprovante_path) return { ok: false, erro: "Este repasse não tem comprovante anexado." };
  const { data, error } = await supabase.storage.from("comprovantes").createSignedUrl(r.comprovante_path as string, 300);
  if (error || !data) return { ok: false, erro: "Não foi possível abrir o comprovante." };
  return { ok: true, url: data.signedUrl };
}

// ---------------------------------------------------------------------------
// Despesas autorizadas (pagas pela imobiliária em nome do proprietário)
// ---------------------------------------------------------------------------

export async function criarDespesaAutorizada(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  try {
    const { supabase } = await contexto(false);
    const valor = numero(fd, "valor");
    if (!valor || valor <= 0) throw new ErroValidacao("Informe o valor.");
    const data = texto(fd, "data") ?? hojeISO();
    const paga = fd.getAll("ja_paga").includes("on");
    const imovel_id = textoObrigatorio(fd, "imovel_id", "o imóvel");
    const descontar_de_id = texto(fd, "descontar_de_id");
    // Só dá para descontar de quem é dono do imóvel (senão a despesa nunca entraria num repasse).
    if (descontar_de_id && !(await donosDoImovel(supabase, imovel_id)).has(descontar_de_id))
      throw new ErroValidacao("Esta pessoa não é proprietária do imóvel escolhido. Escolha um dos donos ou deixe “Todos os proprietários (rateio)”.");
    const { error } = await supabase.from("lancamentos").insert({
      tipo: "pagar",
      descricao: textoObrigatorio(fd, "descricao", "a descrição"),
      categoria: "Despesa do proprietário (descontar no repasse)",
      valor,
      vencimento: data,
      status: paga ? "liquidado" : "aberto",
      liquidado_em: paga ? data : null,
      valor_pago: paga ? valor : null,
      imovel_id,
      descontar_de_id,
      pessoa_id: texto(fd, "pessoa_id"),
      conta_id: texto(fd, "conta_id"),
      observacoes: texto(fd, "observacoes"),
      terceiros: true,
      descontar_repasse: true,
    });
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Despesa registrada. Ela será descontada na aprovação (ou no pagamento) do próximo repasse do imóvel." };
}

export async function excluirDespesaAutorizada(id: string): Promise<Resultado> {
  try {
    const { supabase } = await contexto(false);
    const { count } = await supabase.from("repasse_descontos").select("id", { count: "exact", head: true }).eq("lancamento_id", id);
    if (count) throw new ErroValidacao("Esta despesa já foi descontada de um repasse. Desfaça a aprovação do repasse antes de excluir.");
    const { error } = await supabase.from("lancamentos").delete().eq("id", id).eq("descontar_repasse", true);
    if (error) throw error;
  } catch (e) {
    return falha(e);
  }
  revalidar();
  return { ok: true };
}

/** Tira a despesa da fila de desconto (continua no financeiro como despesa da imobiliária). */
export async function naoDescontarDespesa(id: string): Promise<Resultado> {
  try {
    const { supabase } = await contexto();
    const { count } = await supabase.from("repasse_descontos").select("id", { count: "exact", head: true }).eq("lancamento_id", id);
    if (count) throw new ErroValidacao("Esta despesa já foi descontada (em parte) de um repasse.");
    const { error } = await supabase.from("lancamentos").update({ descontar_repasse: false }).eq("id", id);
    if (error) throw error;
  } catch (e) {
    return falha(e);
  }
  revalidar();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Configuração
// ---------------------------------------------------------------------------

export async function salvarConfigRepasses(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  try {
    const { supabase, organizacao, papel } = await contexto(false);
    if (papel !== "admin" && papel !== "gestor") throw new ErroValidacao("Só administrador ou gestor muda esta regra.");
    if (fd.has("repasse_exige_aprovacao")) {
      const { error } = await supabase
        .from("organizacoes")
        .update({ repasse_exige_aprovacao: fd.getAll("repasse_exige_aprovacao").includes("on") })
        .eq("id", organizacao.id);
      if (error) throw error;
    }
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Salvo." };
}
