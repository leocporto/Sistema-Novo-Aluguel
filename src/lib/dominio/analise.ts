/**
 * Regras puras da análise cadastral (candidatos a locatário) e das garantias
 * locatícias: checklist, renda e comprometimento, crédito com base legal
 * (LGPD), fiadores, garantias propostas, decisão e exceção, vencimentos e
 * mensagens prontas. Dinheiro em centavos (dinheiro.ts); datas ISO (datas.ts).
 *
 * ⚠️ foraDaRegra() é a mesma conta de privado.analise_fora_da_regra() na
 * migração 20261106000005_analise_cadastral.sql — mude as duas juntas.
 */
import { paraCentavos, paraReais, formatarReais } from "./dinheiro";
import { diasEntre, formatarDataBR, somarDias, type DataISO } from "./datas";
import { somenteDigitos, validarCNPJ, validarCPF } from "./documentos";

// Situação, decisão e rótulos ------------------------------------------------------
export const STATUS_ANALISE = ["em_analise", "aprovada", "aprovada_condicoes", "reprovada", "desistencia", "contratada"] as const;
export type StatusAnalise = (typeof STATUS_ANALISE)[number];
export const ROTULO_STATUS_ANALISE: Record<string, string> = {
  em_analise: "Em análise",
  aprovada: "Aprovada",
  aprovada_condicoes: "Aprovada com condições",
  reprovada: "Reprovada",
  desistencia: "Desistiu",
  contratada: "Virou contrato",
};
export const COR_STATUS_ANALISE: Record<string, "azul" | "verde" | "amarelo" | "vermelho" | "cinza"> = {
  em_analise: "azul",
  aprovada: "verde",
  aprovada_condicoes: "amarelo",
  reprovada: "vermelho",
  desistencia: "cinza",
  contratada: "verde",
};

export const DECISOES = ["aprovado", "aprovado_condicoes", "reprovado"] as const;
export type Decisao = (typeof DECISOES)[number];
export const ROTULO_DECISAO: Record<string, string> = {
  aprovado: "Aprovado",
  aprovado_condicoes: "Aprovado com condições",
  reprovado: "Reprovado",
};

export const TIPOS_RENDA = ["clt", "servidor", "pro_labore", "autonomo", "empresario", "aposentadoria", "pensao", "aluguel", "investimentos", "beneficio", "outro"] as const;
export const ROTULO_TIPO_RENDA: Record<string, string> = {
  clt: "Salário (carteira assinada)",
  servidor: "Servidor público",
  pro_labore: "Pró-labore",
  autonomo: "Autônomo / profissional liberal",
  empresario: "Lucros da empresa",
  aposentadoria: "Aposentadoria",
  pensao: "Pensão",
  aluguel: "Aluguéis recebidos",
  investimentos: "Rendimentos de investimentos",
  beneficio: "Benefício (INSS, bolsa…)",
  outro: "Outra renda",
};

export const BUREAUS = ["serasa", "spc", "boa_vista", "quod", "outro"] as const;
export const ROTULO_BUREAU: Record<string, string> = {
  serasa: "Serasa Experian",
  spc: "SPC Brasil",
  boa_vista: "Boa Vista (SCPC)",
  quod: "Quod",
  outro: "Outro",
};

export const BASES_LEGAIS = ["consentimento", "protecao_credito"] as const;
export type BaseLegal = (typeof BASES_LEGAIS)[number];
export const ROTULO_BASE_LEGAL: Record<string, string> = {
  consentimento: "Consentimento do titular (LGPD art. 7º, I)",
  protecao_credito: "Proteção do crédito (LGPD art. 7º, X)",
};
export const EXPLICA_BASE_LEGAL: Record<string, string> = {
  consentimento: "O candidato autorizou por escrito (ficha, e-mail ou assinatura). Guarde a autorização: ele pode pedir para retirar.",
  protecao_credito:
    "A lei permite consultar para proteger o crédito numa locação que o próprio candidato pediu, sem autorização separada. Use só para esta análise e informe o candidato.",
};

