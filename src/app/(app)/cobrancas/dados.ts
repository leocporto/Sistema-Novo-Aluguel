import "server-only";
import { headers } from "next/headers";
import type { obterContexto } from "@/lib/contexto";
import {
  assuntoCobranca,
  casarParcelas,
  casarRecebimentos,
  filaDoDia,
  identificacaoImovel,
  imovelCurto,
  parcelaNaDescricao,
  proximosAvisos,
  regraParaDias,
  rodapeMensagem,
  textoDias,
  type ImovelEndereco,
  type SituacaoFatura,
} from "@/lib/dominio/cobrancas";
import { diasEntre, somarDias } from "@/lib/dominio/datas";
import { formatarReais, paraCentavos, percentual } from "@/lib/dominio/dinheiro";
import { gerarPixCopiaCola, normalizarChavePix } from "@/lib/dominio/pix";
import { renderizarMensagem } from "@/lib/dominio/regua";
import { paraPagamento, situacaoDaFatura, type PagamentoDb } from "@/lib/servicos/cobrancas";
import type { Organizacao } from "@/lib/tipos";
import type { DadosCobrar } from "./cobrar";

type Supabase = Awaited<ReturnType<typeof obterContexto>>["supabase"];

/** Configuração de cobrança guardada na organização (migração 20261106000001). */
export interface ConfigCobranca {
  pixChave: string | null;
  pixNome: string | null;
  pixCidade: string | null;
  contaId: string | null;
  meios: string[];
  instrucoes: string | null;
  linkPublico: boolean;
  envioAutomatico: boolean;
  canalPadrao: "whatsapp" | "email" | "sms";
  horaEnvio: number;
  juridicoDias: number;
  quebraDias: number;
}

type OrgCobranca = Organizacao & {
  cobranca_pix_chave?: string | null;
  cobranca_pix_nome?: string | null;
  cobranca_pix_cidade?: string | null;
  cobranca_conta_id?: string | null;
  cobranca_meios?: string[] | null;
  cobranca_instrucoes?: string | null;
  cobranca_link_publico?: boolean | null;
  cobranca_envio_automatico?: boolean | null;
  cobranca_canal_padrao?: string | null;
  cobranca_hora_envio?: number | null;
  cobranca_juridico_dias?: number | null;
  cobranca_quebra_dias?: number | null;
};

export function configCobranca(org: Organizacao): ConfigCobranca {
  const o = org as OrgCobranca;
  const canal = o.cobranca_canal_padrao === "email" || o.cobranca_canal_padrao === "sms" ? o.cobranca_canal_padrao : "whatsapp";
  return {
    pixChave: o.cobranca_pix_chave ?? null,
    pixNome: o.cobranca_pix_nome ?? null,
    pixCidade: o.cobranca_pix_cidade ?? null,
    contaId: o.cobranca_conta_id ?? null,
    meios: o.cobranca_meios ?? ["pix", "transferencia", "dinheiro"],
    instrucoes: o.cobranca_instrucoes ?? null,
    linkPublico: o.cobranca_link_publico ?? true,
    envioAutomatico: o.cobranca_envio_automatico ?? false,
    canalPadrao: canal,
    horaEnvio: o.cobranca_hora_envio ?? 9,
    juridicoDias: o.cobranca_juridico_dias ?? 90,
    quebraDias: o.cobranca_quebra_dias ?? 30,
  };
}

export interface RecebedorPix {
  chave: string;
  nome: string;
  cidade: string | null;
}

/** Chave Pix para receber os aluguéis: a da configuração ou a da conta de recebimento. */
export async function recebedorPix(supabase: Supabase, org: Organizacao): Promise<RecebedorPix | null> {
  const cfg = configCobranca(org);
  let chave = cfg.pixChave;
  if (!chave && cfg.contaId) {
    const { data } = await supabase.from("contas_financeiras").select("pix_chave").eq("id", cfg.contaId).maybeSingle();
    chave = (data?.pix_chave as string | null) ?? null;
  }
  if (!chave || !cfg.meios.includes("pix") || !normalizarChavePix(chave)) return null;
  return { chave, nome: cfg.pixNome || org.nome, cidade: cfg.pixCidade };
}

