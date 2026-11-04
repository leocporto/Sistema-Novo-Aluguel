/**
 * Integrações e API no banco (PGlite): listas iguais às do app, cofre de
 * segredos e configuração por papel, chaves de API (hash, escopo, revogação,
 * validade, limite, modo, isolamento, paginação), criação de lead pela API,
 * webhooks (URL segura, fila pelos gatilhos de origem, assinatura HMAC
 * calculada no banco, tentativas com espera crescente, desistência,
 * reprocessamento, pausa), de-para contábil, monitoramento e auditoria.
 */
import { createHmac, createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { ESCOPOS_API, EVENTOS_WEBHOOK, atrasoMinutos } from "@/lib/dominio/integracoes";
import { comoAnonimo, comoUsuario, criarBanco } from "./pglite";

const ADMIN = "00000000-0000-0000-0000-000000021a01";
const GESTOR = "00000000-0000-0000-0000-000000021a02";
const CORRETOR = "00000000-0000-0000-0000-000000021a03";
const OUTRO = "00000000-0000-0000-0000-000000021b01";
const PESSOAL = "00000000-0000-0000-0000-000000021c01";
const MUDA = "00000000-0000-0000-0000-000000021d01";

let db: PGlite;
let org: string;
let orgB: string;
let orgP: string;
let imovel: string;
let contrato: string;
let imovelB: string;

const um = async <T = Record<string, unknown>>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows[0];
const todos = async <T = Record<string, unknown>>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows;
async function erroDe(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "";
  } catch (e) {
    return String(e);
  }
}

type Resp = { status: number; dados?: unknown; erro?: { codigo: string; mensagem: string }; proximo_cursor?: string | null; tentar_em?: number };
const listar = (chave: string, recurso: string, params: object = {}) =>
  comoAnonimo(db, async () => (await um<{ r: Resp }>(`select public.api_v1_listar($1, $2, $3::jsonb, '1.2.3.4') as r`, [chave, recurso, JSON.stringify(params)])).r);
const obter = (chave: string, recurso: string, id: string) => comoAnonimo(db, async () => (await um<{ r: Resp }>(`select public.api_v1_obter($1, $2, $3) as r`, [chave, recurso, id])).r);
const criarLead = (chave: string, p: object) => comoAnonimo(db, async () => (await um<{ r: Resp }>(`select public.api_v1_criar_lead($1, $2::jsonb) as r`, [chave, JSON.stringify(p)])).r);
const novaChave = (user: string, escopos: string[], extra: { expira?: string | null; limite?: number } = {}) =>
  comoUsuario(db, user, async () =>
    (await um<{ r: { id: string; chave: string; prefixo: string } }>(`select public.api_chave_criar('Teste', $1::text[], $2::timestamptz, $3) as r`, [escopos, extra.expira ?? null, extra.limite ?? 600])).r,
  );

beforeAll(async () => {
  db = await criarBanco();
  org = await comoUsuario(db, ADMIN, async () => (await um<{ id: string }>(`select public.criar_organizacao('Imob Integra') as id`)).id);
  await db.query(`insert into membros (organizacao_id, user_id, papel) values ($1, $2, 'gestor'), ($1, $3, 'corretor')`, [org, GESTOR, CORRETOR]);
  orgB = await comoUsuario(db, OUTRO, async () => (await um<{ id: string }>(`select public.criar_organizacao('Outra Imob') as id`)).id);
  orgP = await comoUsuario(db, PESSOAL, async () => (await um<{ id: string }>(`select public.criar_organizacao('Meus Imóveis') as id`)).id);
  await comoUsuario(db, PESSOAL, () => db.query(`update organizacoes set modo = 'pessoal' where id = $1`, [orgP]));

  await comoUsuario(db, ADMIN, async () => {
    imovel = (await um<{ id: string }>(`insert into imoveis (codigo, logradouro, numero, cidade, status) values ('INT-1','Rua A','1','Canoas','alugado') returning id`)).id;
    for (let i = 2; i <= 6; i++) await db.query(`insert into imoveis (codigo, cidade) values ($1, 'Canoas')`, [`INT-${i}`]);
    const prop = (await um<{ id: string }>(`insert into pessoas (nome, papeis, documento, email) values ('Paula','{proprietario}','52998224725','p@x.com') returning id`)).id;
    const loc = (await um<{ id: string }>(`insert into pessoas (nome, papeis, documento, banco, conta) values ('Luís','{locatario}','11144477735','001','12345') returning id`)).id;
    contrato = (
      await um<{ id: string }>(
        `insert into contratos (imovel_id, data_inicio, prazo_meses, data_fim, valor_aluguel, dia_vencimento, data_base_reajuste)
         values ($1, '2026-01-01', 30, '2028-06-30', 2000, 10, '2026-01-01') returning id`,
        [imovel],
      )
    ).id;
    await db.query(`insert into contrato_partes (contrato_id, pessoa_id, papel, percentual) values ($1,$2,'proprietario',100), ($1,$3,'locatario',null)`, [contrato, prop, loc]);
  });
  imovelB = await comoUsuario(db, OUTRO, async () => (await um<{ id: string }>(`insert into imoveis (codigo, cidade) values ('B-1','Porto Alegre') returning id`)).id);
});

describe("listas do banco = listas do app", () => {
  it("eventos, escopos e espera entre tentativas", async () => {
    const ev = (await um<{ e: string[] }>(`select privado.webhook_eventos() as e`)).e;
    expect([...ev].sort()).toEqual(EVENTOS_WEBHOOK.map((e) => e.id).sort());
    const esc = (await um<{ e: string[] }>(`select privado.api_escopos() as e`)).e;
    expect([...esc].sort()).toEqual(ESCOPOS_API.map((e) => e.id).sort());
    for (let n = 1; n <= 9; n++) expect((await um<{ m: number }>(`select privado.webhook_atraso_min($1) as m`, [n])).m).toBe(atrasoMinutos(n));
  });

  it("HMAC-SHA256 do banco bate com o do Node", async () => {
    const msg = '{"evento": "teste", "dados": {"á": 1}}';
    const banco = (await um<{ h: string }>(`select encode(privado.mkt_hmac_sha256(convert_to($1, 'UTF8'), convert_to($2, 'UTF8')), 'hex') as h`, [msg, "whsec_abc"])).h;
    expect(banco).toBe(createHmac("sha256", "whsec_abc").update(msg, "utf8").digest("hex"));
  });
});

