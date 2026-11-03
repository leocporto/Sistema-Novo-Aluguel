/**
 * Cobranças no banco (PGlite com todas as migrações): pagamentos parciais,
 * quitação, estornos, acordos, cobrança jurídica, auditoria, isolamento por
 * organização e a 2ª via pública por token.
 */
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { comoAnonimo, comoUsuario, criarBanco } from "./pglite";

const USER_A = "00000000-0000-0000-0000-000000000c01";
const USER_B = "00000000-0000-0000-0000-000000000c02";

let db: PGlite;
let org: string;
let contrato: string;
let prop: string;
const fat: Record<string, string> = {};

const um = async <T = string>(sql: string, p: unknown[] = [], col = "id") => (await db.query<Record<string, T>>(sql, p)).rows[0]?.[col] as T;

async function novaFatura(comp: string, venc: string, valor = 2000) {
  return um(`select public.registrar_fatura($1::jsonb) as id`, [
    JSON.stringify({
      contrato_id: contrato,
      competencia: comp,
      periodo_inicio: comp,
      periodo_fim: comp.slice(0, 8) + "28",
      vencimento: venc,
      valor_total: valor,
      itens: [{ descricao: `Aluguel ${comp}`, tipo: "aluguel", valor, destino: "proprietario" }],
    }),
  ]);
}

const repasse = (bruto: number) => ({
  pessoa_id: prop,
  percentual: 100,
  aluguel: 2000,
  encargos: 0,
  multa_juros: bruto - 2000,
  valor_bruto: bruto,
  taxa_administracao: 200,
  taxa_intermediacao: 0,
  irrf: 0,
  valor_liquido: bruto - 200,
  previsto_para: "2026-10-20",
});

beforeAll(async () => {
  db = await criarBanco();
  org = await comoUsuario(db, USER_A, () => um(`select public.criar_organizacao('Imob Cobra') as id`));
  await comoUsuario(db, USER_B, () => db.query(`select public.criar_organizacao('Outra Imob')`));
  await comoUsuario(db, USER_A, async () => {
    prop = await um(`insert into pessoas (nome, papeis) values ('Paula Proprietária','{proprietario}') returning id`);
    const loc = await um(`insert into pessoas (nome, papeis, telefone) values ('Luís Locatário','{locatario}','51999990000') returning id`);
    const im = await um(`insert into imoveis (codigo, logradouro, numero, cidade, status) values ('CB-1','Rua das Flores','100','Canoas','alugado') returning id`);
    contrato = await um(
      `insert into contratos (imovel_id, data_inicio, prazo_meses, data_fim, valor_aluguel, dia_vencimento, data_base_reajuste)
       values ($1, '2026-01-01', 30, '2028-06-30', 2000, 10, '2026-01-01') returning id`,
      [im],
    );
    await db.query(`insert into contrato_partes (contrato_id, pessoa_id, papel, percentual) values ($1,$2,'proprietario',100), ($1,$3,'locatario',null)`, [contrato, prop, loc]);
    fat.set = await novaFatura("2026-09-01", "2026-09-10");
    fat.out = await novaFatura("2026-10-01", "2026-10-10");
    fat.nov = await novaFatura("2026-11-01", "2026-11-10");
    fat.dez = await novaFatura("2026-12-01", "2026-12-10");
  });
});

