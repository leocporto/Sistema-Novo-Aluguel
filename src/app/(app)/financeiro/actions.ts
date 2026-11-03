"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { obterContexto } from "@/lib/contexto";
import { hojeISO, inicioDoMes, somarMeses } from "@/lib/dominio/datas";
import { paraCentavos, paraReais, percentual } from "@/lib/dominio/dinheiro";
import { gerarSerie, lerExtrato, planoPadrao, precisaAprovacao, valorDaBaixa, type Repeticao } from "@/lib/dominio/financeiro";
import { type EstadoAcao, ErroValidacao, booleano, inteiro, mensagemErro, numero, texto, textoObrigatorio } from "@/lib/form";
import { sugestoesDeConciliacao } from "./dados";

type Resultado = { ok: boolean; erro?: string };

function revalidar() {
  revalidatePath("/financeiro", "layout");
  revalidatePath("/despesas");
  revalidatePath("/repasses");
  revalidatePath("/faturas");
  revalidatePath("/");
}

const podeAprovar = (papel: string) => papel === "admin" || papel === "gestor";
const falha = (e: unknown): Resultado => ({ ok: false, erro: mensagemErro(e) });

// ---------------------------------------------------------------------------
// Lançamentos
// ---------------------------------------------------------------------------

export async function criarLancamento(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase, organizacao } = await obterContexto();
  try {
    const tipo = texto(fd, "tipo") === "receber" ? "receber" : "pagar";
    const valor = numero(fd, "valor");
    if (!valor || valor <= 0) throw new ErroValidacao("Informe o valor.");
    const repeticao = (["nao", "mensal", "parcelado"].includes(texto(fd, "repeticao") ?? "") ? texto(fd, "repeticao") : "nao") as Repeticao;
    const vezes = inteiro(fd, "vezes") ?? 1;
    if (repeticao !== "nao" && (vezes < 2 || vezes > 120)) throw new ErroValidacao("Repetir: informe de 2 a 120 vezes.");
    const serie = gerarSerie({ descricao: textoObrigatorio(fd, "descricao", "a descrição"), valor, vencimento: textoObrigatorio(fd, "vencimento", "o vencimento"), repeticao, vezes });
    const { data: org } = await supabase.from("organizacoes").select("aprovacao_pagamento_acima").eq("id", organizacao.id).single();
    const limite = org?.aprovacao_pagamento_acima == null ? null : Number(org.aprovacao_pagamento_acima);
    const serie_id = serie.length > 1 ? crypto.randomUUID() : null;
    const pagoJa = booleano(fd, "ja_pago");
    const comum = {
      tipo,
      categoria: texto(fd, "categoria"),
      pessoa_id: texto(fd, "pessoa_id"),
      conta_id: texto(fd, "conta_id"),
      plano_id: texto(fd, "plano_id"),
      centro_custo_id: texto(fd, "centro_custo_id"),
      imovel_id: texto(fd, "imovel_id"),
      forma: texto(fd, "forma"),
      documento_numero: texto(fd, "documento_numero"),
      observacoes: texto(fd, "observacoes"),
      terceiros: organizacao.modo !== "pessoal" && booleano(fd, "terceiros"),
      serie_id,
    };
    const linhas = serie.map((s, i) => {
      const aprovar = precisaAprovacao(tipo, s.valor, limite);
      const baixar = pagoJa && i === 0 && !aprovar;
      return {
        ...comum,
        descricao: s.descricao,
        valor: s.valor,
        vencimento: s.vencimento,
        parcela: s.parcela,
        parcelas: s.parcelas,
        requer_aprovacao: aprovar,
        status: baixar ? "liquidado" : "aberto",
        liquidado_em: baixar ? s.vencimento : null,
        valor_pago: baixar ? s.valor : null,
      };
    });
    const { error } = await supabase.from("lancamentos").insert(linhas);
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Lançamento criado." };
}

const CAMPOS_TEXTO = ["descricao", "categoria", "pessoa_id", "conta_id", "plano_id", "centro_custo_id", "forma", "documento_numero", "observacoes", "imovel_id"];