export const STATUS_DOCUMENTO = ["pendente", "recebido", "validado", "recusado", "dispensado"] as const;
export const ROTULO_STATUS_DOCUMENTO: Record<string, string> = {
  pendente: "Pendente",
  recebido: "Recebido (conferir)",
  validado: "Validado",
  recusado: "Recusado",
  dispensado: "Dispensado",
};
export const COR_STATUS_DOCUMENTO: Record<string, "azul" | "verde" | "amarelo" | "vermelho" | "cinza"> = {
  pendente: "cinza",
  recebido: "azul",
  validado: "verde",
  recusado: "vermelho",
  dispensado: "cinza",
};
export const PARTES_DOCUMENTO = ["candidato", "fiador", "conjuge", "garantia", "outro"] as const;
export const ROTULO_PARTE_DOCUMENTO: Record<string, string> = {
  candidato: "Candidato",
  fiador: "Fiador",
  conjuge: "Cônjuge / quem compõe renda",
  garantia: "Garantia",
  outro: "Outros",
};

export const TIPOS_GARANTIA_PROPOSTA = ["seguro_fianca", "fiador", "caucao", "titulo_capitalizacao", "carta_fianca", "outro"] as const;
export const STATUS_GARANTIA_PROPOSTA = ["proposta", "solicitada", "em_analise", "aprovada", "aprovada_restricao", "recusada", "cancelada", "contratada"] as const;
export const ROTULO_STATUS_GARANTIA_PROPOSTA: Record<string, string> = {
  proposta: "Proposta (não enviada)",
  solicitada: "Solicitada à garantidora",
  em_analise: "Em análise na garantidora",
  aprovada: "Aprovada",
  aprovada_restricao: "Aprovada com restrição",
  recusada: "Recusada",
  cancelada: "Cancelada",
  contratada: "Levada ao contrato",
};
export const COR_STATUS_GARANTIA_PROPOSTA: Record<string, "azul" | "verde" | "amarelo" | "vermelho" | "cinza"> = {
  proposta: "cinza",
  solicitada: "azul",
  em_analise: "amarelo",
  aprovada: "verde",
  aprovada_restricao: "amarelo",
  recusada: "vermelho",
  cancelada: "cinza",
  contratada: "verde",
};
/** Garantia que conta como aprovada para a decisão. */
export const GARANTIA_APROVADA = ["aprovada", "aprovada_restricao", "contratada"] as const;
/** Esperando resposta da garantidora. */
export const GARANTIA_AGUARDANDO = ["solicitada", "em_analise"] as const;

export const ROTULO_STATUS_FIADOR: Record<string, string> = { pendente: "Pendente", aprovado: "Aprovado", reprovado: "Reprovado" };

export const ORIGENS_CONSENTIMENTO = ["assinatura", "e-mail", "whatsapp", "presencial", "ficha online", "outro"] as const;

export const CANAIS_RENOVACAO: Record<string, string> = {
  whatsapp: "WhatsApp",
  email: "E-mail",
  telefone: "Telefone",
  portal: "Portal da seguradora/banco",
  presencial: "Presencial",
  outro: "Outro",
};
export const DESTINATARIOS_RENOVACAO: Record<string, string> = {
  seguradora: "Seguradora / garantidora",
  locatario: "Locatário",
  fiador: "Fiador",
  banco: "Banco",
  outro: "Outro",
};
export const ROTULO_STATUS_RENOVACAO: Record<string, string> = { solicitada: "Solicitada", renovada: "Renovada", recusada: "Recusada", cancelada: "Cancelada" };

/** Papéis que decidem dentro da regra e os que aprovam exceção. */
export const papelDecide = (papel: string | null | undefined) => papel === "admin" || papel === "gestor" || papel === "financeiro";
export const papelAprovaExcecao = (papel: string | null | undefined) => papel === "admin" || papel === "gestor";

// Regras configuráveis ----------------------------------------------------------------
export type ConfigAnalise = {
  limite_comprometimento_pct: number;
  alerta_comprometimento_pct: number;
  renda_fiador_multiplo: number;
  score_minimo: number | null;
  aceitar_restricoes: boolean;
  exigir_consulta: boolean;
  exigir_garantia: boolean;
  validade_dias: number;
  ficha_dias: number;
};
export const CONFIG_PADRAO: ConfigAnalise = {
  limite_comprometimento_pct: 30,
  alerta_comprometimento_pct: 25,
  renda_fiador_multiplo: 3,
  score_minimo: null,
  aceitar_restricoes: false,
  exigir_consulta: true,
  exigir_garantia: true,
  validade_dias: 30,
  ficha_dias: 15,
};

type NumBanco = number | string | null | undefined;
const num = (v: NumBanco) => (v === null || v === undefined || v === "" ? null : Number(v));

