/**
 * Gestão de equipe no banco (PGlite): permissões por perfil (espelho do app),
 * convites e usuários (papel/perfil só pelo administrador, sempre um admin),
 * travas de permissão nas tabelas, fila de distribuição por equipe/filial na
 * entrada de leads, redistribuição em massa com histórico, produtividade
 * agregada, aprovações garantidas no banco, mural e mensagens privadas,
 * onboarding, trilha de auditoria, isolamento entre organizações, modo pessoal
 * e "juntar repetidos".
 */
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { MODULOS, normalizarPermissoes, permissoesPadrao } from "@/lib/dominio/equipe";
import { comoAnonimo, comoUsuario, criarBanco } from "./pglite";

const ADMIN = "00000000-0000-0000-0000-000000019a01";
const GESTOR = "00000000-0000-0000-0000-000000019a02";
const CORRETOR = "00000000-0000-0000-0000-000000019a03";
const FINANCEIRO = "00000000-0000-0000-0000-000000019a04";
const NOVO = "00000000-0000-0000-0000-000000019a05";
const INTRUSO = "00000000-0000-0000-0000-000000019a06";
const SEMCONF = "00000000-0000-0000-0000-000000019a07";
const OUTRO = "00000000-0000-0000-0000-000000019b01";
const PESSOAL = "00000000-0000-0000-0000-000000019c01";

let db: PGlite;
let org: string;
let orgB: string;
let orgP: string;

async function erroDe(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "";
  } catch (e) {
    return String(e);
  }
}

const um = async <T>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows[0];
const todos = async <T>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows;

/** Logado com e-mail na sessão (claim do JWT). */
async function comEmail<T>(user: string, email: string, fn: () => Promise<T>): Promise<T> {
  return comoUsuario(db, user, async () => {
    await db.query(`select set_config('request.jwt.claim.email', $1, false)`, [email]);
    try {
      return await fn();
    } finally {
      await db.query(`select set_config('request.jwt.claim.email', '', false)`);
    }
  });
}

beforeAll(async () => {
  db = await criarBanco();
  // auth.users do Supabase (só o que o banco consulta): quem confirmou o e-mail.
  await db.exec(`create table if not exists auth.users (id uuid primary key, email text, email_confirmed_at timestamptz)`);
  await db.query(`insert into auth.users (id, email, email_confirmed_at) values ($1, 'nova@x.com', now()), ($2, 'dupla@x.com', now()), ($3, 'cancelado@x.com', now()), ($4, 'nova2@x.com', null)`, [
    NOVO,
    OUTRO,
    INTRUSO,
    SEMCONF,
  ]);
  org = await comoUsuario(db, ADMIN, async () => (await um<{ id: string }>(`select public.criar_organizacao('Imob Equipe') as id`)).id);
  await db.query(`insert into membros (organizacao_id, user_id, papel) values ($1, $2, 'gestor'), ($1, $3, 'corretor'), ($1, $4, 'financeiro')`, [
    org,
    GESTOR,
    CORRETOR,
    FINANCEIRO,
  ]);
  orgB = await comoUsuario(db, OUTRO, async () => (await um<{ id: string }>(`select public.criar_organizacao('Outra Imob') as id`)).id);
  orgP = await comoUsuario(db, PESSOAL, async () => (await um<{ id: string }>(`select public.criar_organizacao('Meus Imóveis') as id`)).id);
  await comoUsuario(db, PESSOAL, () => db.query(`update organizacoes set modo = 'pessoal' where id = $1`, [orgP]));
});

describe("perfis de acesso e permissões", () => {
  it("módulos e padrões do banco são os mesmos do app", async () => {
    const mods = (await um<{ m: Record<string, string[]> }>(`select privado.modulos_equipe() as m`)).m;
    expect(Object.keys(mods).sort()).toEqual(MODULOS.map((m) => m.id).sort());
    for (const m of MODULOS) expect(mods[m.id]).toEqual([...m.operacoes]);
    for (const papel of ["admin", "gestor", "financeiro", "corretor"]) {
      const banco = (await um<{ p: unknown }>(`select privado.permissoes_padrao($1) as p`, [papel])).p;
      expect(normalizarPermissoes(banco)).toEqual(permissoesPadrao(papel));
    }
    const norm = (await um<{ p: unknown }>(`select privado.normalizar_permissoes($1::jsonb) as p`, [JSON.stringify({ imoveis: ["editar", "xx"], foo: ["ver"], painel: "ver" })])).p;
    expect(norm).toEqual(normalizarPermissoes({ imoveis: ["editar", "xx"], foo: ["ver"], painel: "ver" }));
    expect((norm as Record<string, string[]>).imoveis).toEqual(["ver", "editar"]);
  });

  it("toda organização nasce com os perfis padrão (gestor, financeiro, corretor)", async () => {
    const perfis = await comoUsuario(db, ADMIN, () => todos<{ papel_base: string; padrao: boolean }>(`select papel_base, padrao from perfis_acesso order by papel_base`));
    expect(perfis).toEqual([
      { papel_base: "corretor", padrao: true },
      { papel_base: "financeiro", padrao: true },
      { papel_base: "gestor", padrao: true },
    ]);
  });

  it("admin sempre pode; o perfil padrão do papel vale para quem não tem perfil; perfil próprio troca as permissões", async () => {
    const pode = (u: string, m: string, o: string) => comoUsuario(db, u, async () => (await um<{ ok: boolean }>(`select privado.tem_permissao($1, $2, $3) as ok`, [org, m, o])).ok);
    expect(await pode(ADMIN, "auditoria", "ver")).toBe(true);
    expect(await pode(CORRETOR, "auditoria", "ver")).toBe(false);
    expect(await pode(CORRETOR, "comercial", "excluir")).toBe(true);
    expect(await pode(CORRETOR, "financeiro", "criar")).toBe(false);
    expect(await pode(FINANCEIRO, "financeiro", "aprovar")).toBe(true);

    // Admin muda o perfil padrão do Corretor: vale para todos os corretores.
    await comoUsuario(db, ADMIN, () =>
      db.query(`update perfis_acesso set permissoes = permissoes || '{"financeiro":["criar"]}'::jsonb where padrao and papel_base = 'corretor'`),
    );
    expect(await pode(CORRETOR, "financeiro", "criar")).toBe(true);
    expect(await pode(CORRETOR, "financeiro", "ver")).toBe(true);
    // Perfil próprio, sem comercial.
    const perfil = await comoUsuario(db, ADMIN, async () => {
      const id = (await um<{ id: string }>(`insert into perfis_acesso (nome, papel_base, permissoes) values ('Só leitura', 'corretor', '{"painel":["ver"],"imoveis":["ver"]}') returning id`)).id;
      await db.query(`select public.equipe_salvar_membro($1, $2)`, [CORRETOR, { perfil_id: id }]);
      return id;
    });
    expect(await pode(CORRETOR, "comercial", "ver")).toBe(false);
    expect(await pode(CORRETOR, "imoveis", "ver")).toBe(true);
    const minhas = await comoUsuario(db, CORRETOR, async () => (await um<{ p: Record<string, string[]> }>(`select public.minhas_permissoes() as p`)).p);
    expect(minhas.imoveis).toEqual(["ver"]);
    expect(minhas.comercial).toEqual([]);
    // Volta ao padrão.
    await comoUsuario(db, ADMIN, () => db.query(`select public.equipe_salvar_membro($1, '{"perfil_id": ""}')`, [CORRETOR]));
    expect(await pode(CORRETOR, "comercial", "ver")).toBe(true);
    expect(perfil).toBeTruthy();
  });

  it("só o administrador mexe nos perfis; perfil padrão não se apaga", async () => {
    const r = await comoUsuario(db, GESTOR, async () => ({
      criar: await erroDe(() => db.query(`insert into perfis_acesso (nome, papel_base) values ('X', 'corretor')`)),
      mudar: await erroDe(() => db.query(`update perfis_acesso set permissoes = '{}' where padrao and papel_base = 'gestor'`)),
    }));
    expect(r.criar).toContain("Só o administrador");
    expect(r.mudar).toContain("Só o administrador");
    const apagar = await comoUsuario(db, ADMIN, () => erroDe(() => db.query(`delete from perfis_acesso where padrao and papel_base = 'gestor'`)));
    expect(apagar).toContain("não se apaga");
    // Não dá para criar um "padrão" à mão.
    const padrao = await comoUsuario(db, ADMIN, async () => (await um<{ padrao: boolean }>(`insert into perfis_acesso (nome, papel_base, padrao) values ('Falso', 'gestor', true) returning padrao`)).padrao);
    expect(padrao).toBe(false);
  });
});

