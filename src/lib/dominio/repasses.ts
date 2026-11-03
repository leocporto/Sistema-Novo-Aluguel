/**
 * Regras puras da gestão de repasses (só modo imobiliária): situação do
 * repasse (a aprovar, agendado, a pagar, pago…), plano de desconto das despesas
 * autorizadas com rateio entre proprietários, totais do demonstrativo e Pix
 * copia-e-cola estático para pagar o proprietário.
 *
 * O cálculo do repasse em si (aluguel − taxas − impostos) está em ./repasse.ts
 * e acontece na baixa da fatura.
 */
import type { DataISO } from "./datas";
import { type Centavos, paraCentavos, paraReais, ratear } from "./dinheiro";

// ---------------------------------------------------------------------------
// Situação
// ---------------------------------------------------------------------------

export type SituacaoRepasse = "a_aprovar" | "agendado" | "a_pagar" | "pago" | "cancelado";

export const ROTULO_SITUACAO_REPASSE: Record<SituacaoRepasse, string> = {
  a_aprovar: "A aprovar",
  agendado: "Agendado",
  a_pagar: "Liberado para pagar",
  pago: "Pago",
  cancelado: "Cancelado",
};

export const COR_SITUACAO_REPASSE: Record<SituacaoRepasse, "amarelo" | "azul" | "verde" | "cinza" | "vermelho"> = {
  a_aprovar: "amarelo",
  agendado: "azul",
  a_pagar: "vermelho",
  pago: "verde",
  cancelado: "cinza",
};

export const FORMAS_REPASSE: Record<string, string> = {
  pix: "Pix",
  transferencia: "Transferência (TED)",
  dinheiro: "Dinheiro",
  cheque: "Cheque",
  boleto: "Boleto",
  outro: "Outro",
};

type RepasseSituacao = {
  status: string;
  aprovado_em?: string | null;
  programado_para?: DataISO | null;
  previsto_para: DataISO;
};

/** Data em que o repasse deve ser pago: a agendada na aprovação ou a prevista na baixa. */
export const dataDoPagamento = (r: Pick<RepasseSituacao, "programado_para" | "previsto_para">): DataISO => r.programado_para ?? r.previsto_para;

/**
 * Situação para a tela:
 * - pendente sem aprovação → "a aprovar";
 * - aprovado com data no futuro → "agendado";
 * - aprovado com data hoje ou passada → "liberado para pagar".
 */
export function situacaoRepasse(r: RepasseSituacao, hoje: DataISO): SituacaoRepasse {
  if (r.status === "pago") return "pago";
  if (r.status === "cancelado") return "cancelado";
  if (!r.aprovado_em) return "a_aprovar";
  return dataDoPagamento(r) > hoje ? "agendado" : "a_pagar";
}

/** Pendente com a data de pagamento já passada (antes de hoje). */
export const repasseAtrasado = (r: RepasseSituacao, hoje: DataISO) => r.status === "pendente" && dataDoPagamento(r) < hoje;

/** Quem pode aprovar, pagar, cancelar e mexer no agendamento. */
export const podeAprovarRepasse = (papel: string) => papel === "admin" || papel === "gestor" || papel === "financeiro";

// ---------------------------------------------------------------------------
// Despesas autorizadas: quanto descontar de cada uma neste repasse
// ---------------------------------------------------------------------------

export interface DespesaADescontar {
  id: string;
  descricao: string;
  /** Valor total da despesa (centavos). */
  valor: Centavos;
  vencimento: DataISO;
  imovelId: string | null;
  /** Proprietário que paga sozinho; vazio = todos do imóvel pela participação. */
  descontarDeId: string | null;
  /** Quanto já foi descontado desta despesa, por proprietário (centavos). */
  descontadoPorPessoa: Record<string, Centavos>;
}

export interface Participacao {
  pessoaId: string;
  percentual: number;
}

export interface DescontoPlanejado {
  lancamentoId: string;
  descricao: string;
  valor: Centavos;
  /** Depois deste desconto a despesa fica toda descontada. */
  quita: boolean;
  /** Parte que ainda falta descontar deste proprietário (não coube no repasse). */
  sobra: Centavos;
}