/** Regras da organização com os padrões preenchidos (valores numeric chegam como texto). */
export function configComPadrao(c?: Partial<Record<keyof ConfigAnalise, unknown>> | null): ConfigAnalise {
  if (!c) return { ...CONFIG_PADRAO };
  const n = (k: keyof ConfigAnalise) => num(c[k] as NumBanco) ?? (CONFIG_PADRAO[k] as number);
  return {
    limite_comprometimento_pct: n("limite_comprometimento_pct"),
    alerta_comprometimento_pct: n("alerta_comprometimento_pct"),
    renda_fiador_multiplo: n("renda_fiador_multiplo"),
    score_minimo: num(c.score_minimo as NumBanco),
    aceitar_restricoes: c.aceitar_restricoes === undefined ? CONFIG_PADRAO.aceitar_restricoes : Boolean(c.aceitar_restricoes),
    exigir_consulta: c.exigir_consulta === undefined ? CONFIG_PADRAO.exigir_consulta : Boolean(c.exigir_consulta),
    exigir_garantia: c.exigir_garantia === undefined ? CONFIG_PADRAO.exigir_garantia : Boolean(c.exigir_garantia),
    validade_dias: n("validade_dias"),
    ficha_dias: n("ficha_dias"),
  };
}

// Checklist de documentos --------------------------------------------------------------
export type ItemChecklist = { item: string; rotulo: string; obrigatorio: boolean };

const CHECKLIST: Record<"candidato" | "fiador", Record<"PF" | "PJ", ItemChecklist[]>> = {
  candidato: {
    PF: [
      { item: "rg_cpf", rotulo: "Documento com foto (RG ou CNH) e CPF", obrigatorio: true },
      { item: "residencia", rotulo: "Comprovante de residência atual", obrigatorio: true },
      { item: "renda", rotulo: "Comprovantes de renda (3 últimos holerites, extratos ou pró-labore)", obrigatorio: true },
      { item: "ir", rotulo: "Declaração do Imposto de Renda com recibo", obrigatorio: false },
      { item: "estado_civil", rotulo: "Certidão de nascimento, casamento ou união estável", obrigatorio: false },
      { item: "trabalho", rotulo: "Carteira de trabalho ou contrato de prestação de serviço", obrigatorio: false },
    ],
    PJ: [
      { item: "contrato_social", rotulo: "Contrato social e última alteração", obrigatorio: true },
      { item: "cartao_cnpj", rotulo: "Cartão CNPJ", obrigatorio: true },
      { item: "socios", rotulo: "RG e CPF dos sócios / representantes", obrigatorio: true },
      { item: "balanco", rotulo: "Balanço e DRE do último exercício", obrigatorio: true },
      { item: "endereco_pj", rotulo: "Comprovante de endereço da empresa", obrigatorio: true },
      { item: "faturamento", rotulo: "Relação de faturamento dos últimos 12 meses", obrigatorio: false },
      { item: "ir_pj", rotulo: "Declaração de IR da empresa (ECF)", obrigatorio: false },
    ],
  },
  fiador: {
    PF: [
      { item: "rg_cpf", rotulo: "Documento com foto (RG ou CNH) e CPF", obrigatorio: true },
      { item: "residencia", rotulo: "Comprovante de residência atual", obrigatorio: true },
      { item: "renda", rotulo: "Comprovantes de renda (3 últimos meses)", obrigatorio: true },
      { item: "estado_civil", rotulo: "Certidão de casamento/nascimento (e documentos do cônjuge, se casado)", obrigatorio: true },
      { item: "matricula", rotulo: "Matrícula atualizada do imóvel em garantia (até 30 dias)", obrigatorio: true },
      { item: "iptu", rotulo: "Carnê do IPTU do imóvel em garantia", obrigatorio: false },
      { item: "onus", rotulo: "Certidão negativa de ônus reais do imóvel", obrigatorio: false },
    ],
    PJ: [
      { item: "contrato_social", rotulo: "Contrato social e última alteração", obrigatorio: true },
      { item: "cartao_cnpj", rotulo: "Cartão CNPJ", obrigatorio: true },
      { item: "socios", rotulo: "RG e CPF dos sócios / representantes", obrigatorio: true },
      { item: "balanco", rotulo: "Balanço e DRE do último exercício", obrigatorio: true },
    ],
  },
};

