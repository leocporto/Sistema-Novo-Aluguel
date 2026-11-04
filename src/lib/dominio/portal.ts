/**
 * Regras puras do Portal de clientes (etapa 18).
 *
 * - Proprietário (só imobiliária), locatário e prestador (nos dois modos)
 *   entram por um link pessoal e confirmam a identidade com 4 números
 *   (mesma regra de privado.portal_codigo no banco — mude as duas juntas);
 * - situação do link (ativo, expirado, desativado, bloqueado) e mensagem
 *   pronta para o WhatsApp;
 * - seções de cada perfil;
 * - informe de rendimentos anual do proprietário (regime de caixa: o mês em
 *   que o aluguel foi pago), por mês e por imóvel/locatário, em centavos.
 */
import type { DataISO } from "./datas";
import { type Centavos, paraCentavos } from "./dinheiro";

// ---------------------------------------------------------------------------
// Perfis
// ---------------------------------------------------------------------------

export const PERFIS_PORTAL = ["proprietario", "locatario", "prestador"] as const;
export type PerfilPortal = (typeof PERFIS_PORTAL)[number];

export const ROTULO_PERFIL: Record<PerfilPortal, string> = {
  proprietario: "Proprietário",
  locatario: "Locatário",
  prestador: "Prestador de serviço",
};

export const ehPerfilPortal = (v: string | null | undefined): v is PerfilPortal => (PERFIS_PORTAL as readonly string[]).includes(v ?? "");

/** No modo imóveis pessoais não há portal do proprietário (o dono é o próprio usuário). */
export function perfisDoModo(modo: "imobiliaria" | "pessoal" | null | undefined): PerfilPortal[] {
  return modo === "pessoal" ? ["locatario", "prestador"] : [...PERFIS_PORTAL];
}

// ---------------------------------------------------------------------------
// Confirmação de identidade
// ---------------------------------------------------------------------------

export type TipoCodigo = "cpf" | "cnpj" | "documento" | "telefone";

export const DICA_CODIGO: Record<TipoCodigo, string> = {
  cpf: "os 4 primeiros números do seu CPF",
  cnpj: "os 4 primeiros números do CNPJ",
  documento: "os 4 primeiros números do seu CPF ou CNPJ",
  telefone: "os 4 últimos números do seu telefone",
};

const digitos = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");

/**
 * Código que a pessoa digita para entrar: 4 primeiros números do CPF/CNPJ; sem
 * documento, 4 últimos do telefone. Sem nenhum dos dois, não dá para gerar o link.
 */
export function codigoConfirmacao(p: { documento?: string | null; telefone?: string | null }): { codigo: string; tipo: TipoCodigo } | null {
  const doc = digitos(p.documento);
  if (doc.length >= 4) return { codigo: doc.slice(0, 4), tipo: doc.length === 11 ? "cpf" : doc.length === 14 ? "cnpj" : "documento" };
  const tel = digitos(p.telefone);
  if (tel.length >= 4) return { codigo: tel.slice(-4), tipo: "telefone" };
  return null;
}

/** Tentativas erradas antes de bloquear a entrada por 30 minutos (igual ao banco). */
export const TENTATIVAS_PORTAL = 5;
export const MINUTOS_BLOQUEIO_PORTAL = 30;
export const HORAS_SESSAO_PORTAL = 12;

// ---------------------------------------------------------------------------
// Link
// ---------------------------------------------------------------------------

export type SituacaoLink = "ativo" | "bloqueado" | "expirado" | "desativado";

export const ROTULO_SITUACAO_LINK: Record<SituacaoLink, string> = {
  ativo: "Ativo",
  bloqueado: "Bloqueado (tentativas erradas)",
  expirado: "Expirado",
  desativado: "Desativado",
};

export const COR_SITUACAO_LINK: Record<SituacaoLink, "verde" | "amarelo" | "cinza" | "vermelho"> = {
  ativo: "verde",
  bloqueado: "vermelho",
  expirado: "amarelo",
  desativado: "cinza",
};

export function situacaoLink(a: { ativo: boolean; expira_em: string | null; bloqueado_ate?: string | null }, agoraIso: string): SituacaoLink {
  if (!a.ativo) return "desativado";
  if (a.expira_em && a.expira_em <= agoraIso) return "expirado";
  if (a.bloqueado_ate && a.bloqueado_ate > agoraIso) return "bloqueado";
  return "ativo";
}

/** Validades oferecidas ao gerar o link (dias; 0 = sem data para expirar). */
export const VALIDADES_LINK = [0, 30, 90, 180, 365] as const;

/** Data/hora em que o link expira (ISO) ou null (sem validade). Aceita de 1 a 730 dias. */
export function expiraEm(dias: number | null | undefined, agora: Date = new Date()): string | null {
  if (!dias || dias <= 0) return null;
  const d = Math.min(730, Math.max(1, Math.trunc(dias)));
  return new Date(agora.getTime() + d * 86_400_000).toISOString();
}

/** Validades para compartilhar arquivo (dias, no máximo 90 — igual ao banco). */
export const VALIDADES_ARQUIVO = [1, 7, 30, 90] as const;

