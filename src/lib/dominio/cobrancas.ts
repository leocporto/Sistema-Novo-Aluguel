/**
 * Regras puras de cobrança e inadimplência (todos os valores em centavos):
 * saldo da fatura com pagamentos parciais, multa e juros SEPARADOS, acordo e
 * parcelamento, distribuição da parcela nas faturas, fila da régua, faixas de
 * atraso (aging), indicadores de recuperação e baixa automática por extrato.
 */
import { type Centavos, formatarReais, paraReais, percentual, ratear } from "./dinheiro";
import { type DataISO, diasEntre, formatarCompetencia, formatarDataBR, somarDias, somarMeses } from "./datas";
import type { DestinoItem, ItemFatura } from "./fatura";
import { enviosDevidos, type RegraRegua } from "./regua";

// ---------------------------------------------------------------------------
// Rótulos
// ---------------------------------------------------------------------------

export const FORMAS_RECEBIMENTO: Record<string, string> = {
  pix: "Pix",
  boleto: "Boleto",
  transferencia: "Transferência",
  dinheiro: "Dinheiro",
  cartao: "Cartão",
  outro: "Outro",
};

export const ROTULO_ORIGEM: Record<string, string> = {
  manual: "Baixa manual",
  acordo: "Parcela de acordo",
  extrato: "Extrato do banco",
  arquivo: "Arquivo de retorno",
  automatica: "Baixa automática",
};

export const ROTULO_CANAL: Record<string, string> = {
  whatsapp: "WhatsApp",
  email: "E-mail",
  sms: "SMS",
  telefone: "Ligação",
  presencial: "Pessoalmente",
  carta: "Carta / notificação",
  link: "Link da 2ª via",
  outro: "Outro",
};

export const ROTULO_RESULTADO: Record<string, string> = {
  enviado: "Mensagem enviada",
  sem_resposta: "Não respondeu",
  falou: "Conversou",
  promessa: "Prometeu pagar",
  recusou: "Recusou pagar",
  contato_errado: "Contato errado",
  pagou: "Disse que pagou",
  informou_pagamento: "Informou pagamento pelo link",
  outro: "Outro",
};

export const ROTULO_STATUS_ACORDO: Record<string, string> = {
  ativo: "Em andamento",
  cumprido: "Cumprido",
  quebrado: "Quebrado",
  cancelado: "Cancelado",
};

export const ROTULO_SITUACAO_JURIDICO: Record<string, string> = {
  encaminhado: "Encaminhado",
  notificacao: "Notificação enviada",
  negociacao: "Em negociação",
  acao_ajuizada: "Ação na Justiça",
  acordo: "Acordo judicial",
  pago: "Pago",
  encerrado: "Encerrado",
};

export const MEIOS_COBRANCA: Record<string, string> = {
  pix: "Pix",
  transferencia: "Transferência / depósito",
  boleto: "Boleto",
  dinheiro: "Dinheiro",
  cartao: "Cartão (link de pagamento)",
};

// ---------------------------------------------------------------------------
// Imóvel: código + endereço, mesmo com campos faltando
// ---------------------------------------------------------------------------

export interface ImovelEndereco {
  codigo?: string | null;
  logradouro?: string | null;
  numero?: string | null;
  complemento?: string | null;
  bairro?: string | null;
  cidade?: string | null;
  uf?: string | null;
}

/** "Rua X, 10, apto 2 — Centro — Porto Alegre/RS" (null se não há nenhum dado de endereço). */
export function enderecoImovel(im: ImovelEndereco | null | undefined): string | null {
  if (!im) return null;
  const rua = [im.logradouro, im.numero].map((s) => s?.trim()).filter(Boolean).join(", ");
  const cidade = [im.cidade?.trim(), im.uf?.trim()].filter(Boolean).join("/");
  const partes = [[rua, im.complemento?.trim()].filter(Boolean).join(", "), im.bairro?.trim(), cidade].filter(Boolean);
  return partes.length ? partes.join(" — ") : null;
}

/** Identificação completa: "AP-101 · Rua X, 10 — Centro — Porto Alegre/RS". Nunca vazia. */
export function identificacaoImovel(im: ImovelEndereco | null | undefined): string {
  const end = enderecoImovel(im);
  const cod = im?.codigo?.trim();
  if (cod && end) return `${cod} · ${end}`;
  return cod || end || "Imóvel sem identificação";
}

/** Versão curta para listas: "Rua X, 10" ou o código. */
export function imovelCurto(im: ImovelEndereco | null | undefined): string {
  const rua = [im?.logradouro, im?.numero].map((s) => s?.trim()).filter(Boolean).join(", ");
  return rua || im?.codigo?.trim() || "Imóvel";
}

// ---------------------------------------------------------------------------
// Saldo da fatura, multa e juros
// ---------------------------------------------------------------------------

export interface PagamentoFatura {
  data: DataISO;
  valor: Centavos;
  principal: Centavos;
  multa: Centavos;
  juros: Centavos;
  desconto: Centavos;
}

export interface RegrasAtraso {
  /** Multa moratória em % (uma vez só). */
  multaPct: number;
  /** Juros simples em % ao mês, pro rata dia (mês de 30 dias). */
  jurosMesPct: number;
  /** Dias de tolerância depois do vencimento sem encargos. */
  carenciaDias?: number;
}

