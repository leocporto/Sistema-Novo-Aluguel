import "server-only";
import { todas } from "../financeiro/dados";
import {
  RELATORIOS_PADRAO,
  ROTULO_ORIGEM,
  diasDoIntervalo,
  ehRelatorioPadrao,
  inadimplenciaPorVencimento,
  lerPeriodo,
  receitaImobiliaria,
  rendimentoAnual,
  resultadoFinanceiro,
  rotuloMesCurto,
  saldoPrevisto,
  somarFinanceiro,
  tabelaDoResultado,
  taxa,
  type Celula,
  type DefinicaoRelatorio,
  type Intervalo,
  type RelatorioPadrao,
  type TabelaRelatorio,
} from "@/lib/dominio/bi";
import { diasEntre, formatarDataBR } from "@/lib/dominio/datas";
import { agruparProdutividade, formatarDuracao, tempoMedioResposta, type Agrupamento } from "@/lib/dominio/equipe";
import { ErroValidacao } from "@/lib/form";
import {
  carregarCanais,
  carregarEquipe,
  carregarFiliais,
  carregarFinanceiro,
  carregarPrevisao,
  carregarProcura,
  carregarRentabilidade,
  carregarSalvo,
  carregarSemVisitas,
  carregarVagos,
  executarPersonalizado,
  type Supabase,
} from "./dados";
import { calcularIndicadores } from "./indicadores";

export type ChaveRelatorio = RelatorioPadrao | "visao_geral";
export const ehChaveRelatorio = (v: unknown): v is ChaveRelatorio => v === "visao_geral" || ehRelatorioPadrao(v);

export const TITULO_RELATORIO: Record<ChaveRelatorio, string> = {
  visao_geral: "Visão geral",
  ...(Object.fromEntries(Object.entries(RELATORIOS_PADRAO).map(([k, v]) => [k, v.rotulo])) as Record<RelatorioPadrao, string>),
};

export type OpcoesRelatorio = {
  periodo: Intervalo;
  anterior: Intervalo;
  imob: boolean;
  hoje: string;
  por?: "imovel" | "contrato";
  meses?: number;
  agrupar?: Agrupamento;
};

const LIMITE_EXPORTACAO = 5000;

/**
 * Monta um relatório padrão como tabela (mesma tabela para CSV, Excel,
 * impressão e envio programado). Indicadores da imobiliária no modo pessoal
 * são recusados aqui e no banco.
 */