export async function atualizarLancamento(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase, organizacao } = await obterContexto();
  const id = String(fd.get("id"));
  try {
    const { data: atual } = await supabase.from("lancamentos").select("status, tipo, aprovado_em").eq("id", id).single();
    if (!atual) throw new ErroValidacao("Lançamento não encontrado.");
    const d: Record<string, unknown> = {};
    for (const c of CAMPOS_TEXTO) if (fd.has(c)) d[c] = texto(fd, c);
    if (fd.has("descricao") && !d.descricao) throw new ErroValidacao("A descrição não pode ficar vazia.");
    if (fd.has("vencimento")) d.vencimento = textoObrigatorio(fd, "vencimento", "o vencimento");
    if (fd.has("terceiros")) d.terceiros = organizacao.modo !== "pessoal" && fd.getAll("terceiros").includes("on");
    if (fd.has("valor")) {
      if (atual.status === "liquidado") throw new ErroValidacao("Para mudar o valor de um lançamento baixado, estorne a baixa antes.");
      const v = numero(fd, "valor");
      if (!v || v <= 0) throw new ErroValidacao("Informe o valor.");
      d.valor = v;
      const { data: org } = await supabase.from("organizacoes").select("aprovacao_pagamento_acima").eq("id", organizacao.id).single();
      if (!atual.aprovado_em) d.requer_aprovacao = precisaAprovacao(atual.tipo, v, org?.aprovacao_pagamento_acima == null ? null : Number(org.aprovacao_pagamento_acima));
    }
    const { error } = await supabase.from("lancamentos").update(d).eq("id", id);
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Salvo." };
}