describe("cobranças: pagamentos parciais, quitação e estorno", () => {
  it("parcial abate o saldo; o que quita gera repasse e itens da baixa; o estorno tira só o último", async () => {
    const r = await comoUsuario(db, USER_A, async () => {
      const receber = (p: object) => db.query(`select public.registrar_recebimento($1::jsonb) as r`, [JSON.stringify(p)]);
      // 1º recebimento: R$ 800 (parcial, sem encargos)
      await receber({ pagamentos: [{ fatura_id: fat.out, pago_em: "2026-10-15", valor: 800, principal: 800, forma: "pix" }] });
      const parcial = (await db.query<{ status: string; valor_abatido: string; valor_recebido: string }>(`select status, valor_abatido, valor_recebido from faturas where id = $1`, [fat.out])).rows[0];
      // Passar do saldo é recusado
      let excesso = "";
      try {
        await receber({ pagamentos: [{ fatura_id: fat.out, pago_em: "2026-10-16", valor: 1300, principal: 1300 }] });
      } catch (e) {
        excesso = String(e);
      }
      // 2º recebimento quita: 1200 + multa 200 + juros 12
      await receber({
        pagamentos: [{ fatura_id: fat.out, pago_em: "2026-10-20", valor: 1412, principal: 1200, multa: 200, juros: 12, forma: "transferencia" }],
        liquidacoes: [
          {
            fatura_id: fat.out,
            p: {
              pago_em: "2026-10-20",
              valor_pago: 2212,
              forma_pagamento: "transferencia",
              itens_extras: [
                { descricao: "Multa por atraso (10%)", tipo: "multa", valor: 200, destino: "proprietario" },
                { descricao: "Juros de mora", tipo: "juros", valor: 12, destino: "proprietario" },
              ],
              repasses: [repasse(2212)],
              receita_imobiliaria: 200,
            },
          },
        ],
      });
      const paga = (await db.query<{ status: string; valor_pago: string; valor_abatido: string }>(`select status, valor_pago, valor_abatido from faturas where id = $1`, [fat.out])).rows[0];
      const itens = (await db.query<{ tipo: string; da_baixa: boolean }>(`select tipo, da_baixa from fatura_itens where fatura_id = $1 order by tipo`, [fat.out])).rows;
      const rep = (await db.query(`select id from repasses where fatura_id = $1`, [fat.out])).rows.length;
      // Desfazer a baixa: sai o último recebimento, o primeiro (parcial) fica
      await db.query(`select public.estornar_baixa($1)`, [fat.out]);
      const desfeita = (await db.query<{ status: string; valor_abatido: string }>(`select status, valor_abatido from faturas where id = $1`, [fat.out])).rows[0];
      const restam = (await db.query<{ valor: string }>(`select valor from fatura_pagamentos where fatura_id = $1`, [fat.out])).rows.map((x) => Number(x.valor));
      const itens2 = (await db.query(`select id from fatura_itens where fatura_id = $1`, [fat.out])).rows.length;
      const rep2 = (await db.query(`select id from repasses where fatura_id = $1`, [fat.out])).rows.length;
      const lanc2 = (await db.query(`select id from lancamentos where fatura_id = $1`, [fat.out])).rows.length;
      // Desfazer também o parcial
      const pg = await um(`select id from fatura_pagamentos where fatura_id = $1`, [fat.out]);
      await db.query(`select public.estornar_pagamento($1)`, [pg]);
      const zerada = (await db.query<{ valor_abatido: string; valor_recebido: string }>(`select valor_abatido, valor_recebido from faturas where id = $1`, [fat.out])).rows[0];
      const eventos = (await db.query<{ tipo: string }>(`select tipo from cobranca_eventos where fatura_id = $1 order by data, tipo`, [fat.out])).rows.map((e) => e.tipo);
      // A auditoria não se apaga nem se escreve à mão
      const apagou = (await db.query(`delete from cobranca_eventos where fatura_id = $1 returning id`, [fat.out])).rows.length;
      let escreveu = "";
      try {
        await db.query(`insert into cobranca_eventos (organizacao_id, tipo) values ($1, 'falso')`, [org]);
      } catch (e) {
        escreveu = String(e);
      }
      return { parcial, excesso, paga, itens, rep, desfeita, restam, itens2, rep2, lanc2, zerada, eventos, apagou, escreveu };
    });
    expect(r.parcial.status).toBe("aberta");
    expect(Number(r.parcial.valor_abatido)).toBe(800);
    expect(Number(r.parcial.valor_recebido)).toBe(800);
    expect(r.excesso).toContain("passa do saldo");
    expect(r.paga.status).toBe("paga");
    expect(Number(r.paga.valor_pago)).toBe(2212);
    expect(Number(r.paga.valor_abatido)).toBe(2000);
    expect(r.itens).toEqual([
      { tipo: "aluguel", da_baixa: false },
      { tipo: "juros", da_baixa: true },
      { tipo: "multa", da_baixa: true },
    ]);
    expect(r.rep).toBe(1);
    expect(r.desfeita.status).toBe("aberta");
    expect(Number(r.desfeita.valor_abatido)).toBe(800);
    expect(r.restam).toEqual([800]);
    expect(r.itens2).toBe(1);
    expect(r.rep2).toBe(0);
    expect(r.lanc2).toBe(0);
    expect(Number(r.zerada.valor_abatido)).toBe(0);
    expect(Number(r.zerada.valor_recebido)).toBe(0);
    expect(r.eventos).toEqual(expect.arrayContaining(["pagamento", "quitada", "baixa_desfeita", "pagamento_estornado"]));
    expect(r.apagou).toBe(0);
    expect(r.escreveu).toMatch(/row-level security|permission/);
  });

  it("não quita fatura que ainda tem saldo", async () => {
    await expect(
      comoUsuario(db, USER_A, () =>
        db.query(`select public.registrar_recebimento($1::jsonb)`, [
          JSON.stringify({
            pagamentos: [{ fatura_id: fat.dez, pago_em: "2026-12-05", valor: 100, principal: 100 }],
            liquidacoes: [{ fatura_id: fat.dez, p: { pago_em: "2026-12-05", valor_pago: 100, forma_pagamento: "pix" } }],
          }),
        ]),
      ),
    ).rejects.toThrow(/ainda tem saldo/);
  });
});

