/**
 * Salvaguardas do financeiro no banco (PGlite): aprovação de pagamentos,
 * regras só de gestor, adiantamento x repasse, conciliação x estorno e
 * exclusões.
 */
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { comoUsuario, criarBanco } from "./pglite";

const GESTOR = "00000000-0000-0000-0000-000000010a01";
const FINANCEIRO = "00000000-0000-0000-0000-000000010a02";
const CORRETOR = "00000000-0000-0000-0000-000000010a03";

let db: PGlite;
let org: string;

async function erroDe(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "";
  } catch (e) {
    return String(e);
  }
}

beforeAll(async () => {
  db = await criarBanco();
  org = await comoUsuario(db, GESTOR, async () => (await db.query<{ id: string }>(`select public.criar_organizacao('Imob Fin') as id`)).rows[0].id);
  await db.query(`insert into membros (organizacao_id, user_id, papel) values ($1, $2, 'financeiro'), ($1, $3, 'corretor')`, [org, FINANCEIRO, CORRETOR]);
  await comoUsuario(db, GESTOR, () => db.query(`update organizacoes set aprovacao_pagamento_acima = 1000 where id = $1`, [org]));
});

describe("aprovação de pagamentos no banco", () => {
  it("marca, bloqueia a baixa sem aprovação, só gestor aprova e mudar o valor tira a aprovação", async () => {
    const id = await comoUsuario(db, FINANCEIRO, async () => {
      const l = (await db.query<{ id: string; requer_aprovacao: boolean }>(`insert into lancamentos (tipo, descricao, valor, vencimento) values ('pagar', 'Reforma', 5000, '2026-11-10') returning id, requer_aprovacao`)).rows[0];
      expect(l.requer_aprovacao).toBe(true);
      expect(await erroDe(() => db.query(`update lancamentos set status = 'liquidado', liquidado_em = '2026-11-10' where id = $1`, [l.id]))).toContain("limite de aprovação");
      expect(await erroDe(() => db.query(`update lancamentos set aprovado_em = now() where id = $1`, [l.id]))).toContain("Só administradores e gestores");
      expect(await erroDe(() => db.query(`update lancamentos set requer_aprovacao = false, status = 'liquidado', liquidado_em = '2026-11-10' where id = $1`, [l.id]))).toContain("limite de aprovação");
      expect(await erroDe(() => db.query(`insert into lancamentos (tipo, descricao, valor, vencimento, status, liquidado_em) values ('pagar', 'Já pago', 2000, '2026-11-10', 'liquidado', '2026-11-10')`))).toContain("limite de aprovação");
      // Abaixo do limite, mas pago acima dele (juros), também precisa
      const b = (await db.query<{ id: string }>(`insert into lancamentos (tipo, descricao, valor, vencimento) values ('pagar', 'Conta', 900, '2026-11-10') returning id`)).rows[0].id;
      expect(await erroDe(() => db.query(`update lancamentos set status = 'liquidado', liquidado_em = '2026-11-10', valor_pago = 1200 where id = $1`, [b]))).toContain("limite de aprovação");
      return l.id;
    });
    await comoUsuario(db, GESTOR, () => db.query(`update lancamentos set aprovado_em = now() where id = $1`, [id]));
    const aprovado = (await db.query<{ aprovado_por: string }>(`select aprovado_por from lancamentos where id = $1`, [id])).rows[0];
    expect(aprovado.aprovado_por).toBe(GESTOR);
    await comoUsuario(db, FINANCEIRO, async () => {
      await db.query(`update lancamentos set valor = 9000 where id = $1`, [id]);
      const r = (await db.query<{ aprovado_em: string | null; requer_aprovacao: boolean }>(`select aprovado_em, requer_aprovacao from lancamentos where id = $1`, [id])).rows[0];
      expect(r.aprovado_em).toBeNull();
      expect(r.requer_aprovacao).toBe(true);
    });
    await comoUsuario(db, GESTOR, () => db.query(`update lancamentos set aprovado_em = now() where id = $1`, [id]));
    await comoUsuario(db, FINANCEIRO, () => db.query(`update lancamentos set status = 'liquidado', liquidado_em = '2026-11-10' where id = $1`, [id]));
    const hist = (await db.query<{ acao: string }>(`select acao from lancamento_historico where lancamento_id = $1 order by data`, [id])).rows.map((h) => h.acao);
    expect(hist).toContain("aprovado");
    expect(hist).toContain("liquidado");
  });

  it("só admin/gestor mudam o limite e a alíquota de ISS; recebimentos não precisam de aprovação", async () => {
    expect(await comoUsuario(db, CORRETOR, () => erroDe(() => db.query(`update organizacoes set aprovacao_pagamento_acima = null where id = $1`, [org])))).toContain("Só administradores e gestores");
    expect(await comoUsuario(db, FINANCEIRO, () => erroDe(() => db.query(`update organizacoes set aliquota_iss = 5 where id = $1`, [org])))).toContain("Só administradores e gestores");
    await comoUsuario(db, CORRETOR, () => db.query(`update organizacoes set telefone = '51999990000' where id = $1`, [org]));
    await comoUsuario(db, FINANCEIRO, () =>
      db.query(`insert into lancamentos (tipo, descricao, valor, vencimento, status, liquidado_em) values ('receber', 'Taxa grande', 50000, '2026-11-10', 'liquidado', '2026-11-10')`),
    );
  });
});