describe("usuários e convites", () => {
  it("papel e perfil só pelo administrador; sempre fica um administrador", async () => {
    const r = await comoUsuario(db, GESTOR, async () => ({
      papel: await erroDe(() => db.query(`select public.equipe_salvar_membro($1, '{"papel":"admin"}')`, [CORRETOR])),
      cargo: await erroDe(() => db.query(`select public.equipe_salvar_membro($1, '{"cargo":"Corretor sênior"}')`, [CORRETOR])),
      admin: await erroDe(() => db.query(`select public.equipe_salvar_membro($1, '{"cargo":"x"}')`, [ADMIN])),
      remover: await erroDe(() => db.query(`select public.equipe_remover_membro($1)`, [CORRETOR])),
      direto: (await db.query(`update membros set papel = 'admin' where user_id = $1`, [CORRETOR])).affectedRows,
    }));
    expect(r.papel).toContain("Só o administrador muda o papel");
    expect(r.cargo).toBe("");
    expect(r.admin).toContain("Só o administrador muda outro administrador");
    expect(r.remover).toContain("Só o administrador");
    expect(r.direto).toBe(0);
    const ultimo = await comoUsuario(db, ADMIN, async () => ({
      rebaixar: await erroDe(() => db.query(`select public.equipe_salvar_membro($1, '{"papel":"gestor"}')`, [ADMIN])),
      sair: await erroDe(() => db.query(`select public.equipe_remover_membro($1)`, [ADMIN])),
    }));
    expect(ultimo.rebaixar).toContain("pelo menos um administrador");
    expect(ultimo.sair).toContain("pelo menos um administrador");
    const cargo = await um<{ cargo: string }>(`select cargo from membros where user_id = $1`, [CORRETOR]);
    expect(cargo.cargo).toBe("Corretor sênior");
  });

  it("convite: gestor só convida corretor/financeiro; aceite exige o mesmo e-mail, cria a ficha e o membro", async () => {
    const r = await comoUsuario(db, GESTOR, async () => ({
      gestor: await erroDe(() => db.query(`insert into equipe_convites (email, papel) values ('chefe@x.com', 'gestor')`)),
      ok: await um<{ token: string; email: string }>(`insert into equipe_convites (email, nome, papel, token) values (' Nova@X.com ', 'Nina Nova', 'corretor', '00000000-0000-0000-0000-000000000001') returning token, email`),
      invalido: await erroDe(() => db.query(`insert into equipe_convites (email) values ('sem-arroba')`)),
    }));
    expect(r.gestor).toContain("Só o administrador convida");
    expect(r.invalido).toContain("E-mail inválido");
    expect(r.ok.email).toBe("nova@x.com");
    expect(r.ok.token).not.toBe("00000000-0000-0000-0000-000000000001");
    // Corretor não vê os convites (o token dá acesso).
    const vistos = await comoUsuario(db, CORRETOR, async () => (await um<{ n: number }>(`select count(*)::int as n from equipe_convites`)).n);
    expect(vistos).toBe(0);

    const token = r.ok.token;
    const anon = await comoAnonimo(db, () => erroDe(() => db.query(`select public.aceitar_convite($1)`, [token])));
    expect(anon).toMatch(/permission denied|Entre na sua conta/);
    const outroEmail = await comEmail(NOVO, "outra@x.com", () => erroDe(() => db.query(`select public.aceitar_convite($1)`, [token])));
    expect(outroEmail).toContain("no*");
    // Tela de boas-vindas: só o aviso, nunca o token (para entrar é preciso o link).
    const meus = await comEmail(NOVO, "nova@x.com", async () => (await um<{ c: Record<string, string>[] }>(`select public.meus_convites() as c`)).c);
    expect(meus).toEqual([{ organizacao: "Imob Equipe", papel: "corretor" }]);
    const info = await comEmail(NOVO, "nova@x.com", async () => (await um<{ i: Record<string, unknown> }>(`select public.info_convite($1) as i`, [token])).i);
    expect(info).toMatchObject({ organizacao: "Imob Equipe", situacao: "valido", meu_email: true, email_confirmado: true });
    const aceito = await comEmail(NOVO, "nova@x.com", async () => (await um<{ o: string }>(`select public.aceitar_convite($1) as o`, [token])).o);
    expect(aceito).toBe(org);
    const membro = await um<{ papel: string; pessoa_id: string; email: string; nome: string }>(`select papel, pessoa_id, email, nome from membros where user_id = $1`, [NOVO]);
    expect(membro).toMatchObject({ papel: "corretor", email: "nova@x.com", nome: "Nina Nova" });
    const pessoa = await um<{ papeis: string[]; colaborador: boolean }>(`select papeis, colaborador from pessoas where id = $1`, [membro.pessoa_id]);
    expect(pessoa).toEqual({ papeis: ["corretor"], colaborador: true });
    const usado = await comEmail(NOVO, "nova@x.com", () => erroDe(() => db.query(`select public.aceitar_convite($1)`, [token])));
    expect(usado).toContain("já foi usado");
    // Pela API o convite só pode ser cancelado.
    const mexer = await comoUsuario(db, ADMIN, () => erroDe(() => db.query(`update equipe_convites set papel = 'admin' where token = $1`, [token])));
    expect(mexer).toContain("não pode ser alterado");
  });

  it("conta com o e-mail do convite mas sem confirmar o e-mail não vê nem aceita o convite", async () => {
    const token = await comoUsuario(db, ADMIN, async () => (await um<{ token: string }>(`insert into equipe_convites (email, papel) values ('nova2@x.com', 'gestor') returning token`)).token);
    const r = await comEmail(SEMCONF, "nova2@x.com", async () => ({
      meus: (await um<{ c: unknown[] }>(`select public.meus_convites() as c`)).c,
      info: (await um<{ i: Record<string, unknown> }>(`select public.info_convite($1) as i`, [token])).i,
      aceitar: await erroDe(() => db.query(`select public.aceitar_convite($1)`, [token])),
    }));
    expect(r.meus).toEqual([]);
    expect(r.info).toMatchObject({ situacao: "valido", meu_email: true, email_confirmado: false });
    expect(r.aceitar).toContain("Confirme o seu e-mail");
    const entrou = await um<{ n: number }>(`select count(*)::int as n from membros where user_id = $1`, [SEMCONF]);
    expect(entrou.n).toBe(0);
    await comoUsuario(db, ADMIN, () => db.query(`update equipe_convites set revogado_em = now() where token = $1`, [token]));
  });

  it("token errado, cancelado ou vencido não serve", async () => {
    const token = await comoUsuario(db, ADMIN, async () => {
      const t = (await um<{ token: string }>(`insert into equipe_convites (email, papel) values ('cancelado@x.com', 'corretor') returning token`)).token;
      await db.query(`update equipe_convites set revogado_em = now() where token = $1`, [t]);
      return t;
    });
    // Convite vencido (data mexida direto no banco, como o tempo passando).
    const vencido = await comoUsuario(db, ADMIN, async () => (await um<{ token: string }>(`insert into equipe_convites (email, papel) values ('vencido@x.com', 'corretor') returning token`)).token);
    await db.query(`update equipe_convites set expira_em = now() - interval '1 day' where token = $1`, [vencido]);
    const r = await comEmail(INTRUSO, "cancelado@x.com", async () => ({
      errado: (await um<{ i: { situacao: string } }>(`select public.info_convite('00000000-0000-0000-0000-00000000dead') as i`)).i.situacao,
      cancelado: (await um<{ i: { situacao: string } }>(`select public.info_convite($1) as i`, [token])).i.situacao,
      aceitarErrado: await erroDe(() => db.query(`select public.aceitar_convite('00000000-0000-0000-0000-00000000dead')`)),
      aceitarCancelado: await erroDe(() => db.query(`select public.aceitar_convite($1)`, [token])),
    }));
    expect(r).toMatchObject({ errado: "invalido", cancelado: "cancelado" });
    expect(r.aceitarErrado).toContain("inválido");
    expect(r.aceitarCancelado).toContain("cancelado");
    const venceu = await comEmail(INTRUSO, "vencido@x.com", () => erroDe(() => db.query(`select public.aceitar_convite($1)`, [vencido])));
    expect(venceu).toContain("venceu");
    const anonInfo = await comoAnonimo(db, () => erroDe(() => db.query(`select public.info_convite($1)`, [token])));
    expect(anonInfo).toContain("permission denied");
  });

  it("convidar de novo cancela o link anterior; quem já tem outra imobiliária não entra", async () => {
    const [t1, t2] = await comoUsuario(db, ADMIN, async () => {
      const a = (await um<{ token: string }>(`insert into equipe_convites (email, papel) values ('dupla@x.com', 'financeiro') returning token`)).token;
      const b = (await um<{ token: string }>(`insert into equipe_convites (email, papel) values ('dupla@x.com', 'financeiro') returning token`)).token;
      return [a, b];
    });
    const velho = await comEmail(OUTRO, "dupla@x.com", () => erroDe(() => db.query(`select public.aceitar_convite($1)`, [t1])));
    expect(velho).toContain("cancelado");
    const outraImob = await comEmail(OUTRO, "dupla@x.com", () => erroDe(() => db.query(`select public.aceitar_convite($1)`, [t2])));
    expect(outraImob).toContain("outra imobiliária");
  });

  it("modo pessoal não tem convites nem gestão de equipe", async () => {
    const r = await comoUsuario(db, PESSOAL, async () => ({
      convite: await erroDe(() => db.query(`insert into equipe_convites (email) values ('x@y.com')`)),
      filial: await erroDe(() => db.query(`insert into filiais (nome) values ('Centro')`)),
      tarefa: await erroDe(() => db.query(`insert into equipe_tarefas (titulo) values ('x')`)),
      salvar: await erroDe(() => db.query(`select public.equipe_salvar_membro($1, '{"cargo":"x"}')`, [PESSOAL])),
    }));
    expect(r.convite).toContain("modo imobiliária");
    expect(r.filial).toContain("modo imobiliária");
    expect(r.tarefa).toContain("modo imobiliária");
    expect(r.salvar).toContain("modo imobiliária");
  });
});