describe("cobranças: acordo, parcelas, quebra e jurídico", () => {
  it("acordo renegocia as faturas, parcela paga quita a mais antiga e a quebra devolve o resto para a cobrança", async () => {
    const r = await comoUsuario(db, USER_A, async () => {
      // Soma das parcelas diferente do total: recusado (e nada muda)
      let soma = "";
      try {
        await db.query(`select public.criar_acordo($1::jsonb)`, [
          JSON.stringify({
            contrato_id: contrato,
            total: 4400,
            parcelas: 2,
            faturas: [
              { fatura_id: fat.set, principal: 2000, multa: 200, juros: 0, desconto: 0, total: 2200 },
              { fatura_id: fat.out, principal: 2000, multa: 200, juros: 0, desconto: 0, total: 2200 },
            ],
            parcelas_lista: [
              { numero: 1, vencimento: "2026-11-10", valor: 2000 },
              { numero: 2, vencimento: "2026-12-10", valor: 2000 },
            ],
          }),
        ]);
      } catch (e) {
        soma = String(e);
      }
      const intacta = (await db.query<{ status: string }>(`select status from faturas where id = $1`, [fat.set])).rows[0].status;
      const acordo = await um(`select public.criar_acordo($1::jsonb) as id`, [
        JSON.stringify({
          contrato_id: contrato,
          principal: 4000,
          multa: 400,
          desconto: 100,
          total: 4300,
          parcelas: 2,
          faturas: [
            { fatura_id: fat.set, principal: 2000, multa: 200, juros: 0, desconto: 100, total: 2100 },
            { fatura_id: fat.out, principal: 2000, multa: 200, juros: 0, desconto: 0, total: 2200 },
          ],
          parcelas_lista: [
            { numero: 1, vencimento: "2026-11-10", valor: 2150 },
            { numero: 2, vencimento: "2026-12-10", valor: 2150 },
          ],
        }),
      ]);
      const renegociadas = (await db.query<{ status: string }>(`select status from faturas where acordo_id = $1 order by vencimento`, [acordo])).rows.map((x) => x.status);
      // Outra fatura em aberto não pode entrar num acordo se já está renegociada
      let dupla = "";
      try {
        await db.query(`select public.criar_acordo($1::jsonb)`, [
          JSON.stringify({ contrato_id: contrato, total: 2000, faturas: [{ fatura_id: fat.set, principal: 2000, total: 2000 }], parcelas_lista: [{ numero: 1, vencimento: "2026-12-01", valor: 2000 }] }),
        ]);
      } catch (e) {
        dupla = String(e);
      }
      const p1 = await um(`select id from acordo_parcelas where acordo_id = $1 and numero = 1`, [acordo]);
      // Parcela 1 (2150): quita setembro (2000 + multa 100 líquida) e põe 50 em outubro (juros/multa primeiro)
      await db.query(`select public.registrar_recebimento($1::jsonb)`, [
        JSON.stringify({
          pagamentos: [
            { fatura_id: fat.set, pago_em: "2026-11-10", valor: 2100, principal: 2000, multa: 100, juros: 0, desconto: 0, origem: "acordo", acordo_parcela_id: p1 },
            { fatura_id: fat.out, pago_em: "2026-11-10", valor: 50, principal: 0, multa: 50, juros: 0, origem: "acordo", acordo_parcela_id: p1 },
          ],
          liquidacoes: [
            {
              fatura_id: fat.set,
              p: {
                pago_em: "2026-11-10",
                valor_pago: 2100,
                forma_pagamento: "pix",
                itens_extras: [{ descricao: "Multa por atraso (10%)", tipo: "multa", valor: 100, destino: "proprietario" }],
                repasses: [repasse(2100)],
                receita_imobiliaria: 200,
              },
            },
          ],
          parcela: { id: p1, pago_em: "2026-11-10", forma: "pix" },
        }),
      ]);
      const depoisP1 = (await db.query<{ id: string; status: string }>(`select id, status from faturas where acordo_id = $1 order by vencimento`, [acordo])).rows.map((x) => x.status);
      const parcela1 = (await db.query<{ status: string }>(`select status from acordo_parcelas where id = $1`, [p1])).rows[0].status;
      // Não dá para excluir acordo com parcela paga
      let excluir = "";
      try {
        await db.query(`select public.excluir_acordo($1)`, [acordo]);
      } catch (e) {
        excluir = String(e);
      }
      // Desfazer a parcela 1 e receber de novo
      await db.query(`select public.estornar_parcela($1)`, [p1]);
      const estornada = (await db.query<{ status: string }>(`select status from faturas where acordo_id = $1 order by vencimento`, [acordo])).rows.map((x) => x.status);
      const pagamentosDepois = (await db.query(`select id from fatura_pagamentos where acordo_parcela_id = $1`, [p1])).rows.length;
      // Quebra: parcela aberta é cancelada e as faturas voltam para "aberta"
      await db.query(`select public.quebrar_acordo($1, 'Parou de pagar')`, [acordo]);
      const quebrado = (await db.query<{ status: string; quebra_motivo: string }>(`select status, quebra_motivo from acordos where id = $1`, [acordo])).rows[0];
      const faturasQuebra = (await db.query<{ status: string }>(`select status from faturas where acordo_id = $1 order by vencimento`, [acordo])).rows.map((x) => x.status);
      const parcelasQuebra = (await db.query<{ status: string }>(`select status from acordo_parcelas where acordo_id = $1 order by numero`, [acordo])).rows.map((x) => x.status);

      // Jurídico: encaminhar marca as faturas e registra na auditoria
      const jur = await um(`insert into cobrancas_juridicas (contrato_id, escritorio, valor_encaminhado) values ($1, 'Dr. Silva Advogados', 4400) returning id`, [contrato]);
      await db.query(`update faturas set juridico_id = $1 where id in ($2, $3)`, [jur, fat.set, fat.out]);
      await db.query(`update cobrancas_juridicas set situacao = 'acao_ajuizada', numero_processo = '000123' where id = $1`, [jur]);
      const evJur = (await db.query<{ tipo: string }>(`select tipo from cobranca_eventos where juridico_id = $1 order by data`, [jur])).rows.map((x) => x.tipo);
      // Contato de cobrança com promessa
      await db.query(
        `insert into cobranca_contatos (contrato_id, fatura_id, canal, resultado, promessa_data, promessa_valor, promessa_status, proximo_contato)
         values ($1, $2, 'telefone', 'promessa', '2026-11-20', 2200, 'pendente', '2026-11-21')`,
        [contrato, fat.out],
      );
      const evAcordo = (await db.query<{ tipo: string }>(`select tipo from cobranca_eventos where acordo_id = $1 order by data`, [acordo])).rows.map((x) => x.tipo);
      return { soma, intacta, renegociadas, dupla, depoisP1, parcela1, excluir, estornada, pagamentosDepois, quebrado, faturasQuebra, parcelasQuebra, evJur, evAcordo, acordo };
    });
    expect(r.soma).toContain("não bate");
    expect(r.intacta).toBe("aberta");
    expect(r.renegociadas).toEqual(["renegociada", "renegociada"]);
    expect(r.dupla).toContain("não está em aberto");
    expect(r.depoisP1).toEqual(["paga", "renegociada"]);
    expect(r.parcela1).toBe("paga");
    expect(r.excluir).toContain("já tem parcela paga");
    expect(r.estornada).toEqual(["renegociada", "renegociada"]);
    expect(r.pagamentosDepois).toBe(0);
    expect(r.quebrado).toEqual({ status: "quebrado", quebra_motivo: "Parou de pagar" });
    expect(r.faturasQuebra).toEqual(["aberta", "aberta"]);
    expect(r.parcelasQuebra).toEqual(["cancelada", "cancelada"]);
    expect(r.evJur).toEqual(["juridico_aberto", "juridico", "juridico", "juridico_situacao"]);
    expect(r.evAcordo).toEqual(expect.arrayContaining(["acordo_criado", "acordo_quebrado"]));

    // Acordo pago até o fim fica "cumprido"
    const cumprido = await comoUsuario(db, USER_A, async () => {
      const a = await um(`select public.criar_acordo($1::jsonb) as id`, [
        JSON.stringify({
          contrato_id: contrato,
          total: 2000,
          faturas: [{ fatura_id: fat.nov, principal: 2000, total: 2000 }],
          parcelas_lista: [{ numero: 1, vencimento: "2026-12-01", valor: 2000 }],
        }),
      ]);
      const p = await um(`select id from acordo_parcelas where acordo_id = $1`, [a]);
      await db.query(`select public.registrar_recebimento($1::jsonb)`, [
        JSON.stringify({
          pagamentos: [{ fatura_id: fat.nov, pago_em: "2026-12-01", valor: 2000, principal: 2000, origem: "acordo", acordo_parcela_id: p }],
          liquidacoes: [{ fatura_id: fat.nov, p: { pago_em: "2026-12-01", valor_pago: 2000, forma_pagamento: "pix", repasses: [repasse(2000)] } }],
          parcela: { id: p, pago_em: "2026-12-01", forma: "pix" },
        }),
      ]);
      // Estornar pela fatura (Aluguéis do mês) não é permitido: tem que ser pela parcela
      let pelaFatura = "";
      try {
        await db.query(`select public.estornar_baixa($1)`, [fat.nov]);
      } catch (e) {
        pelaFatura = String(e);
      }
      const st = (await db.query<{ status: string; cumprido_em: string }>(`select status, cumprido_em::text from acordos where id = $1`, [a])).rows[0];
      return { st, pelaFatura };
    });
    expect(cumprido.st).toEqual({ status: "cumprido", cumprido_em: "2026-12-01" });
    expect(cumprido.pelaFatura).toContain("parcela de acordo");
  });
});

