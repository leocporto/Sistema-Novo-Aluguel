"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { obterContexto } from "@/lib/contexto";
import { agendadoPara, chavesDoArquivo, horaBrasilia, horaDeAgendar, planejarAcordo, separarValorRecebido, type TipoDesconto } from "@/lib/dominio/cobrancas";
import { hojeISO } from "@/lib/dominio/datas";
import { paraCentavos, paraReais } from "@/lib/dominio/dinheiro";
import { lerExtrato } from "@/lib/dominio/financeiro";
import { normalizarChavePix } from "@/lib/dominio/pix";
import { type EstadoAcao, ErroValidacao, inteiro, mensagemErro, numero, texto, textoObrigatorio } from "@/lib/form";
import { receberParcelaAcordo, registrarRecebimentoFatura } from "@/lib/servicos/cobrancas";
import { carregarCobrancas, carregarFilaDoDia, configCobranca, montarCobrar, sugerirBaixas, type SugestaoBaixa } from "./dados";

type Resultado = { ok: boolean; erro?: string };

function revalidar() {
  revalidatePath("/cobrancas", "layout");
  revalidatePath("/faturas", "layout");
  revalidatePath("/contratos", "layout");
  revalidatePath("/financeiro", "layout");
  revalidatePath("/repasses");
  revalidatePath("/");
}

/** Mexer em dinheiro (baixa, estorno, acordo, jurídico) é para admin, gestor e financeiro. */
const podeFinanceiro = (papel: string) => papel === "admin" || papel === "gestor" || papel === "financeiro";
const SEM_PERMISSAO = "Seu acesso não permite mexer em recebimentos. Fale com o administrador.";
const falha = (e: unknown): Resultado => ({ ok: false, erro: mensagemErro(e) });

// ---------------------------------------------------------------------------
// Configuração: Pix, meios de pagamento, 2ª via e envio automático
// ---------------------------------------------------------------------------

export async function salvarConfigCobranca(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase, organizacao, papel } = await obterContexto();
  if (papel !== "admin" && papel !== "gestor") return { erro: "Só administrador ou gestor muda a configuração de cobrança." };
  try {
    const d: Record<string, unknown> = {};
    if (fd.has("cobranca_pix_chave")) {
      const chave = texto(fd, "cobranca_pix_chave");
      if (chave && !normalizarChavePix(chave)) throw new ErroValidacao("Chave Pix inválida. Use CPF, CNPJ, e-mail, celular com DDD ou a chave aleatória.");
      d.cobranca_pix_chave = chave;
    }
    for (const c of ["cobranca_pix_nome", "cobranca_pix_cidade", "cobranca_instrucoes", "cobranca_conta_id"]) if (fd.has(c)) d[c] = texto(fd, c);
    if (fd.has("cobranca_meios")) d.cobranca_meios = fd.getAll("cobranca_meios").map(String).filter((m) => ["pix", "transferencia", "boleto", "dinheiro", "cartao"].includes(m));
    if (fd.has("cobranca_link_publico")) d.cobranca_link_publico = fd.getAll("cobranca_link_publico").includes("on");
    if (fd.has("cobranca_envio_automatico")) d.cobranca_envio_automatico = fd.getAll("cobranca_envio_automatico").includes("on");
    if (fd.has("cobranca_canal_padrao")) {
      const c = texto(fd, "cobranca_canal_padrao");
      d.cobranca_canal_padrao = c === "email" || c === "sms" ? c : "whatsapp";
    }
    if (fd.has("cobranca_hora_envio")) d.cobranca_hora_envio = Math.min(23, Math.max(0, inteiro(fd, "cobranca_hora_envio") ?? 9));
    if (fd.has("cobranca_juridico_dias")) d.cobranca_juridico_dias = Math.min(3650, Math.max(1, inteiro(fd, "cobranca_juridico_dias") ?? 90));
    if (fd.has("cobranca_quebra_dias")) d.cobranca_quebra_dias = Math.min(365, Math.max(1, inteiro(fd, "cobranca_quebra_dias") ?? 30));
    const { error } = await supabase.from("organizacoes").update(d).eq("id", organizacao.id);
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Salvo." };
}