describe("configuração de provedores e cofre de segredos", () => {
  it("admin grava; gestor só lê a configuração; corretor não vê; segredo só o admin", async () => {
    await comoUsuario(db, ADMIN, async () => {
      await db.query(`insert into integracoes_config (provedor, categoria, ambiente, config, chaves_dica) values ('asaas','pagamentos','sandbox','{"x":"1"}','{"api_key":"••••1234"}')`);
      await db.query(`insert into integracoes_segredos (provedor, segredos) values ('asaas', '{"api_key":"segredo-1234"}')`);
    });
    const gestorCfg = await comoUsuario(db, GESTOR, () => todos(`select provedor from integracoes_config`));
    expect(gestorCfg).toHaveLength(1);
    expect(await comoUsuario(db, GESTOR, () => todos(`select * from integracoes_segredos`))).toHaveLength(0);
    const upd = await comoUsuario(db, GESTOR, async () => {
      await db.query(`update integracoes_config set ativo = true`);
      return todos<{ ativo: boolean }>(`select ativo from integracoes_config`);
    });
    expect(upd[0].ativo).toBe(false);
    expect(await erroDe(() => comoUsuario(db, GESTOR, () => db.query(`insert into integracoes_segredos (provedor, segredos) values ('resend','{}')`)))).toMatch(/row-level security/);
    expect(await comoUsuario(db, CORRETOR, () => todos(`select * from integracoes_config`))).toHaveLength(0);
    expect(await comoUsuario(db, OUTRO, () => todos(`select * from integracoes_config`))).toHaveLength(0);
    expect(await comoUsuario(db, OUTRO, () => todos(`select * from integracoes_segredos`))).toHaveLength(0);
    const seg = await comoUsuario(db, ADMIN, () => todos<{ segredos: { api_key: string } }>(`select segredos from integracoes_segredos`));
    expect(seg[0].segredos.api_key).toBe("segredo-1234");
  });

  it("a configuração entra no histórico de ações sem o segredo", async () => {
    const a = await um<{ n: number }>(`select count(*)::int as n from auditoria where organizacao_id = $1 and tabela = 'integracoes_config'`, [org]);
    expect(a.n).toBeGreaterThan(0);
    const seg = await um<{ n: number }>(`select count(*)::int as n from auditoria where organizacao_id = $1 and tabela = 'integracoes_segredos'`, [org]);
    expect(seg.n).toBe(0);
  });
});