/** Documentos que o sistema pede por padrão para o candidato ou fiador (PF ou PJ). */
export function checklistPadrao(parte: "candidato" | "fiador", tipoPessoa: string | null | undefined): ItemChecklist[] {
  return CHECKLIST[parte][tipoPessoa === "PJ" ? "PJ" : "PF"].map((i) => ({ ...i }));
}

export type DocumentoChecklist = { status: string; obrigatorio: boolean };

export function progressoDocumentos(docs: DocumentoChecklist[]) {
  const ok = (d: DocumentoChecklist) => d.status === "validado" || d.status === "dispensado";
  const obrigatorios = docs.filter((d) => d.obrigatorio);
  return {
    total: docs.length,
    validados: docs.filter(ok).length,
    recebidos: docs.filter((d) => d.status === "recebido").length,
    recusados: docs.filter((d) => d.status === "recusado").length,
    obrigatorios: obrigatorios.length,
    obrigatoriosPendentes: obrigatorios.filter((d) => !ok(d)).length,
    pct: docs.length ? Math.round((docs.filter(ok).length / docs.length) * 100) : 0,
  };
}

/** CPF/CNPJ do cadastro: válido, inválido ou ausente. */
export function situacaoDocumento(doc: string | null | undefined): "valido" | "invalido" | "ausente" {
  const d = somenteDigitos(doc);
  if (!d) return "ausente";
  if (d.length === 11) return validarCPF(d) ? "valido" : "invalido";
  if (d.length === 14) return validarCNPJ(d) ? "valido" : "invalido";
  return "invalido";
}

// Renda e comprometimento -------------------------------------------------------------
export type RendaAnalise = { valor_declarado?: NumBanco; valor_comprovado: NumBanco; fiador_id?: string | null };

/** Soma da renda comprovada (do candidato e de quem compõe renda; ou de um fiador), em reais. */
export function rendaComprovada(rendas: RendaAnalise[], fiadorId: string | null = null): number {
  return paraReais(
    rendas
      .filter((r) => (r.fiador_id ?? null) === fiadorId && r.valor_comprovado !== null && r.valor_comprovado !== undefined && r.valor_comprovado !== "")
      .reduce((s, r) => s + paraCentavos(Number(r.valor_comprovado)), 0),
  );
}

export function rendaDeclarada(rendas: RendaAnalise[], fiadorId: string | null = null): number {
  return paraReais(rendas.filter((r) => (r.fiador_id ?? null) === fiadorId).reduce((s, r) => s + paraCentavos(Number(r.valor_declarado ?? 0)), 0));
}

/** Aluguel + encargos do mês, em reais. */
export const custoMensal = (aluguel: NumBanco, encargos: NumBanco) => paraReais(paraCentavos(Number(aluguel ?? 0)) + paraCentavos(Number(encargos ?? 0)));

/** Quanto da renda vai para aluguel + encargos (%, uma casa decimal). null = sem renda comprovada. */
export function comprometimentoPct(aluguel: NumBanco, encargos: NumBanco, renda: NumBanco): number | null {
  const r = paraCentavos(Number(renda ?? 0));
  if (r <= 0) return null;
  const c = paraCentavos(Number(aluguel ?? 0)) + paraCentavos(Number(encargos ?? 0));
  return Math.round((c * 1000) / r) / 10;
}

export type Semaforo = "verde" | "amarelo" | "vermelho" | "sem_renda";
export const COR_SEMAFORO: Record<Semaforo, "verde" | "amarelo" | "vermelho" | "cinza"> = { verde: "verde", amarelo: "amarelo", vermelho: "vermelho", sem_renda: "cinza" };
export const ROTULO_SEMAFORO: Record<Semaforo, string> = {
  verde: "Dentro da regra",
  amarelo: "No limite",
  vermelho: "Acima do limite",
  sem_renda: "Sem renda comprovada",
};

/** Percentual com uma casa (30,4%): arredondar para inteiro mostraria "30%" acima do limite de 30%. */
export function formatarPct(pct: number | null | undefined): string {
  if (pct === null || pct === undefined || !Number.isFinite(Number(pct))) return "—";
  return `${(Math.round(Number(pct) * 10) / 10).toFixed(1).replace(".", ",")}%`;
}

/** Verde até o alerta, amarelo até o limite, vermelho acima. */
export function semaforoComprometimento(pct: number | null, cfg: Pick<ConfigAnalise, "limite_comprometimento_pct" | "alerta_comprometimento_pct">): Semaforo {
  if (pct === null) return "sem_renda";
  if (pct <= cfg.alerta_comprometimento_pct) return "verde";
  if (pct <= cfg.limite_comprometimento_pct) return "amarelo";
  return "vermelho";
}

