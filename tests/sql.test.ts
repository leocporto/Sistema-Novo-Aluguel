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
      // Venda aceita abre o processo e só reserva o imóvel
      const venda = (await db.query<{ id: string; status: string }>(`select v.id, v.status from vendas v join propostas p on p.venda_id = v.id where p.id = $1`, [pVenda])).rows[0];
      const antes = (await db.query<{ status: string }>(`select status from imoveis where id = $1`, [casa])).rows[0].status;
      const leadAntes = (await db.query<{ status: string }>(`select status from leads where id = $1`, [lead])).rows[0].status;
      const parceiro = await um(`insert into pessoas (nome, papeis) values ('Paulo Parceiro','{parceiro}') returning id`);
      await db.query(`update venda_comissoes set percentual = 60 where venda_id = $1`, [venda.id]);
      await db.query(`insert into venda_comissoes (venda_id, pessoa_id, papel, percentual) values ($1, $2, 'parceiro', 40)`, [venda.id, parceiro]);
      await db.query(`select public.concluir_venda($1)`, [venda.id]);
      let dupla = "";
      try {
        await db.query(`select public.concluir_venda($1)`, [venda.id]);
      } catch (e) {
        dupla = String(e);
      }
      const daVenda = (await db.query<{ tipo: string; valor: string; pessoa_id: string | null }>(`select tipo, valor, pessoa_id from lancamentos where venda_id = $1 order by tipo, valor desc`, [venda.id])).rows;
      const imoveis = (await db.query<{ codigo: string; status: string; vendido_em: string | null; captado_em: string }>(
        `select codigo, status, vendido_em::text, captado_em::text from imoveis order by codigo`,
      )).rows;
      const leadSt = (await db.query<{ status: string }>(`select status from leads where id = $1`, [lead])).rows[0].status;
      const comissoes = (await db.query<{ valor: string; categoria: string; pessoa_id: string }>(
        `select valor, categoria, pessoa_id from lancamentos where proposta_id is not null`,
      )).rows;
      await db.query(`insert into painel_preferencias (organizacao_id, widgets) values ($1, '{"ordem":["a"]}')`, [orgC]);
      return { imoveis, leadSt, comissoes, corretor, pVenda, venda, antes, leadAntes, dupla, daVenda, parceiro };
    });

    expect(r.imoveis.find((i) => i.codigo === "CA-1")?.status).toBe("vendido");
    expect(r.imoveis.find((i) => i.codigo === "CA-1")?.vendido_em).toBeTruthy();
    expect(r.imoveis.find((i) => i.codigo === "AP-2")?.status).toBe("reservado");
    expect(r.imoveis.every((i) => Boolean(i.captado_em))).toBe(true);
    expect(r.venda.status).toBe("aprovado");
    expect(r.antes).toBe("reservado");
    expect(r.leadAntes).toBe("proposta");
    expect(r.leadSt).toBe("ganho");
    expect(r.comissoes).toHaveLength(0); // venda só gera comissão ao concluir
    expect(r.dupla).toContain("já foi concluída");
    // Comissão total a receber (6% de 500 mil) e divisão 60/40 a pagar
    expect(r.daVenda.map((l) => [l.tipo, Number(l.valor), l.pessoa_id])).toEqual([
      ["pagar", 18000, r.corretor],
      ["pagar", 12000, r.parceiro],
      ["receber", 30000, null],
    ]);

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