describe("chaves de API", () => {
  it("só o admin cria; a chave aparece uma vez e o banco guarda só o hash", async () => {
    expect(await erroDe(() => novaChave(GESTOR, ["imoveis:leitura"]))).toMatch(/administrador/);
    expect(await erroDe(() => novaChave(CORRETOR, ["imoveis:leitura"]))).toMatch(/administrador/);
    expect(await erroDe(() => novaChave(ADMIN, ["xx:leitura"]))).toMatch(/pelo menos uma permissão/);
    const r = await novaChave(ADMIN, ["imoveis:leitura", "imoveis:leitura", "contratos:leitura"]);
    expect(r.chave).toMatch(/^na_[0-9a-f]{10}_[0-9a-f]{48}$/);
    expect(r.chave.startsWith(r.prefixo)).toBe(true);
    const linha = await um<{ segredo_hash: string; escopos: string[] }>(`select segredo_hash, escopos from api_chaves where id = $1`, [r.id]);
    expect(linha.segredo_hash).toBe(createHash("sha256").update(r.chave).digest("hex"));
    expect(linha.escopos).toEqual(["contratos:leitura", "imoveis:leitura"]);
    expect(JSON.stringify(await todos(`select * from api_chaves`))).not.toContain(r.chave.slice(14));
    // Gestor vê a lista, não altera; ninguém insere chave direto pela API do banco.
    expect(await comoUsuario(db, GESTOR, () => todos(`select id from api_chaves`))).toHaveLength(1);
    expect(
      await erroDe(() =>
        comoUsuario(db, ADMIN, () => db.query(`insert into api_chaves (nome, prefixo, segredo_hash, escopos) values ('x','na_0000000000', repeat('a',64), '{imoveis:leitura}')`)),
      ),
    ).toMatch(/row-level security/);
    expect(await comoUsuario(db, OUTRO, () => todos(`select id from api_chaves`))).toHaveLength(0);
  });

  it("lista só a organização da chave, com paginação por cursor e filtros", async () => {
    const { chave } = await novaChave(ADMIN, ["imoveis:leitura"]);
    const p1 = await listar(chave, "imoveis", { limite: 4 });
    expect(p1.status).toBe(200);
    const d1 = p1.dados as { id: string; codigo: string }[];
    expect(d1).toHaveLength(4);
    expect(p1.proximo_cursor).toBeTruthy();
    const p2 = await listar(chave, "imoveis", { limite: 4, cursor: p1.proximo_cursor });
    const d2 = p2.dados as { id: string }[];
    expect(d2).toHaveLength(2);
    expect(p2.proximo_cursor).toBeNull();
    const ids = [...d1, ...d2].map((x) => x.id);
    expect(new Set(ids).size).toBe(6);
    expect(ids).not.toContain(imovelB);
    const filtrado = await listar(chave, "imoveis", { codigo: "int-3" });
    expect((filtrado.dados as { codigo: string }[]).map((x) => x.codigo)).toEqual(["INT-3"]);
    expect((await listar(chave, "imoveis", { status: "voando" })).status).toBe(422);
    expect((await listar(chave, "imoveis", { limite: "500" })).status).toBe(422);
    expect((await listar(chave, "imoveis", { cursor: "lixo" })).status).toBe(422);
    expect((await listar(chave, "planetas")).status).toBe(404);
    // Obter: da própria organização sim; da outra, 404.
    expect((await obter(chave, "imoveis", imovel)).status).toBe(200);
    expect((await obter(chave, "imoveis", imovelB)).status).toBe(404);
    expect((await obter(chave, "imoveis", "nao-e-uuid")).status).toBe(404);
  });

  it("escopo, chave errada, revogada e expirada", async () => {
    const { chave, id } = await novaChave(ADMIN, ["contratos:leitura", "pessoas:leitura"]);
    expect((await listar(chave, "faturas")).status).toBe(403);
    expect((await listar(chave.slice(0, -1) + (chave.endsWith("0") ? "1" : "0"), "contratos")).status).toBe(401);
    expect((await listar("", "contratos")).status).toBe(401);
    const c = await obter(chave, "contratos", contrato);
    expect(c.status).toBe(200);
    expect((c.dados as { partes: unknown[] }).partes).toHaveLength(2);
    // Pessoas sem CPF nem banco.
    const pes = await listar(chave, "pessoas");
    expect(JSON.stringify(pes.dados)).not.toMatch(/52998224725|11144477735|12345/);
    const porDoc = await listar(chave, "pessoas", { documento: "111.444.777-35" });
    expect((porDoc.dados as { nome: string }[]).map((x) => x.nome)).toEqual(["Luís"]);
    // Revogada não volta.
    await comoUsuario(db, ADMIN, () => db.query(`update api_chaves set revogada_em = now() where id = $1`, [id]));
    expect((await listar(chave, "contratos")).status).toBe(401);
    await comoUsuario(db, ADMIN, () => db.query(`update api_chaves set revogada_em = null where id = $1`, [id]));
    expect((await listar(chave, "contratos")).status).toBe(401);
    const exp = await novaChave(ADMIN, ["contratos:leitura"], { expira: new Date(Date.now() + 60_000).toISOString() });
    expect((await listar(exp.chave, "contratos")).status).toBe(200);
    await db.query(`update api_chaves set expira_em = now() - interval '1 second' where id = $1`, [exp.id]);
    expect((await listar(exp.chave, "contratos")).status).toBe(401);
  });

  it("limite por hora devolve 429 e o uso fica registrado sem a chave", async () => {
    const { chave, id } = await novaChave(ADMIN, ["faturas:leitura"], { limite: 2 });
    expect((await listar(chave, "faturas")).status).toBe(200);
    expect((await listar(chave, "faturas")).status).toBe(200);
    const r = await listar(chave, "faturas");
    expect(r.status).toBe(429);
    expect(r.tentar_em).toBeGreaterThan(0);
    const uso = await todos<{ status: number; ip: string }>(`select status, ip from api_uso where chave_id = $1`, [id]);
    expect(uso.map((u) => u.status)).toEqual([200, 200]);
    expect(uso[0].ip).toBe("1.2.3.4");
    expect(JSON.stringify(await todos(`select * from api_uso`))).not.toContain(chave.slice(14));
    // ultimo_uso não enche o histórico de ações.
    const aud = await todos<{ campos: string[] }>(`select campos from auditoria where tabela = 'api_chaves' and registro_id = $1`, [id]);
    expect(aud.every((a) => !a.campos.includes("ultimo_uso"))).toBe(true);
    expect((await um<{ ultimo_uso: string | null }>(`select ultimo_uso from api_chaves where id = $1`, [id])).ultimo_uso).not.toBeNull();
  });

  it("lead pela API segue a regra da captação; leads não existem no modo pessoal", async () => {
    const soEscrita = await novaChave(ADMIN, ["leads:escrita"]);
    expect((await criarLead(soEscrita.chave, { nome: "" })).status).toBe(422);
    expect((await criarLead(soEscrita.chave, { nome: "Ana" })).status).toBe(422);
    expect((await criarLead(soEscrita.chave, { nome: "Ana", email: "ruim" })).status).toBe(422);
    const r1 = await criarLead(soEscrita.chave, { nome: "Ana API", telefone: "51 99999-1111", imovel: "INT-1", utm_source: "n8n" });
    expect(r1.status).toBe(201);
    expect(r1.dados).toEqual({ ok: true });
    const lead = await um<{ origem: string; utm_source: string; organizacao_id: string }>(`select origem, utm_source, organizacao_id from leads where nome = 'Ana API'`);
    expect(lead).toMatchObject({ origem: "outro", utm_source: "n8n", organizacao_id: org });
    const lerEscrever = await novaChave(ADMIN, ["leads:escrita", "leads:leitura"]);
    const r2 = await criarLead(lerEscrever.chave, { nome: "Ana de novo", telefone: "(51) 99999-1111" });
    expect((r2.dados as { id: string }).id).toBeTruthy();
    expect((await um<{ n: number }>(`select count(*)::int as n from leads where organizacao_id = $1 and telefone like '%1111'`, [org])).n).toBe(1);
    expect((await listar(lerEscrever.chave, "leads")).status).toBe(200);
    // Pessoal: nem cria chave de leads; as outras funcionam.
    expect(await erroDe(() => novaChave(PESSOAL, ["leads:leitura"]))).toMatch(/imobiliária/);
    const pessoal = await novaChave(PESSOAL, ["imoveis:leitura"]);
    expect((await listar(pessoal.chave, "imoveis")).status).toBe(200);
    expect(await erroDe(() => comoUsuario(db, PESSOAL, () => db.query(`update api_chaves set escopos = '{leads:leitura}' where id = $1`, [pessoal.id])))).toMatch(/imobiliária/);
  });
});