export async function baixarLancamento(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  const id = String(fd.get("id"));
  try {
    const { data: l } = await supabase.from("lancamentos").select("status, valor, requer_aprovacao, aprovado_em").eq("id", id).single();
    if (!l) throw new ErroValidacao("Lançamento não encontrado.");
    if (l.status !== "aberto") throw new ErroValidacao("Este lançamento não está em aberto.");
    if (l.requer_aprovacao && !l.aprovado_em) throw new ErroValidacao("Este pagamento precisa ser aprovado por um administrador ou gestor antes da baixa.");
    const juros = numero(fd, "juros") ?? 0;
    const desconto = numero(fd, "desconto") ?? 0;
    if (juros < 0 || desconto < 0) throw new ErroValidacao("Juros e desconto não podem ser negativos.");
    const informado = numero(fd, "valor_pago");
    const valor_pago = informado ?? valorDaBaixa(Number(l.valor), juros, desconto);
    if (valor_pago <= 0) throw new ErroValidacao("Informe o valor pago.");
    const { error } = await supabase
      .from("lancamentos")
      .update({
        status: "liquidado",
        liquidado_em: texto(fd, "liquidado_em") ?? hojeISO(),
        valor_pago,
        juros,
        desconto,
        conta_id: texto(fd, "conta_id"),
        forma: texto(fd, "forma"),
      })
      .eq("id", id)
      .eq("status", "aberto");
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Baixa registrada." };
}

export async function estornarLancamento(id: string): Promise<Resultado> {
  const { supabase } = await obterContexto();
  const { data: l } = await supabase.from("lancamentos").select("fatura_id, status").eq("id", id).maybeSingle();
  if (!l) return { ok: false, erro: "Lançamento não encontrado." };
  if (l.fatura_id) return { ok: false, erro: "Este lançamento veio do pagamento de um aluguel. Desfaça o pagamento em Aluguéis do mês." };
  const { error } = await supabase
    .from("lancamentos")
    .update({ status: "aberto", liquidado_em: null, valor_pago: null, juros: 0, desconto: 0, conciliado_em: null })
    .eq("id", id)
    .eq("status", "liquidado");
  if (error) return falha(error);
  await supabase.from("extrato_itens").update({ lancamento_id: null }).eq("lancamento_id", id);
  revalidar();
  return { ok: true };
}

export async function cancelarLancamento(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  const id = String(fd.get("id"));
  try {
    const motivo = textoObrigatorio(fd, "motivo", "o motivo do cancelamento");
    const { error } = await supabase.from("lancamentos").update({ status: "cancelado", cancelado_motivo: motivo }).eq("id", id).eq("status", "aberto");
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Cancelado." };
}

export async function reabrirLancamento(id: string): Promise<Resultado> {
  const { supabase } = await obterContexto();
  const { error } = await supabase.from("lancamentos").update({ status: "aberto", cancelado_motivo: null }).eq("id", id).eq("status", "cancelado");
  if (error) return falha(error);
  revalidar();
  return { ok: true };
}

export async function aprovarLancamento(id: string): Promise<Resultado> {
  const { supabase, papel, usuario } = await obterContexto();
  if (!podeAprovar(papel)) return { ok: false, erro: "Só administradores e gestores aprovam pagamentos." };
  const { error } = await supabase.from("lancamentos").update({ aprovado_em: new Date().toISOString(), aprovado_por: usuario.id }).eq("id", id);
  if (error) return falha(error);
  revalidar();
  return { ok: true };
}

export async function excluirLancamento(id: string): Promise<Resultado> {
  const { supabase } = await obterContexto();
  const { data } = await supabase.from("lancamentos").select("fatura_id").eq("id", id).maybeSingle();
  if (data?.fatura_id) return { ok: false, erro: "Este lançamento foi gerado pelo pagamento de um aluguel. Para tirar, desfaça o pagamento em Aluguéis do mês." };
  const { error } = await supabase.from("lancamentos").delete().eq("id", id);
  if (error) return falha(error);
  revalidar();
  return { ok: true };
}

/** Exclui este e os próximos lançamentos em aberto da mesma série. */
export async function excluirProximosDaSerie(id: string): Promise<Resultado> {
  const { supabase } = await obterContexto();
  const { data: l } = await supabase.from("lancamentos").select("serie_id, vencimento").eq("id", id).maybeSingle();
  if (!l?.serie_id) return excluirLancamento(id);
  const { error } = await supabase.from("lancamentos").delete().eq("serie_id", l.serie_id).gte("vencimento", l.vencimento).neq("status", "liquidado").is("fatura_id", null);
  if (error) return falha(error);
  revalidar();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Contas e transferências
// ---------------------------------------------------------------------------

function dadosConta(fd: FormData, parcial: boolean) {
  const d: Record<string, unknown> = {};
  for (const c of ["nome", "banco", "agencia", "conta", "pix_chave"]) if (!parcial || fd.has(c)) d[c] = texto(fd, c);
  if (!parcial || fd.has("tipo")) d.tipo = texto(fd, "tipo") ?? "corrente";
  if (!parcial || fd.has("saldo_inicial")) d.saldo_inicial = numero(fd, "saldo_inicial") ?? 0;
  if (!parcial || fd.has("saldo_inicial_em")) d.saldo_inicial_em = texto(fd, "saldo_inicial_em") ?? hojeISO();
  if (!parcial || fd.has("terceiros")) d.terceiros = fd.getAll("terceiros").includes("on");
  if (fd.has("ativa")) d.ativa = fd.getAll("ativa").includes("on");
  if ("nome" in d && !d.nome) throw new ErroValidacao("Informe o nome da conta.");
  return d;
}

export async function criarConta(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  try {
    const { error } = await supabase.from("contas_financeiras").insert(dadosConta(fd, false));
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Conta cadastrada." };
}

export async function atualizarConta(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  try {
    const { error } = await supabase.from("contas_financeiras").update(dadosConta(fd, true)).eq("id", String(fd.get("id")));
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Salvo." };
}

export async function excluirConta(id: string): Promise<Resultado> {
  const { supabase } = await obterContexto();
  const { error } = await supabase.from("contas_financeiras").delete().eq("id", id);
  if (error) return falha(error);
  revalidar();
  return { ok: true };
}

export async function criarTransferencia(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  try {
    const origem_id = textoObrigatorio(fd, "origem_id", "a conta de origem");
    const destino_id = textoObrigatorio(fd, "destino_id", "a conta de destino");
    if (origem_id === destino_id) throw new ErroValidacao("Escolha contas diferentes.");
    const valor = numero(fd, "valor");
    if (!valor || valor <= 0) throw new ErroValidacao("Informe o valor.");
    const { error } = await supabase.from("transferencias").insert({ origem_id, destino_id, valor, data: texto(fd, "data") ?? hojeISO(), descricao: texto(fd, "descricao") });
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Transferência registrada." };
}

export async function excluirTransferencia(id: string): Promise<Resultado> {
  const { supabase } = await obterContexto();
  const { error } = await supabase.from("transferencias").delete().eq("id", id);
  if (error) return falha(error);
  revalidar();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Extrato e conciliação
// ---------------------------------------------------------------------------

export async function importarExtrato(contaId: string, conteudo: string): Promise<{ ok: boolean; erro?: string; novos?: number; repetidos?: number }> {
  const { supabase } = await obterContexto();
  if (conteudo.length > 5_000_000) return { ok: false, erro: "Arquivo grande demais (máx. 5 MB)." };
  const itens = lerExtrato(conteudo);
  if (!itens.length) return { ok: false, erro: "Não achei movimentos no arquivo. Use o extrato em OFX (recomendado) ou CSV com data, descrição e valor." };
  const { data: existentes } = await supabase.from("extrato_itens").select("fitid").eq("conta_id", contaId);
  const ja = new Set((existentes ?? []).map((e) => e.fitid));
  const novos = itens.filter((i) => !ja.has(i.fitid));
  if (novos.length) {
    const { error } = await supabase.from("extrato_itens").insert(novos.map((i) => ({ ...i, conta_id: contaId })));
    if (error) return falha(error);
  }
  revalidar();
  return { ok: true, novos: novos.length, repetidos: itens.length - novos.length };
}

/**
 * Concilia uma linha do extrato com um lançamento, aluguel ou repasse.
 * `ref` = "<itemId>|l:<id>" | "<itemId>|f:<id>" | "<itemId>|r:<id>".
 * Lançamento ou repasse em aberto recebe a baixa na data e no valor do extrato.
 */
export async function conciliarItem(ref: string): Promise<Resultado> {
  const { supabase } = await obterContexto();
  const [itemId, alvo] = ref.split("|");
  const [tipo, id] = (alvo ?? "").split(":");
  const { data: item } = await supabase.from("extrato_itens").select("*").eq("id", itemId).maybeSingle();
  if (!item || !id) return { ok: false, erro: "Linha do extrato não encontrada." };
  const agora = new Date().toISOString();
  const valor = Math.abs(Number(item.valor));
  try {
    if (tipo === "l") {
      const { data: l } = await supabase.from("lancamentos").select("status, valor, requer_aprovacao, aprovado_em").eq("id", id).single();
      if (!l) throw new ErroValidacao("Lançamento não encontrado.");
      if (l.status === "aberto" && l.requer_aprovacao && !l.aprovado_em) throw new ErroValidacao("Este pagamento ainda precisa de aprovação.");
      const diff = paraReais(paraCentavos(valor) - paraCentavos(Number(l.valor)));
      const upd =
        l.status === "aberto"
          ? { status: "liquidado", liquidado_em: item.data, valor_pago: valor, juros: diff > 0 ? diff : 0, desconto: diff < 0 ? -diff : 0, conta_id: item.conta_id, conciliado_em: agora }
          : { conta_id: item.conta_id, conciliado_em: agora };
      const { error } = await supabase.from("lancamentos").update(upd).eq("id", id);
      if (error) throw error;
      await supabase.from("extrato_itens").update({ lancamento_id: id, ignorado: false }).eq("id", itemId);
    } else if (tipo === "f") {
      const { data: f } = await supabase.from("faturas").select("status").eq("id", id).single();
      if (f?.status !== "paga") throw new ErroValidacao("Dê baixa no aluguel em Aluguéis do mês primeiro (lá entram multa, juros e repasse); depois concilie.");
      const { error } = await supabase.from("faturas").update({ conta_id: item.conta_id, conciliado_em: agora }).eq("id", id);
      if (error) throw error;
      await supabase.from("extrato_itens").update({ fatura_id: id, ignorado: false }).eq("id", itemId);
    } else if (tipo === "r") {
      const { data: r } = await supabase.from("repasses").select("status").eq("id", id).single();
      const upd = r?.status === "pendente" ? { status: "pago", pago_em: item.data, conta_id: item.conta_id, conciliado_em: agora } : { conta_id: item.conta_id, conciliado_em: agora };
      const { error } = await supabase.from("repasses").update(upd).eq("id", id);
      if (error) throw error;
      await supabase.from("extrato_itens").update({ repasse_id: id, ignorado: false }).eq("id", itemId);
    } else throw new ErroValidacao("Escolha o que corresponde a esta linha.");
  } catch (e) {
    return falha(e);
  }
  revalidar();
  return { ok: true };
}

/** Baixa automática: concilia de uma vez as linhas do extrato com uma única correspondência. */
export async function conciliarSugestoes(contaId: string): Promise<Resultado> {
  const { supabase, organizacao } = await obterContexto();
  const { data } = await supabase
    .from("extrato_itens")
    .select("id, data, valor, descricao")
    .eq("conta_id", contaId)
    .eq("ignorado", false)
    .is("lancamento_id", null)
    .is("fatura_id", null)
    .is("repasse_id", null)
    .limit(1000);
  const sugestoes = await sugestoesDeConciliacao(supabase, organizacao.modo === "pessoal", (data ?? []).map((i) => ({ ...i, valor: Number(i.valor) })));
  let feitos = 0;
  const erros: string[] = [];
  for (const [itemId, cands] of sugestoes) {
    if (cands.length !== 1) continue;
    const r = await conciliarItem(`${itemId}|${cands[0].id}`);
    if (r.ok) feitos++;
    else if (r.erro && !erros.includes(r.erro)) erros.push(r.erro);
  }
  revalidar();
  if (!feitos) return { ok: false, erro: erros[0] ?? "Nenhuma linha com correspondência única para conciliar." };
  return { ok: true };
}

/** Cria um lançamento já baixado a partir de uma linha do extrato (ex.: tarifa bancária, rendimento). */
export async function lancarItemExtrato(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  const itemId = String(fd.get("item_id"));
  try {
    const { data: item } = await supabase.from("extrato_itens").select("*").eq("id", itemId).single();
    if (!item) throw new ErroValidacao("Linha não encontrada.");
    const valor = Math.abs(Number(item.valor));
    const { data: l, error } = await supabase
      .from("lancamentos")
      .insert({
        tipo: Number(item.valor) >= 0 ? "receber" : "pagar",
        descricao: texto(fd, "descricao") ?? item.descricao,
        plano_id: texto(fd, "plano_id"),
        centro_custo_id: texto(fd, "centro_custo_id"),
        pessoa_id: texto(fd, "pessoa_id"),
        categoria: texto(fd, "categoria"),
        valor,
        valor_pago: valor,
        vencimento: item.data,
        liquidado_em: item.data,
        status: "liquidado",
        conta_id: item.conta_id,
        documento_numero: item.documento,
        conciliado_em: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (error) throw error;
    await supabase.from("extrato_itens").update({ lancamento_id: l.id, ignorado: false }).eq("id", itemId);
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Lançado e conciliado." };
}

export async function ignorarItemExtrato(id: string): Promise<Resultado> {
  const { supabase } = await obterContexto();
  const { data } = await supabase.from("extrato_itens").select("ignorado").eq("id", id).single();
  const { error } = await supabase.from("extrato_itens").update({ ignorado: !data?.ignorado }).eq("id", id);
  if (error) return falha(error);
  revalidar();
  return { ok: true };
}

/** Desfaz a conciliação (a baixa feita pela conciliação continua; estorne no lançamento, se quiser). */
export async function desfazerConciliacao(id: string): Promise<Resultado> {
  const { supabase } = await obterContexto();
  const { data: i } = await supabase.from("extrato_itens").select("lancamento_id, fatura_id, repasse_id").eq("id", id).single();
  if (i?.lancamento_id) await supabase.from("lancamentos").update({ conciliado_em: null }).eq("id", i.lancamento_id);
  if (i?.fatura_id) await supabase.from("faturas").update({ conciliado_em: null }).eq("id", i.fatura_id);
  if (i?.repasse_id) await supabase.from("repasses").update({ conciliado_em: null }).eq("id", i.repasse_id);
  const { error } = await supabase.from("extrato_itens").update({ lancamento_id: null, fatura_id: null, repasse_id: null }).eq("id", id);
  if (error) return falha(error);
  revalidar();
  return { ok: true };
}

export async function excluirItemExtrato(id: string): Promise<Resultado> {
  const { supabase } = await obterContexto();
  const { error } = await supabase.from("extrato_itens").delete().eq("id", id);
  if (error) return falha(error);
  revalidar();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Plano de contas, centros de custo e regras
// ---------------------------------------------------------------------------

export async function instalarPlanoPadrao(modo: string): Promise<Resultado> {
  const { supabase, organizacao } = await obterContexto();
  const { data: atuais } = await supabase.from("plano_contas").select("codigo");
  const tem = new Set((atuais ?? []).map((a) => a.codigo));
  const novos = planoPadrao(organizacao.modo === "pessoal" || modo === "pessoal" ? "pessoal" : "imobiliaria").filter((c) => !tem.has(c.codigo));
  if (novos.length) {
    const { error } = await supabase.from("plano_contas").insert(novos);
    if (error) return falha(error);
  }
  revalidar();
  return { ok: true };
}

function dadosPlano(fd: FormData, parcial: boolean) {
  const d: Record<string, unknown> = {};
  if (!parcial || fd.has("codigo")) d.codigo = textoObrigatorio(fd, "codigo", "o código");
  if (!parcial || fd.has("nome")) d.nome = textoObrigatorio(fd, "nome", "o nome");
  if (!parcial || fd.has("tipo")) d.tipo = texto(fd, "tipo") === "receita" ? "receita" : "despesa";
  if (!parcial || fd.has("grupo_dre")) d.grupo_dre = texto(fd, "grupo_dre") ?? "outros";
  if (fd.has("ativo")) d.ativo = fd.getAll("ativo").includes("on");
  return d;
}

export async function criarPlano(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  try {
    const { error } = await supabase.from("plano_contas").insert(dadosPlano(fd, false));
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Conta do plano criada." };
}

export async function atualizarPlano(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  try {
    const { error } = await supabase.from("plano_contas").update(dadosPlano(fd, true)).eq("id", String(fd.get("id")));
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Salvo." };
}

export async function excluirPlano(id: string): Promise<Resultado> {
  const { supabase } = await obterContexto();
  const { error } = await supabase.from("plano_contas").delete().eq("id", id);
  if (error) return falha(error);
  revalidar();
  return { ok: true };
}

export async function criarCentro(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  try {
    const { error } = await supabase.from("centros_custo").insert({ nome: textoObrigatorio(fd, "nome", "o nome") });
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Centro de custo criado." };
}

export async function excluirCentro(id: string): Promise<Resultado> {
  const { supabase } = await obterContexto();
  const { error } = await supabase.from("centros_custo").delete().eq("id", id);
  if (error) return falha(error);
  revalidar();
  return { ok: true };
}

export async function salvarRegrasFinanceiro(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase, organizacao, papel } = await obterContexto();
  try {
    if (!podeAprovar(papel)) throw new ErroValidacao("Só administradores e gestores mudam esta regra.");
    const d: Record<string, unknown> = {};
    if (fd.has("aprovacao_pagamento_acima")) {
      const v = numero(fd, "aprovacao_pagamento_acima");
      d.aprovacao_pagamento_acima = v && v > 0 ? v : null;
    }
    if (fd.has("aliquota_iss")) {
      const a = numero(fd, "aliquota_iss") ?? 0;
      if (a < 0 || a > 10) throw new ErroValidacao("A alíquota do ISS fica entre 0% e 10%.");
      d.aliquota_iss = a;
    }
    const { error } = await supabase.from("organizacoes").update(d).eq("id", organizacao.id);
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Salvo." };
}

// ---------------------------------------------------------------------------
// Orçamento
// ---------------------------------------------------------------------------

export async function salvarOrcamento(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  try {
    const competencia = inicioDoMes(textoObrigatorio(fd, "competencia", "o mês"));
    const plano_id = textoObrigatorio(fd, "plano_id", "a conta");
    const valor = numero(fd, "valor");
    if (valor === null || valor <= 0) {
      await supabase.from("orcamentos").delete().eq("competencia", competencia).eq("plano_id", plano_id);
    } else {
      const { error } = await supabase.from("orcamentos").upsert({ competencia, plano_id, valor }, { onConflict: "organizacao_id,competencia,plano_id" });
      if (error) throw error;
    }
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidatePath("/financeiro/orcamento");
  return { ok: "Salvo." };
}

/** Copia o orçamento deste mês para os 11 meses seguintes (substitui o que houver). */
export async function copiarOrcamento(competencia: string): Promise<Resultado> {
  const { supabase } = await obterContexto();
  const mes = inicioDoMes(competencia);
  const { data } = await supabase.from("orcamentos").select("plano_id, valor").eq("competencia", mes);
  if (!data?.length) return { ok: false, erro: "Preencha o orçamento deste mês antes de copiar." };
  const linhas = Array.from({ length: 11 }, (_, i) => somarMeses(mes, i + 1)).flatMap((c) => data.map((o) => ({ competencia: c, plano_id: o.plano_id, valor: o.valor })));
  const { error } = await supabase.from("orcamentos").upsert(linhas, { onConflict: "organizacao_id,competencia,plano_id" });
  if (error) return falha(error);
  revalidatePath("/financeiro/orcamento");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Proprietários: adiantamentos (só imobiliária)
// ---------------------------------------------------------------------------

export async function registrarAdiantamento(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase, organizacao } = await obterContexto();
  try {
    if (organizacao.modo === "pessoal") throw new ErroValidacao("Adiantamento a proprietário só existe no modo imobiliária.");
    const pessoa_id = textoObrigatorio(fd, "pessoa_id", "o proprietário");
    const valor = numero(fd, "valor");
    if (!valor || valor <= 0) throw new ErroValidacao("Informe o valor.");
    const data = texto(fd, "data") ?? hojeISO();
    const { error } = await supabase.from("lancamentos").insert({
      tipo: "pagar",
      descricao: texto(fd, "descricao") ?? "Adiantamento ao proprietário",
      categoria: "Adiantamento a proprietário",
      valor,
      valor_pago: valor,
      vencimento: data,
      liquidado_em: data,
      status: "liquidado",
      pessoa_id,
      conta_id: texto(fd, "conta_id"),
      adiantamento: true,
      terceiros: true,
    });
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Adiantamento registrado." };
}

/** Desconta o adiantamento no próximo repasse pendente do proprietário. */
export async function compensarAdiantamento(id: string): Promise<Resultado> {
  const { supabase } = await obterContexto();
  const { data: l } = await supabase.from("lancamentos").select("pessoa_id, valor, compensado_em, adiantamento").eq("id", id).single();
  if (!l?.adiantamento || !l.pessoa_id) return { ok: false, erro: "Adiantamento não encontrado." };
  if (l.compensado_em) return { ok: false, erro: "Este adiantamento já foi compensado." };
  const { data: r } = await supabase
    .from("repasses")
    .select("id, valor_liquido, outros_descontos, observacoes")
    .eq("pessoa_id", l.pessoa_id)
    .eq("status", "pendente")
    .order("previsto_para")
    .limit(1)
    .maybeSingle();
  if (!r) return { ok: false, erro: "Não há repasse pendente deste proprietário para descontar." };
  if (Number(r.valor_liquido) < Number(l.valor)) return { ok: false, erro: "O próximo repasse é menor que o adiantamento. Desconte em partes manualmente em Repasses." };
  const { error } = await supabase
    .from("repasses")
    .update({
      outros_descontos: paraReais(paraCentavos(r.outros_descontos) + paraCentavos(l.valor)),
      valor_liquido: paraReais(paraCentavos(r.valor_liquido) - paraCentavos(l.valor)),
      observacoes: [r.observacoes, `Adiantamento descontado: R$ ${Number(l.valor).toFixed(2).replace(".", ",")}`].filter(Boolean).join(" · "),
    })
    .eq("id", r.id);
  if (error) return falha(error);
  await supabase.from("lancamentos").update({ compensado_em: hojeISO() }).eq("id", id);
  revalidar();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Notas fiscais de serviço (controle; só imobiliária)
// ---------------------------------------------------------------------------

function dadosNota(fd: FormData, parcial: boolean) {
  const d: Record<string, unknown> = {};
  for (const c of ["numero", "serie", "tomador_documento", "codigo_verificacao", "link", "tomador_id", "emitida_em"]) if (!parcial || fd.has(c)) d[c] = texto(fd, c);
  if (!parcial || fd.has("tomador_nome")) d.tomador_nome = textoObrigatorio(fd, "tomador_nome", "o tomador (cliente)");
  if (!parcial || fd.has("descricao")) d.descricao = textoObrigatorio(fd, "descricao", "a descrição do serviço");
  if (!parcial || fd.has("competencia")) d.competencia = inicioDoMes(texto(fd, "competencia") ? `${texto(fd, "competencia")!.slice(0, 7)}-01` : hojeISO());
  if (!parcial || fd.has("retencoes")) d.retencoes = numero(fd, "retencoes") ?? 0;
  if (!parcial || fd.has("valor_servicos") || fd.has("aliquota_iss")) {
    const v = numero(fd, "valor_servicos");
    const a = numero(fd, "aliquota_iss");
    if (v !== null) {
      if (v < 0) throw new ErroValidacao("Valor inválido.");
      d.valor_servicos = v;
    }
    if (a !== null) {
      if (a < 0 || a > 10) throw new ErroValidacao("A alíquota do ISS fica entre 0% e 10%.");
      d.aliquota_iss = a;
    }
  }
  return d;
}

async function recalcularIss(supabase: Awaited<ReturnType<typeof obterContexto>>["supabase"], id: string) {
  const { data: n } = await supabase.from("notas_fiscais").select("valor_servicos, aliquota_iss").eq("id", id).single();
  if (n) await supabase.from("notas_fiscais").update({ valor_iss: paraReais(percentual(paraCentavos(n.valor_servicos), Number(n.aliquota_iss))) }).eq("id", id);
}

export async function criarNota(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  let id: string;
  try {
    const d = dadosNota(fd, false);
    if (d.valor_servicos === undefined) throw new ErroValidacao("Informe o valor do serviço.");
    if (d.tomador_id && !texto(fd, "tomador_documento")) {
      const { data: p } = await supabase.from("pessoas").select("documento").eq("id", String(d.tomador_id)).maybeSingle();
      d.tomador_documento = p?.documento ?? null;
    }
    const { data, error } = await supabase.from("notas_fiscais").insert(d).select("id").single();
    if (error) throw error;
    id = data.id;
    await recalcularIss(supabase, id);
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  redirect(`/financeiro/notas/${id}`);
}

export async function atualizarNota(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  const id = String(fd.get("id"));
  try {
    const d = dadosNota(fd, true);
    if (fd.has("numero")) {
      d.status = d.numero ? "emitida" : "a_emitir";
      if (d.numero && !fd.get("emitida_em")) d.emitida_em = hojeISO();
    }
    const { error } = await supabase.from("notas_fiscais").update(d).eq("id", id).neq("status", "cancelada");
    if (error) throw error;
    await recalcularIss(supabase, id);
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Salvo." };
}

export async function cancelarNota(id: string): Promise<Resultado> {
  const { supabase } = await obterContexto();
  const { data: n } = await supabase.from("notas_fiscais").select("status").eq("id", id).single();
  const { error } = await supabase.from("notas_fiscais").update({ status: n?.status === "cancelada" ? "a_emitir" : "cancelada" }).eq("id", id);
  if (error) return falha(error);
  revalidar();
  return { ok: true };
}

export async function excluirNota(id: string): Promise<Resultado> {
  const { supabase } = await obterContexto();
  const { error } = await supabase.from("notas_fiscais").delete().eq("id", id);
  if (error) return falha(error);
  revalidar();
  return { ok: true };
}

/**
 * Cria as notas "a emitir" das taxas de administração/intermediação do mês,
 * uma por proprietário (o tomador do serviço). Não repete quem já tem nota no mês.
 */
export async function gerarNotasDasTaxas(competencia: string): Promise<Resultado> {
  const { supabase, organizacao } = await obterContexto();
  if (organizacao.modo === "pessoal") return { ok: false, erro: "Só no modo imobiliária." };
  const mes = inicioDoMes(competencia);
  const [{ data: reps }, { data: notas }, { data: org }] = await Promise.all([
    supabase.from("repasses").select("pessoa_id, taxa_administracao, taxa_intermediacao, pessoa:pessoas(nome, documento)").eq("competencia", mes).neq("status", "cancelado"),
    supabase.from("notas_fiscais").select("tomador_id").eq("competencia", mes).neq("status", "cancelada"),
    supabase.from("organizacoes").select("aliquota_iss").eq("id", organizacao.id).maybeSingle(),
  ]);
  const ja = new Set((notas ?? []).map((n) => n.tomador_id));
  const porDono = new Map<string, { nome: string; doc: string | null; c: number }>();
  for (const r of (reps ?? []) as unknown as { pessoa_id: string; taxa_administracao: number; taxa_intermediacao: number; pessoa: { nome: string; documento: string | null } | null }[]) {
    if (ja.has(r.pessoa_id)) continue;
    const a = porDono.get(r.pessoa_id) ?? { nome: r.pessoa?.nome ?? "Proprietário", doc: r.pessoa?.documento ?? null, c: 0 };
    a.c += paraCentavos(r.taxa_administracao) + paraCentavos(r.taxa_intermediacao);
    porDono.set(r.pessoa_id, a);
  }
  const aliquota = Number(org?.aliquota_iss ?? 0);
  const linhas = [...porDono.entries()]
    .filter(([, a]) => a.c > 0)
    .map(([pessoa, a]) => ({
      tomador_id: pessoa,
      tomador_nome: a.nome,
      tomador_documento: a.doc,
      competencia: mes,
      descricao: `Serviços de administração de imóveis — ${mes.slice(5, 7)}/${mes.slice(0, 4)}`,
      valor_servicos: paraReais(a.c),
      aliquota_iss: aliquota,
      valor_iss: paraReais(percentual(a.c, aliquota)),
    }));
  if (!linhas.length) return { ok: false, erro: "Nenhuma taxa nova no mês para gerar nota (ou todas já têm nota)." };
  const { error } = await supabase.from("notas_fiscais").insert(linhas);
  if (error) return falha(error);
  revalidar();
  return { ok: true };
}