/** Pix copia e cola de uma cobrança (null se não há chave válida). */
export function pixDaCobranca(r: RecebedorPix | null, valorCentavos: number, txid: string, descricao?: string): string | null {
  if (!r) return null;
  try {
    return gerarPixCopiaCola({ chave: r.chave, nome: r.nome, cidade: r.cidade, valor: valorCentavos, txid, descricao });
  } catch {
    return null;
  }
}

/** Endereço do sistema (para montar o link público da 2ª via). */
export async function urlBase(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  return `${host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https"}://${host}`;
}

export const linkPagar = (base: string, token: string) => `${base}/pagar/${token}`;

export interface PessoaCobranca {
  id: string;
  nome: string;
  telefone: string | null;
  email: string | null;
}

export interface CobrancaDoSistema {
  faturaId: string;
  numero: number;
  status: string;
  contratoId: string;
  contratoNumero: number;
  competencia: string;
  vencimento: string;
  valorTotal: number;
  token: string;
  acordoId: string | null;
  juridicoId: string | null;
  juridicoAtivo: boolean;
  vistaEm: string | null;
  locatario: PessoaCobranca | null;
  imovelId: string;
  imovel: ImovelEndereco;
  imovelTexto: string;
  imovelCurto: string;
  /** > 0 em atraso; <= 0 faltam |dias| para vencer. */
  dias: number;
  sit: SituacaoFatura;
  multaPct: number;
  jurosMesPct: number;
  /** Maior desconto de pontualidade possível (centavos; pagando até o vencimento). */
  pontualidadeMax: number;
}

type FaturaLinha = {
  id: string;
  numero: number;
  status: string;
  contrato_id: string;
  competencia: string;
  vencimento: string;
  valor_total: number;
  token_publico: string;
  acordo_id: string | null;
  juridico_id: string | null;
  segunda_via_vista_em: string | null;
  juridico: { situacao: string } | null;
  contrato: {
    id: string;
    numero: number;
    multa_atraso_pct: number;
    juros_mes_pct: number;
    carencia_dias: number;
    valor_aluguel: number;
    desconto_pontualidade_pct: number | null;
    imovel: ImovelEndereco & { id: string; codigo: string };
    contrato_partes: { papel: string; pessoa_id: string; pessoa: PessoaCobranca }[];
  };
};

const SELECT_FATURA =
  "id, numero, status, contrato_id, competencia, vencimento, valor_total, token_publico, acordo_id, juridico_id, segunda_via_vista_em, juridico:cobrancas_juridicas!faturas_juridico_id_fkey(situacao), contrato:contratos(id, numero, multa_atraso_pct, juros_mes_pct, carencia_dias, valor_aluguel, desconto_pontualidade_pct, imovel:imoveis(id, codigo, logradouro, numero, complemento, bairro, cidade, uf), contrato_partes(papel, pessoa_id, pessoa:pessoas(id, nome, telefone, email)))";

/**
 * Cobranças em aberto (e, se pedido, renegociadas) com o saldo e a sugestão
 * de multa e juros calculados para hoje.
 */