describe("travas de permissão nas tabelas", () => {
  it("corretor não cria filial, meta nem regra de aprovação; gestor cria", async () => {
    const r = await comoUsuario(db, CORRETOR, async () => ({
      filial: await erroDe(() => db.query(`insert into filiais (nome) values ('Centro')`)),
      meta: await erroDe(() => db.query(`insert into equipe_metas (competencia, tipo, alvo, filial_id, valor) values ('2026-11-01', 'leads', 'filial', gen_random_uuid(), 10)`)),
      regra: await erroDe(() => db.query(`insert into aprovacao_regras (tipo, aprovador_papel) values ('despesa', 'gestor')`)),
      aviso: await erroDe(() => db.query(`insert into equipe_avisos (titulo, texto) values ('Oi', 'Teste')`)),
    }));
    expect(r.filial).toContain("não permite editar em Equipe");
    expect(r.meta).toContain("não permite editar em Equipe");
    expect(r.regra).toContain("não permite editar em Aprovações");
    expect(r.aviso).toContain("não permite criar em Equipe");
    const filial = await comoUsuario(db, GESTOR, async () => (await um<{ id: string }>(`insert into filiais (nome, cidade) values ('Centro', 'Santos') returning id`)).id);
    expect(filial).toBeTruthy();
  });

  it("outra organização não vê nada da equipe", async () => {
    await comoUsuario(db, ADMIN, () => db.query(`insert into equipe_tarefas (titulo) values ('Organizar arquivo')`));
    const r = await comoUsuario(db, OUTRO, async () =>
      um<{ f: number; t: number; p: number; a: number; c: number }>(
        `select (select count(*) from filiais)::int as f, (select count(*) from equipe_tarefas)::int as t,
                (select count(*) from perfis_acesso where organizacao_id = $1)::int as p,
                (select count(*) from auditoria where organizacao_id = $1)::int as a,
                (select count(*) from equipe_convites)::int as c`,
        [org],
      ),
    );
    expect(r).toEqual({ f: 0, t: 0, p: 0, a: 0, c: 0 });
    const ins = await comoUsuario(db, OUTRO, () => erroDe(() => db.query(`insert into equipe_tarefas (organizacao_id, titulo) values ($1, 'invasão')`, [org])));
    expect(ins).toContain("row-level security");
  });
});

