/**
 * Repasses e comissões no banco (PGlite): aprovação e agendamento, desconto de
 * despesas autorizadas com rateio entre proprietários, exigência de aprovação,
 * histórico só de leitura, regras de comissão (corretor > equipe > geral),
 * comissões condicionadas ao recebimento, estornos, ajustes, divisão,
 * comissões de administração e isolamento por organização.
 */
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { comoUsuario, criarBanco } from "./pglite";

const ADMIN = "00000000-0000-0000-0000-000000000c01";
const CORRETOR_USER = "00000000-0000-0000-0000-000000000c02";
const OUTRA = "00000000-0000-0000-0000-000000000c03";

let db: PGlite;
let org: string;

const um = async (sql: string, p: unknown[] = []) => (await db.query<{ id: string }>(sql, p)).rows[0].id;
const linhas = async <T>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows;
const comoAdmin = <T>(fn: () => Promise<T>) => comoUsuario(db, ADMIN, fn);

type Base = {
  prop1: string;
  prop2: string;
  corretor: string;
  captador: string;
  imovel: string;
  contrato: string;
  fatura: string;
  rep1: string;
  rep2: string;
};
let b: Base;

/** Imóvel de dois donos (60/40), contrato, fatura paga e os dois repasses. */
async function montarBase(): Promise<Base> {
  return comoAdmin(async () => {
    const prop1 = await um(`insert into pessoas (nome, papeis, pix_chave) values ('Ana Dona','{proprietario}','ana@pix.com') returning id`);
    const prop2 = await um(`insert into pessoas (nome, papeis) values ('Beto Dono','{proprietario}') returning id`);
    const loc = await um(`insert into pessoas (nome, papeis) values ('Caio Inquilino','{locatario}') returning id`);
    const corretor = await um(`insert into pessoas (nome, papeis) values ('Dani Corretora','{corretor}') returning id`);
    const captador = await um(`insert into pessoas (nome, papeis) values ('Edu Captador','{corretor}') returning id`);
    const imovel = await um(`insert into imoveis (codigo, corretor_id) values ('AP-500', $1) returning id`, [captador]);
    await db.query(`insert into imovel_proprietarios (imovel_id, pessoa_id, percentual) values ($1,$2,60), ($1,$3,40)`, [imovel, prop1, prop2]);
    const contrato = await um(
      `insert into contratos (imovel_id, data_inicio, prazo_meses, data_fim, valor_aluguel, dia_vencimento, data_base_reajuste)
       values ($1, '2026-09-01', 30, '2029-02-28', 3000, 10, '2026-09-01') returning id`,
      [imovel],
    );
    await db.query(
      `insert into contrato_partes (contrato_id, pessoa_id, papel, percentual) values ($1,$2,'proprietario',60), ($1,$3,'proprietario',40), ($1,$4,'locatario',null)`,
      [contrato, prop1, prop2, loc],
    );
    const fatura = await um(`select public.registrar_fatura($1::jsonb) as id`, [
      JSON.stringify({
        contrato_id: contrato,
        competencia: "2026-10-01",
        vencimento: "2026-10-10",
        valor_total: 3000,
        itens: [{ descricao: "Aluguel 10/2026", tipo: "aluguel", valor: 3000, destino: "proprietario" }],
      }),
    ]);
    const rep = (pessoa: string, pct: number, aluguel: number, taxa: number) => ({
      pessoa_id: pessoa,
      percentual: pct,
      aluguel,
      encargos: 0,
      multa_juros: 0,
      valor_bruto: aluguel,
      taxa_administracao: taxa,
      taxa_intermediacao: 0,
      irrf: 0,
      valor_liquido: aluguel - taxa,
      previsto_para: "2026-10-12",
    });
    await db.query(`select public.liquidar_fatura($1, $2::jsonb)`, [
      fatura,
      JSON.stringify({ pago_em: "2026-10-10", valor_pago: 3000, forma_pagamento: "pix", repasses: [rep(prop1, 60, 1800, 180), rep(prop2, 40, 1200, 120)], receita_imobiliaria: 300 }),
    ]);
    const rep1 = await um(`select id from repasses where fatura_id = $1 and pessoa_id = $2`, [fatura, prop1]);
    const rep2 = await um(`select id from repasses where fatura_id = $1 and pessoa_id = $2`, [fatura, prop2]);
    return { prop1, prop2, corretor, captador, imovel, contrato, fatura, rep1, rep2 };
  });
}

beforeAll(async () => {
  db = await criarBanco();
  org = await comoAdmin(async () => um(`select public.criar_organizacao('Imob Repasses') as id`));
  await comoUsuario(db, OUTRA, () => db.query(`select public.criar_organizacao('Imob Vizinha')`));
  // Um corretor com login na mesma imobiliária (não pode aprovar).
  await db.query(`insert into membros (organizacao_id, user_id, papel) values ($1, $2, 'corretor')`, [org, CORRETOR_USER]);
  b = await montarBase();
});