export async function carregarCobrancas(
  supabase: Supabase,
  hoje: string,
  filtro: { venceAte?: string; contratoId?: string; status?: string[]; ids?: string[] } = {},
): Promise<CobrancaDoSistema[]> {
  let q = supabase
    .from("faturas")
    .select(SELECT_FATURA)
    .in("status", filtro.status ?? ["aberta"])
    .order("vencimento")
    .limit(3000);
  if (filtro.venceAte) q = q.lte("vencimento", filtro.venceAte);
  if (filtro.contratoId) q = q.eq("contrato_id", filtro.contratoId);
  if (filtro.ids) q = q.in("id", filtro.ids.length ? filtro.ids : ["00000000-0000-0000-0000-000000000000"]);
  const { data } = await q;
  const linhas = (data ?? []) as unknown as FaturaLinha[];
  const ids = linhas.map((f) => f.id);
  const pagamentos = new Map<string, PagamentoDb[]>();
  for (let i = 0; i < ids.length; i += 300) {
    const { data: pg } = await supabase.from("fatura_pagamentos").select("fatura_id, pago_em, valor, principal, multa, juros, desconto").in("fatura_id", ids.slice(i, i + 300));
    for (const p of (pg ?? []) as PagamentoDb[]) pagamentos.set(p.fatura_id, [...(pagamentos.get(p.fatura_id) ?? []), p]);
  }
  return linhas.map((f) => {
    const c = f.contrato;
    const loc = c.contrato_partes.find((p) => p.papel === "locatario")?.pessoa ?? null;
    const sit = situacaoDaFatura(f, c, (pagamentos.get(f.id) ?? []).map(paraPagamento), hoje);
    return {
      faturaId: f.id,
      numero: f.numero,
      status: f.status,
      contratoId: c.id,
      contratoNumero: c.numero,
      competencia: f.competencia,
      vencimento: f.vencimento,
      valorTotal: Number(f.valor_total),
      token: f.token_publico,
      acordoId: f.acordo_id,
      juridicoId: f.juridico_id,
      juridicoAtivo: Boolean(f.juridico_id && f.juridico && !["pago", "encerrado"].includes(f.juridico.situacao)),
      vistaEm: f.segunda_via_vista_em,
      locatario: loc,
      imovelId: c.imovel.id,
      imovel: c.imovel,
      imovelTexto: identificacaoImovel(c.imovel),
      imovelCurto: imovelCurto(c.imovel),
      dias: diasEntre(f.vencimento, hoje),
      sit,
      multaPct: Number(c.multa_atraso_pct),
      jurosMesPct: Number(c.juros_mes_pct),
      pontualidadeMax: Number(c.desconto_pontualidade_pct ?? 0) > 0 ? Math.min(sit.saldo, percentual(paraCentavos(c.valor_aluguel), Number(c.desconto_pontualidade_pct))) : 0,
    };
  });
}

/** Sugestão de baixa automática (valores em reais, para o navegador). */
export interface SugestaoBaixa {
  chave: string;
  /** "fatura" = cobrança do mês; "parcela" = parcela de acordo (recebida inteira). */
  tipo: "fatura" | "parcela";
  faturaId: string | null;
  parcelaId: string | null;
  /** Para onde o link da sugestão leva (cobrança ou acordo). */
  href: string;
  /** "#123 · Fulano" ou "Acordo nº 4 · parcela 2". */
  titulo: string;
  numero: number;
  locatario: string;
  imovel: string;
  vencimento: string;
  saldo: number;
  data: string;
  valor: number;
  descricao: string;
  confianca: "alta" | "media";
  motivo: string;
  extratoItemId: string | null;
  contaId: string | null;
  conta: string | null;
  /** Chave da linha do extrato/arquivo (a mesma linha não dá baixa duas vezes). */
  chaveBaixa: string | null;
  /** Como fica: "quita" ou "parcial". */
  efeito: "quita" | "parcial";
}

export interface LinhaParaBaixa {
  id: string;
  data: string;
  valor: number;
  descricao: string;
  extratoItemId?: string | null;
  contaId?: string | null;
  conta?: string | null;
  chaveBaixa?: string | null;
}

/** Parcelas de acordo em aberto (acordo em andamento), para a baixa automática. */
async function parcelasAbertas(supabase: Supabase) {
  const { data } = await supabase
    .from("acordo_parcelas")
    .select("id, numero, valor, vencimento, acordo:acordos!inner(id, numero, status, pessoa:pessoas(nome), contrato:contratos(imovel:imoveis(codigo, logradouro, numero, complemento, bairro, cidade, uf)))")
    .eq("status", "aberta")
    .eq("acordo.status", "ativo")
    .order("vencimento")
    .limit(2000);
  return (data ?? []) as unknown as {
    id: string;
    numero: number;
    valor: number;
    vencimento: string;
    acordo: { id: string; numero: number; pessoa: { nome: string } | null; contrato: { imovel: ImovelEndereco | null } | null };
  }[];
}

