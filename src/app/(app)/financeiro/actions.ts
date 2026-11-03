"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { obterContexto } from "@/lib/contexto";
import { hojeISO, inicioDoMes, somarMeses } from "@/lib/dominio/datas";
import { formatarReais, paraCentavos, paraReais, percentual } from "@/lib/dominio/dinheiro";
import { gerarSerie, lerData, planoPadrao, precisaAprovacao, valorDaBaixa, type ItemExtrato, type Repeticao } from "@/lib/dominio/financeiro";
import { type EstadoAcao, ErroValidacao, inteiro, mensagemErro, numero, texto, textoObrigatorio } from "@/lib/form";
import { sugestoesDeConciliacao, todas } from "./dados";

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

type Supabase = Awaited<ReturnType<typeof obterContexto>>["supabase"];

async function limiteAprovacao(supabase: Supabase, orgId: string): Promise<number | null> {
  const { data } = await supabase.from("organizacoes").select("aprovacao_pagamento_acima").eq("id", orgId).single();
  return data?.aprovacao_pagamento_acima == null ? null : Number(data.aprovacao_pagamento_acima);
}

/** Pagamento (no valor efetivo) que ainda precisa de aprovação de admin/gestor. */
function bloqueadoPorAprovacao(l: { tipo: string; aprovado_em: string | null }, valorEfetivo: number, limite: number | null) {
  return !l.aprovado_em && precisaAprovacao(l.tipo === "receber" ? "receber" : "pagar", valorEfetivo, limite);
}

const MSG_APROVACAO = "Este pagamento passa do limite de aprovação. Um administrador ou gestor precisa aprovar antes da baixa (Financeiro → lançamento → Aprovar).";

export async function criarLancamento(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase, organizacao } = await obterContexto();
  let aviso = "";
  try {
    const tipo = texto(fd, "tipo") === "receber" ? "receber" : "pagar";
    const valor = numero(fd, "valor");
    if (!valor || valor <= 0) throw new ErroValidacao("Informe o valor.");
    const repeticao = (["nao", "mensal", "parcelado"].includes(texto(fd, "repeticao") ?? "") ? texto(fd, "repeticao") : "nao") as Repeticao;
    const vezes = inteiro(fd, "vezes") ?? 1;
    if (repeticao !== "nao" && (vezes < 2 || vezes > 120)) throw new ErroValidacao("Repetir: informe de 2 a 120 vezes.");
    const serie = gerarSerie({ descricao: textoObrigatorio(fd, "descricao", "a descrição"), valor, vencimento: textoObrigatorio(fd, "vencimento", "o vencimento"), repeticao, vezes });
    const limite = await limiteAprovacao(supabase, organizacao.id);
    const serie_id = serie.length > 1 ? crypto.randomUUID() : null;
    const pagoJa = fd.getAll("ja_pago").includes("on");
    const hoje = hojeISO();
    const pagoEm = texto(fd, "pago_em") ?? hoje;
    if (pagoJa && pagoEm > hoje) throw new ErroValidacao("A data do pagamento não pode ser no futuro.");
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
      terceiros: organizacao.modo !== "pessoal" && fd.getAll("terceiros").includes("on"),
      serie_id,
    };
    const linhas = serie.map((s, i) => {
      const baixar = pagoJa && i === 0 && !precisaAprovacao(tipo, s.valor, limite);
      if (pagoJa && i === 0 && !baixar) aviso = " A baixa não foi feita porque o valor precisa de aprovação de um administrador ou gestor.";
      return {
        ...comum,
        descricao: s.descricao,
        valor: s.valor,
        vencimento: s.vencimento,
        parcela: s.parcela,
        parcelas: s.parcelas,
        status: baixar ? "liquidado" : "aberto",
        liquidado_em: baixar ? pagoEm : null,
        valor_pago: baixar ? s.valor : null,
      };
    });
    const { error } = await supabase.from("lancamentos").insert(linhas);
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: `Lançamento criado.${aviso}` };
}

const CAMPOS_TEXTO = ["descricao", "categoria", "pessoa_id", "conta_id", "plano_id", "centro_custo_id", "forma", "documento_numero", "observacoes", "imovel_id"];