// ---------------------------------------------------------------------------
// Régua de cobrança (avisos antes e depois do vencimento)
// ---------------------------------------------------------------------------

export interface AvisoRegua {
  id?: string;
  dias: number;
  quando: "antes" | "no_dia" | "depois";
  canal: "whatsapp" | "email" | "sms";
  mensagem: string;
  ativo: boolean;
}

function nomeDoAviso(diasRelativos: number): string {
  if (diasRelativos === 0) return "No dia do vencimento";
  const n = Math.abs(diasRelativos);
  return `${n} ${n === 1 ? "dia" : "dias"} ${diasRelativos < 0 ? "antes" : "depois"}`;
}

/** Salva a régua inteira de uma vez: atualiza, cria e remove avisos. */
export async function salvarRegua(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase, papel } = await obterContexto();
  if (papel !== "admin" && papel !== "gestor") return { erro: "Só administrador ou gestor muda a régua de cobrança." };
  try {
    const avisos = JSON.parse(String(fd.get("avisos") ?? "[]")) as AvisoRegua[];
    const linhas = avisos.map((a) => {
      const dias = a.quando === "no_dia" ? 0 : Math.max(1, Math.min(180, Math.round(Number(a.dias) || 1)));
      const rel = a.quando === "antes" ? -dias : a.quando === "depois" ? dias : 0;
      if (!a.mensagem.trim()) throw new ErroValidacao(`Escreva a mensagem do aviso "${nomeDoAviso(rel)}".`);
      return {
        id: a.id,
        nome: nomeDoAviso(rel),
        dias_relativos: rel,
        canal: a.canal === "whatsapp" || a.canal === "sms" ? a.canal : "email",
        assunto: rel < 0 ? "Lembrete: seu aluguel vence em {{vencimento}}" : rel === 0 ? "Seu aluguel vence hoje" : "Aluguel em atraso",
        mensagem: a.mensagem.trim(),
        ativo: Boolean(a.ativo),
      };
    });
    const repetidos = linhas.map((l) => l.dias_relativos).filter((d, i, arr) => arr.indexOf(d) !== i);
    if (repetidos.length) throw new ErroValidacao(`Há dois avisos para "${nomeDoAviso(repetidos[0])}". Deixe só um.`);

    const { data: atuais, error: e1 } = await supabase.from("regua_regras").select("id, dias_relativos");
    if (e1) throw e1;
    const usados = new Set(linhas.filter((l) => l.id).map((l) => l.id));
    for (const l of linhas) {
      if (l.id) continue;
      const igual = (atuais ?? []).find((r) => r.dias_relativos === l.dias_relativos && !usados.has(r.id as string));
      if (igual) {
        l.id = igual.id as string;
        usados.add(l.id);
      }
    }
    const manter = new Set(linhas.filter((l) => l.id).map((l) => l.id));
    const remover = (atuais ?? []).map((r) => r.id as string).filter((id) => !manter.has(id));
    if (remover.length) {
      const r = await supabase.from("regua_regras").delete().in("id", remover);
      if (r.error) throw r.error;
    }
    for (const { id, ...dados } of linhas) {
      const r = id ? await supabase.from("regua_regras").update(dados).eq("id", id) : await supabase.from("regua_regras").insert(dados);
      if (r.error) throw r.error;
    }
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidatePath("/cobrancas", "layout");
  return { ok: "Régua de cobrança salva." };
}

/**
 * Registra que o aviso foi enviado (a pessoa clicou para abrir o WhatsApp,
 * o e-mail ou o SMS com a mensagem pronta) e guarda no histórico de contatos.
 */