/** Renda que o fiador precisa comprovar (múltiplo do aluguel + encargos), em reais. */
export function rendaMinimaFiador(aluguel: NumBanco, encargos: NumBanco, multiplo: number): number {
  return paraReais(Math.round((paraCentavos(Number(aluguel ?? 0)) + paraCentavos(Number(encargos ?? 0))) * multiplo));
}

/** Quanto do aluguel o candidato pode pagar pela regra (renda × limite), em reais. */
export function aluguelMaximo(renda: number, encargos: NumBanco, limitePct: number): number {
  const teto = Math.floor((paraCentavos(renda) * limitePct) / 100) - paraCentavos(Number(encargos ?? 0));
  return paraReais(Math.max(0, teto));
}

// Crédito ---------------------------------------------------------------------------
export type ConsultaCredito = { consultado_em: string; created_at?: string; score: number | null; restricoes: boolean; fiador_id?: string | null };

/** A consulta que vale: a mais recente (do candidato, ou do fiador indicado). */
export function ultimaConsulta<T extends ConsultaCredito>(consultas: T[], fiadorId: string | null = null): T | null {
  return (
    consultas
      .filter((c) => (c.fiador_id ?? null) === fiadorId)
      .sort((a, b) => b.consultado_em.localeCompare(a.consultado_em) || (b.created_at ?? "").localeCompare(a.created_at ?? ""))[0] ?? null
  );
}

export type Bureau = (typeof BUREAUS)[number];

/**
 * LGPD antes de consultar o birô pela integração: base legal escolhida,
 * documento válido e, se a base for o consentimento, a autorização registrada.
 * Devolve a mensagem do problema ou null.
 */
export function checarConsultaCredito(p: { baseLegal: string | null; documento: string | null | undefined; consentimentoEm: string | null | undefined }): string | null {
  if (!p.baseLegal || !(BASES_LEGAIS as readonly string[]).includes(p.baseLegal)) return "Escolha a base legal da consulta (LGPD).";
  if (situacaoDocumento(p.documento) !== "valido") return "Cadastre um CPF/CNPJ válido antes de consultar o birô.";
  if (p.baseLegal === "consentimento" && !p.consentimentoEm)
    return 'Registre a autorização (consentimento) antes da consulta, ou use a base legal "proteção do crédito" (LGPD art. 7º, X).';
  return null;
}

/** Resultado de uma consulta automática, já no formato do registro (analise_consultas). */
export type ResultadoCredito = {
  score: number | null;
  faixa_risco: string | null;
  restricoes: boolean;
  restricoes_qtd: number | null;
  restricoes_valor: number | null;
  restricoes_descricao: string | null;
  protocolo: string | null;
};

/** Confere o que veio do birô antes de gravar (score 0–1000, quantidades e valores não negativos, textos curtos). */
export function normalizarResultadoCredito(r: Partial<Record<keyof ResultadoCredito, unknown>>): ResultadoCredito {
  const num = (v: unknown) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
  const txt = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
  const score = num(r.score);
  const qtd = num(r.restricoes_qtd);
  const valor = num(r.restricoes_valor);
  const restricoes = r.restricoes === true || (qtd !== null && qtd > 0) || (valor !== null && valor > 0);
  return {
    score: score !== null && score >= 0 && score <= 1000 ? Math.round(score) : null,
    faixa_risco: txt(r.faixa_risco, 60),
    restricoes,
    restricoes_qtd: restricoes && qtd !== null && qtd >= 0 ? Math.trunc(qtd) : null,
    restricoes_valor: restricoes && valor !== null && valor >= 0 ? paraReais(paraCentavos(valor)) : null,
    restricoes_descricao: restricoes ? txt(r.restricoes_descricao, 1000) : null,
    protocolo: txt(r.protocolo, 120),
  };
}

// Regras para aprovar ---------------------------------------------------------------
export type CodigoRegra = "renda" | "comprometimento" | "documento" | "consulta" | "score" | "restricoes" | "documentos" | "garantia" | "fiador_renda";
export type MotivoRegra = { codigo: CodigoRegra; texto: string };

export type DadosRegra = {
  aluguel: NumBanco;
  encargos: NumBanco;
  documentoCandidato: string | null | undefined;
  rendas: RendaAnalise[];
  consultas: ConsultaCredito[];
  documentos: DocumentoChecklist[];
  garantias: { status: string }[];
  fiadores: { id: string; nome: string; status: string }[];
};

