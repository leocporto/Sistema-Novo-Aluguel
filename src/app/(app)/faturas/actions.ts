"use server";

import { revalidatePath } from "next/cache";
import { obterContexto } from "@/lib/contexto";
import { formatarReais } from "@/lib/dominio/dinheiro";
import { type EstadoAcao, ErroValidacao, mensagemErro, texto, textoObrigatorio } from "@/lib/form";
import { registrarRecebimentoFatura } from "@/lib/servicos/cobrancas";
import { carregarContrato, gerarFaturaDoContrato, gerarFaturasDaCompetencia } from "@/lib/servicos/locacao";

type Resultado = { ok: boolean; erro?: string };

const podeFinanceiro = (papel: string) => papel === "admin" || papel === "gestor" || papel === "financeiro";
const SEM_PERMISSAO = "Seu acesso não permite mexer em recebimentos. Fale com o administrador.";

function revalidarTelas(faturaId?: string) {
  for (const p of ["/faturas", "/cobrancas", "/contratos", "/financeiro"]) revalidatePath(p, "layout");
  revalidatePath("/repasses");
  revalidatePath("/");
  if (faturaId) revalidatePath(`/faturas/${faturaId}`, "layout");
}

export async function gerarFaturasDoMes(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  try {
    const comp = textoObrigatorio(fd, "competencia", "a competência");
    const r = await gerarFaturasDaCompetencia(supabase, `${comp}-01`);
    revalidarTelas();
    const partes = [`${r.criadas} fatura(s) gerada(s)`, `${r.ignoradas} contrato(s) sem nova cobrança`];
    if (r.erros.length) return { erro: `${partes.join(", ")}. Problemas: ${r.erros.join(" | ")}` };
    return { ok: `${partes.join(", ")}.` };
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
}

/**
 * Registra um recebimento (confirmado na janela "Receber aluguel"). Se a
 * fatura do mês ainda não existe, gera antes. Recebimento menor que o saldo
 * fica como pagamento parcial; quando o saldo zera, a fatura é quitada (com
 * repasse e taxa na imobiliária, ou lançamento no financeiro no modo pessoal).
 */
export async function receberAluguel(dados: {
  faturaId: string | null;
  contratoId: string;
  competencia: string;
  pagoEm: string;
  /** Reais. */
  valor: number;
  multa: number;
  juros: number;
  desconto: number;
  forma: string;
  contaId: string | null;
  observacao: string | null;
  rotuloDesconto: string | null;
  /** Valor que a janela mostrou (para conferir quando a fatura é gerada agora). */
  valorEsperado?: number;
}): Promise<{ ok: boolean; erro?: string; faturaId?: string; pagamentoId?: string | null; quitou?: boolean; falta?: number }> {
  const { supabase, papel } = await obterContexto();
  if (!podeFinanceiro(papel)) return { ok: false, erro: SEM_PERMISSAO };
  let faturaId = dados.faturaId;
  try {
    if (!faturaId) {
      const c = await carregarContrato(supabase, dados.contratoId);
      if (!c) throw new ErroValidacao("Contrato não encontrado.");
      faturaId = await gerarFaturaDoContrato(supabase, c, dados.competencia);
      if (!faturaId) {
        const { data } = await supabase
          .from("faturas")
          .select("id")
          .eq("contrato_id", dados.contratoId)
          .eq("competencia", dados.competencia)
          .neq("status", "cancelada")
          .maybeSingle();
        faturaId = (data?.id as string | undefined) ?? null;
      }
      if (!faturaId) throw new ErroValidacao("O contrato não tem aluguel a cobrar neste mês.");
      // A fatura recém-gerada pode ter encargos (condomínio, IPTU…) que a janela não mostrou: confere antes de receber.
      const { data: nova } = await supabase.from("faturas").select("valor_total").eq("id", faturaId).single();
      if (dados.valorEsperado !== undefined && Math.round(Number(nova?.valor_total) * 100) !== Math.round(dados.valorEsperado * 100)) {
        revalidarTelas(faturaId);
        return {
          ok: false,
          faturaId,
          erro: `A cobrança do mês foi gerada com ${formatarReais(nova?.valor_total)} (inclui encargos do contrato). Nada foi recebido ainda: feche esta janela e clique em “Receber” de novo para conferir o valor certo.`,
        };
      }
    }
    const r = await registrarRecebimentoFatura(supabase, faturaId, {
      pagoEm: dados.pagoEm,
      valor: dados.valor,
      multa: dados.multa,
      juros: dados.juros,
      desconto: dados.desconto,
      forma: dados.forma,
      contaId: dados.contaId,
      observacao: dados.observacao,
      rotuloDesconto: dados.rotuloDesconto,
    });
    revalidarTelas(faturaId);
    return { ok: true, faturaId, pagamentoId: r.pagamentoId, quitou: r.quitou, falta: r.falta };
  } catch (e) {
    return { ok: false, erro: mensagemErro(e), faturaId: faturaId ?? undefined };
  }
}

/** Desfaz a quitação (tira o último recebimento). Só se o repasse ao proprietário ainda não foi pago. */
export async function desfazerBaixa(faturaId: string): Promise<Resultado> {
  const { supabase, papel } = await obterContexto();
  if (!podeFinanceiro(papel)) return { ok: false, erro: SEM_PERMISSAO };
  const { error } = await supabase.rpc("estornar_baixa", { p_fatura_id: faturaId });
  if (error) return { ok: false, erro: mensagemErro(error) };
  revalidarTelas(faturaId);
  return { ok: true };
}

/** Desfaz um recebimento específico (parcial ou o que quitou). */
export async function estornarRecebimento(pagamentoId: string): Promise<Resultado> {
  const { supabase, papel } = await obterContexto();
  if (!podeFinanceiro(papel)) return { ok: false, erro: SEM_PERMISSAO };
  const { data } = await supabase.from("fatura_pagamentos").select("fatura_id").eq("id", pagamentoId).maybeSingle();
  const { error } = await supabase.rpc("estornar_pagamento", { p_pagamento_id: pagamentoId });
  if (error) return { ok: false, erro: mensagemErro(error) };
  revalidarTelas(data?.fatura_id as string | undefined);
  return { ok: true };
}

export async function cancelarFatura(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase, papel } = await obterContexto();
  if (!podeFinanceiro(papel)) return { erro: SEM_PERMISSAO };
  const id = String(fd.get("fatura_id"));
  try {
    const { data: f } = await supabase.from("faturas").select("status, valor_recebido").eq("id", id).single();
    if (!f || f.status !== "aberta") throw new ErroValidacao("Só dá para cancelar uma cobrança em aberto.");
    if (Number(f.valor_recebido) > 0) throw new ErroValidacao("Esta cobrança já tem recebimento. Desfaça os recebimentos antes de cancelar.");
    const { error } = await supabase
      .from("faturas")
      .update({ status: "cancelada", observacoes: textoObrigatorio(fd, "motivo", "o motivo do cancelamento") })
      .eq("id", id)
      .eq("status", "aberta");
    if (error) throw error;
    await supabase.from("repasses").update({ status: "cancelado" }).eq("fatura_id", id).eq("status", "pendente");
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidarTelas(id);
  return { ok: "Fatura cancelada." };
}

/** Boleto emitido fora do sistema ou link de pagamento (cartão): aparece na 2ª via. */
export async function salvarMeiosDaFatura(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  const id = String(fd.get("id"));
  const d: Record<string, unknown> = {};
  if (fd.has("linha_digitavel")) d.linha_digitavel = texto(fd, "linha_digitavel")?.replace(/[^\d. ]/g, "") || null;
  if (fd.has("url_pagamento")) {
    const u = texto(fd, "url_pagamento");
    if (u && !/^https:\/\//i.test(u)) return { erro: "O link de pagamento precisa começar com https://" };
    d.url_pagamento = u;
  }
  const { error } = await supabase.from("faturas").update(d).eq("id", id);
  if (error) return { erro: mensagemErro(error) };
  revalidatePath(`/faturas/${id}`, "layout");
  return { ok: "Salvo." };
}

/** Grava o caminho do comprovante já enviado ao Storage (na fatura e no recebimento). */
export async function salvarComprovante(faturaId: string, caminho: string, pagamentoId?: string | null): Promise<Resultado> {
  const { supabase, organizacao } = await obterContexto();
  if (!caminho.startsWith(`${organizacao.id}/faturas/${faturaId}/`)) return { ok: false, erro: "Caminho de comprovante inválido." };
  const { error } = await supabase.from("faturas").update({ comprovante_path: caminho }).eq("id", faturaId);
  if (error) return { ok: false, erro: mensagemErro(error) };
  if (pagamentoId) await supabase.from("fatura_pagamentos").update({ comprovante_path: caminho }).eq("id", pagamentoId).eq("fatura_id", faturaId);
  revalidarTelas(faturaId);
  return { ok: true };
}

/** Link temporário (5 min) para abrir o comprovante da fatura ou de um recebimento (`ref` = faturaId ou "p:pagamentoId"). */
export async function linkComprovante(ref: string): Promise<{ ok: boolean; url?: string; erro?: string }> {
  const { supabase } = await obterContexto();
  const caminho = ref.startsWith("p:")
    ? ((await supabase.from("fatura_pagamentos").select("comprovante_path").eq("id", ref.slice(2)).maybeSingle()).data?.comprovante_path as string | null)
    : ((await supabase.from("faturas").select("comprovante_path").eq("id", ref).maybeSingle()).data?.comprovante_path as string | null);
  if (!caminho) return { ok: false, erro: "Esta cobrança não tem comprovante." };
  const { data, error } = await supabase.storage.from("comprovantes").createSignedUrl(caminho, 300);
  if (error || !data) return { ok: false, erro: "Não foi possível abrir o comprovante." };
  return { ok: true, url: data.signedUrl };
}