describe("distribuição", () => {
  let eqA: string;
  let filial: string;
  let ana: string;
  let bia: string;
  let caio: string;
  let duda: string;

  beforeAll(async () => {
    await comoUsuario(db, ADMIN, async () => {
      await db.query(`update organizacoes set distribuicao_leads = 'rodizio' where id = $1`, [org]);
      filial = (await um<{ id: string }>(`insert into filiais (nome) values ('Zona Norte') returning id`)).id;
      eqA = (await um<{ id: string }>(`insert into equipes (nome, filial_id) values ('Locação Norte', $1) returning id`, [filial])).id;
      ana = (await um<{ id: string }>(`insert into pessoas (nome, papeis) values ('Ana Corretora', '{corretor}') returning id`)).id;
      bia = (await um<{ id: string }>(`insert into pessoas (nome, papeis) values ('Bia Corretora', '{corretor}') returning id`)).id;
      caio = (await um<{ id: string }>(`insert into pessoas (nome, papeis) values ('Caio Corretor', '{corretor}') returning id`)).id;
      duda = (await um<{ id: string }>(`insert into pessoas (nome, papeis, recebe_leads) values ('Duda Corretora', '{corretor}', false) returning id`)).id;
      await db.query(`insert into equipe_membros (equipe_id, pessoa_id) values ($1, $2), ($1, $3)`, [eqA, bia, caio]);
    });
  });

  it("regra por equipe: leads de venda pela internet só vão para a equipe; sem regra, fila geral", async () => {
    const token = (await um<{ t: string }>(`select leads_token as t from organizacoes where id = $1`, [org])).t;
    await comoUsuario(db, GESTOR, () => db.query(`insert into equipe_distribuicao_regras (funil, equipe_id) values ('venda', $1)`, [eqA]));
    const ids = await comoAnonimo(db, async () => {
      const out: string[] = [];
      for (let i = 0; i < 3; i++) {
        const r = await um<{ r: { id: string } }>(`select public.receber_lead($1, $2) as r`, [token, { nome: `Comprador ${i}`, telefone: `1399990000${i}`, funil: "venda" }]);
        out.push(r.r.id);
      }
      const loc = await um<{ r: { id: string } }>(`select public.receber_lead($1, $2) as r`, [token, { nome: "Inquilino", telefone: "13999990099", funil: "locacao" }]);
      out.push(loc.r.id);
      return out;
    });
    const corretores = await todos<{ corretor_id: string }>(`select corretor_id from leads where id = any($1::uuid[]) order by created_at`, [ids]);
    const venda = corretores.slice(0, 3).map((c) => c.corretor_id);
    expect(venda.every((c) => c === bia || c === caio)).toBe(true);
    expect(new Set(venda.slice(0, 2)).size).toBe(2);
    expect([ana, bia, caio]).toContain(corretores[3].corretor_id);
    expect(corretores.map((c) => c.corretor_id)).not.toContain(duda);
    // Tela (lead criado à mão) usa a mesma fila.
    const prox = await comoUsuario(db, GESTOR, async () => (await um<{ id: string }>(`select public.proximo_corretor_fila('venda', 'site') as id`)).id);
    expect([bia, caio]).toContain(prox);
  });

  it("regra de grupo sem ninguém para receber cai na fila geral", async () => {
    const token = (await um<{ t: string }>(`select leads_token as t from organizacoes where id = $1`, [org])).t;
    await comoUsuario(db, GESTOR, async () => {
      const vazia = (await um<{ id: string }>(`insert into filiais (nome) values ('Filial vazia') returning id`)).id;
      await db.query(`insert into equipe_distribuicao_regras (funil, origem, filial_id) values ('locacao', 'zap', $1)`, [vazia]);
    });
    const id = await comoAnonimo(db, async () => (await um<{ r: { id: string } }>(`select public.receber_lead($1, $2) as r`, [token, { nome: "Do ZAP", telefone: "13999990555", funil: "locacao", origem: "zap" }])).r.id);
    const lead = await um<{ corretor_id: string | null; fila: boolean }>(
      `select l.corretor_id, (p.recebe_leads and 'corretor' = any (p.papeis)) as fila from leads l join pessoas p on p.id = l.corretor_id where l.id = $1`,
      [id],
    );
    expect(lead.fila).toBe(true);
    expect(lead.corretor_id).not.toBe(duda);
  });

  it("redistribui em massa com motivo e histórico; corretor não pode", async () => {
    const leads = await comoUsuario(db, ADMIN, async () => {
      const out: string[] = [];
      for (let i = 0; i < 5; i++) out.push((await um<{ id: string }>(`insert into leads (nome, corretor_id) values ($1, $2) returning id`, [`Cliente ${i}`, ana])).id);
      await db.query(`insert into leads (nome, corretor_id, status) values ('Fechado', $1, 'ganho')`, [ana]);
      return out;
    });
    const negado = await comoUsuario(db, CORRETOR, () => erroDe(() => db.query(`select public.equipe_redistribuir($1)`, [{ tipo: "leads", de: ana, para: bia, motivo: "férias" }])));
    expect(negado).toContain("não permite redistribuir");
    const semMotivo = await comoUsuario(db, GESTOR, () => erroDe(() => db.query(`select public.equipe_redistribuir($1)`, [{ tipo: "leads", de: ana, para: bia, motivo: "" }])));
    expect(semMotivo).toContain("motivo");

    const r = await comoUsuario(db, GESTOR, async () => (await um<{ r: { quantidade: number; destinos: Record<string, number> } }>(`select public.equipe_redistribuir($1) as r`, [{ tipo: "leads", de: ana, equipe_id: eqA, motivo: "Ana saiu de férias" }])).r);
    expect(r.quantidade).toBeGreaterThanOrEqual(5);
    expect(Object.keys(r.destinos).sort()).toEqual([bia, caio].sort());
    const restantes = await todos<{ status: string }>(`select status from leads where corretor_id = $1`, [ana]);
    expect(restantes.map((x) => x.status)).toEqual(["ganho"]);
    const ev = await um<{ n: number }>(`select count(*)::int as n from lead_eventos where lead_id = $1 and tipo = 'transferencia' and descricao like '%Ana saiu de férias%'`, [leads[0]]);
    expect(ev.n).toBe(1);
    const hist = await comoUsuario(db, CORRETOR, () => todos<{ de_nome: string; quantidade: number; motivo: string }>(`select de_nome, quantidade, motivo from equipe_distribuicoes`));
    expect(hist).toEqual([{ de_nome: "Ana Corretora", quantidade: r.quantidade, motivo: "Ana saiu de férias" }]);
    const apagar = await comoUsuario(db, GESTOR, async () => (await db.query(`delete from equipe_distribuicoes`)).affectedRows);
    expect(apagar).toBe(0);

    // Só os escolhidos, para uma pessoa.
    const escolhidos = await comoUsuario(db, GESTOR, async () => {
      const l = (await um<{ id: string }>(`insert into leads (nome, corretor_id) values ('Escolhido', $1) returning id`, [bia])).id;
      await db.query(`insert into leads (nome, corretor_id) values ('Fica', $1)`, [bia]);
      const res = (await um<{ r: { quantidade: number } }>(`select public.equipe_redistribuir($1) as r`, [{ tipo: "leads", de: bia, para: ana, ids: [l], motivo: "Pedido do cliente" }])).r;
      return { res, dono: (await um<{ c: string }>(`select corretor_id as c from leads where id = $1`, [l])).c };
    });
    expect(escolhidos.res.quantidade).toBe(1);
    expect(escolhidos.dono).toBe(ana);
  });
});

describe("produtividade", () => {
  it("agrega por colaborador no período (leads, resposta, visitas, propostas, vendas, tarefas)", async () => {
    const r = await comoUsuario(db, ADMIN, async () => {
      const zeca = (await um<{ id: string }>(`insert into pessoas (nome, papeis) values ('Zeca Produtivo', '{corretor}') returning id`)).id;
      await db.query(`select public.equipe_salvar_membro($1, $2)`, [FINANCEIRO, { pessoa_id: zeca }]);
      await db.query(
        `insert into leads (nome, corretor_id, created_at, atribuido_em, atendido_em) values
          ('L1', $1, '2026-10-05 12:00-03', '2026-10-05 12:00-03', '2026-10-05 12:30-03'),
          ('L2', $1, '2026-10-06 12:00-03', '2026-10-06 12:00-03', '2026-10-06 13:30-03'),
          ('L3', $1, '2026-09-06 12:00-03', '2026-09-06 12:00-03', null)`,
        [zeca],
      );
      await db.query(`insert into visitas (corretor_id, data_hora, status) values ($1, '2026-10-10 10:00-03', 'realizada'), ($1, '2026-10-11 10:00-03', 'cancelada')`, [zeca]);
      await db.query(`insert into propostas (corretor_id, valor, tipo, status, fechada_em, created_at) values ($1, 2000, 'locacao', 'aceita', '2026-10-20', '2026-10-15 10:00-03'), ($1, 3000, 'locacao', 'recusada', null, '2026-10-16 10:00-03')`, [zeca]);
      await db.query(`insert into tarefas (titulo, responsavel_id, concluida, concluida_em) values ('T1', $1, true, '2026-10-21 10:00-03')`, [FINANCEIRO]);
      await db.query(`insert into equipe_tarefas (titulo, responsavel_id, status) values ('T2', $1, 'concluida')`, [FINANCEIRO]);
      await db.query(`update equipe_tarefas set concluida_em = '2026-10-22 10:00-03' where titulo = 'T2'`);
      const linhas = await todos<Record<string, unknown>>(`select * from public.equipe_produtividade('2026-10-01', '2026-10-31') where pessoa_id = $1`, [zeca]);
      return linhas[0];
    });
    expect(r).toMatchObject({
      leads_recebidos: 2,
      leads_atendidos: 2,
      resposta_qtd: 2,
      visitas: 1,
      propostas: 2,
      propostas_aceitas: 1,
      locacoes: 1,
      vendas: 0,
      tarefas: 1,
    });
    expect(Number(r.resposta_soma_min)).toBe(120);
    expect(r.user_id).toBe(FINANCEIRO);
  });
});