describe("repasses", () => {
  it("aprova, agenda e desconta a despesa autorizada rateada entre os proprietários", async () => {
    const despesa = await comoAdmin(() =>
      um(
        `insert into lancamentos (tipo, descricao, valor, vencimento, status, liquidado_em, imovel_id, descontar_repasse)
         values ('pagar', 'Conserto do chuveiro', 100, '2026-10-05', 'liquidado', '2026-10-05', $1, true) returning id`,
        [b.imovel],
      ),
    );

    // Corretor não aprova.
    await expect(
      comoUsuario(db, CORRETOR_USER, () => db.query(`select public.aprovar_repasse($1, '{}'::jsonb)`, [b.rep1])),
    ).rejects.toThrow(/administrador, gestor ou financeiro/);

    // Desconto maior que a despesa é recusado.
    await expect(
      comoAdmin(() => db.query(`select public.aprovar_repasse($1, $2::jsonb)`, [b.rep1, JSON.stringify({ descontos: [{ lancamento_id: despesa, valor: 150 }] })])),
    ).rejects.toThrow(/passa do valor da despesa/);

    // Dono 1 (60%) leva 60 da despesa; fica agendado para o dia 15.
    await comoAdmin(() =>
      db.query(`select public.aprovar_repasse($1, $2::jsonb)`, [b.rep1, JSON.stringify({ programado_para: "2026-10-15", descontos: [{ lancamento_id: despesa, valor: 60 }] })]),
    );
    const r1 = await comoAdmin(async () =>
      (await linhas<{ valor_liquido: string; outros_descontos: string; programado_para: string; aprovado_por: string; observacoes: string }>(
        `select valor_liquido, outros_descontos, programado_para::text, aprovado_por, observacoes from repasses where id = $1`,
        [b.rep1],
      ))[0],
    );
    expect(Number(r1.valor_liquido)).toBe(1560);
    expect(Number(r1.outros_descontos)).toBe(60);
    expect(r1.programado_para).toBe("2026-10-15");
    expect(r1.aprovado_por).toBe(ADMIN);
    expect(r1.observacoes).toContain("Conserto do chuveiro");
    // Ainda falta a parte do outro dono: a despesa continua "a descontar".
    expect((await comoAdmin(() => linhas<{ repasse_id: string | null }>(`select repasse_id from lancamentos where id = $1`, [despesa])))[0].repasse_id).toBeNull();

    // Aprovar de novo é recusado.
    await expect(comoAdmin(() => db.query(`select public.aprovar_repasse($1, '{}'::jsonb)`, [b.rep1]))).rejects.toThrow(/já foi aprovado/);

    // Dono 2 (40%) leva 40: agora a despesa está quitada e marcada no repasse.
    await comoAdmin(() => db.query(`select public.aprovar_repasse($1, $2::jsonb)`, [b.rep2, JSON.stringify({ descontos: [{ lancamento_id: despesa, valor: 40 }] })]));
    const lanc = await comoAdmin(async () => (await linhas<{ repasse_id: string | null }>(`select repasse_id from lancamentos where id = $1`, [despesa]))[0]);
    expect(lanc.repasse_id).toBe(b.rep2);
    const descontos = await comoAdmin(() => linhas<{ valor: string }>(`select valor from repasse_descontos where lancamento_id = $1 order by valor desc`, [despesa]));
    expect(descontos.map((d) => Number(d.valor))).toEqual([60, 40]);

    // Desfazer a aprovação do dono 2 devolve o desconto e a despesa volta a ficar pendente.
    await comoAdmin(() => db.query(`select public.desfazer_aprovacao_repasse($1)`, [b.rep2]));
    const depois = await comoAdmin(async () => ({
      rep: (await linhas<{ valor_liquido: string; aprovado_em: string | null }>(`select valor_liquido, aprovado_em from repasses where id = $1`, [b.rep2]))[0],
      lanc: (await linhas<{ repasse_id: string | null }>(`select repasse_id from lancamentos where id = $1`, [despesa]))[0],
    }));
    expect(Number(depois.rep.valor_liquido)).toBe(1080);
    expect(depois.rep.aprovado_em).toBeNull();
    expect(depois.lanc.repasse_id).toBeNull();

    // Despesa de outro imóvel não pode ser descontada.
    const outroImovel = await comoAdmin(() => um(`insert into imoveis (codigo) values ('CS-9') returning id`));
    const alheia = await comoAdmin(() =>
      um(`insert into lancamentos (tipo, descricao, valor, vencimento, imovel_id, descontar_repasse) values ('pagar','Pintura',50,'2026-10-01',$1,true) returning id`, [outroImovel]),
    );
    await expect(
      comoAdmin(() => db.query(`select public.aprovar_repasse($1, $2::jsonb)`, [b.rep2, JSON.stringify({ descontos: [{ lancamento_id: alheia, valor: 50 }] })])),
    ).rejects.toThrow(/outro imóvel/);
  });

  it("paga com forma e comprovante, exige aprovação quando ligado e guarda o histórico", async () => {
    // Pagamento do repasse aprovado.
    await comoAdmin(() =>
      db.query(`update repasses set status = 'pago', pago_em = '2026-10-15', forma_pagamento = 'pix', comprovante = 'E123' where id = $1`, [b.rep1]),
    );
    const pago = await comoAdmin(async () => (await linhas<{ pago_por: string }>(`select pago_por from repasses where id = $1`, [b.rep1]))[0]);
    expect(pago.pago_por).toBe(ADMIN);

    // Com a exigência ligada, não paga sem aprovar.
    await db.query(`update organizacoes set repasse_exige_aprovacao = true where id = $1`, [org]);
    await expect(comoAdmin(() => db.query(`update repasses set status = 'pago' where id = $1`, [b.rep2]))).rejects.toThrow(/precisa ser aprovado/);
    await comoAdmin(() => db.query(`select public.aprovar_repasse($1, '{}'::jsonb)`, [b.rep2]));
    await comoAdmin(() => db.query(`update repasses set status = 'pago', forma_pagamento = 'transferencia' where id = $1`, [b.rep2]));
    await db.query(`update organizacoes set repasse_exige_aprovacao = false where id = $1`, [org]);

    const eventos = await comoAdmin(() => linhas<{ tipo: string }>(`select tipo from repasse_eventos where repasse_id = $1 order by data, tipo`, [b.rep1]));
    const tipos = eventos.map((e) => e.tipo);
    expect(tipos).toContain("criado");
    expect(tipos).toContain("desconto");
    expect(tipos).toContain("aprovado");
    expect(tipos).toContain("pago");

    // Histórico não se altera nem se apaga (RLS só deixa ler e acrescentar).
    const total = eventos.length;
    await comoAdmin(() => db.query(`update repasse_eventos set descricao = 'x' where repasse_id = $1`, [b.rep1]));
    await comoAdmin(() => db.query(`delete from repasse_eventos where repasse_id = $1`, [b.rep1]));
    const ainda = await comoAdmin(() => linhas<{ descricao: string }>(`select descricao from repasse_eventos where repasse_id = $1`, [b.rep1]));
    expect(ainda).toHaveLength(total);
    expect(ainda.some((e) => e.descricao === "x")).toBe(false);
    // Nem dá para inventar evento pela API (só o banco grava o histórico).
    await expect(
      comoAdmin(() => db.query(`insert into repasse_eventos (organizacao_id, repasse_id, tipo, descricao) values ($1, $2, 'pago', 'Falso')`, [org, b.rep1])),
    ).rejects.toThrow();
    await expect(
      comoUsuario(db, CORRETOR_USER, () =>
        db.query(`insert into comissao_eventos (organizacao_id, comissao_id, tipo, descricao, usuario_id) values ($1, gen_random_uuid(), 'paga', 'Falso', $2)`, [org, ADMIN]),
      ),
    ).rejects.toThrow();
  });

  it("cancela com motivo devolvendo os descontos", async () => {
    const rep = await comoAdmin(() =>
      um(
        `insert into repasses (contrato_id, pessoa_id, competencia, percentual, valor_bruto, valor_liquido, previsto_para)
         values ($1, $2, '2026-11-01', 60, 1800, 1620, '2026-11-12') returning id`,
        [b.contrato, b.prop1],
      ),
    );
    const despesa = await comoAdmin(() =>
      um(
        `insert into lancamentos (tipo, descricao, valor, vencimento, imovel_id, descontar_repasse, descontar_de_id) values ('pagar','Troca de fechadura',80,'2026-11-01',$1,true,$2) returning id`,
        [b.imovel, b.prop1],
      ),
    );
    // Despesa só do dono 1 não pode cair no repasse do dono 2.
    const rep2 = await comoAdmin(() =>
      um(
        `insert into repasses (contrato_id, pessoa_id, competencia, percentual, valor_bruto, valor_liquido, previsto_para)
         values ($1, $2, '2026-11-01', 40, 1200, 1080, '2026-11-12') returning id`,
        [b.contrato, b.prop2],
      ),
    );
    await expect(
      comoAdmin(() => db.query(`select public.aprovar_repasse($1, $2::jsonb)`, [rep2, JSON.stringify({ descontos: [{ lancamento_id: despesa, valor: 80 }] })])),
    ).rejects.toThrow(/outro proprietário/);
    await comoAdmin(() => db.query(`select public.aprovar_repasse($1, $2::jsonb)`, [rep, JSON.stringify({ descontos: [{ lancamento_id: despesa, valor: 80 }] })]));
    await expect(comoAdmin(() => db.query(`select public.cancelar_repasse($1, '')`, [rep]))).rejects.toThrow(/motivo/);
    await comoAdmin(() => db.query(`select public.cancelar_repasse($1, 'Contrato rescindido')`, [rep]));
    const r = await comoAdmin(async () => ({
      rep: (await linhas<{ status: string; valor_liquido: string; cancelado_motivo: string }>(`select status, valor_liquido, cancelado_motivo from repasses where id = $1`, [rep]))[0],
      lanc: (await linhas<{ repasse_id: string | null }>(`select repasse_id from lancamentos where id = $1`, [despesa]))[0],
    }));
    expect(r.rep.status).toBe("cancelado");
    expect(Number(r.rep.valor_liquido)).toBe(1620);
    expect(r.rep.cancelado_motivo).toBe("Contrato rescindido");
    expect(r.lanc.repasse_id).toBeNull();
  });

  it("não paga sem aprovar quando há despesa a descontar; agendamento muda a data de pagamento (pagar_em)", async () => {
    const r = await comoAdmin(async () => {
      const rep = await um(
        `insert into repasses (contrato_id, pessoa_id, competencia, percentual, valor_bruto, valor_liquido, previsto_para)
         values ($1, $2, '2026-12-01', 60, 1800, 1620, '2026-12-12') returning id`,
        [b.contrato, b.prop1],
      );
      const fechadura = await um(`select id from lancamentos where descricao = 'Troca de fechadura'`);
      const antes = (await linhas<{ pagar_em: string }>(`select pagar_em::text from repasses where id = $1`, [rep]))[0].pagar_em;
      // A troca de fechadura (só do dono 1) ainda está a descontar: pagar direto é recusado.
      const erro = await db.query(`update repasses set status = 'pago' where id = $1`, [rep]).then(
        () => "",
        (e: Error) => e.message,
      );
      await db.query(`select public.aprovar_repasse($1, $2::jsonb)`, [rep, JSON.stringify({ programado_para: "2026-12-20", descontos: [{ lancamento_id: fechadura, valor: 80 }] })]);
      const agendado = (await linhas<{ pagar_em: string; valor_liquido: string }>(`select pagar_em::text, valor_liquido from repasses where id = $1`, [rep]))[0];
      await db.query(`update repasses set status = 'pago', forma_pagamento = 'pix' where id = $1`, [rep]);
      const fech = (await linhas<{ repasse_id: string }>(`select repasse_id from lancamentos where id = $1`, [fechadura]))[0];

      // Imóvel sem despesa a descontar: pagar direto aprova junto.
      const imovel = await um(`insert into imoveis (codigo) values ('AP-960') returning id`);
      const contrato = await um(
        `insert into contratos (imovel_id, data_inicio, prazo_meses, data_fim, valor_aluguel, dia_vencimento, data_base_reajuste)
         values ($1, '2026-09-01', 30, '2029-02-28', 1000, 10, '2026-09-01') returning id`,
        [imovel],
      );
      await db.query(`insert into contrato_partes (contrato_id, pessoa_id, papel, percentual) values ($1,$2,'proprietario',100)`, [contrato, b.prop2]);
      const livre = await um(
        `insert into repasses (contrato_id, pessoa_id, competencia, percentual, valor_bruto, valor_liquido, previsto_para)
         values ($1, $2, '2026-12-01', 100, 1000, 900, '2026-12-12') returning id`,
        [contrato, b.prop2],
      );
      await db.query(`update repasses set status = 'pago' where id = $1`, [livre]);
      const pagoDireto = (await linhas<{ status: string; aprovado_em: string | null }>(`select status, aprovado_em from repasses where id = $1`, [livre]))[0];
      return { antes, erro, agendado, fech, rep, pagoDireto };
    });
    expect(r.antes).toBe("2026-12-12");
    expect(r.erro).toMatch(/despesa autorizada/);
    expect(r.agendado.pagar_em).toBe("2026-12-20");
    expect(Number(r.agendado.valor_liquido)).toBe(1540);
    expect(r.fech.repasse_id).toBe(r.rep);
    expect(r.pagoDireto.status).toBe("pago");
    expect(r.pagoDireto.aprovado_em).not.toBeNull();
  });
});