describe("webhooks", () => {
  let wh: { id: string; segredo: string };

  it("só o admin cria; URL precisa ser https e pública", async () => {
    const criar = (user: string, url: string, eventos: string[] = ["lead.criado"]) =>
      comoUsuario(db, user, async () => (await um<{ r: { id: string; segredo: string } }>(`select public.webhook_criar('n8n', $1, $2::text[]) as r`, [url, eventos])).r);
    expect(await erroDe(() => criar(GESTOR, "https://exemplo.com.br/hook"))).toMatch(/administrador/);
    for (const ruim of ["http://exemplo.com/h", "https://localhost/h", "https://10.0.0.5/h", "https://[::1]/h", "https://169.254.169.254/latest", "https://servidor/h", "https://u:p@exemplo.com/h", "https://app.local/x"])
      expect(await erroDe(() => criar(ADMIN, ruim)), ruim).toMatch(/inválido/);
    expect(await erroDe(() => criar(ADMIN, "https://exemplo.com.br/h", ["nada.acontece"]))).toMatch(/evento/);
    wh = await criar(ADMIN, "https://n8n.exemplo.com.br/webhook/abc", ["lead.criado", "imovel.atualizado", "fatura.paga", "contrato.encerrado", "pagamento.recebido", "fatura.criada"]);
    expect(wh.segredo).toMatch(/^whsec_[0-9a-f]{48}$/);
    // O segredo não sai do banco: nem o admin lê a tabela, e a linha do webhook não tem o segredo.
    expect(await erroDe(() => comoUsuario(db, ADMIN, () => db.query(`select * from privado.webhook_segredos`)))).toMatch(/permission denied/);
    expect(JSON.stringify(await comoUsuario(db, ADMIN, () => todos(`select * from webhook_assinaturas`)))).not.toContain(wh.segredo);
    expect(await comoUsuario(db, GESTOR, () => todos(`select id from webhook_assinaturas`))).toHaveLength(1);
    expect(await comoUsuario(db, CORRETOR, () => todos(`select id from webhook_assinaturas`))).toHaveLength(0);
    // Pessoal não assina eventos de leads.
    expect(await erroDe(() => criar(PESSOAL, "https://exemplo.com.br/h"))).toMatch(/imobiliária/);
  });

  it("gatilhos põem os eventos na fila (só os assinados; imóvel alterado junta)", async () => {
    await comoUsuario(db, CORRETOR, async () => {
      await db.query(`insert into leads (nome, telefone, origem) values ('Lead Gatilho', '51988887777', 'site')`);
      await db.query(`update imoveis set valor_aluguel = 2100 where id = $1`, [imovel]);
      await db.query(`update imoveis set titulo = 'Casa boa' where id = $1`, [imovel]);
      await db.query(`insert into propostas (imovel_id, valor) values ($1, 1000)`, [imovel]);
    });
    const ent = await todos<{ evento: string; payload: Record<string, unknown> }>(`select evento, payload from webhook_entregas where assinatura_id = $1 order by criado_em`, [wh.id]);
    const leads = ent.filter((e) => e.evento === "lead.criado");
    expect(leads.length).toBeGreaterThanOrEqual(1);
    expect(leads.at(-1)?.payload).toMatchObject({ nome: "Lead Gatilho", origem: "site" });
    expect(JSON.stringify(leads.at(-1)?.payload)).not.toContain("51988887777");
    const imo = ent.filter((e) => e.evento === "imovel.atualizado");
    expect(imo).toHaveLength(1);
    expect(imo[0].payload.campos).toEqual(["titulo", "valor_aluguel"]);
    expect(ent.some((e) => e.evento === "proposta.criada")).toBe(false);
    // Corretor não lê a fila; outra organização também não.
    expect(await comoUsuario(db, CORRETOR, () => todos(`select id from webhook_entregas`))).toHaveLength(0);
    expect(await comoUsuario(db, OUTRO, () => todos(`select id from webhook_entregas`))).toHaveLength(0);
  });

  it("cobrança gerada, paga e contrato encerrado", async () => {
    await comoUsuario(db, ADMIN, async () => {
      const fat = (
        await um<{ id: string }>(`select public.registrar_fatura($1::jsonb) as id`, [
          JSON.stringify({
            contrato_id: contrato,
            competencia: "2026-10-01",
            periodo_inicio: "2026-10-01",
            periodo_fim: "2026-10-31",
            vencimento: "2026-10-10",
            valor_total: 2000,
            itens: [{ descricao: "Aluguel", tipo: "aluguel", valor: 2000, destino: "proprietario" }],
          }),
        ])
      ).id;
      await db.query(`select public.registrar_recebimento($1::jsonb)`, [
        JSON.stringify({ pagamentos: [{ fatura_id: fat, pago_em: "2026-10-09", valor: 500, principal: 500, forma: "pix" }] }),
      ]);
      await db.query(`update faturas set status = 'paga', pago_em = '2026-10-10', valor_pago = 2000 where id = $1`, [fat]);
      await db.query(`update contratos set status = 'encerrado', data_rescisao = '2026-10-31' where id = $1`, [contrato]);
    });
    const ev = (await todos<{ evento: string }>(`select evento from webhook_entregas where assinatura_id = $1`, [wh.id])).map((e) => e.evento);
    expect(ev).toEqual(expect.arrayContaining(["fatura.criada", "pagamento.recebido", "fatura.paga", "contrato.encerrado"]));
  });

  it("entrega: lote assinado no banco, falha com espera crescente, desistência e reprocessamento", async () => {
    await db.query(`update webhook_entregas set status = 'entregue' where assinatura_id = $1`, [wh.id]);
    await comoUsuario(db, ADMIN, () => db.query(`select public.webhook_enviar_teste($1)`, [wh.id]));
    // Admin e gestor disparam (em segundo plano); corretor e outra organização não pegam nada (nem leem a fila por aqui).
    expect(await comoUsuario(db, OUTRO, async () => (await um<{ l: unknown[] }>(`select public.webhook_lote(5) as l`)).l)).toEqual([]);
    expect(await comoUsuario(db, CORRETOR, async () => (await um<{ l: unknown[] }>(`select public.webhook_lote(5) as l`)).l)).toEqual([]);
    const lote = await comoUsuario(db, GESTOR, async () => (await um<{ l: { id: string; url: string; corpo: string; assinatura: string; evento: string }[] }>(`select public.webhook_lote(5) as l`)).l);
    expect(lote).toHaveLength(1);
    const e = lote[0];
    expect(e.evento).toBe("webhook.teste");
    expect(e.url).toBe("https://n8n.exemplo.com.br/webhook/abc");
    expect(e.assinatura).toBe("sha256=" + createHmac("sha256", wh.segredo).update(e.corpo, "utf8").digest("hex"));
    expect(JSON.parse(e.corpo)).toMatchObject({ id: e.id, evento: "webhook.teste", tentativa: 1, organizacao_id: org });
    // Segurada: não sai de novo no lote.
    expect(await comoUsuario(db, GESTOR, async () => (await um<{ l: unknown[] }>(`select public.webhook_lote(5) as l`)).l)).toEqual([]);
    // Corretor não marca resultado.
    expect(await comoUsuario(db, CORRETOR, async () => (await um<{ s: string | null }>(`select public.webhook_resultado($1, 200) as s`, [e.id])).s)).toBeNull();
    // Falhou: nova tentativa em 5 minutos.
    const st = await comoUsuario(db, GESTOR, async () => (await um<{ s: string }>(`select public.webhook_resultado($1, 500, 'erro do servidor', null) as s`, [e.id])).s);
    expect(st).toBe("falhou");
    const f = await um<{ min: number; resposta_trecho: string }>(`select round(extract(epoch from proxima_tentativa - now()) / 60)::int as min, resposta_trecho from webhook_entregas where id = $1`, [e.id]);
    expect(f.min).toBe(5);
    expect(f.resposta_trecho).toBe("erro do servidor");
    // Resultado sem estar segurada é ignorado.
    expect(await comoUsuario(db, GESTOR, async () => (await um<{ s: string | null }>(`select public.webhook_resultado($1, 200) as s`, [e.id])).s)).toBeNull();
    // Até a 6ª tentativa: desiste.
    for (let i = 2; i <= 6; i++) {
      await db.query(`update webhook_entregas set proxima_tentativa = now() - interval '1 second' where id = $1`, [e.id]);
      const l = await comoUsuario(db, GESTOR, async () => (await um<{ l: { id: string }[] }>(`select public.webhook_lote(5) as l`)).l);
      expect(l.map((x) => x.id)).toEqual([e.id]);
      await comoUsuario(db, GESTOR, () => db.query(`select public.webhook_resultado($1, null, null, 'tempo esgotado')`, [e.id]));
    }
    expect((await um<{ status: string; tentativas: number }>(`select status, tentativas from webhook_entregas where id = $1`, [e.id])).status).toBe("desistiu");
    // Reprocessar: só admin.
    expect(await erroDe(() => comoUsuario(db, GESTOR, () => db.query(`select public.webhook_reprocessar($1)`, [e.id])))).toMatch(/permissão/);
    await comoUsuario(db, ADMIN, () => db.query(`select public.webhook_reprocessar($1)`, [e.id]));
    const l2 = await comoUsuario(db, ADMIN, async () => (await um<{ l: { id: string; corpo: string }[] }>(`select public.webhook_lote(5) as l`)).l);
    expect(JSON.parse(l2[0].corpo).tentativa).toBe(1);
    expect(await comoUsuario(db, ADMIN, async () => (await um<{ s: string }>(`select public.webhook_resultado($1, 204) as s`, [e.id])).s)).toBe("entregue");
    const w = await um<{ falhas_seguidas: number; ultimo_status: number }>(`select falhas_seguidas, ultimo_status from webhook_assinaturas where id = $1`, [wh.id]);
    expect(w).toMatchObject({ falhas_seguidas: 0, ultimo_status: 204 });
  });

  it("pausado não recebe eventos; muitas falhas seguidas pausam sozinho; trocar segredo", async () => {
    await comoUsuario(db, ADMIN, () => db.query(`update webhook_assinaturas set ativo = false where id = $1`, [wh.id]));
    const antes = (await um<{ n: number }>(`select count(*)::int as n from webhook_entregas where assinatura_id = $1`, [wh.id])).n;
    await comoUsuario(db, ADMIN, () => db.query(`insert into leads (nome, email) values ('Lead pausado', 'pz@x.com')`));
    expect((await um<{ n: number }>(`select count(*)::int as n from webhook_entregas where assinatura_id = $1`, [wh.id])).n).toBe(antes);
    expect(await erroDe(() => comoUsuario(db, ADMIN, () => db.query(`select public.webhook_enviar_teste($1)`, [wh.id])))).toMatch(/pausado/);
    expect((await um<{ pausada_em: string | null }>(`select pausada_em from webhook_assinaturas where id = $1`, [wh.id])).pausada_em).not.toBeNull();
    // Reativar zera; 50 falhas seguidas pausam sozinho.
    await comoUsuario(db, ADMIN, () => db.query(`update webhook_assinaturas set ativo = true where id = $1`, [wh.id]));
    await db.query(`update webhook_assinaturas set falhas_seguidas = 49 where id = $1`, [wh.id]);
    await comoUsuario(db, ADMIN, () => db.query(`select public.webhook_enviar_teste($1)`, [wh.id]));
    const l = await comoUsuario(db, ADMIN, async () => (await um<{ l: { id: string }[] }>(`select public.webhook_lote(5) as l`)).l);
    await comoUsuario(db, ADMIN, () => db.query(`select public.webhook_resultado($1, 410)`, [l[0].id]));
    const w = await um<{ ativo: boolean; pausada_motivo: string }>(`select ativo, pausada_motivo from webhook_assinaturas where id = $1`, [wh.id]);
    expect(w.ativo).toBe(false);
    expect(w.pausada_motivo).toMatch(/50 falhas/);
    // Trocar segredo: o novo assina as próximas entregas.
    await comoUsuario(db, ADMIN, () => db.query(`update webhook_assinaturas set ativo = true where id = $1`, [wh.id]));
    const novo = await comoUsuario(db, ADMIN, async () => (await um<{ r: { segredo: string } }>(`select public.webhook_trocar_segredo($1) as r`, [wh.id])).r.segredo);
    expect(novo).not.toBe(wh.segredo);
    expect(await erroDe(() => comoUsuario(db, GESTOR, () => db.query(`select public.webhook_trocar_segredo($1)`, [wh.id])))).toMatch(/permissão/);
    await db.query(`update webhook_entregas set status = 'entregue' where assinatura_id = $1 and status <> 'entregue'`, [wh.id]);
    await comoUsuario(db, ADMIN, () => db.query(`select public.webhook_enviar_teste($1)`, [wh.id]));
    const l3 = await comoUsuario(db, ADMIN, async () => (await um<{ l: { corpo: string; assinatura: string }[] }>(`select public.webhook_lote(5) as l`)).l);
    expect(l3[0].assinatura).toBe("sha256=" + createHmac("sha256", novo).update(l3[0].corpo, "utf8").digest("hex"));
  });

  it("disparo de teste pela API e escopo", async () => {
    const { chave } = await novaChave(ADMIN, ["webhooks:escrita"]);
    const r = await comoAnonimo(db, async () => (await um<{ r: Resp }>(`select public.api_v1_webhook_teste($1, '{}'::jsonb) as r`, [chave])).r);
    expect(r).toMatchObject({ status: 202, dados: { enfileiradas: 1 } });
    const r404 = await comoAnonimo(db, async () => (await um<{ r: Resp }>(`select public.api_v1_webhook_teste($1, $2::jsonb) as r`, [chave, JSON.stringify({ assinatura_id: imovelB })])).r);
    expect(r404.status).toBe(404);
    const semEscopo = await novaChave(ADMIN, ["imoveis:leitura"]);
    const r403 = await comoAnonimo(db, async () => (await um<{ r: Resp }>(`select public.api_v1_webhook_teste($1) as r`, [semEscopo.chave])).r);
    expect(r403.status).toBe(403);
  });

  it("monitoramento: admin e gestor; corretor não", async () => {
    const res = await comoUsuario(db, GESTOR, async () => (await um<{ r: { entregas: Record<string, number>; api_total: number } }>(`select public.integracoes_resumo() as r`)).r);
    expect(res.entregas.entregue).toBeGreaterThan(0);
    expect(res.api_total).toBeGreaterThan(0);
    expect(await erroDe(() => comoUsuario(db, CORRETOR, () => db.query(`select public.integracoes_resumo()`)))).toMatch(/administrador e gestor/);
    expect(await comoUsuario(db, GESTOR, async () => (await um<{ r: unknown[] }>(`select public.integracoes_uso_armazenamento() as r`)).r)).toEqual([]);
    expect(await erroDe(() => comoUsuario(db, GESTOR, () => db.query(`select public.integracoes_arquivos('documentos')`)))).toMatch(/administrador/);
  });

  it("sem webhook ativo, nada entra na fila (outra organização)", async () => {
    await comoUsuario(db, OUTRO, () => db.query(`insert into leads (nome, email) values ('Lead B', 'b@x.com')`));
    expect((await um<{ n: number }>(`select count(*)::int as n from webhook_entregas where organizacao_id = $1`, [orgB])).n).toBe(0);
  });
});