/** Cota de cada proprietário numa despesa (rateio no centavo, em ordem estável). */
export function cotasDaDespesa(valor: Centavos, participacoes: Participacao[]): Map<string, Centavos> {
  const ordem = [...participacoes].filter((p) => p.percentual > 0).sort((a, b) => a.pessoaId.localeCompare(b.pessoaId));
  if (ordem.length === 0) return new Map();
  const partes = ratear(valor, ordem.map((p) => p.percentual));
  return new Map(ordem.map((p, i) => [p.pessoaId, partes[i]]));
}

/**
 * Plano de desconto das despesas autorizadas no repasse de um proprietário:
 * - só despesas do imóvel do repasse;
 * - despesa marcada para um proprietário cai inteira no repasse dele;
 * - sem dono marcado, cada proprietário paga a sua cota (pela participação);
 * - o que já foi descontado antes não se desconta de novo;
 * - nunca passa do líquido do repasse (o resto fica para o próximo);
 * - as mais antigas primeiro.
 */
export function planejarDescontos(
  repasse: { pessoaId: string; imovelId: string | null; liquido: Centavos },
  despesas: DespesaADescontar[],
  participacoes: Participacao[],
): DescontoPlanejado[] {
  let disponivel = Math.max(0, repasse.liquido);
  const plano: DescontoPlanejado[] = [];
  const ordem = [...despesas].sort((a, b) => a.vencimento.localeCompare(b.vencimento) || a.id.localeCompare(b.id));
  for (const d of ordem) {
    if (!repasse.imovelId || d.imovelId !== repasse.imovelId) continue;
    if (d.descontarDeId && d.descontarDeId !== repasse.pessoaId) continue;
    const jaTotal = Object.values(d.descontadoPorPessoa).reduce((s, v) => s + v, 0);
    const restanteTotal = d.valor - jaTotal;
    if (restanteTotal <= 0) continue;
    const jaMeu = d.descontadoPorPessoa[repasse.pessoaId] ?? 0;
    let cota: Centavos;
    if (d.descontarDeId === repasse.pessoaId) cota = d.valor;
    else {
      const cotas = cotasDaDespesa(d.valor, participacoes);
      if (!cotas.has(repasse.pessoaId)) continue;
      cota = cotas.get(repasse.pessoaId)!;
    }
    const devido = Math.min(cota - jaMeu, restanteTotal);
    if (devido <= 0) continue;
    const valor = Math.min(devido, disponivel);
    if (valor <= 0) {
      plano.push({ lancamentoId: d.id, descricao: d.descricao, valor: 0, quita: false, sobra: devido });
      continue;
    }
    disponivel -= valor;
    plano.push({ lancamentoId: d.id, descricao: d.descricao, valor, quita: jaTotal + valor >= d.valor, sobra: devido - valor });
  }
  return plano;
}

/** Despesa autorizada: quanto falta descontar e a situação para a lista. */
export function situacaoDespesa(valor: Centavos, descontado: Centavos, cancelada = false): { rotulo: string; cor: "amarelo" | "azul" | "verde" | "cinza"; falta: Centavos } {
  if (cancelada) return { rotulo: "Cancelada", cor: "cinza", falta: 0 };
  const falta = Math.max(0, valor - descontado);
  if (falta === 0) return { rotulo: "Descontada", cor: "verde", falta };
  if (descontado > 0) return { rotulo: "Descontada em parte", cor: "azul", falta };
  return { rotulo: "A descontar", cor: "amarelo", falta };
}

// ---------------------------------------------------------------------------
// Demonstrativo e extrato
// ---------------------------------------------------------------------------

export interface LinhaDemonstrativo {
  aluguel: number | string;
  encargos: number | string;
  multa_juros: number | string;
  valor_bruto: number | string;
  taxa_administracao: number | string;
  taxa_intermediacao: number | string;
  irrf: number | string;
  imposto?: number | string | null;
  outros_descontos?: number | string | null;
  valor_liquido: number | string;
  status: string;
}

export interface TotaisDemonstrativo {
  aluguel: number;
  encargos: number;
  multaJuros: number;
  bruto: number;
  taxas: number;
  impostos: number;
  descontos: number;
  liquido: number;
  pago: number;
  aPagar: number;
}

