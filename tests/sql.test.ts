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
