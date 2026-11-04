/**
 * Relatórios e BI no banco (PGlite com todas as migrações): indicadores
 * agregados (financeiro mês a mês, inadimplência, ocupação, vacância, tempos
 * para alugar e vender, procura, sem visitas, funil e canais, equipe e
 * filiais, rentabilidade, previsão com reajuste), escopo do corretor, modo
 * pessoal, relatórios personalizados (lista fechada, sem SQL do usuário),
 * envios programados (permissão, destinatários, próxima execução, "pegar"
 * os vencidos de forma atômica), execuções só acréscimo, arquivo no Storage,
 * auditoria e isolamento entre organizações.
 */
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import {
  DIAS_GUARDA_ARQUIVOS,
  FONTES_BI,
  OPERADORES_POR_TIPO,
  fontesPermitidas,
  acumuladoIndices,
  permissoesBi,
  proximaExecucao,
  reajustesAte,
  validarDefinicao,
  valorReajustado,
  type DefinicaoRelatorio,
} from "@/lib/dominio/bi";
import { fimDoMes, hojeISO, somarMeses } from "@/lib/dominio/datas";
import { MODULOS } from "@/lib/dominio/equipe";
import { comoAnonimo, comoUsuario, criarBanco } from "./pglite";

const ADMIN = "00000000-0000-0000-0000-000000020a01";
const GESTOR = "00000000-0000-0000-0000-000000020a02";
const CORRETOR = "00000000-0000-0000-0000-000000020a03";
const FINANCEIRO = "00000000-0000-0000-0000-000000020a04";
/** Perfil com Relatórios, Imóveis e Configurações (edita personalizados), mas sem Financeiro nem Comercial. */
const RESTRITO = "00000000-0000-0000-0000-000000020a05";
/** Perfil só com Relatórios: vê e roda os envios, mas não programa nem edita. */
const LEITOR = "00000000-0000-0000-0000-000000020a06";
const OUTRO = "00000000-0000-0000-0000-000000020b01";
const PESSOAL = "00000000-0000-0000-0000-000000020c01";

let db: PGlite;
let org: string;
let orgB: string;
let orgP: string;
const id: Record<string, string> = {};

/** Fim do contrato A2: último dia do mês, 30 meses depois de hoje. */
const FIM_A2 = fimDoMes(somarMeses(hojeISO(), 30));

const um = async <T = Record<string, unknown>>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows[0];
const todos = async <T = Record<string, unknown>>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows;
const n = (v: unknown) => Number(v);

async function erroDe(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "";
  } catch (e) {
    return String(e);
  }
}

async function novaFatura(contrato: string, comp: string, venc: string, valor: number) {
  return (
    await um<{ id: string }>(`select public.registrar_fatura($1::jsonb) as id`, [
      JSON.stringify({
        contrato_id: contrato,
        competencia: comp,
        periodo_inicio: comp,
        periodo_fim: comp.slice(0, 8) + "28",
        vencimento: venc,
        valor_total: valor,
        itens: [{ descricao: `Aluguel ${comp}`, tipo: "aluguel", valor, destino: "proprietario" }],
      }),
    ])
  ).id;
}

