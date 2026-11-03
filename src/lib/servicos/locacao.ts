import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { paraCentavos, paraReais } from "@/lib/dominio/dinheiro";
import { inicioDoMes, somarDias } from "@/lib/dominio/datas";
import { calcularAtraso } from "@/lib/dominio/encargos";
import { type ContratoParaFatura, type ItemFatura, descontoPontualidade, gerarFatura } from "@/lib/dominio/fatura";
import { aplicarIrrfIndividual, calcularRepasse, impostoEfetivo, type RepasseCalculado } from "@/lib/dominio/repasse";
import { calcularReajuste, type ResultadoReajuste } from "@/lib/dominio/reajuste";
import { ErroValidacao, verificar } from "@/lib/form";
import type { Contrato, ContratoEncargo, ContratoParte, Fatura, FaturaItem, Imovel, Pessoa } from "@/lib/tipos";

export interface ContratoCompleto {
  contrato: Contrato;
  imovel: Imovel;
  partes: (ContratoParte & { pessoa: Pessoa })[];
  encargos: ContratoEncargo[];
  descontos: { inicio: string; fim: string | null; tipo: "valor" | "pct"; valor: number | string; motivo: string | null }[];
  /** % padrão de imposto do proprietário na imobiliária (quando o cadastro da pessoa está em branco). */
  impostoPadrao: { pf: number; pj: number };
  /** Conta no modo "imóveis pessoais": sem proprietário de terceiros, taxa nem repasse. */
  pessoal: boolean;
}

export async function carregarContrato(sb: SupabaseClient, id: string): Promise<ContratoCompleto | null> {
  // As três consultas vão juntas (antes eram em fila: 3 idas ao banco seguidas).
  const [rContrato, rPartes, rEncargos, rDescontos] = await Promise.all([
    sb
      .from("contratos")
      .select("*, imovel:imoveis(*), organizacao:organizacoes(imposto_pf_pct, imposto_pj_pct, modo)")
      .eq("id", id)
      .maybeSingle(),
    sb.from("contrato_partes").select("*, pessoa:pessoas(*)").eq("contrato_id", id),
    sb.from("contrato_encargos").select("*").eq("contrato_id", id).order("descricao"),
    sb.from("contrato_descontos").select("inicio, fim, tipo, valor, motivo").eq("contrato_id", id),
  ]);
  const contrato = rContrato.data;
  if (!contrato) return null;
  const partes = verificar(rPartes);
  const encargos = verificar(rEncargos);
  const { imovel, organizacao, ...resto } = contrato as Contrato & {
    imovel: Imovel;
    organizacao: { imposto_pf_pct: number | string; imposto_pj_pct: number | string; modo?: string } | null;
  };
  return {
    contrato: resto,
    imovel,
    impostoPadrao: { pf: Number(organizacao?.imposto_pf_pct ?? 0), pj: Number(organizacao?.imposto_pj_pct ?? 0) },
    pessoal: organizacao?.modo === "pessoal",
    partes: partes as (ContratoParte & { pessoa: Pessoa })[],
    encargos: encargos as ContratoEncargo[],
    descontos: (rDescontos.data ?? []) as ContratoCompleto["descontos"],
  };
}

export function proprietariosDo(c: ContratoCompleto) {
  return c.partes
    .filter((p) => p.papel === "proprietario")
    .map((p) => ({
      pessoaId: p.pessoa_id,
      percentual: Number(p.percentual ?? 0),
      tipoPessoa: p.pessoa.tipo_pessoa,
      impostoPct: impostoEfetivo(p.pessoa.imposto_pct, p.pessoa.tipo_pessoa, c.impostoPadrao),
    }));
}

export function locatarioPrincipal(c: ContratoCompleto) {
  return c.partes.find((p) => p.papel === "locatario")?.pessoa ?? null;
}