const virgula = (n: number) => String(n).replace(".", ",");

/** O que está fora da regra para aprovar (lista vazia = dentro da regra). Igual ao banco. */
export function foraDaRegra(d: DadosRegra, cfg: ConfigAnalise): MotivoRegra[] {
  const out: MotivoRegra[] = [];
  const renda = rendaComprovada(d.rendas);
  const custo = custoMensal(d.aluguel, d.encargos);
  if (renda <= 0) out.push({ codigo: "renda", texto: "Renda não comprovada" });
  else {
    const pct = comprometimentoPct(d.aluguel, d.encargos, renda) ?? 0;
    if (pct > cfg.limite_comprometimento_pct)
      out.push({ codigo: "comprometimento", texto: `Comprometimento de ${pct.toFixed(1).replace(".", ",")}% da renda (limite ${virgula(cfg.limite_comprometimento_pct)}%)` });
  }
  if (situacaoDocumento(d.documentoCandidato) !== "valido") out.push({ codigo: "documento", texto: "CPF/CNPJ do candidato ausente ou inválido" });

  const doCandidato = d.consultas.filter((c) => !c.fiador_id);
  if (!doCandidato.length) {
    if (cfg.exigir_consulta) out.push({ codigo: "consulta", texto: "Sem consulta de crédito registrada" });
  } else {
    const u = ultimaConsulta(doCandidato)!;
    if (cfg.score_minimo !== null && u.score !== null && u.score < cfg.score_minimo)
      out.push({ codigo: "score", texto: `Score ${u.score} abaixo do mínimo ${cfg.score_minimo}` });
    if (u.restricoes && !cfg.aceitar_restricoes) out.push({ codigo: "restricoes", texto: "Restrições de crédito no nome do candidato" });
  }

  const pend = progressoDocumentos(d.documentos).obrigatoriosPendentes;
  if (pend > 0) out.push({ codigo: "documentos", texto: `${pend} documento(s) obrigatório(s) sem validação` });

  const temGarantia =
    d.garantias.some((g) => (GARANTIA_APROVADA as readonly string[]).includes(g.status)) || d.fiadores.some((f) => f.status === "aprovado");
  if (cfg.exigir_garantia && !temGarantia) out.push({ codigo: "garantia", texto: "Nenhuma garantia aprovada" });

  if (cfg.renda_fiador_multiplo > 0)
    for (const f of d.fiadores.filter((x) => x.status === "aprovado"))
      if (paraCentavos(rendaComprovada(d.rendas, f.id)) < paraCentavos(custo) * cfg.renda_fiador_multiplo)
        out.push({ codigo: "fiador_renda", texto: `Fiador ${f.nome} com renda abaixo de ${virgula(cfg.renda_fiador_multiplo)}× o aluguel e encargos` });
  return out;
}

/** Mesma checagem do banco antes de gravar a decisão (mensagem amigável na hora). */
export function validarDecisao(p: {
  decisao: string | null;
  justificativa: string | null;
  condicoes?: string | null;
  foraDaRegra: number;
  excecaoJustificativa?: string | null;
  papel: string | null | undefined;
}): string | null {
  if (!p.decisao || !(DECISOES as readonly string[]).includes(p.decisao)) return "Escolha a decisão.";
  if (!papelDecide(p.papel)) return "Seu usuário não pode decidir análises cadastrais. Peça a um administrador, gestor ou ao financeiro.";
  if ((p.justificativa ?? "").trim().length < 10) return "Escreva a justificativa da decisão (pelo menos 10 letras).";
  if (p.decisao === "aprovado_condicoes" && (p.condicoes ?? "").trim().length < 3) return "Descreva as condições da aprovação.";
  if (p.decisao !== "reprovado" && p.foraDaRegra > 0) {
    if (!papelAprovaExcecao(p.papel)) return "Aprovação fora da regra: só administrador ou gestor aprova como exceção.";
    if ((p.excecaoJustificativa ?? "").trim().length < 10) return "Explique por que aprovar fora da regra (justificativa da exceção, pelo menos 10 letras).";
  }
  return null;
}

/** Aprovação vencida (passou da validade sem virar contrato)? */
export function aprovacaoVencida(a: { status: string; validade_ate: string | null }, hoje: DataISO): boolean {
  return (a.status === "aprovada" || a.status === "aprovada_condicoes") && !!a.validade_ate && a.validade_ate < hoje;
}

