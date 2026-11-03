/**
 * Regras do financeiro (nos dois modos): séries de lançamentos (todo mês /
 * parcelado), baixa com juros e desconto, saldo por conta, leitura de extrato
 * (OFX e CSV), sugestão de conciliação, DRE, fluxo de caixa, orçado × realizado
 * e exportação em CSV para o contador.
 */
import { diasEntre, somarMeses, type DataISO } from "./datas";
import { paraCentavos, paraReais } from "./dinheiro";

export type TipoLancamento = "receber" | "pagar";

export const ROTULO_TIPO_CONTA: Record<string, string> = {
  corrente: "Conta corrente",
  poupanca: "Poupança",
  caixa: "Caixa (dinheiro)",
  carteira: "Carteira",
  investimento: "Investimento",
  pagamento: "Conta de pagamento",
};

export const FORMAS_PAGAMENTO: Record<string, string> = {
  pix: "Pix",
  boleto: "Boleto",
  transferencia: "Transferência",
  dinheiro: "Dinheiro",
  cartao: "Cartão",
  debito_automatico: "Débito automático",
  cheque: "Cheque",
  outro: "Outro",
};

export const GRUPOS_DRE: Record<string, string> = {
  receita_operacional: "Receita operacional",
  deducoes: "Deduções da receita",
  custos: "Custos dos serviços",
  despesas_operacionais: "Despesas operacionais",
  receita_financeira: "Receitas financeiras",
  despesa_financeira: "Despesas financeiras",
  impostos: "Impostos sobre o resultado",
  outros: "Outros",
  nao_dre: "Fora do resultado (transferências, terceiros)",
};

/** Ordem e sinal de cada grupo no resultado (receita +, despesa −). */
const ORDEM_DRE: { grupo: string; sinal: 1 | -1 }[] = [
  { grupo: "receita_operacional", sinal: 1 },
  { grupo: "deducoes", sinal: -1 },
  { grupo: "custos", sinal: -1 },
  { grupo: "despesas_operacionais", sinal: -1 },
  { grupo: "receita_financeira", sinal: 1 },
  { grupo: "despesa_financeira", sinal: -1 },
  { grupo: "outros", sinal: 1 },
  { grupo: "impostos", sinal: -1 },
];

export const ROTULO_ACAO_HISTORICO: Record<string, string> = {
  criado: "Criado",
  alterado: "Alterado",
  liquidado: "Baixado (pago/recebido)",
  estornado: "Estornado",
  cancelado: "Cancelado",
  aprovado: "Aprovado",
  excluido: "Excluído",
};

export const ROTULO_CAMPO_HISTORICO: Record<string, string> = {
  descricao: "Descrição",
  categoria: "Categoria",
  valor: "Valor",
  vencimento: "Vencimento",
  status: "Situação",
  liquidado_em: "Data da baixa",
  valor_pago: "Valor pago",
  juros: "Juros/multa",
  desconto: "Desconto",
  conta_id: "Conta",
  plano_id: "Plano de contas",
  aprovado_em: "Aprovação",
  cancelado_motivo: "Motivo do cancelamento",
  pessoa_id: "Pessoa",
};

// ---------------------------------------------------------------------------
// Séries (repetir todo mês / parcelado)
// ---------------------------------------------------------------------------

export type Repeticao = "nao" | "mensal" | "parcelado";

export interface ItemSerie {
  descricao: string;
  valor: number;
  vencimento: DataISO;
  parcela: number | null;
  parcelas: number | null;
}

/**
 * Monta os lançamentos de uma série.
 * - "mensal": o mesmo valor todo mês, por `vezes` meses.
 * - "parcelado": o total dividido em `vezes`; os centavos que sobram vão na última.
 * Dia 31 em mês curto vira o último dia do mês (sem pular mês).
 */
export function gerarSerie(opts: { descricao: string; valor: number; vencimento: DataISO; repeticao: Repeticao; vezes?: number | null }): ItemSerie[] {
  const vezes = Math.max(1, Math.min(360, Math.floor(opts.vezes ?? 1)));
  if (opts.repeticao === "nao" || vezes === 1)
    return [{ descricao: opts.descricao, valor: opts.valor, vencimento: opts.vencimento, parcela: null, parcelas: null }];
  if (opts.repeticao === "mensal")
    return Array.from({ length: vezes }, (_, i) => ({
      descricao: opts.descricao,
      valor: opts.valor,
      vencimento: somarMeses(opts.vencimento, i),
      parcela: i + 1,
      parcelas: vezes,
    }));
  const total = paraCentavos(opts.valor);
  const base = Math.floor(total / vezes);
  return Array.from({ length: vezes }, (_, i) => ({
    descricao: `${opts.descricao} (${i + 1}/${vezes})`,
    valor: paraReais(i === vezes - 1 ? total - base * (vezes - 1) : base),
    vencimento: somarMeses(opts.vencimento, i),
    parcela: i + 1,
    parcelas: vezes,
  }));
}

