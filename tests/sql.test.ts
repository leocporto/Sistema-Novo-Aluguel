/**
 * Valida a migração SQL num Postgres embutido (PGlite), simulando o ambiente
 * do Supabase (schema auth, papéis anon/authenticated e auth.uid()).
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

const USER_A = "00000000-0000-0000-0000-00000000000a";
const USER_B = "00000000-0000-0000-0000-00000000000b";

let db: PGlite;

async function comoUsuario<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${userId}', false);`);
  try {
    return await fn();
  } finally {
    await db.exec(`reset role;`);
  }
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
  `);
  const dir = join(__dirname, "..", "supabase", "migrations");
  for (const f of readdirSync(dir).sort()) {
    await db.exec(readFileSync(join(dir, f), "utf8"));
  }
  // No Supabase, o papel authenticated já possui esses privilégios por padrão.
  await db.exec(`
    grant usage on schema public to authenticated;
    grant select, insert, update, delete on all tables in schema public to authenticated;
  `);
});

describe("migração SQL", () => {
  it("cria organização, cadastra dados e isola por RLS", async () => {
    const orgA = await comoUsuario(USER_A, async () => {
      const r = await db.query<{ id: string }>(`select public.criar_organizacao('Imob A') as id`);
      return r.rows[0].id;
    });
    await comoUsuario(USER_B, () => db.query(`select public.criar_organizacao('Imob B')`));

    const { contratoId, faturaId, prop } = await comoUsuario(USER_A, async () => {
      const prop = (
        await db.query<{ id: string }>(
          `insert into pessoas (nome, tipo_pessoa, papeis) values ('Ana Proprietária','PF','{proprietario}') returning id`,
        )
      ).rows[0].id;
      const loc = (
        await db.query<{ id: string }>(
          `insert into pessoas (nome, tipo_pessoa, papeis) values ('Bruno Locatário','PF','{locatario}') returning id`,
        )
      ).rows[0].id;
      const imovel = (
        await db.query<{ id: string }>(`insert into imoveis (codigo, cidade) values ('AP-101','Porto Alegre') returning id`)
      ).rows[0].id;
      await db.query(`insert into imovel_proprietarios (imovel_id, pessoa_id, percentual) values ($1,$2,100)`, [
        imovel,
        prop,
      ]);
      const contratoId = (
        await db.query<{ id: string }>(
          `insert into contratos (imovel_id, data_inicio, prazo_meses, data_fim, valor_aluguel, dia_vencimento, data_base_reajuste)
           values ($1, '2026-03-01', 30, '2028-08-31', 2000, 10, '2026-03-01') returning id`,
          [imovel],
        )
      ).rows[0].id;
      await db.query(
        `insert into contrato_partes (contrato_id, pessoa_id, papel, percentual) values ($1,$2,'proprietario',100), ($1,$3,'locatario',null)`,
        [contratoId, prop, loc],
      );
      const faturaId = (
        await db.query<{ id: string }>(`select public.registrar_fatura($1::jsonb) as id`, [
          JSON.stringify({
            contrato_id: contratoId,
            competencia: "2026-03-01",
            periodo_inicio: "2026-03-01",
            periodo_fim: "2026-03-31",
            vencimento: "2026-04-10",
            valor_total: 2000,
            itens: [{ descricao: "Aluguel 03/2026", tipo: "aluguel", valor: 2000, destino: "proprietario" }],
          }),
        ])
      ).rows[0].id;
      return { contratoId, faturaId, prop };
    });

    // Usuário B não enxerga nada da imobiliária A
    const visiveisB = await comoUsuario(USER_B, async () => ({
      pessoas: (await db.query(`select * from pessoas`)).rows.length,
      faturas: (await db.query(`select * from faturas`)).rows.length,
      orgs: (await db.query(`select * from organizacoes`)).rows.length,
    }));
    expect(visiveisB).toEqual({ pessoas: 0, faturas: 0, orgs: 1 });

    // B não consegue inserir dados na organização A
    await expect(
      comoUsuario(USER_B, () =>
        db.query(`insert into pessoas (organizacao_id, nome) values ($1, 'Invasor')`, [orgA]),
      ),
    ).rejects.toThrow();

    // Liquidação gera itens extras, repasse e receita da imobiliária
    await comoUsuario(USER_A, () =>
      db.query(`select public.liquidar_fatura($1, $2::jsonb)`, [
        faturaId,
        JSON.stringify({
          pago_em: "2026-04-15",
          valor_pago: 2210,
          forma_pagamento: "pix",
          itens_extras: [
            { descricao: "Multa", tipo: "multa", valor: 200, destino: "proprietario" },
            { descricao: "Juros", tipo: "juros", valor: 10, destino: "proprietario" },
          ],
          repasses: [
            {
              pessoa_id: prop,
              percentual: 100,
              aluguel: 2000,
              encargos: 0,
              multa_juros: 210,
              valor_bruto: 2210,
              taxa_administracao: 200,
              taxa_intermediacao: 0,
              irrf: 0,
              imposto: 100,
              imposto_pct: 5,
              valor_liquido: 1910,
              previsto_para: "2026-04-17",
            },
          ],
          receita_imobiliaria: 200,
        }),
      ]),
    );

    const estado = await comoUsuario(USER_A, async () => ({
      fatura: (await db.query<{ status: string }>(`select status from faturas where id = $1`, [faturaId])).rows[0],
      itens: (await db.query(`select * from fatura_itens where fatura_id = $1`, [faturaId])).rows.length,
      repasses: (await db.query<{ valor_liquido: string; imposto: string }>(`select valor_liquido, imposto from repasses`)).rows,
      receita: (await db.query(`select * from lancamentos where tipo = 'receber'`)).rows.length,
    }));
    expect(estado.fatura.status).toBe("paga");
    expect(estado.itens).toBe(3);
    expect(Number(estado.repasses[0].valor_liquido)).toBe(1910);
    expect(Number(estado.repasses[0].imposto)).toBe(100);
    expect(estado.receita).toBe(1);

    // Não permite liquidar duas vezes
    await expect(
      comoUsuario(USER_A, () =>
        db.query(`select public.liquidar_fatura($1, $2::jsonb)`, [faturaId, JSON.stringify({ pago_em: "2026-04-16" })]),
      ),
    ).rejects.toThrow(/não está em aberto/);

    // Desfazer a baixa: volta para aberta e apaga repasse, multa/juros e receita
    await comoUsuario(USER_A, () => db.query(`select public.estornar_baixa($1)`, [faturaId]));
    const estornado = await comoUsuario(USER_A, async () => ({
      fatura: (await db.query<{ status: string; pago_em: string | null }>(`select status, pago_em from faturas where id = $1`, [faturaId]))
        .rows[0],
      itens: (await db.query(`select * from fatura_itens where fatura_id = $1`, [faturaId])).rows.length,
      repasses: (await db.query(`select * from repasses where fatura_id = $1`, [faturaId])).rows.length,
      receita: (await db.query(`select * from lancamentos where fatura_id = $1`, [faturaId])).rows.length,
    }));
    expect(estornado).toEqual({ fatura: { status: "aberta", pago_em: null }, itens: 1, repasses: 0, receita: 0 });

    // Paga de novo e, com o repasse já pago ao proprietário, não deixa desfazer
    await comoUsuario(USER_A, () =>
      db.query(`select public.liquidar_fatura($1, $2::jsonb)`, [
        faturaId,
        JSON.stringify({
          pago_em: "2026-04-10",
          valor_pago: 2000,
          forma_pagamento: "pix",
          repasses: [
            {
              pessoa_id: prop,
              percentual: 100,
              aluguel: 2000,
              encargos: 0,
              multa_juros: 0,
              valor_bruto: 2000,
              taxa_administracao: 200,
              taxa_intermediacao: 0,
              irrf: 0,
              valor_liquido: 1800,
              previsto_para: "2026-04-12",
            },
          ],
        }),
      ]),
    );
    await comoUsuario(USER_A, () => db.query(`update repasses set status = 'pago', pago_em = '2026-04-12' where fatura_id = $1`, [faturaId]));
    await expect(comoUsuario(USER_A, () => db.query(`select public.estornar_baixa($1)`, [faturaId]))).rejects.toThrow(
      /repasse ao proprietário já foi pago/,
    );

    // Não permite duas faturas ativas para a mesma competência
    await expect(
      comoUsuario(USER_A, () =>
        db.query(`select public.registrar_fatura($1::jsonb)`, [
          JSON.stringify({
            contrato_id: contratoId,
            competencia: "2026-03-01",
            vencimento: "2026-04-10",
            valor_total: 2000,
            itens: [],
          }),
        ]),
      ),
    ).rejects.toThrow();

    // Reajuste atualiza valor e histórico
    await comoUsuario(USER_A, () =>
      db.query(`select public.aplicar_reajuste($1, '2027-03-01', 'IGPM', 4.5, 2090)`, [contratoId]),
    );
    const c = await comoUsuario(USER_A, async () =>
      (await db.query<{ valor_aluguel: string; data_base_reajuste: string }>(
        `select valor_aluguel, data_base_reajuste::text from contratos where id = $1`,
        [contratoId],
      )).rows[0],
    );
    expect(Number(c.valor_aluguel)).toBe(2090);
    expect(c.data_base_reajuste).toBe("2027-03-01");

    // Régua padrão criada
    const regras = await comoUsuario(USER_A, async () => (await db.query(`select * from regua_regras`)).rows.length);
    expect(regras).toBe(3);
  });
});

describe("comercial, comissões e preferências do painel", () => {
  const USER_C = "00000000-0000-0000-0000-00000000000c";
  const USER_D = "00000000-0000-0000-0000-00000000000d";

  it("aceitar proposta fecha o negócio, marca o imóvel e gera a comissão", async () => {
    const orgC = await comoUsuario(USER_C, async () => (await db.query<{ id: string }>(`select public.criar_organizacao('Imob C') as id`)).rows[0].id);
    await comoUsuario(USER_D, () => db.query(`select public.criar_organizacao('Imob D')`));

    const r = await comoUsuario(USER_C, async () => {
      const um = async (sql: string, p: unknown[] = []) => (await db.query<{ id: string }>(sql, p)).rows[0].id;
      const corretor = await um(`insert into pessoas (nome, papeis) values ('Carla Corretora','{corretor}') returning id`);
      const casa = await um(`insert into imoveis (codigo, finalidades) values ('CA-1','{venda}') returning id`);
      const ap = await um(`insert into imoveis (codigo) values ('AP-2') returning id`);
      const lead = await um(`insert into leads (nome, origem, interesse, imovel_id) values ('Diego','whatsapp','compra',$1) returning id`, [casa]);
      await db.query(`insert into visitas (lead_id, imovel_id, corretor_id, data_hora) values ($1,$2,$3, now() + interval '1 day')`, [lead, casa, corretor]);
      const pVenda = await um(
        `insert into propostas (lead_id, imovel_id, tipo, valor, corretor_id, comissao_pct) values ($1,$2,'venda',500000,$3,6) returning id`,
        [lead, casa, corretor],
      );
      const pLoc = await um(`insert into propostas (imovel_id, tipo, valor) values ($1,'locacao',2500) returning id`, [ap]);
      await db.query(`select public.aceitar_proposta($1)`, [pVenda]);
      await db.query(`select public.aceitar_proposta($1)`, [pLoc]);
      const imoveis = (await db.query<{ codigo: string; status: string; vendido_em: string | null; captado_em: string }>(
        `select codigo, status, vendido_em::text, captado_em::text from imoveis order by codigo`,
      )).rows;
      const leadSt = (await db.query<{ status: string }>(`select status from leads where id = $1`, [lead])).rows[0].status;
      const comissoes = (await db.query<{ valor: string; categoria: string; pessoa_id: string }>(
        `select valor, categoria, pessoa_id from lancamentos where proposta_id is not null`,
      )).rows;
      await db.query(`insert into painel_preferencias (organizacao_id, widgets) values ($1, '{"ordem":["a"]}')`, [orgC]);
      return { imoveis, leadSt, comissoes, corretor, pVenda };
    });

    expect(r.imoveis.find((i) => i.codigo === "CA-1")?.status).toBe("vendido");
    expect(r.imoveis.find((i) => i.codigo === "CA-1")?.vendido_em).toBeTruthy();
    expect(r.imoveis.find((i) => i.codigo === "AP-2")?.status).toBe("reservado");
    expect(r.imoveis.every((i) => Boolean(i.captado_em))).toBe(true);
    expect(r.leadSt).toBe("ganho");
    expect(r.comissoes).toHaveLength(1);
    expect(Number(r.comissoes[0].valor)).toBe(30000);
    expect(r.comissoes[0].pessoa_id).toBe(r.corretor);

    // Aceitar de novo é recusado
    await expect(comoUsuario(USER_C, () => db.query(`select public.aceitar_proposta($1)`, [r.pVenda]))).rejects.toThrow();

    // Outra organização não vê leads, propostas nem preferências
    const visto = await comoUsuario(USER_D, async () => ({
      leads: (await db.query(`select * from leads`)).rows.length,
      propostas: (await db.query(`select * from propostas`)).rows.length,
      prefs: (await db.query(`select * from painel_preferencias`)).rows.length,
    }));
    expect(visto).toEqual({ leads: 0, propostas: 0, prefs: 0 });
  });
});

describe("cadastro completo de imóveis", () => {
  const USER_E = "00000000-0000-0000-0000-00000000000e";
  const USER_F = "00000000-0000-0000-0000-00000000000f";

  it("registra histórico de preços e isola empreendimentos, mídias e anúncios", async () => {
    await comoUsuario(USER_E, () => db.query(`select public.criar_organizacao('Imob E')`));
    await comoUsuario(USER_F, () => db.query(`select public.criar_organizacao('Imob F')`));

    const r = await comoUsuario(USER_E, async () => {
      const emp = (await db.query<{ id: string }>(`insert into empreendimentos (nome) values ('Residencial Sol') returning id`)).rows[0].id;
      const im = (
        await db.query<{ id: string }>(
          `insert into imoveis (codigo, valor_aluguel, empreendimento_id, bloco, unidade, comodidades) values ('SOL-A-101', 2000, $1, 'A', '101', '{piscina}') returning id`,
          [emp],
        )
      ).rows[0].id;
      await db.query(`update imoveis set valor_aluguel = 2200, valor_venda = 450000 where id = $1`, [im]);
      await db.query(`update imoveis set quartos = 2 where id = $1`, [im]); // não mexe em preço
      await db.query(`update imoveis set valor_aluguel = 2200 where id = $1`, [im]); // mesmo valor
      await db.query(`insert into imovel_midias (imovel_id, tipo, path) values ($1, 'foto', 'x/y.jpg')`, [im]);
      await db.query(`insert into imovel_anuncios (imovel_id, portal) values ($1, 'ZAP')`, [im]);
      return (
        await db.query<{ campo: string; valor_anterior: string | null; valor_novo: string }>(
          `select campo, valor_anterior, valor_novo from imovel_precos where imovel_id = $1 order by alterado_em, campo`,
          [im],
        )
      ).rows;
    });
    expect(r.map((p) => `${p.campo}:${p.valor_anterior ?? "-"}>${Number(p.valor_novo)}`).sort()).toEqual(
      ["aluguel:-.>2000", "aluguel:2000.00>2200", "venda:-.>450000"].map((s) => s.replace("-.", "-")).sort(),
    );

    const visto = await comoUsuario(USER_F, async () => ({
      emp: (await db.query(`select * from empreendimentos`)).rows.length,
      midias: (await db.query(`select * from imovel_midias`)).rows.length,
      anuncios: (await db.query(`select * from imovel_anuncios`)).rows.length,
      precos: (await db.query(`select * from imovel_precos`)).rows.length,
    }));
    expect(visto).toEqual({ emp: 0, midias: 0, anuncios: 0, precos: 0 });
  });
});

describe("contrato único por imóvel", () => {
  const USER_G = "00000000-0000-0000-0000-000000000010";
  it("bloqueia dois contratos ativos no mesmo período, mas aceita renovação depois", async () => {
    await comoUsuario(USER_G, () => db.query(`select public.criar_organizacao('Imob G')`));
    await comoUsuario(USER_G, async () => {
      const im = (await db.query<{ id: string }>(`insert into imoveis (codigo) values ('UNI-1') returning id`)).rows[0].id;
      const ins = (ini: string, fim: string) =>
        db.query(
          `insert into contratos (imovel_id, data_inicio, prazo_meses, data_fim, valor_aluguel, dia_vencimento, data_base_reajuste)
           values ($1, $2, 12, $3, 1000, 10, $2)`,
          [im, ini, fim],
        );
      await ins("2026-01-01", "2026-12-31");
      await expect(ins("2026-06-01", "2027-05-31")).rejects.toThrow(/já tem o contrato ativo/);
      await ins("2027-01-01", "2027-12-31"); // renovação, sem sobrepor
    });
  });
});

describe("juntar cadastros de pessoas", () => {
  const USER_H = "00000000-0000-0000-0000-000000000011";
  const USER_I = "00000000-0000-0000-0000-000000000012";
  it("move imóveis, contratos e dados para quem fica e apaga o repetido", async () => {
    await comoUsuario(USER_H, () => db.query(`select public.criar_organizacao('Imob H')`));
    await comoUsuario(USER_I, () => db.query(`select public.criar_organizacao('Imob I')`));
    const r = await comoUsuario(USER_H, async () => {
      const um = async (sql: string, p: unknown[] = []) => (await db.query<{ id: string }>(sql, p)).rows[0].id;
      const a = await um(`insert into pessoas (nome, papeis, telefone) values ('Maria Silva','{proprietario}','11999') returning id`);
      const b = await um(`insert into pessoas (nome, papeis, documento, email) values ('Maria da Silva','{locatario}','12345678909','m@x.com') returning id`);
      const outro = await um(`insert into pessoas (nome) values ('Joana') returning id`);
      const im1 = await um(`insert into imoveis (codigo) values ('J-1') returning id`);
      const im2 = await um(`insert into imoveis (codigo) values ('J-2') returning id`);
      await db.query(`insert into imovel_proprietarios (imovel_id, pessoa_id, percentual) values ($1,$2,50), ($1,$3,50), ($4,$3,100)`, [im1, a, b, im2]);
      const ct = await um(
        `insert into contratos (imovel_id, data_inicio, prazo_meses, data_fim, valor_aluguel, dia_vencimento, data_base_reajuste)
         values ($1,'2026-01-01',12,'2026-12-31',1000,10,'2026-01-01') returning id`,
        [im2],
      );
      await db.query(`insert into contrato_partes (contrato_id, pessoa_id, papel) values ($1,$2,'locatario')`, [ct, b]);
      await db.query(`insert into pessoa_vinculos (pessoa_id, vinculado_id, tipo) values ($1,$2,'conjuge')`, [b, outro]);
      await db.query(`insert into pessoa_interacoes (pessoa_id, descricao) values ($1,'ligou')`, [b]);
      await db.query(`select public.juntar_pessoas($1, $2)`, [a, b]);
      const pessoa = (await db.query<{ papeis: string[]; documento: string; email: string; telefone: string }>(`select papeis, documento, email, telefone from pessoas where id = $1`, [a])).rows[0];
      const props = (await db.query<{ imovel_id: string; percentual: string }>(`select imovel_id, percentual from imovel_proprietarios where pessoa_id = $1 order by percentual`, [a])).rows;
      const partes = (await db.query(`select * from contrato_partes where pessoa_id = $1`, [a])).rows.length;
      const vinc = (await db.query(`select * from pessoa_vinculos where pessoa_id = $1`, [a])).rows.length;
      const sobrou = (await db.query(`select * from pessoas where id = $1`, [b])).rows.length;
      return { pessoa, props, partes, vinc, sobrou };
    });
    expect(r.pessoa.papeis.sort()).toEqual(["locatario", "proprietario"]);
    expect(r.pessoa).toMatchObject({ documento: "12345678909", email: "m@x.com", telefone: "11999" });
    expect(r.props.map((p) => Number(p.percentual))).toEqual([100, 100]);
    expect(r.partes).toBe(1);
    expect(r.vinc).toBe(1);
    expect(r.sobrou).toBe(0);
    const visto = await comoUsuario(USER_I, async () => (await db.query(`select * from pessoa_interacoes`)).rows.length);
    expect(visto).toBe(0);
  });
});
