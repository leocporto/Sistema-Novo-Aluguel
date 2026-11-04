/**
 * Regras puras de manutenção e chamados: categorias, urgência e prazo de
 * atendimento, fluxo de status, responsabilidade financeira (com sugestão pela
 * categoria), aprovação do proprietário, plano de lançamentos no Financeiro,
 * comparação de orçamentos, garantia e avaliação dos prestadores.
 * Dinheiro sempre em centavos por dentro (dinheiro.ts); datas ISO (datas.ts).
 */
import { diaLocal } from "./agenda";
import { paraCentavos, paraReais, ratear, formatarReais } from "./dinheiro";
import { diasEntre, formatarDataBR, somarDias, type DataISO } from "./datas";

export type Modo = "imobiliaria" | "pessoal";

/**
 * Quem decide na manutenção (quem paga, valor, prestador, aprovação, recusa,
 * conclusão, exclusão): lista fechada — papel novo não ganha acesso sozinho.
 * Mesma regra de `privado.manutencao_decide` no banco.
 */
export const PAPEIS_DECIDEM = ["admin", "gestor", "financeiro"] as const;
export const podeDecidirChamado = (papel: string | null | undefined) => (PAPEIS_DECIDEM as readonly string[]).includes(papel ?? "");

// ---------------------------------------------------------------------------
// Categorias e urgência
// ---------------------------------------------------------------------------

export const CATEGORIAS_CHAMADO = ["hidraulica", "eletrica", "telhado", "eletrodomestico", "pintura", "chaveiro", "outros"] as const;
export type CategoriaChamado = (typeof CATEGORIAS_CHAMADO)[number];
export const ROTULO_CATEGORIA: Record<string, string> = {
  hidraulica: "Hidráulica (vazamento, cano, descarga)",
  eletrica: "Elétrica (tomada, disjuntor, fiação)",
  telhado: "Telhado, goteira e infiltração",
  eletrodomestico: "Eletrodoméstico / aparelho",
  pintura: "Pintura e acabamento",
  chaveiro: "Chaveiro, porta e fechadura",
  outros: "Outros",
};
/** Rótulo curto (tabelas e selos). */
export const ROTULO_CATEGORIA_CURTO: Record<string, string> = {
  hidraulica: "Hidráulica",
  eletrica: "Elétrica",
  telhado: "Telhado",
  eletrodomestico: "Eletrodoméstico",
  pintura: "Pintura",
  chaveiro: "Chaveiro",
  outros: "Outros",
};

export const URGENCIAS = ["baixa", "media", "alta", "emergencia"] as const;
export type Urgencia = (typeof URGENCIAS)[number];
export const ROTULO_URGENCIA: Record<string, string> = { baixa: "Baixa", media: "Média", alta: "Alta", emergencia: "Emergência" };
/** Prazo para atender (agendar o serviço), em horas. Mesma regra do gatilho `privado.chamados_antes`. */
export const HORAS_ATENDIMENTO: Record<Urgencia, number> = { baixa: 168, media: 72, alta: 24, emergencia: 4 };
export const DICA_URGENCIA: Record<string, string> = {
  baixa: "Pode esperar alguns dias (até 7 dias)",
  media: "Atrapalha, mas não é urgente (até 3 dias)",
  alta: "Precisa de atenção logo (até 24 horas)",
  emergencia: "Risco ou imóvel sem uso: vazamento forte, sem luz, porta não fecha (até 4 horas)",
};
export const COR_URGENCIA = { baixa: "cinza", media: "azul", alta: "amarelo", emergencia: "vermelho" } as const;