describe("de-para contábil e modelos de importação", () => {
  it("admin grava; conta de outra organização é recusada; gestor só lê", async () => {
    const plano = await comoUsuario(db, ADMIN, async () => (await um<{ id: string }>(`insert into plano_contas (codigo, nome, tipo) values ('3.1.1','Taxas','receita') returning id`)).id);
    const planoB = await comoUsuario(db, OUTRO, async () => (await um<{ id: string }>(`insert into plano_contas (codigo, nome, tipo) values ('9','Outra','receita') returning id`)).id);
    await comoUsuario(db, ADMIN, async () => {
      await db.query(`insert into contabil_contas_mapa (origem_tipo, origem_id, conta_contabil) values ('plano', $1, '31101')`, [plano]);
      await db.query(`insert into contabil_contas_mapa (origem_tipo, origem_texto, conta_contabil) values ('padrao', 'banco', '11201')`);
    });
    expect(await erroDe(() => comoUsuario(db, ADMIN, () => db.query(`insert into contabil_contas_mapa (origem_tipo, origem_id, conta_contabil) values ('plano', $1, '1')`, [planoB])))).toMatch(/não encontrada/);
    expect(await erroDe(() => comoUsuario(db, ADMIN, () => db.query(`insert into contabil_contas_mapa (origem_tipo, origem_texto, conta_contabil) values ('padrao', 'qualquer', '1')`)))).toMatch(/check/);
    expect(await erroDe(() => comoUsuario(db, ADMIN, () => db.query(`insert into contabil_contas_mapa (origem_tipo, origem_texto, conta_contabil) values ('padrao', 'BANCO ', '2')`)))).toMatch(/duplicate|unique/);
    expect(await comoUsuario(db, GESTOR, () => todos(`select id from contabil_contas_mapa`))).toHaveLength(2);
    expect(await erroDe(() => comoUsuario(db, GESTOR, () => db.query(`insert into contabil_contas_mapa (origem_tipo, origem_texto, conta_contabil) values ('categoria', 'Aluguel', '3')`)))).toMatch(/row-level security/);
    await comoUsuario(db, ADMIN, () => db.query(`insert into importacao_modelos (nome, mapa) values ('ERP antigo', '{"Cod Imovel":"imovel_codigo"}')`));
    expect(await comoUsuario(db, CORRETOR, () => todos(`select id from importacao_modelos`))).toHaveLength(0);
  });
});