describe("CRM: entrada pública de leads", () => {
  const USER_J = "00000000-0000-0000-0000-000000000013";
  it("cria lead pelo token, distribui no rodízio e não repete o mesmo contato", async () => {
    const org = await comoUsuario(USER_J, async () => (await db.query<{ id: string }>(`select public.criar_organizacao('Imob J') as id`)).rows[0].id);
    const { token, c1, c2 } = await comoUsuario(USER_J, async () => {
      await db.query(`update organizacoes set distribuicao_leads = 'rodizio' where id = $1`, [org]);
      const c1 = (await db.query<{ id: string }>(`insert into pessoas (nome, papeis) values ('Ana Corretora','{corretor}') returning id`)).rows[0].id;
      const c2 = (await db.query<{ id: string }>(`insert into pessoas (nome, papeis) values ('Beto Corretor','{corretor}') returning id`)).rows[0].id;
      await db.query(`insert into imoveis (codigo) values ('AP-77')`);
      const token = (await db.query<{ leads_token: string }>(`select leads_token from organizacoes where id = $1`, [org])).rows[0].leads_token;
      return { token, c1, c2 };
    });
    // Visitante sem login (anon)
    await db.exec(`set role anon; select set_config('request.jwt.claim.sub', '', false);`);
    const r1 = (await db.query<{ r: { id: string; duplicado: boolean } }>(`select public.receber_lead($1, $2) as r`, [token, JSON.stringify({ nome: "Carla", telefone: "(11) 98888-7777", imovel: "ap-77", origem: "instagram" })])).rows[0].r;
    const r2 = (await db.query<{ r: { id: string; duplicado: boolean } }>(`select public.receber_lead($1, $2) as r`, [token, JSON.stringify({ nome: "Carla S", telefone: "11988887777", mensagem: "oi de novo" })])).rows[0].r;
    const r3 = (await db.query<{ r: { id: string; duplicado: boolean } }>(`select public.receber_lead($1, $2) as r`, [token, JSON.stringify({ nome: "Davi", email: "d@x.com", funil: "venda" })])).rows[0].r;
    await expect(db.query(`select public.receber_lead(gen_random_uuid(), '{"nome":"x","email":"a@a"}')`)).rejects.toThrow();
    await expect(db.query(`select * from leads`)).rejects.toThrow(); // anon não lê a tabela
    await db.exec(`reset role;`);
    expect(r1.duplicado).toBe(false);
    expect(r2).toEqual({ id: r1.id, duplicado: true });
    const v = await comoUsuario(USER_J, async () => ({
      leads: (await db.query<{ nome: string; corretor_id: string; funil: string; origem: string }>(`select nome, corretor_id, funil, origem from leads order by created_at`)).rows,
      eventos: (await db.query(`select * from lead_eventos where lead_id = $1`, [r1.id])).rows.length,
      imoveis: (await db.query(`select * from lead_imoveis where lead_id = $1`, [r1.id])).rows.length,
    }));
    expect(v.leads).toHaveLength(2);
    expect(v.leads.map((l) => l.corretor_id).sort()).toEqual([c1, c2].sort());
    expect(v.leads[1]).toMatchObject({ funil: "venda" });
    expect(v.leads[0].origem).toBe("instagram");
    expect(v.eventos).toBe(2);
    expect(v.imoveis).toBe(1);
    expect(r3.duplicado).toBe(false);
  });
});

describe("captação de imóveis", () => {
  const USER_K = "00000000-0000-0000-0000-000000000014";
  it("formulário de anunciar vira captação, e a captação vira imóvel com proprietário", async () => {
    const org = await comoUsuario(USER_K, async () => (await db.query<{ id: string }>(`select public.criar_organizacao('Imob K') as id`)).rows[0].id);
    const token = await comoUsuario(USER_K, async () => (await db.query<{ t: string }>(`select leads_token as t from organizacoes where id = $1`, [org])).rows[0].t);
    await db.exec(`set role anon; select set_config('request.jwt.claim.sub', '', false);`);
    const r = (await db.query<{ r: { id: string; captacao: boolean } }>(`select public.receber_lead($1, $2) as r`, [token, JSON.stringify({ nome: "Seu Zé", telefone: "11977776666", funil: "captacao", mensagem: "Casa para alugar" })])).rows[0].r;
    await db.exec(`reset role;`);
    expect(r.captacao).toBe(true);
    const v = await comoUsuario(USER_K, async () => {
      await db.query(
        `update captacoes set tipo='casa', finalidades='{locacao}', logradouro='Rua Um', numero_end='10', cidade='Santos', quartos=3, valor_avaliado_aluguel=3200, exclusivo=true where id=$1`,
        [r.id],
      );
      const imovel = (await db.query<{ id: string }>(`select public.converter_captacao($1, 'CA-900') as id`, [r.id])).rows[0].id;
      const im = (await db.query<{ codigo: string; valor_aluguel: string; status: string; captado_em: string; exclusivo: boolean }>(`select codigo, valor_aluguel, status, captado_em::text, exclusivo from imoveis where id=$1`, [imovel])).rows[0];
      const dono = (await db.query<{ nome: string; papeis: string[] }>(`select p.nome, p.papeis from imovel_proprietarios ip join pessoas p on p.id = ip.pessoa_id where ip.imovel_id=$1`, [imovel])).rows[0];
      const cap = (await db.query<{ status: string; imovel_id: string }>(`select status, imovel_id from captacoes where id=$1`, [r.id])).rows[0];
      let segunda = "";
      try {
        await db.query(`select public.converter_captacao($1, 'CA-901')`, [r.id]);
      } catch (e) {
        segunda = String(e);
      }
      return { im, dono, cap, imovel, segunda };
    });
    expect(v.im).toMatchObject({ codigo: "CA-900", status: "disponivel", exclusivo: true });
    expect(Number(v.im.valor_aluguel)).toBe(3200);
    expect(v.im.captado_em).toBeTruthy();
    expect(v.dono).toEqual({ nome: "Seu Zé", papeis: ["proprietario"] });
    expect(v.cap).toEqual({ status: "captado", imovel_id: v.imovel });
    expect(v.segunda).toContain("já virou imóvel");
  });
});