/** Casa entradas de dinheiro (extrato/arquivo) com as cobranças e parcelas de acordo em aberto. */
export async function sugerirBaixas(supabase: Supabase, hoje: string, linhas: LinhaParaBaixa[]): Promise<SugestaoBaixa[]> {
  if (!linhas.length) return [];
  const [abertas, parcelas] = await Promise.all([carregarCobrancas(supabase, hoje), parcelasAbertas(supabase)]);
  const porId = new Map(abertas.map((c) => [c.faturaId, c]));
  const parcelaPorId = new Map(parcelas.map((p) => [p.id, p]));
  const linhaPorId = new Map(linhas.map((l) => [l.id, l]));
  const emCentavos = linhas.map((l) => ({ id: l.id, data: l.data, valor: paraCentavos(l.valor), descricao: l.descricao }));

  // 1º parcelas de acordo (Pix AC..P.. ou valor + nome); linhas que citam parcela não vão para as faturas.
  const casosParcela = casarParcelas(
    emCentavos,
    parcelas.map((p) => ({ id: p.id, acordoNumero: p.acordo.numero, numero: p.numero, valor: paraCentavos(p.valor), vencimento: p.vencimento, nome: p.acordo.pessoa?.nome ?? "" })),
  );
  const usadas = new Set(casosParcela.map((k) => k.linhaId));
  const casos = casarRecebimentos(
    emCentavos.filter((l) => !usadas.has(l.id) && !parcelaNaDescricao(l.descricao)),
    abertas
      .filter((c) => !c.juridicoAtivo)
      .map((c) => ({
        id: c.faturaId,
        numero: c.numero,
        vencimento: c.vencimento,
        saldo: c.sit.saldo,
        maximo: c.sit.saldo + (c.sit.multaCobrada ? 0 : percentual(c.sit.saldo, c.multaPct)) + c.sit.juros,
        minimo: c.sit.saldo - c.pontualidadeMax,
        nome: c.locatario?.nome ?? "",
      })),
  );
  const daLinha = (l: LinhaParaBaixa) => ({
    data: l.data,
    valor: l.valor,
    descricao: l.descricao,
    extratoItemId: l.extratoItemId ?? null,
    contaId: l.contaId ?? null,
    conta: l.conta ?? null,
    chaveBaixa: l.chaveBaixa ?? (l.extratoItemId ? `ext:${l.extratoItemId}` : null),
  });
  return [
    ...casosParcela.map((k): SugestaoBaixa => {
      const l = linhaPorId.get(k.linhaId)!;
      const p = parcelaPorId.get(k.parcelaId)!;
      return {
        ...daLinha(l),
        chave: `${k.linhaId}|p:${p.id}`,
        tipo: "parcela",
        faturaId: null,
        parcelaId: p.id,
        href: `/cobrancas/acordos/${p.acordo.id}`,
        titulo: `Acordo nº ${p.acordo.numero} · ${p.numero === 0 ? "entrada" : `parcela ${p.numero}`}`,
        numero: p.numero,
        locatario: p.acordo.pessoa?.nome ?? "Locatário",
        imovel: identificacaoImovel(p.acordo.contrato?.imovel),
        vencimento: p.vencimento,
        saldo: Number(p.valor),
        confianca: k.confianca,
        motivo: k.motivo,
        efeito: "quita",
      };
    }),
    ...casos.map((k): SugestaoBaixa => {
      const l = linhaPorId.get(k.linhaId)!;
      const c = porId.get(k.faturaId)!;
      return {
        ...daLinha(l),
        chave: `${k.linhaId}|${k.faturaId}`,
        tipo: "fatura",
        faturaId: c.faturaId,
        parcelaId: null,
        href: `/faturas/${c.faturaId}`,
        titulo: `#${c.numero} · ${c.locatario?.nome ?? "Locatário"}`,
        numero: c.numero,
        locatario: c.locatario?.nome ?? "Locatário",
        imovel: c.imovelTexto,
        vencimento: c.vencimento,
        saldo: reais(c.sit.saldo),
        confianca: k.confianca,
        motivo: k.motivo,
        efeito: paraCentavos(l.valor) >= c.sit.saldo - c.pontualidadeMax ? "quita" : "parcial",
      };
    }),
  ];
}

/**
 * Números de cobrança para o Painel (ponto de integração): em atraso (só o
 * aluguel), devedores, recuperado no mês, promessas e "já paguei" para
 * conferir e parcelas de acordo atrasadas. Valores em reais.
 */