beforeAll(async () => {
  db = await criarBanco();
  org = await comoUsuario(db, ADMIN, async () => (await um<{ id: string }>(`select public.criar_organizacao('Imob BI') as id`)).id);
  await db.query(
    `insert into membros (organizacao_id, user_id, papel) values ($1, $2, 'gestor'), ($1, $3, 'corretor'), ($1, $4, 'financeiro'), ($1, $5, 'financeiro'), ($1, $6, 'financeiro')`,
    [org, GESTOR, CORRETOR, FINANCEIRO, RESTRITO, LEITOR],
  );
  orgB = await comoUsuario(db, OUTRO, async () => (await um<{ id: string }>(`select public.criar_organizacao('Outra Imob') as id`)).id);
  orgP = await comoUsuario(db, PESSOAL, async () => (await um<{ id: string }>(`select public.criar_organizacao('Meus Imóveis') as id`)).id);
  await comoUsuario(db, PESSOAL, () => db.query(`update organizacoes set modo = 'pessoal' where id = $1`, [orgP]));

  await comoUsuario(db, ADMIN, async () => {
    const q1 = async (sql: string, p: unknown[] = []) => (await um<{ id: string }>(sql, p)).id;
    id.prop = await q1(`insert into pessoas (nome, papeis) values ('Paula Proprietária','{proprietario}') returning id`);
    id.loc = await q1(`insert into pessoas (nome, papeis, telefone) values ('Luís Locatário','{locatario}','51999990000') returning id`);
    id.cor = await q1(`insert into pessoas (nome, papeis) values ('Carla Corretora','{corretor}') returning id`);
    id.A = await q1(`insert into imoveis (codigo, finalidades, status, captado_em, valor_aluguel, valor_venda) values ('A-1','{locacao}','alugado','2026-01-01', 2000, 400000) returning id`);
    id.B = await q1(`insert into imoveis (codigo, finalidades, status, captado_em, valor_aluguel) values ('B-2','{locacao}','disponivel','2026-03-01', 1500) returning id`);
    id.C = await q1(`insert into imoveis (codigo, finalidades, status, captado_em, valor_venda) values ('C-3','{venda}','vendido','2026-02-01', 500000) returning id`);
    // A1 (encerrado) jan–mar; A2 (ativo) desde maio: abril vago (30 dias).
    // A2 termina 30 meses depois de hoje (data relativa: o teste da previsão não vence com o tempo).
    id.A1 = await q1(
      `insert into contratos (imovel_id, status, data_inicio, prazo_meses, data_fim, valor_aluguel, dia_vencimento, data_base_reajuste)
       values ($1, 'encerrado', '2026-01-01', 3, '2026-03-31', 1800, 10, '2026-01-01') returning id`,
      [id.A],
    );
    id.A2 = await q1(
      `insert into contratos (imovel_id, status, data_inicio, prazo_meses, data_fim, valor_aluguel, dia_vencimento, data_base_reajuste)
       values ($1, 'ativo', '2026-05-01', 30, $2, 2000, 10, '2026-05-01') returning id`,
      [id.A, FIM_A2],
    );
    await db.query(`insert into contrato_partes (contrato_id, pessoa_id, papel, percentual) values ($1,$2,'proprietario',100), ($1,$3,'locatario',null)`, [id.A2, id.prop, id.loc]);
    await db.query(`insert into imovel_proprietarios (imovel_id, pessoa_id, percentual) values ($1, $2, 100)`, [id.A, id.prop]);

    id.F5 = await novaFatura(id.A2, "2026-05-01", "2026-05-10", 2000);
    id.F6 = await novaFatura(id.A2, "2026-06-01", "2026-06-10", 2000);
    // Maio pago inteiro (com repasse e taxa de 10%); junho só R$ 500 (parcial, vencido).
    await db.query(`select public.registrar_recebimento($1::jsonb)`, [
      JSON.stringify({
        pagamentos: [{ fatura_id: id.F5, pago_em: "2026-05-12", valor: 2000, principal: 2000, forma: "pix" }],
        liquidacoes: [
          {
            fatura_id: id.F5,
            p: {
              pago_em: "2026-05-12",
              valor_pago: 2000,
              forma_pagamento: "pix",
              receita_imobiliaria: 200,
              repasses: [
                { pessoa_id: id.prop, percentual: 100, aluguel: 2000, encargos: 0, multa_juros: 0, valor_bruto: 2000, taxa_administracao: 200, taxa_intermediacao: 0, irrf: 0, valor_liquido: 1800, previsto_para: "2026-05-15" },
              ],
            },
          },
        ],
      }),
    ]);
    await db.query(`select public.registrar_recebimento($1::jsonb)`, [JSON.stringify({ pagamentos: [{ fatura_id: id.F6, pago_em: "2026-06-15", valor: 500, principal: 500 }] })]);
    await db.query(`update repasses set status = 'pago', pago_em = '2026-05-20' where fatura_id = $1`, [id.F5]);

    // Financeiro: receita avulsa, despesa do escritório, despesa de terceiros e do proprietário (imóvel A).
    await db.query(
      `insert into lancamentos (tipo, descricao, valor, vencimento, status, liquidado_em, imovel_id, terceiros, descontar_repasse) values
        ('receber', 'Taxa de vistoria', 150, '2026-06-20', 'liquidado', '2026-06-20', null, false, false),
        ('pagar', 'Aluguel do escritório', 300, '2026-06-05', 'liquidado', '2026-06-05', null, false, false),
        ('pagar', 'Condomínio pago pelo proprietário', 1000, '2026-06-08', 'liquidado', '2026-06-08', $1, true, false),
        ('pagar', 'Conserto (desconta do repasse)', 100, '2026-06-09', 'liquidado', '2026-06-09', $1, false, true)`,
      [id.A],
    );
    // Venda de C concluída em junho (6% de R$ 500 mil = R$ 30 mil).
    await db.query(`insert into vendas (imovel_id, status, valor, comissao_pct, concluida_em) values ($1, 'concluida', 500000, 6, '2026-06-20')`, [id.C]);

    // Comercial (maio): L1 site (da corretora, imóvel B, visitou); L2 site (imóvel A, proposta aceita); L3 WhatsApp perdido; L4 fora do período.
    id.L1 = await q1(`insert into leads (nome, origem, corretor_id, imovel_id, created_at) values ('Lia', 'site', $1, $2, '2026-05-02T12:00:00-03:00') returning id`, [id.cor, id.B]);
    id.L2 = await q1(`insert into leads (nome, origem, imovel_id, created_at) values ('Leo', 'site', $1, '2026-05-03T12:00:00-03:00') returning id`, [id.A]);
    await db.query(`insert into leads (nome, origem, status, created_at) values ('Lu', 'whatsapp', 'perdido', '2026-05-04T12:00:00-03:00')`);
    await db.query(`insert into leads (nome, origem, created_at) values ('Lara', 'portal', '2026-04-15T12:00:00-03:00')`);
    await db.query(`insert into visitas (lead_id, imovel_id, corretor_id, data_hora, status, tipo) values ($1, $2, $3, '2026-05-10T10:00:00-03:00', 'realizada', 'visita')`, [id.L1, id.A, id.cor]);
    await db.query(`insert into visitas (imovel_id, data_hora, status, tipo) values ($1, '2026-05-11T10:00:00-03:00', 'cancelada', 'visita')`, [id.B]);
    await db.query(
      `insert into propostas (lead_id, imovel_id, tipo, valor, status, fechada_em, created_at) values ($1, $2, 'locacao', 2000, 'aceita', '2026-05-20', '2026-05-15T12:00:00-03:00')`,
      [id.L2, id.A],
    );

    // Índice IGPM: 12 meses de 1% (acumulado ~12,68%).
    for (let i = 1; i <= 12; i++) {
      await db.query(`insert into indices_economicos (indice, competencia, variacao_pct) values ('IGPM', $1, 1)`, [somarMeses("2026-01-01", -i)]);
    }
  });
  // Contato pelo site (gravado pela RPC pública no sistema; aqui direto, como o banco).
  await db.query(`insert into site_solicitacoes (organizacao_id, tipo, nome, imovel_id, created_at) values ($1, 'contato', 'Visitante', $2, '2026-05-05T12:00:00-03:00')`, [org, id.A]);
  // A corretora ligada ao cadastro dela; o financeiro com um perfil sem Relatórios nem Configurações.
  await db.query(`update membros set pessoa_id = $1 where organizacao_id = $2 and user_id = $3`, [id.cor, org, CORRETOR]);
  const perfil = await comoUsuario(db, ADMIN, async () =>
    (await um<{ id: string }>(`insert into perfis_acesso (nome, papel_base, permissoes) values ('Só caixa', 'financeiro', '{"painel":["ver"],"financeiro":["ver"]}') returning id`)).id,
  );
  await db.query(`update membros set perfil_id = $1 where organizacao_id = $2 and user_id = $3`, [perfil, org, FINANCEIRO]);
  const perfilRestrito = await comoUsuario(db, ADMIN, async () =>
    (
      await um<{ id: string }>(
        `insert into perfis_acesso (nome, papel_base, permissoes) values ('Relatórios sem financeiro', 'financeiro', '{"painel":["ver"],"relatorios":["ver"],"imoveis":["ver"],"configuracoes":["ver","editar"]}') returning id`,
      )
    ).id,
  );
  await db.query(`update membros set perfil_id = $1 where organizacao_id = $2 and user_id = $3`, [perfilRestrito, org, RESTRITO]);
  const perfilLeitor = await comoUsuario(db, ADMIN, async () =>
    (await um<{ id: string }>(`insert into perfis_acesso (nome, papel_base, permissoes) values ('Só relatórios', 'financeiro', '{"painel":["ver"],"relatorios":["ver"]}') returning id`)).id,
  );
  await db.query(`update membros set perfil_id = $1 where organizacao_id = $2 and user_id = $3`, [perfilLeitor, org, LEITOR]);

  // Modo pessoal: um imóvel, um contrato, aluguel de março pago e uma despesa do imóvel.
  await comoUsuario(db, PESSOAL, async () => {
    id.P1 = (await um<{ id: string }>(`insert into imoveis (codigo, finalidades, status, captado_em, valor_venda) values ('P-1','{locacao}','alugado','2026-01-01', 300000) returning id`)).id;
    id.PC = (
      await um<{ id: string }>(
        `insert into contratos (imovel_id, status, data_inicio, prazo_meses, data_fim, valor_aluguel, dia_vencimento, data_base_reajuste)
         values ($1, 'ativo', '2026-01-01', 30, '2028-06-30', 1000, 10, '2026-01-01') returning id`,
        [id.P1],
      )
    ).id;
    const f = await novaFatura(id.PC, "2026-03-01", "2026-03-10", 1000);
    await db.query(`select public.registrar_recebimento($1::jsonb)`, [JSON.stringify({ pagamentos: [{ fatura_id: f, pago_em: "2026-03-08", valor: 1000, principal: 1000 }] })]);
    await db.query(`insert into lancamentos (tipo, descricao, valor, vencimento, status, liquidado_em, imovel_id) values ('pagar', 'IPTU', 200, '2026-03-15', 'liquidado', '2026-03-15', $1)`, [id.P1]);
  });
});