// Vencimento e renovação de garantias ----------------------------------------------
export type FaixaVencimento = "vencida" | "30" | "60" | "90" | "depois" | "sem_data";
export const ROTULO_FAIXA: Record<FaixaVencimento, string> = {
  vencida: "Vencida",
  "30": "Vence em até 30 dias",
  "60": "Vence em 31 a 60 dias",
  "90": "Vence em 61 a 90 dias",
  depois: "Vence depois de 90 dias",
  sem_data: "Sem vencimento",
};
export const COR_FAIXA: Record<FaixaVencimento, "vermelho" | "amarelo" | "azul" | "cinza" | "verde"> = {
  vencida: "vermelho",
  "30": "vermelho",
  "60": "amarelo",
  "90": "azul",
  depois: "verde",
  sem_data: "cinza",
};

export function diasParaVencer(fim: string | null | undefined, hoje: DataISO): number | null {
  return fim ? diasEntre(hoje, fim.slice(0, 10)) : null;
}

export function faixaVencimento(fim: string | null | undefined, hoje: DataISO): FaixaVencimento {
  const d = diasParaVencer(fim, hoje);
  if (d === null) return "sem_data";
  if (d < 0) return "vencida";
  if (d <= 30) return "30";
  if (d <= 60) return "60";
  if (d <= 90) return "90";
  return "depois";
}

/** Até quando vale o link da ficha online. */
export const fichaExpiraEm = (hoje: DataISO, dias: number) => somarDias(hoje, dias);

// Mensagens prontas -------------------------------------------------------------------
const primeiro = (nome: string | null | undefined) => (nome ?? "").trim().split(/\s+/)[0] || "tudo bem";

export function textoConsentimentoPadrao(organizacao: string | null | undefined): string {
  return (
    `Autorizo ${organizacao || "a administradora"} a consultar meu CPF/CNPJ em birôs de crédito (Serasa, SPC, Boa Vista e similares) e a tratar os dados e documentos` +
    " que envio aqui somente para analisar esta locação, conforme a Lei Geral de Proteção de Dados (Lei 13.709/2018)." +
    " Posso pedir a exclusão dos meus dados quando a análise terminar, salvo o que a lei obriga a guardar."
  );
}

export function mensagemFicha(p: { nome: string; organizacao: string; link: string; validade: DataISO | null; imovel?: string | null }): string {
  return [
    `Olá, ${primeiro(p.nome)}! Para analisarmos sua locação${p.imovel ? ` do imóvel ${p.imovel}` : ""}, preencha sua ficha e envie os documentos por este link seguro:`,
    p.link,
    p.validade ? `O link vale até ${formatarDataBR(p.validade)}.` : "",
    `Qualquer dúvida, é só responder. — ${p.organizacao}`,
  ]
    .filter(Boolean)
    .join("\n");
}

const ROTULO_GARANTIA_CURTO: Record<string, string> = {
  fiador: "fiança",
  caucao: "caução",
  seguro_fianca: "seguro-fiança",
  titulo_capitalizacao: "título de capitalização",
  carta_fianca: "carta-fiança",
  outro: "garantia",
  seguro_incendio: "seguro incêndio",
};

/** Pedido de andamento/resposta da proposta na garantidora. */
export function mensagemGarantidora(p: {
  garantidora: string | null;
  tipo: string;
  candidato: string;
  documento?: string | null;
  imovel?: string | null;
  aluguel: number;
  proposta?: string | null;
  solicitadaEm?: string | null;
  organizacao: string;
}): string {
  return [
    `Olá${p.garantidora ? `, equipe ${p.garantidora}` : ""}!`,
    `Gostaria de saber o andamento da proposta de ${ROTULO_GARANTIA_CURTO[p.tipo] ?? "garantia"}${p.proposta ? ` nº ${p.proposta}` : ""}` +
      `${p.solicitadaEm ? `, enviada em ${formatarDataBR(p.solicitadaEm)}` : ""}.`,
    `Candidato: ${p.candidato}${p.documento ? ` (${p.documento})` : ""}${p.imovel ? ` · imóvel ${p.imovel}` : ""} · aluguel ${formatarReais(p.aluguel)}.`,
    `Obrigado! — ${p.organizacao}`,
  ].join("\n");
}