describe("agenda e chaves", () => {
  const USER_L = "00000000-0000-0000-0000-000000000015";
  const USER_M = "00000000-0000-0000-0000-000000000016";
  it("feed da agenda pelo token, chave com uma retirada aberta e isolamento", async () => {
    const org = await comoUsuario(USER_L, async () => (await db.query<{ id: string }>(`select public.criar_organizacao('Imob L') as id`)).rows[0].id);
    await comoUsuario(USER_M, () => db.query(`select public.criar_organizacao('Imob M')`));
    const r = await comoUsuario(USER_L, async () => {
      const im = (await db.query<{ id: string }>(`insert into imoveis (codigo, tipo, logradouro, numero, cidade) values ('AG-1','casa','Rua A','5','Santos') returning id`)).rows[0].id;
      const p = (await db.query<{ id: string }>(`insert into pessoas (nome, telefone) values ('Ana Interessada','13999990000') returning id`)).rows[0].id;
      const v = (await db.query<{ id: string; responsavel_id: string }>(
        `insert into visitas (imovel_id, pessoa_id, data_hora, tipo, duracao_min) values ($1, $2, now() + interval '1 day', 'visita', 45) returning id, responsavel_id`,
        [im, p],
      )).rows[0];
      await db.query(`insert into visitas (imovel_id, data_hora, status) values ($1, now() + interval '2 day', 'cancelada')`, [im]);
      const ch = (await db.query<{ id: string }>(`insert into chaves (imovel_id, identificacao, codigo) values ($1, 'Portão', 'CH-010') returning id`, [im])).rows[0].id;
      await db.query(`insert into chave_movimentacoes (chave_id, retirada_por, visita_id) values ($1, 'Ana', $2)`, [ch, v.id]);
      let dupla = "";
      try {
        await db.query(`insert into chave_movimentacoes (chave_id, retirada_por) values ($1, 'Outro')`, [ch]);
      } catch (e) {
        dupla = String(e);
      }
      const token = (await db.query<{ t: string }>(`select agenda_token as t from organizacoes where id = $1`, [org])).rows[0].t;
      return { v, dupla, token };
    });
    expect(r.v.responsavel_id).toBe(USER_L);
    expect(r.dupla).toMatch(/duplicate|unique|único/i);
    await db.exec(`set role anon; select set_config('request.jwt.claim.sub', '', false);`);
    const feed = (await db.query<{ cliente: string; imovel: string; endereco: string; duracao_min: number }>(`select * from public.agenda_feed($1)`, [r.token])).rows;
    const errado = (await db.query(`select * from public.agenda_feed($1)`, ["00000000-0000-0000-0000-000000000000"])).rows;
    let direto = "";
    try {
      await db.query(`select * from visitas`);
    } catch (e) {
      direto = String(e);
    }
    await db.exec(`reset role;`);
    expect(feed).toHaveLength(1);
    expect(feed[0]).toMatchObject({ cliente: "Ana Interessada", imovel: "AG-1", endereco: "Rua A, 5, Santos", duracao_min: 45 });
    expect(errado).toHaveLength(0);
    expect(direto).toMatch(/permission|denied/i);
    const deM = await comoUsuario(USER_M, async () => (await db.query(`select * from chaves`)).rows.length);
    expect(deM).toBe(0);
  });
});