export interface SituacaoFatura {
  valorTotal: Centavos;
  /** Soma do que abateu o saldo (principal pago + descontos concedidos). */
  abatido: Centavos;
  /** Dinheiro recebido (inclui multa e juros). */
  recebido: Centavos;
  saldo: Centavos;
  multaCobrada: Centavos;
  jurosCobrado: Centavos;
  descontoConcedido: Centavos;
  diasAtraso: number;
  /** Sugestões para pagar o saldo na data (o usuário decide se cobra). */
  multa: Centavos;
  juros: Centavos;
  /** Dias de juros considerados na sugestão. */
  diasJuros: number;
  /** Desconto de pontualidade cabível na data (pagando até o vencimento). */
  descontoPontualidade: Centavos;
  /** Saldo + multa + juros. */
  totalComEncargos: Centavos;
  parcial: boolean;
}

/**
 * Situação de uma fatura numa data: saldo depois dos pagamentos e a sugestão
 * de multa e juros (separados) para quitar nessa data.
 * - multa: % sobre o saldo, uma única vez (se ainda não foi cobrada);
 * - juros: pro rata dia sobre o saldo, desde o vencimento ou desde o último
 *   pagamento feito em atraso (cada pagamento acerta os juros até ali);
 * - dentro da carência, nada é sugerido.
 */
export function situacaoFatura(
  f: { valorTotal: Centavos; vencimento: DataISO },
  pagamentos: PagamentoFatura[],
  regras: RegrasAtraso,
  data: DataISO,
  pontualidade?: { pct: number; aluguel: Centavos },
): SituacaoFatura {
  const soma = (k: keyof PagamentoFatura) => pagamentos.reduce((s, p) => s + (Number(p[k]) || 0), 0);
  const abatido = soma("principal") + soma("desconto");
  const saldo = Math.max(0, f.valorTotal - abatido);
  const multaCobrada = soma("multa");
  const dias = Math.max(0, diasEntre(f.vencimento, data));
  const foraDaCarencia = dias > (regras.carenciaDias ?? 0);
  let multa = 0;
  let juros = 0;
  let diasJuros = 0;
  if (saldo > 0 && foraDaCarencia) {
    if (multaCobrada === 0) multa = percentual(saldo, regras.multaPct);
    const ultimoAtrasado = pagamentos
      .filter((p) => p.data > f.vencimento && p.data <= data)
      .map((p) => p.data)
      .sort()
      .at(-1);
    diasJuros = Math.max(0, diasEntre(ultimoAtrasado ?? f.vencimento, data));
    juros = Math.round((saldo * (regras.jurosMesPct / 100) * diasJuros) / 30);
  }
  let descontoPontualidade = 0;
  if (pontualidade && pontualidade.pct > 0 && saldo > 0 && data <= f.vencimento && soma("desconto") === 0) {
    descontoPontualidade = Math.min(saldo, percentual(pontualidade.aluguel, Math.min(100, pontualidade.pct)));
  }
  return {
    valorTotal: f.valorTotal,
    abatido,
    recebido: soma("valor"),
    saldo,
    multaCobrada,
    jurosCobrado: soma("juros"),
    descontoConcedido: soma("desconto"),
    diasAtraso: saldo > 0 ? dias : 0,
    multa,
    juros,
    diasJuros,
    descontoPontualidade,
    totalComEncargos: saldo + multa + juros,
    parcial: abatido > 0 && saldo > 0,
  };
}

export interface Recebimento {
  /** Dinheiro recebido. */
  valor: Centavos;
  multa: Centavos;
  juros: Centavos;
  /** Abatimento concedido (sem dinheiro). */
  desconto: Centavos;
}

/** Confere um recebimento contra o saldo: quanto abate, se quita e quanto falta. */
export function analisarRecebimento(saldo: Centavos, r: Recebimento): { principal: Centavos; quita: boolean; falta: Centavos; erro?: string } {
  const base = { principal: 0, quita: false, falta: saldo };
  if ([r.valor, r.multa, r.juros, r.desconto].some((v) => !Number.isFinite(v) || v < 0)) return { ...base, erro: "Os valores não podem ser negativos." };
  if (saldo <= 0) return { ...base, erro: "Esta cobrança não tem saldo em aberto." };
  if (r.valor === 0 && r.desconto === 0) return { ...base, erro: "Informe o valor recebido." };
  if (r.multa + r.juros > r.valor) return { ...base, erro: "Multa e juros passam do valor recebido." };
  const principal = r.valor - r.multa - r.juros;
  if (principal + r.desconto > saldo)
    return { ...base, erro: `O valor passa do que falta pagar (${formatarReais(paraReais(saldo + r.multa + r.juros - r.desconto))} com estes encargos e desconto).` };
  const falta = saldo - principal - r.desconto;
  return { principal, quita: falta === 0, falta };
}