describe("financeiro mês a mês e inadimplência", () => {
  it("separa aluguel recebido, faturado, taxas da imobiliária, comissão de vendas, despesas (sem terceiros) e repasses", async () => {
    const linhas = await comoUsuario(db, ADMIN, () => todos(`select * from public.bi_financeiro_mensal('2026-05-01', '2026-06-30')`));
    expect(linhas.length).toBe(2);
    const [mai, jun] = linhas;
    expect(n(mai.aluguel_recebido)).toBe(2000);
    expect(n(jun.aluguel_recebido)).toBe(500);
    expect(n(mai.faturado)).toBe(2000);
    expect(n(jun.faturado)).toBe(2000);
    expect(n(mai.taxa_administracao)).toBe(200);
    expect(n(mai.repasses_pagos)).toBe(1800);
    // A taxa lançada na baixa (com fatura) não conta de novo como "outras receitas".
    expect(n(mai.outras_receitas)).toBe(0);
    expect(n(jun.outras_receitas)).toBe(150);
    // Despesas da imobiliária = só as do escritório (300): a de terceiros (1.000) e a descontada
    // do repasse (100) são do proprietário e entram na rentabilidade do imóvel, não aqui.
    expect(n(jun.despesas)).toBe(300);
    expect(n(jun.comissao_vendas)).toBe(30000);
    // Junho venceu R$ 2.000 e ficou R$ 1.500 em aberto.
    expect(n(mai.venc_valor)).toBe(2000);
    expect(n(mai.venc_aberto)).toBe(0);
    expect(n(jun.venc_valor)).toBe(2000);
    expect(n(jun.venc_aberto)).toBe(1500);
    expect(n(jun.comp_aberto)).toBe(1500);
  });

  it("modo pessoal: o aluguel recebido conta uma vez só (o lançamento do recebimento não vira outra receita)", async () => {
    const [mar] = await comoUsuario(db, PESSOAL, () => todos(`select * from public.bi_financeiro_mensal('2026-03-01', '2026-03-31')`));
    expect(n(mar.aluguel_recebido)).toBe(1000);
    expect(n(mar.outras_receitas)).toBe(0);
    expect(n(mar.despesas)).toBe(200);
    expect(n(mar.taxa_administracao)).toBe(0);
  });

  it("período inválido, sem permissão de Relatórios e visitante anônimo são recusados", async () => {
    expect(await comoUsuario(db, ADMIN, () => erroDe(() => db.query(`select * from public.bi_financeiro_mensal('2026-06-30', '2026-05-01')`)))).toMatch(/Período inválido/);
    expect(await comoUsuario(db, FINANCEIRO, () => erroDe(() => db.query(`select * from public.bi_financeiro_mensal('2026-05-01', '2026-06-30')`)))).toMatch(/não permite ver Relatórios/);
    expect(await comoAnonimo(db, () => erroDe(() => db.query(`select * from public.bi_financeiro_mensal('2026-05-01', '2026-06-30')`)))).toMatch(/permission denied/);
  });

  it("isolamento: outra imobiliária não vê nada destes números", async () => {
    const linhas = await comoUsuario(db, OUTRO, () => todos(`select * from public.bi_financeiro_mensal('2026-05-01', '2026-06-30')`));
    expect(linhas.every((l) => n(l.aluguel_recebido) === 0 && n(l.faturado) === 0 && n(l.comissao_vendas) === 0)).toBe(true);
  });
});

describe("imóveis: ocupação, vacância, tempos, procura e sem visitas", () => {
  it("ocupação por dias, vacância entre contratos e tempo para alugar/vender", async () => {
    const o = await comoUsuario(db, ADMIN, () => um(`select * from public.bi_ocupacao('2026-01-01', '2026-06-30')`));
    expect(n(o.imoveis)).toBe(2);
    // A: 181 dias disponíveis, 90 (A1) + 61 (A2) ocupados; B: desde 01/03 = 122 dias, nenhum ocupado.
    expect(n(o.dias_disponiveis)).toBe(303);
    expect(n(o.dias_ocupados)).toBe(151);
    // Abril vago entre A1 e A2.
    expect(n(o.vacancia_soma)).toBe(30);
    expect(n(o.vacancia_qtd)).toBe(1);
    // A1: 0 dias desde a captação; A2: 30 dias desde o fim de A1.
    expect(n(o.alugar_soma)).toBe(30);
    expect(n(o.alugar_qtd)).toBe(2);
    // C: captado 01/02, vendido 20/06.
    expect(n(o.vender_soma)).toBe(139);
    expect(n(o.vender_qtd)).toBe(1);
    expect(n(o.contratos_novos)).toBe(2);
    expect(n(o.contratos_encerrados)).toBe(1);
    expect(n(o.vagos_hoje)).toBe(1);
    expect(n(o.alugados_hoje)).toBe(1);
  });

  it("vagos agora, maior procura (só imobiliária) e sem visitas no período", async () => {
    const vagos = await comoUsuario(db, ADMIN, () => todos(`select * from public.bi_imoveis_vagos(10)`));
    expect(vagos.map((v) => v.codigo)).toEqual(["B-2"]);
    expect(vagos[0].ja_alugado).toBe(false);
    const procura = await comoUsuario(db, ADMIN, () => todos(`select * from public.bi_imoveis_procura('2026-05-01', '2026-05-31', 10)`));
    expect(procura.map((p) => [p.codigo, n(p.leads), n(p.visitas), n(p.propostas), n(p.contatos_site), n(p.pontos)])).toEqual([
      ["A-1", 1, 1, 1, 1, 4],
      ["B-2", 1, 0, 0, 0, 1],
    ]);
    const sem = await comoUsuario(db, ADMIN, () => todos(`select * from public.bi_imoveis_sem_visitas('2026-05-01', '2026-05-31', 10)`));
    expect(sem.map((s) => s.codigo)).toEqual(["B-2"]);
    expect(await comoUsuario(db, PESSOAL, () => erroDe(() => db.query(`select * from public.bi_imoveis_procura('2026-05-01', '2026-05-31', 10)`)))).toMatch(/só existe no modo imobiliária/);
  });
});