describe("vendas: reserva acompanha o processo", () => {
  const USER_N = "00000000-0000-0000-0000-000000000017";
  it("reserva o imóvel durante a venda e libera ao cancelar", async () => {
    await comoUsuario(USER_N, () => db.query(`select public.criar_organizacao('Imob N')`));
    const r = await comoUsuario(USER_N, async () => {
      const im = (await db.query<{ id: string }>(`insert into imoveis (codigo, finalidades) values ('VD-1','{venda}') returning id`)).rows[0].id;
      const st = async () => (await db.query<{ status: string }>(`select status from imoveis where id = $1`, [im])).rows[0].status;
      const v = (await db.query<{ id: string }>(`insert into vendas (imovel_id, valor, status) values ($1, 300000, 'negociacao') returning id`, [im])).rows[0].id;
      const a = await st();
      await db.query(`update vendas set status = 'documentacao' where id = $1`, [v]);
      const b = await st();
      await db.query(`update vendas set status = 'cancelada', motivo_cancelamento = 'Desistiu' where id = $1`, [v]);
      const c = await st();
      return [a, b, c];
    });
    expect(r).toEqual(["disponivel", "reservado", "disponivel"]);
  });
});

describe("locação completa: aditivo, renovação e desocupação", () => {
  const USER_O = "00000000-0000-0000-0000-000000000018";
  it("aditivo muda valor e prazo; desocupação acerta, cancela faturas futuras, devolve caução e libera o imóvel", async () => {
    await comoUsuario(USER_O, () => db.query(`select public.criar_organizacao('Imob O')`));
    const r = await comoUsuario(USER_O, async () => {
      const um = async (sql: string, p: unknown[] = []) => (await db.query<{ id: string }>(sql, p)).rows[0].id;
      const loc = await um(`insert into pessoas (nome, papeis) values ('Lia Locatária','{locatario}') returning id`);
      const im = await um(`insert into imoveis (codigo, status) values ('LC-1','alugado') returning id`);
      const c = await um(
        `insert into contratos (imovel_id, data_inicio, prazo_meses, data_fim, valor_aluguel, dia_vencimento, data_base_reajuste, garantia_tipo, garantia_valor)
         values ($1, '2026-01-01', 30, '2028-06-30', 2000, 10, '2026-01-01', 'caucao', 6000) returning id`,
        [im],
      );
      await db.query(`insert into contrato_partes (contrato_id, pessoa_id, papel) values ($1, $2, 'locatario')`, [c, loc]);
      // migração já criou a garantia (rodou antes do contrato existir) — cria aqui como a tela faria
      await db.query(`insert into contrato_garantias (contrato_id, tipo, valor) values ($1, 'caucao', 6000)`, [c]);
      const ad = await um(`insert into contrato_aditivos (contrato_id, tipo, descricao, valor_novo, data_fim_nova) values ($1, 'renovacao', 'Renovação', 2200, '2029-12-31') returning id`, [c]);
      await db.query(`select public.aplicar_aditivo($1)`, [ad]);
      let duas = "";
      try {
        await db.query(`select public.aplicar_aditivo($1)`, [ad]);
      } catch (e) {
        duas = String(e);
      }
      const ct = (await db.query<{ valor_aluguel: string; data_fim: string; prazo_meses: number }>(`select valor_aluguel, data_fim::text, prazo_meses from contratos where id = $1`, [c])).rows[0];
      const reaj = (await db.query<{ indice: string; percentual: string }>(`select indice, percentual from contrato_reajustes where contrato_id = $1`, [c])).rows;
      // faturas: março paga (até 31/03), abril e maio abertas
      for (const [comp, ini, fim, st] of [
        ["2026-03-01", "2026-03-01", "2026-03-31", "paga"],
        ["2026-04-01", "2026-04-01", "2026-04-30", "aberta"],
        ["2026-05-01", "2026-05-01", "2026-05-31", "aberta"],
      ])
        await db.query(`insert into faturas (contrato_id, competencia, periodo_inicio, periodo_fim, vencimento, valor_total, status) values ($1,$2,$3,$4,$4,2200,$5)`, [c, comp, ini, fim, st]);
      const d = await um(`insert into contrato_desocupacoes (contrato_id, caucao_devolver) values ($1, 6000) returning id`, [c]);
      await db.query(`select public.concluir_desocupacao($1, $2)`, [d, JSON.stringify({ total: -1500, entrega: "2026-04-20", pago_ate: "2026-03-31", encerrar_como: "rescindido" })]);
      const fat = (await db.query<{ competencia: string; status: string }>(`select competencia::text, status from faturas where contrato_id = $1 order by competencia`, [c])).rows.map((f) => f.status);
      const lanc = (await db.query<{ tipo: string; valor: string; categoria: string }>(`select tipo, valor, categoria from lancamentos where contrato_id = $1`, [c])).rows;
      const gar = (await db.query<{ status: string; valor_devolvido: string }>(`select status, valor_devolvido from contrato_garantias where contrato_id = $1`, [c])).rows[0];
      const est = (await db.query<{ s: string; c: string }>(`select i.status as s, ct.status as c from imoveis i, contratos ct where i.id = $1 and ct.id = $2`, [im, c])).rows[0];
      return { duas, ct, reaj, fat, lanc, gar, est };
    });
    expect(r.duas).toContain("já foi aplicado");
    expect(Number(r.ct.valor_aluguel)).toBe(2200);
    expect(r.ct.data_fim).toBe("2029-12-31");
    expect(r.ct.prazo_meses).toBe(48);
    expect(r.reaj[0].indice).toBe("ADITIVO");
    expect(Number(r.reaj[0].percentual)).toBe(10);
    expect(r.fat).toEqual(["paga", "cancelada", "cancelada"]);
    expect(r.lanc.map((l) => [l.tipo, Number(l.valor), l.categoria])).toEqual([["pagar", 1500, "Devolução de caução"]]);
    expect(r.gar).toMatchObject({ status: "devolvida" });
    expect(Number(r.gar.valor_devolvido)).toBe(6000);
    expect(r.est).toEqual({ s: "disponivel", c: "rescindido" });
  });
});