export async function atualizarLancamento(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase, organizacao } = await obterContexto();
  const id = String(fd.get("id"));
  try {
    const { data: atual } = await supabase.from("lancamentos").select("status, valor, fatura_id").eq("id", id).single();
    if (!atual) throw new ErroValidacao("Lançamento não encontrado.");
    const d: Record<string, unknown> = {};
    for (const c of CAMPOS_TEXTO) if (fd.has(c)) d[c] = texto(fd, c);
    if (fd.has("descricao") && !d.descricao) throw new ErroValidacao("A descrição não pode ficar vazia.");
    // O dinheiro do aluguel entra pela fatura: o lançamento derivado não ganha conta (evita contar duas vezes).
    if (atual.fatura_id) delete d.conta_id;
    if (fd.has("vencimento")) d.vencimento = textoObrigatorio(fd, "vencimento", "o vencimento");
    if (fd.has("terceiros")) d.terceiros = organizacao.modo !== "pessoal" && fd.getAll("terceiros").includes("on");
    if (fd.has("valor")) {
      const v = numero(fd, "valor");
      if (!v || v <= 0) throw new ErroValidacao("Informe o valor.");
      // O formulário automático reenvia tudo: só conta como mudança se o valor for outro.
      if (paraCentavos(v) !== paraCentavos(Number(atual.valor))) {
        if (atual.status === "liquidado") throw new ErroValidacao("Para mudar o valor de um lançamento baixado, estorne a baixa antes.");
        d.valor = v; // se já estava aprovado, o banco tira a aprovação
      }
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
  const { supabase, organizacao } = await obterContexto();
  const id = String(fd.get("id"));
  try {
    const { data: l } = await supabase.from("lancamentos").select("status, tipo, valor, aprovado_em").eq("id", id).single();
    if (!l) throw new ErroValidacao("Lançamento não encontrado.");
    if (l.status !== "aberto") throw new ErroValidacao("Este lançamento não está em aberto.");
    let juros = numero(fd, "juros") ?? 0;
    let desconto = numero(fd, "desconto") ?? 0;
    if (juros < 0 || desconto < 0) throw new ErroValidacao("Juros e desconto não podem ser negativos.");
    const calculado = valorDaBaixa(Number(l.valor), juros, desconto);
    const informado = numero(fd, "valor_pago");
    let valor_pago = calculado;
    if (informado !== null) {
      if (informado <= 0) throw new ErroValidacao("Informe o valor pago.");
      const diff = paraCentavos(informado) - paraCentavos(calculado);
      if (Math.abs(diff) > 1) {
        // Sem juros/desconto digitados: a diferença vira juros (pagou mais) ou desconto (pagou menos).
        if (juros || desconto) throw new ErroValidacao(`O valor pago (${formatarReais(informado)}) não bate com valor + juros − desconto (${formatarReais(calculado)}).`);
        if (diff > 0) juros = paraReais(diff);
        else desconto = paraReais(-diff);
      }
      valor_pago = informado;
    }
    if (valor_pago <= 0) throw new ErroValidacao("Informe o valor pago.");
    const data = texto(fd, "liquidado_em") ?? hojeISO();
    if (data > hojeISO()) throw new ErroValidacao("A data da baixa não pode ser no futuro.");
    if (bloqueadoPorAprovacao(l, Math.max(Number(l.valor), valor_pago), await limiteAprovacao(supabase, organizacao.id))) throw new ErroValidacao(MSG_APROVACAO);
    const { data: feito, error } = await supabase
      .from("lancamentos")
      .update({ status: "liquidado", liquidado_em: data, valor_pago, juros, desconto, conta_id: texto(fd, "conta_id"), forma: texto(fd, "forma") })
      .eq("id", id)
      .eq("status", "aberto")
      .select("id");
    if (error) throw error;
    if (!feito?.length) throw new ErroValidacao("Este lançamento não está mais em aberto.");
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Baixa registrada." };
}

/** Recusa mexer num adiantamento que já foi descontado no repasse do proprietário. */
function adiantamentoDescontado(l: { adiantamento?: boolean | null; compensado_em?: string | null }) {
  return l.adiantamento && l.compensado_em ? "Este adiantamento já foi descontado no repasse do proprietário. Desfaça o desconto antes (Financeiro → Proprietários)." : null;
}

export async function estornarLancamento(id: string): Promise<Resultado> {
  const { supabase } = await obterContexto();
  const { data: l } = await supabase.from("lancamentos").select("fatura_id, status, adiantamento, compensado_em").eq("id", id).maybeSingle();
  if (!l) return { ok: false, erro: "Lançamento não encontrado." };
  if (l.fatura_id) return { ok: false, erro: "Este lançamento veio do pagamento de um aluguel. Desfaça o pagamento em Aluguéis do mês." };
  const bloq = adiantamentoDescontado(l);
  if (bloq) return { ok: false, erro: bloq };
  const { data: feito, error } = await supabase
    .from("lancamentos")
    .update({ status: "aberto", liquidado_em: null, valor_pago: null, juros: 0, desconto: 0, conciliado_em: null })
    .eq("id", id)
    .eq("status", "liquidado")
    .select("id");
  if (error) return falha(error);
  if (!feito?.length) return { ok: false, erro: "Este lançamento não está baixado." };
  await supabase.from("extrato_itens").update({ lancamento_id: null }).eq("lancamento_id", id);
  revalidar();
  return { ok: true };
}

export async function cancelarLancamento(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  const id = String(fd.get("id"));
  try {
    const motivo = textoObrigatorio(fd, "motivo", "o motivo do cancelamento");
    const { data: feito, error } = await supabase.from("lancamentos").update({ status: "cancelado", cancelado_motivo: motivo }).eq("id", id).eq("status", "aberto").select("id");
    if (error) throw error;
    if (!feito?.length) throw new ErroValidacao("Só dá para cancelar lançamento em aberto (estorne a baixa antes).");
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
  const { supabase, papel, usuario, organizacao } = await obterContexto();
  if (!podeAprovar(papel)) return { ok: false, erro: "Só administradores e gestores aprovam pagamentos." };
  const { data: feito, error } = await supabase
    .from("lancamentos")
    .update({ aprovado_em: new Date().toISOString(), aprovado_por: usuario.id })
    .eq("id", id)
    .eq("organizacao_id", organizacao.id)
    .eq("status", "aberto")
    .is("aprovado_em", null)
    .select("id");
  if (error) return falha(error);
  if (!feito?.length) return { ok: false, erro: "Nada para aprovar (já aprovado, baixado ou de outra organização)." };
  revalidar();
  return { ok: true };
}

export async function excluirLancamento(id: string): Promise<Resultado> {
  const { supabase } = await obterContexto();
  const { data } = await supabase.from("lancamentos").select("fatura_id, adiantamento, compensado_em").eq("id", id).maybeSingle();
  if (data?.fatura_id) return { ok: false, erro: "Este lançamento foi gerado pelo pagamento de um aluguel. Para tirar, desfaça o pagamento em Aluguéis do mês." };
  const bloq = data && adiantamentoDescontado(data);
  if (bloq) return { ok: false, erro: bloq };
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
  const { supabase, organizacao } = await obterContexto();
  try {
    const d = dadosConta(fd, false);
    if (organizacao.modo === "pessoal") d.terceiros = false;
    const { error } = await supabase.from("contas_financeiras").insert(d);
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Conta cadastrada." };
}

export async function atualizarConta(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase, organizacao } = await obterContexto();
  try {
    const d = dadosConta(fd, true);
    if (organizacao.modo === "pessoal") delete d.terceiros;
    const { error } = await supabase.from("contas_financeiras").update(d).eq("id", String(fd.get("id")));
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Salvo." };
}

export async function excluirConta(id: string): Promise<Resultado> {
  const { supabase } = await obterContexto();
  const { count } = await supabase.from("transferencias").select("id", { count: "exact", head: true }).or(`origem_id.eq.${id},destino_id.eq.${id}`);
  if (count) return { ok: false, erro: "Esta conta tem transferências registradas; excluir mudaria o saldo da outra conta. Desmarque “Conta ativa” em vez de excluir (ou exclua as transferências antes)." };
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

const LOTE_EXTRATO = 500;

/**
 * Recebe um lote de linhas já lidas do arquivo no navegador (o arquivo não
 * sobe). Valida cada linha e grava sem repetir o que já foi importado.
 */
export async function importarItensExtrato(contaId: string, itens: ItemExtrato[]): Promise<{ ok: boolean; erro?: string; novos?: number; repetidos?: number }> {
  const { supabase } = await obterContexto();
  if (!Array.isArray(itens) || itens.length > LOTE_EXTRATO) return { ok: false, erro: "Lote de extrato inválido." };
  const { data: conta } = await supabase.from("contas_financeiras").select("id").eq("id", contaId).maybeSingle();
  if (!conta) return { ok: false, erro: "Conta não encontrada." };
  const porFitid = new Map<string, ItemExtrato & { conta_id: string }>();
  for (const i of itens) {
    const data = typeof i?.data === "string" ? lerData(i.data) : null;
    const valor = Number(i?.valor);
    const fitid = typeof i?.fitid === "string" ? i.fitid.trim().slice(0, 120) : "";
    if (!data || data !== i.data || !Number.isFinite(valor) || valor === 0 || Math.abs(valor) > 1e11 || !fitid) continue;
    porFitid.set(fitid, {
      conta_id: contaId,
      data,
      valor: paraReais(paraCentavos(valor)),
      descricao: String(i.descricao ?? "Movimento").slice(0, 300) || "Movimento",
      documento: i.documento ? String(i.documento).slice(0, 60) : null,
      fitid,
    });
  }
  const linhas = [...porFitid.values()];
  if (!linhas.length) return { ok: true, novos: 0, repetidos: itens.length };
  const { data, error } = await supabase.from("extrato_itens").upsert(linhas, { onConflict: "conta_id,fitid", ignoreDuplicates: true }).select("id");
  if (error) return falha(error);
  revalidar();
  const novos = data?.length ?? 0;
  return { ok: true, novos, repetidos: itens.length - novos };
}

/**
 * Concilia uma linha do extrato com um lançamento, aluguel ou repasse.
 * `ref` = "<itemId>|l:<id>" | "<itemId>|f:<id>" | "<itemId>|r:<id>".
 * Lançamento em aberto recebe a baixa na data e no valor do extrato (o valor
 * precisa ser igual). Aluguel e repasse precisam já estar pagos no sistema.
 */
export async function conciliarItem(ref: string): Promise<Resultado> {
  const { supabase } = await obterContexto();
  const [itemId, alvo] = ref.split("|");
  const [tipo, id] = (alvo ?? "").split(":");
  if (!itemId || !id || !["l", "f", "r"].includes(tipo)) return { ok: false, erro: "Escolha o que corresponde a esta linha." };
  const { data: item } = await supabase.from("extrato_itens").select("*").eq("id", itemId).maybeSingle();
  if (!item) return { ok: false, erro: "Linha do extrato não encontrada." };
  if (item.lancamento_id || item.fatura_id || item.repasse_id) return { ok: false, erro: "Esta linha já foi conciliada. Desfaça antes de conciliar com outra coisa." };
  const agora = new Date().toISOString();
  const valor = Math.abs(Number(item.valor));
  const sentido = Number(item.valor) >= 0 ? "receber" : "pagar";
  const coluna = tipo === "l" ? "lancamento_id" : tipo === "f" ? "fatura_id" : "repasse_id";

  // Confere o alvo antes de prender a linha.
  try {
    if (tipo === "l") {
      const { data: l } = await supabase.from("lancamentos").select("status, tipo, valor, valor_pago, conciliado_em, fatura_id").eq("id", id).maybeSingle();
      if (!l) throw new ErroValidacao("Lançamento não encontrado.");
      if (l.fatura_id) throw new ErroValidacao("Este lançamento veio de um aluguel: concilie com o aluguel (fatura), não com ele.");
      if (l.status === "cancelado") throw new ErroValidacao("Lançamento cancelado não pode ser conciliado.");
      if (l.conciliado_em) throw new ErroValidacao("Este lançamento já está conciliado com outra linha.");
      if (l.tipo !== sentido) throw new ErroValidacao(sentido === "receber" ? "A linha é uma entrada e o lançamento é um pagamento." : "A linha é uma saída e o lançamento é um recebimento.");
      const ref2 = l.status === "liquidado" ? Number(l.valor_pago ?? l.valor) : Number(l.valor);
      if (Math.abs(paraCentavos(ref2) - paraCentavos(valor)) > 1)
        throw new ErroValidacao("O valor é diferente do lançamento. Dê baixa no lançamento informando juros ou desconto e depois concilie.");
    } else if (tipo === "f") {
      const { data: f } = await supabase.from("faturas").select("status, conciliado_em").eq("id", id).maybeSingle();
      if (!f) throw new ErroValidacao("Aluguel não encontrado.");
      if (sentido !== "receber") throw new ErroValidacao("Aluguel recebido só concilia com entrada no extrato.");
      if (f.status !== "paga") throw new ErroValidacao("Dê baixa no aluguel em Aluguéis do mês primeiro (lá entram multa, juros e repasse); depois concilie.");
      if (f.conciliado_em) throw new ErroValidacao("Este aluguel já está conciliado com outra linha.");
    } else {
      const { data: r } = await supabase.from("repasses").select("status, conciliado_em").eq("id", id).maybeSingle();
      if (!r) throw new ErroValidacao("Repasse não encontrado.");
      if (sentido !== "pagar") throw new ErroValidacao("Repasse só concilia com saída no extrato.");
      if (r.status !== "pago") throw new ErroValidacao("Registre o pagamento do repasse em Repasses primeiro; depois concilie.");
      if (r.conciliado_em) throw new ErroValidacao("Este repasse já está conciliado com outra linha.");
    }
  } catch (e) {
    return falha(e);
  }

  // Prende a linha (só se continua livre) para evitar dois cliques ao mesmo tempo.
  const { data: presa, error: e1 } = await supabase
    .from("extrato_itens")
    .update({ [coluna]: id, ignorado: false })
    .eq("id", itemId)
    .is("lancamento_id", null)
    .is("fatura_id", null)
    .is("repasse_id", null)
    .select("id");
  if (e1) return falha(e1);
  if (!presa?.length) return { ok: false, erro: "Esta linha acabou de ser conciliada por outra pessoa." };

  let erro: unknown = null;
  if (tipo === "l") {
    const { data: l } = await supabase.from("lancamentos").select("status").eq("id", id).single();
    const upd = l?.status === "aberto" ? { status: "liquidado", liquidado_em: item.data, valor_pago: valor, conta_id: item.conta_id, conciliado_em: agora } : { conta_id: item.conta_id, conciliado_em: agora };
    const { data: ok, error } = await supabase.from("lancamentos").update(upd).eq("id", id).is("conciliado_em", null).select("id");
    erro = error ?? (ok?.length ? null : new ErroValidacao("Este lançamento acabou de ser conciliado."));
  } else {
    const tabela = tipo === "f" ? "faturas" : "repasses";
    const { data: ok, error } = await supabase.from(tabela).update({ conta_id: item.conta_id, conciliado_em: agora }).eq("id", id).is("conciliado_em", null).select("id");
    erro = error ?? (ok?.length ? null : new ErroValidacao("Este registro acabou de ser conciliado."));
  }
  if (erro) {
    await supabase.from("extrato_itens").update({ [coluna]: null }).eq("id", itemId);
    const msg = mensagemErro(erro);
    return { ok: false, erro: msg.includes("limite de aprovação") ? MSG_APROVACAO : msg };
  }
  revalidar();
  return { ok: true };
}

/** Baixa automática: concilia de uma vez as linhas do extrato com uma única correspondência. */
export async function conciliarSugestoes(contaId: string): Promise<Resultado> {
  const { supabase, organizacao } = await obterContexto();
  const abertos = await todas<{ id: string; data: string; valor: number; descricao: string }>(() =>
    supabase.from("extrato_itens").select("id, data, valor, descricao").eq("conta_id", contaId).eq("ignorado", false).is("lancamento_id", null).is("fatura_id", null).is("repasse_id", null).order("id"),
  );
  const sugestoes = await sugestoesDeConciliacao(supabase, organizacao.modo === "pessoal", abertos.map((i) => ({ ...i, valor: Number(i.valor) })));
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
  if (erros.length) return { ok: false, erro: `${feitos} linha(s) conciliada(s). Algumas ficaram de fora: ${erros.join(" ")}` };
  return { ok: true };
}

/** Cria um lançamento já baixado a partir de uma linha do extrato (ex.: tarifa bancária, rendimento). */
export async function lancarItemExtrato(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase, organizacao, papel, usuario } = await obterContexto();
  const itemId = String(fd.get("item_id"));
  try {
    const { data: item } = await supabase.from("extrato_itens").select("*, conta:contas_financeiras(terceiros)").eq("id", itemId).single();
    if (!item) throw new ErroValidacao("Linha não encontrada.");
    if (item.lancamento_id || item.fatura_id || item.repasse_id) throw new ErroValidacao("Esta linha já foi conciliada.");
    const valor = Math.abs(Number(item.valor));
    const tipo = Number(item.valor) >= 0 ? "receber" : "pagar";
    const aprovar = precisaAprovacao(tipo, valor, await limiteAprovacao(supabase, organizacao.id));
    if (aprovar && !podeAprovar(papel)) throw new ErroValidacao("Esta saída passa do limite de aprovação: peça a um administrador ou gestor para lançar.");
    const terceiros = organizacao.modo !== "pessoal" && (fd.has("terceiros") ? fd.getAll("terceiros").includes("on") : Boolean((item.conta as { terceiros?: boolean } | null)?.terceiros));
    const { data: l, error } = await supabase
      .from("lancamentos")
      .insert({
        tipo,
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
        terceiros,
        aprovado_em: aprovar ? new Date().toISOString() : null,
        aprovado_por: aprovar ? usuario.id : null,
        conciliado_em: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (error) throw error;
    const { data: presa } = await supabase
      .from("extrato_itens")
      .update({ lancamento_id: l.id, ignorado: false })
      .eq("id", itemId)
      .is("lancamento_id", null)
      .is("fatura_id", null)
      .is("repasse_id", null)
      .select("id");
    if (!presa?.length) {
      await supabase.from("lancamentos").delete().eq("id", l.id);
      throw new ErroValidacao("Esta linha acabou de ser conciliada por outra pessoa.");
    }
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
  if (!parcial || fd.has("grupo_dre")) d.grupo_dre = texto(fd, "grupo_dre") ?? (d.tipo === "receita" ? "receita_operacional" : "despesas_operacionais");
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

export async function atualizarCentro(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  try {
    const d: Record<string, unknown> = {};
    if (fd.has("nome")) d.nome = textoObrigatorio(fd, "nome", "o nome");
    if (fd.has("ativo")) d.ativo = fd.getAll("ativo").includes("on");
    const { error } = await supabase.from("centros_custo").update(d).eq("id", String(fd.get("id")));
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Salvo." };
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
  const { supabase, organizacao, papel, usuario } = await obterContexto();
  try {
    if (organizacao.modo === "pessoal") throw new ErroValidacao("Adiantamento a proprietário só existe no modo imobiliária.");
    const pessoa_id = textoObrigatorio(fd, "pessoa_id", "o proprietário");
    const valor = numero(fd, "valor");
    if (!valor || valor <= 0) throw new ErroValidacao("Informe o valor.");
    const data = texto(fd, "data") ?? hojeISO();
    if (data > hojeISO()) throw new ErroValidacao("A data do adiantamento não pode ser no futuro.");
    const aprovar = precisaAprovacao("pagar", valor, await limiteAprovacao(supabase, organizacao.id));
    if (aprovar && !podeAprovar(papel)) throw new ErroValidacao("Este adiantamento passa do limite de aprovação: peça a um administrador ou gestor para registrar.");
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
      aprovado_em: aprovar ? new Date().toISOString() : null,
      aprovado_por: aprovar ? usuario.id : null,
    });
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Adiantamento registrado." };
}

/** Desconta o adiantamento no próximo repasse pendente do proprietário (no banco, numa operação só). */
export async function compensarAdiantamento(id: string): Promise<Resultado> {
  const { supabase, organizacao } = await obterContexto();
  if (organizacao.modo === "pessoal") return { ok: false, erro: "Só no modo imobiliária." };
  const { error } = await supabase.rpc("compensar_adiantamento", { p_lancamento: id });
  if (error) return falha(error);
  revalidar();
  return { ok: true };
}

/** Desfaz o desconto: devolve o valor ao repasse (se ainda não foi pago). */
export async function descompensarAdiantamento(id: string): Promise<Resultado> {
  const { supabase, organizacao } = await obterContexto();
  if (organizacao.modo === "pessoal") return { ok: false, erro: "Só no modo imobiliária." };
  const { error } = await supabase.rpc("descompensar_adiantamento", { p_lancamento: id });
  if (error) return falha(error);
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
  const { data: n } = await supabase.from("notas_fiscais").select("status, numero").eq("id", id).single();
  if (!n) return { ok: false, erro: "Nota não encontrada." };
  const status = n.status === "cancelada" ? (n.numero ? "emitida" : "a_emitir") : "cancelada";
  const { error } = await supabase.from("notas_fiscais").update({ status }).eq("id", id);
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
 * uma por proprietário (o tomador do serviço). Se o proprietário já tem nota no
 * mês e entraram taxas depois, gera uma nota complementar só com a diferença.
 */
export async function gerarNotasDasTaxas(competencia: string): Promise<Resultado> {
  const { supabase, organizacao } = await obterContexto();
  if (organizacao.modo === "pessoal") return { ok: false, erro: "Só no modo imobiliária." };
  const mes = inicioDoMes(competencia);
  const [{ data: reps }, { data: notas }, { data: org }] = await Promise.all([
    supabase.from("repasses").select("pessoa_id, taxa_administracao, taxa_intermediacao, pessoa:pessoas(nome, documento)").eq("competencia", mes).neq("status", "cancelado"),
    supabase.from("notas_fiscais").select("tomador_id, valor_servicos").eq("competencia", mes).neq("status", "cancelada"),
    supabase.from("organizacoes").select("aliquota_iss").eq("id", organizacao.id).maybeSingle(),
  ]);
  const jaFaturado = new Map<string, number>();
  for (const n of notas ?? []) if (n.tomador_id) jaFaturado.set(n.tomador_id, (jaFaturado.get(n.tomador_id) ?? 0) + paraCentavos(n.valor_servicos));
  const porDono = new Map<string, { nome: string; doc: string | null; c: number }>();
  for (const r of (reps ?? []) as unknown as { pessoa_id: string; taxa_administracao: number; taxa_intermediacao: number; pessoa: { nome: string; documento: string | null } | null }[]) {
    const a = porDono.get(r.pessoa_id) ?? { nome: r.pessoa?.nome ?? "Proprietário", doc: r.pessoa?.documento ?? null, c: 0 };
    a.c += paraCentavos(r.taxa_administracao) + paraCentavos(r.taxa_intermediacao);
    porDono.set(r.pessoa_id, a);
  }
  const aliquota = Number(org?.aliquota_iss ?? 0);
  const linhas = [...porDono.entries()]
    .map(([pessoa, a]) => ({ pessoa, a, falta: a.c - (jaFaturado.get(pessoa) ?? 0), complementar: jaFaturado.has(pessoa) }))
    .filter((x) => x.falta > 0)
    .map(({ pessoa, a, falta, complementar }) => ({
      tomador_id: pessoa,
      tomador_nome: a.nome,
      tomador_documento: a.doc,
      competencia: mes,
      descricao: `Serviços de administração de imóveis — ${mes.slice(5, 7)}/${mes.slice(0, 4)}${complementar ? " (complementar)" : ""}`,
      valor_servicos: paraReais(falta),
      aliquota_iss: aliquota,
      valor_iss: paraReais(percentual(falta, aliquota)),
    }));
  if (!linhas.length) return { ok: false, erro: "Nenhuma taxa nova no mês para gerar nota (ou todas já têm nota)." };
  const { error } = await supabase.from("notas_fiscais").insert(linhas);
  if (error) return falha(error);
  revalidar();
  return { ok: true };
}