describe("conta que muda de modo, fila sem fim e entrega pelo id", () => {
  let orgM: string;
  let whM: { id: string };
  let chaveM: { id: string; chave: string };

  it("imobiliária com webhook e chave de leads passa para o modo pessoal: nada trava", async () => {
    orgM = await comoUsuario(db, MUDA, async () => (await um<{ id: string }>(`select public.criar_organizacao('Imob que muda') as id`)).id);
    whM = await comoUsuario(db, MUDA, async () =>
      (await um<{ r: { id: string } }>(`select public.webhook_criar('n8n', 'https://hooks.exemplo.com.br/muda', $1::text[]) as r`, [["lead.criado", "imovel.criado"]])).r,
    );
    chaveM = await novaChave(MUDA, ["imoveis:leitura", "leads:leitura"]);
    await comoUsuario(db, MUDA, () => db.query(`update organizacoes set modo = 'pessoal' where id = $1`, [orgM]));
    // O evento dos outros recursos continua: entrega registrada com o placar do webhook.
    await comoUsuario(db, MUDA, () => db.query(`insert into imoveis (codigo, cidade) values ('M-1', 'Canoas')`));
    const l = await comoUsuario(db, MUDA, async () => (await um<{ l: { id: string; evento: string }[] }>(`select public.webhook_lote(5) as l`)).l);
    expect(l.map((e) => e.evento)).toEqual(["imovel.criado"]);
    expect(await comoUsuario(db, MUDA, async () => (await um<{ s: string }>(`select public.webhook_resultado($1, 200) as s`, [l[0].id])).s)).toBe("entregue");
    expect((await um<{ ultimo_status: number }>(`select ultimo_status from webhook_assinaturas where id = $1`, [whM.id])).ultimo_status).toBe(200);
    // Falha também fica registrada (e não volta a sair na hora).
    await comoUsuario(db, MUDA, () => db.query(`insert into imoveis (codigo, cidade) values ('M-2', 'Canoas')`));
    const l2 = await comoUsuario(db, MUDA, async () => (await um<{ l: { id: string }[] }>(`select public.webhook_lote(5) as l`)).l);
    expect(await comoUsuario(db, MUDA, async () => (await um<{ s: string }>(`select public.webhook_resultado($1, 500) as s`, [l2[0].id])).s)).toBe("falhou");
    expect((await um<{ falhas_seguidas: number }>(`select falhas_seguidas from webhook_assinaturas where id = $1`, [whM.id])).falhas_seguidas).toBe(1);
    // Pausar, renomear e reativar funcionam; acrescentar evento de leads/propostas, não.
    await comoUsuario(db, MUDA, () => db.query(`update webhook_assinaturas set ativo = false where id = $1`, [whM.id]));
    await comoUsuario(db, MUDA, () => db.query(`update webhook_assinaturas set ativo = true, nome = 'n8n novo' where id = $1`, [whM.id]));
    expect((await um<{ ativo: boolean; nome: string }>(`select ativo, nome from webhook_assinaturas where id = $1`, [whM.id]))).toMatchObject({ ativo: true, nome: "n8n novo" });
    expect(
      await erroDe(() => comoUsuario(db, MUDA, () => db.query(`update webhook_assinaturas set eventos = '{lead.criado,imovel.criado,proposta.criada}' where id = $1`, [whM.id]))),
    ).toMatch(/imobiliária/);
    // A chave antiga segue lendo imóveis (e marca o último uso); leads, não; revogar funciona.
    expect((await listar(chaveM.chave, "imoveis")).status).toBe(200);
    expect((await um<{ ultimo_uso: string | null }>(`select ultimo_uso from api_chaves where id = $1`, [chaveM.id])).ultimo_uso).not.toBeNull();
    expect((await listar(chaveM.chave, "leads")).status).toBe(403);
    await comoUsuario(db, MUDA, () => db.query(`update api_chaves set nome = 'renomeada' where id = $1`, [chaveM.id]));
    expect(await erroDe(() => comoUsuario(db, MUDA, () => db.query(`update api_chaves set escopos = '{imoveis:leitura,leads:escrita}' where id = $1`, [chaveM.id])))).toMatch(/imobiliária/);
    await comoUsuario(db, MUDA, () => db.query(`update api_chaves set revogada_em = now() where id = $1`, [chaveM.id]));
    expect((await listar(chaveM.chave, "imoveis")).status).toBe(401);
  });

  it("6 tentativas sem resultado gravado: o lote desiste em vez de mandar de novo para sempre", async () => {
    await db.query(`update webhook_entregas set status = 'entregue' where assinatura_id = $1 and status <> 'entregue'`, [whM.id]);
    const id = await comoUsuario(db, MUDA, async () => (await um<{ id: string }>(`select public.webhook_enviar_teste($1) as id`, [whM.id])).id);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    await db.query(
      `update webhook_entregas set tentativas = 6, travada_ate = now() - interval '1 second', proxima_tentativa = now() - interval '1 second' where id = $1`,
      [id],
    );
    expect(await comoUsuario(db, MUDA, async () => (await um<{ l: unknown[] }>(`select public.webhook_lote(5) as l`)).l)).toEqual([]);
    expect((await um<{ status: string; erro: string }>(`select status, erro from webhook_entregas where id = $1`, [id]))).toMatchObject({ status: "desistiu" });
  });

  it("teste e reprocessamento entregam a própria entrega, mesmo com fila antiga", async () => {
    await comoUsuario(db, MUDA, async () => {
      await db.query(`insert into imoveis (codigo, cidade) values ('M-3', 'Canoas'), ('M-4', 'Canoas')`);
    });
    const id = await comoUsuario(db, MUDA, async () => (await um<{ id: string }>(`select public.webhook_enviar_teste($1) as id`, [whM.id])).id);
    const l = await comoUsuario(db, MUDA, async () => (await um<{ l: { id: string; evento: string }[] }>(`select public.webhook_lote(1, $1) as l`, [id])).l);
    expect(l.map((e) => e.id)).toEqual([id]);
    expect(l[0].evento).toBe("webhook.teste");
    // As antigas continuam na fila, sem trava.
    const fila = await todos<{ n: number }>(`select count(*)::int as n from webhook_entregas where assinatura_id = $1 and status = 'pendente' and travada_ate is null and evento = 'imovel.criado'`, [whM.id]);
    expect(fila[0].n).toBe(2);
    // Outra organização não pega a entrega pelo id.
    expect(await comoUsuario(db, OUTRO, async () => (await um<{ l: unknown[] }>(`select public.webhook_lote(1, $1) as l`, [id])).l)).toEqual([]);
  });
});