describe("conciliação, adiantamentos e exclusões", () => {
  it("repasse apagado devolve o adiantamento; linha do extrato apagada solta a conciliação; conta com transferência não sai", async () => {
    const r = await comoUsuario(db, GESTOR, async () => {
      const dono = (await db.query<{ id: string }>(`insert into pessoas (nome, tipo_pessoa, papeis) values ('Dona', 'PF', '{proprietario}') returning id`)).rows[0].id;
      const imovel = (await db.query<{ id: string }>(`insert into imoveis (codigo, cidade) values ('FIN-1', 'Porto Alegre') returning id`)).rows[0].id;
      const contrato = (await db.query<{ id: string }>(
        `insert into contratos (imovel_id, data_inicio, prazo_meses, data_fim, valor_aluguel, dia_vencimento, data_base_reajuste) values ($1, '2026-01-01', 30, '2028-06-30', 2000, 10, '2026-01-01') returning id`,
        [imovel],
      )).rows[0].id;
      const repasse = (await db.query<{ id: string }>(
        `insert into repasses (contrato_id, pessoa_id, competencia, percentual, valor_bruto, valor_liquido, previsto_para) values ($1, $2, '2026-11-01', 100, 2000, 1800, '2026-11-15') returning id`,
        [contrato, dono],
      )).rows[0].id;
      const adi = (await db.query<{ id: string }>(
        `insert into lancamentos (tipo, descricao, valor, valor_pago, vencimento, status, liquidado_em, pessoa_id, adiantamento, compensado_em, repasse_id)
         values ('pagar', 'Adiantamento', 300, 300, '2026-11-01', 'liquidado', '2026-11-01', $1, true, '2026-11-02', $2) returning id`,
        [dono, repasse],
      )).rows[0].id;
      await db.query(`delete from repasses where id = $1`, [repasse]);
      const depois = (await db.query<{ compensado_em: string | null; repasse_id: string | null }>(`select compensado_em, repasse_id from lancamentos where id = $1`, [adi])).rows[0];

      const c1 = (await db.query<{ id: string }>(`insert into contas_financeiras (nome) values ('Banco 1') returning id`)).rows[0].id;
      const c2 = (await db.query<{ id: string }>(`insert into contas_financeiras (nome) values ('Banco 2') returning id`)).rows[0].id;
      const l = (await db.query<{ id: string }>(
        `insert into lancamentos (tipo, descricao, valor, valor_pago, vencimento, status, liquidado_em, conta_id, conciliado_em) values ('pagar', 'Luz', 80, 80, '2026-11-05', 'liquidado', '2026-11-05', $1, now()) returning id`,
        [c1],
      )).rows[0].id;
      const item = (await db.query<{ id: string }>(`insert into extrato_itens (conta_id, data, descricao, valor, fitid, lancamento_id) values ($1, '2026-11-05', 'LUZ', -80, 'x1', $2) returning id`, [c1, l])).rows[0].id;
      await db.query(`delete from extrato_itens where id = $1`, [item]);
      const conc = (await db.query<{ conciliado_em: string | null }>(`select conciliado_em from lancamentos where id = $1`, [l])).rows[0].conciliado_em;
      await db.query(`insert into transferencias (origem_id, destino_id, valor) values ($1, $2, 100)`, [c1, c2]);
      const excluir = await erroDe(() => db.query(`delete from contas_financeiras where id = $1`, [c2]));
      return { depois, conc, excluir };
    });
    expect(r.depois).toEqual({ compensado_em: null, repasse_id: null });
    expect(r.conc).toBeNull();
    expect(r.excluir).toContain("tem transferências registradas");
  });

  it("aluguel que volta a ficar em aberto solta a conta e a linha do extrato", async () => {
    const r = await comoUsuario(db, GESTOR, async () => {
      const imovel = (await db.query<{ id: string }>(`insert into imoveis (codigo, cidade) values ('FIN-2', 'Canoas') returning id`)).rows[0].id;
      const contrato = (await db.query<{ id: string }>(
        `insert into contratos (imovel_id, data_inicio, prazo_meses, data_fim, valor_aluguel, dia_vencimento, data_base_reajuste) values ($1, '2026-01-01', 30, '2028-06-30', 1500, 10, '2026-01-01') returning id`,
        [imovel],
      )).rows[0].id;
      const conta = (await db.query<{ id: string }>(`insert into contas_financeiras (nome) values ('Banco 3') returning id`)).rows[0].id;
      const fatura = (await db.query<{ id: string }>(
        `insert into faturas (contrato_id, competencia, vencimento, valor_total, status, pago_em, valor_pago, conta_id, conciliado_em) values ($1, '2026-11-01', '2026-11-10', 1500, 'paga', '2026-11-10', 1500, $2, now()) returning id`,
        [contrato, conta],
      )).rows[0].id;
      const item = (await db.query<{ id: string }>(`insert into extrato_itens (conta_id, data, descricao, valor, fitid, fatura_id) values ($1, '2026-11-10', 'PIX', 1500, 'f1', $2) returning id`, [conta, fatura])).rows[0].id;
      await db.query(`update faturas set status = 'aberta', pago_em = null, valor_pago = null where id = $1`, [fatura]);
      return {
        f: (await db.query<{ conta_id: string | null; conciliado_em: string | null }>(`select conta_id, conciliado_em from faturas where id = $1`, [fatura])).rows[0],
        i: (await db.query<{ fatura_id: string | null }>(`select fatura_id from extrato_itens where id = $1`, [item])).rows[0],
      };
    });
    expect(r.f).toEqual({ conta_id: null, conciliado_em: null });
    expect(r.i.fatura_id).toBeNull();
  });

  it("apagar a organização inteira funciona mesmo com histórico financeiro", async () => {
    const U = "00000000-0000-0000-0000-000000010a09";
    const o = await comoUsuario(db, U, async () => {
      const id = (await db.query<{ id: string }>(`select public.criar_organizacao('Imob Tchau') as id`)).rows[0].id;
      await db.query(`insert into lancamentos (tipo, descricao, valor, vencimento) values ('pagar', 'X', 10, '2026-11-10')`);
      return id;
    });
    await db.query(`delete from organizacoes where id = $1`, [o]);
    expect((await db.query(`select 1 from lancamentos where organizacao_id = $1`, [o])).rows).toHaveLength(0);
  });
});