// ---------------------------------------------------------------------------
// Baixa
// ---------------------------------------------------------------------------

/** Valor efetivamente pago/recebido: valor + juros/multa − desconto (nunca negativo). */
export function valorDaBaixa(valor: number, juros = 0, desconto = 0): number {
  return paraReais(Math.max(0, paraCentavos(valor) + paraCentavos(juros) - paraCentavos(desconto)));
}

/** O lançamento precisa de aprovação antes de ser pago? */
export function precisaAprovacao(tipo: TipoLancamento, valor: number, limite: number | null | undefined): boolean {
  return tipo === "pagar" && limite != null && limite > 0 && valor > limite;
}

export type SituacaoLancamento = "aberto" | "vencido" | "liquidado" | "cancelado" | "aguardando_aprovacao";

export function situacaoLancamento(l: { status: string; vencimento: DataISO; requer_aprovacao?: boolean | null; aprovado_em?: string | null }, hoje: DataISO): SituacaoLancamento {
  if (l.status === "liquidado") return "liquidado";
  if (l.status === "cancelado") return "cancelado";
  if (l.requer_aprovacao && !l.aprovado_em) return "aguardando_aprovacao";
  return l.vencimento < hoje ? "vencido" : "aberto";
}

export const ROTULO_SITUACAO: Record<SituacaoLancamento, string> = {
  aberto: "Em aberto",
  vencido: "Vencido",
  liquidado: "Baixado",
  cancelado: "Cancelado",
  aguardando_aprovacao: "Aguardando aprovação",
};

// ---------------------------------------------------------------------------
// Saldo por conta
// ---------------------------------------------------------------------------

export interface MovConta {
  tipo: TipoLancamento;
  valor: number;
  valor_pago?: number | null;
  liquidado_em: DataISO | null;
  conta_id: string | null;
  status: string;
}

/** Valor que entrou/saiu de fato (valor pago, se houver; senão o valor). */
export function valorRealizado(l: { valor: number; valor_pago?: number | null }): number {
  return Number(l.valor_pago ?? l.valor);
}

/**
 * Saldo de uma conta numa data: saldo inicial + recebimentos − pagamentos +
 * transferências recebidas − enviadas, contando só o que aconteceu a partir do
 * dia do saldo inicial e até `ate` (inclusive).
 */
export function saldoConta(
  conta: { id: string; saldo_inicial: number; saldo_inicial_em: DataISO },
  lancamentos: MovConta[],
  transferencias: { origem_id: string; destino_id: string; valor: number; data: DataISO }[],
  ate?: DataISO,
): number {
  const dentro = (d: DataISO | null) => !!d && d >= conta.saldo_inicial_em && (!ate || d <= ate);
  let c = paraCentavos(conta.saldo_inicial);
  for (const l of lancamentos) {
    if (l.conta_id !== conta.id || l.status !== "liquidado" || !dentro(l.liquidado_em)) continue;
    const v = paraCentavos(valorRealizado(l));
    c += l.tipo === "receber" ? v : -v;
  }
  for (const t of transferencias) {
    if (!dentro(t.data)) continue;
    if (t.destino_id === conta.id) c += paraCentavos(t.valor);
    if (t.origem_id === conta.id) c -= paraCentavos(t.valor);
  }
  return paraReais(c);
}

// ---------------------------------------------------------------------------
// Extrato bancário: OFX e CSV
// ---------------------------------------------------------------------------

export interface ItemExtrato {
  data: DataISO;
  valor: number;
  descricao: string;
  documento: string | null;
  fitid: string;
}

/** Número em formato brasileiro ou americano ("1.234,56", "-1234.56", "R$ 10,00"). */
export function lerNumero(txt: string): number | null {
  let s = txt.replace(/[R$\s]/g, "").trim();
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1);
  }
  if (s.endsWith("-")) {
    neg = true;
    s = s.slice(0, -1);
  }
  if (s.includes(",") && s.includes(".")) {
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
  } else if (s.includes(",")) s = s.replace(",", ".");
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return neg ? -Math.abs(n) : n;
}