/** Itens que entram na fatura ao quitar: multa, juros e descontos somados de todos os recebimentos. */
export function itensDaQuitacao(
  pagamentos: Pick<PagamentoFatura, "multa" | "juros" | "desconto">[],
  ctx: { multaPct?: number; destinoEncargos: DestinoItem; rotuloDesconto?: string },
): ItemFatura[] {
  const multa = pagamentos.reduce((s, p) => s + p.multa, 0);
  const juros = pagamentos.reduce((s, p) => s + p.juros, 0);
  const desconto = pagamentos.reduce((s, p) => s + p.desconto, 0);
  const itens: ItemFatura[] = [];
  if (multa > 0) itens.push({ descricao: ctx.multaPct ? `Multa por atraso (${ctx.multaPct}%)` : "Multa por atraso", tipo: "multa", valor: multa, destino: ctx.destinoEncargos });
  if (juros > 0) itens.push({ descricao: "Juros de mora", tipo: "juros", valor: juros, destino: ctx.destinoEncargos });
  if (desconto > 0) itens.push({ descricao: ctx.rotuloDesconto ?? "Desconto concedido", tipo: "desconto", valor: -desconto, destino: "proprietario" });
  return itens;
}

/**
 * Divide um valor que chegou sem detalhe (extrato, arquivo) em principal,
 * multa e juros: até o saldo é principal; o que passar vira multa (até a
 * sugestão) e depois juros (até a sugestão). Acima disso não casa.
 */
export function separarValorRecebido(valor: Centavos, sit: Pick<SituacaoFatura, "saldo" | "multa" | "juros">): Recebimento | null {
  if (valor <= 0) return null;
  if (valor <= sit.saldo) return { valor, multa: 0, juros: 0, desconto: 0 };
  let resto = valor - sit.saldo;
  const multa = Math.min(resto, sit.multa);
  resto -= multa;
  const juros = Math.min(resto, sit.juros);
  resto -= juros;
  if (resto > 0) return null;
  return { valor, multa, juros, desconto: 0 };
}

// ---------------------------------------------------------------------------
// Acordos e parcelamento
// ---------------------------------------------------------------------------

export interface DebitoAcordo {
  faturaId: string;
  vencimento: DataISO;
  /** Saldo do aluguel em aberto. */
  saldo: Centavos;
  multa: Centavos;
  juros: Centavos;
}

export type TipoDesconto = "valor" | "pct_encargos" | "pct_total";

export interface OpcoesAcordo {
  debitos: DebitoAcordo[];
  desconto?: { tipo: TipoDesconto; /** centavos (valor) ou % */ valor: number } | null;
  entrada?: Centavos;
  parcelas: number;
  primeiroVencimento: DataISO;
  dataAcordo: DataISO;
}

export interface FaturaDoAcordo {
  faturaId: string;
  principal: Centavos;
  multa: Centavos;
  juros: Centavos;
  desconto: Centavos;
  total: Centavos;
}

export interface PlanoAcordo {
  faturas: FaturaDoAcordo[];
  principal: Centavos;
  multa: Centavos;
  juros: Centavos;
  desconto: Centavos;
  total: Centavos;
  entrada: Centavos;
  parcelas: { numero: number; vencimento: DataISO; valor: Centavos }[];
  erro?: string;
}

/**
 * Monta o acordo: soma saldo + multa + juros das faturas escolhidas, aplica o
 * desconto negociado (rateado entre as faturas) e divide em entrada + parcelas
 * mensais iguais (os centavos que sobram vão na primeira).
 */
export function planejarAcordo(o: OpcoesAcordo): PlanoAcordo {
  const vazio: PlanoAcordo = { faturas: [], principal: 0, multa: 0, juros: 0, desconto: 0, total: 0, entrada: 0, parcelas: [] };
  const debitos = [...o.debitos].filter((d) => d.saldo + d.multa + d.juros > 0).sort((a, b) => a.vencimento.localeCompare(b.vencimento));
  if (!debitos.length) return { ...vazio, erro: "Escolha ao menos uma cobrança em aberto." };
  const n = Math.trunc(o.parcelas);
  if (!(n >= 1 && n <= 120)) return { ...vazio, erro: "Parcelas: de 1 a 120." };
  const brutos = debitos.map((d) => d.saldo + d.multa + d.juros);
  const bruto = brutos.reduce((a, b) => a + b, 0);
  const encargos = debitos.reduce((s, d) => s + d.multa + d.juros, 0);

  let desconto = 0;
  const dsc = o.desconto;
  if (dsc && dsc.valor > 0) {
    if (dsc.tipo === "valor") desconto = Math.round(dsc.valor);
    else if (dsc.tipo === "pct_encargos") desconto = percentual(encargos, Math.min(100, dsc.valor));
    else desconto = percentual(bruto, Math.min(100, dsc.valor));
  }
  if (desconto >= bruto) return { ...vazio, erro: "O desconto não pode ser igual ou maior que a dívida." };
  // Desconto sobre encargos é rateado pelos encargos; o resto, pelo total de cada fatura.
  const pesos = dsc?.tipo === "pct_encargos" ? debitos.map((d) => d.multa + d.juros) : brutos;
  const partes = desconto > 0 ? ratear(desconto, pesos) : debitos.map(() => 0);

  const faturas = debitos.map((d, i) => ({
    faturaId: d.faturaId,
    principal: d.saldo,
    multa: d.multa,
    juros: d.juros,
    desconto: partes[i],
    total: brutos[i] - partes[i],
  }));
  const total = bruto - desconto;
  const entrada = Math.max(0, Math.round(o.entrada ?? 0));
  if (entrada >= total) return { ...vazio, erro: "A entrada não pode cobrir a dívida toda — nesse caso, registre o pagamento direto na cobrança." };
  const resto = total - entrada;
  const valores = ratear(resto, Array.from({ length: n }, () => 1));
  const parcelas = [
    ...(entrada > 0 ? [{ numero: 0, vencimento: o.dataAcordo, valor: entrada }] : []),
    ...valores.map((v, i) => ({ numero: i + 1, vencimento: somarMeses(o.primeiroVencimento, i), valor: v })),
  ];
  if (parcelas.some((p) => p.valor <= 0)) return { ...vazio, erro: "Parcelas demais para este valor." };
  return {
    faturas,
    principal: debitos.reduce((s, d) => s + d.saldo, 0),
    multa: debitos.reduce((s, d) => s + d.multa, 0),
    juros: debitos.reduce((s, d) => s + d.juros, 0),
    desconto,
    total,
    entrada,
    parcelas,
  };
}