describe("aprovações", () => {
  it("regra escolhe o aprovador; quem pediu não decide; recusa exige motivo; decidida não muda nem se apaga", async () => {
    await comoUsuario(db, ADMIN, () =>
      db.query(`insert into aprovacao_regras (tipo, valor_minimo, aprovador_papel) values ('despesa', 0, 'financeiro'), ('despesa', 5000, 'admin')`),
    );
    const r = await comoUsuario(db, CORRETOR, async () => ({
      pequena: await um<{ id: string; aprovador_papel: string; status: string }>(
        `insert into aprovacoes (tipo, titulo, valor, status, aprovador_papel) values ('despesa', 'Compra de placas', 300, 'aprovada', 'gestor') returning id, aprovador_papel, status`,
      ),
      grande: await um<{ id: string; aprovador_papel: string }>(`insert into aprovacoes (tipo, titulo, valor) values ('despesa', 'Reforma da sala', 8000) returning id, aprovador_papel`),
    }));
    expect(r.pequena).toMatchObject({ aprovador_papel: "financeiro", status: "pendente" });
    expect(r.grande.aprovador_papel).toBe("admin");

    const propria = await comoUsuario(db, CORRETOR, () => erroDe(() => db.query(`update aprovacoes set status = 'aprovada' where id = $1`, [r.pequena.id])));
    expect(propria).toContain("não pode decidir");
    const gestorGrande = await comoUsuario(db, GESTOR, () => erroDe(() => db.query(`update aprovacoes set status = 'aprovada' where id = $1`, [r.grande.id])));
    expect(gestorGrande).toContain("não pode decidir");
    const semMotivo = await comoUsuario(db, FINANCEIRO, () => erroDe(() => db.query(`update aprovacoes set status = 'recusada' where id = $1`, [r.pequena.id])));
    expect(semMotivo).toContain("motivo da recusa");
    const ok = await comoUsuario(db, FINANCEIRO, async () =>
      um<{ status: string; decidida_por: string; valor: string }>(`update aprovacoes set status = 'aprovada', valor = 1, comentario = 'ok' where id = $1 returning status, decidida_por, valor`, [r.pequena.id]),
    );
    expect(ok).toMatchObject({ status: "aprovada", decidida_por: FINANCEIRO });
    expect(Number(ok.valor)).toBe(300);
    const depois = await comoUsuario(db, ADMIN, async () => ({
      mudar: await erroDe(() => db.query(`update aprovacoes set status = 'recusada', comentario = 'x' where id = $1`, [r.pequena.id])),
      apagar: await erroDe(() => db.query(`delete from aprovacoes where id = $1`, [r.pequena.id])),
    }));
    expect(depois.mudar).toContain("já foi decidida");
    expect(depois.apagar).toContain("não se apaga");
    // Admin decide a grande; quem pediu pode cancelar a sua pendente.
    const outra = await comoUsuario(db, CORRETOR, async () => (await um<{ id: string }>(`insert into aprovacoes (tipo, titulo) values ('ferias', 'Folga sexta') returning id`)).id);
    const cancelar = await comoUsuario(db, GESTOR, () => erroDe(() => db.query(`update aprovacoes set status = 'cancelada' where id = $1`, [outra])));
    expect(cancelar).toContain("Só quem pediu");
    await comoUsuario(db, CORRETOR, () => db.query(`update aprovacoes set status = 'cancelada' where id = $1`, [outra]));
    await comoUsuario(db, ADMIN, () => db.query(`update aprovacoes set status = 'aprovada' where id = $1`, [r.grande.id]));
    const fim = await todos<{ status: string }>(`select status from aprovacoes where id in ($1, $2) order by numero`, [r.grande.id, outra]);
    expect(fim.map((x) => x.status)).toEqual(["aprovada", "cancelada"]);
  });
});

describe("comunicação", () => {
  it("aviso com confirmação de leitura; mensagens só para quem mandou e quem recebeu", async () => {
    const aviso = await comoUsuario(db, GESTOR, async () => (await um<{ id: string }>(`insert into equipe_avisos (titulo, texto, importante) values ('Reunião', 'Segunda às 9h', true) returning id`)).id);
    await comoUsuario(db, CORRETOR, () => db.query(`insert into equipe_aviso_leituras (aviso_id) values ($1)`, [aviso]));
    const forjar = await comoUsuario(db, CORRETOR, () => erroDe(() => db.query(`insert into equipe_aviso_leituras (aviso_id, user_id) values ($1, $2)`, [aviso, FINANCEIRO])));
    expect(forjar).toContain("row-level security");
    const lidos = await comoUsuario(db, GESTOR, async () => (await um<{ n: number }>(`select count(*)::int as n from equipe_aviso_leituras where aviso_id = $1`, [aviso])).n);
    expect(lidos).toBe(1);

    const msg = await comoUsuario(db, CORRETOR, async () => (await um<{ id: string }>(`insert into equipe_mensagens (para_id, texto) values ($1, 'Pode ver o lead?') returning id`, [GESTOR])).id);
    const fora = await comoUsuario(db, CORRETOR, () => erroDe(() => db.query(`insert into equipe_mensagens (para_id, texto) values ($1, 'oi')`, [OUTRO])));
    expect(fora).toContain("não faz parte");
    const vistas = {
      gestor: await comoUsuario(db, GESTOR, async () => (await um<{ n: number }>(`select count(*)::int as n from equipe_mensagens`)).n),
      admin: await comoUsuario(db, ADMIN, async () => (await um<{ n: number }>(`select count(*)::int as n from equipe_mensagens`)).n),
    };
    expect(vistas).toEqual({ gestor: 1, admin: 0 });
    const editar = await comoUsuario(db, GESTOR, () => erroDe(() => db.query(`update equipe_mensagens set texto = 'x' where id = $1`, [msg])));
    expect(editar).toContain("não muda");
    await comoUsuario(db, GESTOR, () => db.query(`update equipe_mensagens set lida_em = now() where id = $1`, [msg]));
    const lida = await um<{ lida_em: string | null }>(`select lida_em from equipe_mensagens where id = $1`, [msg]);
    expect(lida.lida_em).not.toBeNull();
  });
});

describe("onboarding", () => {
  it("inicia pelo modelo com prazos; o colaborador marca os itens dele; tudo feito → concluído", async () => {
    const pessoa = (await um<{ pessoa_id: string }>(`select pessoa_id from membros where user_id = $1`, [NOVO])).pessoa_id;
    const onb = await comoUsuario(db, GESTOR, async () => {
      const modelo = (await um<{ id: string }>(`insert into equipe_onboarding_modelos (nome) values ('Corretor novo') returning id`)).id;
      await db.query(
        `insert into equipe_onboarding_modelo_itens (modelo_id, ordem, titulo, responsavel, prazo_dias) values ($1, 1, 'Contrato', 'rh', 1), ($1, 2, 'Treinamento', 'gestor', 7)`,
        [modelo],
      );
      return (await um<{ id: string }>(`select public.iniciar_onboarding($1, $2, '2026-11-02', null) as id`, [pessoa, modelo])).id;
    });
    const itens = await todos<{ id: string; prazo: string }>(`select id, prazo::text from equipe_onboarding_itens where onboarding_id = $1 order by ordem`, [onb]);
    expect(itens.map((i) => i.prazo)).toEqual(["2026-11-03", "2026-11-09"]);
    const outro = await comoUsuario(db, CORRETOR, () => erroDe(() => db.query(`update equipe_onboarding_itens set concluido_em = now() where id = $1`, [itens[0].id])));
    expect(outro).toContain("não permite editar em Equipe");
    await comoUsuario(db, NOVO, () => db.query(`update equipe_onboarding_itens set concluido_em = now() where onboarding_id = $1`, [onb]));
    const st = await um<{ status: string; concluido_em: string | null }>(`select status, concluido_em from equipe_onboardings where id = $1`, [onb]);
    expect(st.status).toBe("concluido");
    const quem = await um<{ concluido_por: string }>(`select concluido_por from equipe_onboarding_itens where id = $1`, [itens[1].id]);
    expect(quem.concluido_por).toBe(NOVO);
    const renomear = await comoUsuario(db, NOVO, () => erroDe(() => db.query(`update equipe_onboarding_itens set titulo = 'x' where id = $1`, [itens[0].id])));
    expect(renomear).toContain("não permite editar em Equipe");
    await comoUsuario(db, GESTOR, () => db.query(`update equipe_onboarding_itens set concluido_em = null where id = $1`, [itens[1].id]));
    const reaberto = await um<{ status: string }>(`select status from equipe_onboardings where id = $1`, [onb]);
    expect(reaberto.status).toBe("em_andamento");
  });
});