describe("comissões", () => {
  it("escolhe a regra do corretor, depois a da equipe e por fim a geral", async () => {
    const r = await comoAdmin(async () => {
      const equipe = await um(`insert into equipes (nome) values ('Time Centro') returning id`);
      await db.query(`insert into equipe_membros (equipe_id, pessoa_id) values ($1, $2)`, [equipe, b.corretor]);
      await db.query(`insert into comissao_regras (tipo, percentual) values ('locacao', 50)`);
      const regraEquipe = await um(`insert into comissao_regras (tipo, equipe_id, percentual, condicionada) values ('locacao', $1, 70, true) returning id`, [equipe]);
      const escolhida = async (pessoa: string) =>
        (await linhas<{ id: string; percentual: string }>(`select (privado.regra_comissao($1, 'locacao', $2)).*`, [org, pessoa]))[0];
      return { equipe: await escolhida(b.corretor), geral: await escolhida(b.captador), regraEquipe };
    });
    expect(r.equipe.id).toBe(r.regraEquipe);
    expect(Number(r.geral.percentual)).toBe(50);
  });

  it("comissão de locação condicionada fica prevista até o aluguel ser recebido (e volta se a baixa for desfeita)", async () => {
    const r = await comoAdmin(async () => {
      const imovel = await um(`insert into imoveis (codigo) values ('AP-600') returning id`);
      const prop = await um(`insert into pessoas (nome, papeis) values ('Fábio Dono','{proprietario}') returning id`);
      const proposta = await um(`insert into propostas (imovel_id, tipo, valor, corretor_id) values ($1, 'locacao', 2000, $2) returning id`, [imovel, b.corretor]);
      await db.query(`select public.aceitar_proposta($1)`, [proposta]);
      const antes = (await linhas<{ id: string; status: string; valor: string; percentual: string; lancamento_id: string | null }>(
        `select id, status, valor, percentual, lancamento_id from comissoes where proposta_id = $1`,
        [proposta],
      ))[0];
      // Comissão avulsa "prevista" do mesmo imóvel: só sai quando alguém liberar (não pelo aluguel).
      const avulsa = await um(
        `insert into comissoes (pessoa_id, tipo, descricao, valor, valor_original, status, condicionada, imovel_id)
         values ($1, 'locacao', 'Bônus de locação', 100, 100, 'prevista', true, $2) returning id`,
        [b.captador, imovel],
      );
      // Contrato e 1º aluguel recebido liberam a comissão.
      const contrato = await um(
        `insert into contratos (imovel_id, data_inicio, prazo_meses, data_fim, valor_aluguel, dia_vencimento, data_base_reajuste)
         values ($1, '2026-11-01', 30, '2029-04-30', 2000, 5, '2026-11-01') returning id`,
        [imovel],
      );
      await db.query(`insert into contrato_partes (contrato_id, pessoa_id, papel, percentual) values ($1,$2,'proprietario',100)`, [contrato, prop]);
      const fatura = await um(`select public.registrar_fatura($1::jsonb) as id`, [
        JSON.stringify({ contrato_id: contrato, competencia: "2026-11-01", vencimento: "2026-12-05", valor_total: 2000, itens: [{ descricao: "Aluguel", tipo: "aluguel", valor: 2000, destino: "proprietario" }] }),
      ]);
      const baixa = JSON.stringify({ pago_em: "2026-12-05", valor_pago: 2000, forma_pagamento: "pix", repasses: [] });
      await db.query(`select public.liquidar_fatura($1, $2::jsonb)`, [fatura, baixa]);
      const primeira = (await linhas<{ status: string; lancamento_id: string }>(`select status, lancamento_id from comissoes where id = $1`, [antes.id]))[0];
      // Baixa desfeita: a comissão volta a prevista e a conta a pagar é cancelada.
      await db.query(`select public.estornar_baixa($1)`, [fatura]);
      const voltou = (await linhas<{ status: string; lancamento_id: string | null; fatura_id: string | null }>(`select status, lancamento_id, fatura_id from comissoes where id = $1`, [antes.id]))[0];
      const lancVoltou = (await linhas<{ status: string }>(`select status from lancamentos where id = $1`, [primeira.lancamento_id]))[0];
      await db.query(`select public.liquidar_fatura($1, $2::jsonb)`, [fatura, baixa]);
      const depois = (await linhas<{ status: string; lancamento_id: string | null; contrato_id: string; fatura_id: string }>(
        `select status, lancamento_id, contrato_id, fatura_id from comissoes where id = $1`,
        [antes.id],
      ))[0];
      const avulsaDepois = (await linhas<{ status: string }>(`select status from comissoes where id = $1`, [avulsa]))[0];
      const eventos = await linhas<{ tipo: string }>(`select tipo from comissao_eventos where comissao_id = $1`, [antes.id]);
      const lanc = (await linhas<{ valor: string; categoria: string; pessoa_id: string; status: string }>(`select valor, categoria, pessoa_id, status from lancamentos where id = $1`, [depois.lancamento_id]))[0];
      // Pagar no financeiro marca a comissão como paga.
      await db.query(`update lancamentos set status = 'liquidado', liquidado_em = '2026-12-20' where id = $1`, [depois.lancamento_id]);
      const paga = (await linhas<{ status: string }>(`select status from comissoes where id = $1`, [antes.id]))[0];
      return { antes, primeira, voltou, lancVoltou, depois, lanc, paga, contrato, fatura, avulsaDepois, eventos };
    });
    expect(r.primeira.status).toBe("a_pagar");
    expect(r.voltou).toEqual({ status: "prevista", lancamento_id: null, fatura_id: null });
    expect(r.lancVoltou.status).toBe("cancelado");
    expect(r.depois.fatura_id).toBe(r.fatura);
    expect(r.depois.lancamento_id).not.toBe(r.primeira.lancamento_id);
    expect(r.avulsaDepois.status).toBe("prevista");
    expect(r.eventos.map((e) => e.tipo)).toEqual(expect.arrayContaining(["liberada", "voltou_prevista"]));
    expect(r.antes.status).toBe("prevista");
    expect(Number(r.antes.percentual)).toBe(70); // regra da equipe
    expect(Number(r.antes.valor)).toBe(1400);
    expect(r.antes.lancamento_id).toBeNull();
    expect(r.depois.status).toBe("a_pagar");
    expect(r.depois.contrato_id).toBe(r.contrato);
    expect(r.lanc).toMatchObject({ categoria: "Comissões", pessoa_id: b.corretor, status: "aberto" });
    expect(Number(r.lanc.valor)).toBe(1400);
    expect(r.paga.status).toBe("paga");
  });

  it("venda: divisão pela regra, captador pela angariação e liberação quando a imobiliária recebe", async () => {
    const r = await comoAdmin(async () => {
      await db.query(`insert into comissao_regras (tipo, pessoa_id, percentual, condicionada, dias_pagamento) values ('venda', $1, 40, true, 10)`, [b.corretor]);
      await db.query(`insert into comissao_regras (tipo, percentual, condicionada) values ('angariacao', 10, true)`);
      const casa = await um(`insert into imoveis (codigo, finalidades, corretor_id) values ('CA-700','{venda}', $1) returning id`, [b.captador]);
      const proposta = await um(`insert into propostas (imovel_id, tipo, valor, corretor_id, comissao_pct) values ($1,'venda',400000,$2,5) returning id`, [casa, b.corretor]);
      await db.query(`select public.aceitar_proposta($1)`, [proposta]);
      const venda = await um(`select venda_id as id from propostas where id = $1`, [proposta]);
      const divisao = await linhas<{ papel: string; percentual: string }>(`select papel, percentual from venda_comissoes where venda_id = $1 order by papel`, [venda]);
      await db.query(`select public.concluir_venda($1)`, [venda]);
      const previstas = await linhas<{ tipo: string; valor: string; status: string }>(`select tipo, valor, status from comissoes where venda_id = $1 order by valor desc`, [venda]);
      const pagarAntes = await linhas(`select 1 from lancamentos where venda_id = $1 and tipo = 'pagar'`, [venda]);
      // A imobiliária recebe a comissão do vendedor → comissões viram a pagar.
      await db.query(`update lancamentos set status = 'liquidado', liquidado_em = current_date where venda_id = $1 and tipo = 'receber'`, [venda]);
      const liberadas = await linhas<{ status: string; vencimento: string; dias: number }>(
        `select status, vencimento::text, (vencimento - current_date) as dias from comissoes where venda_id = $1 order by valor desc`,
        [venda],
      );
      const pagar = await linhas<{ valor: string }>(`select valor from lancamentos where venda_id = $1 and tipo = 'pagar' order by valor desc`, [venda]);
      const vinculadas = await linhas<{ lancamento_id: string | null }>(`select lancamento_id from venda_comissoes where venda_id = $1`, [venda]);
      return { divisao, previstas, pagarAntes, liberadas, pagar, vinculadas };
    });
    expect(r.divisao.map((d) => [d.papel, Number(d.percentual)])).toEqual([
      ["captador", 10],
      ["vendedor", 40],
    ]);
    // Comissão da venda: 5% de 400 mil = 20 mil; corretor 40% = 8 mil; captador 10% = 2 mil.
    expect(r.previstas.map((c) => [c.tipo, Number(c.valor), c.status])).toEqual([
      ["venda", 8000, "prevista"],
      ["angariacao", 2000, "prevista"],
    ]);
    expect(r.pagarAntes).toHaveLength(0);
    expect(r.liberadas.every((c) => c.status === "a_pagar")).toBe(true);
    expect(r.liberadas[0].dias).toBe(10);
    expect(r.pagar.map((l) => Number(l.valor))).toEqual([8000, 2000]);
    expect(r.vinculadas.every((v) => v.lancamento_id)).toBe(true);
  });

  it("desfazer o recebimento da comissão da venda devolve as condicionadas para prevista", async () => {
    const r = await comoAdmin(async () => {
      const venda = (await linhas<{ venda_id: string }>(`select venda_id from comissoes where tipo = 'venda' and valor = 8000`))[0].venda_id;
      await db.query(`update lancamentos set status = 'aberto', liquidado_em = null where venda_id = $1 and tipo = 'receber'`, [venda]);
      const voltaram = await linhas<{ status: string; lancamento_id: string | null }>(`select status, lancamento_id from comissoes where venda_id = $1`, [venda]);
      const pagarAbertos = await linhas(`select 1 from lancamentos where venda_id = $1 and tipo = 'pagar' and status = 'aberto'`, [venda]);
      const divisao = await linhas<{ lancamento_id: string | null }>(`select lancamento_id from venda_comissoes where venda_id = $1`, [venda]);
      await db.query(`update lancamentos set status = 'liquidado', liquidado_em = current_date where venda_id = $1 and tipo = 'receber'`, [venda]);
      const deNovo = await linhas<{ status: string }>(`select status from comissoes where venda_id = $1`, [venda]);
      const abertosDeNovo = await linhas<{ valor: string }>(`select valor from lancamentos where venda_id = $1 and tipo = 'pagar' and status = 'aberto' order by valor desc`, [venda]);
      return { voltaram, pagarAbertos, divisao, deNovo, abertosDeNovo };
    });
    expect(r.voltaram.every((c) => c.status === "prevista" && c.lancamento_id === null)).toBe(true);
    expect(r.pagarAbertos).toHaveLength(0);
    expect(r.divisao.every((d) => d.lancamento_id === null)).toBe(true);
    expect(r.deNovo.every((c) => c.status === "a_pagar")).toBe(true);
    expect(r.abertosDeNovo.map((l) => Number(l.valor))).toEqual([8000, 2000]);
  });

  it("ajusta, divide e estorna com motivo e histórico", async () => {
    const r = await comoAdmin(async () => {
      await db.query(`delete from comissao_regras`);
      const imovel = await um(`insert into imoveis (codigo) values ('AP-800') returning id`);
      const proposta = await um(`insert into propostas (imovel_id, tipo, valor, corretor_id, comissao_pct) values ($1,'locacao',2500,$2,40) returning id`, [imovel, b.corretor]);
      await db.query(`select public.aceitar_proposta($1)`, [proposta]);
      const c = (await linhas<{ id: string; status: string; valor: string; lancamento_id: string }>(`select id, status, valor, lancamento_id from comissoes where proposta_id = $1`, [proposta]))[0];
      await db.query(`select public.ajustar_comissao($1, 900, 'Desconto combinado com o proprietário')`, [c.id]);
      const lancAjustado = (await linhas<{ valor: string }>(`select valor from lancamentos where id = $1`, [c.lancamento_id]))[0];
      const nova = await um(`select public.dividir_comissao($1, $2, 50) as id`, [c.id, b.captador]);
      const divididas = await linhas<{ pessoa_id: string; valor: string; status: string }>(`select pessoa_id, valor, status from comissoes where id in ($1, $2) order by pessoa_id = $3 desc`, [c.id, nova, b.corretor]);
      await db.query(`update lancamentos set status = 'liquidado', liquidado_em = current_date where id = $1`, [c.lancamento_id]);
      await db.query(`select public.estornar_comissao($1, 'Locatário desistiu antes de entrar')`, [c.id]);
      const estornada = (await linhas<{ status: string; devolucao_lancamento_id: string }>(`select status, devolucao_lancamento_id from comissoes where id = $1`, [c.id]))[0];
      const devolucao = (await linhas<{ tipo: string; valor: string; pessoa_id: string }>(`select tipo, valor, pessoa_id from lancamentos where id = $1`, [estornada.devolucao_lancamento_id]))[0];
      // A outra metade ainda a pagar: estorno cancela o lançamento.
      const outra = (await linhas<{ lancamento_id: string }>(`select lancamento_id from comissoes where id = $1`, [nova]))[0];
      await db.query(`select public.estornar_comissao($1, 'Locatário desistiu')`, [nova]);
      const lancOutra = (await linhas<{ status: string }>(`select status from lancamentos where id = $1`, [outra.lancamento_id]))[0];
      const eventos = await linhas<{ tipo: string }>(`select tipo from comissao_eventos where comissao_id = $1`, [c.id]);
      return { c, lancAjustado, divididas, estornada, devolucao, lancOutra, eventos };
    });
    expect(Number(r.c.valor)).toBe(1000); // 40% de 2.500
    expect(r.c.status).toBe("a_pagar");
    expect(Number(r.lancAjustado.valor)).toBe(900);
    expect(r.divididas.map((d) => [d.pessoa_id, Number(d.valor), d.status])).toEqual([
      [b.corretor, 450, "a_pagar"],
      [b.captador, 450, "a_pagar"],
    ]);
    expect(r.estornada.status).toBe("estornada");
    expect(r.devolucao).toMatchObject({ tipo: "receber", pessoa_id: b.corretor });
    expect(Number(r.devolucao.valor)).toBe(450);
    expect(r.lancOutra.status).toBe("cancelado");
    const tipos = r.eventos.map((e) => e.tipo);
    expect(tipos).toEqual(expect.arrayContaining(["criada", "liberada", "ajuste", "paga", "estornada"]));

    // Corretor não estorna nem ajusta; motivo é obrigatório (comissão a pagar criada aqui mesmo).
    const alvo = await comoAdmin(async () => {
      const imovel = await um(`insert into imoveis (codigo) values ('AP-810') returning id`);
      const proposta = await um(`insert into propostas (imovel_id, tipo, valor, corretor_id, comissao_pct) values ($1,'locacao',1000,$2,10) returning id`, [imovel, b.corretor]);
      await db.query(`select public.aceitar_proposta($1)`, [proposta]);
      return (await linhas<{ id: string; status: string }>(`select id, status from comissoes where proposta_id = $1`, [proposta]))[0];
    });
    expect(alvo.status).toBe("a_pagar");
    await expect(comoUsuario(db, CORRETOR_USER, () => db.query(`select public.estornar_comissao($1, 'x')`, [alvo.id]))).rejects.toThrow(/Só administrador/);
    await expect(comoUsuario(db, CORRETOR_USER, () => db.query(`select public.ajustar_comissao($1, 1, 'x')`, [alvo.id]))).rejects.toThrow(/Só administrador/);
    await expect(comoAdmin(() => db.query(`select public.estornar_comissao($1, ' ')`, [alvo.id]))).rejects.toThrow(/motivo/);
    await expect(comoAdmin(() => db.query(`select public.ajustar_comissao($1, 50, '')`, [alvo.id]))).rejects.toThrow(/motivo/);
    const ainda = await comoAdmin(async () => (await linhas<{ status: string; valor: string }>(`select status, valor from comissoes where id = $1`, [alvo.id]))[0]);
    expect(ainda.status).toBe("a_pagar");
    expect(Number(ainda.valor)).toBe(100);
  });

  it("ajustes seguidos depois de paga: a conta é sobre o valor efetivo (pago + complementos − devoluções)", async () => {
    const r = await comoAdmin(async () => {
      const c = (await linhas<{ id: string; lancamento_id: string }>(`select id, lancamento_id from comissoes where tipo = 'venda' and valor = 8000`))[0];
      await db.query(`update lancamentos set status = 'liquidado', liquidado_em = current_date where id = $1`, [c.lancamento_id]);
      const ajustar = (v: number, motivo: string) => db.query(`select public.ajustar_comissao($1, $2, $3)`, [c.id, v, motivo]);
      const efetivo = async () => {
        const a = (await linhas<{ complementos: string; devolucoes: string }>(`select * from privado.ajustes_comissao($1)`, [c.id]))[0];
        return 8000 + Number(a.complementos) - Number(a.devolucoes);
      };
      const comps = async () => (await linhas<{ valor: string; status: string }>(`select valor, status from comissoes where ajuste_de = $1 order by created_at, valor`, [c.id])).map((x) => [Number(x.valor), x.status]);
      const devs = async () => (await linhas<{ valor: string; status: string }>(`select valor, status from lancamentos where comissao_devolucao_id = $1 order by created_at, valor`, [c.id])).map((x) => [Number(x.valor), x.status]);
      const passos: { efetivo: number; comps: (string | number)[][]; devs: (string | number)[][] }[] = [];
      const foto = async () => passos.push({ efetivo: await efetivo(), comps: await comps(), devs: await devs() });
      await ajustar(8500, "Bônus combinado");
      await foto();
      await ajustar(8200, "Bônus menor");
      await foto();
      await ajustar(7000, "Desconto dado ao cliente");
      await foto();
      await ajustar(7500, "Revisão do desconto");
      await foto();
      await ajustar(7000, "Desconto final");
      await foto();
      const original = (await linhas<{ valor: string; status: string }>(`select valor, status from comissoes where id = $1`, [c.id]))[0];
      const ajustes = (await linhas(`select 1 from comissao_eventos where comissao_id = $1 and tipo = 'ajuste'`, [c.id])).length;
      // Estorno da paga: devolve o que o corretor recebeu de fato, descontado o que ele já devolve.
      await db.query(`select public.estornar_comissao($1, 'Distrato')`, [c.id]);
      const estorno = { efetivo: await efetivo(), devs: await devs() };
      return { passos, original, ajustes, estorno };
    });
    expect(r.passos[0]).toEqual({ efetivo: 8500, comps: [[500, "a_pagar"]], devs: [] });
    // 2º ajuste: o complemento ainda não pago diminui (não nasce outro).
    expect(r.passos[1]).toEqual({ efetivo: 8200, comps: [[200, "a_pagar"]], devs: [] });
    // Para menos que o pago: o complemento sai e o resto vira devolução.
    expect(r.passos[2]).toEqual({ efetivo: 7000, comps: [[200, "cancelada"]], devs: [[1000, "aberto"]] });
    // Para mais com devolução em aberto: a devolução diminui.
    expect(r.passos[3]).toEqual({ efetivo: 7500, comps: [[200, "cancelada"]], devs: [[500, "aberto"]] });
    expect(r.passos[4]).toEqual({ efetivo: 7000, comps: [[200, "cancelada"]], devs: [[500, "aberto"], [500, "aberto"]] });
    expect(r.original.status).toBe("paga");
    expect(Number(r.original.valor)).toBe(8000);
    expect(r.ajustes).toBe(5);
    expect(r.estorno.devs).toEqual([
      [500, "aberto"],
      [500, "aberto"],
      [7000, "aberto"],
    ]);
    expect(r.estorno.efetivo).toBe(0);
  });

  it("gera comissões de administração da competência uma vez só", async () => {
    const r = await comoAdmin(async () => {
      await db.query(`insert into comissao_regras (tipo, pessoa_id, percentual) values ('administracao', $1, 10)`, [b.captador]);
      const n1 = (await linhas<{ n: number }>(`select public.gerar_comissoes_administracao('2026-10-15') as n`))[0].n;
      const n2 = (await linhas<{ n: number }>(`select public.gerar_comissoes_administracao('2026-10-01') as n`))[0].n;
      const adm = await linhas<{ valor: string; status: string; base: string }>(`select valor, status, base from comissoes where tipo = 'administracao' order by valor desc`);
      return { n1, n2, adm };
    });
    // Taxa retida: 180 (dono 1) e 120 (dono 2) → 10% para o captador responsável pelo imóvel.
    expect(r.n1).toBe(2);
    expect(r.n2).toBe(0);
    expect(r.adm.map((c) => [Number(c.valor), c.status])).toEqual([
      [18, "a_pagar"],
      [12, "a_pagar"],
    ]);
  });

  it("administração: ajuste depois de paga, estorno com complemento pago e divisão repetida não batem em duplicidade", async () => {
    const r = await comoAdmin(async () => {
      const [maior, menor] = await linhas<{ id: string; lancamento_id: string }>(
        `select id, lancamento_id from comissoes where tipo = 'administracao' and origem_id is null and status = 'a_pagar' order by valor desc`,
      );
      await db.query(`update lancamentos set status = 'liquidado', liquidado_em = current_date where id = $1`, [maior.lancamento_id]);
      await db.query(`select public.ajustar_comissao($1, 20, 'Reajuste da regra')`, [maior.id]);
      const comp = (await linhas<{ id: string; valor: string; status: string; lancamento_id: string; tipo: string }>(
        `select id, valor, status, lancamento_id, tipo from comissoes where ajuste_de = $1`,
        [maior.id],
      ))[0];
      await db.query(`update lancamentos set status = 'liquidado', liquidado_em = current_date where id = $1`, [comp.lancamento_id]);
      await db.query(`select public.estornar_comissao($1, 'Contrato rescindido')`, [maior.id]);
      const compDepois = (await linhas<{ status: string }>(`select status from comissoes where id = $1`, [comp.id]))[0];
      const devolucao = await linhas<{ valor: string }>(`select valor from lancamentos where comissao_devolucao_id = $1`, [maior.id]);
      // Dividir duas vezes com a mesma pessoa.
      await db.query(`select public.dividir_comissao($1, $2, 50)`, [menor.id, b.corretor]);
      await db.query(`select public.dividir_comissao($1, $2, 50)`, [menor.id, b.corretor]);
      const partes = await linhas<{ valor: string }>(`select valor from comissoes where id = $1 or origem_id = $1 order by valor desc, created_at`, [menor.id]);
      return { comp, compDepois, devolucao, partes };
    });
    expect(r.comp.tipo).toBe("administracao");
    expect(Number(r.comp.valor)).toBe(2);
    expect(r.compDepois.status).toBe("estornada");
    expect(r.devolucao.map((d) => Number(d.valor))).toEqual([20]);
    expect(r.partes.map((p) => Number(p.valor))).toEqual([6, 3, 3]);
  });

  it("repasse cancelado ou baixa desfeita cancela a comissão de administração não paga; refazer não gera em dobro", async () => {
    const r = await comoAdmin(async () => {
      const imovel = await um(`insert into imoveis (codigo, corretor_id) values ('AP-950', $1) returning id`, [b.captador]);
      const contrato = await um(
        `insert into contratos (imovel_id, data_inicio, prazo_meses, data_fim, valor_aluguel, dia_vencimento, data_base_reajuste)
         values ($1, '2026-12-01', 30, '2029-05-31', 2000, 10, '2026-12-01') returning id`,
        [imovel],
      );
      await db.query(`insert into contrato_partes (contrato_id, pessoa_id, papel, percentual) values ($1,$2,'proprietario',100)`, [contrato, b.prop1]);
      const fatura = await um(`select public.registrar_fatura($1::jsonb) as id`, [
        JSON.stringify({ contrato_id: contrato, competencia: "2027-01-01", vencimento: "2027-01-10", valor_total: 2000, itens: [{ descricao: "Aluguel 01/2027", tipo: "aluguel", valor: 2000, destino: "proprietario" }] }),
      ]);
      const baixa = JSON.stringify({
        pago_em: "2027-01-10",
        valor_pago: 2000,
        forma_pagamento: "pix",
        repasses: [{ pessoa_id: b.prop1, percentual: 100, aluguel: 2000, encargos: 0, multa_juros: 0, valor_bruto: 2000, taxa_administracao: 200, taxa_intermediacao: 0, irrf: 0, valor_liquido: 1800, previsto_para: "2027-01-12" }],
        receita_imobiliaria: 200,
      });
      const gerar = async (mes: string) => (await linhas<{ n: number }>(`select public.gerar_comissoes_administracao($1) as n`, [mes]))[0].n;
      const adms = () => linhas<{ id: string; status: string; valor: string; lancamento_id: string | null; repasse_id: string | null }>(
        `select id, status, valor, lancamento_id, repasse_id from comissoes where contrato_id = $1 and tipo = 'administracao' order by created_at`,
        [contrato],
      );

      await db.query(`select public.liquidar_fatura($1, $2::jsonb)`, [fatura, baixa]);
      const n1 = await gerar("2027-01-01");
      const primeira = (await adms())[0];
      // Baixa desfeita: o repasse é apagado e a comissão (a pagar) é cancelada junto.
      await db.query(`select public.estornar_baixa($1)`, [fatura]);
      const aposEstorno = (await adms())[0];
      const lancPrimeira = (await linhas<{ status: string }>(`select status from lancamentos where id = $1`, [primeira.lancamento_id]))[0];
      // Baixa refeita: gera de novo (a anterior foi cancelada) e paga.
      await db.query(`select public.liquidar_fatura($1, $2::jsonb)`, [fatura, baixa]);
      const n2 = await gerar("2027-01-01");
      const segunda = (await adms())[1];
      await db.query(`update lancamentos set status = 'liquidado', liquidado_em = current_date where id = $1`, [segunda.lancamento_id]);
      // Desfaz e refaz de novo: a paga fica e não nasce outra para o mesmo mês.
      await db.query(`select public.estornar_baixa($1)`, [fatura]);
      await db.query(`select public.liquidar_fatura($1, $2::jsonb)`, [fatura, baixa]);
      const n3 = await gerar("2027-01-01");
      const finais = await adms();

      // Repasse cancelado (com motivo): a comissão dele também.
      const avulso = await um(
        `insert into repasses (contrato_id, pessoa_id, competencia, percentual, valor_bruto, taxa_administracao, valor_liquido, previsto_para)
         values ($1, $2, '2027-02-01', 100, 2000, 200, 1800, '2027-02-12') returning id`,
        [contrato, b.prop1],
      );
      const n4 = await gerar("2027-02-01");
      await db.query(`select public.cancelar_repasse($1, 'Aluguel devolvido')`, [avulso]);
      const cancelada = (await linhas<{ status: string; motivo: string }>(`select status, motivo from comissoes where repasse_id = $1`, [avulso]))[0];
      return { n1, primeira, aposEstorno, lancPrimeira, n2, n3, finais, n4, cancelada };
    });
    expect(r.n1).toBe(1);
    expect(r.primeira).toMatchObject({ status: "a_pagar" });
    expect(Number(r.primeira.valor)).toBe(20);
    expect(r.aposEstorno.status).toBe("cancelada");
    expect(r.lancPrimeira.status).toBe("cancelado");
    expect(r.n2).toBe(1);
    expect(r.n3).toBe(0);
    expect(r.finais.map((c) => c.status)).toEqual(["cancelada", "paga"]);
    expect(r.n4).toBe(1);
    expect(r.cancelada).toEqual({ status: "cancelada", motivo: "Repasse cancelado" });
  });

  it("regra de administração não aceita 'só depois de receber'", async () => {
    await expect(comoAdmin(() => db.query(`insert into comissao_regras (tipo, percentual, condicionada) values ('administracao', 5, true)`))).rejects.toThrow(
      /comissao_regras_adm_sem_condicao/,
    );
  });

  it("juntar cadastros repetidos leva comissões, regras, equipe e histórico para quem fica", async () => {
    const r = await comoAdmin(async () => {
      const fica = await um(`insert into pessoas (nome, papeis) values ('Gil Corretor','{corretor}') returning id`);
      const sai = await um(`insert into pessoas (nome, papeis) values ('Gil Corretor (repetido)','{corretor}') returning id`);
      const equipe = await um(`insert into equipes (nome, lider_id) values ('Time Sul', $1) returning id`, [sai]);
      await db.query(`insert into equipe_membros (equipe_id, pessoa_id) values ($1, $2)`, [equipe, sai]);
      const regra = await um(`insert into comissao_regras (tipo, pessoa_id, percentual) values ('locacao', $1, 30) returning id`, [sai]);
      const com = await um(`insert into comissoes (pessoa_id, tipo, descricao, valor, valor_original) values ($1, 'outro', 'Bônus', 50, 50) returning id`, [sai]);
      const desp = await um(
        `insert into lancamentos (tipo, descricao, valor, vencimento, descontar_repasse, descontar_de_id) values ('pagar', 'Reparo', 10, '2026-11-01', true, $1) returning id`,
        [sai],
      );
      await db.query(`select public.juntar_pessoas($1, $2)`, [fica, sai]);
      const um1 = async (sql: string, p: unknown[]) => (await linhas<{ v: string | null }>(sql, p))[0]?.v ?? null;
      return {
        fica,
        comissao: await um1(`select pessoa_id as v from comissoes where id = $1`, [com]),
        regra: await um1(`select pessoa_id as v from comissao_regras where id = $1`, [regra]),
        membro: await um1(`select pessoa_id as v from equipe_membros where equipe_id = $1`, [equipe]),
        lider: await um1(`select lider_id as v from equipes where id = $1`, [equipe]),
        despesa: await um1(`select descontar_de_id as v from lancamentos where id = $1`, [desp]),
        eventosDoQueSaiu: (await linhas(`select 1 from comissao_eventos where pessoa_id = $1`, [sai])).length,
        saiuExiste: (await linhas(`select 1 from pessoas where id = $1`, [sai])).length,
      };
    });
    expect(r).toMatchObject({ comissao: r.fica, regra: r.fica, membro: r.fica, lider: r.fica, despesa: r.fica, eventosDoQueSaiu: 0, saiuExiste: 0 });
  });

  it("excluir a venda leva as comissões ainda não pagas", async () => {
    const r = await comoAdmin(async () => {
      const casa = await um(`insert into imoveis (codigo, finalidades) values ('CA-900','{venda}') returning id`);
      const venda = await um(`insert into vendas (imovel_id, valor, comissao_pct, status) values ($1, 100000, 6, 'aprovado') returning id`, [casa]);
      await db.query(`insert into venda_comissoes (venda_id, pessoa_id, papel, percentual) values ($1, $2, 'vendedor', 50)`, [venda, b.corretor]);
      await db.query(`select public.concluir_venda($1)`, [venda]);
      const antes = (await linhas(`select 1 from comissoes where venda_id = $1`, [venda])).length;
      await db.query(`delete from lancamentos where venda_id = $1 and status = 'aberto'`, [venda]);
      await db.query(`delete from vendas where id = $1`, [venda]);
      const depois = (await linhas(`select 1 from comissoes where venda_id = $1`, [venda])).length;
      return { antes, depois };
    });
    expect(r.antes).toBe(1);
    expect(r.depois).toBe(0);
  });

  it("outra organização não vê nada de repasses e comissões", async () => {
    const visto = await comoUsuario(db, OUTRA, async () => ({
      descontos: (await linhas(`select * from repasse_descontos`)).length,
      eventos: (await linhas(`select * from repasse_eventos`)).length,
      comissoes: (await linhas(`select * from comissoes`)).length,
      eventosCom: (await linhas(`select * from comissao_eventos`)).length,
      regras: (await linhas(`select * from comissao_regras`)).length,
      equipes: (await linhas(`select * from equipes`)).length,
    }));
    expect(visto).toEqual({ descontos: 0, eventos: 0, comissoes: 0, eventosCom: 0, regras: 0, equipes: 0 });
    // Nem consegue aprovar repasse ou ajustar comissão da outra imobiliária (não enxerga o registro).
    await expect(comoUsuario(db, OUTRA, () => db.query(`select public.aprovar_repasse($1, '{}'::jsonb)`, [b.rep1]))).rejects.toThrow(/não encontrado/);
    const alheia = await comoAdmin(() => um(`select id from comissoes limit 1`));
    await expect(comoUsuario(db, OUTRA, () => db.query(`select public.ajustar_comissao($1, 1, 'x')`, [alheia]))).rejects.toThrow(/não encontrada/);
    await expect(comoUsuario(db, OUTRA, () => db.query(`select public.estornar_comissao($1, 'x')`, [alheia]))).rejects.toThrow(/não encontrada/);
    await expect(comoUsuario(db, OUTRA, () => db.query(`insert into comissoes (organizacao_id, pessoa_id, tipo, descricao, valor) values ($1, $2, 'outro', 'x', 1)`, [org, b.corretor]))).rejects.toThrow();
  });
});