export async function montarRelatorio(supabase: Supabase, chave: ChaveRelatorio, op: OpcoesRelatorio): Promise<TabelaRelatorio> {
  if (chave !== "visao_geral" && RELATORIOS_PADRAO[chave].soImobiliaria && !op.imob) throw new ErroValidacao("Este relatório só existe no modo imobiliária.");
  const { periodo: p } = op;
  const sub = `Período: ${p.rotulo}`;
  const titulo = TITULO_RELATORIO[chave];

  switch (chave) {
    case "visao_geral": {
      const ind = await calcularIndicadores(supabase, p, op.anterior, op.imob);
      return {
        titulo,
        subtitulo: `${sub} · comparado com ${op.anterior.rotulo}`,
        colunas: [
          { rotulo: "Indicador", tipo: "texto" },
          { rotulo: "No período", tipo: "numero" },
          { rotulo: "Período anterior", tipo: "numero" },
          { rotulo: "Variação (%)", tipo: "pct" },
          { rotulo: "Como é calculado", tipo: "texto" },
        ],
        linhas: ind.map((i) => [
          `${i.rotulo}${i.tipo === "pct" ? " (%)" : i.tipo === "dias" ? " (dias)" : i.tipo === "dinheiro" ? " (R$)" : ""}`,
          i.valor,
          i.anterior,
          i.tipo === "pct" ? null : i.variacao,
          i.explicacao,
        ]),
      };
    }
    case "financeiro_mensal": {
      const linhas = await carregarFinanceiro(supabase, p.inicio, p.fim);
      const t = somarFinanceiro(linhas);
      const pessoal = !op.imob;
      const colunas: TabelaRelatorio["colunas"] = pessoal
        ? [
            { rotulo: "Mês", tipo: "texto" },
            { rotulo: "Aluguéis recebidos", tipo: "dinheiro" },
            { rotulo: "Aluguéis faturados", tipo: "dinheiro" },
            { rotulo: "Outras receitas", tipo: "dinheiro" },
            { rotulo: "Despesas", tipo: "dinheiro" },
            { rotulo: "Resultado", tipo: "dinheiro" },
            { rotulo: "Inadimplência (%)", tipo: "pct" },
          ]
        : [
            { rotulo: "Mês", tipo: "texto" },
            { rotulo: "Aluguéis recebidos", tipo: "dinheiro" },
            { rotulo: "Aluguéis faturados", tipo: "dinheiro" },
            { rotulo: "Administração", tipo: "dinheiro" },
            { rotulo: "Intermediação", tipo: "dinheiro" },
            { rotulo: "Comissão de vendas", tipo: "dinheiro" },
            { rotulo: "Outras receitas", tipo: "dinheiro" },
            { rotulo: "Despesas", tipo: "dinheiro" },
            { rotulo: "Resultado", tipo: "dinheiro" },
            { rotulo: "Repasses pagos", tipo: "dinheiro" },
            { rotulo: "Inadimplência (%)", tipo: "pct" },
          ];
      const linha = (rot: string, l: ReturnType<typeof somarFinanceiro>): Celula[] =>
        pessoal
          ? [rot, l.aluguel_recebido, l.faturado, l.outras_receitas, l.despesas, resultadoFinanceiro(l, true), inadimplenciaPorVencimento(l).pct]
          : [
              rot,
              l.aluguel_recebido,
              l.faturado,
              l.taxa_administracao,
              l.taxa_intermediacao,
              l.comissao_vendas,
              l.outras_receitas,
              l.despesas,
              resultadoFinanceiro(l, false),
              l.repasses_pagos,
              inadimplenciaPorVencimento(l).pct,
            ];
      return {
        titulo,
        subtitulo: sub,
        colunas,
        linhas: linhas.map((l) => linha(rotuloMesCurto(l.mes), l)),
        totais: linha("Total", t),
        rodape: pessoal
          ? "Resultado = aluguéis recebidos + outras receitas − despesas. Inadimplência = valor vencido no mês e ainda não pago ÷ valor que venceu."
          : `Receita da imobiliária no período: ${receitaImobiliaria(t).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}. Resultado = administração + intermediação + comissão de vendas + outras receitas − despesas do escritório (as do proprietário — de terceiros ou descontadas no repasse — ficam fora). Inadimplência = valor vencido no mês e ainda não pago ÷ valor que venceu.`,
      };
    }
    case "inadimplencia": {
      type F = {
        numero: number;
        competencia: string;
        vencimento: string;
        valor_total: number;
        valor_abatido: number;
        status: string;
        contrato: { numero: number; imovel: { codigo: string } | null; contrato_partes: { papel: string; pessoa: { nome: string; telefone: string | null } | null }[] } | null;
      };
      const lista = await todas<F>(() =>
        supabase
          .from("faturas")
          .select("numero, competencia, vencimento, valor_total, valor_abatido, status, contrato:contratos(numero, imovel:imoveis(codigo), contrato_partes(papel, pessoa:pessoas(nome, telefone)))")
          .in("status", ["aberta", "renegociada"])
          .lt("vencimento", op.hoje)
          .order("vencimento")
          .order("id"),
        LIMITE_EXPORTACAO,
      );
      const linhas = lista.map((f): Celula[] => {
        const loc = f.contrato?.contrato_partes.find((x) => x.papel === "locatario")?.pessoa;
        return [
          f.numero,
          f.contrato?.numero ?? null,
          f.contrato?.imovel?.codigo ?? null,
          loc?.nome ?? null,
          loc?.telefone ?? null,
          f.competencia,
          f.vencimento,
          diasEntre(f.vencimento, op.hoje),
          Number(f.valor_total),
          Math.max(0, Number(f.valor_total) - Number(f.valor_abatido)),
          f.status === "renegociada" ? "em acordo" : Number(f.valor_abatido) > 0 ? "parcial" : "em aberto",
        ];
      });
      return {
        titulo,
        subtitulo: `Posição de ${formatarDataBR(op.hoje)} (todas as cobranças vencidas e não pagas)`,
        colunas: [
          { rotulo: "Fatura", tipo: "inteiro" },
          { rotulo: "Contrato", tipo: "inteiro" },
          { rotulo: "Imóvel", tipo: "texto" },
          { rotulo: "Locatário", tipo: "texto" },
          { rotulo: "Telefone", tipo: "texto" },
          { rotulo: "Competência", tipo: "data" },
          { rotulo: "Vencimento", tipo: "data" },
          { rotulo: "Dias de atraso", tipo: "inteiro" },
          { rotulo: "Valor", tipo: "dinheiro" },
          { rotulo: "Saldo", tipo: "dinheiro" },
          { rotulo: "Situação", tipo: "texto" },
        ],
        linhas,
        totais: ["Total", null, null, `${linhas.length} cobrança(s)`, null, null, null, null, soma(linhas, 8), soma(linhas, 9), null],
      };
    }
    case "rentabilidade": {
      const por = op.por ?? "imovel";
      const { lista, total } = await carregarRentabilidade(supabase, p.inicio, p.fim, por, LIMITE_EXPORTACAO);
      const dias = diasDoIntervalo(p);
      const colunas: TabelaRelatorio["colunas"] = [
        { rotulo: por === "imovel" ? "Imóvel" : "Contrato", tipo: "texto" },
        { rotulo: por === "imovel" ? "Descrição" : "Locatário", tipo: "texto" },
        { rotulo: "Receitas", tipo: "dinheiro" },
        ...(op.imob ? [{ rotulo: "Taxas da imobiliária", tipo: "dinheiro" as const }] : []),
        { rotulo: "Despesas", tipo: "dinheiro" },
        { rotulo: "Resultado", tipo: "dinheiro" },
        { rotulo: "Valor do imóvel", tipo: "dinheiro" },
        { rotulo: "Rendimento ao ano (%)", tipo: "pct" },
      ];
      const linhas = lista.map((r): Celula[] => [
        r.codigo,
        r.descricao,
        r.receitas,
        ...(op.imob ? [r.taxas] : []),
        r.despesas,
        r.resultado,
        r.valor_referencia,
        rendimentoAnual(r.resultado, r.valor_referencia, dias),
      ]);
      return {
        titulo: por === "imovel" ? titulo : "Rentabilidade por contrato",
        subtitulo: sub,
        colunas,
        linhas,
        rodape: `${total > linhas.length ? `Mostrando ${linhas.length} de ${total} ${por === "imovel" ? "imóveis" : "contratos"} (os de maior resultado). ` : ""}Resultado = receitas (aluguel recebido e outras receitas do imóvel)${op.imob ? " − taxas da imobiliária" : ""} − despesas do imóvel${op.imob ? " (as do proprietário: de terceiros ou descontadas no repasse)" : ""}. Rendimento ao ano = resultado ÷ valor de venda (ou avaliação) do imóvel, levado a 12 meses.`,
      };
    }
    case "imoveis_vagos": {
      const { lista } = await carregarVagos(supabase, 500);
      return {
        titulo,
        subtitulo: `Posição de ${formatarDataBR(op.hoje)}`,
        colunas: [
          { rotulo: "Imóvel", tipo: "texto" },
          { rotulo: "Título", tipo: "texto" },
          { rotulo: "Bairro", tipo: "texto" },
          { rotulo: "Aluguel", tipo: "dinheiro" },
          { rotulo: "Vago desde", tipo: "data" },
          { rotulo: "Dias vago", tipo: "inteiro" },
          { rotulo: "Já foi alugado", tipo: "texto" },
          { rotulo: "Próximo contrato começa", tipo: "data" },
        ],
        linhas: lista.map((v) => [v.codigo, v.titulo, v.bairro, v.valor_aluguel, v.vago_desde, v.dias, v.ja_alugado ? "sim" : "não", v.proximo_inicio]),
      };
    }
    case "imoveis_sem_visitas": {
      const { lista } = await carregarSemVisitas(supabase, p.inicio, p.fim, 500);
      return {
        titulo,
        subtitulo: `${sub} · imóveis disponíveis sem nenhuma visita no período`,
        colunas: [
          { rotulo: "Imóvel", tipo: "texto" },
          { rotulo: "Título", tipo: "texto" },
          { rotulo: "Finalidade", tipo: "texto" },
          { rotulo: "Bairro", tipo: "texto" },
          { rotulo: "Captado em", tipo: "data" },
          { rotulo: "Última visita", tipo: "data" },
        ],
        linhas: lista.map((v) => [v.codigo, v.titulo, v.finalidades, v.bairro, v.captado_em, v.ultima_visita]),
      };
    }
    case "imoveis_procura": {
      const { lista } = await carregarProcura(supabase, p.inicio, p.fim, 500);
      return {
        titulo,
        subtitulo: sub,
        colunas: [
          { rotulo: "Imóvel", tipo: "texto" },
          { rotulo: "Título", tipo: "texto" },
          { rotulo: "Situação", tipo: "texto" },
          { rotulo: "Leads", tipo: "inteiro" },
          { rotulo: "Visitas", tipo: "inteiro" },
          { rotulo: "Propostas", tipo: "inteiro" },
          { rotulo: "Contatos pelo site", tipo: "inteiro" },
          { rotulo: "Total", tipo: "inteiro" },
        ],
        linhas: lista.map((v) => [v.codigo, v.titulo, v.status, v.leads, v.visitas, v.propostas, v.contatos_site, v.pontos]),
        rodape: "Procura = leads ligados ao imóvel + visitas (não canceladas) + propostas + contatos pelo site no período.",
      };
    }
    case "leads_canais": {
      const lista = await carregarCanais(supabase, p.inicio, p.fim);
      const linhas = lista.map((c): Celula[] => [
        ROTULO_ORIGEM[c.origem] ?? c.origem,
        c.leads,
        c.atendidos,
        c.com_visita,
        c.com_proposta,
        c.fechados,
        taxa(c.fechados, c.leads),
        c.perdidos,
      ]);
      const s = (k: "leads" | "atendidos" | "com_visita" | "com_proposta" | "fechados" | "perdidos") => lista.reduce((a, c) => a + c[k], 0);
      return {
        titulo,
        subtitulo: sub,
        colunas: [
          { rotulo: "Canal", tipo: "texto" },
          { rotulo: "Leads", tipo: "inteiro" },
          { rotulo: "Atendidos", tipo: "inteiro" },
          { rotulo: "Visitaram", tipo: "inteiro" },
          { rotulo: "Fizeram proposta", tipo: "inteiro" },
          { rotulo: "Fecharam", tipo: "inteiro" },
          { rotulo: "Conversão (%)", tipo: "pct" },
          { rotulo: "Perdidos", tipo: "inteiro" },
        ],
        linhas,
        totais: ["Total", s("leads"), s("atendidos"), s("com_visita"), s("com_proposta"), s("fechados"), taxa(s("fechados"), s("leads")), s("perdidos")],
        rodape: "Leads que chegaram no período e até onde foram (visita realizada, proposta feita, negócio fechado).",
      };
    }
    case "equipe": {
      const por = op.agrupar ?? "pessoa";
      const linhasEq = await carregarEquipe(supabase, p.inicio, p.fim);
      const [{ data: equipes }, { data: filiais }] = await Promise.all([supabase.from("equipes").select("id, nome"), supabase.from("filiais").select("id, nome")]);
      const grupos = agruparProdutividade(linhasEq, por, {
        equipes: new Map((equipes ?? []).map((e) => [e.id as string, e.nome as string])),
        filiais: new Map((filiais ?? []).map((f) => [f.id as string, f.nome as string])),
      });
      const comissaoDe = (chaveGrupo: string) =>
        linhasEq
          .filter((l) => (por === "pessoa" ? l.pessoa_id : por === "equipe" ? (l.equipe_id ?? "") : (l.filial_id ?? "")) === chaveGrupo)
          .reduce((s, l) => s + l.comissoes, 0);
      return {
        titulo,
        subtitulo: sub,
        colunas: [
          { rotulo: por === "pessoa" ? "Corretor / colaborador" : por === "equipe" ? "Equipe" : "Filial", tipo: "texto" },
          { rotulo: "Leads recebidos", tipo: "inteiro" },
          { rotulo: "Leads atendidos", tipo: "inteiro" },
          { rotulo: "1º atendimento (média)", tipo: "texto" },
          { rotulo: "Visitas", tipo: "inteiro" },
          { rotulo: "Propostas", tipo: "inteiro" },
          { rotulo: "Propostas fechadas", tipo: "inteiro" },
          { rotulo: "Locações", tipo: "inteiro" },
          { rotulo: "Vendas", tipo: "inteiro" },
          { rotulo: "Valor vendido", tipo: "dinheiro" },
          { rotulo: "Captações", tipo: "inteiro" },
          { rotulo: "Comissões geradas", tipo: "dinheiro" },
        ],
        linhas: grupos.map((g) => [
          g.nome,
          g.totais.leads_recebidos,
          g.totais.leads_atendidos,
          formatarDuracao(tempoMedioResposta(g.totais)),
          g.totais.visitas,
          g.totais.propostas,
          g.totais.propostas_aceitas,
          g.totais.locacoes,
          g.totais.vendas,
          g.totais.valor_vendas,
          g.totais.captacoes,
          comissaoDe(g.chave),
        ]),
      };
    }
    case "filiais": {
      const lista = await carregarFiliais(supabase, p.inicio, p.fim);
      return {
        titulo,
        subtitulo: sub,
        colunas: [
          { rotulo: "Filial", tipo: "texto" },
          { rotulo: "Imóveis", tipo: "inteiro" },
          { rotulo: "Contratos ativos", tipo: "inteiro" },
          { rotulo: "Aluguel da carteira", tipo: "dinheiro" },
          { rotulo: "Administração", tipo: "dinheiro" },
          { rotulo: "Intermediação", tipo: "dinheiro" },
          { rotulo: "Leads", tipo: "inteiro" },
          { rotulo: "Vendas", tipo: "inteiro" },
          { rotulo: "Valor vendido", tipo: "dinheiro" },
          { rotulo: "Comissão de vendas", tipo: "dinheiro" },
        ],
        linhas: lista.map((f) => [f.nome, f.imoveis, f.contratos_ativos, f.carteira_aluguel, f.receita_administracao, f.receita_intermediacao, f.leads, f.vendas, f.valor_vendas, f.comissao_vendas]),
      };
    }
    case "previsao": {
      const meses = op.meses ?? 6;
      const lista = await carregarPrevisao(supabase, meses);
      const colunas: TabelaRelatorio["colunas"] = [
        { rotulo: "Mês", tipo: "texto" },
        { rotulo: "Cobranças em aberto", tipo: "dinheiro" },
        { rotulo: "Aluguéis previstos", tipo: "dinheiro" },
        { rotulo: "Reajuste previsto (incluso)", tipo: "dinheiro" },
        { rotulo: "Outras receitas", tipo: "dinheiro" },
        { rotulo: "Despesas", tipo: "dinheiro" },
        ...(op.imob
          ? [
              { rotulo: "Repasses agendados", tipo: "dinheiro" as const },
              { rotulo: "Repasses estimados", tipo: "dinheiro" as const },
              { rotulo: "Taxa de administração prevista", tipo: "dinheiro" as const },
            ]
          : []),
        { rotulo: "Saldo previsto", tipo: "dinheiro" },
      ];
      return {
        titulo,
        subtitulo: `Próximos ${meses} meses a partir de ${formatarDataBR(op.hoje)}`,
        colunas,
        linhas: lista.map((l) => [
          l.atrasado ? "Em atraso (já venceu)" : rotuloMesCurto(l.mes),
          l.faturas_em_aberto,
          l.alugueis_previstos,
          l.reajuste_previsto,
          l.outras_receitas,
          l.despesas,
          ...(op.imob ? [l.repasses_agendados, l.repasses_estimados, l.taxa_adm_prevista] : []),
          saldoPrevisto(l, !op.imob),
        ]),
        rodape:
          "Aluguéis previstos: contratos ativos cuja cobrança do mês ainda não foi gerada, com o reajuste estimado pelo índice do contrato nos últimos 12 meses. Repasses estimados = aluguel menos a taxa de administração (sem IRRF e despesas).",
      };
    }
  }
  throw new ErroValidacao("Relatório desconhecido.");
}

