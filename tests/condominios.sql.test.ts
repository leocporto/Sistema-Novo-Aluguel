/**
 * Gestão de condomínios no banco (PGlite): módulo opcional (só o admin liga;
 * só no modo imobiliária; desligado = nada grava), papéis (corretor não vê),
 * isolamento entre organizações e condomínios, frações ideais, geração de
 * cotas (mesma conta de calcularCotas, sem perder centavo), baixa parcial com
 * receitas no livro-caixa (fundo de reserva na conta do fundo), estorno,
 * saída do fundo só com aprovação, fechamento do mês (reabrir só admin),
 * inadimplência e acordo, reservas sem conflito, previsões de fornecedores,
 * taxa de administração no financeiro da imobiliária, portal do condômino
 * (entrada com 4 números, sessão, leitura só do que é dele, reserva, voto,
 * ocorrência com limite, envio de foto) e juntar repetidos.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { calcularCotas, type CriterioRateio } from "@/lib/dominio/condominios";
import { ratear } from "@/lib/dominio/dinheiro";
import { comoAnonimo, comoUsuario, criarBanco } from "./pglite";

const ADMIN = "00000000-0000-0000-0000-000000023a01";
const GESTOR = "00000000-0000-0000-0000-000000023a02";
const FINANCEIRO = "00000000-0000-0000-0000-000000023a03";
const CORRETOR = "00000000-0000-0000-0000-000000023a04";
const OUTRO = "00000000-0000-0000-0000-000000023a05";
const PESSOAL = "00000000-0000-0000-0000-000000023a06";

let db: PGlite;
let org: string;
let orgB: string;
let orgP: string;
const ids: Record<string, string> = {};
let token = "";
let sessao = "";

async function erroDe(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "";
  } catch (e) {
    return String(e);
  }
}
const um = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0];
const id = async (sql: string, params: unknown[] = []) => (await um<{ id: string }>(sql, params)).id;
const comoAdmin = <T>(fn: () => Promise<T>) => comoUsuario(db, ADMIN, fn);
const anon = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => comoAnonimo(db, async () => (await um<{ r: T }>(sql, params)).r);
const dados = <T = unknown>(secao: string, p: Record<string, unknown> = {}) =>
  anon<T>(`select public.cond_portal_dados($1, $2, $3, $4) as r`, [token, sessao, secao, p]);
const centavos = (v: unknown) => Math.round(Number(v) * 100);

beforeAll(async () => {
  db = await criarBanco();
  org = await comoUsuario(db, ADMIN, async () => (await um<{ id: string }>(`select public.criar_organizacao('Imob Condomínios') as id`)).id);
  orgB = await comoUsuario(db, OUTRO, async () => (await um<{ id: string }>(`select public.criar_organizacao('Outra') as id`)).id);
  orgP = await comoUsuario(db, PESSOAL, async () => (await um<{ id: string }>(`select public.criar_organizacao('Meus imóveis') as id`)).id);
  await db.query(`update organizacoes set modo = 'pessoal' where id = $1`, [orgP]);
  await db.query(`insert into membros (organizacao_id, user_id, papel, nome) values ($1, $2, 'gestor', 'Gil'), ($1, $3, 'financeiro', 'Fê'), ($1, $4, 'corretor', 'Cora')`, [
    org,
    GESTOR,
    FINANCEIRO,
    CORRETOR,
  ]);
  await comoAdmin(async () => {
    ids.ana = await id(`insert into pessoas (nome, documento, telefone) values ('Ana Condômina', '123.456.789-09', '51911110000') returning id`);
    ids.bia = await id(`insert into pessoas (nome, documento) values ('Bia Inquilina', '987.654.321-00') returning id`);
    ids.caio = await id(`insert into pessoas (nome, telefone) values ('Caio Síndico', '(51) 98888-7777') returning id`);
    ids.forn = await id(`insert into pessoas (nome, papeis) values ('Limpa Tudo Ltda', '{prestador}') returning id`);
    ids.semDoc = await id(`insert into pessoas (nome) values ('Sem Contato') returning id`);
  });
  ids.pessoaB = await comoUsuario(db, OUTRO, () => id(`insert into pessoas (nome) values ('De Outra') returning id`));
});

describe("módulo opcional", () => {
  it("desligado: ninguém grava condomínio (nem o admin)", async () => {
    const e = await erroDe(() => comoAdmin(() => db.query(`insert into cond_condominios (nome) values ('Ed. Sol')`)));
    expect(e).toMatch(/row-level security/i);
  });

  it("só o administrador liga; o modo pessoal não liga", async () => {
    expect(await erroDe(() => comoUsuario(db, GESTOR, () => db.query(`select public.cond_ligar_modulo(true)`))) ).toMatch(/Só o administrador/);
    expect(await erroDe(() => comoUsuario(db, GESTOR, () => db.query(`update organizacoes set modulo_condominios = true where id = $1`, [org])))).toMatch(
      /Só o administrador/,
    );
    expect(await erroDe(() => comoUsuario(db, PESSOAL, () => db.query(`select public.cond_ligar_modulo(true)`)))).toMatch(/modo imobiliária/);
    await comoAdmin(() => db.query(`select public.cond_ligar_modulo(true)`));
    expect((await um<{ m: boolean }>(`select modulo_condominios as m from organizacoes where id = $1`, [org])).m).toBe(true);
  });

  it("cria o condomínio com conta corrente e fundo de reserva; corretor não vê nem grava", async () => {
    await comoAdmin(async () => {
      ids.cond = await id(
        `insert into cond_condominios (nome, cnpj, cidade, uf, dia_vencimento, multa_pct, juros_mes_pct, fundo_reserva_pct, pix_chave, taxa_administracao)
         values ('Edifício Sol', '11.222.333/0001-81', 'Porto Alegre', 'RS', 10, 2, 1, 10, 'financeiro@sol.com.br', 450) returning id`,
      );
      ids.cond2 = await id(`insert into cond_condominios (nome) values ('Residencial Lua') returning id`);
      const contas = (await db.query<{ tipo: string; id: string }>(`select tipo, id from cond_contas where condominio_id = $1 order by tipo`, [ids.cond])).rows;
      expect(contas.map((c) => c.tipo)).toEqual(["corrente", "reserva"]);
      ids.corrente = contas.find((c) => c.tipo === "corrente")!.id;
      ids.reserva = contas.find((c) => c.tipo === "reserva")!.id;
      ids.corrente2 = (await um<{ id: string }>(`select id from cond_contas where condominio_id = $1 and tipo = 'corrente'`, [ids.cond2])).id;
    });
    const n = await comoUsuario(db, CORRETOR, async () => (await db.query(`select id from cond_condominios`)).rows.length);
    expect(n).toBe(0);
    expect(await erroDe(() => comoUsuario(db, CORRETOR, () => db.query(`insert into cond_condominios (nome) values ('X')`)))).toMatch(/row-level security/i);
    const nB = await comoUsuario(db, OUTRO, async () => (await db.query(`select id from cond_condominios`)).rows.length);
    expect(nB).toBe(0);
  });
});

describe("cadastro: blocos, unidades, frações e pessoas", () => {
  it("unidades com frações que fecham 1; aviso quando não fecha", async () => {
    await comoAdmin(async () => {
      ids.blocoA = await id(`insert into cond_blocos (condominio_id, nome) values ($1, 'Bloco A') returning id`, [ids.cond]);
      const u = `insert into cond_unidades (condominio_id, bloco_id, numero, fracao_ideal, area_privativa) values ($1, $2, $3, $4, $5) returning id`;
      ids.u101 = await id(u, [ids.cond, ids.blocoA, "101", 0.25, 70]);
      ids.u102 = await id(u, [ids.cond, ids.blocoA, "102", 0.25, 70]);
      ids.u201 = await id(u, [ids.cond, ids.blocoA, "201", 0.3, 84]);
      ids.u202 = await id(u, [ids.cond, ids.blocoA, "202", 0.199999, 56]);
      let f = await um<{ r: { ok: boolean; soma: string; escala: string | null } }>(`select public.cond_conferir_fracoes($1) as r`, [ids.cond]);
      // 0,999999 fecha dentro da tolerância de 4 unidades (2 milionésimos).
      expect(f.r.ok).toBe(true);
      await db.query(`update cond_unidades set fracao_ideal = 0.19 where id = $1`, [ids.u202]);
      f = await um(`select public.cond_conferir_fracoes($1) as r`, [ids.cond]);
      expect(f.r.ok).toBe(false);
      await db.query(`update cond_unidades set fracao_ideal = 0.2 where id = $1`, [ids.u202]);
      f = await um(`select public.cond_conferir_fracoes($1) as r`, [ids.cond]);
      expect(f.r.escala).toBe("unitaria");
      ids.uLua = await id(`insert into cond_unidades (condominio_id, numero, fracao_ideal) values ($1, '1', 1) returning id`, [ids.cond2]);
    });
  });

  it("não aponta para bloco de outro condomínio nem pessoa de outra imobiliária", async () => {
    await comoAdmin(async () => {
      const e1 = await erroDe(() => db.query(`insert into cond_unidades (condominio_id, bloco_id, numero) values ($1, $2, '9')`, [ids.cond2, ids.blocoA]));
      expect(e1).toMatch(/não é deste condomínio/);
      const e2 = await erroDe(() => db.query(`insert into cond_pessoas_unidade (condominio_id, unidade_id, pessoa_id, papel) values ($1, $2, $3, 'morador')`, [ids.cond, ids.u101, ids.pessoaB]));
      expect(e2).toMatch(/Pessoa não encontrada/);
      const e3 = await erroDe(() => db.query(`insert into cond_pessoas_unidade (condominio_id, pessoa_id, papel) values ($1, $2, 'morador')`, [ids.cond, ids.ana]));
      expect(e3).toMatch(/Escolha a unidade/);
    });
  });

  it("vínculos: condômina, inquilina responsável financeira e síndico vai para o cadastro", async () => {
    await comoAdmin(async () => {
      const v = `insert into cond_pessoas_unidade (condominio_id, unidade_id, pessoa_id, papel, responsavel_financeiro) values ($1, $2, $3, $4, $5)`;
      await db.query(v, [ids.cond, ids.u101, ids.ana, "proprietario", true]);
      await db.query(v, [ids.cond, ids.u102, ids.bia, "inquilino", true]);
      await db.query(v, [ids.cond, null, ids.caio, "sindico", false]);
      const e = await erroDe(() => db.query(v, [ids.cond, ids.u101, ids.bia, "morador", true]));
      expect(e).toMatch(/duplicate key|unique/i);
      const s = await um<{ sindico_id: string }>(`select sindico_id from cond_condominios where id = $1`, [ids.cond]);
      expect(s.sindico_id).toBe(ids.caio);
    });
  });

  it("troca de síndico: liga o novo, encerra o antigo — o antigo não volta; sem mandato em vigor fica vazio", async () => {
    await comoAdmin(async () => {
      const sindico = async () => (await um<{ s: string | null }>(`select sindico_id as s from cond_condominios where id = $1`, [ids.cond])).s;
      const nina = await id(`insert into pessoas (nome) values ('Nina Nova Síndica') returning id`);
      const vNina = await id(`insert into cond_pessoas_unidade (condominio_id, pessoa_id, papel) values ($1, $2, 'sindico') returning id`, [ids.cond, nina]);
      expect(await sindico()).toBe(nina);
      // Encerrar o mandato do antigo (fim = hoje, como a tela faz) não traz o antigo de volta.
      await db.query(`update cond_pessoas_unidade set fim = privado.cond_hoje() where condominio_id = $1 and pessoa_id = $2 and papel = 'sindico'`, [ids.cond, ids.caio]);
      expect(await sindico()).toBe(nina);
      // Encerrar o mandato de quem está no cadastro: sem outro síndico em vigor, fica vazio.
      await db.query(`update cond_pessoas_unidade set fim = privado.cond_hoje() where id = $1`, [vNina]);
      expect(await sindico()).toBeNull();
      // Religa o Caio; excluir o vínculo dele também tira do cadastro.
      const vCaio = await id(`insert into cond_pessoas_unidade (condominio_id, pessoa_id, papel) values ($1, $2, 'sindico') returning id`, [ids.cond, ids.caio]);
      expect(await sindico()).toBe(ids.caio);
      await db.query(`delete from cond_pessoas_unidade where id = $1`, [vCaio]);
      expect(await sindico()).toBeNull();
      await db.query(`insert into cond_pessoas_unidade (condominio_id, pessoa_id, papel) values ($1, $2, 'sindico')`, [ids.cond, ids.caio]);
      expect(await sindico()).toBe(ids.caio);
    });
  });
});

describe("orçamento, cotas e baixa", () => {
  it("rateio sem perder centavo é igual no banco e no sistema", async () => {
    const casos: [number, number[]][] = [
      [100, [1, 1, 1]],
      [140001, [250000, 250000, 300000, 200000]],
      [99999, [333333, 333333, 333334]],
      [5, [7, 3, 3, 1]],
    ];
    for (const [total, pesos] of casos) {
      const r = await um<{ r: string[] }>(`select privado.cond_ratear($1::bigint, $2::numeric[]) as r`, [total, pesos]);
      expect(r.r.map(Number)).toEqual(ratear(total, pesos));
    }
  });

  it("gera as cotas pelo orçamento aprovado (igual a calcularCotas) e não duplica", async () => {
    await comoAdmin(async () => {
      ids.orc = await id(`insert into cond_orcamentos (condominio_id, ano) values ($1, 2026) returning id`, [ids.cond]);
      await db.query(
        `insert into cond_orcamento_itens (condominio_id, orcamento_id, categoria, tipo, valor_mensal) values
           ($1, $2, 'Limpeza', 'despesa', 1000), ($1, $2, 'Energia', 'despesa', 500.01), ($1, $2, 'Outras receitas', 'receita', 100)`,
        [ids.cond, ids.orc],
      );
      expect(await erroDe(() => db.query(`select public.cond_gerar_cotas($1, '2026-01-01')`, [ids.cond]))).toMatch(/Sem orçamento aprovado/);
      await db.query(`update cond_orcamentos set status = 'aprovado' where id = $1`, [ids.orc]);
      expect(await erroDe(() => db.query(`insert into cond_orcamento_itens (condominio_id, orcamento_id, categoria, valor_mensal) values ($1, $2, 'X', 1)`, [ids.cond, ids.orc]))).toMatch(
        /já foi aprovado/,
      );
      ids.rateio = await id(
        `insert into cond_rateios (condominio_id, descricao, valor_total, parcelas, primeira_competencia, criterio) values ($1, 'Pintura', 1000, 3, '2026-01-01', 'igual') returning id`,
        [ids.cond],
      );
      ids.consumo = await id(`insert into cond_consumos (condominio_id, unidade_id, competencia, tipo, valor) values ($1, $2, '2026-01-15', 'agua', 45.67) returning id`, [ids.cond, ids.u101]);

      const r = await um<{ r: { criadas: number; existentes: number; total: number; vencimento: string } }>(`select public.cond_gerar_cotas($1, '2026-01-01') as r`, [ids.cond]);
      expect(r.r.criadas).toBe(4);
      const de = (await db.query<{ id: string; fracao_ideal: string; area_privativa: string }>(`select id, fracao_ideal, area_privativa from cond_unidades where condominio_id = $1`, [ids.cond])).rows;
      const esperado = calcularCotas({
        competencia: "2026-01-01",
        unidades: de.map((u) => ({ id: u.id, fracao: Number(u.fracao_ideal), area: Number(u.area_privativa) })),
        criterio: "fracao" as CriterioRateio,
        base: 140001,
        fundoReservaPct: 10,
        rateios: [{ id: ids.rateio, descricao: "Pintura", valorTotal: 100000, parcelas: 3, primeiraCompetencia: "2026-01-01", criterio: "igual" }],
        consumos: [{ id: ids.consumo, unidadeId: ids.u101, tipo: "agua", valor: 4567 }],
      });
      const cotas = (
        await db.query<{ unidade_id: string; valor: string; vencimento: string; itens: { tipo: string; valor: string }[] }>(
          `select q.unidade_id, q.valor, q.vencimento::text, (select json_agg(json_build_object('tipo', i.tipo, 'valor', i.valor)) from cond_cota_itens i where i.cota_id = q.id) as itens
             from cond_cotas q where q.condominio_id = $1 and q.competencia = '2026-01-01'`,
          [ids.cond],
        )
      ).rows;
      for (const e of esperado) {
        const c = cotas.find((x) => x.unidade_id === e.unidadeId)!;
        expect(centavos(c.valor)).toBe(e.total);
        for (const t of ["ordinaria", "fundo_reserva", "rateio_extra", "consumo"]) {
          const soma = (xs: { tipo: string; valor: unknown }[]) => xs.filter((i) => i.tipo === t).reduce((a, i) => a + centavos(i.valor), 0);
          expect(soma(c.itens)).toBe(soma(e.itens.map((i) => ({ tipo: i.tipo, valor: i.valor / 100 }))));
        }
      }
      // Sem perder centavo: as partes ordinárias somam exatamente a base.
      const ordinarias = esperado.reduce((a, e) => a + e.itens.filter((i) => i.tipo === "ordinaria").reduce((s, i) => s + i.valor, 0), 0);
      expect(ordinarias).toBe(140001);
      expect(cotas[0].vencimento).toBe("2026-01-10");
      const de2 = await um<{ r: { criadas: number; existentes: number } }>(`select public.cond_gerar_cotas($1, '2026-01-01') as r`, [ids.cond]);
      expect(de2.r).toMatchObject({ criadas: 0, existentes: 4 });
      // Consumo cobrado não muda mais.
      expect(await erroDe(() => db.query(`update cond_consumos set valor = 1 where id = $1`, [ids.consumo]))).toMatch(/já foi cobrado/);
    });
  });

  it("cotas só pelo banco: ninguém insere direto", async () => {
    const e = await erroDe(() =>
      comoAdmin(() => db.query(`insert into cond_cotas (condominio_id, unidade_id, competencia, vencimento, valor) values ($1, $2, '2026-02-01', '2026-02-10', 10)`, [ids.cond, ids.u101])),
    );
    expect(e).toMatch(/row-level security/i);
  });

  it("baixa parcial com multa e juros: receita no livro-caixa, fundo na conta do fundo; estorno desfaz", async () => {
    await comoUsuario(db, FINANCEIRO, async () => {
      const c = await um<{ id: string; valor: string }>(`select id, valor from cond_cotas where unidade_id = $1 and competencia = '2026-01-01'`, [ids.u101]);
      ids.cota101 = c.id;
      const pag = await um<{ id: string }>(`select public.cond_registrar_pagamento($1, '2026-02-10', 110, 5, 5, 0, 'pix') as id`, [c.id]);
      ids.pag1 = pag.id;
      let q = await um<{ status: string; valor_abatido: string }>(`select status, valor_abatido from cond_cotas where id = $1`, [c.id]);
      expect(q.status).toBe("aberta");
      expect(Number(q.valor_abatido)).toBe(100);
      const lancs = (await db.query<{ conta_id: string; categoria: string; valor: string }>(`select conta_id, categoria, valor from cond_lancamentos where cota_pagamento_id = $1`, [pag.id])).rows;
      expect(lancs.reduce((a, l) => a + centavos(l.valor), 0)).toBe(11000);
      expect(lancs.some((l) => l.conta_id === ids.reserva && l.categoria === "Fundo de reserva")).toBe(true);
      expect(lancs.find((l) => l.categoria === "Multa e juros")?.valor).toBe("10.00");
      expect(await erroDe(() => db.query(`select public.cond_registrar_pagamento($1, '2026-02-10', 99999, 0, 0, 0)`, [c.id]))).toMatch(/passa do saldo/);
      // Lançamento de recebimento não se mexe à mão.
      expect(await erroDe(() => db.query(`delete from cond_lancamentos where cota_pagamento_id = $1`, [pag.id]))).toMatch(/estorne o recebimento/);
      expect(
        await erroDe(() =>
          db.query(`insert into cond_lancamentos (condominio_id, tipo, descricao, valor, competencia, status, cota_pagamento_id) values ($1, 'receita', 'x', 1, '2026-02-01', 'pago', $2)`, [
            ids.cond,
            pag.id,
          ]),
        ),
      ).toMatch(/Receber/);
      const resto = Number(c.valor) - 100;
      await db.query(`select public.cond_registrar_pagamento($1, '2026-02-11', $2, 0, 0, 0, 'pix')`, [c.id, resto]);
      q = await um(`select status, valor_abatido from cond_cotas where id = $1`, [c.id]);
      expect(q.status).toBe("paga");
      await db.query(`select public.cond_estornar_pagamento($1, 'lançado errado')`, [ids.pag1]);
      q = await um(`select status, valor_abatido from cond_cotas where id = $1`, [c.id]);
      expect(q.status).toBe("aberta");
      expect(Number(q.valor_abatido)).toBeCloseTo(resto, 2);
      expect((await db.query(`select 1 from cond_lancamentos where cota_pagamento_id = $1`, [ids.pag1])).rows.length).toBe(0);
    });
  });

  it("a parte ordinária entra na conta corrente ESCOLHIDA; o fundo vai para a conta do fundo; conta de fundo não recebe cota", async () => {
    const bancoB = await comoAdmin(() => id(`insert into cond_contas (condominio_id, nome, tipo) values ($1, 'Banco B', 'corrente') returning id`, [ids.cond]));
    await comoUsuario(db, FINANCEIRO, async () => {
      const c = await um<{ id: string; valor: string }>(`select id, valor from cond_cotas where unidade_id = $1 and competencia = '2026-01-01'`, [ids.u201]);
      expect(await erroDe(() => db.query(`select public.cond_registrar_pagamento($1, '2026-03-05', 10, 0, 0, 0, 'pix', $2)`, [c.id, ids.reserva]))).toMatch(/conta corrente/);
      const pag = await um<{ id: string }>(`select public.cond_registrar_pagamento($1, '2026-03-05', $2, 0, 0, 0, 'pix', $3) as id`, [c.id, c.valor, bancoB]);
      const lancs = (await db.query<{ conta_id: string; valor: string }>(`select conta_id, valor from cond_lancamentos where cota_pagamento_id = $1`, [pag.id])).rows;
      const naConta = (conta: string) => lancs.filter((l) => l.conta_id === conta).reduce((a, l) => a + centavos(l.valor), 0);
      const itens = (await db.query<{ tipo: string; valor: string }>(`select tipo, valor from cond_cota_itens where cota_id = $1`, [c.id])).rows;
      const fundo = itens.filter((i) => i.tipo === "fundo_reserva").reduce((a, i) => a + centavos(i.valor), 0);
      expect(fundo).toBeGreaterThan(0);
      expect(naConta(ids.reserva)).toBe(fundo);
      expect(naConta(bancoB)).toBe(centavos(c.valor) - fundo);
      expect(naConta(ids.corrente)).toBe(0);
      expect(lancs.reduce((a, l) => a + centavos(l.valor), 0)).toBe(centavos(c.valor));
      // O saldo e o extrato da conta B mostram o dinheiro.
      const saldos = await um<{ r: { id: string; saldo: number }[] }>(`select public.cond_saldos($1, '2026-12-31') as r`, [ids.cond]);
      expect(centavos(saldos.r.find((x) => x.id === bancoB)!.saldo)).toBe(centavos(c.valor) - fundo);
    });
  });

  it("corretor e outra imobiliária não dão baixa", async () => {
    expect(await erroDe(() => comoUsuario(db, CORRETOR, () => db.query(`select public.cond_registrar_pagamento($1, '2026-02-10', 1)`, [ids.cota101])))).toMatch(/Só administradores|não encontrad/);
    expect(await erroDe(() => comoUsuario(db, OUTRO, () => db.query(`select public.cond_registrar_pagamento($1, '2026-02-10', 1)`, [ids.cota101])))).toMatch(/não encontrad|desligado/);
  });
});

describe("fundo de reserva e fechamento do mês", () => {
  it("saída do fundo só com aprovação e por admin/gestor", async () => {
    const ins = `insert into cond_lancamentos (condominio_id, conta_id, tipo, categoria, descricao, valor, competencia, status, pago_em, aprovacao_texto)
                 values ($1, $2, 'despesa', 'Obras', 'Troca do portão', 50, '2026-02-01', 'pago', '2026-02-12', $3)`;
    await comoAdmin(() => db.query(`update cond_contas set saldo_inicial = 1000 where id = $1`, [ids.reserva]));
    expect(await erroDe(() => comoAdmin(() => db.query(ins, [ids.cond, ids.reserva, null])))).toMatch(/precisa de aprovação/);
    expect(await erroDe(() => comoUsuario(db, FINANCEIRO, () => db.query(ins, [ids.cond, ids.reserva, "AGE de 10/02"])))).toMatch(/Só administradores e gestores/);
    await comoUsuario(db, GESTOR, () => db.query(ins, [ids.cond, ids.reserva, "AGE de 10/02"]));
    const ev = await comoAdmin(() => um<{ n: number }>(`select count(*)::int as n from cond_eventos where condominio_id = $1 and tipo = 'fundo_saida'`, [ids.cond]));
    expect(ev.n).toBe(1);
    const saldos = await comoAdmin(() => um<{ r: { tipo: string; saldo: number }[] }>(`select public.cond_saldos($1, '2026-12-31') as r`, [ids.cond]));
    expect(saldos.r.find((s) => s.tipo === "reserva")!.saldo).toBeGreaterThan(0);
  });

  it("o tipo da conta não muda (trocar seria atalho para sacar do fundo sem aprovação)", async () => {
    // O financeiro (barrado na saída do fundo) tenta virar a conta do fundo em "outro fundo" ou em conta corrente.
    for (const tipo of ["fundo", "corrente"]) {
      expect(await erroDe(() => comoUsuario(db, FINANCEIRO, () => db.query(`update cond_contas set tipo = $2 where id = $1`, [ids.reserva, tipo])))).toMatch(/tipo da conta não muda/);
    }
    expect(await erroDe(() => comoAdmin(() => db.query(`update cond_contas set tipo = 'corrente' where id = $1`, [ids.reserva])))).toMatch(/tipo da conta não muda/);
    // Saída de "outro fundo" também precisa de aprovação e de admin/gestor.
    const outro = await comoAdmin(() => id(`insert into cond_contas (condominio_id, nome, tipo) values ($1, 'Fundo de obras', 'fundo') returning id`, [ids.cond]));
    const ins = `insert into cond_lancamentos (condominio_id, conta_id, tipo, categoria, descricao, valor, competencia, status, pago_em, aprovacao_texto)
                 values ($1, $2, 'despesa', 'Obras', 'Material', 10, '2026-03-01', 'pago', '2026-03-02', $3)`;
    expect(await erroDe(() => comoUsuario(db, FINANCEIRO, () => db.query(ins, [ids.cond, outro, "AGE"])))).toMatch(/Só administradores e gestores/);
    expect(await erroDe(() => comoUsuario(db, GESTOR, () => db.query(ins, [ids.cond, outro, null])))).toMatch(/precisa de aprovação/);
  });

  it("fechar trava os lançamentos pagos no mês; reabrir só o admin, com motivo", async () => {
    await comoUsuario(db, FINANCEIRO, () => db.query(`select public.cond_fechar_mes($1, '2026-02-01')`, [ids.cond]));
    const ins = `insert into cond_lancamentos (condominio_id, tipo, categoria, descricao, valor, competencia, status, pago_em) values ($1, 'despesa', 'Limpeza', 'Material', 30, '2026-02-01', 'pago', '2026-02-20')`;
    expect(await erroDe(() => comoUsuario(db, FINANCEIRO, () => db.query(ins, [ids.cond])))).toMatch(/está fechado/);
    expect(await erroDe(() => comoUsuario(db, FINANCEIRO, () => db.query(`select public.cond_estornar_pagamento(id, 'x') from cond_cota_pagamentos where estornado_em is null and cota_id = $1`, [ids.cota101])))).toMatch(
      /está fechado/,
    );
    const resumo = await comoAdmin(() => um<{ resumo: { fechado: boolean; total_receitas: number } }>(`select resumo from cond_fechamentos where condominio_id = $1`, [ids.cond]));
    expect(resumo.resumo.fechado).toBe(true);
    // Com mês fechado, o saldo inicial das contas não muda (mudaria os balancetes fechados), nem em conta nova.
    expect(await erroDe(() => comoAdmin(() => db.query(`update cond_contas set saldo_inicial = 5000 where id = $1`, [ids.reserva])))).toMatch(/saldo inicial não muda/);
    expect(await erroDe(() => comoAdmin(() => db.query(`insert into cond_contas (condominio_id, nome, saldo_inicial) values ($1, 'Poupança', 300)`, [ids.cond])))).toMatch(/saldo inicial não muda/);
    // O nome muda à vontade.
    await comoAdmin(() => db.query(`update cond_contas set nome = 'Fundo de reserva (poupança)', saldo_inicial = saldo_inicial where id = $1`, [ids.reserva]));
    expect(await erroDe(() => comoUsuario(db, GESTOR, () => db.query(`select public.cond_reabrir_mes($1, '2026-02-01', 'ajuste')`, [ids.cond])))).toMatch(/Só o administrador/);
    expect(await erroDe(() => comoAdmin(() => db.query(`select public.cond_reabrir_mes($1, '2026-02-01', '')`, [ids.cond])))).toMatch(/motivo/);
    await comoAdmin(() => db.query(`select public.cond_reabrir_mes($1, '2026-02-01', 'faltou a nota da limpeza')`, [ids.cond]));
    await comoUsuario(db, FINANCEIRO, () => db.query(ins, [ids.cond]));
  });

  it("excluir a pessoa fornecedora de um lançamento pago em mês fechado só tira a ligação", async () => {
    await comoAdmin(async () => {
      const forn = await id(`insert into pessoas (nome, papeis) values ('Jardim & Cia', '{prestador}') returning id`);
      const l = await id(
        `insert into cond_lancamentos (condominio_id, tipo, categoria, descricao, valor, competencia, status, pago_em, fornecedor_id)
         values ($1, 'despesa', 'Jardinagem', 'Poda', 120, '2026-03-01', 'pago', '2026-03-10', $2) returning id`,
        [ids.cond, forn],
      );
      await db.query(`select public.cond_fechar_mes($1, '2026-03-01')`, [ids.cond]);
      expect(await erroDe(() => db.query(`delete from pessoas where id = $1`, [forn]))).toBe("");
      const x = await um<{ fornecedor_id: string | null; valor: string; status: string }>(`select fornecedor_id, valor, status from cond_lancamentos where id = $1`, [l]);
      expect(x).toMatchObject({ fornecedor_id: null, valor: "120.00", status: "pago" });
      // Mexer de verdade no lançamento continua barrado.
      expect(await erroDe(() => db.query(`update cond_lancamentos set valor = 1 where id = $1`, [l]))).toMatch(/está fechado/);
      await db.query(`select public.cond_reabrir_mes($1, '2026-03-01', 'teste')`, [ids.cond]);
    });
  });

  it("balancete agregado no banco", async () => {
    const b = await comoAdmin(() =>
      um<{ r: { total_receitas: number; total_despesas: number; despesas: { categoria: string }[]; fundo: { saidas: number } } }>(`select public.cond_balancete($1, '2026-02-01') as r`, [ids.cond]),
    );
    expect(Number(b.r.total_despesas)).toBe(80);
    expect(b.r.despesas.map((d) => d.categoria).sort()).toEqual(["Limpeza", "Obras"]);
    expect(Number(b.r.fundo.saidas)).toBe(50);
    // Inadimplência na posição do FIM do mês (não pelo status de hoje): a cota paga em março conta em janeiro.
    const jan = await comoAdmin(() => um<{ r: { inadimplencia: { em: string; unidades: number; valor: number } } }>(`select public.cond_balancete($1, '2026-01-01') as r`, [ids.cond]));
    const emitidoJan = await um<{ v: string }>(`select sum(valor) as v from cond_cotas where condominio_id = $1 and competencia = '2026-01-01' and status <> 'cancelada'`, [ids.cond]);
    expect(jan.r.inadimplencia.em).toBe("2026-01-31");
    expect(jan.r.inadimplencia.unidades).toBe(4);
    expect(centavos(jan.r.inadimplencia.valor)).toBe(centavos(emitidoJan.v));
    const pr = await comoAdmin(() => um<{ r: { previsto: unknown[]; realizado: { categoria: string; mes: number }[] } }>(`select public.cond_previsto_realizado($1, 2026) as r`, [ids.cond]));
    expect(pr.r.previsto).toHaveLength(3);
    expect(pr.r.realizado.some((x) => x.categoria === "Limpeza" && x.mes === 2)).toBe(true);
  });
});

describe("inadimplência e acordo", () => {
  it("lista a unidade em atraso com multa e juros e faz o acordo sem perder centavo", async () => {
    await comoUsuario(db, FINANCEIRO, async () => {
      const inad = await um<{ r: { unidade_id: string; saldo: number; corrigido: number; dias: number; cota_ids: string[] }[] }>(`select public.cond_inadimplencia($1) as r`, [ids.cond]);
      const u102 = inad.r.find((x) => x.unidade_id === ids.u102)!;
      expect(Number(u102.corrigido)).toBeGreaterThan(Number(u102.saldo));
      expect(u102.dias).toBeGreaterThan(30);
      await db.query(`select public.cond_marcar_juridico($1, true, 'Processo 123')`, [ids.u102]);
      const hoje = (await um<{ d: string }>(`select privado.cond_hoje()::text as d`)).d;
      const acordo = await um<{ id: string }>(`select public.cond_criar_acordo($1, $2::uuid[], 3, $3::date, 0) as id`, [ids.u102, u102.cota_ids, hoje]);
      const a = await um<{ valor_total: string }>(`select valor_total from cond_acordos where id = $1`, [acordo.id]);
      expect(Number(a.valor_total)).toBeCloseTo(Number(u102.corrigido), 2);
      const parcelas = (await db.query<{ valor: string }>(`select valor from cond_cotas where acordo_parcela_de = $1 order by parcela`, [acordo.id])).rows;
      expect(parcelas).toHaveLength(3);
      expect(parcelas.reduce((s, p) => s + centavos(p.valor), 0)).toBe(centavos(a.valor_total));
      const orig = await um<{ status: string }>(`select status from cond_cotas where id = $1`, [u102.cota_ids[0]]);
      expect(orig.status).toBe("renegociada");
      await db.query(`select public.cond_cancelar_acordo($1, 'desistiu')`, [acordo.id]);
      expect((await um<{ status: string }>(`select status from cond_cotas where id = $1`, [u102.cota_ids[0]])).status).toBe("aberta");
    });
  });
});

describe("fornecedores, taxa de administração e reservas", () => {
  it("contrato mensal gera a previsão do mês uma vez só", async () => {
    await comoAdmin(async () => {
      await db.query(
        `insert into cond_contratos_fornecedores (condominio_id, fornecedor_id, servico, categoria, valor, periodicidade, inicio, dia_vencimento)
         values ($1, $2, 'Limpeza', 'Limpeza', 2000, 'mensal', '2026-01-01', 5), ($1, $2, 'Dedetização', 'Manutenção', 300, 'trimestral', '2026-01-01', 15)`,
        [ids.cond, ids.forn],
      );
      expect((await um<{ n: number }>(`select public.cond_gerar_previsoes($1, '2026-03-01') as n`, [ids.cond])).n).toBe(1);
      expect((await um<{ n: number }>(`select public.cond_gerar_previsoes($1, '2026-04-01') as n`, [ids.cond])).n).toBe(2);
      expect((await um<{ n: number }>(`select public.cond_gerar_previsoes($1, '2026-04-01') as n`, [ids.cond])).n).toBe(0);
    });
  });

  it("taxa de administração vai UMA vez para o financeiro da imobiliária", async () => {
    await comoAdmin(async () => {
      const l = await um<{ id: string }>(`select public.cond_lancar_taxa_admin($1, '2026-03-01') as id`, [ids.cond]);
      const lanc = await um<{ tipo: string; valor: string }>(`select tipo, valor from lancamentos where id = $1`, [l.id]);
      expect(lanc).toMatchObject({ tipo: "receber", valor: "450.00" });
      expect(await erroDe(() => db.query(`select public.cond_lancar_taxa_admin($1, '2026-03-15')`, [ids.cond]))).toMatch(/já foi lançada/);
    });
  });

  it("reserva sem conflito de horário (encostar pode, cruzar não)", async () => {
    await comoAdmin(async () => {
      ids.salao = await id(`insert into cond_areas (condominio_id, nome, taxa, antecedencia_min_horas) values ($1, 'Salão de festas', 80, 24) returning id`, [ids.cond]);
      const r = `insert into cond_reservas (condominio_id, area_id, unidade_id, inicio, fim, status) values ($1, $2, $3, $4, $5, 'confirmada') returning id`;
      ids.res1 = await id(r, [ids.cond, ids.salao, ids.u101, "2026-01-20 18:00-03", "2026-01-20 23:00-03"]);
      expect(await erroDe(() => db.query(r, [ids.cond, ids.salao, ids.u102, "2026-01-20 22:00-03", "2026-01-21 02:00-03"]))).toMatch(/Já existe reserva/);
      await db.query(r, [ids.cond, ids.salao, ids.u102, "2026-01-20 23:00-03", "2026-01-21 02:00-03"]);
      // Taxa vem da área e entra na cota do mês seguinte.
      expect((await um<{ taxa: string }>(`select taxa from cond_reservas where id = $1`, [ids.res1])).taxa).toBe("80.00");
      await db.query(`select public.cond_gerar_cotas($1, '2026-02-01')`, [ids.cond]);
      const item = await um<{ n: number }>(`select count(*)::int as n from cond_cota_itens where reserva_id = $1`, [ids.res1]);
      expect(item.n).toBe(1);
    });
  });
});

describe("portal do condômino", () => {
  it("link só para quem está ligado ao condomínio e com documento/telefone", async () => {
    await comoAdmin(async () => {
      expect(await erroDe(() => db.query(`insert into cond_portal_acessos (condominio_id, pessoa_id) values ($1, $2)`, [ids.cond, ids.forn]))).toMatch(/não está ligada/);
      await db.query(`insert into cond_pessoas_unidade (condominio_id, unidade_id, pessoa_id, papel) values ($1, $2, $3, 'morador')`, [ids.cond, ids.u201, ids.semDoc]);
      expect(await erroDe(() => db.query(`insert into cond_portal_acessos (condominio_id, pessoa_id) values ($1, $2)`, [ids.cond, ids.semDoc]))).toMatch(/CPF\/CNPJ ou o telefone/);
      const a = await um<{ id: string; token: string }>(`insert into cond_portal_acessos (condominio_id, pessoa_id) values ($1, $2) returning id, token`, [ids.cond, ids.ana]);
      ids.acesso = a.id;
      token = a.token;
      const b = await um<{ token: string }>(`insert into cond_portal_acessos (condominio_id, pessoa_id) values ($1, $2) returning token`, [ids.cond, ids.bia]);
      ids.tokenBia = b.token;
    });
    expect(await erroDe(() => comoUsuario(db, CORRETOR, () => db.query(`insert into cond_portal_acessos (condominio_id, pessoa_id) values ($1, $2)`, [ids.cond, ids.caio])))).toMatch(
      /row-level security/i,
    );
  });

  it("entrada com 4 números, sessão e leitura só do que é da pessoa", async () => {
    const ini = await anon<{ entrou: boolean; primeiro_nome: string; tipo_codigo: string }>(`select public.cond_portal_inicio($1, null) as r`, [token]);
    expect(ini).toMatchObject({ entrou: false, primeiro_nome: "Ana", tipo_codigo: "cpf" });
    const errado = await anon<{ ok: boolean; restantes: number }>(`select public.cond_portal_entrar($1, '9999', '1.1.1.1', 't') as r`, [token]);
    expect(errado).toMatchObject({ ok: false, restantes: 4 });
    expect(await dados("inicio")).toEqual({ erro: "sessao" });
    const certo = await anon<{ ok: boolean; sessao: string }>(`select public.cond_portal_entrar($1, '1234', '1.1.1.1', 't') as r`, [token]);
    expect(certo.ok).toBe(true);
    sessao = certo.sessao;
    const inicio = await dados<{ unidades: { id: string }[]; cotas_abertas: number }>("inicio");
    expect(inicio.unidades.map((u) => u.id)).toEqual([ids.u101]);
    const cotas = await dados<{ unidade: string }[]>("cotas");
    expect(cotas.length).toBeGreaterThan(0);
    expect(cotas.every((c) => c.unidade === "Bloco A - 101")).toBe(true);
    const outra = await um<{ id: string }>(`select id from cond_cotas where unidade_id = $1 limit 1`, [ids.u102]);
    expect(await dados("cota", { id: outra.id })).toBeNull();
    const minha = await dados<{ pix: { chave: string }; saldo: number }>("cota", { id: ids.cota101 });
    expect(minha.pix.chave).toBe("financeiro@sol.com.br");
    // Anônimo não lê tabela nenhuma.
    expect(await erroDe(() => comoAnonimo(db, () => db.query(`select * from cond_cotas`)))).toMatch(/permission denied/i);
  });

  it("comunicado para o bloco aparece e a leitura é registrada", async () => {
    await comoAdmin(() =>
      db.query(`insert into cond_comunicados (condominio_id, titulo, texto, publico, bloco_id) values ($1, 'Limpeza da caixa d''água', 'Dia 10 sem água das 8h às 12h.', 'bloco', $2)`, [ids.cond, ids.blocoA]),
    );
    const lista = await dados<{ id: string; lido: boolean }[]>("comunicados");
    expect(lista).toHaveLength(1);
    await anon(`select public.cond_portal_ler_comunicado($1, $2, $3) as r`, [token, sessao, lista[0].id]);
    expect((await dados<{ lido: boolean }[]>("comunicados"))[0].lido).toBe(true);
  });

  it("pede reserva respeitando antecedência e sem conflito", async () => {
    const amanha = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
    expect(
      await erroDe(() => anon(`select public.cond_portal_reservar($1, $2, $3, $4, $5, $6) as r`, [token, sessao, ids.salao, ids.u101, amanha(2), amanha(5)])),
    ).toMatch(/antecedência/);
    expect(
      await erroDe(() => anon(`select public.cond_portal_reservar($1, $2, $3, $4, $5, $6) as r`, [token, sessao, ids.salao, ids.u102, amanha(48), amanha(52)])),
    ).toMatch(/unidade sua/);
    const r = await anon<string>(`select public.cond_portal_reservar($1, $2, $3, $4, $5, $6) as r`, [token, sessao, ids.salao, ids.u101, amanha(48), amanha(52)]);
    expect(r).toBeTruthy();
    expect(
      await erroDe(() => anon(`select public.cond_portal_reservar($1, $2, $3, $4, $5, $6) as r`, [token, sessao, ids.salao, ids.u101, amanha(50), amanha(53)])),
    ).toMatch(/Já existe reserva/);
  });

  it("vota uma vez por unidade, só o condômino e só se a assembleia permitir", async () => {
    await comoAdmin(async () => {
      ids.ass = await id(`insert into cond_assembleias (condominio_id, titulo, data, voto_portal) values ($1, 'AGE pintura', now(), true) returning id`, [ids.cond]);
      ids.item = await id(`insert into cond_assembleia_itens (condominio_id, assembleia_id, ordem, titulo) values ($1, $2, 1, 'Aprovar a pintura') returning id`, [ids.cond, ids.ass]);
    });
    expect(await erroDe(() => anon(`select public.cond_portal_votar($1, $2, $3, $4, 'Sim') as r`, [token, sessao, ids.item, ids.u101]))).toMatch(/não está aberta/);
    await comoAdmin(() => db.query(`update cond_assembleias set status = 'em_andamento' where id = $1`, [ids.ass]));
    await anon(`select public.cond_portal_votar($1, $2, $3, $4, 'Sim') as r`, [token, sessao, ids.item, ids.u101]);
    expect(await erroDe(() => anon(`select public.cond_portal_votar($1, $2, $3, $4, 'Não') as r`, [token, sessao, ids.item, ids.u101]))).toMatch(/já votou/);
    const v = await comoAdmin(() => um<{ peso: string; origem: string }>(`select peso, origem from cond_votos where item_id = $1`, [ids.item]));
    expect(v).toMatchObject({ peso: "0.250000", origem: "portal" });
    // Equipe registra o voto presencial de outra unidade; não desfaz voto do portal.
    await comoAdmin(() => db.query(`select public.cond_registrar_voto($1, $2, 'Não')`, [ids.item, ids.u201]));
    // Desfazer voto (com a votação aberta) fica registrado.
    await comoAdmin(async () => {
      await db.query(`select public.cond_registrar_voto($1, $2, 'Sim')`, [ids.item, ids.u202]);
      const v = await um<{ id: string }>(`select id from cond_votos where item_id = $1 and unidade_id = $2`, [ids.item, ids.u202]);
      await db.query(`select public.cond_desfazer_voto($1)`, [v.id]);
      const ev = await um<{ descricao: string }>(`select descricao from cond_eventos where condominio_id = $1 and tipo = 'voto_desfeito'`, [ids.cond]);
      expect(ev.descricao).toMatch(/Voto "Sim" da unidade Bloco A - 202 desfeito/);
    });
    const vp = await comoAdmin(() => um<{ id: string }>(`select id from cond_votos where item_id = $1 and origem = 'portal'`, [ids.item]));
    expect(await erroDe(() => comoAdmin(() => db.query(`select public.cond_desfazer_voto($1)`, [vp.id])))).toMatch(/portal não pode/);
    // Inquilina não vota.
    const entrouBia = await anon<{ sessao: string }>(`select public.cond_portal_entrar($1, '9876') as r`, [ids.tokenBia]);
    expect(
      await erroDe(() => anon(`select public.cond_portal_votar($1, $2, $3, $4, 'Sim') as r`, [ids.tokenBia, entrouBia.sessao, ids.item, ids.u102])),
    ).toMatch(/Só o condômino/);
    await comoAdmin(() => db.query(`update cond_assembleias set status = 'encerrada' where id = $1`, [ids.ass]));
    expect(await erroDe(() => comoAdmin(() => db.query(`delete from cond_assembleia_presencas where assembleia_id = $1`, [ids.ass])))).toMatch(/encerrada/);
    // Encerrada não volta (nem pela API) e não é excluída; os votos ficam.
    for (const st of ["em_andamento", "rascunho", "convocada", "cancelada"]) {
      expect(await erroDe(() => comoAdmin(() => db.query(`update cond_assembleias set status = $2 where id = $1`, [ids.ass, st])))).toMatch(/já foi encerrada/);
    }
    const vPres = await comoAdmin(() => um<{ id: string }>(`select id from cond_votos where item_id = $1 and unidade_id = $2`, [ids.item, ids.u201]));
    expect(await erroDe(() => comoAdmin(() => db.query(`select public.cond_desfazer_voto($1)`, [vPres.id])))).toMatch(/em andamento/);
    expect(await erroDe(() => comoAdmin(() => db.query(`delete from cond_assembleias where id = $1`, [ids.ass])))).toMatch(/não pode ser excluída/);
    expect(await erroDe(() => comoAdmin(() => db.query(`delete from cond_assembleia_itens where id = $1`, [ids.item])))).toMatch(/encerrada/);
    // A ata continua editável.
    await comoAdmin(() => db.query(`update cond_assembleias set ata = 'Ata da AGE' where id = $1`, [ids.ass]));
    expect((await um<{ n: number }>(`select count(*)::int as n from cond_votos where assembleia_id = $1`, [ids.ass])).n).toBe(2);
    // Unidade com cotas (ou que votou em assembleia encerrada) não é excluída — nem pela API.
    expect(await erroDe(() => comoAdmin(() => db.query(`delete from cond_unidades where id = $1`, [ids.u201])))).toMatch(/já tem cotas/);
  });

  it("ocorrência pelo portal com pasta de fotos e limite por dia", async () => {
    const r = await anon<{ id: string; envio: string; pasta: string }>(`select public.cond_portal_abrir_ocorrencia($1, $2, $3, 'barulho', 'Som alto', 'Toda noite') as r`, [
      token,
      sessao,
      ids.u101,
    ]);
    expect(r.pasta).toBe(`${org}/portal/${r.envio}`);
    expect((await anon<boolean>(`select public.cond_portal_pode_enviar($1) as r`, [`${r.pasta}/foto.jpg`]))).toBe(true);
    expect((await anon<boolean>(`select public.cond_portal_pode_enviar($1) as r`, [`${r.pasta}/script.html`]))).toBe(false);
    expect((await anon<boolean>(`select public.cond_portal_pode_enviar($1) as r`, [`${orgB}/portal/${r.envio}/foto.jpg`]))).toBe(false);
    await anon(`select public.cond_portal_registrar_foto($1, $2, $3, $4) as r`, [token, sessao, r.envio, `${r.pasta}/foto.jpg`]);
    expect(await erroDe(() => anon(`select public.cond_portal_registrar_foto($1, $2, $3, $4) as r`, [token, sessao, r.envio, `${org}/outra/foto.jpg`]))).toMatch(/fora da pasta/);
    await comoAdmin(() => db.query(`insert into cond_ocorrencia_respostas (condominio_id, ocorrencia_id, texto) values ($1, $2, 'Vamos notificar a unidade.')`, [ids.cond, r.id]));
    const oc = await comoAdmin(() => um<{ status: string; fotos: string[] }>(`select status, fotos from cond_ocorrencias where id = $1`, [r.id]));
    expect(oc).toMatchObject({ status: "em_andamento", fotos: [`${r.pasta}/foto.jpg`] });
    expect(await erroDe(() => comoAdmin(() => db.query(`delete from cond_ocorrencia_respostas where ocorrencia_id = $1`, [r.id])))).toBe("");
    expect((await comoAdmin(() => um<{ n: number }>(`select count(*)::int as n from cond_ocorrencia_respostas where ocorrencia_id = $1`, [r.id]))).n).toBe(1);
    for (let i = 0; i < 4; i++) await anon(`select public.cond_portal_abrir_ocorrencia($1, $2, null, 'sugestao', 'Ideia', '') as r`, [token, sessao]);
    expect(await erroDe(() => anon(`select public.cond_portal_abrir_ocorrencia($1, $2, null, 'sugestao', 'Mais uma', '') as r`, [token, sessao]))).toMatch(/Limite/);
  });

  it("módulo desligado: o portal sai do ar e ninguém grava", async () => {
    await comoAdmin(() => db.query(`select public.cond_ligar_modulo(false)`));
    expect(await anon(`select public.cond_portal_inicio($1, $2) as r`, [token, sessao])).toBeNull();
    expect(await erroDe(() => comoAdmin(() => db.query(`insert into cond_blocos (condominio_id, nome) values ($1, 'B')`, [ids.cond])))).toMatch(/row-level security/i);
    expect(await erroDe(() => comoAdmin(() => db.query(`select public.cond_gerar_cotas($1, '2026-03-01', 1000)`, [ids.cond])))).toMatch(/desligado/);
    // Os dados continuam lá para quando ligar de novo.
    expect((await comoAdmin(() => db.query(`select id from cond_condominios`))).rows.length).toBe(2);
    await comoAdmin(() => db.query(`select public.cond_ligar_modulo(true)`));
  });
});

describe("juntar repetidos e modo pessoal", () => {
  it("juntar leva vínculos, link e votos para o cadastro que fica", async () => {
    await comoAdmin(async () => {
      const copia = await id(`insert into pessoas (nome, documento) values ('Ana C.', '123.456.789-09') returning id`);
      await db.query(`insert into cond_pessoas_unidade (condominio_id, unidade_id, pessoa_id, papel) values ($1, $2, $3, 'morador')`, [ids.cond, ids.u202, copia]);
      await db.query(`select public.juntar_pessoas($1, $2)`, [copia, ids.ana]);
      const vinc = (await db.query<{ papel: string }>(`select papel from cond_pessoas_unidade where pessoa_id = $1 order by papel`, [copia])).rows.map((r) => r.papel);
      expect(vinc).toEqual(["morador", "proprietario"]);
      expect((await um<{ pessoa_id: string }>(`select pessoa_id from cond_portal_acessos where id = $1`, [ids.acesso])).pessoa_id).toBe(copia);
      expect((await um<{ pessoa_id: string }>(`select pessoa_id from cond_votos where origem = 'portal'`)).pessoa_id).toBe(copia);
    });
  });

  it("condomínio com histórico não é excluído (nem pela API); sem histórico sai, e o registro do portal fica", async () => {
    await comoAdmin(async () => {
      await db.query(`select public.cond_fechar_mes($1, '2026-02-01')`, [ids.cond]);
      expect(await erroDe(() => db.query(`delete from cond_condominios where id = $1`, [ids.cond]))).toMatch(/já tem histórico/);
      expect((await db.query(`select 1 from cond_lancamentos where condominio_id = $1`, [ids.cond])).rows.length).toBeGreaterThan(0);
      expect((await db.query(`select 1 from cond_votos where condominio_id = $1`, [ids.cond])).rows.length).toBeGreaterThan(0);
      // Residencial Lua: só cadastro (unidade, contas, um link do portal) — sai inteiro.
      await db.query(`insert into cond_pessoas_unidade (condominio_id, unidade_id, pessoa_id, papel) values ($1, $2, $3, 'morador')`, [ids.cond2, ids.uLua, ids.bia]);
      await db.query(`insert into cond_portal_acessos (condominio_id, pessoa_id) values ($1, $2)`, [ids.cond2, ids.bia]);
      await db.query(`delete from cond_condominios where id = $1`, [ids.cond2]);
      expect((await db.query(`select 1 from cond_unidades where condominio_id = $1`, [ids.cond2])).rows).toHaveLength(0);
    });
    // O registro do portal sobrevive (sem cascata).
    expect((await um<{ n: number }>(`select count(*)::int as n from cond_portal_eventos where condominio_id = $1`, [ids.cond2])).n).toBeGreaterThan(0);
  });

  it("excluir a organização inteira leva os condomínios, mesmo com histórico", async () => {
    const DONO = "00000000-0000-0000-0000-000000023a07";
    const o = await comoUsuario(db, DONO, async () => {
      const oid = (await um<{ id: string }>(`select public.criar_organizacao('Imob que fecha') as id`)).id;
      await db.query(`select public.cond_ligar_modulo(true)`);
      const c = await id(`insert into cond_condominios (nome) values ('Edifício Antigo') returning id`);
      await db.query(`insert into cond_lancamentos (condominio_id, tipo, descricao, valor, competencia, status, pago_em) values ($1, 'receita', 'Saldo trazido', 500, '2026-01-01', 'pago', '2026-01-05')`, [c]);
      await db.query(`select public.cond_fechar_mes($1, '2026-01-01')`, [c]);
      return oid;
    });
    await db.query(`select set_config('request.jwt.claim.sub', '', false)`);
    await db.query(`delete from organizacoes where id = $1`, [o]);
    expect((await db.query(`select 1 from cond_condominios where organizacao_id = $1`, [o])).rows).toHaveLength(0);
    expect((await db.query(`select 1 from cond_lancamentos where organizacao_id = $1`, [o])).rows).toHaveLength(0);
  });

  it("no modo pessoal não há condomínios", async () => {
    await db.query(`select set_config('request.jwt.claim.sub', '', false)`);
    await db.query(`update organizacoes set modulo_condominios = true, modo = 'imobiliaria' where id = $1`, [orgP]);
    await db.query(`update organizacoes set modo = 'pessoal' where id = $1`, [orgP]);
    expect(await erroDe(() => comoUsuario(db, PESSOAL, () => db.query(`insert into cond_condominios (nome) values ('X')`)))).toMatch(/row-level security/i);
  });
});

describe("migração", () => {
  it("pode rodar de novo sem erro (idempotente, sem DROP) e não duplica a chamada no juntar repetidos", async () => {
    const sql = readFileSync(join(__dirname, "..", "supabase", "migrations", "20261107000011_condominios.sql"), "utf8");
    expect(sql).not.toMatch(/\bdrop\s+(table|trigger|policy|function|constraint|index|column|view)/i);
    await db.exec(sql);
    const def = await um<{ d: string }>(`select pg_get_functiondef('public.juntar_pessoas(uuid, uuid)'::regprocedure) as d`);
    expect(def.d.split("privado.condominios_juntar_pessoas").length - 1).toBe(1);
  });
});

describe("Storage do portal (bucket simulado)", () => {
  it("fotos da ocorrência: até 6 por pasta contando o que já está lá, só com o link ativo, morador logado ou não", async () => {
    const st = new PGlite();
    await st.exec(`
      create role anon nologin; create role authenticated nologin;
      create schema auth;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
      create schema storage;
      create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
      create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, created_at timestamptz not null default now());
      alter table storage.objects enable row level security;
      create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
      grant usage on schema storage to anon, authenticated;
      grant select, insert, delete on storage.objects to anon, authenticated;
      grant execute on function storage.foldername(text) to anon, authenticated;
    `);
    const dir = join(__dirname, "..", "supabase", "migrations");
    for (const f of readdirSync(dir).sort()) await st.exec(readFileSync(join(dir, f), "utf8"));
    await st.exec(`grant usage on schema public to authenticated; grant select, insert, update, delete on all tables in schema public to authenticated;`);
    const U = "00000000-0000-0000-0000-000000023a51";
    const V = "00000000-0000-0000-0000-000000023a52";
    const q1 = async <T>(sql: string, params: unknown[] = []) => (await st.query<T>(sql, params)).rows[0];
    const base = await comoUsuario(st, U, async () => {
      const o = (await q1<{ id: string }>(`select public.criar_organizacao('Storage Condomínio') as id`)).id;
      await st.query(`select public.cond_ligar_modulo(true)`);
      const c = (await q1<{ id: string }>(`insert into cond_condominios (nome) values ('Ed. Foto') returning id`)).id;
      const u = (await q1<{ id: string }>(`insert into cond_unidades (condominio_id, numero, fracao_ideal) values ($1, '1', 1) returning id`, [c])).id;
      const p = (await q1<{ id: string }>(`insert into pessoas (nome, documento) values ('Morador Foto', '529.982.247-25') returning id`)).id;
      await st.query(`insert into cond_pessoas_unidade (condominio_id, unidade_id, pessoa_id, papel) values ($1, $2, $3, 'proprietario')`, [c, u, p]);
      const a = await q1<{ id: string; token: string }>(`insert into cond_portal_acessos (condominio_id, pessoa_id) values ($1, $2) returning id, token`, [c, p]);
      return { org: o, unidade: u, acesso: a.id, token: a.token };
    });
    await comoUsuario(st, V, () => st.query(`select public.criar_organizacao('Outra conta')`));
    const sess = await comoAnonimo(st, async () => (await q1<{ r: { sessao: string } }>(`select public.cond_portal_entrar($1, '5299') as r`, [base.token])).r.sessao);
    const abrir = () =>
      comoAnonimo(st, async () => (await q1<{ r: { envio: string; pasta: string } }>(`select public.cond_portal_abrir_ocorrencia($1, $2, $3, 'barulho', 'Som', '') as r`, [base.token, sess, base.unidade])).r);
    const enviarComo = (quem: "anon" | string, name: string) =>
      erroDe(() =>
        quem === "anon"
          ? comoAnonimo(st, () => st.query(`insert into storage.objects (bucket_id, name) values ('condominios', $1)`, [name]))
          : comoUsuario(st, quem, () => st.query(`insert into storage.objects (bucket_id, name) values ('condominios', $1)`, [name])),
      );
    const r = await abrir();
    // Sem registrar as fotos: o limite conta o que já está na pasta.
    for (let i = 1; i <= 6; i++) expect(await enviarComo("anon", `${r.pasta}/${i}.jpg`), String(i)).toBe("");
    expect(await enviarComo("anon", `${r.pasta}/7.jpg`)).toMatch(/row-level security/);
    // Maiúsculas não abrem "outra pasta" para escapar da contagem.
    expect(await enviarComo("anon", `${base.org.toUpperCase()}/portal/${r.envio.toUpperCase()}/8.jpg`)).toMatch(/row-level security/);
    // Quem está logado no mesmo navegador (de outra conta) também consegue enviar na pasta liberada.
    const r2 = await abrir();
    expect(await enviarComo(V, `${r2.pasta}/logado.jpg`)).toBe("");
    // Link desativado: a pasta deixa de aceitar arquivos.
    await comoUsuario(st, U, () => st.query(`update cond_portal_acessos set ativo = false where id = $1`, [base.acesso]));
    expect(await enviarComo("anon", `${r2.pasta}/depois.jpg`)).toMatch(/row-level security/);
    expect(await enviarComo(V, `${r2.pasta}/depois.jpg`)).toMatch(/row-level security/);
  });
});