describe("histórico de ações (auditoria)", () => {
  it("grava quem mudou o quê, sem token; só admin/gestor leem; ninguém altera; organização apagada não trava", async () => {
    const imovel = await comoUsuario(db, CORRETOR, async () => {
      const id = (await um<{ id: string }>(`insert into imoveis (codigo, logradouro) values ('AUD-1', 'Rua A') returning id`)).id;
      await db.query(`update imoveis set logradouro = 'Rua B' where id = $1`, [id]);
      return id;
    });
    const linhas = await comoUsuario(db, GESTOR, () =>
      todos<{ acao: string; usuario_id: string; campos: string[]; antes: Record<string, unknown> | null; depois: Record<string, unknown> | null }>(
        `select acao, usuario_id, campos, antes, depois from auditoria where tabela = 'imoveis' and registro_id = $1 order by data, acao`,
        [imovel],
      ),
    );
    expect(linhas.map((l) => l.acao).sort()).toEqual(["insert", "update"]);
    const upd = linhas.find((l) => l.acao === "update")!;
    expect(upd.usuario_id).toBe(CORRETOR);
    expect(upd.campos).toContain("logradouro");
    expect(upd.antes?.logradouro).toBe("Rua A");
    expect(upd.depois?.logradouro).toBe("Rua B");
    const corretor = await comoUsuario(db, CORRETOR, async () => (await um<{ n: number }>(`select count(*)::int as n from auditoria`)).n);
    expect(corretor).toBe(0);
    const mexer = await comoUsuario(db, ADMIN, async () => ({
      upd: (await db.query(`update auditoria set acao = 'delete'`)).affectedRows,
      del: (await db.query(`delete from auditoria`)).affectedRows,
      ins: await erroDe(() => db.query(`insert into auditoria (organizacao_id, tabela, acao) values ($1, 'x', 'insert')`, [org])),
    }));
    expect(mexer.upd).toBe(0);
    expect(mexer.del).toBe(0);
    expect(mexer.ins).toContain("row-level security");
    // Token não vai para o histórico.
    const tokens = await um<{ n: number }>(`select count(*)::int as n from auditoria where tabela = 'equipe_convites' and (depois ? 'token' or antes ? 'token')`);
    expect(tokens.n).toBe(0);
    // Apagar uma organização inteira continua funcionando.
    const o = await comoUsuario(db, INTRUSO, async () => (await um<{ id: string }>(`select public.criar_organizacao('Some') as id`)).id);
    await comoUsuario(db, INTRUSO, () => db.query(`insert into pessoas (nome) values ('Alguém')`));
    await db.query(`delete from organizacoes where id = $1`, [o]);
    const sobrou = await um<{ n: number }>(`select count(*)::int as n from organizacoes where id = $1`, [o]);
    expect(sobrou.n).toBe(0);
  });
});

describe("juntar repetidos", () => {
  it("public.juntar_pessoas leva ficha do usuário, CRECI, documentos, metas e carteira para quem fica", async () => {
    const r = await comoUsuario(db, ADMIN, async () => {
      const fica = (await um<{ id: string }>(`insert into pessoas (nome, papeis) values ('Rui Repetido', '{corretor}') returning id`)).id;
      const sai = (await um<{ id: string }>(`insert into pessoas (nome, papeis, creci_numero, creci_uf, creci_validade, colaborador) values ('Rui R.', '{corretor}', '12345', 'SP', '2027-01-31', true) returning id`)).id;
      const cliente = (await um<{ id: string }>(`insert into pessoas (nome, corretor_id) values ('Cliente do Rui', $1) returning id`, [sai])).id;
      await db.query(`insert into equipe_documentos (pessoa_id, tipo, validade) values ($1, 'Carteira do CRECI', '2027-01-31')`, [sai]);
      await db.query(`insert into equipe_metas (competencia, tipo, alvo, pessoa_id, valor) values ('2026-11-01', 'visitas', 'pessoa', $1, 10)`, [sai]);
      await db.query(`select public.equipe_salvar_membro($1, $2)`, [GESTOR, { pessoa_id: sai }]);
      await db.query(`select public.juntar_pessoas($1, $2)`, [fica, sai]);
      return {
        fica,
        p: await um<{ creci_numero: string; creci_uf: string; colaborador: boolean }>(`select creci_numero, creci_uf, colaborador from pessoas where id = $1`, [fica]),
        cliente: (await um<{ c: string }>(`select corretor_id as c from pessoas where id = $1`, [cliente])).c,
        docs: (await um<{ n: number }>(`select count(*)::int as n from equipe_documentos where pessoa_id = $1`, [fica])).n,
        metas: (await um<{ n: number }>(`select count(*)::int as n from equipe_metas where pessoa_id = $1`, [fica])).n,
        membro: (await um<{ p: string }>(`select pessoa_id as p from membros where user_id = $1`, [GESTOR])).p,
      };
    });
    expect(r.p).toEqual({ creci_numero: "12345", creci_uf: "SP", colaborador: true });
    expect(r.cliente).toBe(r.fica);
    expect(r.docs).toBe(1);
    expect(r.metas).toBe(1);
    expect(r.membro).toBe(r.fica);
  });
});

describe("exclusões que o banco faz sozinho (FK) não travam", () => {
  it("regra e perfil já usados em solicitação decidida se excluem; perfil aprovador de regra avisa em português", async () => {
    const r = await comoUsuario(db, ADMIN, async () => {
      const perfil = (await um<{ id: string }>(`insert into perfis_acesso (nome, papel_base, permissoes) values ('Aprovador de compras', 'gestor', '{"aprovacoes":["ver","aprovar"]}') returning id`)).id;
      const regra = (await um<{ id: string }>(`insert into aprovacao_regras (tipo, valor_minimo, aprovador_perfil_id) values ('reembolso', 0, $1) returning id`, [perfil])).id;
      return { perfil, regra };
    });
    const sol = await comoUsuario(db, CORRETOR, async () =>
      um<{ id: string; regra_id: string; aprovador_perfil_id: string }>(`insert into aprovacoes (tipo, titulo, valor) values ('reembolso', 'Uber da vistoria', 45) returning id, regra_id, aprovador_perfil_id`),
    );
    expect(sol).toMatchObject({ regra_id: r.regra, aprovador_perfil_id: r.perfil });
    await comoUsuario(db, ADMIN, () => db.query(`update aprovacoes set status = 'aprovada', comentario = 'ok' where id = $1`, [sol.id]));

    // Perfil que é o aprovador de uma regra: mensagem clara, nada é apagado.
    const perfilComRegra = await comoUsuario(db, ADMIN, () => erroDe(() => db.query(`delete from perfis_acesso where id = $1`, [r.perfil])));
    expect(perfilComRegra).toContain("aprovador de 1 regra");
    // Excluir a regra já usada numa solicitação decidida funciona (antes travava).
    const apagarRegra = await comoUsuario(db, ADMIN, () => erroDe(() => db.query(`delete from aprovacao_regras where id = $1`, [r.regra])));
    expect(apagarRegra).toBe("");
    // Agora o perfil (citado na solicitação decidida) também se exclui.
    const apagarPerfil = await comoUsuario(db, ADMIN, () => erroDe(() => db.query(`delete from perfis_acesso where id = $1`, [r.perfil])));
    expect(apagarPerfil).toBe("");
    const depois = await um<{ status: string; regra_id: string | null; aprovador_perfil_id: string | null; titulo: string; decidida_por: string }>(
      `select status, regra_id, aprovador_perfil_id, titulo, decidida_por from aprovacoes where id = $1`,
      [sol.id],
    );
    expect(depois).toEqual({ status: "aprovada", regra_id: null, aprovador_perfil_id: null, titulo: "Uber da vistoria", decidida_por: ADMIN });
    // Pela API, a solicitação decidida continua sem mudar.
    const mexer = await comoUsuario(db, ADMIN, () => erroDe(() => db.query(`update aprovacoes set regra_id = null, titulo = 'x' where id = $1`, [sol.id])));
    expect(mexer).toContain("já foi decidida");
  });

  it("filial e equipe com aviso no mural se excluem (o aviso fica sem público)", async () => {
    const r = await comoUsuario(db, GESTOR, async () => {
      const filial = (await um<{ id: string }>(`insert into filiais (nome) values ('Filial que fecha') returning id`)).id;
      const equipe = (await um<{ id: string }>(`insert into equipes (nome, filial_id) values ('Equipe que acaba', $1) returning id`, [filial])).id;
      const avF = (await um<{ id: string }>(`insert into equipe_avisos (titulo, texto, para, filial_id) values ('Só filial', 'x', 'filial', $1) returning id`, [filial])).id;
      const avE = (await um<{ id: string }>(`insert into equipe_avisos (titulo, texto, para, equipe_id) values ('Só equipe', 'x', 'equipe', $1) returning id`, [equipe])).id;
      return {
        filial,
        equipe,
        avF,
        avE,
        apagarEquipe: await erroDe(() => db.query(`delete from equipes where id = $1`, [equipe])),
        apagarFilial: await erroDe(() => db.query(`delete from filiais where id = $1`, [filial])),
        semAlvo: await erroDe(() => db.query(`insert into equipe_avisos (titulo, texto, para) values ('Sem filial', 'x', 'filial')`)),
        deFora: await erroDe(() => db.query(`insert into equipe_avisos (titulo, texto, para, filial_id) values ('De fora', 'x', 'filial', gen_random_uuid())`)),
      };
    });
    expect(r.apagarEquipe).toBe("");
    expect(r.apagarFilial).toBe("");
    expect(r.semAlvo).toContain("Escolha a filial");
    expect(r.deFora).toMatch(/Escolha a filial|foreign key/);
    const avisos = await todos<{ para: string; equipe_id: string | null; filial_id: string | null }>(`select para, equipe_id, filial_id from equipe_avisos where id in ($1, $2) order by titulo`, [r.avE, r.avF]);
    expect(avisos).toEqual([
      { para: "equipe", equipe_id: null, filial_id: null },
      { para: "filial", equipe_id: null, filial_id: null },
    ]);
  });

  it("apagar a organização inteira funciona com regras por perfil, aprovações decididas e avisos", async () => {
    const SOME = "00000000-0000-0000-0000-000000019d01";
    const o = await comoUsuario(db, SOME, async () => {
      const id = (await um<{ id: string }>(`select public.criar_organizacao('Fecha tudo') as id`)).id;
      const perfil = (await um<{ id: string }>(`insert into perfis_acesso (nome, papel_base) values ('P', 'gestor') returning id`)).id;
      await db.query(`insert into aprovacao_regras (tipo, aprovador_perfil_id) values ('qualquer', $1)`, [perfil]);
      const a = (await um<{ id: string }>(`insert into aprovacoes (tipo, titulo) values ('outro', 'Algo') returning id`)).id;
      await db.query(`update aprovacoes set status = 'aprovada' where id = $1`, [a]);
      const f = (await um<{ id: string }>(`insert into filiais (nome) values ('F') returning id`)).id;
      await db.query(`insert into equipe_avisos (titulo, texto, para, filial_id) values ('A', 'x', 'filial', $1)`, [f]);
      return id;
    });
    const apagar = await erroDe(() => db.query(`delete from organizacoes where id = $1`, [o]));
    expect(apagar).toBe("");
  });
});