/** Soma o demonstrativo (em reais, conta feita em centavos). Cancelados ficam de fora. */
export function totaisDemonstrativo(linhas: LinhaDemonstrativo[]): TotaisDemonstrativo {
  const validos = linhas.filter((l) => l.status !== "cancelado");
  const s = (f: (l: LinhaDemonstrativo) => number | string | null | undefined, filtro: (l: LinhaDemonstrativo) => boolean = () => true) =>
    paraReais(validos.filter(filtro).reduce((t, l) => t + paraCentavos(f(l) ?? 0), 0));
  return {
    aluguel: s((l) => l.aluguel),
    encargos: s((l) => l.encargos),
    multaJuros: s((l) => l.multa_juros),
    bruto: s((l) => l.valor_bruto),
    taxas: paraReais(validos.reduce((t, l) => t + paraCentavos(l.taxa_administracao) + paraCentavos(l.taxa_intermediacao), 0)),
    impostos: paraReais(validos.reduce((t, l) => t + paraCentavos(l.irrf) + paraCentavos(l.imposto ?? 0), 0)),
    descontos: s((l) => l.outros_descontos),
    liquido: s((l) => l.valor_liquido),
    pago: s((l) => l.valor_liquido, (l) => l.status === "pago"),
    aPagar: s((l) => l.valor_liquido, (l) => l.status === "pendente"),
  };
}

/** Mensagem pronta (WhatsApp/e-mail) com o resumo do demonstrativo do mês. */
export function mensagemDemonstrativo(nome: string, competencia: string, t: TotaisDemonstrativo, organizacao: string): string {
  const r = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const primeiro = nome.split(" ")[0];
  return [
    `Olá ${primeiro}! Segue o demonstrativo de ${competencia}:`,
    `Aluguéis recebidos: ${r(t.aluguel + t.encargos + t.multaJuros)}`,
    `Taxas da administração: −${r(t.taxas)}`,
    t.impostos ? `Impostos retidos: −${r(t.impostos)}` : null,
    t.descontos ? `Despesas e descontos: −${r(t.descontos)}` : null,
    `Líquido: ${r(t.liquido)}${t.aPagar ? ` (a pagar: ${r(t.aPagar)})` : ""}`,
    `${organizacao}`,
  ]
    .filter(Boolean)
    .join("\n");
}

// ---------------------------------------------------------------------------
// Pix copia-e-cola estático (BR Code) — para pagar o proprietário pelo app do banco
// ---------------------------------------------------------------------------

