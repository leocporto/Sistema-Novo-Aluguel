/**
 * Banco de teste: Postgres embutido (PGlite) com todas as migrações aplicadas,
 * simulando o Supabase (schema auth, papéis anon/authenticated e auth.uid()).
 * Uso em um arquivo de teste novo:
 *
 *   let db: PGlite;
 *   beforeAll(async () => { db = await criarBanco(); });
 *   const org = await comoUsuario(db, USER, async () => (await db.query(`select public.criar_organizacao('X') as id`)).rows[0]);
 *
 * Use ids de usuário próprios do arquivo (ex.: ...0000000a01) para não colidir.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";

export async function criarBanco(): Promise<PGlite> {
  const db = new PGlite();
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
  for (const f of readdirSync(dir).sort()) await db.exec(readFileSync(join(dir, f), "utf8"));
  await db.exec(`
    grant usage on schema public to authenticated;
    grant select, insert, update, delete on all tables in schema public to authenticated;
  `);
  return db;
}

/** Roda `fn` logado como `userId` (papel authenticated, auth.uid() = userId). */
export async function comoUsuario<T>(db: PGlite, userId: string, fn: () => Promise<T>): Promise<T> {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${userId}', false);`);
  try {
    return await fn();
  } finally {
    await db.exec(`reset role;`);
  }
}

/** Roda `fn` como visitante anônimo (rotas públicas por token). */
export async function comoAnonimo<T>(db: PGlite, fn: () => Promise<T>): Promise<T> {
  await db.exec(`set role anon; select set_config('request.jwt.claim.sub', '', false);`);
  try {
    return await fn();
  } finally {
    await db.exec(`reset role;`);
  }
}