/** O desconto do acordo abate primeiro os juros, depois a multa e só então o aluguel. */
export function liquidoDoAcordo(f: Pick<FaturaDoAcordo, "principal" | "multa" | "juros" | "desconto">) {
  let d = f.desconto;
  const juros = Math.max(0, f.juros - d);
  d = Math.max(0, d - f.juros);
  const multa = Math.max(0, f.multa - d);
  d = Math.max(0, d - f.multa);
  return { principal: f.principal - d, multa, juros, descontoPrincipal: d };
}

export interface FaturaNoAcordo extends Pick<FaturaDoAcordo, "faturaId" | "principal" | "multa" | "juros" | "desconto"> {
  vencimento: DataISO;
  /** O que já foi pago desta fatura pelo acordo. */
  pago: { principal: Centavos; multa: Centavos; juros: Centavos };
}

export interface RateioParcela {
  faturaId: string;
  valor: Centavos;
  principal: Centavos;
  multa: Centavos;
  juros: Centavos;
  desconto: Centavos;
  quita: boolean;
}

/**
 * Distribui o valor de uma parcela paga nas faturas do acordo, da mais antiga
 * para a mais nova. Em cada fatura o dinheiro paga juros, depois multa e por
 * fim o aluguel; a fatura que fica coberta é quitada (com o desconto do acordo).
 */
export function distribuirParcela(faturas: FaturaNoAcordo[], valor: Centavos): { rateio: RateioParcela[]; sobra: Centavos } {
  let resto = valor;
  const rateio: RateioParcela[] = [];
  for (const f of [...faturas].sort((a, b) => a.vencimento.localeCompare(b.vencimento))) {
    if (resto <= 0) break;
    const liq = liquidoDoAcordo(f);
    const rp = Math.max(0, liq.principal - f.pago.principal);
    const rm = Math.max(0, liq.multa - f.pago.multa);
    const rj = Math.max(0, liq.juros - f.pago.juros);
    const restante = rp + rm + rj;
    if (restante <= 0) continue;
    if (resto >= restante) {
      rateio.push({ faturaId: f.faturaId, valor: restante, principal: rp, multa: rm, juros: rj, desconto: liq.descontoPrincipal, quita: true });
      resto -= restante;
    } else {
      let a = resto;
      const juros = Math.min(a, rj);
      a -= juros;
      const multa = Math.min(a, rm);
      a -= multa;
      rateio.push({ faturaId: f.faturaId, valor: resto, principal: a, multa, juros, desconto: 0, quita: false });
      resto = 0;
    }
  }
  return { rateio, sobra: resto };
}

/** Parcela de acordo atrasada há mais dias que o limite → sugerir quebra. */
export function acordoEmRisco(parcelas: { status: string; vencimento: DataISO }[], hoje: DataISO, limiteDias: number) {
  const atrasadas = parcelas.filter((p) => p.status === "aberta" && p.vencimento < hoje);
  const maior = atrasadas.reduce((m, p) => Math.max(m, diasEntre(p.vencimento, hoje)), 0);
  return { atrasadas: atrasadas.length, maiorAtraso: maior, sugerirQuebra: atrasadas.length > 0 && maior > limiteDias };
}

// ---------------------------------------------------------------------------
// Régua: fila do dia e próximos avisos
// ---------------------------------------------------------------------------

export interface FaturaFila {
  id: string;
  vencimento: DataISO;
  status: string;
  /** Em cobrança jurídica: a régua não manda aviso. */
  juridico?: boolean;
}

export interface ItemFila {
  faturaId: string;
  regraId: string;
  dataAlvo: DataISO;
  /** Avisos da mesma fatura que também venceram e ficam superados por este. */
  superados: string[];
}

/**
 * O que a régua manda hoje: um aviso por fatura (o mais recente que venceu),
 * só de faturas em aberto fora da cobrança jurídica.
 */
export function filaDoDia(regras: RegraRegua[], faturas: FaturaFila[], hoje: DataISO, enviados: Set<string>): ItemFila[] {
  const ok = faturas.filter((f) => f.status === "aberta" && !f.juridico);
  const devidos = enviosDevidos(regras, ok, hoje, enviados);
  const porFatura = new Map<string, typeof devidos>();
  for (const d of devidos) porFatura.set(d.faturaId, [...(porFatura.get(d.faturaId) ?? []), d]);
  return [...porFatura.values()].map((lista) => {
    const ord = [...lista].sort((a, b) => b.dataAlvo.localeCompare(a.dataAlvo));
    return { faturaId: ord[0].faturaId, regraId: ord[0].regraId, dataAlvo: ord[0].dataAlvo, superados: ord.slice(1).map((x) => x.regraId) };
  });
}

