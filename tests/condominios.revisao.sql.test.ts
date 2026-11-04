/**
 * Correções da revisão da Gestão de condomínios (etapa 23), no banco (PGlite):
 *  - resposta pelo portal nunca sai como "Administradora": as RPCs do portal só
 *    valem para anon e o gatilho grava como morador o que vem do portal (ou de
 *    quem não é da equipe);
 *  - responsável que saiu da equipe não trava as outras gravações do condomínio
 *    e da ocorrência (só é conferido quando é escolhido ou trocado);
 *  - entradas e tentativas no portal não enchem o Histórico de ações;
 *  - índices nas chaves estrangeiras usadas nas buscas.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { comoAnonimo, comoUsuario, criarBanco } from "./pglite";

const ADMIN = "00000000-0000-0000-0000-000000023b01";
const GESTOR = "00000000-0000-0000-0000-000000023b02";
const ESTRANHO = "00000000-0000-0000-0000-000000023b03";
const NINGUEM = "00000000-0000-0000-0000-000000023b04";

let db: PGlite;
let org: string;
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
/** Como o dono do banco (ignora grants), mas com auth.uid() = `sub` — simula a RPC rodando com o JWT de alguém. */
async function comoDonoComJwt<T>(sub: string, fn: () => Promise<T>): Promise<T> {
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [sub]);
  try {
    return await fn();
  } finally {
    await db.query(`select set_config('request.jwt.claim.sub', '', false)`);
  }
}
const ocorrencia = (oc: string) => um<{ status: string; fotos: string[] }>(`select status, fotos from cond_ocorrencias where id = $1`, [oc]);
const ultimaResposta = (oc: string) =>
  um<{ autor: string; usuario_id: string | null; pessoa_id: string | null; texto: string }>(
    `select autor, usuario_id, pessoa_id, texto from cond_ocorrencia_respostas where ocorrencia_id = $1 order by created_at desc, id desc limit 1`,
    [oc],
  );
const respostaComTexto = (oc: string, texto: string) =>
  um<{ autor: string; usuario_id: string | null; pessoa_id: string | null }>(
    `select autor, usuario_id, pessoa_id from cond_ocorrencia_respostas where ocorrencia_id = $1 and texto = $2`,
    [oc, texto],
  );
const auditoriaDoLink = async () =>
  (
    await db.query<{ acao: string; campos: string[] }>(
      `select acao, campos from auditoria where tabela = 'cond_portal_acessos' and registro_id = $1 order by data, id`,
      [ids.acesso],
    )
  ).rows;

beforeAll(async () => {
  db = await criarBanco();
  org = await comoAdmin(async () => (await um<{ id: string }>(`select public.criar_organizacao('Imob Revisão Condomínios') as id`)).id);
  // O estranho tem a própria conta (é "membro de outra conta").
  await comoUsuario(db, ESTRANHO, () => db.query(`select public.criar_organizacao('Conta do estranho')`));
  await db.query(`insert into membros (organizacao_id, user_id, papel, nome) values ($1, $2, 'gestor', 'Gil')`, [org, GESTOR]);
  await comoAdmin(async () => {
    await db.query(`select public.cond_ligar_modulo(true)`);
    ids.ana = await id(`insert into pessoas (nome, documento, telefone) values ('Ana Condômina', '123.456.789-09', '51911110000') returning id`);
    ids.caio = await id(`insert into pessoas (nome, telefone) values ('Caio Síndico', '(51) 98888-7777') returning id`);
    ids.nina = await id(`insert into pessoas (nome) values ('Nina Nova Síndica') returning id`);
    ids.cond = await id(`insert into cond_condominios (nome, responsavel_user_id) values ('Edifício Sol', $1) returning id`, [GESTOR]);
    ids.u101 = await id(`insert into cond_unidades (condominio_id, numero, fracao_ideal) values ($1, '101', 1) returning id`, [ids.cond]);
    await db.query(`insert into cond_pessoas_unidade (condominio_id, unidade_id, pessoa_id, papel) values ($1, $2, $3, 'proprietario')`, [ids.cond, ids.u101, ids.ana]);
    await db.query(`insert into cond_pessoas_unidade (condominio_id, pessoa_id, papel) values ($1, $2, 'sindico')`, [ids.cond, ids.caio]);
    const a = await um<{ id: string; token: string }>(`insert into cond_portal_acessos (condominio_id, pessoa_id) values ($1, $2) returning id, token`, [ids.cond, ids.ana]);
    ids.acesso = a.id;
    token = a.token;
  });
});