export function paraContratoDeFatura(c: ContratoCompleto): ContratoParaFatura {
  const loc = locatarioPrincipal(c);
  return {
    dataInicio: c.contrato.data_inicio,
    dataFim: c.contrato.data_rescisao ?? c.contrato.data_fim,
    valorAluguel: paraCentavos(c.contrato.valor_aluguel),
    diaVencimento: c.contrato.dia_vencimento,
    modalidade: c.contrato.modalidade,
    taxaAdministracaoPct: Number(c.contrato.taxa_administracao_pct),
    locatarioTipoPessoa: loc?.tipo_pessoa ?? "PF",
    proprietarios: proprietariosDo(c),
    carenciaMeses: Number(c.contrato.carencia_meses ?? 0),
    carenciaDescontoPct: Number(c.contrato.carencia_desconto_pct ?? 100),
    descontos: c.descontos.map((d) => ({
      inicio: d.inicio,
      fim: d.fim,
      tipo: d.tipo,
      valor: d.tipo === "pct" ? Number(d.valor) : paraCentavos(d.valor),
      motivo: d.motivo,
    })),
    encargos: c.encargos.map((e) => ({
      descricao: e.descricao,
      valor: paraCentavos(e.valor),
      destino: e.destino,
      inicio: e.inicio,
      fim: e.fim,
    })),
  };
}

function repassesParaJson(lista: RepasseCalculado[], previsto: string) {
  return lista.map((r) => ({
    pessoa_id: r.pessoaId,
    percentual: r.percentual,
    aluguel: paraReais(r.aluguel),
    encargos: paraReais(r.encargos),
    multa_juros: paraReais(r.multaJuros),
    valor_bruto: paraReais(r.valorBruto),
    taxa_administracao: paraReais(r.taxaAdministracao),
    taxa_intermediacao: paraReais(r.taxaIntermediacao),
    irrf: paraReais(r.irrf),
    imposto: paraReais(r.imposto),
    imposto_pct: r.impostoPct,
    valor_liquido: paraReais(r.valorLiquido),
    previsto_para: previsto,
  }));
}

async function ehPrimeiraFatura(sb: SupabaseClient, contratoId: string, competencia: string, ignorarId?: string) {
  let q = sb
    .from("faturas")
    .select("id", { count: "exact", head: true })
    .eq("contrato_id", contratoId)
    .neq("status", "cancelada")
    .lt("competencia", competencia);
  if (ignorarId) q = q.neq("id", ignorarId);
  const { count } = await q;
  return !count;
}

function validarProprietarios(c: ContratoCompleto) {
  const props = proprietariosDo(c);
  if (c.pessoal) return props; // imóveis próprios: não há proprietário de terceiros
  if (props.length === 0) throw new ErroValidacao(`Contrato #${c.contrato.numero} não tem proprietário vinculado.`);
  const soma = props.reduce((s, p) => s + p.percentual, 0);
  if (Math.abs(soma - 100) > 0.01)
    throw new ErroValidacao(`Contrato #${c.contrato.numero}: participações dos proprietários somam ${soma}% (deve ser 100%).`);
  return props;
}

/**
 * Gera a fatura de uma competência para um contrato (se ainda não existir).
 * Retorna o id criado ou null se não houver cobrança no mês.
 */
export async function gerarFaturaDoContrato(
  sb: SupabaseClient,
  c: ContratoCompleto,
  competencia: string,
): Promise<string | null> {
  const comp = inicioDoMes(competencia);
  const { count } = await sb
    .from("faturas")
    .select("id", { count: "exact", head: true })
    .eq("contrato_id", c.contrato.id)
    .eq("competencia", comp)
    .neq("status", "cancelada");
  if (count) return null;

  validarProprietarios(c);
  const f = gerarFatura(paraContratoDeFatura(c), comp);
  if (!f) return null;

  let repasses: ReturnType<typeof repassesParaJson> = [];
  if (c.contrato.tipo_repasse === "garantido" && !c.pessoal) {
    const primeira = await ehPrimeiraFatura(sb, c.contrato.id, comp);
    const r = aplicarIrrfIndividual(
      calcularRepasse(f.itens, {
        taxaAdministracaoPct: Number(c.contrato.taxa_administracao_pct),
        taxaIntermediacaoPct: Number(c.contrato.taxa_intermediacao_pct),
        primeiraFatura: primeira,
        valorAluguelContrato: paraCentavos(c.contrato.valor_aluguel),
        repassarMultaJuros: false,
        proprietarios: proprietariosDo(c),
      }),
      f.irrfPorProprietario,
    );
    repasses = repassesParaJson(r.repasses, somarDias(f.vencimento, c.contrato.dias_repasse));
  }

  const { data, error } = await sb.rpc("registrar_fatura", {
    p: {
      contrato_id: c.contrato.id,
      competencia: f.competencia,
      periodo_inicio: f.periodoInicio,
      periodo_fim: f.periodoFim,
      vencimento: f.vencimento,
      valor_total: paraReais(f.total),
      irrf_por_proprietario: f.irrfPorProprietario,
      itens: f.itens.map((i) => ({ ...i, valor: paraReais(i.valor) })),
      repasses,
    },
  });
  if (error) throw new Error(error.message);
  return data as string;
}