/** Hora (0 a 23) em Brasília (UTC−3), independente do fuso do servidor. */
export function horaBrasilia(agora: Date = new Date()): number {
  return new Date(agora.getTime() - 3 * 60 * 60 * 1000).getUTCHours();
}

/**
 * Envio automático: a partir do horário escolhido, os avisos do dia vão para
 * a fila de saída ("agendado"), com mensagem, canal e destinatário prontos.
 */
export function horaDeAgendar(cfg: { envioAutomatico: boolean; horaEnvio: number }, hora: number): boolean {
  return cfg.envioAutomatico && hora >= cfg.horaEnvio;
}

/** Momento do agendamento (horário escolhido, em Brasília) no formato do banco. */
export function agendadoPara(hoje: DataISO, hora: number): string {
  return `${hoje}T${String(Math.min(23, Math.max(0, Math.trunc(hora)))).padStart(2, "0")}:00:00-03:00`;
}

/** Avisos programados para os próximos dias (depois de hoje). */
export function proximosAvisos(regras: RegraRegua[], faturas: FaturaFila[], hoje: DataISO, dias: number) {
  const out: { faturaId: string; regraId: string; dataAlvo: DataISO }[] = [];
  const limite = somarDias(hoje, dias);
  for (const f of faturas) {
    if (f.status !== "aberta" || f.juridico) continue;
    for (const r of regras) {
      if (!r.ativo) continue;
      const alvo = somarDias(f.vencimento, r.diasRelativos);
      if (alvo > hoje && alvo <= limite) out.push({ faturaId: f.id, regraId: r.id, dataAlvo: alvo });
    }
  }
  return out.sort((a, b) => a.dataAlvo.localeCompare(b.dataAlvo));
}

/**
 * Mensagem que combina com os dias: em atraso, o aviso "depois" de maior prazo
 * já alcançado (ou o primeiro); no dia, o aviso do dia; antes, o aviso "antes".
 */
export function regraParaDias<T extends { dias_relativos: number; ativo: boolean }>(regras: T[], dias: number): T | null {
  const ativas = regras.filter((r) => r.ativo);
  if (dias > 0) {
    const depois = ativas.filter((r) => r.dias_relativos > 0).sort((a, b) => a.dias_relativos - b.dias_relativos);
    return [...depois].reverse().find((r) => r.dias_relativos <= dias) ?? depois[0] ?? null;
  }
  if (dias === 0) return ativas.find((r) => r.dias_relativos === 0) ?? null;
  const antes = ativas.filter((r) => r.dias_relativos < 0).sort((a, b) => b.dias_relativos - a.dias_relativos);
  return antes.find((r) => -r.dias_relativos >= -dias) ?? antes[antes.length - 1] ?? null;
}

export function textoDias(dias: number): string {
  if (dias > 0) return `${dias} ${dias === 1 ? "dia" : "dias"} de atraso`;
  if (dias === 0) return "vence hoje";
  return `vence em ${-dias} ${dias === -1 ? "dia" : "dias"}`;
}

/** Link de e-mail com assunto e texto prontos. */
export function linkEmail(email: string, assunto: string, corpo: string): string {
  return `mailto:${encodeURIComponent(email.trim())}?subject=${encodeURIComponent(assunto)}&body=${encodeURIComponent(corpo)}`;
}

/** Link de SMS com o texto pronto (abre o aplicativo de mensagens do celular). */
export function linkSms(telefone: string, mensagem: string): string {
  const d = telefone.replace(/\D/g, "");
  const numero = d.length <= 11 ? `+55${d}` : `+${d}`;
  return `sms:${numero}?body=${encodeURIComponent(mensagem)}`;
}

/** Texto de cobrança com multa e juros separados (para mensagens e telas). */
export function detalheEncargos(sit: Pick<SituacaoFatura, "saldo" | "multa" | "juros" | "diasJuros">): string {
  const partes = [`aluguel ${formatarReais(paraReais(sit.saldo))}`];
  if (sit.multa > 0) partes.push(`multa ${formatarReais(paraReais(sit.multa))}`);
  if (sit.juros > 0) partes.push(`juros ${formatarReais(paraReais(sit.juros))} (${sit.diasJuros} dias)`);
  return partes.join(" + ");
}

// ---------------------------------------------------------------------------
// Relatórios: faixas de atraso e agrupamentos
// ---------------------------------------------------------------------------

export const FAIXAS_ATRASO = [
  { id: "1-30", rotulo: "1 a 30 dias", de: 1, ate: 30 },
  { id: "31-60", rotulo: "31 a 60 dias", de: 31, ate: 60 },
  { id: "61-90", rotulo: "61 a 90 dias", de: 61, ate: 90 },
  { id: "90+", rotulo: "Mais de 90 dias", de: 91, ate: Number.POSITIVE_INFINITY },
] as const;
export type FaixaAtraso = (typeof FAIXAS_ATRASO)[number]["id"];