describe("comercial: funil e canais (corretor vê só os dele)", () => {
  it("leads por canal com o funil acumulado", async () => {
    const canais = await comoUsuario(db, ADMIN, () => todos(`select * from public.bi_leads_canais('2026-05-01', '2026-05-31')`));
    const site = canais.find((c) => c.origem === "site")!;
    expect([n(site.leads), n(site.com_visita), n(site.com_proposta), n(site.fechados)]).toEqual([2, 2, 1, 1]);
    const zap = canais.find((c) => c.origem === "whatsapp")!;
    expect([n(zap.leads), n(zap.perdidos)]).toEqual([1, 1]);
    expect(canais.some((c) => c.origem === "portal")).toBe(false);
  });

  it("funil: coorte e atividade; corretor só os números dele; pessoal recusa", async () => {
    const f = await comoUsuario(db, ADMIN, () => um(`select * from public.bi_funil('2026-05-01', '2026-05-31')`));
    expect([n(f.leads), n(f.com_visita), n(f.com_proposta), n(f.fechados), n(f.perdidos)]).toEqual([3, 2, 1, 1, 1]);
    expect([n(f.visitas_realizadas), n(f.propostas_feitas), n(f.propostas_aceitas), n(f.contratos_locacao)]).toEqual([1, 1, 1, 1]);
    const c = await comoUsuario(db, CORRETOR, () => um(`select * from public.bi_funil('2026-05-01', '2026-05-31')`));
    expect([n(c.leads), n(c.com_visita), n(c.visitas_realizadas), n(c.propostas_feitas), n(c.contratos_locacao)]).toEqual([1, 1, 1, 0, 0]);
    expect(await comoUsuario(db, PESSOAL, () => erroDe(() => db.query(`select * from public.bi_leads_canais('2026-03-01', '2026-03-31')`)))).toMatch(/só existe no modo imobiliária/);
  });

  it("equipe: corretor vê só a linha dele; filiais não aparecem para ele", async () => {
    const todosEq = await comoUsuario(db, ADMIN, () => todos(`select * from public.bi_equipe('2026-05-01', '2026-05-31')`));
    expect(todosEq.some((l) => l.pessoa_id === id.cor)).toBe(true);
    const dele = await comoUsuario(db, CORRETOR, () => todos(`select * from public.bi_equipe('2026-05-01', '2026-05-31')`));
    expect(dele.map((l) => l.pessoa_id)).toEqual([id.cor]);
    expect(n(dele[0].visitas)).toBe(1);
    expect(await comoUsuario(db, CORRETOR, () => todos(`select * from public.bi_filiais('2026-05-01', '2026-06-30')`))).toEqual([]);
    const fil = await comoUsuario(db, ADMIN, () => todos(`select * from public.bi_filiais('2026-05-01', '2026-06-30')`));
    const sem = fil.find((x) => x.filial_id === null)!;
    expect(n(sem.receita_administracao)).toBe(200);
    expect(n(sem.comissao_vendas)).toBe(30000);
  });
});

describe("rentabilidade e previsão", () => {
  it("imobiliária: aluguel recebido − taxas − despesas do proprietário; por contrato também", async () => {
    const [a] = await comoUsuario(db, ADMIN, () => todos(`select * from public.bi_rentabilidade('2026-05-01', '2026-06-30', 'imovel', 10)`));
    expect(a.codigo).toBe("A-1");
    expect([n(a.receitas), n(a.taxas), n(a.despesas), n(a.resultado), n(a.valor_referencia)]).toEqual([2500, 200, 1100, 1200, 400000]);
    const [c] = await comoUsuario(db, ADMIN, () => todos(`select * from public.bi_rentabilidade('2026-05-01', '2026-06-30', 'contrato', 10)`));
    expect(c.chave).toBe(id.A2);
    expect(String(c.descricao)).toContain("Luís");
    expect(n(c.receitas)).toBe(2500);
    expect(await comoUsuario(db, ADMIN, () => erroDe(() => db.query(`select * from public.bi_rentabilidade('2026-05-01', '2026-06-30', 'x', 10)`)))).toMatch(/Agrupe por/);
  });

  it("pessoal: aluguel − despesas do imóvel, sem taxas", async () => {
    const [p] = await comoUsuario(db, PESSOAL, () => todos(`select * from public.bi_rentabilidade('2026-03-01', '2026-03-31', 'imovel', 10)`));
    expect([n(p.receitas), n(p.taxas), n(p.despesas), n(p.resultado)]).toEqual([1000, 0, 200, 800]);
  });

  it("previsão: atrasado à parte; aluguéis previstos com o reajuste pelo índice (mesma conta do app)", async () => {
    // Contas em aberto para hoje: a do escritório entra; a descontada do repasse e a de terceiros são do proprietário.
    await comoUsuario(db, ADMIN, () =>
      db.query(
        `insert into lancamentos (tipo, descricao, valor, vencimento, status, imovel_id, terceiros, descontar_repasse) values
          ('pagar', 'Luz do escritório', 80, $2, 'aberto', null, false, false),
          ('pagar', 'Reparo (desconta do repasse)', 70, $2, 'aberto', $1, false, true),
          ('pagar', 'IPTU pago pelo proprietário', 60, $2, 'aberto', $1, true, false)`,
        [id.A, hojeISO()],
      ),
    );
    const linhas = await comoUsuario(db, ADMIN, () => todos(`select * from public.bi_previsao(12)`));
    expect(linhas.length).toBe(13);
    const atraso = linhas.find((l) => l.atrasado === true)!;
    expect(n(atraso.faturas_em_aberto)).toBe(1500);
    expect(n(atraso.taxa_adm_prevista)).toBe(150);
    expect(n(atraso.repasses_estimados)).toBe(1350);
    const acum = acumuladoIndices(Array(12).fill(1));
    const inicio = `${hojeISO().slice(0, 7)}-01`;
    const meses = linhas.filter((l) => l.atrasado === false);
    meses.forEach((l, i) => {
      const mes = somarMeses(inicio, i);
      const comp = somarMeses(mes, -1); // modalidade "vencido": vence no mês seguinte à competência
      const esperado = comp >= "2026-07-01" && comp <= `${FIM_A2.slice(0, 7)}-01` ? valorReajustado(2000, acum, reajustesAte("2026-05-01", 12, comp)) : 0;
      expect(n(l.alugueis_previstos)).toBeCloseTo(esperado, 1);
      expect(n(l.taxa_adm_prevista)).toBeCloseTo(esperado * 0.1, 1);
    });
    expect(n(meses[0].contratos)).toBe(1);
    expect(n(meses[0].despesas)).toBe(80);
  });

  it("reajustes pendentes: SQL e app contam igual", async () => {
    const casos: [string, number, string][] = [
      ["2026-05-01", 12, "2027-04-01"],
      ["2026-05-01", 12, "2027-05-01"],
      ["2026-05-15", 12, "2028-06-01"],
      ["2026-05-01", 6, "2026-05-01"],
      ["2026-05-01", 0, "2030-01-01"],
    ];
    for (const [base, per, comp] of casos) {
      const r = await um<{ k: number }>(`select privado.bi_reajustes_ate($1::date, $2, $3::date) as k`, [base, per, comp]);
      expect(r.k).toBe(reajustesAte(base, per, comp));
    }
  });
});