/** Gera as faturas da competência para todos os contratos ativos. */
export async function gerarFaturasDaCompetencia(sb: SupabaseClient, competencia: string) {
  const ativos = verificar(await sb.from("contratos").select("id").eq("status", "ativo"));
  const resultado = { criadas: 0, ignoradas: 0, erros: [] as string[] };
  for (const { id } of ativos as { id: string }[]) {
    try {
      const c = await carregarContrato(sb, id);
      if (!c) continue;
      const criada = await gerarFaturaDoContrato(sb, c, competencia);
      if (criada) resultado.criadas++;
      else resultado.ignoradas++;
    } catch (e) {
      resultado.erros.push(e instanceof Error ? e.message : String(e));
    }
  }
  return resultado;
}

export interface SimulacaoLiquidacao {
  diasAtraso: number;
  multa: number;
  juros: number;
  total: number;
  itensExtras: ItemFatura[];
  /** Quanto o contrato sugere de multa + juros (em centavos), para mostrar como dica. */
  sugestao: number;
}

export function simularLiquidacao(
  fatura: Fatura,
  contrato: Contrato,
  pagoEm: string,
  dispensarEncargos = false,
  /**
   * Encargos digitados pelo usuário (R$). Número = só multa (formato antigo);
   * objeto = multa e juros separados. Quando informado, substitui o cálculo
   * automático; 0 = sem encargo.
   */
  multaManual?: number | { multa: number; juros: number } | null,
): SimulacaoLiquidacao {
  const base = paraCentavos(fatura.valor_total);
  const atraso = calcularAtraso({
    valor: base,
    vencimento: fatura.vencimento,
    pagamento: pagoEm,
    multaPct: dispensarEncargos ? 0 : Number(contrato.multa_atraso_pct),
    jurosMesPct: dispensarEncargos ? 0 : Number(contrato.juros_mes_pct),
    carenciaDias: contrato.carencia_dias,
  });
  const destino = destinoEncargos(contrato);
  const sugestao = atraso.multa + atraso.juros;
  if (multaManual !== undefined && multaManual !== null) {
    if (typeof multaManual === "number") {
      const valor = Math.max(0, paraCentavos(multaManual));
      const itens: ItemFatura[] = valor > 0 ? [{ descricao: "Multa por atraso", tipo: "multa", valor, destino }] : [];
      return { diasAtraso: atraso.diasAtraso, multa: valor, juros: 0, total: base + valor, itensExtras: itens, sugestao };
    }
    const multa = Math.max(0, paraCentavos(multaManual.multa));
    const juros = Math.max(0, paraCentavos(multaManual.juros));
    const itens: ItemFatura[] = [];
    if (multa > 0) itens.push({ descricao: `Multa por atraso (${Number(contrato.multa_atraso_pct)}%)`, tipo: "multa", valor: multa, destino });
    if (juros > 0) itens.push({ descricao: "Juros de mora", tipo: "juros", valor: juros, destino });
    return { diasAtraso: atraso.diasAtraso, multa, juros, total: base + multa + juros, itensExtras: itens, sugestao };
  }
  const itensExtras: ItemFatura[] = [];
  // Desconto de pontualidade: pagou até o vencimento.
  const pont = descontoPontualidade(paraCentavos(contrato.valor_aluguel), Number(contrato.desconto_pontualidade_pct ?? 0), pagoEm, fatura.vencimento);
  if (pont > 0) {
    itensExtras.push({ descricao: `Desconto de pontualidade (${Number(contrato.desconto_pontualidade_pct)}%)`, tipo: "desconto", valor: -pont, destino: "proprietario" });
    return { diasAtraso: 0, multa: 0, juros: 0, total: base - pont, itensExtras, sugestao };
  }
  if (atraso.multa > 0)
    itensExtras.push({ descricao: `Multa por atraso (${contrato.multa_atraso_pct}%)`, tipo: "multa", valor: atraso.multa, destino });
  if (atraso.juros > 0)
    itensExtras.push({
      descricao: `Juros de mora (${atraso.diasAtraso} dias)`,
      tipo: "juros",
      valor: atraso.juros,
      destino,
    });
  return { diasAtraso: atraso.diasAtraso, multa: atraso.multa, juros: atraso.juros, total: atraso.total, itensExtras, sugestao };
}