const SAUDACAO: Record<PerfilPortal, string> = {
  proprietario: "acompanhar seus imóveis, aluguéis recebidos, repasses, despesas e aprovar orçamentos",
  locatario: "ver seu contrato, pagar o aluguel (2ª via e Pix), pedir manutenção e falar com a gente",
  prestador: "ver as ordens de serviço, mandar orçamentos, atualizar o serviço e consultar pagamentos",
};

/** Mensagem pronta para mandar o link por WhatsApp. */
export function mensagemPortal(o: { nome: string; perfil: PerfilPortal; link: string; organizacao: string; tipoCodigo?: TipoCodigo | null }): string {
  const primeiro = o.nome.trim().split(/\s+/)[0] || "";
  return [
    `Olá${primeiro ? ` ${primeiro}` : ""}! Este é o seu acesso ao portal de ${o.organizacao}, para ${SAUDACAO[o.perfil]}:`,
    o.link,
    o.tipoCodigo ? `Para entrar, digite ${DICA_CODIGO[o.tipoCodigo]}.` : null,
    "O link é pessoal: não compartilhe com outras pessoas.",
  ]
    .filter(Boolean)
    .join("\n");
}

// ---------------------------------------------------------------------------
// Seções do portal
// ---------------------------------------------------------------------------

export interface SecaoPortal {
  /** Caminho depois de /portal/<token> ("" = início). */
  slug: string;
  rotulo: string;
}

const SECOES: Record<PerfilPortal, SecaoPortal[]> = {
  proprietario: [
    { slug: "", rotulo: "Início" },
    { slug: "imoveis", rotulo: "Imóveis" },
    { slug: "contratos", rotulo: "Contratos e documentos" },
    { slug: "alugueis", rotulo: "Aluguéis" },
    { slug: "repasses", rotulo: "Extrato e repasses" },
    { slug: "despesas", rotulo: "Despesas e manutenções" },
    { slug: "aprovacoes", rotulo: "Aprovar orçamentos" },
    { slug: "informe", rotulo: "Informe de rendimentos" },
    { slug: "fale", rotulo: "Fale com a gente" },
  ],
  locatario: [
    { slug: "", rotulo: "Início" },
    { slug: "contrato", rotulo: "Contrato" },
    { slug: "cobrancas", rotulo: "Pagar aluguel" },
    { slug: "pagamentos", rotulo: "Pagamentos" },
    { slug: "manutencao", rotulo: "Manutenção" },
    { slug: "vistorias", rotulo: "Vistorias" },
    { slug: "fale", rotulo: "Renovação, saída e contato" },
  ],
  prestador: [
    { slug: "", rotulo: "Início" },
    { slug: "ordens", rotulo: "Ordens de serviço" },
    { slug: "pagamentos", rotulo: "Pagamentos" },
    { slug: "fale", rotulo: "Fale com a gente" },
  ],
};

export function secoesPortal(perfil: PerfilPortal): SecaoPortal[] {
  return SECOES[perfil];
}

/** A seção existe para o perfil? ("arquivos" vale para todos.) */
export function secaoValida(perfil: PerfilPortal, slug: string): boolean {
  return slug === "arquivos" || SECOES[perfil].some((s) => s.slug === slug);
}

// ---------------------------------------------------------------------------
// Pedidos que chegam pelo portal
// ---------------------------------------------------------------------------

export const TIPOS_SOLICITACAO = ["renovacao", "desocupacao", "contato"] as const;
export type TipoSolicitacao = (typeof TIPOS_SOLICITACAO)[number];

export const ROTULO_TIPO_SOLICITACAO: Record<TipoSolicitacao, string> = {
  renovacao: "Renovação do contrato",
  desocupacao: "Desocupação (entregar o imóvel)",
  contato: "Contato",
};

export const STATUS_SOLICITACAO = ["nova", "em_andamento", "concluida", "recusada"] as const;
export type StatusSolicitacao = (typeof STATUS_SOLICITACAO)[number];

export const ROTULO_STATUS_SOLICITACAO: Record<StatusSolicitacao, string> = {
  nova: "Nova",
  em_andamento: "Em andamento",
  concluida: "Respondida",
  recusada: "Recusada",
};

export const COR_STATUS_SOLICITACAO: Record<StatusSolicitacao, "amarelo" | "azul" | "verde" | "cinza"> = {
  nova: "amarelo",
  em_andamento: "azul",
  concluida: "verde",
  recusada: "cinza",
};

/** Tipos que cada perfil pode pedir (igual ao banco). */
export function tiposDoPerfil(perfil: PerfilPortal): TipoSolicitacao[] {
  return perfil === "locatario" ? ["renovacao", "desocupacao", "contato"] : ["contato"];
}

/** Título da tarefa que a equipe cria a partir do pedido. */
export function tituloTarefa(s: { numero: number; tipo: string; nome: string | null }): string {
  const rotulo = ROTULO_TIPO_SOLICITACAO[s.tipo as TipoSolicitacao] ?? "Pedido";
  return `Portal #${s.numero}: ${rotulo}${s.nome ? ` — ${s.nome}` : ""}`.slice(0, 200);
}