describe("lead pela API não vaza erro interno do banco", () => {
  it("erro desconhecido vira mensagem genérica", async () => {
    const { chave } = await novaChave(ADMIN, ["leads:escrita"]);
    await db.exec(`
      create or replace function public._teste_explode() returns trigger language plpgsql as $f$
      begin
        if new.nome = 'Explode' then raise exception 'coluna_secreta_xyz viola a restrição interna'; end if;
        return new;
      end $f$;
      create trigger _teste_explode_trg before insert on public.leads for each row execute function public._teste_explode();
    `);
    try {
      const r = await criarLead(chave, { nome: "Explode", email: "explode@x.com" });
      expect(r.status).toBe(422);
      expect(r.erro?.mensagem).toBe("Não foi possível registrar o lead.");
      expect(JSON.stringify(r)).not.toContain("coluna_secreta");
    } finally {
      await db.exec(`drop trigger if exists _teste_explode_trg on public.leads; drop function if exists public._teste_explode();`);
    }
    // As mensagens conhecidas continuam claras.
    expect((await criarLead(chave, { nome: "Sem contato" })).erro?.mensagem).toBe("Informe telefone ou e-mail.");
  });
});

describe("perfil de acesso do gestor", () => {
  it("gestor cujo perfil não vê Configurações não vê as integrações (até haver módulo próprio)", async () => {
    const perfil = (
      await um<{ id: string }>(`insert into perfis_acesso (organizacao_id, nome, papel_base, permissoes) values ($1, 'Gestor sem config', 'gestor', '{"painel":["ver"]}') returning id`, [org])
    ).id;
    await db.query(`update membros set perfil_id = $1 where organizacao_id = $2 and user_id = $3`, [perfil, org, GESTOR]);
    try {
      expect(await comoUsuario(db, GESTOR, () => todos(`select id from integracoes_config`))).toHaveLength(0);
      expect(await comoUsuario(db, GESTOR, () => todos(`select id from webhook_assinaturas`))).toHaveLength(0);
      expect(await comoUsuario(db, GESTOR, async () => (await um<{ l: unknown[] }>(`select public.webhook_lote(5) as l`)).l)).toEqual([]);
      expect(await erroDe(() => comoUsuario(db, GESTOR, () => db.query(`select public.integracoes_resumo()`)))).toMatch(/administrador e gestor/);
    } finally {
      await db.query(`update membros set perfil_id = null where organizacao_id = $1 and user_id = $2`, [org, GESTOR]);
    }
    expect(await comoUsuario(db, GESTOR, () => todos(`select id from integracoes_config`))).toHaveLength(1);
  });
});

