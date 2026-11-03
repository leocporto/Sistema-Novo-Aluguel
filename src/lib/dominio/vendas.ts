/** Regras puras da gestão de vendas: etapas, comissão dividida, ITBI, pagamentos e checklists. */
import { paraCentavos, paraReais } from "./dinheiro";

export const ETAPAS_VENDA = ["negociacao", "aprovado", "documentacao", "financiamento", "escritura", "registro", "concluida"] as const;
export const TODAS_ETAPAS_VENDA = ["proposta", "negociacao", "reservado", "aprovado", "documentacao", "financiamento", "escritura", "registro", "concluida", "cancelada"] as const;
export const ROTULO_ETAPA_VENDA: Record<string, string> = {
  proposta: "Proposta",
  negociacao: "Negociação",
  reservado: "Reservado",
  aprovado: "Aprovada",
  documentacao: "Documentação",
  financiamento: "Financiamento",
  escritura: "Escritura",
  registro: "Registro",
  concluida: "Concluída",
  cancelada: "Cancelada",
};
/** Colunas do quadro (reservado e proposta entram junto com negociação). */
export const COLUNAS_VENDA = ["negociacao", "aprovado", "documentacao", "financiamento", "escritura", "registro", "concluida", "cancelada"] as const;
export const colunaDaVenda = (status: string) => (status === "proposta" || status === "reservado" ? "negociacao" : status);

export const ROTULO_FORMA_PAGAMENTO: Record<string, string> = {
  a_vista: "À vista",
  financiamento: "Financiamento bancário",
  consorcio: "Consórcio",
  permuta: "Permuta",
  misto: "Misto",
};
export const ETAPAS_FINANCIAMENTO = ["simulacao", "analise_credito", "aprovado", "avaliacao_banco", "contrato_assinado", "liberado"] as const;
export const ROTULO_FINANCIAMENTO: Record<string, string> = {
  nao_se_aplica: "Não se aplica",
  simulacao: "Simulação",
  analise_credito: "Análise de crédito",
  aprovado: "Crédito aprovado",
  avaliacao_banco: "Avaliação do imóvel pelo banco",
  contrato_assinado: "Contrato do banco assinado",
  liberado: "Recurso liberado",
  negado: "Crédito negado",
};
export const ROTULO_TIPO_PAGAMENTO: Record<string, string> = {
  sinal: "Sinal (arras)",
  entrada: "Entrada",
  parcela: "Parcela",
  financiamento: "Financiamento",
  fgts: "FGTS",
  consorcio: "Consórcio",
  permuta: "Permuta",
  outro: "Outro",
};
export const ROTULO_TIPO_DESPESA: Record<string, string> = {
  itbi: "ITBI",
  escritura: "Escritura (tabelionato)",
  registro: "Registro (cartório de imóveis)",
  certidoes: "Certidões",
  laudo: "Laudo / avaliação",
  taxa_banco: "Taxas do banco",
  outro: "Outra",
};
export const ROTULO_PAPEL_COMISSAO: Record<string, string> = {
  captador: "Captador",
  vendedor: "Vendedor",
  parceiro: "Parceiro",
  gerente: "Gerente",
  imobiliaria: "Imobiliária",
};
export const MOTIVOS_CANCELAMENTO_VENDA = [
  "Comprador desistiu",
  "Financiamento negado",
  "Proprietário desistiu",
  "Problema na documentação do imóvel",
  "Problema na documentação do comprador",
  "Fechou com outro imóvel",
  "Outro",
];

/** Checklists padrão (documentação e entrega de posse). */
export const CHECKLIST_DOCS_VENDA: { parte: "comprador" | "vendedor" | "imovel"; itens: { id: string; rotulo: string }[] }[] = [
  {
    parte: "comprador",
    itens: [
      { id: "c_rg_cpf", rotulo: "RG e CPF (ou CNH)" },
      { id: "c_estado_civil", rotulo: "Certidão de nascimento/casamento" },
      { id: "c_residencia", rotulo: "Comprovante de residência" },
      { id: "c_renda", rotulo: "Comprovante de renda (se financiar)" },
      { id: "c_fgts", rotulo: "Extrato do FGTS (se usar)" },
    ],
  },
  {
    parte: "vendedor",
    itens: [
      { id: "v_rg_cpf", rotulo: "RG e CPF do(s) proprietário(s) e cônjuge" },
      { id: "v_estado_civil", rotulo: "Certidão de nascimento/casamento" },
      { id: "v_certidoes_civeis", rotulo: "Certidões cíveis e de protestos" },
      { id: "v_trabalhista", rotulo: "Certidão trabalhista (CNDT)" },
      { id: "v_federal", rotulo: "Certidão da Receita Federal" },
    ],
  },
  {
    parte: "imovel",
    itens: [
      { id: "i_matricula", rotulo: "Matrícula atualizada (até 30 dias)" },
      { id: "i_onus", rotulo: "Certidão de ônus reais" },
      { id: "i_iptu", rotulo: "Certidão negativa de IPTU" },
      { id: "i_condominio", rotulo: "Declaração de quitação do condomínio" },
      { id: "i_habite_se", rotulo: "Habite-se / planta aprovada" },
    ],
  },
];
export const CHECKLIST_POSSE: { id: string; rotulo: string }[] = [
  { id: "p_chaves", rotulo: "Chaves entregues" },
  { id: "p_vistoria", rotulo: "Vistoria de entrega feita" },
  { id: "p_leituras", rotulo: "Leituras de água, luz e gás anotadas" },
  { id: "p_titularidade", rotulo: "Contas transferidas para o comprador" },
  { id: "p_condominio", rotulo: "Condomínio avisado (novo morador)" },
  { id: "p_manuais", rotulo: "Manuais e garantias entregues" },
];
export const ROTULO_PARTE_DOC: Record<string, string> = { comprador: "Comprador", vendedor: "Vendedor", imovel: "Imóvel", contrato: "Contrato", outro: "Outros" };