export function faixaAtraso(dias: number): FaixaAtraso | null {
  return FAIXAS_ATRASO.find((f) => dias >= f.de && dias <= f.ate)?.id ?? null;
}

export function aging(itens: { dias: number; valor: Centavos }[]) {
  const faixas = FAIXAS_ATRASO.map((f) => ({ id: f.id, rotulo: f.rotulo, quantidade: 0, valor: 0 }));
  for (const i of itens) {
    const k = faixaAtraso(i.dias);
    const fx = faixas.find((f) => f.id === k);
    if (!fx) continue;
    fx.quantidade++;
    fx.valor += i.valor;
  }
  return { faixas, total: faixas.reduce((s, f) => s + f.valor, 0), quantidade: faixas.reduce((s, f) => s + f.quantidade, 0) };
}

export interface GrupoInadimplencia {
  chave: string;
  rotulo: string;
  quantidade: number;
  valor: Centavos;
  maiorAtraso: number;
  faixas: Record<FaixaAtraso, Centavos>;
}

/** Agrupa as faturas vencidas (por locatário, imóvel ou contrato), da maior dívida para a menor. */
export function agruparInadimplencia<T extends { dias: number; valor: Centavos }>(itens: T[], chave: (i: T) => string, rotulo: (i: T) => string): GrupoInadimplencia[] {
  const mapa = new Map<string, GrupoInadimplencia>();
  for (const i of itens) {
    const k = chave(i);
    const g = mapa.get(k) ?? { chave: k, rotulo: rotulo(i), quantidade: 0, valor: 0, maiorAtraso: 0, faixas: { "1-30": 0, "31-60": 0, "61-90": 0, "90+": 0 } };
    g.quantidade++;
    g.valor += i.valor;
    g.maiorAtraso = Math.max(g.maiorAtraso, i.dias);
    const fx = faixaAtraso(i.dias);
    if (fx) g.faixas[fx] += i.valor;
    mapa.set(k, g);
  }
  return [...mapa.values()].sort((a, b) => b.valor - a.valor || b.maiorAtraso - a.maiorAtraso);
}

// ---------------------------------------------------------------------------
// Indicadores de recuperação
// ---------------------------------------------------------------------------

export interface FaturaRel {
  id: string;
  vencimento: DataISO;
  valorTotal: Centavos;
  status: string;
}
export interface RecebimentoRel {
  faturaId: string;
  data: DataISO;
  valor: Centavos;
  principal: Centavos;
  multa: Centavos;
  juros: Centavos;
  /**
   * Abatimento concedido junto com o recebimento (pontualidade, desconto do
   * acordo): também tira a fatura da inadimplência — não é dinheiro, mas não
   * está mais em aberto.
   */
  desconto?: Centavos;
}
export interface AcordoRel {
  status: string;
  data: DataISO;
  cumpridoEm: DataISO | null;
  quebradoEm: DataISO | null;
  total: Centavos;
}

export interface IndicadoresRecuperacao {
  /** Aluguéis que venceram no período (até ontem). */
  venceu: Centavos;
  /** Desses, quanto foi pago (ou abatido com desconto, ex.: pontualidade) até o vencimento. */
  pagoEmDia: Centavos;
  /** Quanto atrasou (venceu − pago em dia). */
  atrasou: Centavos;
  /** Do que atrasou, quanto já foi recuperado até hoje (pago + desconto concedido no acerto). */
  recuperado: Centavos;
  /** Do que atrasou, o que ainda está em aberto. */
  emAberto: Centavos;
  pctRecuperado: number | null;
  pctInadimplencia: number | null;
  /** Dinheiro recebido em atraso dentro do período (de qualquer mês), com encargos. */
  recebidoEmAtraso: Centavos;
  /** Multa e juros recebidos no período. */
  encargosRecebidos: Centavos;
  /** Prazo médio (em dias) entre o vencimento e o pagamento atrasado. */
  prazoMedio: number | null;
  acordos: { criados: number; cumpridos: number; quebrados: number; ativos: number; valorAtivo: Centavos; taxaCumprimento: number | null };
}