/** CRC16/CCITT-FALSE (polinômio 0x1021, início 0xFFFF), como pede o padrão do Pix. */
export function crc16(texto: string): string {
  let crc = 0xffff;
  for (let i = 0; i < texto.length; i++) {
    crc ^= texto.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
const limpar = (s: string, max: number) =>
  semAcento(s)
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
    .trim();

/** CPF com os dois dígitos verificadores certos (só números, 11 dígitos, não todos iguais). */
export function cpfValido(digitos: string): boolean {
  if (!/^\d{11}$/.test(digitos) || /^(\d)\1{10}$/.test(digitos)) return false;
  const dv = (n: number) => {
    let soma = 0;
    for (let i = 0; i < n; i++) soma += Number(digitos[i]) * (n + 1 - i);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(digitos[9]) && dv(10) === Number(digitos[10]);
}

/** CNPJ com os dois dígitos verificadores certos (só números, 14 dígitos). */
export function cnpjValido(digitos: string): boolean {
  if (!/^\d{14}$/.test(digitos) || /^(\d)\1{13}$/.test(digitos)) return false;
  const dv = (n: number) => {
    const pesos = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const soma = pesos.reduce((s, p, i) => s + Number(digitos[i]) * p, 0);
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return dv(12) === Number(digitos[12]) && dv(13) === Number(digitos[13]);
}

export type TipoChavePix = "email" | "aleatoria" | "telefone" | "cpf" | "cnpj" | "outra";

export const ROTULO_TIPO_CHAVE_PIX: Record<TipoChavePix, string> = {
  email: "e-mail",
  aleatoria: "chave aleatória",
  telefone: "celular",
  cpf: "CPF",
  cnpj: "CNPJ",
  outra: "chave",
};

export interface ChavePix {
  chave: string;
  tipo: TipoChavePix;
  /** Pode ser lida de dois jeitos (ex.: 11 números que formam CPF válido e também celular). */
  ambigua: boolean;
  /** Aviso para mostrar na tela (chave ambígua ou com dígitos que não conferem). */
  aviso: string | null;
}

/** Celular brasileiro só com números: DDD (11–99) + 9 + 8 dígitos. */
const pareceCelular = (d: string) => /^[1-9][1-9]9\d{8}$/.test(d);

/**
 * Lê a chave Pix cadastrada (texto livre no cadastro da pessoa):
 * - e-mail em minúsculas; chave aleatória como está;
 * - com "+" ou escrita como telefone — "(11) 9…", "11 98765-4321" — é celular (+55…);
 * - 11 números: CPF quando os dígitos verificadores conferem (mesmo que também
 *   pareça celular — aí vem `ambigua` com aviso); senão, celular se tiver o
 *   formato; formatado como CPF (000.000.000-00) é CPF;
 * - 14 números: CNPJ.
 * Devolve null se estiver vazia.
 */
export function analisarChavePix(chave: string | null | undefined): ChavePix | null {
  const c = (chave ?? "").trim();
  if (!c) return null;
  const montar = (valor: string, tipo: TipoChavePix, aviso: string | null = null, ambigua = false): ChavePix => ({ chave: valor, tipo, ambigua, aviso });
  if (c.includes("@")) return montar(c.toLowerCase(), "email");
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(c)) return montar(c.toLowerCase(), "aleatoria");
  const d = c.replace(/\D/g, "");
  if (c.startsWith("+")) return montar(`+${d}`, "telefone");
  // Escrito como telefone: com parênteses no DDD ou com espaço/hífen no lugar do celular.
  if (/\(\d{2}\)/.test(c) || /^\d{2}[\s-]+9\d{4}[\s-]?\d{4}$/.test(c) || /^\d{2}9\d{4}-\d{4}$/.test(c)) return montar(`+55${d}`, "telefone");
  if (/^\d{3}\.\d{3}\.\d{3}-\d{2}$/.test(c))
    return montar(d, "cpf", cpfValido(d) ? null : "Os dígitos deste CPF não conferem: confira a chave Pix no cadastro.");
  if (d.length === 11 && /^\d+$/.test(c)) {
    if (cpfValido(d))
      return pareceCelular(d)
        ? montar(d, "cpf", "Estes 11 números podem ser um CPF ou um celular. O sistema usa como CPF (os dígitos conferem); confirme com o proprietário. Se for celular, cadastre com o DDD entre parênteses: (11) 98765-4321.", true)
        : montar(d, "cpf");
    if (pareceCelular(d)) return montar(`+55${d}`, "telefone");
    return montar(d, "cpf", "Os dígitos deste CPF não conferem: confira a chave Pix no cadastro.");
  }
  if (d.length === 14 && /^[\d./-]+$/.test(c)) return montar(d, "cnpj", cnpjValido(d) ? null : "Os dígitos deste CNPJ não conferem: confira a chave Pix no cadastro.");
  return montar(c, "outra");
}

/** Só a chave normalizada (veja analisarChavePix). */
export function normalizarChavePix(chave: string | null | undefined): string | null {
  return analisarChavePix(chave)?.chave ?? null;
}

const campo = (id: string, valor: string) => `${id}${String(valor.length).padStart(2, "0")}${valor}`;

/**
 * Pix copia-e-cola estático com valor (o banco do pagador lê e já preenche
 * chave, nome e valor). Não depende de banco nem de credencial.
 */
export function pixCopiaECola(opts: { chave: string; nome: string; cidade?: string | null; valor?: number | null; txid?: string | null; descricao?: string | null }): string {
  const chave = normalizarChavePix(opts.chave);
  if (!chave) throw new Error("Proprietário sem chave Pix.");
  const descricao = opts.descricao ? limpar(opts.descricao, 40) : "";
  const conta = campo("00", "br.gov.bcb.pix") + campo("01", chave) + (descricao ? campo("02", descricao) : "");
  const txid = (opts.txid ?? "").replace(/[^A-Za-z0-9]/g, "").slice(0, 25) || "***";
  const valor = opts.valor && opts.valor > 0 ? (Math.round(opts.valor * 100) / 100).toFixed(2) : null;
  const corpo =
    campo("00", "01") +
    campo("26", conta) +
    campo("52", "0000") +
    campo("53", "986") +
    (valor ? campo("54", valor) : "") +
    campo("58", "BR") +
    campo("59", limpar(opts.nome, 25) || "PROPRIETARIO") +
    campo("60", limpar(opts.cidade ?? "", 15) || "BRASIL") +
    campo("62", campo("05", txid)) +
    "6304";
  return corpo + crc16(corpo);
}