describe("exportação contábil: pessoa do lançamento", () => {
  it("lancamentos tem duas ligações com pessoas: toda consulta da tela diz qual usar", () => {
    // Sem o nome da chave, o PostgREST recusa a consulta (PGRST201) e a tela quebra.
    const arquivos: string[] = [];
    const andar = (dir: string) => {
      for (const n of readdirSync(dir)) {
        const c = join(dir, n);
        if (statSync(c).isDirectory()) andar(c);
        else if (/\.(ts|tsx)$/.test(n)) arquivos.push(c);
      }
    };
    andar(join(process.cwd(), "src"));
    const ruins: string[] = [];
    for (const f of arquivos) {
      const txt = readFileSync(f, "utf8");
      for (const m of txt.matchAll(/from\("lancamentos"\)\s*\.select\(\s*(["'`])([\s\S]*?)\1/g)) if (/pessoas\(/.test(m[2])) ruins.push(f);
    }
    expect(ruins).toEqual([]);
  });

  it("as duas chaves estrangeiras existem com os nomes usados no app", async () => {
    const fks = await todos<{ conname: string }>(
      `select conname from pg_constraint where conrelid = 'public.lancamentos'::regclass and confrelid = 'public.pessoas'::regclass and contype = 'f' order by 1`,
    );
    expect(fks.map((f) => f.conname)).toEqual(["lancamentos_descontar_de_id_fkey", "lancamentos_pessoa_id_fkey"]);
  });
});

// Por último: cria um storage.objects de mentira (o PGlite não tem o Storage do Supabase).
describe("armazenamento: pasta da conta e documentos da ficha online", () => {
  it("conta e exporta também o que o candidato mandou pela ficha (ficha/<token>/)", async () => {
    const { tokenA, tokenB } = await comoUsuario(db, ADMIN, async () => {
      const p = (await um<{ id: string }>(`insert into pessoas (nome) values ('Candidato Ficha') returning id`)).id;
      return { tokenA: (await um<{ token: string }>(`insert into analises (candidato_id) values ($1) returning token`, [p])).token, tokenB: "" };
    }).then(async (r) => ({
      ...r,
      tokenB: await comoUsuario(db, OUTRO, async () => {
        const p = (await um<{ id: string }>(`insert into pessoas (nome) values ('Cand B') returning id`)).id;
        return (await um<{ token: string }>(`insert into analises (candidato_id) values ($1) returning token`, [p])).token;
      }),
    }));
    await db.exec(`
      create schema if not exists storage;
      create table if not exists storage.objects (
        id uuid primary key default gen_random_uuid(), bucket_id text, name text, metadata jsonb, created_at timestamptz default now()
      );
    `);
    await db.query(
      `insert into storage.objects (bucket_id, name, metadata, created_at) values
         ('documentos', $1, '{"size": 100}', now()),
         ('analises', $2, '{"size": 50}', now() + interval '1 second'),
         ('analises', $3, '{"size": 70}', now() + interval '1 second'),
         ('documentos', $4, '{"size": 900}', now()),
         ('analises', $5, '{"size": 30}', '2000-01-01')`,
      [`${org}/arquivos/a.pdf`, `ficha/${tokenA}/b.pdf`, `ficha/${tokenB}/c.pdf`, `${orgB}/arquivos/d.pdf`, `ficha/${tokenA}/antes-do-link.pdf`],
    );
    const uso = await comoUsuario(db, GESTOR, async () => (await um<{ r: { bucket: string; arquivos: number; bytes: number }[] }>(`select public.integracoes_uso_armazenamento() as r`)).r);
    const porBucket = Object.fromEntries(uso.map((b) => [b.bucket, { arquivos: Number(b.arquivos), bytes: Number(b.bytes) }]));
    expect(porBucket).toEqual({ documentos: { arquivos: 1, bytes: 100 }, analises: { arquivos: 1, bytes: 50 } });
    const lista = await comoUsuario(db, ADMIN, async () => (await um<{ r: { nome: string; bytes: number }[] }>(`select public.integracoes_arquivos('analises') as r`)).r);
    expect(lista.map((a) => a.nome)).toEqual([`ficha/${tokenA}/b.pdf`]);
    const daOutra = await comoUsuario(db, OUTRO, async () => (await um<{ r: { nome: string }[] }>(`select public.integracoes_arquivos('analises') as r`)).r);
    expect(daOutra.map((a) => a.nome)).toEqual([`ficha/${tokenB}/c.pdf`]);
  });
});