export async function registrarEnvio(dados: {
  faturaId: string;
  contratoId: string;
  pessoaId: string | null;
  regraId: string | null;
  superados?: string[];
  canal: "whatsapp" | "email" | "sms";
  destinatario: string | null;
  mensagem: string;
  acordoId?: string | null;
}): Promise<Resultado> {
  const { supabase } = await obterContexto();
  try {
    // Aviso que estava na fila de saída do envio automático: passa a "enviado".
    if (dados.regraId) {
      const { error } = await supabase
        .from("regua_envios")
        .update({ status: "enviado", canal: dados.canal, destinatario: dados.destinatario, enviado_em: new Date().toISOString(), erro: null })
        .eq("fatura_id", dados.faturaId)
        .eq("regra_id", dados.regraId)
        .eq("status", "agendado");
      if (error) throw error;
    }
    if (dados.superados?.length) {
      const { error } = await supabase.from("regua_envios").update({ status: "pulado" }).eq("fatura_id", dados.faturaId).in("regra_id", dados.superados).eq("status", "agendado");
      if (error) throw error;
    }
    const envios = [
      ...(dados.regraId ? [{ regra_id: dados.regraId, fatura_id: dados.faturaId, destinatario: dados.destinatario, status: "enviado", canal: dados.canal }] : []),
      ...(dados.superados ?? []).map((r) => ({ regra_id: r, fatura_id: dados.faturaId, destinatario: null, status: "pulado", canal: dados.canal })),
    ];
    if (envios.length) {
      const { error } = await supabase.from("regua_envios").upsert(envios, { onConflict: "regra_id,fatura_id", ignoreDuplicates: true });
      if (error) throw error;
    }
    const { error } = await supabase.from("cobranca_contatos").insert({
      contrato_id: dados.contratoId,
      pessoa_id: dados.pessoaId,
      fatura_id: dados.faturaId || null,
      acordo_id: dados.acordoId ?? null,
      regra_id: dados.regraId,
      canal: dados.canal,
      resultado: "enviado",
      descricao: dados.mensagem.slice(0, 4000),
    });
    if (error) throw error;
  } catch (e) {
    return falha(e);
  }
  revalidatePath("/cobrancas", "layout");
  revalidatePath(`/faturas/${dados.faturaId}`, "layout");
  return { ok: true };
}

/** Tira o aviso da fila de hoje sem enviar. `ref` = "faturaId|regra1,regra2". */
export async function pularAviso(ref: string): Promise<Resultado> {
  const { supabase } = await obterContexto();
  const [faturaId, regras] = ref.split("|");
  const lista = (regras ?? "").split(",").filter(Boolean);
  if (!faturaId || !lista.length) return { ok: false, erro: "Aviso não encontrado." };
  // Se já estava na fila de saída do envio automático, sai dela.
  const tirou = await supabase.from("regua_envios").update({ status: "pulado" }).eq("fatura_id", faturaId).in("regra_id", lista).eq("status", "agendado");
  if (tirou.error) return falha(tirou.error);
  const { error } = await supabase
    .from("regua_envios")
    .upsert(lista.map((r) => ({ regra_id: r, fatura_id: faturaId, status: "pulado" })), { onConflict: "regra_id,fatura_id", ignoreDuplicates: true });
  if (error) return falha(error);
  revalidatePath("/cobrancas", "layout");
  return { ok: true };
}

/**
 * Envio automático: a partir do horário escolhido, grava os avisos do dia na
 * fila de saída ("agendado"), já com a mensagem pronta (2ª via e Pix), o canal
 * e o destinatário. É essa fila que o provedor de WhatsApp/SMS/e-mail envia
 * quando for contratado; até lá, eles seguem em "Avisos de hoje" para enviar
 * com um clique. Roda quando alguém abre as telas de cobrança (não envia nada).
 */