// ---------------------------------------------------------------------------
// Informe de rendimentos (proprietário)
// ---------------------------------------------------------------------------

type Valor = number | string | null | undefined;

export interface LinhaInforme {
  competencia: DataISO;
  /** Quando o locatário pagou a fatura (o aluguel entrou). */
  faturaPagoEm?: DataISO | null;
  faturaPaga?: boolean | null;
  /** Quando o repasse foi pago ao proprietário. */
  repassePagoEm?: DataISO | null;
  status: string;
  imovel: string;
  endereco?: string | null;
  contrato?: number | string | null;
  locatarioNome?: string | null;
  locatarioDocumento?: string | null;
  aluguel: Valor;
  encargos: Valor;
  multaJuros: Valor;
  taxaAdministracao: Valor;
  taxaIntermediacao: Valor;
  irrf: Valor;
  imposto?: Valor;
  outrosDescontos?: Valor;
  liquido: Valor;
}

export interface TotaisInforme {
  /** Rendimento tributável: aluguel + multa/juros. */
  rendimento: Centavos;
  /** IPTU, condomínio e outros encargos repassados (reembolso, não é rendimento). */
  encargos: Centavos;
  /** Taxas de administração e intermediação (despesa dedutível). */
  taxas: Centavos;
  irrf: Centavos;
  /** Imposto do proprietário descontado no repasse. */
  imposto: Centavos;
  /** Despesas do imóvel descontadas no repasse. */
  descontos: Centavos;
  liquido: Centavos;
}

const zero = (): TotaisInforme => ({ rendimento: 0, encargos: 0, taxas: 0, irrf: 0, imposto: 0, descontos: 0, liquido: 0 });

function somar(t: TotaisInforme, l: LinhaInforme) {
  t.rendimento += paraCentavos(l.aluguel) + paraCentavos(l.multaJuros);
  t.encargos += paraCentavos(l.encargos);
  t.taxas += paraCentavos(l.taxaAdministracao) + paraCentavos(l.taxaIntermediacao);
  t.irrf += paraCentavos(l.irrf);
  t.imposto += paraCentavos(l.imposto);
  t.descontos += paraCentavos(l.outrosDescontos);
  t.liquido += paraCentavos(l.liquido);
}

/** Data que conta no informe (regime de caixa): pagamento do aluguel; sem ele, o do repasse; sem nenhum, a competência. */
export const dataDoInforme = (l: Pick<LinhaInforme, "faturaPagoEm" | "repassePagoEm" | "competencia">): DataISO =>
  (l.faturaPagoEm ?? l.repassePagoEm ?? l.competencia).slice(0, 10);

/** Aluguel efetivamente recebido (fatura paga ou repasse pago) e não cancelado. */
export const aluguelRecebido = (l: Pick<LinhaInforme, "faturaPaga" | "status">) => l.status !== "cancelado" && (Boolean(l.faturaPaga) || l.status === "pago");

export interface InformeRendimentos {
  ano: number;
  meses: TotaisInforme[];
  porImovel: { chave: string; imovel: string; endereco: string | null; locatario: string | null; documento: string | null; totais: TotaisInforme }[];
  total: TotaisInforme;
  /** Repasses do ano que entraram no informe. */
  quantidade: number;
  /** Repasses do ano ainda sem o aluguel pago (ficam de fora). */
  pendentes: number;
}

/**
 * Informe anual: só o que foi recebido no ano (pela data do pagamento do
 * aluguel), por mês (12 posições) e por imóvel + locatário.
 */
export function informeRendimentos(linhas: LinhaInforme[], ano: number): InformeRendimentos {
  const meses = Array.from({ length: 12 }, zero);
  const total = zero();
  const mapa = new Map<string, InformeRendimentos["porImovel"][number]>();
  let quantidade = 0;
  let pendentes = 0;
  for (const l of linhas) {
    if (l.status === "cancelado") continue;
    const data = dataDoInforme(l);
    if (!data.startsWith(`${ano}-`)) continue;
    if (!aluguelRecebido(l)) {
      pendentes += 1;
      continue;
    }
    quantidade += 1;
    somar(meses[Number(data.slice(5, 7)) - 1], l);
    somar(total, l);
    const doc = digitos(l.locatarioDocumento) || null;
    const chave = `${l.imovel}|${doc ?? l.locatarioNome ?? ""}`;
    let item = mapa.get(chave);
    if (!item) {
      item = { chave, imovel: l.imovel, endereco: l.endereco ?? null, locatario: l.locatarioNome ?? null, documento: doc, totais: zero() };
      mapa.set(chave, item);
    }
    somar(item.totais, l);
  }
  const porImovel = [...mapa.values()].sort((a, b) => a.imovel.localeCompare(b.imovel) || (a.locatario ?? "").localeCompare(b.locatario ?? ""));
  return { ano, meses, porImovel, total, quantidade, pendentes };
}