describe("portal: a resposta do morador nunca sai como 'Administradora'", () => {
  it("entra no portal e abre a ocorrência (anônimo)", async () => {
    const r = await anon<{ ok: boolean; sessao: string }>(`select public.cond_portal_entrar($1, '1234', '1.1.1.1', 't') as r`, [token]);
    expect(r.ok).toBe(true);
    sessao = r.sessao;
    const oc = await anon<{ id: string; envio: string; pasta: string }>(`select public.cond_portal_abrir_ocorrencia($1, $2, $3, 'barulho', 'Som alto', 'Toda noite') as r`, [
      token,
      sessao,
      ids.u101,
    ]);
    ids.oc = oc.id;
    ids.envio = oc.envio;
    ids.pasta = oc.pasta;
    expect((await ocorrencia(ids.oc)).status).toBe("aberta");
  });

  it("logado em qualquer conta (JWT de outra conta): as RPCs do portal não executam", async () => {
    const chamadas: [string, unknown[]][] = [
      [`select public.cond_portal_responder_ocorrencia($1, $2, $3, 'Administradora: pague o reparo neste Pix')`, [token, sessao, ids.oc]],
      [`select public.cond_portal_dados($1, $2, 'inicio', '{}'::jsonb)`, [token, sessao]],
      [`select public.cond_portal_inicio($1, $2)`, [token, sessao]],
      [`select public.cond_portal_entrar($1, '1234')`, [token]],
      [`select public.cond_portal_sair($1, $2)`, [token, sessao]],
      [`select public.cond_portal_abrir_ocorrencia($1, $2, null, 'sugestao', 'X', '')`, [token, sessao]],
      [`select public.cond_portal_registrar_foto($1, $2, $3, $4)`, [token, sessao, ids.envio, `${ids.pasta}/a.jpg`]],
    ];
    for (const [sql, params] of chamadas) {
      for (const quem of [ESTRANHO, ADMIN]) {
        expect(await erroDe(() => comoUsuario(db, quem, () => db.query(sql, params))), `${quem} ${sql}`).toMatch(/permission denied/i);
      }
    }
    // A policy do Storage continua chamando cond_portal_pode_enviar para o morador logado em outra conta.
    expect(await comoUsuario(db, ESTRANHO, async () => (await um<{ r: boolean }>(`select public.cond_portal_pode_enviar($1) as r`, [`${ids.pasta}/a.jpg`])).r)).toBe(true);
    // Nada foi gravado e a ocorrência não "andou".
    expect((await um<{ n: number }>(`select count(*)::int as n from cond_ocorrencia_respostas where ocorrencia_id = $1`, [ids.oc])).n).toBe(0);
    expect((await ocorrencia(ids.oc)).status).toBe("aberta");
  });

  it("mesmo que a RPC rode com o JWT de um estranho (ou da própria equipe), a gravação do portal é do morador", async () => {
    await comoDonoComJwt(ESTRANHO, () =>
      db.query(`select public.cond_portal_responder_ocorrencia($1, $2, $3, 'Administradora: pague neste Pix')`, [token, sessao, ids.oc]),
    );
    expect(await ultimaResposta(ids.oc)).toMatchObject({ autor: "morador", usuario_id: null, pessoa_id: ids.ana });
    expect((await ocorrencia(ids.oc)).status).toBe("aberta");
    await comoDonoComJwt(ADMIN, () => db.query(`select public.cond_portal_responder_ocorrencia($1, $2, $3, 'Pelo portal')`, [token, sessao, ids.oc]));
    expect(await ultimaResposta(ids.oc)).toMatchObject({ autor: "morador", usuario_id: null, pessoa_id: ids.ana, texto: "Pelo portal" });
    expect((await ocorrencia(ids.oc)).status).toBe("aberta");
    // No portal, nenhuma resposta aparece como da administradora.
    const sec = await anon<{ lista: { id: string; respostas: { autor: string }[] }[] }>(`select public.cond_portal_dados($1, $2, 'ocorrencias', '{}'::jsonb) as r`, [
      token,
      sessao,
    ]);
    const minha = sec.lista.find((o) => o.id === ids.oc)!;
    expect(minha.respostas.map((r) => r.autor)).toEqual(["morador", "morador"]);
  });

  it("gravação direta de quem não é da equipe (sem passar pelo portal) também não vira 'equipe'", async () => {
    await comoDonoComJwt(NINGUEM, () =>
      db.query(`insert into cond_ocorrencia_respostas (organizacao_id, condominio_id, ocorrencia_id, texto, pessoa_id) values ($1, $2, $3, 'Sou a administradora', $4)`, [
        org,
        ids.cond,
        ids.oc,
        ids.ana,
      ]),
    );
    expect(await ultimaResposta(ids.oc)).toMatchObject({ autor: "morador", usuario_id: null });
    expect((await ocorrencia(ids.oc)).status).toBe("aberta");
  });

  it("a equipe respondendo continua como 'equipe' e põe em andamento — mesmo depois do portal na mesma transação", async () => {
    await comoDonoComJwt(ADMIN, () =>
      db.transaction(async (tx) => {
        await tx.query(`select public.cond_portal_responder_ocorrencia($1, $2, $3, 'Mais uma do morador')`, [token, sessao, ids.oc]);
        await tx.query(`insert into cond_ocorrencia_respostas (condominio_id, ocorrencia_id, texto) values ($1, $2, 'Vamos notificar a unidade.')`, [ids.cond, ids.oc]);
      }),
    );
    expect(await respostaComTexto(ids.oc, "Mais uma do morador")).toMatchObject({ autor: "morador", usuario_id: null, pessoa_id: ids.ana });
    expect(await respostaComTexto(ids.oc, "Vamos notificar a unidade.")).toMatchObject({ autor: "equipe", usuario_id: ADMIN, pessoa_id: null });
    expect((await ocorrencia(ids.oc)).status).toBe("em_andamento");
    // Pela tela da equipe (logado, papel authenticated) também.
    await comoAdmin(() => db.query(`insert into cond_ocorrencia_respostas (condominio_id, ocorrencia_id, texto) values ($1, $2, 'Notificado.')`, [ids.cond, ids.oc]));
    expect(await ultimaResposta(ids.oc)).toMatchObject({ autor: "equipe", usuario_id: ADMIN });
  });

  it("o servidor do portal só chama as RPCs pelo cliente anônimo", () => {
    const dir = join(__dirname, "..", "src", "app", "condominio", "[token]");
    for (const arq of ["actions.ts", "sessao.ts"]) {
      const src = readFileSync(join(dir, arq), "utf8");
      const chamadas = src.match(/\.rpc\(/g) ?? [];
      const anonimas = src.match(/clienteAnonimo\(\)\.rpc\(/g) ?? [];
      expect(chamadas.length, arq).toBeGreaterThan(0);
      expect(anonimas.length, arq).toBe(chamadas.length);
      expect(src, arq).not.toMatch(/clienteServidor|supabase\/servidor/);
    }
  });
});

describe("responsável que saiu da equipe não trava as gravações", () => {
  it("só membro da equipe pode ser escolhido como responsável", async () => {
    await comoAdmin(async () => {
      expect(await erroDe(() => db.query(`insert into cond_condominios (nome, responsavel_user_id) values ('X', $1)`, [ESTRANHO]))).toMatch(/precisa ser alguém da equipe/);
      expect(await erroDe(() => db.query(`update cond_ocorrencias set responsavel_user_id = $2 where id = $1`, [ids.oc, ESTRANHO]))).toMatch(/precisa ser alguém da equipe/);
      await db.query(`update cond_ocorrencias set responsavel_user_id = $2 where id = $1`, [ids.oc, GESTOR]);
      ids.oc2 = await id(`insert into cond_ocorrencias (condominio_id, unidade_id, pessoa_id, tipo, titulo, responsavel_user_id) values ($1, $2, $3, 'manutencao', 'Infiltração', $4) returning id`, [
        ids.cond,
        ids.u101,
        ids.ana,
        GESTOR,
      ]);
    });
  });

  it("depois de removido o gestor: síndico novo, edição, respostas, portal e foto continuam gravando", async () => {
    await comoAdmin(() => db.query(`select public.equipe_remover_membro($1)`, [GESTOR]));
    expect((await um<{ n: number }>(`select count(*)::int as n from membros where user_id = $1`, [GESTOR])).n).toBe(0);
    await comoAdmin(async () => {
      // Ligar um novo síndico atualiza cond_condominios.sindico_id.
      await db.query(`insert into cond_pessoas_unidade (condominio_id, pessoa_id, papel) values ($1, $2, 'sindico')`, [ids.cond, ids.nina]);
      expect((await um<{ s: string }>(`select sindico_id as s from cond_condominios where id = $1`, [ids.cond])).s).toBe(ids.nina);
      // Editar só o nome.
      await db.query(`update cond_condominios set nome = 'Edifício Sol Nascente' where id = $1`, [ids.cond]);
      // Equipe responde (muda o status da ocorrência).
      await db.query(`insert into cond_ocorrencia_respostas (condominio_id, ocorrencia_id, texto) values ($1, $2, 'Vistoria marcada.')`, [ids.cond, ids.oc2]);
      expect((await ocorrencia(ids.oc2)).status).toBe("em_andamento");
      await db.query(`update cond_ocorrencias set status = 'resolvida' where id = $1`, [ids.oc]);
    });
    // Morador responde pelo portal (resolvida → aberta) e registra a foto (atualiza `fotos`).
    await anon(`select public.cond_portal_responder_ocorrencia($1, $2, $3, 'Voltou a acontecer') as r`, [token, sessao, ids.oc]);
    expect((await ocorrencia(ids.oc)).status).toBe("aberta");
    await anon(`select public.cond_portal_registrar_foto($1, $2, $3, $4) as r`, [token, sessao, ids.envio, `${ids.pasta}/foto.jpg`]);
    expect((await ocorrencia(ids.oc)).fotos).toEqual([`${ids.pasta}/foto.jpg`]);
    // O responsável antigo continua lá (ninguém apagou), mas trocar por quem saiu não pode; zerar pode.
    await comoAdmin(async () => {
      expect((await um<{ r: string }>(`select responsavel_user_id as r from cond_condominios where id = $1`, [ids.cond])).r).toBe(GESTOR);
      const cond2 = await id(`insert into cond_condominios (nome) values ('Residencial Lua') returning id`);
      expect(await erroDe(() => db.query(`update cond_condominios set responsavel_user_id = $2 where id = $1`, [cond2, GESTOR]))).toMatch(/precisa ser alguém da equipe/);
      expect(await erroDe(() => db.query(`insert into cond_ocorrencias (condominio_id, titulo, responsavel_user_id) values ($1, 'Y', $2)`, [ids.cond, GESTOR]))).toMatch(
        /precisa ser alguém da equipe/,
      );
      await db.query(`update cond_ocorrencias set responsavel_user_id = null where id = $1`, [ids.oc2]);
      await db.query(`update cond_ocorrencias set responsavel_user_id = $2 where id = $1`, [ids.oc2, ADMIN]);
    });
  });
});

describe("auditoria do link do portal sem as entradas e tentativas", () => {
  it("um gatilho de insert/delete e um de update (sem o do laço genérico em dobro)", async () => {
    const gatilhos = async () =>
      (
        await db.query<{ tgname: string }>(
          `select tgname from pg_trigger where tgrelid = 'public.cond_portal_acessos'::regclass and not tgisinternal and tgname like '%auditoria%' order by tgname`,
        )
      ).rows.map((r) => r.tgname);
    expect(await gatilhos()).toEqual(["cond_portal_acessos_auditoria_trg", "cond_portal_acessos_auditoria_upd_trg"]);
    // Rodar a migração de novo não duplica.
    await db.exec(readFileSync(join(__dirname, "..", "supabase", "migrations", "20261107000011_condominios.sql"), "utf8"));
    expect(await gatilhos()).toEqual(["cond_portal_acessos_auditoria_trg", "cond_portal_acessos_auditoria_upd_trg"]);
  });

  it("entrar, errar o número e ser bloqueado não grava; mudar validade e desativar grava", async () => {
    // Até aqui: o link foi gerado (insert); a entrada do começo do arquivo não gravou nada.
    expect((await auditoriaDoLink()).map((a) => a.acao)).toEqual(["insert"]);
    for (let i = 0; i < 5; i++) await anon(`select public.cond_portal_entrar($1, '9999', '1.1.1.1', 't') as r`, [token]);
    expect((await um<{ b: string | null }>(`select bloqueado_ate as b from cond_portal_acessos where id = $1`, [ids.acesso])).b).not.toBeNull();
    await db.query(`update cond_portal_acessos set bloqueado_ate = null, falhas = 0 where id = $1`, [ids.acesso]);
    await anon(`select public.cond_portal_entrar($1, '9999') as r`, [token]);
    const ok = await anon<{ ok: boolean }>(`select public.cond_portal_entrar($1, '1234') as r`, [token]);
    expect(ok.ok).toBe(true);
    expect((await um<{ n: number }>(`select acessos as n from cond_portal_acessos where id = $1`, [ids.acesso])).n).toBe(2);
    expect(await auditoriaDoLink()).toHaveLength(1);
    // As entradas e tentativas continuam registradas no registro do portal.
    const tipos = (await db.query<{ tipo: string }>(`select tipo from cond_portal_eventos where acesso_id = $1`, [ids.acesso])).rows.map((r) => r.tipo);
    expect(tipos).toEqual(expect.arrayContaining(["entrada", "falha", "bloqueio"]));
    // Mudanças da equipe no link entram no histórico.
    await comoAdmin(async () => {
      await db.query(`update cond_portal_acessos set expira_em = now() + interval '30 days' where id = $1`, [ids.acesso]);
      await db.query(`update cond_portal_acessos set ativo = false where id = $1`, [ids.acesso]);
      await db.query(`delete from cond_portal_acessos where id = $1`, [ids.acesso]);
    });
    const depois = await auditoriaDoLink();
    expect(depois.map((a) => a.acao)).toEqual(["insert", "update", "update", "delete"]);
    expect(depois[1].campos).toEqual(["expira_em"]);
    expect(depois[2].campos).toEqual(["ativo", "revogado_em"]);
  });
});

describe("responsável que saiu da equipe: juntar e excluir pessoa", () => {
  it("juntar repetidos e excluir a pessoa síndica/autora continuam funcionando", async () => {
    await comoAdmin(async () => {
      // A autora das ocorrências (Ana) tem um cadastro repetido: juntar move pessoa_id da ocorrência.
      const copia = await id(`insert into pessoas (nome, documento) values ('Ana C.', '123.456.789-09') returning id`);
      const eventosDa = async (p: string) =>
        (await um<{ n: number }>(`select count(*)::int as n from cond_portal_eventos where pessoa_id = $1`, [p])).n;
      const eventosAntes = await eventosDa(ids.ana);
      expect(eventosAntes).toBeGreaterThan(0); // link gerado, entradas e tentativas do portal
      await db.query(`select public.juntar_pessoas($1, $2)`, [copia, ids.ana]);
      expect((await um<{ p: string }>(`select pessoa_id as p from cond_ocorrencias where id = $1`, [ids.oc])).p).toBe(copia);
      // O registro do portal acompanha a pessoa que ficou.
      expect(await eventosDa(ids.ana)).toBe(0);
      expect(await eventosDa(copia)).toBe(eventosAntes);
      // Excluir a síndica: o "on delete set null" vira update no condomínio.
      await db.query(`delete from pessoas where id = $1`, [ids.nina]);
      expect((await um<{ s: string | null }>(`select sindico_id as s from cond_condominios where id = $1`, [ids.cond])).s).not.toBe(ids.nina);
      // Excluir a autora da ocorrência: set null na ocorrência.
      await db.query(`delete from pessoas where id = $1`, [copia]);
      expect((await um<{ p: string | null }>(`select pessoa_id as p from cond_ocorrencias where id = $1`, [ids.oc])).p).toBeNull();
    });
  });
});

describe("índices nas chaves estrangeiras", () => {
  const esperados: [string, string, string][] = [
    ["cond_reservas_unidade_idx", "cond_reservas", "(unidade_id, status)"],
    ["cond_cotas_acordo_parcela_idx", "cond_cotas", "(acordo_parcela_de) WHERE (acordo_parcela_de IS NOT NULL)"],
    ["cond_cotas_acordo_idx", "cond_cotas", "(acordo_id) WHERE (acordo_id IS NOT NULL)"],
    ["cond_condominios_sindico_idx", "cond_condominios", "(sindico_id) WHERE (sindico_id IS NOT NULL)"],
    ["cond_lancamentos_fornecedor_idx", "cond_lancamentos", "(fornecedor_id) WHERE (fornecedor_id IS NOT NULL)"],
    ["cond_contratos_fornecedor_idx", "cond_contratos_fornecedores", "(fornecedor_id) WHERE (fornecedor_id IS NOT NULL)"],
    ["cond_comunicado_leituras_pessoa_idx", "cond_comunicado_leituras", "(pessoa_id)"],
    ["cond_portal_acessos_pessoa_fk_idx", "cond_portal_acessos", "(pessoa_id)"],
    ["cond_reservas_pessoa_idx", "cond_reservas", "(pessoa_id) WHERE (pessoa_id IS NOT NULL)"],
    ["cond_acordos_pessoa_idx", "cond_acordos", "(pessoa_id) WHERE (pessoa_id IS NOT NULL)"],
    ["cond_ocorrencias_pessoa_idx", "cond_ocorrencias", "(pessoa_id) WHERE (pessoa_id IS NOT NULL)"],
    ["cond_ocorrencia_respostas_pessoa_idx", "cond_ocorrencia_respostas", "(pessoa_id) WHERE (pessoa_id IS NOT NULL)"],
    ["cond_assembleia_presencas_pessoa_idx", "cond_assembleia_presencas", "(pessoa_id) WHERE (pessoa_id IS NOT NULL)"],
    ["cond_votos_pessoa_idx", "cond_votos", "(pessoa_id) WHERE (pessoa_id IS NOT NULL)"],
    ["cond_portal_eventos_pessoa_idx", "cond_portal_eventos", "(pessoa_id) WHERE (pessoa_id IS NOT NULL)"],
  ];

  it("existem nas colunas certas", async () => {
    for (const [nome, tabela, def] of esperados) {
      const r = await um<{ tablename: string; indexdef: string }>(`select tablename, indexdef from pg_indexes where schemaname = 'public' and indexname = $1`, [nome]);
      expect(r, nome).toBeTruthy();
      expect(r.tablename, nome).toBe(tabela);
      expect(r.indexdef.endsWith(def), `${nome}: ${r.indexdef}`).toBe(true);
    }
  });

  it("servem às buscas por unidade, acordo e pessoa (inclusive o parcial com '= valor')", async () => {
    const plano = async (sql: string) => {
      await db.exec(`set enable_seqscan = off`);
      try {
        return (await db.query<{ "QUERY PLAN": string }>(`explain ${sql}`)).rows.map((r) => r["QUERY PLAN"]).join("\n");
      } finally {
        await db.exec(`reset enable_seqscan`);
      }
    };
    const x = "'00000000-0000-0000-0000-0000000000aa'::uuid";
    expect(await plano(`select 1 from cond_reservas where unidade_id = ${x} and status in ('pedida','confirmada')`)).toMatch(/cond_reservas_unidade_idx/);
    expect(await plano(`select 1 from cond_cotas where acordo_parcela_de = ${x}`)).toMatch(/cond_cotas_acordo_parcela_idx/);
    expect(await plano(`select 1 from cond_cotas where acordo_id = ${x}`)).toMatch(/cond_cotas_acordo_idx/);
    expect(await plano(`select 1 from cond_lancamentos where fornecedor_id = ${x}`)).toMatch(/cond_lancamentos_fornecedor_idx/);
    expect(await plano(`select 1 from cond_comunicado_leituras where pessoa_id = ${x}`)).toMatch(/cond_comunicado_leituras_pessoa_idx/);
    expect(await plano(`select 1 from cond_votos where pessoa_id = ${x}`)).toMatch(/cond_votos_pessoa_idx/);
    // O "juntar repetidos" troca a pessoa do registro do portal sem varrer a tabela inteira.
    expect(await plano(`update cond_portal_eventos set pessoa_id = ${x} where pessoa_id = ${x}`)).toMatch(/cond_portal_eventos_pessoa_idx/);
  });
});