export async function agendarAvisosDoDia(): Promise<{ agendados: number }> {
  const { supabase, organizacao } = await obterContexto();
  const cfg = configCobranca(organizacao);
  if (!horaDeAgendar(cfg, horaBrasilia())) return { agendados: 0 };
  try {
    const hoje = hojeISO();
    const f = await carregarFilaDoDia(supabase, organizacao, hoje);
    // Aviso de ontem que ficou na fila e foi superado por um mais novo: sai da fila de saída.
    for (const i of f.fila.filter((x) => x.superados.length)) {
      await supabase.from("regua_envios").update({ status: "pulado" }).eq("fatura_id", i.faturaId).in("regra_id", i.superados).eq("status", "agendado");
    }
    const linhas = f.fila
      .filter((i) => !i.agendado)
      .map((i) => {
        const d = montarCobrar(i.cobranca, f.regrasDb, { base: f.base, recebedor: f.recebedor, cfg, regraId: i.regraId, superados: i.superados });
        const destinatario = d.canalInicial === "email" ? d.email : (d.telefone?.replace(/\D/g, "") || null);
        return {
          regra_id: i.regraId,
          fatura_id: i.faturaId,
          status: "agendado",
          canal: d.canalInicial,
          destinatario,
          mensagem: d.mensagem.slice(0, 4000),
          assunto: d.assunto,
          agendado_para: agendadoPara(hoje, cfg.horaEnvio),
          automatico: true,
          erro: destinatario ? null : d.canalInicial === "email" ? "Sem e-mail no cadastro" : "Sem celular no cadastro",
        };
      });
    if (!linhas.length) return { agendados: 0 };
    const { error } = await supabase.from("regua_envios").upsert(linhas, { onConflict: "regra_id,fatura_id", ignoreDuplicates: true });
    if (error) return { agendados: 0 };
    revalidatePath("/cobrancas", "layout");
    return { agendados: linhas.length };
  } catch {
    return { agendados: 0 };
  }
}

// ---------------------------------------------------------------------------
// Histórico de contatos de cobrança
// ---------------------------------------------------------------------------

const CANAIS = ["whatsapp", "email", "sms", "telefone", "presencial", "carta", "link", "outro"];
const RESULTADOS = ["enviado", "sem_resposta", "falou", "promessa", "recusou", "contato_errado", "pagou", "informou_pagamento", "outro"];