export function indicadoresRecuperacao(p: {
  faturas: FaturaRel[];
  recebimentos: RecebimentoRel[];
  acordos: AcordoRel[];
  de: DataISO;
  ate: DataISO;
  hoje: DataISO;
}): IndicadoresRecuperacao {
  const ontem = somarDias(p.hoje, -1);
  const limite = p.ate < ontem ? p.ate : ontem;
  const venc = new Map(p.faturas.map((f) => [f.id, f.vencimento]));
  const doPeriodo = p.faturas.filter((f) => f.status !== "cancelada" && f.vencimento >= p.de && f.vencimento <= limite);
  const ids = new Set(doPeriodo.map((f) => f.id));
  const venceu = doPeriodo.reduce((s, f) => s + f.valorTotal, 0);
  let pagoEmDia = 0;
  let recuperado = 0;
  for (const r of p.recebimentos) {
    if (!ids.has(r.faturaId) || r.data > p.hoje) continue;
    const abatido = r.principal + (r.desconto ?? 0);
    if (r.data <= (venc.get(r.faturaId) ?? r.data)) pagoEmDia += abatido;
    else recuperado += abatido;
  }
  const atrasou = Math.max(0, venceu - pagoEmDia);
  const emAberto = Math.max(0, atrasou - recuperado);

  let recebidoEmAtraso = 0;
  let encargosRecebidos = 0;
  let somaDias = 0;
  let pesoDias = 0;
  for (const r of p.recebimentos) {
    const v = venc.get(r.faturaId);
    if (!v || r.data < p.de || r.data > p.ate) continue;
    encargosRecebidos += r.multa + r.juros;
    if (r.data > v) {
      recebidoEmAtraso += r.valor;
      somaDias += diasEntre(v, r.data) * r.principal;
      pesoDias += r.principal;
    }
  }
  const noPeriodo = (d: DataISO | null) => !!d && d >= p.de && d <= p.ate;
  const cumpridos = p.acordos.filter((a) => noPeriodo(a.cumpridoEm)).length;
  const quebrados = p.acordos.filter((a) => noPeriodo(a.quebradoEm)).length;
  const ativos = p.acordos.filter((a) => a.status === "ativo");
  return {
    venceu,
    pagoEmDia,
    atrasou,
    recuperado,
    emAberto,
    pctRecuperado: atrasou > 0 ? Math.round((recuperado / atrasou) * 1000) / 10 : null,
    pctInadimplencia: venceu > 0 ? Math.round((emAberto / venceu) * 1000) / 10 : null,
    recebidoEmAtraso,
    encargosRecebidos,
    prazoMedio: pesoDias > 0 ? Math.round(somaDias / pesoDias) : null,
    acordos: {
      criados: p.acordos.filter((a) => noPeriodo(a.data)).length,
      cumpridos,
      quebrados,
      ativos: ativos.length,
      valorAtivo: ativos.reduce((s, a) => s + a.total, 0),
      taxaCumprimento: cumpridos + quebrados > 0 ? Math.round((cumpridos / (cumpridos + quebrados)) * 1000) / 10 : null,
    },
  };
}

// ---------------------------------------------------------------------------
// Baixa automática: casar entradas do extrato/arquivo com as cobranças
// ---------------------------------------------------------------------------

export interface LinhaRecebida {
  id: string;
  data: DataISO;
  valor: Centavos;
  descricao: string;
}

export interface CobrancaAberta {
  id: string;
  numero: number;
  vencimento: DataISO;
  saldo: Centavos;
  /** Maior valor aceito (saldo + multa + juros de hoje). */
  maximo: Centavos;
  /** Menor valor aceito sem virar pagamento parcial (saldo − pontualidade). */
  minimo: Centavos;
  nome: string;
}

export interface Casamento {
  linhaId: string;
  faturaId: string;
  confianca: "alta" | "media";
  motivo: string;
}

const palavras = (s: string) =>
  new Set(
    s
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((p) => p.length > 3),
  );

/** Número da fatura citado no texto do extrato: "FAT123" (txid do Pix), "fatura 123", "#123". */
export function numeroNaDescricao(descricao: string): number | null {
  const m = /FAT0*(\d{1,10})\b/i.exec(descricao) ?? /fatura\s*(?:n[ºo°.]?\s*)?#?\s*(\d{1,10})\b/i.exec(descricao) ?? /#\s?(\d{1,10})\b/.exec(descricao);
  return m ? Number(m[1]) : null;
}

/**
 * Casa cada entrada de dinheiro com uma cobrança em aberto:
 * - alta: o texto traz o número da fatura (txid FAT123 do Pix gerado aqui);
 * - média: o valor bate (do saldo com pontualidade até saldo + multa + juros),
 *   a data está perto do vencimento e só há uma cobrança possível (ou o nome
 *   do locatário aparece no texto).
 * Cada cobrança e cada entrada é usada uma vez só.
 */
export function casarRecebimentos(linhas: LinhaRecebida[], cobrancas: CobrancaAberta[]): Casamento[] {
  const usadas = new Set<string>();
  const out: Casamento[] = [];
  const entradas = linhas.filter((l) => l.valor > 0);
  const porNumero = new Map(cobrancas.map((c) => [c.numero, c]));
  const restantes: LinhaRecebida[] = [];
  for (const l of entradas) {
    const n = numeroNaDescricao(l.descricao);
    const c = n !== null ? porNumero.get(n) : undefined;
    if (c && !usadas.has(c.id) && l.valor <= c.maximo) {
      usadas.add(c.id);
      out.push({ linhaId: l.id, faturaId: c.id, confianca: "alta", motivo: `O texto cita a fatura #${c.numero}` });
    } else restantes.push(l);
  }
  for (const l of restantes) {
    const candidatas = cobrancas.filter(
      (c) => !usadas.has(c.id) && l.valor >= c.minimo && l.valor <= c.maximo && diasEntre(c.vencimento, l.data) >= -15 && diasEntre(c.vencimento, l.data) <= 120,
    );
    let escolhida: CobrancaAberta | undefined;
    let motivo = "";
    const exatas = candidatas.filter((c) => c.saldo === l.valor);
    const p = palavras(l.descricao);
    const comNome = candidatas.filter((c) => [...palavras(c.nome)].some((w) => p.has(w)));
    if (comNome.length === 1) {
      escolhida = comNome[0];
      motivo = "Valor e nome do locatário batem";
    } else if (candidatas.length === 1) {
      escolhida = candidatas[0];
      motivo = candidatas[0].saldo === l.valor ? "Valor igual ao saldo" : "Valor bate com saldo + encargos";
    } else if (exatas.length === 1) {
      escolhida = exatas[0];
      motivo = "Valor igual ao saldo";
    }
    if (escolhida) {
      usadas.add(escolhida.id);
      out.push({ linhaId: l.id, faturaId: escolhida.id, confianca: "media", motivo });
    }
  }
  return out;
}