export function progressoChecklistVenda(marcados: Record<string, boolean> | null | undefined) {
  const todos = CHECKLIST_DOCS_VENDA.flatMap((g) => g.itens);
  const feitos = todos.filter((i) => marcados?.[i.id]).length;
  return { feitos, total: todos.length, pct: Math.round((feitos / todos.length) * 100) };
}

/** Comissão total da venda (valor fixo informado ou % sobre o valor). */
export function comissaoTotal(valorVenda: number, pct: number, valorFixo?: number | null): number {
  if (valorFixo !== null && valorFixo !== undefined && valorFixo >= 0) return valorFixo;
  return paraReais(Math.round((paraCentavos(valorVenda) * pct) / 100));
}

/**
 * Divide a comissão entre as pessoas pelos percentuais (sobre a comissão),
 * exatamente como o banco faz ao concluir a venda (concluir_venda): a parte de
 * cada pessoa é o % arredondado no centavo, na ordem da lista, sem nunca passar
 * do total. O que sobra fica com a imobiliária. A soma bate no centavo.
 */
export function dividirComissao(total: number, partes: { percentual: number }[]) {
  const soma = partes.reduce((s, p) => s + p.percentual, 0);
  if (soma > 100.0001) throw new Error("A divisão passa de 100% da comissão.");
  const totalC = Math.max(0, paraCentavos(total));
  let distribuido = 0;
  const porPessoa = partes.map((p) => {
    const parte = Math.min(Math.round((totalC * p.percentual) / 100), totalC - distribuido);
    distribuido += Math.max(0, parte);
    return paraReais(Math.max(0, parte));
  });
  return { porPessoa, imobiliaria: paraReais(totalC - distribuido), distribuido: soma };
}

/** ITBI = alíquota (%) sobre o maior entre valor da venda e valor venal (se informado). */
export function calcularItbi(valorVenda: number, aliquota: number, valorVenal?: number | null): number {
  const base = Math.max(valorVenda, valorVenal ?? 0);
  return paraReais(Math.round((paraCentavos(base) * aliquota) / 100));
}

export type PagamentoVenda = { valor: number; vencimento: string | null; pago_em: string | null };

/** Situação do cronograma de pagamentos do comprador. */
export function resumoPagamentos(pagamentos: PagamentoVenda[], valorVenda: number, hoje: string) {
  const c = (n: number) => paraCentavos(n);
  const total = pagamentos.reduce((s, p) => s + c(p.valor), 0);
  const pago = pagamentos.filter((p) => p.pago_em).reduce((s, p) => s + c(p.valor), 0);
  const atrasado = pagamentos.filter((p) => !p.pago_em && p.vencimento && p.vencimento < hoje).reduce((s, p) => s + c(p.valor), 0);
  return {
    programado: paraReais(total),
    pago: paraReais(pago),
    aReceber: paraReais(total - pago),
    atrasado: paraReais(atrasado),
    semCronograma: paraReais(Math.max(0, c(valorVenda) - total)),
    pctPago: valorVenda > 0 ? Math.round((pago / c(valorVenda)) * 100) : 0,
  };
}

export type PropostaCadeia = { id: string; proposta_pai_id: string | null; created_at: string };

/** Propostas em ordem, cada contraproposta logo abaixo da proposta que respondeu (com o nível). */
export function cadeiaPropostas<T extends PropostaCadeia>(lista: T[]): (T & { nivel: number })[] {
  const filhos = new Map<string | null, T[]>();
  const ids = new Set(lista.map((p) => p.id));
  for (const p of lista) {
    const pai = p.proposta_pai_id && ids.has(p.proposta_pai_id) ? p.proposta_pai_id : null;
    filhos.set(pai, [...(filhos.get(pai) ?? []), p]);
  }
  const saida: (T & { nivel: number })[] = [];
  const visitar = (pai: string | null, nivel: number) => {
    for (const p of (filhos.get(pai) ?? []).sort((a, b) => a.created_at.localeCompare(b.created_at))) {
      saida.push({ ...p, nivel });
      visitar(p.id, nivel + 1);
    }
  };
  visitar(null, 0);
  return saida;
}