describe("relatórios personalizados: lista fechada", () => {
  it("lista de fontes, colunas e filtros do banco é a mesma do app", async () => {
    const f = (await um<{ f: Record<string, { modulo: string; imob: boolean; imob_campos: string[]; campos: Record<string, string> }> }>(`select privado.bi_fontes() as f`)).f;
    expect(Object.keys(f).sort()).toEqual(Object.keys(FONTES_BI).sort());
    for (const [fonte, def] of Object.entries(FONTES_BI)) {
      expect(f[fonte].modulo).toBe(def.modulo);
      expect(MODULOS.some((m) => m.id === def.modulo)).toBe(true);
      expect(f[fonte].imob).toBe(def.soImobiliaria);
      expect(f[fonte].campos).toEqual(Object.fromEntries(def.campos.map((c) => [c.id, c.tipo])));
      expect([...f[fonte].imob_campos].sort()).toEqual(
        def.campos
          .filter((c) => "soImobiliaria" in c && c.soImobiliaria)
          .map((c) => c.id)
          .sort(),
      );
    }
    for (const [tipo, ops] of Object.entries(OPERADORES_POR_TIPO)) {
      expect((await um<{ o: string[] }>(`select privado.bi_operadores($1) as o`, [tipo])).o).toEqual(ops);
    }
  });

  it("validação igual no banco e no app (mesmas mensagens)", async () => {
    const casos: [DefinicaoRelatorio, boolean][] = [
      [{ fonte: "imoveis", colunas: ["codigo", "valor_aluguel"] }, true],
      [{ fonte: "xpto", colunas: ["codigo"] }, true],
      [{ fonte: "leads", colunas: ["nome"] }, false],
      [{ fonte: "imoveis", colunas: [] }, true],
      [{ fonte: "imoveis", colunas: ["codigo", "codigo"] }, true],
      [{ fonte: "imoveis", colunas: ["codigo; drop table imoveis"] }, true],
      [{ fonte: "imoveis", colunas: ["corretor"] }, false],
      [{ fonte: "imoveis", colunas: ["codigo"], filtros: [{ campo: "codigo", op: "maior_igual", valor: "1" }] }, true],
      [{ fonte: "imoveis", colunas: ["codigo"], filtros: [{ campo: "valor_aluguel", op: "igual", valor: "" }] }, true],
      [{ fonte: "imoveis", colunas: ["codigo"], filtros: [{ campo: "valor_aluguel", op: "igual", valor: "1.2.3" }] }, true],
      [{ fonte: "imoveis", colunas: ["codigo"], filtros: [{ campo: "captado_em", op: "igual", valor: "2026-02-30" }] }, true],
      [{ fonte: "imoveis", colunas: ["codigo"], filtros: [{ campo: "captado_em", op: "ultimos_dias", valor: "0" }] }, true],
      [{ fonte: "imoveis", colunas: ["codigo"], filtros: [{ campo: "captado_em", op: "este_mes" }] }, true],
      [{ fonte: "imoveis", colunas: ["codigo"], agrupar_por: "valor_aluguel" }, true],
      [{ fonte: "imoveis", colunas: ["codigo"], totais: ["codigo"] }, true],
      [{ fonte: "imoveis", colunas: ["codigo"], ordenar_por: "bairro" }, true],
      [{ fonte: "imoveis", colunas: ["codigo"], agrupar_por: "bairro", totais: ["valor_aluguel"], ordenar_por: "valor_aluguel" }, true],
      [{ fonte: "imoveis", colunas: ["codigo"], ordem: "lado" }, true],
    ];
    for (const [def, imob] of casos) {
      const banco = (await um<{ e: string | null }>(`select privado.bi_validar($1::jsonb, $2) as e`, [JSON.stringify(def), imob])).e;
      expect(banco).toBe(validarDefinicao(def, imob));
    }
  });

  it("executa com filtros, totais e agrupamento; valores com aspas não viram SQL", async () => {
    const r = await comoUsuario(db, ADMIN, () =>
      um<{ r: { colunas: string[]; linhas: unknown[][]; total: number; totais: Record<string, number> } }>(`select public.bi_executar($1::jsonb, 100) as r`, [
        JSON.stringify({ fonte: "imoveis", colunas: ["codigo", "valor_aluguel"], filtros: [{ campo: "finalidades", op: "contem", valor: "locacao" }], totais: ["valor_aluguel"], ordenar_por: "codigo" }),
      ]),
    );
    expect(r.r.colunas).toEqual(["codigo", "valor_aluguel"]);
    expect(r.r.linhas.map((l) => l[0])).toEqual(["A-1", "B-2"]);
    expect(r.r.total).toBe(2);
    expect(Number(r.r.totais.valor_aluguel)).toBe(3500);
    const g = await comoUsuario(db, ADMIN, () =>
      um<{ r: { colunas: string[]; linhas: unknown[][] } }>(`select public.bi_executar($1::jsonb, 100) as r`, [
        JSON.stringify({ fonte: "faturas", colunas: ["numero"], agrupar_por: "status", totais: ["valor_total"] }),
      ]),
    );
    expect(g.r.colunas).toEqual(["status", "quantidade", "valor_total"]);
    expect(g.r.linhas.map((l) => [l[0], Number(l[1]), Number(l[2])]).sort()).toEqual([
      ["aberta", 1, 2000],
      ["paga", 1, 2000],
    ]);
    const aspas = await comoUsuario(db, ADMIN, () =>
      um<{ r: { total: number } }>(`select public.bi_executar($1::jsonb, 100) as r`, [
        JSON.stringify({ fonte: "imoveis", colunas: ["codigo"], filtros: [{ campo: "codigo", op: "igual", valor: "x'; delete from imoveis; --" }] }),
      ]),
    );
    expect(aspas.r.total).toBe(0);
    expect(Number((await um<{ c: number }>(`select count(*)::int as c from imoveis where organizacao_id = $1`, [org])).c)).toBe(3);
    expect(
      await comoUsuario(db, ADMIN, () => erroDe(() => db.query(`select public.bi_executar($1::jsonb, 10)`, [JSON.stringify({ fonte: "imoveis", colunas: ["(select 1)"] })]))),
    ).toMatch(/Coluna desconhecida/);
  });

  it("corretor vê só os leads dele; pessoal não tem a fonte de leads", async () => {
    const r = await comoUsuario(db, CORRETOR, () => um<{ r: { linhas: unknown[][] } }>(`select public.bi_executar('{"fonte":"leads","colunas":["nome"]}'::jsonb, 100) as r`));
    expect(r.r.linhas.map((l) => l[0])).toEqual(["Lia"]);
    expect(await comoUsuario(db, PESSOAL, () => erroDe(() => db.query(`select public.bi_executar('{"fonte":"leads","colunas":["nome"]}'::jsonb, 100)`)))).toMatch(/só existe no modo imobiliária/);
  });

  it("perfil de acesso: cada fonte exige o módulo dela (Relatórios sem Financeiro não lê lançamentos nem leads)", async () => {
    const exec = (u: string, fonte: string, col: string) =>
      comoUsuario(db, u, () => erroDe(() => db.query(`select public.bi_executar($1::jsonb, 10)`, [JSON.stringify({ fonte, colunas: [col] })])));
    expect(await exec(RESTRITO, "lancamentos", "descricao")).toMatch(/não permite ver Financeiro/);
    expect(await exec(RESTRITO, "leads", "telefone")).toMatch(/não permite ver Comercial/);
    expect(await exec(RESTRITO, "repasses", "valor_liquido")).toMatch(/não permite ver Repasses/);
    expect(await exec(RESTRITO, "faturas", "numero")).toMatch(/não permite ver Aluguéis do mês/);
    expect(await exec(RESTRITO, "imoveis", "codigo")).toBe("");
    expect(await exec(ADMIN, "lancamentos", "descricao")).toBe("");
    // Salvar: recusa a fonte fora do perfil; aceita a liberada.
    expect(
      await comoUsuario(db, RESTRITO, () => erroDe(() => db.query(`insert into relatorios_salvos (nome, fonte, colunas) values ('Lançamentos', 'lancamentos', '{descricao}')`))),
    ).toMatch(/não permite ver Financeiro/);
    expect(await comoUsuario(db, RESTRITO, () => erroDe(() => db.query(`insert into relatorios_salvos (nome, fonte, colunas) values ('Meus imóveis', 'imoveis', '{codigo}')`)))).toBe("");
    // Relatório de lançamentos salvo pelo admin: some da lista desse perfil, e o envio dele só é "pego" por quem pode ver.
    const rel = await comoUsuario(db, ADMIN, async () =>
      (await um<{ id: string }>(`insert into relatorios_salvos (nome, fonte, colunas) values ('Caixa', 'lancamentos', '{descricao,valor}') returning id`)).id,
    );
    expect((await comoUsuario(db, RESTRITO, () => todos<{ id: string }>(`select id from relatorios_salvos`))).map((v) => v.id)).not.toContain(rel);
    expect((await comoUsuario(db, ADMIN, () => todos<{ id: string }>(`select id from relatorios_salvos`))).map((v) => v.id)).toContain(rel);
    const ag = await comoUsuario(db, ADMIN, async () =>
      (await um<{ id: string }>(`insert into relatorio_agendamentos (nome, relatorio_id, frequencia) values ('Caixa diário', $1, 'diaria') returning id`, [rel])).id,
    );
    await db.query(`update relatorio_agendamentos set proxima_em = now() - interval '1 hour' where id = $1`, [ag]);
    expect(await comoUsuario(db, RESTRITO, () => todos(`select id from public.relatorio_agendamentos_vez(5)`))).toEqual([]);
    expect(await comoUsuario(db, RESTRITO, () => erroDe(() => db.query(`select * from public.relatorio_agendamentos_vez(1, $1)`, [ag])))).toMatch(/não permite ver os dados/);
    expect((await comoUsuario(db, ADMIN, () => todos<{ id: string }>(`select id from public.relatorio_agendamentos_vez(5)`))).map((x) => x.id)).toEqual([ag]);
    // A tela usa a mesma regra (fontesPermitidas ≡ privado.bi_pode_fonte).
    const p = await comoUsuario(db, RESTRITO, async () => (await um<{ p: Record<string, string[]> }>(`select public.minhas_permissoes() as p`)).p);
    expect(fontesPermitidas(true, p)).toEqual(["imoveis"]);
    for (const fonte of Object.keys(FONTES_BI)) {
      const banco = await comoUsuario(db, RESTRITO, async () => (await um<{ ok: boolean }>(`select privado.bi_pode_fonte($1, $2) as ok`, [org, fonte])).ok);
      expect(banco).toBe(fontesPermitidas(true, p).includes(fonte as keyof typeof FONTES_BI));
    }
  });

  it("salvar: definição conferida no banco, permissão (Configurações → editar ou admin/gestor), auditoria e isolamento", async () => {
    const r = await comoUsuario(db, GESTOR, async () =>
      (await um<{ id: string }>(`insert into relatorios_salvos (nome, fonte, colunas) values (' Imóveis vagos ', 'imoveis', '{codigo,status}') returning id`)).id,
    );
    id.rel = r;
    expect((await um<{ nome: string }>(`select nome from relatorios_salvos where id = $1`, [r])).nome).toBe("Imóveis vagos");
    expect(await comoUsuario(db, GESTOR, () => erroDe(() => db.query(`insert into relatorios_salvos (nome, fonte, colunas) values ('X', 'imoveis', '{nao_existe}')`)))).toMatch(/Coluna desconhecida/);
    expect(await comoUsuario(db, FINANCEIRO, () => erroDe(() => db.query(`insert into relatorios_salvos (nome, fonte, colunas) values ('X', 'imoveis', '{codigo}')`)))).not.toBe("");
    expect(await comoUsuario(db, PESSOAL, () => erroDe(() => db.query(`insert into relatorios_salvos (nome, fonte, colunas) values ('X', 'repasses', '{imovel}')`)))).toMatch(/só existe no modo imobiliária/);
    expect(await comoUsuario(db, OUTRO, () => todos(`select id from relatorios_salvos`))).toEqual([]);
    const aud = await um<{ c: number }>(`select count(*)::int as c from auditoria where tabela = 'relatorios_salvos' and registro_id = $1`, [r]);
    expect(aud.c).toBe(1);
  });
});