/** Prazo de atendimento (instante ISO) a partir da abertura. */
export function prazoAtendimento(abertoEmIso: string, urgencia: string): string {
  const h = HORAS_ATENDIMENTO[(URGENCIAS as readonly string[]).includes(urgencia) ? (urgencia as Urgencia) : "media"];
  return new Date(new Date(abertoEmIso).getTime() + h * 3_600_000).toISOString();
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export const STATUS_CHAMADO = [
  "aberto",
  "em_analise",
  "aguardando_aprovacao",
  "aprovado",
  "agendado",
  "em_execucao",
  "concluido",
  "avaliado",
  "recusado",
  "cancelado",
] as const;
export type StatusChamado = (typeof STATUS_CHAMADO)[number];
export const ROTULO_STATUS_CHAMADO: Record<string, string> = {
  aberto: "Aberto",
  em_analise: "Em análise",
  aguardando_aprovacao: "Aguardando aprovação",
  aprovado: "Aprovado",
  agendado: "Agendado",
  em_execucao: "Em execução",
  concluido: "Concluído",
  avaliado: "Avaliado",
  recusado: "Recusado",
  cancelado: "Cancelado",
};
export const COR_STATUS_CHAMADO = {
  aberto: "amarelo",
  em_analise: "azul",
  aguardando_aprovacao: "amarelo",
  aprovado: "azul",
  agendado: "azul",
  em_execucao: "azul",
  concluido: "verde",
  avaliado: "verde",
  recusado: "cinza",
  cancelado: "cinza",
} as const;
/** Em andamento (ainda precisa de alguém). */
export const STATUS_EM_ANDAMENTO: StatusChamado[] = ["aberto", "em_analise", "aguardando_aprovacao", "aprovado", "agendado", "em_execucao"];
export const STATUS_FINAIS: StatusChamado[] = ["concluido", "avaliado", "recusado", "cancelado"];

/** Para onde cada status pode ir (as telas e as ações seguem este mapa). */
export const TRANSICOES: Record<StatusChamado, StatusChamado[]> = {
  aberto: ["em_analise", "recusado", "cancelado"],
  em_analise: ["aguardando_aprovacao", "aprovado", "recusado", "cancelado"],
  aguardando_aprovacao: ["aprovado", "em_analise", "cancelado"],
  aprovado: ["agendado", "em_execucao", "concluido", "cancelado"],
  agendado: ["agendado", "em_execucao", "concluido", "cancelado"],
  em_execucao: ["agendado", "concluido", "cancelado"],
  concluido: ["avaliado", "em_execucao"],
  avaliado: ["em_execucao"],
  recusado: ["em_analise"],
  cancelado: ["em_analise"],
};
export function podeIrPara(de: string, para: string): boolean {
  return (TRANSICOES[de as StatusChamado] ?? []).includes(para as StatusChamado);
}

/** Etapas do caminho normal (para a linha do tempo da ficha). */
export const ETAPAS_CHAMADO: StatusChamado[] = ["aberto", "em_analise", "aguardando_aprovacao", "aprovado", "agendado", "em_execucao", "concluido", "avaliado"];

/**
 * Situação do prazo de atendimento. "Atendido" = já tem serviço agendado ou
 * em andamento (ou o chamado foi encerrado).
 */
export function situacaoPrazo(c: { status: string; prazo_atendimento: string | null }, agoraIso: string): { situacao: "atendido" | "no_prazo" | "atrasado"; horas: number } {
  const atendido = ["agendado", "em_execucao", "concluido", "avaliado", "recusado", "cancelado"].includes(c.status);
  if (atendido || !c.prazo_atendimento) return { situacao: "atendido", horas: 0 };
  const horas = Math.round((new Date(c.prazo_atendimento).getTime() - new Date(agoraIso).getTime()) / 3_600_000);
  return { situacao: horas < 0 ? "atrasado" : "no_prazo", horas };
}

/** "faltam 5 h", "atrasado há 2 dias"… */
export function textoPrazo(horas: number): string {
  const abs = Math.abs(horas);
  const t = abs < 48 ? `${abs} h` : `${Math.round(abs / 24)} dias`;
  return horas < 0 ? `atrasado há ${t}` : `faltam ${t}`;
}

// ---------------------------------------------------------------------------
// Responsabilidade financeira
// ---------------------------------------------------------------------------

export const RESPONSAVEIS = ["locatario", "proprietario", "imobiliaria", "dividido"] as const;
export type Responsavel = (typeof RESPONSAVEIS)[number];

export function rotuloResponsavel(r: string | null | undefined, modo: Modo): string {
  if (!r) return "A definir";
  if (r === "proprietario") return modo === "pessoal" ? "Proprietário (eu)" : "Proprietário";
  return { locatario: "Locatário", imobiliaria: "Imobiliária", dividido: "Dividido" }[r] ?? r;
}
/** Opções de responsável por modo (no pessoal não existe imobiliária). */
export function responsaveisDoModo(modo: Modo): Responsavel[] {
  return modo === "pessoal" ? ["locatario", "proprietario", "dividido"] : [...RESPONSAVEIS];
}

/**
 * Sugestão pela categoria (Lei do Inquilinato, arts. 22 e 23): estrutura e
 * instalações do imóvel são do proprietário; reparos de uso do dia a dia e o
 * que o locatário trouxe são do locatário.
 */
export function sugerirResponsabilidade(categoria: string): { responsavel: "locatario" | "proprietario"; motivo: string } {
  switch (categoria) {
    case "telhado":
      return { responsavel: "proprietario", motivo: "Telhado, goteira e infiltração são da estrutura do imóvel: cabem ao proprietário (art. 22)." };
    case "hidraulica":
      return { responsavel: "proprietario", motivo: "Encanamento e instalações hidráulicas são do imóvel (art. 22). Se foi mau uso — ralo entupido, peça quebrada pelo morador —, passe para o locatário." };
    case "eletrica":
      return { responsavel: "proprietario", motivo: "Fiação e quadro de luz são instalações do imóvel (art. 22). Lâmpada, tomada quebrada pelo uso ou aparelho do morador ficam com o locatário." };
    case "eletrodomestico":
      return { responsavel: "locatario", motivo: "Aparelho do morador é com o locatário. Se o aparelho faz parte do imóvel (mobiliado) e quebrou pelo tempo, passe para o proprietário." };
    case "pintura":
      return { responsavel: "locatario", motivo: "Pintura e pequenos reparos de uso durante a locação são do locatário (art. 23). Infiltração que estragou a pintura é do proprietário." };
    case "chaveiro":
      return { responsavel: "locatario", motivo: "Chave perdida, fechadura e trinco do dia a dia são reparos de uso do locatário (art. 23)." };
    default:
      return { responsavel: "proprietario", motivo: "Sem regra fixa: confira o contrato e o que causou o problema." };
  }
}

/** Quem paga de fato: o escolhido ou, "a definir", a sugestão da categoria (a mesma regra da aprovação e do financeiro). */
export function responsavelEfetivo(resp: string | null | undefined, categoria: string): string {
  return resp || sugerirResponsabilidade(categoria).responsavel;
}

export type Partes = { locatario: number; proprietario: number; imobiliaria: number };

/**
 * Percentual de cada parte (soma 100). Para "dividido" usa os percentuais
 * informados e valida a soma; no modo pessoal não há imobiliária.
 */
export function partesDaResponsabilidade(resp: string | null | undefined, modo: Modo, informado?: Partial<Partes>): Partes {
  const zero: Partes = { locatario: 0, proprietario: 0, imobiliaria: 0 };
  if (resp === "locatario") return { ...zero, locatario: 100 };
  if (resp === "proprietario") return { ...zero, proprietario: 100 };
  if (resp === "imobiliaria") {
    if (modo === "pessoal") throw new Error("No modo pessoal não existe imobiliária: escolha locatário ou proprietário.");
    return { ...zero, imobiliaria: 100 };
  }
  if (resp === "dividido") {
    const p: Partes = {
      locatario: Number(informado?.locatario ?? 0) || 0,
      proprietario: Number(informado?.proprietario ?? 0) || 0,
      imobiliaria: modo === "pessoal" ? 0 : Number(informado?.imobiliaria ?? 0) || 0,
    };
    if (Object.values(p).some((v) => v < 0 || v > 100)) throw new Error("Cada parte deve ficar entre 0% e 100%.");
    const soma = Math.round((p.locatario + p.proprietario + p.imobiliaria) * 1000) / 1000;
    if (soma !== 100) throw new Error(`As partes da divisão precisam somar 100% (hoje somam ${String(soma).replace(".", ",")}%).`);
    if ([p.locatario, p.proprietario, p.imobiliaria].filter((v) => v > 0).length < 2) throw new Error("Na divisão, pelo menos duas partes precisam ter percentual.");
    return p;
  }
  return zero;
}

/** Precisa pedir aprovação do proprietário? Só na imobiliária, quando ele paga alguma parte. */
export function precisaAprovacaoProprietario(modo: Modo, partes: Partes): boolean {
  return modo === "imobiliaria" && partes.proprietario > 0;
}

/**
 * Mudaram quem paga depois do orçamento escolhido: o que acontece com a
 * aprovação do proprietário (só imobiliária).
 * - "pedir": serviço já aprovado/agendado/em execução e a parte dele apareceu
 *   ou aumentou (ou ele ainda não tinha aprovado) → volta a esperar a resposta dele;
 * - "liberar": estava esperando a resposta e a parte dele zerou → segue sem ele;
 * - "manter": nada muda.
 * As partes são os percentuais do proprietário antes e depois.
 */
export function efeitoNaAprovacao(o: { modo: Modo; status: string; aprovacaoStatus: string; parteAntes: number; parteDepois: number }): "pedir" | "liberar" | "manter" {
  if (o.modo !== "imobiliaria") return "manter";
  const antes = Math.round(o.parteAntes * 1000);
  const depois = Math.round(o.parteDepois * 1000);
  if (o.status === "aguardando_aprovacao") return depois <= 0 ? "liberar" : "manter";
  if (["aprovado", "agendado", "em_execucao"].includes(o.status) && depois > 0 && (depois > antes || o.aprovacaoStatus !== "aprovado")) return "pedir";
  return "manter";
}

/**
 * Situação do chamado ao escolher o orçamento. Num "pedido de novo" (o serviço
 * já estava agendado/em execução e voltou a esperar o proprietário), a etapa
 * de antes é guardada; sem aprovação, volta direto para ela.
 */
export function statusAoEscolherOrcamento(o: { precisa: boolean; status: string; statusAntes: string | null }): { status: string; status_antes_aprovacao: string | null } {
  const antes = o.status === "aguardando_aprovacao" ? o.statusAntes : null;
  return o.precisa ? { status: "aguardando_aprovacao", status_antes_aprovacao: antes } : { status: antes ?? "aprovado", status_antes_aprovacao: null };
}

/** O locatário pode confirmar pelo link que o serviço foi feito? Só depois do horário marcado. Mesma regra de `confirmar_servico_chamado`. */
export function podeConfirmarServico(c: { status: string; agendado_para: string | null }, agoraIso: string): boolean {
  if (["em_execucao", "concluido", "avaliado"].includes(c.status)) return true;
  return c.status === "agendado" && Boolean(c.agendado_para) && new Date(c.agendado_para as string).getTime() <= new Date(agoraIso).getTime();
}

/** Percentual do proprietário (0 se a divisão gravada estiver inválida). */
export function parteDoProprietario(resp: string | null | undefined, modo: Modo, informado?: Partial<Partes>): number {
  try {
    return partesDaResponsabilidade(resp, modo, informado).proprietario;
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Lançamentos no Financeiro
// ---------------------------------------------------------------------------

export type LancamentoPlanejado = {
  tipo: "pagar" | "receber";
  /** Parte a que o lançamento se refere. */
  parte: "proprietario" | "imobiliaria" | "locatario" | "geral";
  valor: number;
  descontarRepasse: boolean;
  descricao: string;
};

export type PlanoFinanceiro = {
  total: number;
  partes: { locatario: number; proprietario: number; imobiliaria: number };
  /** Contas a pagar ao prestador (vazio quando o responsável paga direto). */
  pagar: LancamentoPlanejado[];
  /** Quanto cobrar do locatário (conta a receber ou item na próxima fatura). */
  cobrarLocatario: number;
  avisos: string[];
};

/**
 * O que a conclusão do chamado lança no Financeiro.
 * - "Nós pagamos o prestador" (padrão): conta a pagar ao prestador. Na
 *   imobiliária, a parte do proprietário vira conta separada marcada para
 *   DESCONTAR NO REPASSE. A parte do locatário vira cobrança dele.
 * - "O responsável paga direto ao prestador": nada a pagar pelo sistema; só
 *   vale com um responsável único (sem divisão).
 * No modo pessoal o proprietário é o próprio dono: despesa comum (sem repasse).
 */
export function planoFinanceiro(opts: { modo: Modo; valor: number; responsabilidade: string | null | undefined; partes?: Partial<Partes>; pagoDireto?: boolean; titulo?: string }): PlanoFinanceiro {
  const totalC = paraCentavos(opts.valor);
  if (totalC <= 0) throw new Error("Informe o valor do serviço.");
  const resp = opts.responsabilidade ?? "proprietario";
  const p = partesDaResponsabilidade(resp, opts.modo, opts.partes);
  if (p.locatario + p.proprietario + p.imobiliaria <= 0) throw new Error("Defina quem paga o serviço.");
  const [cLoc, cProp, cImob] = ratear(totalC, [p.locatario, p.proprietario, p.imobiliaria]);
  const partes = { locatario: paraReais(cLoc), proprietario: paraReais(cProp), imobiliaria: paraReais(cImob) };
  const nome = opts.titulo ? ` — ${opts.titulo}` : "";
  const avisos: string[] = [];

  if (opts.pagoDireto) {
    if (resp === "dividido") throw new Error("Com a conta dividida, o pagamento ao prestador precisa passar por vocês (não dá para cada um pagar direto).");
    if (resp === "imobiliaria") throw new Error("Se a imobiliária é a responsável, quem paga o prestador é ela: escolha “Nós pagamos o prestador”.");
    avisos.push("O responsável paga direto ao prestador: nada é lançado no Financeiro.");
    return { total: paraReais(totalC), partes, pagar: [], cobrarLocatario: 0, avisos };
  }

  const pagar: LancamentoPlanejado[] = [];
  const repasse = opts.modo === "imobiliaria" && cProp > 0;
  if (repasse) {
    pagar.push({
      tipo: "pagar",
      parte: "proprietario",
      valor: paraReais(cProp),
      descontarRepasse: true,
      descricao: `Manutenção${nome}${cProp < totalC ? " (parte do proprietário)" : ""}`,
    });
    avisos.push(`${formatarReais(paraReais(cProp))} será descontado do próximo repasse ao proprietário.`);
  }
  const restoC = totalC - (repasse ? cProp : 0);
  if (restoC > 0) {
    const resto = ([cLoc > 0 && "locatario", !repasse && cProp > 0 && "proprietario", cImob > 0 && "imobiliaria"].filter(Boolean) as LancamentoPlanejado["parte"][]);
    const parte = resto.length === 1 ? resto[0] : "geral";
    const sufixo = repasse ? ({ locatario: " (parte do locatário)", imobiliaria: " (parte da imobiliária)", proprietario: "", geral: " (locatário e imobiliária)" } as const)[parte] : "";
    pagar.push({ tipo: "pagar", parte, valor: paraReais(restoC), descontarRepasse: false, descricao: `Manutenção${nome}${sufixo}` });
  }
  if (cLoc > 0) avisos.push(`${formatarReais(paraReais(cLoc))} será cobrado do locatário.`);
  return { total: paraReais(totalC), partes, pagar, cobrarLocatario: paraReais(cLoc), avisos };
}

// ---------------------------------------------------------------------------
// Orçamentos
// ---------------------------------------------------------------------------

export type OrcamentoComparavel = { id: string; valor: number | null; prazo_dias: number | null; garantia_dias: number | null; status?: string };

/**
 * Comparação: ordena por valor (sem valor vai para o fim) e marca o mais
 * barato, o mais rápido e a maior garantia entre os que já têm valor.
 */
export function compararOrcamentos<T extends OrcamentoComparavel>(lista: T[]): (T & { menorValor: boolean; menorPrazo: boolean; maiorGarantia: boolean; diferencaMenor: number | null })[] {
  const validos = lista.filter((o) => o.valor != null && o.status !== "recusado");
  const menor = validos.length ? Math.min(...validos.map((o) => paraCentavos(o.valor))) : null;
  const prazos = validos.filter((o) => o.prazo_dias != null).map((o) => o.prazo_dias as number);
  const garantias = validos.filter((o) => o.garantia_dias != null).map((o) => o.garantia_dias as number);
  const menorPrazo = prazos.length > 1 ? Math.min(...prazos) : null;
  const maiorGarantia = garantias.length > 1 ? Math.max(...garantias) : null;
  return [...lista]
    .sort((a, b) => (a.valor == null ? 1 : 0) - (b.valor == null ? 1 : 0) || paraCentavos(a.valor) - paraCentavos(b.valor))
    .map((o) => {
      const ok = o.valor != null && o.status !== "recusado";
      return {
        ...o,
        menorValor: ok && validos.length > 1 && paraCentavos(o.valor) === menor,
        menorPrazo: ok && menorPrazo != null && o.prazo_dias === menorPrazo,
        maiorGarantia: ok && maiorGarantia != null && maiorGarantia > 0 && o.garantia_dias === maiorGarantia,
        diferencaMenor: ok && menor != null ? paraReais(paraCentavos(o.valor) - menor) : null,
      };
    });
}

// ---------------------------------------------------------------------------
// Garantia
// ---------------------------------------------------------------------------

export function garantiaAte(concluidoEm: DataISO, dias: number | null | undefined): DataISO | null {
  if (!dias || dias <= 0) return null;
  return somarDias(concluidoEm, dias);
}

export type SituacaoGarantia = "sem" | "ativa" | "vencendo" | "vencida";
export function situacaoGarantia(ate: DataISO | null | undefined, hoje: DataISO): SituacaoGarantia {
  if (!ate) return "sem";
  if (ate < hoje) return "vencida";
  return diasEntre(hoje, ate) <= 30 ? "vencendo" : "ativa";
}
export const ROTULO_GARANTIA: Record<SituacaoGarantia, string> = { sem: "Sem garantia", ativa: "Na garantia", vencendo: "Garantia acabando", vencida: "Garantia vencida" };

/**
 * Chamado anterior do mesmo imóvel e categoria cujo serviço ainda está na
 * garantia (o novo chamado aponta para ele e o prestador volta sem custo).
 */
export function chamadoEmGarantia<T extends { id: string; imovel_id: string; categoria: string; status: string; garantia_ate: string | null }>(
  novo: { imovel_id: string; categoria: string },
  anteriores: T[],
  hoje: DataISO,
): T | null {
  const c = anteriores
    .filter((a) => a.imovel_id === novo.imovel_id && a.categoria === novo.categoria && ["concluido", "avaliado"].includes(a.status) && a.garantia_ate && a.garantia_ate >= hoje)
    .sort((a, b) => (b.garantia_ate ?? "").localeCompare(a.garantia_ate ?? ""));
  return c[0] ?? null;
}

// ---------------------------------------------------------------------------
// Avaliação dos prestadores
// ---------------------------------------------------------------------------

/** Média das notas (1 casa decimal) ou null se não houver. */
export function mediaNotas(notas: (number | null | undefined)[]): number | null {
  const v = notas.filter((n): n is number => typeof n === "number" && n >= 1 && n <= 5);
  if (!v.length) return null;
  return Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10;
}

export type ResumoPrestador = { servicos: number; avaliacoes: number; media: number | null; gasto: number; ultimo: DataISO | null; emAndamento: number };

/** Números de cada prestador a partir dos chamados em que ele trabalhou. */
export function resumoPrestadores(
  chamados: { prestador_id: string | null; status: string; avaliacao_nota: number | null; valor_final: number | string | null; concluido_em: DataISO | null }[],
): Map<string, ResumoPrestador> {
  const m = new Map<string, { notas: number[]; servicos: number; gasto: number; ultimo: DataISO | null; emAndamento: number }>();
  for (const c of chamados) {
    if (!c.prestador_id) continue;
    const r = m.get(c.prestador_id) ?? { notas: [], servicos: 0, gasto: 0, ultimo: null, emAndamento: 0 };
    if (["concluido", "avaliado"].includes(c.status)) {
      r.servicos += 1;
      r.gasto += paraCentavos(c.valor_final);
      if (c.concluido_em && (!r.ultimo || c.concluido_em > r.ultimo)) r.ultimo = c.concluido_em;
    } else if ((STATUS_EM_ANDAMENTO as string[]).includes(c.status)) r.emAndamento += 1;
    if (c.avaliacao_nota) r.notas.push(c.avaliacao_nota);
    m.set(c.prestador_id, r);
  }
  return new Map(
    [...m.entries()].map(([k, r]) => [k, { servicos: r.servicos, avaliacoes: r.notas.length, media: mediaNotas(r.notas), gasto: paraReais(r.gasto), ultimo: r.ultimo, emAndamento: r.emAndamento }]),
  );
}

export function estrelas(n: number | null | undefined): string {
  if (!n) return "—";
  const cheias = Math.round(n);
  return "★".repeat(cheias) + "☆".repeat(5 - cheias);
}

// ---------------------------------------------------------------------------
// Histórico por imóvel
// ---------------------------------------------------------------------------

export function resumoPorImovel(chamados: { imovel_id: string; status: string; valor_final: number | string | null; concluido_em: DataISO | null; garantia_ate: DataISO | null; created_at: string }[], hoje: DataISO) {
  const m = new Map<string, { chamados: number; abertos: number; gasto: number; ultimo: DataISO | null; garantias: number }>();
  for (const c of chamados) {
    const r = m.get(c.imovel_id) ?? { chamados: 0, abertos: 0, gasto: 0, ultimo: null, garantias: 0 };
    r.chamados += 1;
    if ((STATUS_EM_ANDAMENTO as string[]).includes(c.status)) r.abertos += 1;
    if (["concluido", "avaliado"].includes(c.status)) r.gasto += paraCentavos(c.valor_final);
    const d = c.concluido_em ?? diaLocal(c.created_at);
    if (!r.ultimo || d > r.ultimo) r.ultimo = d;
    if (c.garantia_ate && c.garantia_ate >= hoje) r.garantias += 1;
    m.set(c.imovel_id, r);
  }
  return new Map([...m.entries()].map(([k, r]) => [k, { ...r, gasto: paraReais(r.gasto) }]));
}

// ---------------------------------------------------------------------------
// Mensagens prontas (WhatsApp)
// ---------------------------------------------------------------------------

export function mensagemPedidoOrcamento(o: { prestador: string; numero: number; categoria: string; titulo: string; descricao?: string | null; endereco: string; urgencia: string }): string {
  return [
    `Olá ${o.prestador.split(" ")[0]}! Tudo bem?`,
    `Temos um serviço de ${(ROTULO_CATEGORIA_CURTO[o.categoria] ?? o.categoria).toLowerCase()} (chamado #${o.numero}): ${o.titulo}.`,
    o.descricao ? `Detalhes: ${o.descricao}` : null,
    `Endereço: ${o.endereco}.`,
    `Urgência: ${(ROTULO_URGENCIA[o.urgencia] ?? o.urgencia).toLowerCase()}.`,
    "Pode nos mandar um orçamento com valor, prazo e garantia do serviço?",
  ]
    .filter(Boolean)
    .join("\n");
}

export function mensagemAprovacao(o: { proprietario: string; numero: number; titulo: string; endereco: string; valor: number; parte: number; link: string }): string {
  return [
    `Olá ${o.proprietario.split(" ")[0]}! Tudo bem?`,
    `O imóvel ${o.endereco} precisa de um conserto (chamado #${o.numero}): ${o.titulo}.`,
    `Orçamento escolhido: ${formatarReais(o.valor)}${o.parte !== o.valor ? ` (sua parte: ${formatarReais(o.parte)})` : ""}.`,
    `Veja os orçamentos e aprove ou recuse por este link: ${o.link}`,
  ].join("\n");
}

export function mensagemLinkLocatario(o: { locatario: string; link: string; organizacao: string }): string {
  return [
    `Olá ${o.locatario.split(" ")[0]}! Tudo bem?`,
    `Para pedir um conserto no imóvel, use este link (pode mandar fotos e vídeos): ${o.link}`,
    `Por ele você também acompanha o andamento dos seus chamados. — ${o.organizacao}`,
  ].join("\n");
}

export function mensagemAgendamento(o: { nome: string; numero: number; titulo: string; quando: string; endereco: string; prestador?: string | null }): string {
  return [
    `Olá ${o.nome.split(" ")[0]}! Tudo bem?`,
    `O serviço do chamado #${o.numero} (${o.titulo}) ficou marcado para ${o.quando}.`,
    o.prestador ? `Prestador: ${o.prestador}.` : null,
    `Endereço: ${o.endereco}.`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** "12/11/2026 até 12/02/2027 (90 dias)". */
export function textoGarantia(concluido: DataISO | null, ate: DataISO | null): string {
  if (!ate) return "Sem garantia";
  return `${concluido ? `${formatarDataBR(concluido)} até ` : "até "}${formatarDataBR(ate)}${concluido ? ` (${diasEntre(concluido, ate)} dias)` : ""}`;
}