describe("desconto de adiantamento no repasse (RPC)", () => {
  it("desconta uma vez só, desfaz devolvendo o valor e recusa adiantamento não pago", async () => {
    const r = await comoUsuario(db, GESTOR, async () => {
      const dono = (await db.query<{ id: string }>(`insert into pessoas (nome, tipo_pessoa, papeis) values ('Dono 2', 'PF', '{proprietario}') returning id`)).rows[0].id;
      const imovel = (await db.query<{ id: string }>(`insert into imoveis (codigo, cidade) values ('FIN-3', 'Porto Alegre') returning id`)).rows[0].id;
      const contrato = (await db.query<{ id: string }>(
        `insert into contratos (imovel_id, data_inicio, prazo_meses, data_fim, valor_aluguel, dia_vencimento, data_base_reajuste) values ($1, '2026-01-01', 30, '2028-06-30', 2000, 10, '2026-01-01') returning id`,
        [imovel],
      )).rows[0].id;
      const repasse = (await db.query<{ id: string }>(
        `insert into repasses (contrato_id, pessoa_id, competencia, percentual, valor_bruto, valor_liquido, previsto_para) values ($1, $2, '2026-12-01', 100, 2000, 1800, '2026-12-15') returning id`,
        [contrato, dono],
      )).rows[0].id;
      const adi = (await db.query<{ id: string }>(
        `insert into lancamentos (tipo, descricao, valor, valor_pago, vencimento, status, liquidado_em, pessoa_id, adiantamento) values ('pagar', 'Adiant.', 300, 300, '2026-11-01', 'liquidado', '2026-11-01', $1, true) returning id`,
        [dono],
      )).rows[0].id;
      const aberto = (await db.query<{ id: string }>(`insert into lancamentos (tipo, descricao, valor, vencimento, pessoa_id, adiantamento) values ('pagar', 'Não pago', 100, '2026-11-01', $1, true) returning id`, [dono])).rows[0].id;
      await db.query(`select public.compensar_adiantamento($1)`, [adi]);
      const duas = await erroDe(() => db.query(`select public.compensar_adiantamento($1)`, [adi]));
      const naoPago = await erroDe(() => db.query(`select public.compensar_adiantamento($1)`, [aberto]));
      const depois = (await db.query<{ valor_liquido: string; outros_descontos: string }>(`select valor_liquido, outros_descontos from repasses where id = $1`, [repasse])).rows[0];
      await db.query(`select public.descompensar_adiantamento($1)`, [adi]);
      const desfeito = (await db.query<{ valor_liquido: string }>(`select valor_liquido from repasses where id = $1`, [repasse])).rows[0];
      const l = (await db.query<{ compensado_em: string | null }>(`select compensado_em from lancamentos where id = $1`, [adi])).rows[0];
      return { duas, naoPago, depois, desfeito, l };
    });
    expect(r.depois).toEqual({ valor_liquido: "1500.00", outros_descontos: "300.00" });
    expect(r.duas).toContain("já foi descontado");
    expect(r.naoPago).toContain("já foi pago");
    expect(r.desfeito.valor_liquido).toBe("1800.00");
    expect(r.l.compensado_em).toBeNull();
  });
});