describe("envios programados", () => {
  it("cria com destinatários limpos e a próxima execução calculada pelo banco (a API não escolhe)", async () => {
    const a = await comoUsuario(db, ADMIN, () =>
      um<{ id: string; emails: string[]; whatsapps: string[]; proxima_em: Date; dia_mes: number | null; dia_semana: number }>(
        `insert into relatorio_agendamentos (nome, padrao, frequencia, dia_semana, dia_mes, hora, emails, whatsapps, proxima_em, ultima_em)
         values ('Semanal', 'financeiro_mensal', 'semanal', 1, 10, 8, '{"Socio@X.com"," socio@x.com"}', '{"(51) 99999-0000"}', '2000-01-01', '2000-01-01')
         returning id, emails, whatsapps, proxima_em, dia_mes, dia_semana`,
      ),
    );
    id.ag = a.id;
    expect(a.emails).toEqual(["socio@x.com"]);
    expect(a.whatsapps).toEqual(["51999990000"]);
    expect(a.dia_mes).toBeNull();
    expect(new Date(a.proxima_em).getTime()).toBeGreaterThan(Date.now());
    const sp = new Date(new Date(a.proxima_em).getTime() - 3 * 3600_000);
    expect([sp.getUTCDay(), sp.getUTCHours()]).toEqual([1, 8]);
    expect(await um(`select ultima_em from relatorio_agendamentos where id = $1`, [a.id])).toEqual({ ultima_em: null });
  });

  it("recusa: corretor, e-mail inválido, relatório de outra organização e relatório da imobiliária no modo pessoal", async () => {
    expect(await comoUsuario(db, CORRETOR, () => erroDe(() => db.query(`insert into relatorio_agendamentos (nome, padrao) values ('X', 'equipe')`)))).not.toBe("");
    expect(await comoUsuario(db, CORRETOR, () => todos(`select id from relatorio_agendamentos`))).toEqual([]);
    expect(await comoUsuario(db, ADMIN, () => erroDe(() => db.query(`insert into relatorio_agendamentos (nome, padrao, emails) values ('X', 'previsao', '{nao-e-email}')`)))).toMatch(/E-mail inválido/);
    const deOutro = await comoUsuario(db, OUTRO, async () =>
      (await um<{ id: string }>(`insert into relatorios_salvos (nome, fonte, colunas) values ('Deles', 'imoveis', '{codigo}') returning id`)).id,
    );
    expect(await comoUsuario(db, ADMIN, () => erroDe(() => db.query(`insert into relatorio_agendamentos (nome, relatorio_id) values ('X', $1)`, [deOutro])))).toMatch(/não encontrado/);
    expect(await comoUsuario(db, PESSOAL, () => erroDe(() => db.query(`insert into relatorio_agendamentos (nome, padrao) values ('X', 'leads_canais')`)))).toMatch(/só existe no modo imobiliária/);
    expect(await comoUsuario(db, PESSOAL, () => erroDe(() => db.query(`insert into relatorio_agendamentos (nome, padrao) values ('Aluguéis', 'financeiro_mensal')`)))).toBe("");
  });

  it("os vencidos são pegos uma vez só (a próxima execução avança); corretor não roda; rodar agora não mexe no próximo", async () => {
    await db.query(`update relatorio_agendamentos set proxima_em = now() - interval '1 hour' where id = $1`, [id.ag]);
    expect(await comoUsuario(db, CORRETOR, () => todos(`select id from public.relatorio_agendamentos_vez(5)`))).toEqual([]);
    const pegos = await comoUsuario(db, ADMIN, () => todos<{ id: string; proxima_em: Date }>(`select id, proxima_em from public.relatorio_agendamentos_vez(5)`));
    expect(pegos.map((p) => p.id)).toEqual([id.ag]);
    expect(new Date(pegos[0].proxima_em).getTime()).toBeGreaterThan(Date.now());
    expect(await comoUsuario(db, ADMIN, () => todos(`select id from public.relatorio_agendamentos_vez(5)`))).toEqual([]);
    const antes = (await um<{ p: Date }>(`select proxima_em as p from relatorio_agendamentos where id = $1`, [id.ag])).p;
    const agora = await comoUsuario(db, GESTOR, () => todos<{ proxima_em: Date }>(`select proxima_em from public.relatorio_agendamentos_vez(1, $1)`, [id.ag]));
    expect(new Date(agora[0].proxima_em).getTime()).toBe(new Date(antes).getTime());
    expect(await comoUsuario(db, OUTRO, () => todos(`select id from public.relatorio_agendamentos_vez(1, $1)`, [id.ag]))).toEqual([]);
  });

  it("próxima execução: banco e app dão a mesma hora", async () => {
    const casos: [string, number | null, number | null, number, string][] = [
      ["diaria", null, null, 8, "2026-11-04T12:00:00Z"],
      ["diaria", null, null, 8, "2026-11-04T11:00:00Z"],
      ["semanal", 1, null, 8, "2026-11-04T12:00:00Z"],
      ["semanal", 0, null, 23, "2026-11-08T01:00:00Z"],
      ["mensal", null, 5, 23, "2026-11-05T02:30:00Z"],
      ["mensal", null, 28, 0, "2026-12-29T10:00:00Z"],
    ];
    for (const [f, ds, dm, h, depois] of casos) {
      const r = await um<{ p: Date }>(`select privado.bi_proxima_execucao($1, $2, $3, $4, $5::timestamptz) as p`, [f, ds, dm, h, depois]);
      expect(new Date(r.p).toISOString()).toBe(proximaExecucao(f, ds, dm, h, new Date(depois))?.toISOString());
    }
  });

  it("execuções: só pela RPC, logo depois da vez e uma vez só; nome, destinatários e quem gravou são do banco", async () => {
    const reg = (u: string, p: Record<string, unknown>, ag = id.ag) =>
      comoUsuario(db, u, async () => (await um<{ id: string }>(`select public.relatorio_registrar_execucao($1, $2::jsonb) as id`, [ag, JSON.stringify(p)])).id);
    const arquivo = { origem: "manual", status: "pronto_para_enviar", formato: "csv", linhas: 3, resumo: "3 linha(s)", periodo: "maio de 2026" };
    // Fora da vez (pego há mais de 30 minutos): recusa.
    await db.query(`update relatorio_agendamentos set ultima_em = now() - interval '2 hours' where id = $1`, [id.ag]);
    expect(await erroDe(() => reg(ADMIN, { ...arquivo, arquivo_path: `${org}/${id.ag}/a.csv` }))).toMatch(/não está sendo gerado agora/);
    // Na vez ("rodar agora"): grava, com nome e destinatários do próprio envio (não do pedido).
    await comoUsuario(db, ADMIN, () => db.query(`select * from public.relatorio_agendamentos_vez(1, $1)`, [id.ag]));
    expect(await erroDe(() => reg(ADMIN, { ...arquivo, arquivo_path: `${orgB}/${id.ag}/a.csv` }))).toMatch(/fora da pasta/);
    expect(await erroDe(() => reg(ADMIN, { ...arquivo, arquivo_path: `${org}/${id.ag}/../x.csv` }))).toMatch(/fora da pasta/);
    expect(await erroDe(() => reg(ADMIN, { ...arquivo, arquivo_path: null }))).toMatch(/Falta o arquivo/);
    expect(await erroDe(() => reg(CORRETOR, { ...arquivo, arquivo_path: `${org}/${id.ag}/a.csv` }))).toMatch(/Sem acesso/);
    expect(await erroDe(() => reg(LEITOR, { ...arquivo, arquivo_path: `${org}/${id.ag}/a.csv` }))).toMatch(/não permite rodar/);
    const e = await reg(ADMIN, { ...arquivo, arquivo_path: `${org}/${id.ag}/a.csv`, nome: "Forjado", destinatarios: { emails: ["x@y.com"] } });
    id.exec = e;
    const linha = await um<{ nome: string; usuario_id: string; destinatarios: { emails: string[]; periodo: string }; linhas: number }>(
      `select nome, usuario_id, destinatarios, linhas from relatorio_execucoes where id = $1`,
      [e],
    );
    expect(linha.nome).toBe("Semanal");
    expect(linha.usuario_id).toBe(ADMIN);
    expect(linha.destinatarios.emails).toEqual(["socio@x.com"]);
    expect(linha.destinatarios.periodo).toBe("maio de 2026");
    expect(linha.linhas).toBe(3);
    // Uma execução por vez.
    expect(await erroDe(() => reg(ADMIN, { ...arquivo, arquivo_path: `${org}/${id.ag}/b.csv` }))).toMatch(/já foi registrado/);
    // Nada de gravar, mudar ou apagar direto pela API.
    expect(await comoUsuario(db, ADMIN, () => erroDe(() => db.query(`insert into relatorio_execucoes (nome, status) values ('X', 'erro')`)))).not.toBe("");
    const mudou = await comoUsuario(db, ADMIN, () => db.query(`update relatorio_execucoes set status = 'enviado' where id = $1`, [e]));
    expect(mudou.affectedRows ?? 0).toBe(0);
    const apagou = await comoUsuario(db, ADMIN, () => db.query(`delete from relatorio_execucoes where id = $1`, [e]));
    expect(apagou.affectedRows ?? 0).toBe(0);
    expect(await comoUsuario(db, OUTRO, () => todos(`select id from relatorio_execucoes`))).toEqual([]);
    expect(await comoUsuario(db, LEITOR, () => todos(`select id from relatorio_execucoes`))).toHaveLength(1);
  });

  it("prazo de guarda: quem programa envios apaga o arquivo antes; quem só vê, só depois do prazo", async () => {
    expect((await um<{ d: number }>(`select privado.bi_dias_guarda() as d`)).d).toBe(DIAS_GUARDA_ARQUIVOS);
    const velha = (
      await um<{ id: string }>(
        `insert into relatorio_execucoes (organizacao_id, agendamento_id, nome, status, arquivo_path, data)
         values ($1, $2, 'Semanal', 'pronto_para_enviar', $3, now() - interval '100 days') returning id`,
        [org, id.ag, `${org}/${id.ag}/velho.csv`],
      )
    ).id;
    const marcar = (u: string, ids: string[]) => comoUsuario(db, u, async () => (await um<{ n: number }>(`select public.relatorio_marcar_arquivos_apagados($1::uuid[]) as n`, [ids])).n);
    // O leitor não apaga o recente; apaga o que passou do prazo (limpeza automática).
    expect(await marcar(LEITOR, [id.exec])).toBe(0);
    expect(await marcar(LEITOR, [velha])).toBe(1);
    expect(await erroDe(() => marcar(CORRETOR, [id.exec]))).toMatch(/Sem acesso/);
    expect(await marcar(OUTRO, [id.exec]).catch(() => 0)).toBe(0);
    // Quem programa envios apaga antes do prazo; marca uma vez só.
    expect(await marcar(GESTOR, [id.exec])).toBe(1);
    expect(await marcar(GESTOR, [id.exec])).toBe(0);
    const r = await um<{ em: Date | null; por: string | null }>(`select arquivo_apagado_em as em, arquivo_apagado_por as por from relatorio_execucoes where id = $1`, [id.exec]);
    expect(r.em).not.toBeNull();
    expect(r.por).toBe(GESTOR);
  });

  it("arquivo no Storage: ler só na pasta da organização; gravar só na pasta do envio que está na vez; apagar conforme o prazo", async () => {
    const ok = (u: string, nome: string) => comoUsuario(db, u, async () => (await um<{ ok: boolean }>(`select privado.relatorios_arquivo_permitido($1) as ok`, [nome])).ok);
    expect(await ok(ADMIN, `${org}/${id.ag}/a.csv`)).toBe(true);
    expect(await ok(CORRETOR, `${org}/${id.ag}/a.csv`)).toBe(false);
    expect(await ok(OUTRO, `${org}/${id.ag}/a.csv`)).toBe(false);
    expect(await ok(ADMIN, `${org}/a.csv`)).toBe(false);
    expect(await ok(ADMIN, `${org}/../${orgB}/a.csv`)).toBe(false);

    const grava = (u: string, nome: string) => comoUsuario(db, u, async () => (await um<{ ok: boolean }>(`select privado.relatorios_arquivo_gravavel($1) as ok`, [nome])).ok);
    await comoUsuario(db, ADMIN, () => db.query(`select * from public.relatorio_agendamentos_vez(1, $1)`, [id.ag]));
    expect(await grava(ADMIN, `${org}/${id.ag}/c.csv`)).toBe(true);
    expect(await grava(LEITOR, `${org}/${id.ag}/c.csv`)).toBe(true);
    expect(await grava(ADMIN, `${org}/c.csv`)).toBe(false);
    expect(await grava(ADMIN, `${org}/${orgB}/c.csv`)).toBe(false);
    expect(await grava(ADMIN, `${org}/${id.ag}/sub/c.csv`)).toBe(false);
    expect(await grava(CORRETOR, `${org}/${id.ag}/c.csv`)).toBe(false);
    expect(await grava(OUTRO, `${org}/${id.ag}/c.csv`)).toBe(false);
    await db.query(`update relatorio_agendamentos set ultima_em = now() - interval '2 hours' where id = $1`, [id.ag]);
    expect(await grava(ADMIN, `${org}/${id.ag}/c.csv`)).toBe(false);

    // Apagar: quem programa envios, qualquer um; quem só vê, só o de execução que passou do prazo ("velho.csv", de 100 dias).
    const apaga = (u: string, nome: string) => comoUsuario(db, u, async () => (await um<{ ok: boolean }>(`select privado.relatorios_arquivo_apagavel($1) as ok`, [nome])).ok);
    expect(await apaga(GESTOR, `${org}/${id.ag}/a.csv`)).toBe(true);
    expect(await apaga(LEITOR, `${org}/${id.ag}/a.csv`)).toBe(false);
    expect(await apaga(LEITOR, `${org}/${id.ag}/velho.csv`)).toBe(true);
    expect(await apaga(LEITOR, `${org}/${id.ag}/sem-registro.csv`)).toBe(false);
    expect(await apaga(CORRETOR, `${org}/${id.ag}/velho.csv`)).toBe(false);
    expect(await apaga(OUTRO, `${org}/${id.ag}/velho.csv`)).toBe(false);
  });

  it("permissões na tela = permissões no banco", async () => {
    for (const u of [ADMIN, GESTOR, CORRETOR, FINANCEIRO, RESTRITO, LEITOR]) {
      const { b, p, papel } = await comoUsuario(db, u, async () => ({
        b: (await um<{ b: Record<string, boolean> }>(`select public.bi_minhas_permissoes() as b`)).b,
        p: (await um<{ p: Record<string, string[]> }>(`select public.minhas_permissoes() as p`)).p,
        papel: (await um<{ papel: string }>(`select papel from membros where user_id = $1`, [u])).papel,
      }));
      const app = permissoesBi(papel, p);
      expect({ ver: b.ver, editar: b.editar, agendar: b.agendar, rodar: b.rodar }).toEqual(app);
    }
  });
});