describe("ficha do colaborador, equipes e documentos garantidos no banco", () => {
  let pCorretor: string;
  let pColega: string;
  let eqX: string;
  let eqY: string;

  beforeAll(async () => {
    pCorretor = await comoUsuario(db, CORRETOR, async () => (await um<{ id: string }>(`select public.equipe_criar_ficha($1) as id`, [CORRETOR])).id);
    await comoUsuario(db, GESTOR, async () => {
      pColega = (await um<{ id: string }>(`insert into pessoas (nome, papeis, colaborador) values ('Colega Corretor', '{corretor}', true) returning id`)).id;
      eqX = (await um<{ id: string }>(`insert into equipes (nome) values ('Equipe X') returning id`)).id;
      eqY = (await um<{ id: string }>(`insert into equipes (nome) values ('Equipe Y') returning id`)).id;
    });
  });

  it("o próprio colaborador muda o CRECI, mas não a equipe, a filial, o desligamento nem a carteira", async () => {
    const r = await comoUsuario(db, CORRETOR, async () => ({
      creci: await erroDe(() => db.query(`update pessoas set creci_numero = '99887', creci_uf = 'SP', telefone = '13999990000' where id = $1`, [pCorretor])),
      desligar: await erroDe(() => db.query(`update pessoas set desligamento = '2026-01-01' where id = $1`, [pCorretor])),
      cargo: await erroDe(() => db.query(`update pessoas set cargo = 'Diretor' where id = $1`, [pCorretor])),
      creciColega: await erroDe(() => db.query(`update pessoas set creci_numero = '1' where id = $1`, [pColega])),
      equipe: await erroDe(() => db.query(`insert into equipe_membros (equipe_id, pessoa_id) values ($1, $2)`, [eqX, pCorretor])),
      rpcEquipe: await erroDe(() => db.query(`select public.equipe_definir_equipe($1, $2)`, [pCorretor, eqX])),
      mudarEquipe: (await db.query(`update equipes set nome = 'Minha' where id = $1`, [eqX]).catch((e) => ({ affectedRows: String(e) }))).affectedRows,
      carteira: await erroDe(() => db.query(`update pessoas set corretor_id = $1 where id = $2`, [pCorretor, pColega])),
    }));
    expect(r.creci).toBe("");
    expect(r.desligar).toContain("não permite editar em Equipe");
    expect(r.cargo).toContain("não permite editar em Equipe");
    expect(r.creciColega).toContain("não permite editar em Equipe");
    expect(r.equipe).toContain("não permite mudar as equipes");
    expect(r.rpcEquipe).toContain("não permite mudar as equipes");
    expect(String(r.mudarEquipe)).toContain("não permite mudar as equipes");
    expect(r.carteira).toContain("não permite editar em Equipe");
    const p = await um<{ creci_numero: string; desligamento: string | null }>(`select creci_numero, desligamento from pessoas where id = $1`, [pCorretor]);
    expect(p).toEqual({ creci_numero: "99887", desligamento: null });
  });

  it("juntar repetidos (feito por quem não mexe em equipes) continua levando a equipe para quem fica", async () => {
    const [a, b] = await comoUsuario(db, GESTOR, async () => {
      const x = (await um<{ id: string }>(`insert into pessoas (nome, papeis) values ('Dênis Duplicado', '{corretor}') returning id`)).id;
      const y = (await um<{ id: string }>(`insert into pessoas (nome, papeis) values ('Dênis D.', '{corretor}') returning id`)).id;
      await db.query(`select public.equipe_definir_equipe($1, $2)`, [y, eqY]);
      await db.query(`update equipes set lider_id = $1 where id = $2`, [y, eqY]);
      return [x, y];
    });
    const juntar = await comoUsuario(db, CORRETOR, () => erroDe(() => db.query(`select public.juntar_pessoas($1, $2)`, [a, b])));
    expect(juntar).toBe("");
    const r = await um<{ equipe: string; lider: string }>(
      `select (select equipe_id from equipe_membros where pessoa_id = $1) as equipe, (select lider_id from equipes where id = $2) as lider`,
      [a, eqY],
    );
    expect(r).toEqual({ equipe: eqY, lider: a });
    // Fora do "juntar repetidos", o corretor continua sem mexer nas equipes.
    const direto = await comoUsuario(db, CORRETOR, () => erroDe(() => db.query(`update equipe_membros set equipe_id = $1 where pessoa_id = $2`, [eqX, a])));
    expect(direto).toContain("não permite mudar as equipes");
  });

  it("equipe_definir_equipe só grava quando muda (sem apagar e recriar); financeiro (Comissões → editar) também mexe", async () => {
    await comoUsuario(db, GESTOR, () => db.query(`select public.equipe_definir_equipe($1, $2)`, [pColega, eqX]));
    const id1 = (await um<{ id: string }>(`select id from equipe_membros where pessoa_id = $1`, [pColega])).id;
    const audit = () => um<{ n: number }>(`select count(*)::int as n from auditoria where tabela = 'equipe_membros' and registro_id = $1`, [id1]);
    const n1 = (await audit()).n;
    expect(n1).toBe(1);
    await comoUsuario(db, GESTOR, () => db.query(`select public.equipe_definir_equipe($1, $2)`, [pColega, eqX]));
    expect((await audit()).n).toBe(n1);
    await comoUsuario(db, FINANCEIRO, () => db.query(`select public.equipe_definir_equipe($1, $2)`, [pColega, eqY]));
    const depois = await um<{ id: string; equipe_id: string }>(`select id, equipe_id from equipe_membros where pessoa_id = $1`, [pColega]);
    expect(depois).toEqual({ id: id1, equipe_id: eqY });
    expect((await audit()).n).toBe(n1 + 1);
    const deFora = await comoUsuario(db, OUTRO, () => erroDe(() => db.query(`select public.equipe_definir_equipe($1, $2)`, [pColega, eqX])));
    expect(deFora).toContain("não encontrado");
  });

  it("documentos profissionais: só o próprio colaborador e quem tem Equipe → editar leem (tabela e arquivos)", async () => {
    await comoUsuario(db, GESTOR, () =>
      db.query(`insert into equipe_documentos (pessoa_id, tipo) values ($1, 'RG'), ($2, 'Comprovante de residência')`, [pCorretor, pColega]),
    );
    const doCorretor = await comoUsuario(db, CORRETOR, async () => ({
      docs: (await todos<{ pessoa_id: string }>(`select pessoa_id from equipe_documentos where pessoa_id in ($1, $2)`, [pCorretor, pColega])).map((d) => d.pessoa_id),
      apagarColega: (await db.query(`delete from equipe_documentos where pessoa_id = $1`, [pColega])).affectedRows,
      meuArquivo: (await um<{ ok: boolean }>(`select privado.equipe_arquivo_permitido($1) as ok`, [`${org}/${pCorretor}/rg.pdf`])).ok,
      arquivoColega: (await um<{ ok: boolean }>(`select privado.equipe_arquivo_permitido($1) as ok`, [`${org}/${pColega}/rg.pdf`])).ok,
      caminhoRuim: (await um<{ ok: boolean }>(`select privado.equipe_arquivo_permitido($1) as ok`, [`${org}/../x.pdf`])).ok,
      gravarColega: await erroDe(() => db.query(`insert into equipe_documentos (pessoa_id, tipo) values ($1, 'CNH')`, [pColega])),
    }));
    expect(doCorretor.docs).toEqual([pCorretor]);
    expect(doCorretor.apagarColega).toBe(0);
    expect(doCorretor).toMatchObject({ meuArquivo: true, arquivoColega: false, caminhoRuim: false });
    expect(doCorretor.gravarColega).toMatch(/row-level security|não permite editar/);
    const gestor = await comoUsuario(db, GESTOR, async () => ({
      n: (await um<{ n: number }>(`select count(*)::int as n from equipe_documentos where pessoa_id in ($1, $2)`, [pCorretor, pColega])).n,
      arquivo: (await um<{ ok: boolean }>(`select privado.equipe_arquivo_permitido($1) as ok`, [`${org}/${pColega}/rg.pdf`])).ok,
    }));
    expect(gestor).toEqual({ n: 2, arquivo: true });
    // Outra imobiliária não abre o arquivo nem com o caminho certo.
    const outra = await comoUsuario(db, OUTRO, async () => (await um<{ ok: boolean }>(`select privado.equipe_arquivo_permitido($1) as ok`, [`${org}/${pColega}/rg.pdf`])).ok);
    expect(outra).toBe(false);
  });

  it("aprovação: o link só abre tela do sistema", async () => {
    const r = await comoUsuario(db, CORRETOR, async () => ({
      fora: await erroDe(() => db.query(`insert into aprovacoes (tipo, titulo, link) values ('outro', 'x', 'https://golpe.com/login')`)),
      barras: await erroDe(() => db.query(`insert into aprovacoes (tipo, titulo, link) values ('outro', 'x', '//golpe.com')`)),
      ok: await um<{ link: string }>(`insert into aprovacoes (tipo, titulo, link) values ('outro', 'Ver a fatura', '/faturas/123') returning link`),
    }));
    expect(r.fora).toContain("tela do sistema");
    expect(r.barras).toContain("tela do sistema");
    expect(r.ok.link).toBe("/faturas/123");
  });
});