describe("documentos: assinatura eletrônica, restritos e auditoria", () => {
  const USER_P = "00000000-0000-0000-0000-000000000019";
  const USER_Q = "00000000-0000-0000-0000-00000000001a";
  it("assina por link, conclui quando todos assinam, esconde restrito do corretor e não deixa apagar auditoria", async () => {
    const org = await comoUsuario(USER_P, async () => (await db.query<{ id: string }>(`select public.criar_organizacao('Imob P') as id`)).rows[0].id);
    await db.query(`insert into membros (organizacao_id, user_id, papel) values ($1, $2, 'corretor')`, [org, USER_Q]);
    const r = await comoUsuario(USER_P, async () => {
      const d = (await db.query<{ id: string }>(`insert into documentos (titulo, conteudo, status) values ('Contrato X', 'Texto do contrato', 'aguardando_assinatura') returning id`)).rows[0].id;
      await db.query(`insert into documentos (titulo, restrito) values ('Segredo', true)`);
      const t1 = (await db.query<{ token: string }>(`insert into documento_signatarios (documento_id, nome, cpf, papel) values ($1, 'Ana', '123.456.789-09', 'locatario') returning token`, [d])).rows[0].token;
      const t2 = (await db.query<{ token: string }>(`insert into documento_signatarios (documento_id, nome, papel, ordem) values ($1, 'Teste Munha', 'testemunha', 2) returning token`, [d])).rows[0].token;
      await db.query(`insert into documento_eventos (documento_id, tipo, descricao) values ($1, 'criado', 'x')`, [d]);
      return { d, t1, t2 };
    });
    await db.exec(`set role anon; select set_config('request.jwt.claim.sub', '', false);`);
    const info = (await db.query<{ r: { titulo: string; signatario: { nome: string } } }>(`select public.info_assinatura($1) as r`, [r.t1])).rows[0].r;
    let cpfErrado = "";
    try {
      await db.query(`select public.assinar_documento($1, $2)`, [r.t1, JSON.stringify({ nome: "Ana Souza", cpf: "11111111111", aceite: true })]);
    } catch (e) {
      cpfErrado = String(e);
    }
    const a1 = (await db.query<{ r: { concluido: boolean } }>(`select public.assinar_documento($1, $2) as r`, [r.t1, JSON.stringify({ nome: "Ana Souza", cpf: "12345678909", aceite: true, ip: "1.2.3.4" })])).rows[0].r;
    const a2 = (await db.query<{ r: { concluido: boolean } }>(`select public.assinar_documento($1, $2) as r`, [r.t2, JSON.stringify({ nome: "Teste Munha", cpf: "98765432100", aceite: true })])).rows[0].r;
    await db.exec(`reset role;`);
    expect(info.titulo).toBe("Contrato X");
    expect(info.signatario.nome).toBe("Ana");
    expect(cpfErrado).toContain("não confere");
    expect(a1.concluido).toBe(false);
    expect(a2.concluido).toBe(true);
    const v = await comoUsuario(USER_P, async () => ({
      st: (await db.query<{ status: string; hash_final: string }>(`select status, hash_final from documentos where id = $1`, [r.d])).rows[0],
      eventos: (await db.query<{ tipo: string }>(`select tipo from documento_eventos where documento_id = $1 order by data`, [r.d])).rows.map((e) => e.tipo),
      apagou: (await db.query(`delete from documento_eventos where documento_id = $1 returning id`, [r.d])).rows.length,
      todos: (await db.query(`select id from documentos`)).rows.length,
    }));
    expect(v.st.status).toBe("assinado");
    expect(v.st.hash_final).toHaveLength(64);
    expect(v.eventos).toEqual(["criado", "visualizado", "assinado", "assinado", "concluido"]);
    expect(v.apagou).toBe(0);
    expect(v.todos).toBe(2);
    const doCorretor = await comoUsuario(USER_Q, async () => (await db.query(`select id from documentos`)).rows.length);
    expect(doCorretor).toBe(1);
  });
});