export async function resumoCobrancaPainel(supabase: Supabase, hoje: string) {
  const inicioMes = `${hoje.slice(0, 7)}-01`;
  const [abertas, { data: pgMes }, { count: conferir }, { count: parcelasAtrasadas }] = await Promise.all([
    carregarCobrancas(supabase, hoje, { venceAte: hoje }),
    supabase.from("fatura_pagamentos").select("valor, pago_em, fatura:faturas!inner(vencimento)").gte("pago_em", inicioMes).lte("pago_em", hoje).limit(5000),
    supabase.from("cobranca_contatos").select("id", { count: "exact", head: true }).eq("promessa_status", "pendente").lte("promessa_data", hoje),
    supabase.from("acordo_parcelas").select("id, acordo:acordos!inner(status)", { count: "exact", head: true }).eq("status", "aberta").lt("vencimento", hoje).eq("acordo.status", "ativo"),
  ]);
  const vencidas = abertas.filter((c) => c.dias > 0);
  const recuperado = ((pgMes ?? []) as unknown as { valor: number; pago_em: string; fatura: { vencimento: string } }[])
    .filter((p) => p.pago_em > p.fatura.vencimento)
    .reduce((s, p) => s + paraCentavos(p.valor), 0);
  return {
    emAtraso: reais(vencidas.reduce((s, c) => s + c.sit.saldo, 0)),
    devedores: new Set(vencidas.map((c) => c.contratoId)).size,
    recuperadoMes: reais(recuperado),
    paraConferir: conferir ?? 0,
    parcelasAtrasadas: parcelasAtrasadas ?? 0,
  };
}

/** Valores em centavos → reais para mandar ao navegador. */
export const reais = (c: number) => Math.round(c) / 100;

/** Contas financeiras ativas (para escolher onde o dinheiro entrou). */
export async function contasAtivas(supabase: Supabase) {
  const { data } = await supabase.from("contas_financeiras").select("id, nome, pix_chave, terceiros").eq("ativa", true).order("nome");
  return (data ?? []) as { id: string; nome: string; pix_chave: string | null; terceiros: boolean }[];
}

export const centavos = paraCentavos;

// ---------------------------------------------------------------------------
// Mensagem pronta de cobrança (régua + link da 2ª via + Pix)
// ---------------------------------------------------------------------------

export type RegraDb = { id: string; nome: string; dias_relativos: number; canal: string; mensagem: string; ativo: boolean; assunto: string | null };

export const PADRAO_ATRASO =
  "Olá {{nome}}, não identificamos o pagamento do aluguel de {{competencia}} ({{imovel}}), vencido em {{vencimento}}. Hoje fica {{valor}}: {{saldo}} + multa {{multa}} + juros {{juros}}. Se já pagou, desconsidere.";
export const PADRAO_LEMBRETE = "Olá {{nome}}! Lembrete: o aluguel de {{competencia}} ({{imovel}}), de {{valor}}, vence em {{vencimento}}.";

export async function carregarRegras(supabase: Supabase): Promise<RegraDb[]> {
  const { data } = await supabase.from("regua_regras").select("id, nome, dias_relativos, canal, mensagem, ativo, assunto").order("dias_relativos");
  return (data ?? []) as RegraDb[];
}