/** Pedido de renovação da apólice/garantia (para a seguradora ou o locatário). */
export function mensagemRenovacao(p: {
  para: "seguradora" | "locatario";
  nome?: string | null;
  tipo: string;
  apolice?: string | null;
  instituicao?: string | null;
  fim: string | null;
  imovel?: string | null;
  contrato?: number | string | null;
  organizacao: string;
}): string {
  const oque = `${ROTULO_GARANTIA_CURTO[p.tipo] ?? "garantia"}${p.apolice ? ` (apólice/nº ${p.apolice})` : ""}${p.instituicao ? ` da ${p.instituicao}` : ""}`;
  const quando = p.fim ? `vence em ${formatarDataBR(p.fim)}` : "está sem data de vencimento";
  if (p.para === "seguradora")
    return [
      "Olá!",
      `Solicitamos a renovação do ${oque}, que ${quando}${p.contrato ? `, ligada ao contrato de locação nº ${p.contrato}` : ""}${p.imovel ? ` (imóvel ${p.imovel})` : ""}.`,
      "Por favor, enviem a nova apólice/documento com a vigência e o valor do prêmio.",
      `Obrigado! — ${p.organizacao}`,
    ].join("\n");
  return [
    `Olá, ${primeiro(p.nome)}!`,
    `O ${oque} do seu contrato${p.imovel ? ` do imóvel ${p.imovel}` : ""} ${quando}.`,
    "Precisamos da renovação para manter o contrato em dia. Pode nos enviar o novo comprovante (ou nos autorizar a renovar)?",
    `Obrigado! — ${p.organizacao}`,
  ].join("\n");
}

/** Resumo da análise para o proprietário (modo imobiliária). */
export function mensagemProprietario(p: {
  proprietario: string;
  candidato: string;
  imovel?: string | null;
  aluguel: number;
  encargos: number;
  comprometimento: number | null;
  garantia: string | null;
  decisao: string | null;
  condicoes?: string | null;
  organizacao: string;
}): string {
  return [
    `Olá, ${primeiro(p.proprietario)}!`,
    `Concluímos a análise cadastral de ${p.candidato}${p.imovel ? ` para o imóvel ${p.imovel}` : ""}.`,
    `Aluguel ${formatarReais(p.aluguel)}${p.encargos ? ` + encargos ${formatarReais(p.encargos)}` : ""}` +
      (p.comprometimento !== null ? ` · compromete ${String(p.comprometimento).replace(".", ",")}% da renda comprovada` : ""),
    p.garantia ? `Garantia: ${p.garantia}.` : "",
    p.decisao ? `Nosso parecer: ${ROTULO_DECISAO[p.decisao] ?? p.decisao}${p.condicoes ? ` (${p.condicoes})` : ""}.` : "",
    "Podemos seguir com o contrato? — " + p.organizacao,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Link para criar o contrato a partir da análise: /contratos/novo já abre com o
 * imóvel, o locatário e o aluguel, e ao criar chama levar_garantias_contrato.
 */
export function linkNovoContrato(a: { id: string; imovel_id: string | null; candidato_id: string; valor_aluguel: NumBanco }): string {
  const q = new URLSearchParams();
  if (a.imovel_id) q.set("imovel", a.imovel_id);
  q.set("locatario", a.candidato_id);
  if (a.valor_aluguel !== null && a.valor_aluguel !== undefined) q.set("aluguel", String(Number(a.valor_aluguel)));
  q.set("analise", a.id);
  return `/contratos/novo?${q}`;
}

export type ContratoPossivel = { id: string; numero: number; status: string; imovel_id: string | null; created_at: string; candidatoLocatario: boolean };

/**
 * O contrato que provavelmente nasceu desta análise: o candidato é locatário, é do
 * mesmo imóvel (se a análise tem imóvel), está em rascunho ou ativo e foi criado
 * depois da decisão. O mais novo ganha. null = nenhum com certeza.
 */
export function contratoSugerido(contratos: ContratoPossivel[], a: { imovel_id: string | null; decidido_em: string | null }): ContratoPossivel | null {
  return (
    contratos
      .filter(
        (k) =>
          k.candidatoLocatario &&
          (k.status === "rascunho" || k.status === "ativo") &&
          (!a.imovel_id || k.imovel_id === a.imovel_id) &&
          (!a.decidido_em || new Date(k.created_at).getTime() >= new Date(a.decidido_em).getTime()),
      )
      .sort((x, y) => new Date(y.created_at).getTime() - new Date(x.created_at).getTime())[0] ?? null
  );
}