function soma(linhas: Celula[][], i: number): number {
  return Math.round(linhas.reduce((s, l) => s + (Number(l[i]) || 0), 0) * 100) / 100;
}

const um = (v: string | string[] | undefined) => (typeof v === "string" ? v : Array.isArray(v) ? v[0] : undefined);

/**
 * Relatório pedido pela URL (exportar CSV/Excel e imprimir): ?r=<chave> com o
 * período (p, ref, de, ate) e as opções de cada um (rent, meses, por), ou
 * ?r=personalizado&id=<relatório salvo>.
 */
export async function relatorioDaUrl(supabase: Supabase, sp: Record<string, string | string[] | undefined>, ctx: { imob: boolean; hoje: string }): Promise<TabelaRelatorio> {
  const r = um(sp.r);
  if (r === "personalizado") return montarPersonalizado(supabase, um(sp.id) ?? "");
  if (!ehChaveRelatorio(r)) throw new ErroValidacao("Relatório desconhecido.");
  const periodo = lerPeriodo(sp, ctx.hoje);
  const meses = Number(um(sp.meses));
  const por = um(sp.por);
  return montarRelatorio(supabase, r, {
    periodo,
    anterior: periodo.anterior,
    imob: ctx.imob,
    hoje: ctx.hoje,
    por: um(sp.rent) === "contrato" ? "contrato" : "imovel",
    meses: [3, 6, 12].includes(meses) ? meses : 6,
    agrupar: por === "equipe" || por === "filial" ? por : "pessoa",
  });
}

/** Relatório personalizado salvo, como tabela (até 5.000 linhas). */
export async function montarPersonalizado(supabase: Supabase, id: string): Promise<TabelaRelatorio> {
  const r = await carregarSalvo(supabase, id);
  if (!r) throw new ErroValidacao("Relatório não encontrado.");
  const def: DefinicaoRelatorio = r;
  const res = await executarPersonalizado(supabase, def, Math.min(r.limite || LIMITE_EXPORTACAO, LIMITE_EXPORTACAO));
  if (!res.ok) throw new ErroValidacao(res.erro);
  const t = tabelaDoResultado(def, res.resultado, r.nome, r.descricao ?? undefined);
  return { ...t, rodape: t.total > t.linhas.length ? `Mostrando ${t.linhas.length} de ${t.total} linhas (limite do relatório).` : undefined };
}