describe("cobranças: isolamento e 2ª via pública", () => {
  it("outra organização não vê nada; o link público mostra a 2ª via e recebe o 'já paguei'", async () => {
    const doOutro = await comoUsuario(db, USER_B, async () => {
      const n = async (t: string) => (await db.query(`select id from ${t}`)).rows.length;
      return {
        pagamentos: await n("fatura_pagamentos"),
        acordos: await n("acordos"),
        parcelas: await n("acordo_parcelas"),
        contatos: await n("cobranca_contatos"),
        juridico: await n("cobrancas_juridicas"),
        eventos: await n("cobranca_eventos"),
      };
    });
    expect(doOutro).toEqual({ pagamentos: 0, acordos: 0, parcelas: 0, contatos: 0, juridico: 0, eventos: 0 });

    // B não consegue gravar pagamento numa fatura de A
    await expect(
      comoUsuario(db, USER_B, () =>
        db.query(`select public.registrar_recebimento($1::jsonb)`, [JSON.stringify({ pagamentos: [{ fatura_id: fat.dez, pago_em: "2026-12-05", valor: 10, principal: 10 }] })]),
      ),
    ).rejects.toThrow(/não encontrada/);

    const token = await comoUsuario(db, USER_A, () => um(`select token_publico as id from faturas where id = $1`, [fat.dez]));
    const r = await comoAnonimo(db, async () => {
      const via = (await db.query<{ r: { tipo: string; locatario: string; imovel: { codigo: string; logradouro: string }; fatura: { numero: number; valor_total: string; itens: unknown[] } } }>(
        `select public.segunda_via($1) as r`,
        [token],
      )).rows[0].r;
      const invalido = (await db.query<{ r: unknown }>(`select public.segunda_via($1) as r`, ["00000000-0000-0000-0000-000000000000"])).rows[0].r;
      const ok = (await db.query<{ r: { ok: boolean } }>(`select public.informar_pagamento($1, $2::jsonb) as r`, [token, JSON.stringify({ data: "2026-11-03", mensagem: "Paguei por Pix" })])).rows[0].r;
      let direto = "";
      try {
        await db.query(`select * from faturas`);
      } catch (e) {
        direto = String(e);
      }
      return { via, invalido, ok, direto };
    });
    expect(r.via.tipo).toBe("fatura");
    expect(r.via.locatario).toBe("Luís Locatário");
    expect(r.via.imovel).toMatchObject({ codigo: "CB-1", logradouro: "Rua das Flores" });
    expect(r.via.fatura.itens).toHaveLength(1);
    expect(r.invalido).toBeNull();
    expect(r.ok.ok).toBe(true);
    expect(r.direto).toMatch(/permission/);

    const lerVista = () =>
      comoUsuario(db, USER_A, async () => ({
        contato: (await db.query<{ resultado: string; canal: string; direcao: string }>(`select resultado, canal, direcao from cobranca_contatos where fatura_id = $1 and resultado = 'informou_pagamento'`, [fat.dez])).rows[0],
        vista: (await db.query<{ v: string | null }>(`select segunda_via_vista_em as v from faturas where id = $1`, [fat.dez])).rows[0].v,
        evento: (await db.query(`select id from cobranca_eventos where fatura_id = $1 and tipo = 'segunda_via_vista'`, [fat.dez])).rows.length,
      }));
    // Só ler a 2ª via (prévia de link, equipe conferindo) não marca "aberto".
    const soLeu = await lerVista();
    expect(soLeu.contato).toEqual({ resultado: "informou_pagamento", canal: "link", direcao: "entrada" });
    expect(soLeu.vista).toBeNull();
    expect(soLeu.evento).toBe(0);
    // O navegador de quem abriu registra a visita (uma vez a cada 6 horas).
    const marcou = await comoAnonimo(db, async () => [
      (await db.query<{ r: boolean }>(`select public.registrar_visita_segunda_via($1) as r`, [token])).rows[0].r,
      (await db.query<{ r: boolean }>(`select public.registrar_visita_segunda_via($1) as r`, [token])).rows[0].r,
    ]);
    expect(marcou).toEqual([true, false]);
    const depois = await lerVista();
    expect(depois.vista).not.toBeNull();
    expect(depois.evento).toBe(1);

    // Desligar o link público na organização: a 2ª via some
    await comoUsuario(db, USER_A, () => db.query(`update organizacoes set cobranca_link_publico = false where id = $1`, [org]));
    const desligado = await comoAnonimo(db, async () => (await db.query<{ r: unknown }>(`select public.segunda_via($1) as r`, [token])).rows[0].r);
    expect(desligado).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Dinheiro no Financeiro, travas e baixa por arquivo
// ---------------------------------------------------------------------------

const USER_P = "00000000-0000-0000-0000-000000000c03";

/** Saldo de uma conta como o Financeiro calcula (lançamentos baixados + aluguéis recebidos sem lançamento). */
async function saldoDaConta(conta: string) {
  const r = await db.query<{ s: string }>(
    `select coalesce((select sum(coalesce(valor_pago, valor)) from lancamentos where conta_id = $1 and status = 'liquidado' and tipo = 'receber'), 0)
          + coalesce((select sum(valor) from alugueis_recebidos where conta_id = $1), 0) as s`,
    [conta],
  );
  return Number(r.rows[0].s);
}

describe("cobranças: dinheiro dos aluguéis no Financeiro", () => {
  it("modo pessoal: cada recebimento vira um lançamento na sua data e conta; nada conta duas vezes", async () => {
    const orgP = await comoUsuario(db, USER_P, () => um(`select public.criar_organizacao('Meus Imóveis') as id`));
    await db.query(`update organizacoes set modo = 'pessoal' where id = $1`, [orgP]);
    const r = await comoUsuario(db, USER_P, async () => {
      const conta = await um(`insert into contas_financeiras (nome, saldo_inicial_em) values ('Banco do Leo', '2026-01-01') returning id`);
      const plano = await um(`insert into plano_contas (codigo, nome, tipo, grupo_dre) values ('1.1', 'Aluguéis recebidos', 'receita', 'receita_operacional') returning id`);
      const loc = await um(`insert into pessoas (nome, papeis) values ('Ana Inquilina','{locatario}') returning id`);
      const im = await um(`insert into imoveis (codigo, logradouro, numero, status) values ('MI-1','Rua A','1','alugado') returning id`);
      const ct = await um(
        `insert into contratos (imovel_id, data_inicio, prazo_meses, data_fim, valor_aluguel, dia_vencimento, data_base_reajuste)
         values ($1, '2026-01-01', 30, '2028-06-30', 1000, 10, '2026-01-01') returning id`,
        [im],
      );
      await db.query(`insert into contrato_partes (contrato_id, pessoa_id, papel) values ($1,$2,'locatario')`, [ct, loc]);
      const f = await um(`select public.registrar_fatura($1::jsonb) as id`, [
        JSON.stringify({
          contrato_id: ct,
          competencia: "2026-10-01",
          periodo_inicio: "2026-10-01",
          periodo_fim: "2026-10-31",
          vencimento: "2026-10-10",
          valor_total: 1000,
          itens: [{ descricao: "Aluguel", tipo: "aluguel", valor: 1000, destino: "proprietario" }],
        }),
      ]);
      const receber = (p: object) => db.query(`select public.registrar_recebimento($1::jsonb)`, [JSON.stringify(p)]);
      // Parcial de R$ 400 na conta: entra no saldo já, na data dele.
      await receber({ pagamentos: [{ fatura_id: f, pago_em: "2026-10-12", valor: 400, principal: 400, forma: "pix", conta_id: conta }] });
      const saldoParcial = await saldoDaConta(conta);
      // Quitação com R$ 600: saldo vai a 1.000 (antes da correção ia a 2.000).
      await receber({
        pagamentos: [{ fatura_id: f, pago_em: "2026-10-20", valor: 600, principal: 600, forma: "pix", conta_id: conta }],
        liquidacoes: [{ fatura_id: f, p: { pago_em: "2026-10-20", valor_pago: 1000, forma_pagamento: "pix", repasses: [], receita_imobiliaria: 0 } }],
      });
      const saldoQuitado = await saldoDaConta(conta);
      const lancs = (
        await db.query<{ valor: string; liquidado_em: string; conta_id: string; plano_id: string; descricao: string }>(
          `select valor, liquidado_em::text, conta_id, plano_id, descricao from lancamentos where fatura_id = $1 order by liquidado_em`,
          [f],
        )
      ).rows;
      const naVisao = (await db.query(`select id from alugueis_recebidos where fatura_id = $1`, [f])).rows.length;
      const contaNaFatura = (await db.query<{ c: string | null }>(`select conta_id as c from faturas where id = $1`, [f])).rows[0].c;
      // Desfazer a baixa tira só o último recebimento (e o lançamento dele).
      await db.query(`select public.estornar_baixa($1)`, [f]);
      const saldoDesfeito = await saldoDaConta(conta);
      const lancsDepois = (await db.query<{ valor: string }>(`select valor from lancamentos where fatura_id = $1`, [f])).rows.map((x) => Number(x.valor));
      // Recebimento sem conta + conciliação no Financeiro: a conta da fatura passa para ele.
      await receber({ pagamentos: [{ fatura_id: f, pago_em: "2026-10-25", valor: 100, principal: 100, forma: "dinheiro" }] });
      const semConta = await saldoDaConta(conta);
      await db.query(`update faturas set conta_id = $1, conciliado_em = now() where id = $2`, [conta, f]);
      const conciliado = await saldoDaConta(conta);
      // Trocar a conta no lançamento (Financeiro) troca no recebimento também.
      const outraConta = await um(`insert into contas_financeiras (nome, saldo_inicial_em) values ('Caixa', '2026-01-01') returning id`);
      const pg100 = await um(`select id from fatura_pagamentos where fatura_id = $1 and valor = 100`, [f]);
      await db.query(`update lancamentos set conta_id = $1 where fatura_pagamento_id = $2`, [outraConta, pg100]);
      const contaDoRecebimento = (await db.query<{ c: string }>(`select conta_id as c from fatura_pagamentos where id = $1`, [pg100])).rows[0].c;
      const saldos = [await saldoDaConta(conta), await saldoDaConta(outraConta)];
      return { saldoParcial, saldoQuitado, lancs, naVisao, contaNaFatura, saldoDesfeito, lancsDepois, semConta, conciliado, plano, conta, outraConta, contaDoRecebimento, saldos };
    });
    expect(r.saldoParcial).toBe(400);
    expect(r.saldoQuitado).toBe(1000);
    expect(r.lancs.map((l) => [Number(l.valor), l.liquidado_em])).toEqual([
      [400, "2026-10-12"],
      [600, "2026-10-20"],
    ]);
    expect(r.lancs.every((l) => l.conta_id === r.conta && l.plano_id === r.plano)).toBe(true);
    expect(r.lancs[0].descricao).toContain("MI-1");
    expect(r.naVisao).toBe(0);
    expect(r.contaNaFatura).toBeNull();
    expect(r.saldoDesfeito).toBe(400);
    expect(r.lancsDepois).toEqual([400]);
    expect(r.semConta).toBe(400);
    expect(r.conciliado).toBe(500);
    expect(r.contaDoRecebimento).toBe(r.outraConta);
    expect(r.saldos).toEqual([400, 100]);
  });

  it("imobiliária: o parcial entra no saldo da conta na data dele; a quitação não duplica; baixa antiga continua contando", async () => {
    const r = await comoUsuario(db, USER_A, async () => {
      const conta = await um(`insert into contas_financeiras (nome, terceiros, saldo_inicial_em) values ('Conta de terceiros', true, '2026-01-01') returning id`);
      const f = await novaFatura("2027-01-01", "2027-01-10");
      const receber = (p: object) => db.query(`select public.registrar_recebimento($1::jsonb)`, [JSON.stringify(p)]);
      await receber({ pagamentos: [{ fatura_id: f, pago_em: "2027-01-12", valor: 500, principal: 500, forma: "pix", conta_id: conta }] });
      const parcial = await saldoDaConta(conta);
      const datas = (await db.query<{ data: string; valor: string }>(`select data::text, valor from alugueis_recebidos where fatura_id = $1`, [f])).rows;
      await receber({
        pagamentos: [{ fatura_id: f, pago_em: "2027-01-15", valor: 1500, principal: 1500, forma: "pix", conta_id: conta }],
        liquidacoes: [{ fatura_id: f, p: { pago_em: "2027-01-15", valor_pago: 2000, forma_pagamento: "pix", repasses: [repasse(2000)], receita_imobiliaria: 200 } }],
      });
      const quitado = await saldoDaConta(conta);
      const lancsAluguel = (await db.query(`select id from lancamentos where fatura_id = $1 and categoria = 'Aluguel'`, [f])).rows.length;
      // Fatura paga antes dos recebimentos separados (baixa antiga): conta pela fatura.
      const antiga = await novaFatura("2027-02-01", "2027-02-10");
      await db.query(`update faturas set status = 'paga', pago_em = '2027-02-10', valor_pago = 2000, conta_id = $1 where id = $2`, [conta, antiga]);
      const comAntiga = await saldoDaConta(conta);
      return { parcial, datas, quitado, lancsAluguel, comAntiga };
    });
    expect(r.parcial).toBe(500);
    expect(r.datas).toEqual([{ data: "2027-01-12", valor: "500.00" }]);
    expect(r.quitado).toBe(2000);
    expect(r.lancsAluguel).toBe(0);
    expect(r.comAntiga).toBe(4000);
  });
});

describe("cobranças: travas do dinheiro recebido", () => {
  it("fatura com recebimento não pode ser cancelada (nem pela desocupação) nem apagada", async () => {
    const r = await comoUsuario(db, USER_A, async () => {
      const f = await novaFatura("2027-03-01", "2027-03-10");
      await db.query(`select public.registrar_recebimento($1::jsonb)`, [
        JSON.stringify({ pagamentos: [{ fatura_id: f, pago_em: "2027-03-05", valor: 400, principal: 400, forma: "pix" }] }),
      ]);
      const erro = async (sql: string, p: unknown[]) => {
        try {
          await db.query(sql, p);
          return "";
        } catch (e) {
          return String(e);
        }
      };
      const cancelar = await erro(`update faturas set status = 'cancelada' where id = $1`, [f]);
      const apagar = await erro(`delete from faturas where id = $1`, [f]);
      const des = await um(`insert into contrato_desocupacoes (contrato_id, entrega_prevista) values ($1, '2027-02-20') returning id`, [contrato]);
      const desocupar = await erro(`select public.concluir_desocupacao($1, $2::jsonb)`, [des, JSON.stringify({ total: 0, entrega: "2027-02-20", pago_ate: "2027-02-20" })]);
      const st = (await db.query<{ status: string; valor_recebido: string }>(`select status, valor_recebido from faturas where id = $1`, [f])).rows[0];
      const contratoSt = (await db.query<{ status: string }>(`select status from contratos where id = $1`, [contrato])).rows[0].status;
      await db.query(`delete from contrato_desocupacoes where id = $1`, [des]);
      // Sem recebimento, cancelar continua possível.
      const pg = await um(`select id from fatura_pagamentos where fatura_id = $1`, [f]);
      await db.query(`select public.estornar_pagamento($1)`, [pg]);
      const semRecebimento = await erro(`update faturas set status = 'cancelada' where id = $1`, [f]);
      return { cancelar, apagar, desocupar, st, contratoSt, semRecebimento };
    });
    expect(r.cancelar).toContain("já tem recebimento");
    expect(r.apagar).toContain("já tem recebimento");
    expect(r.desocupar).toContain("já tem recebimento");
    expect(r.st).toEqual({ status: "aberta", valor_recebido: "400.00" });
    expect(r.contratoSt).toBe("ativo");
    expect(r.semRecebimento).toBe("");
  });

  it("recebimento de antes do acordo não pode ser desfeito com o acordo em andamento", async () => {
    const r = await comoUsuario(db, USER_A, async () => {
      const f = await novaFatura("2027-04-01", "2027-04-10");
      await db.query(`select public.registrar_recebimento($1::jsonb)`, [
        JSON.stringify({ pagamentos: [{ fatura_id: f, pago_em: "2027-04-12", valor: 500, principal: 500, forma: "pix" }] }),
      ]);
      const pg = await um(`select id from fatura_pagamentos where fatura_id = $1`, [f]);
      const acordo = await um(`select public.criar_acordo($1::jsonb) as id`, [
        JSON.stringify({
          contrato_id: contrato,
          total: 1500,
          faturas: [{ fatura_id: f, principal: 1500, total: 1500 }],
          parcelas_lista: [{ numero: 1, vencimento: "2027-05-10", valor: 1500 }],
        }),
      ]);
      let travado = "";
      try {
        await db.query(`select public.estornar_pagamento($1)`, [pg]);
      } catch (e) {
        travado = String(e);
      }
      const abatido = (await db.query<{ v: string }>(`select valor_abatido as v from faturas where id = $1`, [f])).rows[0].v;
      // Excluindo o acordo, o recebimento pode ser desfeito.
      await db.query(`select public.excluir_acordo($1)`, [acordo]);
      await db.query(`select public.estornar_pagamento($1)`, [pg]);
      const depois = (await db.query<{ v: string }>(`select valor_abatido as v from faturas where id = $1`, [f])).rows[0].v;
      return { travado, abatido, depois };
    });
    expect(r.travado).toContain("acordo");
    expect(r.abatido).toBe("500.00");
    expect(r.depois).toBe("0.00");
  });

  it("a mesma linha do extrato/arquivo não dá baixa duas vezes", async () => {
    const r = await comoUsuario(db, USER_A, async () => {
      const f = await novaFatura("2027-05-01", "2027-05-10");
      const chave = "arq:2027-05-10|50000|-|pix recebido fat99#1";
      const receber = () =>
        db.query(`select public.registrar_recebimento($1::jsonb)`, [
          JSON.stringify({ chave_baixa: chave, pagamentos: [{ fatura_id: f, pago_em: "2027-05-10", valor: 500, principal: 500, forma: "pix", origem: "arquivo" }] }),
        ]);
      await receber();
      let repetida = "";
      try {
        await receber();
      } catch (e) {
        repetida = String(e);
      }
      const n = (await db.query(`select id from fatura_pagamentos where fatura_id = $1`, [f])).rows.length;
      // Outra organização não enxerga a chave (cada uma tem as suas).
      const outra = await comoUsuario(db, USER_B, async () => (await db.query(`select id from fatura_pagamentos where chave_baixa = $1`, [chave])).rows.length);
      return { repetida, n, outra };
    });
    expect(r.repetida).toContain("já foi usada");
    expect(r.n).toBe(1);
    expect(r.outra).toBe(0);
  });

  it("fila de saída do envio automático: cobrança paga sai da fila", async () => {
    const r = await comoUsuario(db, USER_A, async () => {
      const f = await novaFatura("2027-06-01", "2027-06-10");
      const regra = await um(`insert into regua_regras (nome, dias_relativos, canal, mensagem) values ('1 dia depois', 1, 'whatsapp', 'Olá {{nome}}') returning id`);
      await db.query(
        `insert into regua_envios (regra_id, fatura_id, status, canal, destinatario, mensagem, agendado_para, automatico)
         values ($1, $2, 'agendado', 'whatsapp', '51999990000', 'Olá Luís', '2027-06-11T09:00:00-03:00', true)`,
        [regra, f],
      );
      const antes = (await db.query<{ status: string }>(`select status from regua_envios where fatura_id = $1`, [f])).rows[0].status;
      await db.query(`select public.registrar_recebimento($1::jsonb)`, [
        JSON.stringify({
          pagamentos: [{ fatura_id: f, pago_em: "2027-06-12", valor: 2000, principal: 2000, forma: "pix" }],
          liquidacoes: [{ fatura_id: f, p: { pago_em: "2027-06-12", valor_pago: 2000, forma_pagamento: "pix", repasses: [repasse(2000)], receita_imobiliaria: 200 } }],
        }),
      ]);
      const depois = (await db.query<{ status: string; erro: string }>(`select status, erro from regua_envios where fatura_id = $1`, [f])).rows[0];
      return { antes, depois };
    });
    expect(r.antes).toBe("agendado");
    expect(r.depois.status).toBe("pulado");
    expect(r.depois.erro).toContain("saiu da régua");
  });

  it("outra organização não vê os aluguéis recebidos nem a fila de saída", async () => {
    const r = await comoUsuario(db, USER_B, async () => ({
      recebidos: (await db.query(`select id from alugueis_recebidos`)).rows.length,
      lancamentos: (await db.query(`select id from lancamentos where fatura_pagamento_id is not null`)).rows.length,
      fila: (await db.query(`select id from regua_envios`)).rows.length,
    }));
    expect(r).toEqual({ recebidos: 0, lancamentos: 0, fila: 0 });
  });
});