describe("filial em leads, imóveis e contratos e carteira de clientes", () => {
  it("lead, imóvel e contrato ganham a filial do corretor e acompanham a troca de filial", async () => {
    const r = await comoUsuario(db, GESTOR, async () => {
      const f1 = (await um<{ id: string }>(`insert into filiais (nome) values ('Centro F1') returning id`)).id;
      const f2 = (await um<{ id: string }>(`insert into filiais (nome) values ('Praia F2') returning id`)).id;
      const corretor = (await um<{ id: string }>(`insert into pessoas (nome, papeis, colaborador, filial_id) values ('Fábio Filial', '{corretor}', true, $1) returning id`, [f1])).id;
      const lead = (await um<{ id: string; filial_id: string }>(`insert into leads (nome, corretor_id) values ('Lead da filial', $1) returning id, filial_id`, [corretor]));
      const imovel = (await um<{ id: string; filial_id: string }>(`insert into imoveis (codigo, logradouro, corretor_id) values ('FIL-1', 'Rua F', $1) returning id, filial_id`, [corretor]));
      const contrato = (
        await um<{ id: string; filial_id: string }>(
          `insert into contratos (imovel_id, data_inicio, prazo_meses, data_fim, valor_aluguel, dia_vencimento, data_base_reajuste) values ($1, '2026-12-01', 30, '2029-05-31', 1500, 10, '2026-12-01') returning id, filial_id`,
          [imovel.id],
        )
      );
      await db.query(`update pessoas set filial_id = $1 where id = $2`, [f2, corretor]);
      return {
        f1,
        f2,
        antes: [lead.filial_id, imovel.filial_id, contrato.filial_id],
        depois: [
          (await um<{ f: string }>(`select filial_id as f from leads where id = $1`, [lead.id])).f,
          (await um<{ f: string }>(`select filial_id as f from imoveis where id = $1`, [imovel.id])).f,
          (await um<{ f: string }>(`select filial_id as f from contratos where id = $1`, [contrato.id])).f,
        ],
      };
    });
    expect(r.antes).toEqual([r.f1, r.f1, r.f1]);
    expect(r.depois).toEqual([r.f2, r.f2, r.f2]);
  });

  it("comprador de venda entra na carteira do corretor; gestor põe e tira cliente da carteira", async () => {
    const r = await comoUsuario(db, GESTOR, async () => {
      const corretor = (await um<{ id: string }>(`insert into pessoas (nome, papeis) values ('Carla Carteira', '{corretor}') returning id`)).id;
      const comprador = (await um<{ id: string }>(`insert into pessoas (nome) values ('Comprador da Carla') returning id`)).id;
      const outroCorretor = (await um<{ id: string }>(`insert into pessoas (nome, papeis) values ('Otávio Corretor', '{corretor}') returning id`)).id;
      const jaTem = (await um<{ id: string }>(`insert into pessoas (nome, corretor_id) values ('Cliente de outro', $1) returning id`, [outroCorretor])).id;
      await db.query(`insert into vendas (valor, comprador_id, corretor_id) values (300000, $1, $2), (100000, $3, $2)`, [comprador, corretor, jaTem]);
      const cliente = (await um<{ id: string }>(`insert into pessoas (nome) values ('Cliente avulso') returning id`)).id;
      await db.query(`update pessoas set corretor_id = $1 where id = $2`, [corretor, cliente]);
      return {
        corretor,
        outroCorretor,
        comprador: (await um<{ c: string }>(`select corretor_id as c from pessoas where id = $1`, [comprador])).c,
        jaTem: (await um<{ c: string }>(`select corretor_id as c from pessoas where id = $1`, [jaTem])).c,
        carteira: (await um<{ n: number }>(`select count(*)::int as n from pessoas where corretor_id = $1`, [corretor])).n,
        propria: await erroDe(() => db.query(`update pessoas set corretor_id = id where id = $1`, [cliente])),
      };
    });
    expect(r.comprador).toBe(r.corretor);
    expect(r.jaTem).toBe(r.outroCorretor);
    expect(r.carteira).toBe(2);
    expect(r.propria).toContain("própria carteira");
  });
});