/** Data "dd/mm/aaaa", "aaaa-mm-dd" ou "aaaammdd" → ISO. */
export function lerData(txt: string): DataISO | null {
  const s = txt.trim();
  let m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(s);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  m = /^(\d{2})\/(\d{2})\/(\d{2})$/.exec(s);
  if (m) return `20${m[3]}-${m[2]}-${m[1]}`;
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{4})(\d{2})(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

/** Código estável de uma linha sem identificador (para não importar duas vezes). */
function chaveLinha(data: string, valor: number, descricao: string, n: number): string {
  let h = 5381;
  for (const ch of `${data}|${valor.toFixed(2)}|${descricao}|${n}`) h = ((h << 5) + h + ch.charCodeAt(0)) >>> 0;
  return `csv-${h.toString(36)}`;
}

/** Lê um arquivo OFX (o "extrato para programas" que todo banco exporta). */
export function lerOFX(texto: string): ItemExtrato[] {
  const itens: ItemExtrato[] = [];
  const blocos = texto.split(/<STMTTRN>/i).slice(1);
  const campo = (b: string, nome: string) => {
    const m = new RegExp(`<${nome}>([^<\\r\\n]*)`, "i").exec(b);
    return m ? m[1].trim() : "";
  };
  for (const b of blocos) {
    const data = lerData(campo(b, "DTPOSTED"));
    const valor = lerNumero(campo(b, "TRNAMT"));
    if (!data || valor === null) continue;
    const descricao = [campo(b, "MEMO"), campo(b, "NAME")].filter(Boolean).join(" — ") || "Movimento";
    const documento = campo(b, "CHECKNUM") || campo(b, "REFNUM") || null;
    const fitid = campo(b, "FITID") || chaveLinha(data, valor, descricao, itens.length);
    itens.push({ data, valor, descricao, documento, fitid });
  }
  return itens;
}

/**
 * Lê um extrato em CSV/planilha salva como texto. Procura as colunas de data,
 * descrição e valor pelo título (ou pela posição: data, descrição, valor).
 * Aceita ";" ou "," como separador e colunas separadas de crédito/débito.
 */
export function lerCSVExtrato(texto: string): ItemExtrato[] {
  const linhas = texto.split(/\r?\n/).filter((l) => l.trim());
  if (!linhas.length) return [];
  const sep = (linhas[0].match(/;/g)?.length ?? 0) >= (linhas[0].match(/,/g)?.length ?? 0) ? ";" : ",";
  const quebrar = (l: string) => {
    const out: string[] = [];
    let atual = "";
    let aspas = false;
    for (const ch of l) {
      if (ch === '"') aspas = !aspas;
      else if (ch === sep && !aspas) {
        out.push(atual);
        atual = "";
      } else atual += ch;
    }
    out.push(atual);
    return out.map((c) => c.trim());
  };
  const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const cab = quebrar(linhas[0]).map(norm);
  const temCab = cab.some((c) => /data|descri|hist|valor|lancamento/.test(c));
  const achar = (re: RegExp) => cab.findIndex((c) => re.test(c));
  let iData = temCab ? achar(/^data|dt/) : 0;
  let iDesc = temCab ? achar(/descri|hist|lancamento|memo/) : 1;
  let iValor = temCab ? achar(/^valor|montante|quantia/) : 2;
  const iCred = temCab ? achar(/credito|entrada/) : -1;
  const iDeb = temCab ? achar(/debito|saida/) : -1;
  const iDoc = temCab ? achar(/doc|numero/) : -1;
  if (iData < 0) iData = 0;
  if (iDesc < 0) iDesc = 1;
  if (iValor < 0 && iCred < 0) iValor = 2;
  const itens: ItemExtrato[] = [];
  for (const l of linhas.slice(temCab ? 1 : 0)) {
    const c = quebrar(l);
    const data = lerData(c[iData] ?? "");
    if (!data) continue;
    let valor: number | null = null;
    if (iValor >= 0) valor = lerNumero(c[iValor] ?? "");
    if (valor === null && (iCred >= 0 || iDeb >= 0)) {
      const cr = iCred >= 0 ? lerNumero(c[iCred] ?? "") : null;
      const db = iDeb >= 0 ? lerNumero(c[iDeb] ?? "") : null;
      if (cr) valor = Math.abs(cr);
      else if (db) valor = -Math.abs(db);
    }
    if (valor === null || valor === 0) continue;
    const descricao = (c[iDesc] ?? "").replace(/\s+/g, " ") || "Movimento";
    if (/saldo/i.test(descricao) && !/pagamento|pix|transf/i.test(descricao)) continue;
    const documento = iDoc >= 0 ? c[iDoc] || null : null;
    itens.push({ data, valor, descricao, documento, fitid: chaveLinha(data, valor, descricao, itens.length) });
  }
  return itens;
}

/** Decide o formato pelo conteúdo. */
export function lerExtrato(texto: string): ItemExtrato[] {
  return /<STMTTRN>/i.test(texto) ? lerOFX(texto) : lerCSVExtrato(texto);
}

// ---------------------------------------------------------------------------
// Conciliação
// ---------------------------------------------------------------------------

export interface CandidatoConciliacao {
  id: string;
  tipo: TipoLancamento;
  descricao: string;
  valor: number;
  valor_pago?: number | null;
  vencimento: DataISO;
  liquidado_em: DataISO | null;
  status: string;
  conciliado_em?: string | null;
}

/**
 * Sugere o lançamento que corresponde a uma linha do extrato: mesmo sentido
 * (entrada = a receber, saída = a pagar), mesmo valor (até 1 centavo) e data
 * próxima (até 7 dias do vencimento ou da baixa). Já conciliados ficam de fora.
 * Devolve os candidatos do melhor para o pior.
 */
export function sugerirConciliacao(item: { data: DataISO; valor: number; descricao: string }, lancamentos: CandidatoConciliacao[], usados: Set<string> = new Set()): CandidatoConciliacao[] {
  const tipo: TipoLancamento = item.valor >= 0 ? "receber" : "pagar";
  const alvo = Math.abs(paraCentavos(item.valor));
  const palavras = new Set(item.descricao.toLowerCase().split(/\W+/).filter((p) => p.length > 3));
  return lancamentos
    .filter((l) => l.tipo === tipo && l.status !== "cancelado" && !l.conciliado_em && !usados.has(l.id))
    .map((l) => {
      const v = paraCentavos(l.status === "liquidado" ? valorRealizado(l) : l.valor);
      const ref = l.liquidado_em ?? l.vencimento;
      const dias = Math.abs(diasEntre(ref, item.data));
      const comum = l.descricao.toLowerCase().split(/\W+/).filter((p) => palavras.has(p)).length;
      return { l, ok: Math.abs(v - alvo) <= 1 && dias <= 7, nota: dias - comum * 2 };
    })
    .filter((x) => x.ok)
    .sort((a, b) => a.nota - b.nota)
    .map((x) => x.l);
}

// ---------------------------------------------------------------------------
// DRE, fluxo de caixa e orçamento
// ---------------------------------------------------------------------------

export interface LinhaRealizada {
  tipo: TipoLancamento;
  valor: number;
  grupo_dre: string | null;
  plano_id: string | null;
  plano_nome?: string | null;
}

export interface LinhaDRE {
  grupo: string;
  rotulo: string;
  sinal: 1 | -1;
  total: number;
  contas: { plano_id: string | null; nome: string; total: number }[];
}

/**
 * Monta a DRE pelo regime de caixa (o que foi pago/recebido). Lançamento sem
 * plano de contas cai em "Receita operacional" (receitas) ou "Despesas
 * operacionais" (despesas). Grupo "nao_dre" não entra no resultado.
 */
export function montarDRE(linhas: LinhaRealizada[]): { linhas: LinhaDRE[]; receitaBruta: number; resultado: number } {
  const mapa = new Map<string, Map<string, { plano_id: string | null; nome: string; c: number }>>();
  for (const l of linhas) {
    const grupo = l.grupo_dre ?? (l.tipo === "receber" ? "receita_operacional" : "despesas_operacionais");
    if (grupo === "nao_dre") continue;
    const sinalGrupo = ORDEM_DRE.find((o) => o.grupo === grupo)?.sinal ?? 1;
    // o valor entra positivo no grupo; se o sentido for o contrário do grupo, abate
    const sentido = (l.tipo === "receber" ? 1 : -1) * sinalGrupo;
    const g = mapa.get(grupo) ?? new Map();
    const chave = l.plano_id ?? `sem-${l.tipo}`;
    const atual = g.get(chave) ?? { plano_id: l.plano_id, nome: l.plano_nome ?? (l.tipo === "receber" ? "Receitas sem plano de contas" : "Despesas sem plano de contas"), c: 0 };
    atual.c += sentido * paraCentavos(l.valor);
    g.set(chave, atual);
    mapa.set(grupo, g);
  }
  let resultado = 0;
  const saida: LinhaDRE[] = [];
  for (const o of ORDEM_DRE) {
    const g = mapa.get(o.grupo);
    if (!g) continue;
    const contas = [...g.values()].map((x) => ({ plano_id: x.plano_id, nome: x.nome, total: paraReais(x.c) })).sort((a, b) => b.total - a.total);
    const c = [...g.values()].reduce((s, x) => s + x.c, 0);
    resultado += o.sinal * c;
    saida.push({ grupo: o.grupo, rotulo: GRUPOS_DRE[o.grupo], sinal: o.sinal, total: paraReais(c), contas });
  }
  const receitaBruta = saida.find((s) => s.grupo === "receita_operacional")?.total ?? 0;
  return { linhas: saida, receitaBruta, resultado: paraReais(resultado) };
}

export interface MovFluxo {
  tipo: TipoLancamento;
  valor: number;
  data: DataISO;
  realizado: boolean;
}

export interface PeriodoFluxo {
  chave: string;
  entradasRealizadas: number;
  saidasRealizadas: number;
  entradasPrevistas: number;
  saidasPrevistas: number;
  saldoFinal: number;
}

/**
 * Fluxo de caixa agrupado por dia ("dia") ou mês ("mes"): o que entrou e saiu
 * de fato e o que está previsto, com o saldo acumulado a partir de `saldoInicial`.
 */
export function fluxoDeCaixa(movs: MovFluxo[], saldoInicial: number, agrupar: "dia" | "mes", de: DataISO, ate: DataISO): PeriodoFluxo[] {
  const chaveDe = (d: DataISO) => (agrupar === "mes" ? d.slice(0, 7) : d);
  const mapa = new Map<string, { er: number; sr: number; ep: number; sp: number }>();
  for (const m of movs) {
    if (m.data < de || m.data > ate) continue;
    const k = chaveDe(m.data);
    const a = mapa.get(k) ?? { er: 0, sr: 0, ep: 0, sp: 0 };
    const v = paraCentavos(m.valor);
    if (m.tipo === "receber") {
      if (m.realizado) a.er += v;
      else a.ep += v;
    } else if (m.realizado) a.sr += v;
    else a.sp += v;
    mapa.set(k, a);
  }
  let saldo = paraCentavos(saldoInicial);
  return [...mapa.keys()].sort().map((k) => {
    const a = mapa.get(k)!;
    saldo += a.er + a.ep - a.sr - a.sp;
    return {
      chave: k,
      entradasRealizadas: paraReais(a.er),
      saidasRealizadas: paraReais(a.sr),
      entradasPrevistas: paraReais(a.ep),
      saidasPrevistas: paraReais(a.sp),
      saldoFinal: paraReais(saldo),
    };
  });
}

/** Orçado × realizado por conta: diferença e % usado. */
export function orcadoRealizado(orcado: number, realizado: number): { diferenca: number; pct: number | null; estourou: boolean } {
  const diferenca = paraReais(paraCentavos(orcado) - paraCentavos(realizado));
  return { diferenca, pct: orcado > 0 ? Math.round((realizado / orcado) * 1000) / 10 : null, estourou: orcado > 0 && realizado > orcado };
}

// ---------------------------------------------------------------------------
// Plano de contas padrão
// ---------------------------------------------------------------------------

export interface ContaPlano {
  codigo: string;
  nome: string;
  tipo: "receita" | "despesa";
  grupo_dre: string;
}

export function planoPadrao(modo: "imobiliaria" | "pessoal"): ContaPlano[] {
  const comum: ContaPlano[] = [
    { codigo: "3.1", nome: "Rendimentos de aplicações", tipo: "receita", grupo_dre: "receita_financeira" },
    { codigo: "3.2", nome: "Juros e multas recebidos", tipo: "receita", grupo_dre: "receita_financeira" },
    { codigo: "6.1", nome: "Tarifas bancárias", tipo: "despesa", grupo_dre: "despesa_financeira" },
    { codigo: "6.2", nome: "Juros e multas pagos", tipo: "despesa", grupo_dre: "despesa_financeira" },
    { codigo: "9.1", nome: "Transferências entre contas", tipo: "despesa", grupo_dre: "nao_dre" },
  ];
  if (modo === "pessoal")
    return [
      { codigo: "1.1", nome: "Aluguéis recebidos", tipo: "receita", grupo_dre: "receita_operacional" },
      { codigo: "1.2", nome: "Encargos reembolsados pelo inquilino", tipo: "receita", grupo_dre: "receita_operacional" },
      { codigo: "1.3", nome: "Multas contratuais recebidas", tipo: "receita", grupo_dre: "receita_operacional" },
      { codigo: "4.1", nome: "IPTU", tipo: "despesa", grupo_dre: "despesas_operacionais" },
      { codigo: "4.2", nome: "Condomínio", tipo: "despesa", grupo_dre: "despesas_operacionais" },
      { codigo: "4.3", nome: "Manutenção e reformas", tipo: "despesa", grupo_dre: "despesas_operacionais" },
      { codigo: "4.4", nome: "Seguro do imóvel", tipo: "despesa", grupo_dre: "despesas_operacionais" },
      { codigo: "4.5", nome: "Água, luz e gás (imóvel vago)", tipo: "despesa", grupo_dre: "despesas_operacionais" },
      { codigo: "4.6", nome: "Honorários (advogado, contador)", tipo: "despesa", grupo_dre: "despesas_operacionais" },
      { codigo: "7.1", nome: "Imposto de renda (carnê-leão)", tipo: "despesa", grupo_dre: "impostos" },
      ...comum,
    ];
  return [
    { codigo: "1.1", nome: "Taxa de administração", tipo: "receita", grupo_dre: "receita_operacional" },
    { codigo: "1.2", nome: "Taxa de intermediação / 1º aluguel", tipo: "receita", grupo_dre: "receita_operacional" },
    { codigo: "1.3", nome: "Comissões de venda", tipo: "receita", grupo_dre: "receita_operacional" },
    { codigo: "1.4", nome: "Taxa de contrato / vistoria / outros serviços", tipo: "receita", grupo_dre: "receita_operacional" },
    { codigo: "2.1", nome: "ISS sobre serviços", tipo: "despesa", grupo_dre: "deducoes" },
    { codigo: "2.2", nome: "Simples Nacional / PIS / COFINS", tipo: "despesa", grupo_dre: "deducoes" },
    { codigo: "3.3", nome: "Comissões pagas a corretores", tipo: "despesa", grupo_dre: "custos" },
    { codigo: "4.1", nome: "Aluguel do escritório", tipo: "despesa", grupo_dre: "despesas_operacionais" },
    { codigo: "4.2", nome: "Salários e encargos", tipo: "despesa", grupo_dre: "despesas_operacionais" },
    { codigo: "4.3", nome: "Pró-labore", tipo: "despesa", grupo_dre: "despesas_operacionais" },
    { codigo: "4.4", nome: "Marketing e portais", tipo: "despesa", grupo_dre: "despesas_operacionais" },
    { codigo: "4.5", nome: "Sistemas e internet", tipo: "despesa", grupo_dre: "despesas_operacionais" },
    { codigo: "4.6", nome: "Contabilidade e jurídico", tipo: "despesa", grupo_dre: "despesas_operacionais" },
    { codigo: "4.7", nome: "Água, luz e telefone", tipo: "despesa", grupo_dre: "despesas_operacionais" },
    { codigo: "4.8", nome: "Material de escritório e limpeza", tipo: "despesa", grupo_dre: "despesas_operacionais" },
    { codigo: "7.1", nome: "IRPJ / CSLL", tipo: "despesa", grupo_dre: "impostos" },
    { codigo: "9.2", nome: "Valores de terceiros (aluguéis a repassar)", tipo: "receita", grupo_dre: "nao_dre" },
    ...comum,
  ];
}

// ---------------------------------------------------------------------------
// Exportação
// ---------------------------------------------------------------------------

/** CSV com ";" (abre direto no Excel em português), com BOM para acentos. */
export function paraCSV(cabecalho: string[], linhas: (string | number | null | undefined)[][]): string {
  const cel = (v: string | number | null | undefined) => {
    if (v === null || v === undefined) return "";
    const s = typeof v === "number" ? v.toFixed(2).replace(".", ",") : String(v);
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + [cabecalho, ...linhas].map((l) => l.map(cel).join(";")).join("\r\n");
}