/** Para quem vão multa e juros: proprietário (se o contrato repassa) ou imobiliária. */
export function destinoEncargos(contrato: Pick<Contrato, "repassar_multa_juros" | "tipo_repasse">): "proprietario" | "imobiliaria" {
  return contrato.repassar_multa_juros && contrato.tipo_repasse !== "garantido" ? "proprietario" : "imobiliaria";
}

/** Dados que a função do banco `liquidar_fatura` recebe para quitar uma fatura. */
export interface Liquidacao {
  fatura_id: string;
  p: {
    pago_em: string;
    valor_pago: number;
    forma_pagamento: string;
    itens_extras: (Omit<ItemFatura, "valor"> & { valor: number })[];
    repasses: ReturnType<typeof repassesParaJson>;
    receita_imobiliaria: number;
  };
}

/**
 * Prepara a quitação de uma fatura: itens extras (multa, juros, descontos da
 * baixa), repasse aos proprietários e taxa da imobiliária — tudo calculado
 * sobre a fatura inteira, só no momento em que o saldo zera.
 */
export async function prepararLiquidacao(
  sb: SupabaseClient,
  c: ContratoCompleto,
  fatura: Fatura,
  itens: FaturaItem[],
  extras: ItemFatura[],
  opcoes: { pagoEm: string; formaPagamento: string; valorPago: number },
): Promise<Liquidacao> {
  validarProprietarios(c);
  const todos: ItemFatura[] = [
    ...itens.map((i) => ({ descricao: i.descricao, tipo: i.tipo as ItemFatura["tipo"], valor: paraCentavos(i.valor), destino: i.destino })),
    ...extras,
  ];
  const garantido = c.contrato.tipo_repasse === "garantido";
  const primeira = await ehPrimeiraFatura(sb, c.contrato.id, fatura.competencia, fatura.id);
  const calculo = aplicarIrrfIndividual(
    calcularRepasse(todos, {
      taxaAdministracaoPct: Number(c.contrato.taxa_administracao_pct),
      taxaIntermediacaoPct: Number(c.contrato.taxa_intermediacao_pct),
      primeiraFatura: primeira,
      valorAluguelContrato: paraCentavos(c.contrato.valor_aluguel),
      repassarMultaJuros: c.contrato.repassar_multa_juros && !garantido,
      proprietarios: proprietariosDo(c),
    }),
    Object.fromEntries(Object.entries(fatura.irrf_por_proprietario ?? {}).map(([k, v]) => [k, Number(v)])),
  );
  return {
    fatura_id: fatura.id,
    p: {
      pago_em: opcoes.pagoEm,
      valor_pago: opcoes.valorPago,
      forma_pagamento: opcoes.formaPagamento,
      itens_extras: extras.map((i) => ({ ...i, valor: paraReais(i.valor) })),
      // Imóveis pessoais: sem repasse nem taxa. O dinheiro já entrou no
      // Financeiro a cada recebimento (um lançamento por recebimento, gravado
      // pelo banco em registrar_recebimento).
      repasses: garantido || c.pessoal ? [] : repassesParaJson(calculo.repasses, somarDias(opcoes.pagoEm, c.contrato.dias_repasse)),
      receita_imobiliaria: c.pessoal ? 0 : paraReais(calculo.receitaImobiliaria),
    },
  };
}

/** Calcula o reajuste do contrato com base nos índices cadastrados. */
export async function calcularReajusteDoContrato(
  sb: SupabaseClient,
  contrato: Contrato,
  dataReajuste: string,
): Promise<ResultadoReajuste> {
  const indices = verificar(
    await sb.from("indices_economicos").select("competencia, variacao_pct").eq("indice", contrato.indice_reajuste),
  ) as { competencia: string; variacao_pct: number | string }[];
  return calcularReajuste({
    valorAtual: paraCentavos(contrato.valor_aluguel),
    dataReajuste,
    periodicidadeMeses: contrato.periodicidade_reajuste_meses,
    variacoes: indices.map((i) => ({ competencia: i.competencia, variacaoPct: Number(i.variacao_pct) })),
  });
}