export async function registrarContato(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  try {
    const contrato_id = textoObrigatorio(fd, "contrato_id", "o contrato");
    const canal = texto(fd, "canal") ?? "telefone";
    const resultado = texto(fd, "resultado") ?? "falou";
    if (!CANAIS.includes(canal) || !RESULTADOS.includes(resultado)) throw new ErroValidacao("Escolha o canal e o resultado.");
    const promessa_data = texto(fd, "promessa_data");
    const promessa_valor = numero(fd, "promessa_valor");
    if (resultado === "promessa" && !promessa_data) throw new ErroValidacao("Informe a data em que prometeu pagar.");
    let pessoa_id = texto(fd, "pessoa_id");
    if (!pessoa_id) {
      const { data } = await supabase.from("contrato_partes").select("pessoa_id").eq("contrato_id", contrato_id).eq("papel", "locatario").limit(1).maybeSingle();
      pessoa_id = (data?.pessoa_id as string | undefined) ?? null;
    }
    const dataContato = texto(fd, "data");
    const { error } = await supabase.from("cobranca_contatos").insert({
      contrato_id,
      pessoa_id,
      fatura_id: texto(fd, "fatura_id"),
      acordo_id: texto(fd, "acordo_id"),
      juridico_id: texto(fd, "juridico_id"),
      data: dataContato ? `${dataContato}T12:00:00-03:00` : new Date().toISOString(),
      canal,
      direcao: texto(fd, "direcao") === "entrada" ? "entrada" : "saida",
      resultado,
      descricao: texto(fd, "descricao"),
      promessa_data,
      promessa_valor,
      promessa_status: promessa_data ? "pendente" : null,
      proximo_contato: texto(fd, "proximo_contato"),
    });
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Contato registrado." };
}

/** Promessa cumprida ou quebrada. `ref` = "id|cumprida" ou "id|quebrada". */
export async function marcarPromessa(ref: string): Promise<Resultado> {
  const { supabase } = await obterContexto();
  const [id, st] = ref.split("|");
  if (!id || !["cumprida", "quebrada", "pendente"].includes(st)) return { ok: false, erro: "Escolha cumprida ou quebrada." };
  const { error } = await supabase.from("cobranca_contatos").update({ promessa_status: st, proximo_contato: null }).eq("id", id);
  if (error) return falha(error);
  revalidar();
  return { ok: true };
}

/** Retorno feito: tira o "próximo contato" da lista de hoje. */
export async function concluirRetorno(id: string): Promise<Resultado> {
  const { supabase } = await obterContexto();
  const { error } = await supabase.from("cobranca_contatos").update({ proximo_contato: null }).eq("id", id);
  if (error) return falha(error);
  revalidar();
  return { ok: true };
}

export async function excluirContato(id: string): Promise<Resultado> {
  const { supabase } = await obterContexto();
  const { error } = await supabase.from("cobranca_contatos").delete().eq("id", id);
  if (error) return falha(error);
  revalidar();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Acordos e parcelamento
// ---------------------------------------------------------------------------

/** Fecha o acordo. Os valores são recalculados aqui (nunca confiamos no navegador). */
export async function criarAcordo(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase, papel } = await obterContexto();
  if (!podeFinanceiro(papel)) return { erro: SEM_PERMISSAO };
  let id: string;
  try {
    const contratoId = textoObrigatorio(fd, "contrato_id", "o contrato");
    const escolhidas = fd.getAll("fatura_id").map(String).filter(Boolean);
    if (!escolhidas.length) throw new ErroValidacao("Marque ao menos uma cobrança para entrar no acordo.");
    const hoje = hojeISO();
    const cobrancas = (await carregarCobrancas(supabase, hoje, { contratoId, ids: escolhidas })).filter((c) => c.status === "aberta");
    if (cobrancas.length !== escolhidas.length) throw new ErroValidacao("Alguma cobrança escolhida não está mais em aberto. Atualize a tela.");
    const comMulta = fd.getAll("cobrar_multa").includes("on");
    const comJuros = fd.getAll("cobrar_juros").includes("on");
    const tipo = (["valor", "pct_encargos", "pct_total"].includes(texto(fd, "desconto_tipo") ?? "") ? texto(fd, "desconto_tipo") : "valor") as TipoDesconto;
    const dv = numero(fd, "desconto_valor") ?? 0;
    const parcelas = inteiro(fd, "parcelas") ?? 1;
    const primeiro = textoObrigatorio(fd, "primeiro_vencimento", "o vencimento da 1ª parcela");
    const plano = planejarAcordo({
      debitos: cobrancas.map((c) => ({ faturaId: c.faturaId, vencimento: c.vencimento, saldo: c.sit.saldo, multa: comMulta ? c.sit.multa : 0, juros: comJuros ? c.sit.juros : 0 })),
      desconto: dv > 0 ? { tipo, valor: tipo === "valor" ? paraCentavos(dv) : dv } : null,
      entrada: paraCentavos(numero(fd, "entrada") ?? 0),
      parcelas,
      primeiroVencimento: primeiro,
      dataAcordo: hoje,
    });
    if (plano.erro) throw new ErroValidacao(plano.erro);
    const locatario = cobrancas[0].locatario?.id ?? null;
    const { data, error } = await supabase.rpc("criar_acordo", {
      p: {
        contrato_id: contratoId,
        pessoa_id: locatario,
        data: hoje,
        principal: paraReais(plano.principal),
        multa: paraReais(plano.multa),
        juros: paraReais(plano.juros),
        desconto: paraReais(plano.desconto),
        total: paraReais(plano.total),
        entrada: paraReais(plano.entrada),
        parcelas,
        condicoes: texto(fd, "condicoes"),
        observacoes: texto(fd, "observacoes"),
        faturas: plano.faturas.map((f) => ({ fatura_id: f.faturaId, principal: paraReais(f.principal), multa: paraReais(f.multa), juros: paraReais(f.juros), desconto: paraReais(f.desconto), total: paraReais(f.total) })),
        parcelas_lista: plano.parcelas.map((p) => ({ numero: p.numero, vencimento: p.vencimento, valor: paraReais(p.valor) })),
      },
    });
    if (error) throw new Error(error.message);
    id = data as string;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  redirect(`/cobrancas/acordos/${id}`);
}

export async function atualizarAcordo(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  const id = String(fd.get("id"));
  const d: Record<string, unknown> = {};
  for (const c of ["condicoes", "observacoes"]) if (fd.has(c)) d[c] = texto(fd, c);
  const { error } = await supabase.from("acordos").update(d).eq("id", id);
  if (error) return { erro: mensagemErro(error) };
  revalidatePath(`/cobrancas/acordos/${id}`);
  return { ok: "Salvo." };
}

export async function receberParcela(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase, papel } = await obterContexto();
  if (!podeFinanceiro(papel)) return { erro: SEM_PERMISSAO };
  try {
    const r = await receberParcelaAcordo(supabase, textoObrigatorio(fd, "parcela_id", "a parcela"), {
      pagoEm: textoObrigatorio(fd, "pago_em", "a data do pagamento"),
      forma: texto(fd, "forma") ?? "pix",
      contaId: texto(fd, "conta_id"),
    });
    revalidar();
    return { ok: r.quitadas ? `Parcela recebida. ${r.quitadas} aluguel(is) do acordo quitado(s).` : "Parcela recebida." };
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
}

export async function estornarParcela(id: string): Promise<Resultado> {
  const { supabase, papel } = await obterContexto();
  if (!podeFinanceiro(papel)) return { ok: false, erro: SEM_PERMISSAO };
  const { error } = await supabase.rpc("estornar_parcela", { p_parcela_id: id });
  if (error) return falha(error);
  revalidar();
  return { ok: true };
}

export async function quebrarAcordo(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase, papel } = await obterContexto();
  if (!podeFinanceiro(papel)) return { erro: SEM_PERMISSAO };
  const { error } = await supabase.rpc("quebrar_acordo", { p_acordo_id: String(fd.get("acordo_id")), p_motivo: texto(fd, "motivo") ?? "" });
  if (error) return { erro: mensagemErro(error) };
  revalidar();
  return { ok: "Acordo quebrado. O que faltava voltou para a cobrança normal." };
}

export async function excluirAcordo(id: string): Promise<Resultado> {
  const { supabase, papel } = await obterContexto();
  if (!podeFinanceiro(papel)) return { ok: false, erro: SEM_PERMISSAO };
  const { error } = await supabase.rpc("excluir_acordo", { p_acordo_id: id });
  if (error) return falha(error);
  revalidar();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Cobrança jurídica
// ---------------------------------------------------------------------------

export async function encaminharJuridico(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase, papel } = await obterContexto();
  if (!podeFinanceiro(papel)) return { erro: SEM_PERMISSAO };
  let id: string;
  try {
    const contratoId = textoObrigatorio(fd, "contrato_id", "o contrato");
    const hoje = hojeISO();
    const vencidas = (await carregarCobrancas(supabase, hoje, { contratoId })).filter((c) => c.dias > 0 && !c.juridicoAtivo);
    if (!vencidas.length) throw new ErroValidacao("Este contrato não tem aluguel vencido para encaminhar.");
    const { data, error } = await supabase
      .from("cobrancas_juridicas")
      .insert({
        contrato_id: contratoId,
        pessoa_id: vencidas[0].locatario?.id ?? null,
        encaminhado_em: texto(fd, "encaminhado_em") ?? hoje,
        escritorio: texto(fd, "escritorio"),
        responsavel: texto(fd, "responsavel"),
        contato: texto(fd, "contato"),
        honorarios_pct: numero(fd, "honorarios_pct"),
        observacoes: texto(fd, "observacoes"),
        valor_encaminhado: paraReais(vencidas.reduce((s, c) => s + c.sit.totalComEncargos, 0)),
      })
      .select("id")
      .single();
    if (error) throw error;
    id = data.id as string;
    const { error: e2 } = await supabase.from("faturas").update({ juridico_id: id }).in("id", vencidas.map((c) => c.faturaId));
    if (e2) throw e2;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  redirect(`/cobrancas/juridico/${id}`);
}

export async function atualizarJuridico(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase, papel } = await obterContexto();
  if (!podeFinanceiro(papel)) return { erro: SEM_PERMISSAO };
  const id = String(fd.get("id"));
  try {
    const d: Record<string, unknown> = {};
    for (const c of ["escritorio", "responsavel", "contato", "numero_processo", "observacoes", "proxima_acao", "encerrado_em"]) if (fd.has(c)) d[c] = texto(fd, c);
    if (fd.has("honorarios_pct")) d.honorarios_pct = numero(fd, "honorarios_pct");
    if (fd.has("encaminhado_em")) d.encaminhado_em = textoObrigatorio(fd, "encaminhado_em", "a data do encaminhamento");
    if (fd.has("situacao")) {
      const s = texto(fd, "situacao") ?? "encaminhado";
      if (!["encaminhado", "notificacao", "negociacao", "acao_ajuizada", "acordo", "pago", "encerrado"].includes(s)) throw new ErroValidacao("Situação inválida.");
      d.situacao = s;
      if ((s === "pago" || s === "encerrado") && !texto(fd, "encerrado_em")) d.encerrado_em = hojeISO();
    }
    const { error } = await supabase.from("cobrancas_juridicas").update(d).eq("id", id);
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Salvo." };
}

export async function excluirJuridico(id: string): Promise<Resultado> {
  const { supabase, papel } = await obterContexto();
  if (!podeFinanceiro(papel)) return { ok: false, erro: SEM_PERMISSAO };
  const { error } = await supabase.from("cobrancas_juridicas").delete().eq("id", id);
  if (error) return falha(error);
  revalidar();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Baixa automática (extrato do banco ou arquivo de retorno)
// ---------------------------------------------------------------------------

export interface BaixaAutomatica {
  tipo: "fatura" | "parcela";
  faturaId: string | null;
  parcelaId: string | null;
  data: string;
  /** Reais. */
  valor: number;
  extratoItemId?: string | null;
  contaId?: string | null;
  /** Chave da linha do extrato/arquivo: a mesma linha não dá baixa duas vezes (o banco confere). */
  chaveBaixa?: string | null;
  origem: "extrato" | "arquivo";
}

/**
 * Dá baixa nas cobranças que casaram com entradas de dinheiro. O valor é
 * separado em aluguel, multa e juros (até a sugestão do contrato); valor
 * menor que o saldo vira pagamento parcial. Parcela de acordo só é recebida
 * inteira (valor igual ao da parcela).
 */
export async function confirmarBaixasAutomaticas(itens: BaixaAutomatica[]): Promise<{ ok: boolean; feitos: number; erros: string[] }> {
  const { supabase, papel } = await obterContexto();
  if (!podeFinanceiro(papel)) return { ok: false, feitos: 0, erros: [SEM_PERMISSAO] };
  const erros: string[] = [];
  let feitos = 0;
  const vistas = new Set<string>();
  for (const it of itens.slice(0, 300)) {
    const rotulo = it.tipo === "parcela" ? `Parcela ${String(it.parcelaId).slice(0, 8)}` : `Fatura ${String(it.faturaId).slice(0, 8)}`;
    try {
      if (it.chaveBaixa) {
        if (vistas.has(it.chaveBaixa)) throw new ErroValidacao("a mesma entrada foi escolhida duas vezes");
        vistas.add(it.chaveBaixa);
      }
      const observacao = it.origem === "extrato" ? "Baixa automática pelo extrato importado" : "Baixa automática por arquivo";
      if (it.tipo === "parcela") {
        if (!it.parcelaId) throw new ErroValidacao("parcela não informada");
        const { data: parc } = await supabase.from("acordo_parcelas").select("valor, status").eq("id", it.parcelaId).maybeSingle();
        if (!parc || parc.status !== "aberta") throw new ErroValidacao("parcela não está mais em aberto");
        if (paraCentavos(parc.valor) !== paraCentavos(it.valor)) throw new ErroValidacao("o valor não é o da parcela — confira e receba pela ficha do acordo");
        await receberParcelaAcordo(supabase, it.parcelaId, {
          pagoEm: it.data,
          forma: "pix",
          contaId: it.contaId ?? null,
          extratoItemId: it.extratoItemId ?? null,
          chaveBaixa: it.chaveBaixa ?? null,
          observacao,
        });
        feitos++;
        continue;
      }
      if (!it.faturaId) throw new ErroValidacao("cobrança não informada");
      const [c] = await carregarCobrancas(supabase, it.data, { ids: [it.faturaId] });
      if (!c) throw new ErroValidacao("cobrança não está mais em aberto");
      const valor = paraCentavos(it.valor);
      const partes = separarValorRecebido(valor, c.sit);
      if (!partes) throw new ErroValidacao("valor maior que o devido — confira e dê a baixa manual");
      // Pagou até o vencimento com o desconto de pontualidade: quita com o desconto.
      const pontual = c.sit.descontoPontualidade > 0 && valor < c.sit.saldo && valor >= c.sit.saldo - c.sit.descontoPontualidade;
      await registrarRecebimentoFatura(supabase, it.faturaId, {
        pagoEm: it.data,
        valor: paraReais(partes.valor),
        multa: paraReais(partes.multa),
        juros: paraReais(partes.juros),
        desconto: pontual ? paraReais(c.sit.saldo - valor) : 0,
        rotuloDesconto: pontual ? "Desconto de pontualidade" : null,
        forma: "pix",
        contaId: it.contaId ?? null,
        origem: it.origem,
        extratoItemId: it.extratoItemId ?? null,
        chaveBaixa: it.chaveBaixa ?? null,
        observacao,
      });
      feitos++;
    } catch (e) {
      erros.push(`${rotulo}: ${mensagemErro(e)}`);
    }
  }
  revalidar();
  return { ok: feitos > 0, feitos, erros };
}

/**
 * Lê um extrato/arquivo de retorno colado (OFX ou CSV) e procura as cobranças
 * e parcelas de acordo que ele paga. Não grava nada. Linhas que já deram baixa
 * antes (mesma data, valor, descrição e conta) ficam de fora.
 */
export async function analisarArquivoRetorno(
  texto: string,
  contaId: string | null,
): Promise<{ ok: boolean; erro?: string; itens: SugestaoBaixa[]; entradas: number; jaBaixadas: number }> {
  const { supabase } = await obterContexto();
  try {
    const linhas = lerExtrato(texto.slice(0, 2_000_000))
      .filter((l) => l.valor > 0)
      .slice(0, 2000);
    if (!linhas.length) return { ok: false, erro: "Não achei entradas de dinheiro no arquivo. Use OFX ou CSV com data, descrição e valor.", itens: [], entradas: 0, jaBaixadas: 0 };
    const descricoes = linhas.map((l) => [l.descricao, l.documento].filter(Boolean).join(" "));
    const chaves = chavesDoArquivo(linhas.map((l, i) => ({ data: l.data, valor: paraCentavos(l.valor), descricao: descricoes[i], contaId })));
    const usadas = new Set<string>();
    for (let i = 0; i < chaves.length; i += 200) {
      const { data } = await supabase.from("fatura_pagamentos").select("chave_baixa").in("chave_baixa", chaves.slice(i, i + 200));
      for (const r of data ?? []) usadas.add(r.chave_baixa as string);
    }
    const novas = linhas.map((l, i) => ({ l, i })).filter(({ i }) => !usadas.has(chaves[i]));
    const itens = await sugerirBaixas(
      supabase,
      hojeISO(),
      novas.map(({ l, i }) => ({ id: `a${i}`, data: l.data, valor: l.valor, descricao: descricoes[i], contaId, chaveBaixa: chaves[i] })),
    );
    return { ok: true, itens, entradas: linhas.length, jaBaixadas: linhas.length - novas.length };
  } catch (e) {
    return { ok: false, erro: mensagemErro(e), itens: [], entradas: 0, jaBaixadas: 0 };
  }
}