describe("financeiro: histórico, contas e isolamento", () => {
  const USER_F = "00000000-0000-0000-0000-00000000001b";
  const USER_G = "00000000-0000-0000-0000-00000000001c";
  it("grava histórico de criação, baixa e estorno, não deixa apagar e isola contas por organização", async () => {
    await comoUsuario(USER_F, () => db.query(`select public.criar_organizacao('Imob F')`));
    await comoUsuario(USER_G, () => db.query(`select public.criar_organizacao('Imob G')`));
    const r = await comoUsuario(USER_F, async () => {
      const conta = (await db.query<{ id: string }>(`insert into contas_financeiras (nome, tipo, saldo_inicial) values ('Banco X', 'corrente', 1000) returning id`)).rows[0].id;
      const plano = (await db.query<{ id: string }>(`insert into plano_contas (codigo, nome, tipo, grupo_dre) values ('2.1', 'Aluguel do escritório', 'despesa', 'despesas_operacionais') returning id`)).rows[0].id;
      const l = (await db.query<{ id: string }>(`insert into lancamentos (tipo, descricao, valor, vencimento, conta_id, plano_id) values ('pagar', 'Aluguel sala', 500, '2026-11-10', $1, $2) returning id`, [conta, plano])).rows[0].id;
      await db.query(`update lancamentos set status = 'liquidado', liquidado_em = '2026-11-10', valor_pago = 510, juros = 10 where id = $1`, [l]);
      await db.query(`update lancamentos set status = 'aberto', liquidado_em = null, valor_pago = null, juros = 0 where id = $1`, [l]);
      await db.query(`insert into extrato_itens (conta_id, data, descricao, valor, fitid) values ($1, '2026-11-10', 'TARIFA', -12.5, 'abc')`, [conta]);
      let dup = "";
      try {
        await db.query(`insert into extrato_itens (conta_id, data, descricao, valor, fitid) values ($1, '2026-11-10', 'TARIFA', -12.5, 'abc')`, [conta]);
      } catch (e) {
        dup = String(e);
      }
      const hist = (await db.query<{ acao: string }>(`select acao from lancamento_historico where lancamento_id = $1 order by data, acao`, [l])).rows.map((x) => x.acao);
      const apagou = (await db.query(`delete from lancamento_historico where lancamento_id = $1 returning id`, [l])).rows.length;
      return { hist, apagou, dup };
    });
    expect(r.hist.sort()).toEqual(["criado", "estornado", "liquidado"]);
    expect(r.apagou).toBe(0);
    expect(r.dup).toContain("duplicate");
    const doOutro = await comoUsuario(USER_G, async () => ({
      contas: (await db.query(`select id from contas_financeiras`)).rows.length,
      hist: (await db.query(`select id from lancamento_historico`)).rows.length,
    }));
    expect(doOutro).toEqual({ contas: 0, hist: 0 });
  });
});