/** Parcela de acordo citada no texto do extrato: "AC12P3" (txid do Pix gerado aqui; P0 = entrada). */
export function parcelaNaDescricao(descricao: string): { acordo: number; parcela: number } | null {
  const m = /AC0*(\d{1,10})P0*(\d{1,3})\b/i.exec(descricao);
  return m ? { acordo: Number(m[1]), parcela: Number(m[2]) } : null;
}

export interface ParcelaAberta {
  id: string;
  acordoNumero: number;
  numero: number;
  valor: Centavos;
  vencimento: DataISO;
  nome: string;
}

export interface CasamentoParcela {
  linhaId: string;
  parcelaId: string;
  confianca: "alta" | "media";
  motivo: string;
}

/**
 * Casa entradas de dinheiro com parcelas de acordo em aberto. A parcela só é
 * recebida inteira, então o valor tem de ser igual ao da parcela:
 * - alta: o texto traz o identificador do Pix da parcela (AC12P3);
 * - média: o nome do locatário aparece no texto e só uma parcela tem esse valor
 *   perto do vencimento.
 * Cada parcela e cada entrada é usada uma vez só.
 */
export function casarParcelas(linhas: LinhaRecebida[], parcelas: ParcelaAberta[]): CasamentoParcela[] {
  const usadas = new Set<string>();
  const out: CasamentoParcela[] = [];
  const restantes: LinhaRecebida[] = [];
  for (const l of linhas.filter((x) => x.valor > 0)) {
    const ref = parcelaNaDescricao(l.descricao);
    const p = ref ? parcelas.find((x) => x.acordoNumero === ref.acordo && x.numero === ref.parcela && !usadas.has(x.id)) : undefined;
    if (p && p.valor === l.valor) {
      usadas.add(p.id);
      out.push({ linhaId: l.id, parcelaId: p.id, confianca: "alta", motivo: `O texto cita a parcela ${p.numero === 0 ? "de entrada" : p.numero} do acordo nº ${p.acordoNumero}` });
    } else if (!ref) restantes.push(l);
  }
  for (const l of restantes) {
    const w = palavras(l.descricao);
    const candidatas = parcelas.filter(
      (p) =>
        !usadas.has(p.id) &&
        p.valor === l.valor &&
        diasEntre(p.vencimento, l.data) >= -15 &&
        diasEntre(p.vencimento, l.data) <= 60 &&
        [...palavras(p.nome)].some((x) => w.has(x)),
    );
    if (candidatas.length === 1) {
      usadas.add(candidatas[0].id);
      out.push({ linhaId: l.id, parcelaId: candidatas[0].id, confianca: "media", motivo: "Valor da parcela e nome do locatário batem" });
    }
  }
  return out;
}

/**
 * Chave de uma linha de extrato/arquivo para não dar baixa duas vezes com a
 * mesma entrada: data + valor + conta + descrição (sem acento, espaços e
 * maiúsculas) + a ordem da linha entre as idênticas do mesmo arquivo.
 */
export function chaveLinhaBaixa(l: { data: DataISO; valor: Centavos; descricao: string; contaId?: string | null }, ocorrencia = 1): string {
  const desc = l.descricao
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
  return `arq:${l.data}|${Math.round(l.valor)}|${l.contaId ?? "-"}|${desc}#${ocorrencia}`;
}

/** Chaves de todas as linhas de um arquivo (linhas idênticas ganham #1, #2…). */
export function chavesDoArquivo(linhas: { data: DataISO; valor: Centavos; descricao: string; contaId?: string | null }[]): string[] {
  const vistos = new Map<string, number>();
  return linhas.map((l) => {
    const base = chaveLinhaBaixa(l, 0);
    const n = (vistos.get(base) ?? 0) + 1;
    vistos.set(base, n);
    return chaveLinhaBaixa(l, n);
  });
}

// ---------------------------------------------------------------------------
// Mensagens
// ---------------------------------------------------------------------------

/** Assunto do e-mail de cobrança conforme os dias. */
export function assuntoCobranca(dias: number, competencia: DataISO): string {
  const mes = formatarCompetencia(competencia);
  if (dias > 0) return `Aluguel de ${mes} em atraso`;
  if (dias === 0) return `Seu aluguel de ${mes} vence hoje`;
  return `Lembrete: aluguel de ${mes}`;
}

/** Linha "Pix copia e cola: …" e "2ª via: …" para acrescentar à mensagem. */
export function rodapeMensagem(o: { link?: string | null; pix?: string | null; vencimento?: DataISO }): string {
  const partes: string[] = [];
  if (o.link) partes.push(`2ª via${o.vencimento ? ` (vencimento ${formatarDataBR(o.vencimento)})` : ""}: ${o.link}`);
  if (o.pix) partes.push(`Pix copia e cola:\n${o.pix}`);
  return partes.join("\n\n");
}