/** Monta a mensagem de cobrança de uma fatura (texto da régua + 2ª via + Pix). */
export function montarCobrar(
  c: CobrancaDoSistema,
  regras: RegraDb[],
  ctx: { base: string; recebedor: RecebedorPix | null; cfg: ConfigCobranca; regraId?: string | null; superados?: string[] },
): DadosCobrar {
  const regra = ctx.regraId ? (regras.find((r) => r.id === ctx.regraId) ?? null) : regraParaDias(regras, c.dias);
  const atrasado = c.dias > 0;
  const total = atrasado ? c.sit.totalComEncargos : c.sit.saldo;
  const pix = pixDaCobranca(ctx.recebedor, total, `FAT${c.numero}`);
  const link = ctx.cfg.linkPublico ? linkPagar(ctx.base, c.token) : "";
  const modelo = regra?.mensagem ?? (atrasado ? PADRAO_ATRASO : PADRAO_LEMBRETE);
  let mensagem = renderizarMensagem(modelo, {
    nome: c.locatario?.nome.split(" ")[0] ?? "",
    valor: reais(total),
    saldo: reais(c.sit.saldo),
    multa: reais(c.sit.multa),
    juros: reais(c.sit.juros),
    dias: Math.max(0, c.dias),
    vencimento: c.vencimento,
    competencia: c.competencia,
    imovel: c.imovelTexto,
    link,
    pix: pix ?? "",
  });
  const rodape = rodapeMensagem({ link: modelo.includes("{{link}}") ? null : link || null, pix: modelo.includes("{{pix}}") ? null : pix });
  if (rodape) mensagem += `\n\n${rodape}`;
  const canal = regra?.canal ?? ctx.cfg.canalPadrao;
  return {
    faturaId: c.faturaId,
    contratoId: c.contratoId,
    pessoaId: c.locatario?.id ?? null,
    nome: c.locatario?.nome ?? "Locatário",
    telefone: c.locatario?.telefone ?? null,
    email: c.locatario?.email ?? null,
    regraId: regra?.id ?? null,
    superados: ctx.superados,
    canalInicial: canal === "email" || canal === "sms" ? canal : "whatsapp",
    mensagem,
    assunto: assuntoCobranca(c.dias, c.competencia),
    resumo: `${c.imovelTexto} · ${textoDias(c.dias)} · ${formatarReais(reais(total))}`,
  };
}

// ---------------------------------------------------------------------------
// Fila do dia (régua) e fila de saída do envio automático
// ---------------------------------------------------------------------------

export interface ItemFilaDoDia {
  faturaId: string;
  regraId: string;
  superados: string[];
  dataAlvo: string;
  cobranca: CobrancaDoSistema;
  /** Já está na fila de saída do envio automático (aguardando o provedor). */
  agendado: { para: string | null; canal: string | null; destinatario: string | null } | null;
}

/**
 * O que a régua manda hoje (um aviso por cobrança), com o que já foi para a
 * fila de saída. "Agendado" continua na lista até ser enviado de verdade.
 */
export async function carregarFilaDoDia(supabase: Supabase, organizacao: Organizacao, hoje: string) {
  const cfg = configCobranca(organizacao);
  const regrasDb = await carregarRegras(supabase);
  const maxAntes = Math.max(0, ...regrasDb.filter((r) => r.ativo && r.dias_relativos < 0).map((r) => -r.dias_relativos));
  const [cobrancas, recebedor, base] = await Promise.all([
    carregarCobrancas(supabase, hoje, { venceAte: somarDias(hoje, maxAntes + 7) }),
    recebedorPix(supabase, organizacao),
    urlBase(),
  ]);
  const ids = cobrancas.map((c) => c.faturaId);
  const envios: { regra_id: string; fatura_id: string; status: string; agendado_para: string | null; canal: string | null; destinatario: string | null }[] = [];
  for (let i = 0; i < ids.length; i += 300) {
    const { data } = await supabase.from("regua_envios").select("regra_id, fatura_id, status, agendado_para, canal, destinatario").in("fatura_id", ids.slice(i, i + 300));
    envios.push(...((data ?? []) as typeof envios));
  }
  const enviados = new Set(envios.filter((e) => e.status !== "agendado").map((e) => `${e.regra_id}:${e.fatura_id}`));
  const agendados = new Map(envios.filter((e) => e.status === "agendado").map((e) => [`${e.regra_id}:${e.fatura_id}`, e]));
  const regras = regrasDb.map((r) => ({ id: r.id, diasRelativos: r.dias_relativos, ativo: r.ativo }));
  const faturas = cobrancas.map((c) => ({ id: c.faturaId, vencimento: c.vencimento, status: c.status, juridico: c.juridicoAtivo }));
  const porId = new Map(cobrancas.map((c) => [c.faturaId, c]));
  const fila: ItemFilaDoDia[] = filaDoDia(regras, faturas, hoje, enviados).map((f) => {
    const a = agendados.get(`${f.regraId}:${f.faturaId}`);
    return { ...f, cobranca: porId.get(f.faturaId)!, agendado: a ? { para: a.agendado_para, canal: a.canal, destinatario: a.destinatario } : null };
  });
  return { cfg, regrasDb, cobrancas, porId, recebedor, base, fila, proximos: proximosAvisos(regras, faturas, hoje, 7) };
}
