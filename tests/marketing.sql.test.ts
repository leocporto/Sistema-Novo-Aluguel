/**
 * Marketing no banco (PGlite): fila que respeita descadastro e LGPD, histórico
 * no CRM, eventos de imóvel para as automações, regras da configuração,
 * isolamento por organização e as rotas públicas por token (landing page,
 * preferências, pesquisa, webhook do WhatsApp e Lead Ads).
 */
import { createHmac } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { lerWebhookWhatsapp } from "@/lib/dominio/marketing";
import { comoAnonimo, comoUsuario, criarBanco } from "./pglite";

const ADMIN = "00000000-0000-0000-0000-000000017a01";
const CORRETOR = "00000000-0000-0000-0000-000000017a02";
const OUTRO = "00000000-0000-0000-0000-000000017b01";
const PESSOAL = "00000000-0000-0000-0000-000000017c01";

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

beforeAll(async () => {
  db = await criarBanco();
  org = await comoUsuario(db, ADMIN, async () => (await um<{ id: string }>(`select public.criar_organizacao('Imob Mkt') as id`)).id);
  await db.query(`insert into membros (organizacao_id, user_id, papel) values ($1, $2, 'corretor')`, [org, CORRETOR]);
  orgB = await comoUsuario(db, OUTRO, async () => (await um<{ id: string }>(`select public.criar_organizacao('Outra Imob') as id`)).id);
  orgP = await comoUsuario(db, PESSOAL, async () => (await um<{ id: string }>(`select public.criar_organizacao('Meus Imóveis') as id`)).id);
  await comoUsuario(db, PESSOAL, () => db.query(`update organizacoes set modo = 'pessoal' where id = $1`, [orgP]));
});

describe("fila de envio", () => {
  it("sem destino falha, descadastrado fica bloqueado e nunca vira enviado; enviado entra no histórico do CRM", async () => {
    const r = await comoUsuario(db, ADMIN, async () => {
      const p = (await um<{ id: string }>(`insert into pessoas (nome, telefone, email) values ('Paula', '(13) 99999-0001', 'paula@x.com') returning id`)).id;
      const l = (await um<{ id: string }>(`insert into leads (nome, telefone) values ('Lucas', '13999990002') returning id`)).id;
      const camp = (await um<{ id: string }>(`insert into mkt_campanhas (nome, mensagem) values ('Teste', 'Oi') returning id`)).id;
      const ins = (chave: string, extra: string, vals: unknown[]) =>
        um<{ id: string; status: string; motivo: string | null }>(
          `insert into mkt_envios (chave, campanha_id, mensagem, ${extra}) values ($1, $2, 'Oi', ${vals.map((_, i) => `$${i + 3}`).join(", ")}) returning id, status, motivo`,
          [chave, camp, ...vals],
        );
      const semTel = await ins("a", "lead_id, telefone", [l, null]);
      const semEmail = await ins("b", "lead_id, canal, email", [l, "email", "invalido"]);
      // Descadastro só do WhatsApp, pelo telefone (com outra formatação)
      await db.query(`insert into mkt_descadastros (telefone, canal) values ('+55 13 99999-0001', 'whatsapp')`);
      const bloq = await ins("c", "pessoa_id, telefone", [p, "13999990001"]);
      const porEmail = await ins("d", "pessoa_id, canal, email", [p, "email", "paula@x.com"]);
      const lead = await ins("e", "lead_id, telefone", [l, "13999990002"]);
      const repetido = await erroDe(() => ins("e", "lead_id, telefone", [l, "13999990002"]));
      const marcarBloq = await erroDe(() => db.query(`update mkt_envios set status = 'enviado' where id = $1`, [bloq.id]));
      await db.query(`update mkt_envios set status = 'enviado' where id = $1`, [lead.id]);
      await db.query(`update mkt_envios set status = 'enviado' where id = $1`, [porEmail.id]);
      const enviado = await um<{ enviado_em: string | null; enviado_por: string }>(`select enviado_em, enviado_por from mkt_envios where id = $1`, [lead.id]);
      const ev = await todos<{ tipo: string; descricao: string }>(`select tipo, descricao from lead_eventos where lead_id = $1`, [l]);
      const inter = await todos<{ tipo: string }>(`select tipo from pessoa_interacoes where pessoa_id = $1`, [p]);
      const ult = await um<{ ultimo_contato: string | null }>(`select ultimo_contato from leads where id = $1`, [l]);
      // Desfazer volta para a fila e limpa a data
      await db.query(`update mkt_envios set status = 'pendente' where id = $1`, [lead.id]);
      const voltou = await um<{ enviado_em: string | null }>(`select enviado_em from mkt_envios where id = $1`, [lead.id]);
      return { semTel, semEmail, bloq, porEmail, repetido, marcarBloq, enviado, ev, inter, ult, voltou };
    });
    expect(r.semTel).toMatchObject({ status: "falhou", motivo: "Sem telefone" });
    expect(r.semEmail).toMatchObject({ status: "falhou", motivo: "Sem e-mail" });
    expect(r.bloq.status).toBe("bloqueado");
    expect(r.porEmail.status).toBe("pendente");
    expect(r.repetido).toContain("duplicate key");
    expect(r.marcarBloq).toContain("pediu para não receber");
    expect(r.enviado.enviado_por).toBe(ADMIN);
    expect(r.enviado.enviado_em).not.toBeNull();
    expect(r.ev).toEqual([{ tipo: "whatsapp", descricao: 'WhatsApp enviado (campanha "Teste"): Oi' }]);
    expect(r.inter).toEqual([{ tipo: "email" }]);
    expect(r.ult.ultimo_contato).not.toBeNull();
    expect(r.voltou.enviado_em).toBeNull();
  });

  it("autorização retirada na aba Comunicação bloqueia oferta, mas não pesquisa/pós-venda", async () => {
    const r = await comoUsuario(db, ADMIN, async () => {
      const p = (await um<{ id: string }>(`insert into pessoas (nome, telefone) values ('Rosa', '13988880003') returning id`)).id;
      await db.query(`insert into pessoa_consentimentos (pessoa_id, canal, concedido, em) values ($1, 'marketing', true, now() - interval '2 days'), ($1, 'marketing', false, now())`, [p]);
      const oferta = await um<{ status: string }>(`insert into mkt_envios (chave, pessoa_id, telefone, mensagem) values ('r1', $1, '13988880003', 'Oferta') returning status`, [p]);
      const relac = await um<{ status: string }>(`insert into mkt_envios (chave, pessoa_id, telefone, mensagem, finalidade) values ('r2', $1, '13988880003', 'Pesquisa', 'relacionamento') returning status`, [p]);
      await db.query(`insert into pessoa_consentimentos (pessoa_id, canal, concedido) values ($1, 'whatsapp', false)`, [p]);
      const relac2 = await um<{ status: string }>(`insert into mkt_envios (chave, pessoa_id, telefone, mensagem, finalidade) values ('r3', $1, '13988880003', 'Pesquisa', 'relacionamento') returning status`, [p]);
      return { oferta: oferta.status, relac: relac.status, relac2: relac2.status };
    });
    expect(r).toEqual({ oferta: "bloqueado", relac: "pendente", relac2: "bloqueado" });
  });

  it("outra organização não vê campanhas, fila, conversas nem descadastros", async () => {
    const r = await comoUsuario(db, OUTRO, async () => ({
      camp: (await todos(`select id from mkt_campanhas`)).length,
      envios: (await todos(`select id from mkt_envios`)).length,
      desc: (await todos(`select id from mkt_descadastros`)).length,
      inserirNaOutra: await erroDe(() => db.query(`insert into mkt_modelos (organizacao_id, nome, corpo) values ($1, 'x', 'y')`, [org])),
    }));
    expect(r.camp).toBe(0);
    expect(r.envios).toBe(0);
    expect(r.desc).toBe(0);
    expect(r.inserirNaOutra).toContain("row-level security");
  });
});

describe("eventos de imóvel para as automações", () => {
  it("imóvel disponível e preço que baixa viram eventos; no modo pessoal não", async () => {
    const r = await comoUsuario(db, ADMIN, async () => {
      const i = (await um<{ id: string }>(`insert into imoveis (codigo, valor_aluguel) values ('MKT-1', 3000) returning id`)).id;
      await db.query(`update imoveis set valor_aluguel = 2700 where id = $1`, [i]);
      await db.query(`update imoveis set valor_aluguel = 2900 where id = $1`, [i]); // subiu: não
      await db.query(`update imoveis set status = 'alugado' where id = $1`, [i]);
      await db.query(`update imoveis set status = 'disponivel' where id = $1`, [i]); // ainda há evento pendente: não repete
      return todos<{ tipo: string; valor_anterior: string | null; valor_novo: string | null }>(`select tipo, valor_anterior, valor_novo from mkt_eventos where imovel_id = $1 order by criado_em`, [i]);
    });
    expect(r.map((e) => e.tipo)).toEqual(["novo_imovel", "reducao_preco"]);
    expect(Number(r[1].valor_anterior)).toBe(3000);
    expect(Number(r[1].valor_novo)).toBe(2700);
    const pessoal = await comoUsuario(db, PESSOAL, async () => {
      await db.query(`insert into imoveis (codigo, valor_aluguel) values ('P-1', 1000)`);
      return (await todos(`select id from mkt_eventos`)).length;
    });
    expect(pessoal).toBe(0);
  });
});

describe("configuração", () => {
  it("tokens e integrações só para admin/gestor; o resto da equipe lê sem tokens e marca o relógio das automações", async () => {
    const cfg = await comoUsuario(db, ADMIN, async () => um<{ id: string; webhook_token: string }>(`insert into mkt_config default values returning id, webhook_token`));
    const r = await comoUsuario(db, CORRETOR, async () => ({
      ler: (await todos(`select webhook_token, google_lead_key from mkt_config`)).length,
      token: (await db.query(`update mkt_config set whatsapp_verify_token = 'x' where id = $1`, [cfg.id])).affectedRows,
      pixel: (await db.query(`update mkt_config set meta_pixel_id = '123456789' where id = $1`, [cfg.id])).affectedRows,
      cfg: (await um<{ r: Record<string, unknown> }>(`select public.mkt_config_ler() as r`)).r,
      vez1: (await um<{ r: boolean }>(`select public.mkt_automacoes_vez(10) as r`)).r,
      vez2: (await um<{ r: boolean }>(`select public.mkt_automacoes_vez(10) as r`)).r,
      forcar: (await um<{ r: boolean }>(`select public.mkt_automacoes_vez(0) as r`)).r,
    }));
    expect(r.ler).toBe(0);
    expect(r.token).toBe(0);
    expect(r.pixel).toBe(0);
    expect(r.cfg.id).toBe(cfg.id);
    expect(r.cfg).not.toHaveProperty("webhook_token");
    expect(r.cfg).not.toHaveProperty("google_lead_key");
    expect(r.cfg).not.toHaveProperty("whatsapp_verify_token");
    expect(r.cfg).not.toHaveProperty("whatsapp_app_secret");
    expect(r.cfg.whatsapp_assinatura).toBe(false);
    expect([r.vez1, r.vez2, r.forcar]).toEqual([true, false, true]);
    const admin = await comoUsuario(db, ADMIN, async () => {
      await db.query(`update mkt_config set meta_pixel_id = '123456789', whatsapp_numero = '13999990000' where id = $1`, [cfg.id]);
      return (await um<{ r: Record<string, unknown> }>(`select public.mkt_config_ler() as r`)).r;
    });
    expect(admin.webhook_token).toBe(cfg.webhook_token);
    expect(admin.meta_pixel_id).toBe("123456789");
    expect(admin).not.toHaveProperty("whatsapp_app_secret");
  });
});

describe("rotas públicas por token", () => {
  it("landing page: dados públicos, visita, lead com UTM/gclid/fbclid e campanha; fora do ar ou modo pessoal não abre", async () => {
    await comoUsuario(db, ADMIN, async () => {
      const i = (await um<{ id: string }>(`insert into imoveis (codigo, tipo, bairro, valor_aluguel) values ('LP-1', 'casa', 'Centro', 2000) returning id`)).id;
      await db.query(`insert into mkt_landing_pages (slug, titulo, imovel_id, utm_campaign) values ('casa-centro', 'Casa no Centro', $1, 'padrao-lp')`, [i]);
      await db.query(`insert into mkt_landing_pages (slug, titulo, publicada) values ('fora', 'Fora do ar', false)`);
      await db.query(`insert into mkt_campanhas (nome, utm_campaign) values ('Black Friday', 'black-friday')`);
    });
    await comoUsuario(db, PESSOAL, () => db.query(`insert into mkt_landing_pages (slug, titulo) values ('pessoal', 'Pessoal')`));
    const r = await comoAnonimo(db, async () => {
      const info = (await um<{ r: { titulo: string; imobiliaria: string; meta_pixel_id: string; imovel: { codigo: string; valor_aluguel: number } } }>(`select public.info_landing('casa-centro', true) as r`)).r;
      const fora = (await um<{ r: unknown }>(`select public.info_landing('fora') as r`)).r;
      const pessoal = (await um<{ r: unknown }>(`select public.info_landing('pessoal') as r`)).r;
      const l1 = (await um<{ r: unknown }>(`select public.receber_lead_landing('casa-centro', $1) as r`, [
        JSON.stringify({ nome: "Vera", telefone: "11955554444", origem: "facebook", utm_source: "facebook", utm_medium: "cpc", utm_campaign: "black-friday", fbclid: "FB1" }),
      ])).r;
      const l2 = (await um<{ r: unknown }>(`select public.receber_lead_landing('casa-centro', $1) as r`, [
        JSON.stringify({ nome: "Vera", telefone: "(11) 95555-4444", utm_source: "google", gclid: "G1" }),
      ])).r;
      const l3 = (await um<{ r: unknown }>(`select public.receber_lead_landing('casa-centro', $1) as r`, [JSON.stringify({ nome: "Ivo", email: "ivo@x.com" })])).r;
      const erroFora = await erroDe(() => db.query(`select public.receber_lead_landing('fora', '{"nome":"x","email":"a@a"}')`));
      const lerTabela = await erroDe(() => db.query(`select * from mkt_landing_pages`));
      return { info, fora, pessoal, l1, l2, l3, erroFora, lerTabela };
    });
    expect(r.info).toMatchObject({ titulo: "Casa no Centro", imobiliaria: "Imob Mkt", meta_pixel_id: "123456789", imovel: { codigo: "LP-1" } });
    expect(r.fora).toBeNull();
    expect(r.pessoal).toBeNull();
    // A resposta é a mesma para contato novo ou repetido (não revela quem já é cliente nem o id).
    expect(r.l1).toEqual({ ok: true });
    expect(r.l2).toEqual({ ok: true });
    expect(r.l3).toEqual({ ok: true });
    expect(r.erroFora).toContain("Página não encontrada");
    expect(r.lerTabela).toContain("permission denied");
    const v = await comoUsuario(db, ADMIN, async () => ({
      vera: (await todos(`select id from leads where telefone = '11955554444'`)).length,
      lead: await um<Record<string, string | null>>(
        `select l.origem, l.utm_source, l.utm_medium, l.utm_campaign, l.fbclid, l.gclid, l.funil, lp.slug, c.nome as campanha
           from leads l join mkt_landing_pages lp on lp.id = l.landing_id left join mkt_campanhas c on c.id = l.campanha_id where l.telefone = '11955554444'`,
      ),
      semUtm: await um<{ utm_campaign: string | null }>(`select utm_campaign from leads where email = 'ivo@x.com'`),
      lp: await um<{ visitas: number; leads: number }>(`select visitas, leads from mkt_landing_pages where slug = 'casa-centro'`),
      imovel: (await todos(`select 1 from lead_imoveis li join imoveis i on i.id = li.imovel_id join leads l on l.id = li.lead_id where l.telefone = '11955554444' and i.codigo = 'LP-1'`)).length,
    }));
    expect(v.vera).toBe(1);
    // Primeiro toque fica (o segundo envio veio do Google, mas a origem é Facebook)
    expect(v.lead).toEqual({ origem: "facebook", utm_source: "facebook", utm_medium: "cpc", utm_campaign: "black-friday", fbclid: "FB1", gclid: "G1", funil: "locacao", slug: "casa-centro", campanha: "Black Friday" });
    expect(v.semUtm.utm_campaign).toBe("padrao-lp");
    expect(v.lp).toEqual({ visitas: 1, leads: 3 });
    expect(v.imovel).toBe(1);
  });

  it("landing page de quem quer anunciar vira captação (sem UTM no lead)", async () => {
    await comoUsuario(db, ADMIN, () => db.query(`insert into mkt_landing_pages (slug, titulo, funil) values ('anuncie', 'Anuncie seu imóvel', 'captacao')`));
    const r = await comoAnonimo(db, async () => (await um<{ r: unknown }>(`select public.receber_lead_landing('anuncie', $1) as r`, [JSON.stringify({ nome: "Seu Jorge", telefone: "11922221111", utm_source: "instagram" })])).r);
    expect(r).toEqual({ ok: true });
    const v = await comoUsuario(db, ADMIN, async () => ({
      cap: await um<{ proprietario_nome: string }>(`select proprietario_nome from captacoes where proprietario_telefone = '11922221111'`),
      lp: await um<{ leads: number }>(`select leads from mkt_landing_pages where slug = 'anuncie'`),
    }));
    expect(v).toEqual({ cap: { proprietario_nome: "Seu Jorge" }, lp: { leads: 1 } });
  });

  it("preferências pelo link: descadastra, grava na aba Comunicação e no registro, bloqueia a fila", async () => {
    const { token, pessoa, envio } = await comoUsuario(db, ADMIN, async () => {
      const p = await um<{ id: string; preferencias_token: string }>(
        `insert into pessoas (nome, telefone, email, aceita_whatsapp, aceita_email) values ('Gil', '13977770005', 'gil@x.com', true, true) returning id, preferencias_token`,
      );
      const e = await um<{ id: string }>(`insert into mkt_envios (chave, pessoa_id, telefone, mensagem) values ('g1', $1, '13977770005', 'Oferta') returning id`, [p.id]);
      return { token: p.preferencias_token, pessoa: p.id, envio: e.id };
    });
    const r = await comoAnonimo(db, async () => {
      const antes = (await um<{ r: Record<string, unknown> }>(`select public.info_preferencias($1) as r`, [token])).r;
      await db.query(`select public.salvar_preferencias($1, $2)`, [token, JSON.stringify({ whatsapp: false, email: true, sms: false, ofertas: true })]);
      const depois = (await um<{ r: Record<string, unknown> }>(`select public.info_preferencias($1) as r`, [token])).r;
      const invalido = await erroDe(() => db.query(`select public.salvar_preferencias(gen_random_uuid(), '{}')`));
      const nulo = (await um<{ r: unknown }>(`select public.info_preferencias(gen_random_uuid()) as r`)).r;
      return { antes, depois, invalido, nulo };
    });
    expect(r.antes).toMatchObject({ imobiliaria: "Imob Mkt", nome: "Gil", whatsapp: true, email: true, ofertas: true });
    expect(r.depois).toMatchObject({ whatsapp: false, email: true, sms: false, ofertas: true });
    expect(r.invalido).toContain("Link inválido");
    expect(r.nulo).toBeNull();
    const v = await comoUsuario(db, ADMIN, async () => ({
      pessoa: await um<{ aceita_whatsapp: boolean; aceita_email: boolean; consentimento_origem: string }>(`select aceita_whatsapp, aceita_email, consentimento_origem from pessoas where id = $1`, [pessoa]),
      consent: await todos<{ canal: string; concedido: boolean }>(`select canal, concedido from pessoa_consentimentos where pessoa_id = $1 order by canal`, [pessoa]),
      desc: await todos<{ canal: string; origem: string }>(`select canal, origem from mkt_descadastros where pessoa_id = $1 order by canal`, [pessoa]),
      log: await todos<{ canal: string; concedido: boolean }>(`select canal, concedido from mkt_preferencias_log where pessoa_id = $1 order by canal`, [pessoa]),
      envio: await um<{ status: string }>(`select status from mkt_envios where id = $1`, [envio]),
      apagaLog: (await db.query(`delete from mkt_preferencias_log where pessoa_id = $1`, [pessoa])).affectedRows,
      mudaLog: (await db.query(`update mkt_preferencias_log set concedido = true where pessoa_id = $1`, [pessoa])).affectedRows,
    }));
    expect(v.pessoa).toEqual({ aceita_whatsapp: false, aceita_email: true, consentimento_origem: "Página de preferências (pela própria pessoa)" });
    // Aba Comunicação e registro: só o que mudou em relação ao que a pessoa viu (WhatsApp e SMS
    // desmarcados). Ofertas já aparecia marcada e continuou: não vira autorização nova.
    expect(v.consent).toEqual([
      { canal: "sms", concedido: false },
      { canal: "whatsapp", concedido: false },
    ]);
    expect(v.desc).toEqual([
      { canal: "sms", origem: "link" },
      { canal: "whatsapp", origem: "link" },
    ]);
    expect(v.log).toEqual([
      { canal: "sms", concedido: false },
      { canal: "whatsapp", concedido: false },
    ]);
    expect(v.envio.status).toBe("bloqueado");
    expect(v.apagaLog).toBe(0);
    expect(v.mudaLog).toBe(0);

    // "Não quero nada" e depois volta a aceitar o WhatsApp
    await comoAnonimo(db, () => db.query(`select public.salvar_preferencias($1, '{"nada": true}')`, [token]));
    const nada = await comoAnonimo(db, async () => (await um<{ r: Record<string, boolean> }>(`select public.info_preferencias($1) as r`, [token])).r);
    expect(nada).toMatchObject({ whatsapp: false, email: false, sms: false, ofertas: false });
    await comoAnonimo(db, () => db.query(`select public.salvar_preferencias($1, $2)`, [token, JSON.stringify({ whatsapp: true, email: true, sms: true, ofertas: false })]));
    const volta = await comoAnonimo(db, async () => (await um<{ r: Record<string, boolean> }>(`select public.info_preferencias($1) as r`, [token])).r);
    expect(volta).toMatchObject({ whatsapp: true, email: true, sms: true, ofertas: false });
  });

  it("pesquisa de satisfação: responde uma vez, nota baixa vira tarefa e entra no histórico", async () => {
    const { token, pessoa } = await comoUsuario(db, ADMIN, async () => {
      const p = (await um<{ id: string }>(`insert into pessoas (nome) values ('Nina Rocha') returning id`)).id;
      const q = await um<{ token: string }>(`insert into mkt_pesquisas (pessoa_id, nome, contexto) values ($1, 'Nina Rocha', 'pos_locacao') returning token`, [p]);
      return { token: q.token, pessoa: p };
    });
    const r = await comoAnonimo(db, async () => {
      const info = (await um<{ r: Record<string, unknown> }>(`select public.info_pesquisa($1) as r`, [token])).r;
      const notaRuim = await erroDe(() => db.query(`select public.responder_pesquisa($1, 11, null)`, [token]));
      await db.query(`select public.responder_pesquisa($1, 4, 'Demoraram para consertar')`, [token]);
      const deNovo = await erroDe(() => db.query(`select public.responder_pesquisa($1, 10, null)`, [token]));
      const depois = (await um<{ r: Record<string, unknown> }>(`select public.info_pesquisa($1) as r`, [token])).r;
      return { info, notaRuim, deNovo, depois };
    });
    expect(r.info).toMatchObject({ imobiliaria: "Imob Mkt", nome: "Nina Rocha", respondida: false });
    expect(String(r.info.pergunta)).toContain("De 0 a 10");
    expect(r.notaRuim).toContain("0 a 10");
    expect(r.deNovo).toContain("já foi respondida");
    expect(r.depois).toMatchObject({ respondida: true, nota: 4 });
    const v = await comoUsuario(db, ADMIN, async () => ({
      tarefa: await todos<{ titulo: string; prioridade: string }>(`select titulo, prioridade from tarefas where titulo like 'Retornar para Nina%'`),
      inter: await todos<{ descricao: string }>(`select descricao from pessoa_interacoes where pessoa_id = $1`, [pessoa]),
    }));
    expect(v.tarefa).toEqual([{ titulo: "Retornar para Nina Rocha — nota 4 na pesquisa de satisfação", prioridade: "alta" }]);
    expect(v.inter[0].descricao).toBe('Pesquisa de satisfação: nota 4 — "Demoraram para consertar"');
  });

  it("webhook do WhatsApp: verificação, conversa + lead novo, sem repetir mensagem, status e SAIR", async () => {
    const { token, verify, pessoa } = await comoUsuario(db, ADMIN, async () => {
      const c = await um<{ webhook_token: string; whatsapp_verify_token: string }>(`select webhook_token, whatsapp_verify_token from mkt_config`);
      const p = (await um<{ id: string }>(`insert into pessoas (nome, telefone) values ('Otávio', '(13) 96666-0007') returning id`)).id;
      return { token: c.webhook_token, verify: c.whatsapp_verify_token, pessoa: p };
    });
    const msg = (telefone: string, texto: string, id: string) => ({ telefone, nome: "Contato", texto, tipo: "texto", externo_id: id, data: "2026-11-03T12:00:00Z" });
    const r = await comoAnonimo(db, async () => {
      const ok = (await um<{ r: boolean }>(`select public.mkt_verificar_webhook($1, 'whatsapp', $2) as r`, [token, verify])).r;
      const errado = (await um<{ r: boolean }>(`select public.mkt_verificar_webhook($1, 'whatsapp', 'x') as r`, [token])).r;
      const r1 = (await um<{ r: Record<string, number> }>(`select public.whatsapp_receber($1, $2) as r`, [
        token,
        JSON.stringify({ mensagens: [msg("5511944443333", "Oi, vi o anúncio", "w1"), msg("5511944443333", "Oi, vi o anúncio", "w1"), msg("5513966660007", "Bom dia", "w2")] }),
      ])).r;
      await db.query(`select public.whatsapp_receber($1, $2)`, [token, JSON.stringify({ mensagens: [msg("5511944443333", "sair", "w3")], status: [{ externo_id: "w9", status: "lida" }] })]);
      const invalido = await erroDe(() => db.query(`select public.whatsapp_receber(gen_random_uuid(), '{}')`));
      return { ok, errado, r1, invalido };
    });
    expect(r.ok).toBe(true);
    expect(r.errado).toBe(false);
    expect(r.r1).toEqual({ mensagens: 2, status: 0 });
    expect(r.invalido).toContain("Webhook inválido");
    const v = await comoUsuario(db, ADMIN, async () => ({
      conversas: await todos<{ contato: string; nao_lidas: number; status: string; lead: string | null; pessoa_id: string | null; ultima_mensagem: string }>(
        `select c.contato, c.nao_lidas, c.status, l.origem as lead, c.pessoa_id, c.ultima_mensagem from mkt_conversas c left join leads l on l.id = c.lead_id order by c.contato`,
      ),
      eventos: await todos<{ tipo: string; descricao: string }>(
        `select e.tipo, e.descricao from lead_eventos e join leads l on l.id = e.lead_id where l.telefone = '5511944443333' order by e.data, e.tipo`,
      ),
      sair: await todos<{ canal: string; origem: string }>(`select canal, origem from mkt_descadastros where telefone = '5511944443333'`),
    }));
    expect(v.conversas).toEqual([
      { contato: "5511944443333", nao_lidas: 2, status: "aberta", lead: "whatsapp", pessoa_id: null, ultima_mensagem: "sair" },
      { contato: "5513966660007", nao_lidas: 1, status: "aberta", lead: null, pessoa_id: pessoa, ultima_mensagem: "Bom dia" },
    ]);
    expect(v.eventos.map((e) => e.descricao)).toContain("WhatsApp recebido: Oi, vi o anúncio");
    expect(v.eventos.map((e) => e.tipo)).toContain("entrada");
    expect(v.sair).toEqual([{ canal: "whatsapp", origem: "whatsapp" }]);

    // Resposta registrada pela equipe: zera não lidas e passa a "aguardando o cliente"
    await comoUsuario(db, ADMIN, async () => {
      const c = (await um<{ id: string }>(`select id from mkt_conversas where contato = '5513966660007'`)).id;
      await db.query(`insert into mkt_mensagens (conversa_id, direcao, texto) values ($1, 'saida', 'Bom dia! Como posso ajudar?')`, [c]);
      const depois = await um<{ nao_lidas: number; status: string }>(`select nao_lidas, status from mkt_conversas where id = $1`, [c]);
      expect(depois).toEqual({ nao_lidas: 0, status: "aguardando" });
    });
  });

  it("Lead Ads: Google com chave, Meta sem dados fica guardado, teste não vira lead", async () => {
    const { token, chave } = await comoUsuario(db, ADMIN, async () => um<{ token: string; chave: string }>(`select webhook_token as token, google_lead_key as chave from mkt_config`));
    const r = await comoAnonimo(db, async () => {
      const lead = { nome: "Teo", telefone: "11933332222", utm_source: "google", utm_medium: "cpc", gclid: "GCL-9", origem: "site" };
      const semChave = await erroDe(() => db.query(`select public.lead_ads_receber($1, $2)`, [token, JSON.stringify({ plataforma: "google", chave: "errada", lead })]));
      const g = (await um<{ r: unknown }>(`select public.lead_ads_receber($1, $2) as r`, [token, JSON.stringify({ plataforma: "google", chave, externo_id: "L1", lead })])).r;
      const m = (await um<{ r: Record<string, boolean> }>(`select public.lead_ads_receber($1, $2) as r`, [token, JSON.stringify({ plataforma: "meta", externo_id: "444" })])).r;
      const t = (await um<{ r: Record<string, boolean> }>(`select public.lead_ads_receber($1, $2) as r`, [token, JSON.stringify({ plataforma: "google", chave, teste: true, lead })])).r;
      return { semChave, g, m, t };
    });
    expect(r.semChave).toContain("Chave do Google Ads não confere");
    expect(r.g).toEqual({ ok: true });
    expect(r.m).toEqual({ pendente: true });
    expect(r.t).toEqual({ teste: true });
    const v = await comoUsuario(db, ADMIN, async () => ({
      lead: await um<{ gclid: string; utm_source: string }>(`select gclid, utm_source from leads where telefone = '11933332222'`),
      log: await todos<{ plataforma: string; status: string }>(`select plataforma, status from mkt_lead_ads order by recebido_em, status`),
    }));
    expect(v.lead).toEqual({ gclid: "GCL-9", utm_source: "google" });
    expect(v.log.map((l) => `${l.plataforma}:${l.status}`).sort()).toEqual(["google:recebido", "google:teste", "meta:sem_dados"]);
    // Outra imobiliária não vê
    expect(await comoUsuario(db, OUTRO, async () => (await todos(`select id from mkt_lead_ads`)).length)).toBe(0);
    void orgB;
  });
});

describe("correções da revisão", () => {
  const ADMIN2 = "00000000-0000-0000-0000-000000017d01";
  const CORRETOR2 = "00000000-0000-0000-0000-000000017d02";

  it("outra organização não vê conversas nem mensagens (depois do webhook)", async () => {
    const meus = await comoUsuario(db, ADMIN, async () => ({
      conversas: (await todos(`select id from mkt_conversas`)).length,
      mensagens: (await todos(`select id from mkt_mensagens`)).length,
      conv: (await um<{ id: string }>(`select id from mkt_conversas order by created_at limit 1`)).id,
    }));
    expect(meus.conversas).toBeGreaterThan(0);
    expect(meus.mensagens).toBeGreaterThan(0);
    const r = await comoUsuario(db, OUTRO, async () => ({
      conversas: (await todos(`select id from mkt_conversas`)).length,
      mensagens: (await todos(`select id from mkt_mensagens`)).length,
      mudar: (await db.query(`update mkt_conversas set status = 'resolvida' where id = $1`, [meus.conv])).affectedRows,
      gravarNaOutra: await erroDe(() =>
        db.query(`insert into mkt_mensagens (organizacao_id, conversa_id, direcao, texto) values ($1, $2, 'entrada', 'invasão')`, [org, meus.conv]),
      ),
    }));
    expect(r.conversas).toBe(0);
    expect(r.mensagens).toBe(0);
    expect(r.mudar).toBe(0);
    expect(r.gravarNaOutra).toContain("row-level security");
  });

  it("configuração: corretor só cria com valores padrão (pelo mkt_config_ler) e não apaga", async () => {
    const orgC = await comoUsuario(db, ADMIN2, async () => (await um<{ id: string }>(`select public.criar_organizacao('Imob Config') as id`)).id);
    await db.query(`insert into membros (organizacao_id, user_id, papel) values ($1, $2, 'corretor')`, [orgC, CORRETOR2]);
    const r = await comoUsuario(db, CORRETOR2, async () => {
      const inserir = await erroDe(() =>
        db.query(`insert into mkt_config (webhook_token, whatsapp_verify_token, meta_pixel_id, google_lead_key)
                  values ('11111111-1111-1111-1111-111111111111', 'meu-token', '999999999', 'minha-chave')`),
      );
      const criada = (await um<{ r: { id: string; meta_pixel_id: string | null } }>(`select public.mkt_config_ler() as r`)).r;
      const apagar = (await db.query(`delete from mkt_config where id = $1`, [criada.id])).affectedRows;
      return { inserir, criada, apagar };
    });
    expect(r.inserir).toContain("row-level security");
    expect(r.criada.meta_pixel_id).toBeNull();
    expect(r.criada).not.toHaveProperty("webhook_token");
    expect(r.apagar).toBe(0);
    // Administrador apaga (e o recriado pelo admin guarda o que ele escolher)
    const admin = await comoUsuario(db, ADMIN2, async () => {
      const antes = await um<{ webhook_token: string }>(`select webhook_token from mkt_config where id = $1`, [r.criada.id]);
      await db.query(`delete from mkt_config where id = $1`, [r.criada.id]);
      const nova = await um<{ meta_pixel_id: string }>(`insert into mkt_config (meta_pixel_id) values ('123123123') returning meta_pixel_id`);
      return { antes, nova };
    });
    expect(admin.antes.webhook_token).not.toBe("11111111-1111-1111-1111-111111111111");
    expect(admin.nova.meta_pixel_id).toBe("123123123");
  });

  it("bloqueio: corretor bloqueia mas não retira nem muda — nem pelo link (logado ou com o token)", async () => {
    const { desc, token, pessoa } = await comoUsuario(db, ADMIN, async () => {
      const p = await um<{ id: string; preferencias_token: string }>(`insert into pessoas (nome, telefone) values ('Lia', '13955550009') returning id, preferencias_token`);
      const d = await um<{ id: string }>(`insert into mkt_descadastros (pessoa_id, telefone, canal, motivo) values ($1, '13955550009', 'todos', 'Pediu por telefone') returning id`, [p.id]);
      return { desc: d.id, token: p.preferencias_token, pessoa: p.id };
    });
    const r = await comoUsuario(db, CORRETOR, async () => ({
      bloquear: await erroDe(() => db.query(`insert into mkt_descadastros (telefone, canal) values ('13900000001', 'whatsapp')`)),
      apagar: await erroDe(() => db.query(`delete from mkt_descadastros where id = $1`, [desc])),
      mudar: await erroDe(() => db.query(`update mkt_descadastros set canal = 'sms' where id = $1`, [desc])),
      peloLink: await erroDe(() => db.query(`select public.salvar_preferencias($1, '{"whatsapp": true, "email": true, "sms": true, "ofertas": true}')`, [token])),
    }));
    expect(r.bloquear).toBe("");
    expect(r.apagar).toContain("Só administradores e gestores");
    expect(r.mudar).toContain("Só administradores e gestores");
    expect(r.peloLink).toContain("permission denied");
    // Com o token na mão, pela página pública (anônimo): o bloqueio da equipe continua.
    const anon = await comoAnonimo(db, async () => {
      const info = (await um<{ r: { whatsapp: boolean; travado: Record<string, boolean> } }>(`select public.info_preferencias($1) as r`, [token])).r;
      const depois = (await um<{ r: Record<string, boolean> }>(`select public.salvar_preferencias($1, '{"whatsapp": true, "sms": true, "ofertas": true}') as r`, [token])).r;
      return { info, depois };
    });
    expect(anon.info.whatsapp).toBe(false);
    expect(anon.info.travado).toEqual({ whatsapp: true, email: true, sms: true, ofertas: true });
    expect(anon.depois).toEqual({ whatsapp: false, email: false, sms: false, ofertas: false });
    const v = await comoUsuario(db, ADMIN, async () => ({
      sobrou: (await todos(`select id from mkt_descadastros where id = $1`, [desc])).length,
      pessoa: await um<{ aceita_whatsapp: boolean; aceita_marketing: boolean }>(`select aceita_whatsapp, aceita_marketing from pessoas where id = $1`, [pessoa]),
      consent: (await todos(`select id from pessoa_consentimentos where pessoa_id = $1 and concedido`, [pessoa])).length,
      log: (await todos(`select id from mkt_preferencias_log where pessoa_id = $1 and concedido`, [pessoa])).length,
    }));
    expect(v).toEqual({ sobrou: 1, pessoa: { aceita_whatsapp: false, aceita_marketing: false }, consent: 0, log: 0 });
    const admin = await comoUsuario(db, ADMIN, async () => {
      const d = await um<{ id: string }>(`insert into mkt_descadastros (telefone, canal) values ('13900000002', 'todos') returning id`);
      return erroDe(() => db.query(`delete from mkt_descadastros where id = $1`, [d.id]));
    });
    expect(admin).toBe("");
  });

  it("juntar repetidos leva fila, bloqueio, pesquisa, conversa e registro para o cadastro que fica", async () => {
    const r = await comoUsuario(db, ADMIN, async () => {
      const a = (await um<{ id: string }>(`insert into pessoas (nome, telefone) values ('Caio Prado', '13944440001') returning id`)).id;
      const b = (await um<{ id: string }>(`insert into pessoas (nome) values ('Caio P.') returning id`)).id;
      await db.query(`insert into mkt_envios (chave, pessoa_id, telefone, mensagem, status) values ('j1', $1, '13944440001', 'Oi', 'enviado')`, [b]);
      await db.query(`insert into mkt_descadastros (pessoa_id, canal) values ($1, 'todos')`, [b]); // sem telefone nem e-mail: só o cadastro
      await db.query(`insert into mkt_pesquisas (pessoa_id, nome) values ($1, 'Caio P.')`, [b]);
      await db.query(`insert into mkt_conversas (canal, contato, pessoa_id) values ('whatsapp', '5513944440001', $1)`, [b]);
      await db.query(`insert into mkt_preferencias_log (pessoa_id, canal, concedido) values ($1, 'todos', false)`, [b]);
      await db.query(`select public.juntar_pessoas($1, $2)`, [a, b]);
      const conta = async (t: string) => (await todos(`select id from ${t} where pessoa_id = $1`, [a])).length;
      const fila = await um<{ status: string }>(`insert into mkt_envios (chave, pessoa_id, telefone, mensagem) values ('j2', $1, '13944440001', 'Oferta') returning status`, [a]);
      return {
        envios: await conta("mkt_envios"),
        desc: await conta("mkt_descadastros"),
        pesq: await conta("mkt_pesquisas"),
        conv: await conta("mkt_conversas"),
        log: await conta("mkt_preferencias_log"),
        fila: fila.status,
        sumiu: (await todos(`select id from pessoas where id = $1`, [b])).length,
      };
    });
    expect(r).toEqual({ envios: 2, desc: 1, pesq: 1, conv: 1, log: 1, fila: "bloqueado", sumiu: 0 });
  });

  it("WhatsApp: mensagem recebida cai na conversa registrada à mão sem o 55", async () => {
    const { token, conv } = await comoUsuario(db, ADMIN, async () => {
      const c = await um<{ id: string }>(`insert into mkt_conversas (canal, contato, responsavel_id) values ('whatsapp', '11977778888', $1) returning id`, [ADMIN]);
      return { token: (await um<{ webhook_token: string }>(`select webhook_token from mkt_config`)).webhook_token, conv: c.id };
    });
    await comoAnonimo(db, () =>
      db.query(`select public.whatsapp_receber($1, $2)`, [
        token,
        JSON.stringify({ mensagens: [{ telefone: "5511977778888", nome: "Rui", texto: "Ainda está disponível?", tipo: "texto", externo_id: "w-rui", data: "2026-11-03T13:00:00Z" }] }),
      ]),
    );
    const v = await comoUsuario(db, ADMIN, async () => ({
      conversas: (await todos(`select id from mkt_conversas where right(contato, 9) = '977778888'`)).length,
      msgs: (await todos(`select id from mkt_mensagens where conversa_id = $1`, [conv])).length,
      resp: (await um<{ responsavel_id: string }>(`select responsavel_id from mkt_conversas where id = $1`, [conv])).responsavel_id,
    }));
    expect(v).toEqual({ conversas: 1, msgs: 1, resp: ADMIN });
  });

  it("formulário /l/[token] e API de leads gravam a origem (UTM, gclid) pelo receber_lead_marketing", async () => {
    const token = await comoUsuario(db, ADMIN, async () => (await um<{ leads_token: string }>(`select leads_token from organizacoes where id = $1`, [org])).leads_token);
    const r = await comoAnonimo(db, async () =>
      (
        await um<{ r: unknown }>(`select public.receber_lead_marketing($1, $2) as r`, [
          token,
          JSON.stringify({ nome: "Sara", telefone: "11966661111", origem: "instagram", utm_source: "instagram", utm_medium: "stories", utm_campaign: "Black-Friday", gclid: "GC-77" }),
        ])
      ).r,
    );
    expect(r).toEqual({ ok: true });
    const v = await comoUsuario(db, ADMIN, async () =>
      um<Record<string, string | null>>(
        `select l.origem, l.utm_source, l.utm_medium, l.gclid, c.nome as campanha from leads l left join mkt_campanhas c on c.id = l.campanha_id where l.telefone = '11966661111'`,
      ),
    );
    expect(v).toEqual({ origem: "instagram", utm_source: "instagram", utm_medium: "stories", gclid: "GC-77", campanha: "Black Friday" });
  });

  it("e-mail em quantidade: marca os enviados de uma vez e pula quem se descadastrou", async () => {
    const ids = await comoUsuario(db, ADMIN, async () => {
      const a = (await um<{ id: string }>(`insert into mkt_envios (chave, canal, email, mensagem) values ('em1', 'email', 'um@x.com', 'Oi') returning id`)).id;
      const b = (await um<{ id: string }>(`insert into mkt_envios (chave, canal, email, mensagem) values ('em2', 'email', 'dois@x.com', 'Oi') returning id`)).id;
      await db.query(`insert into mkt_descadastros (email, canal) values ('DOIS@x.com', 'email')`);
      return [a, b];
    });
    const deOutro = await comoUsuario(db, OUTRO, async () => (await um<{ r: Record<string, number> }>(`select public.mkt_marcar_enviados($1) as r`, [ids])).r);
    expect(deOutro).toEqual({ enviados: 0, bloqueados: 0 });
    const r = await comoUsuario(db, ADMIN, async () => {
      const res = (await um<{ r: Record<string, number> }>(`select public.mkt_marcar_enviados($1) as r`, [ids])).r;
      const st = await todos<{ chave: string; status: string }>(`select chave, status from mkt_envios where id = any($1) order by chave`, [ids]);
      return { res, st };
    });
    expect(r.res).toEqual({ enviados: 1, bloqueados: 1 });
    expect(r.st).toEqual([
      { chave: "em1", status: "enviado" },
      { chave: "em2", status: "bloqueado" },
    ]);
    const anon = await comoAnonimo(db, () => erroDe(() => db.query(`select public.mkt_marcar_enviados($1)`, [ids])));
    expect(anon).toContain("permission denied");
  });
});

describe("correções da revisão (rodada 2)", () => {
  const ADMIN3 = "00000000-0000-0000-0000-000000017e01";

  it("autorização retirada na aba Comunicação bloqueia na hora o envio pendente; exportar CSV confere o descadastro", async () => {
    const r = await comoUsuario(db, ADMIN, async () => {
      const p = (await um<{ id: string }>(`insert into pessoas (nome, telefone, email) values ('Xavier', '13911110001', 'xavier@x.com') returning id`)).id;
      const em = (await um<{ id: string }>(`insert into mkt_envios (chave, pessoa_id, canal, email, mensagem) values ('x-em', $1, 'email', 'xavier@x.com', 'Oferta') returning id`, [p])).id;
      const wa = (await um<{ id: string }>(`insert into mkt_envios (chave, pessoa_id, telefone, mensagem) values ('x-wa', $1, '13911110001', 'Oferta') returning id`, [p])).id;
      await db.query(`insert into pessoa_consentimentos (pessoa_id, canal, concedido, origem) values ($1, 'email', false, 'Pediu por telefone')`, [p]);
      const st = async (id: string) => (await um<{ status: string }>(`select status from mkt_envios where id = $1`, [id])).status;
      // Descadastro gravado direto (sem passar pela ação que limpa a fila): o envio continua pendente…
      const y = (await um<{ id: string }>(`insert into mkt_envios (chave, canal, email, mensagem) values ('y-em', 'email', 'yara@x.com', 'Oferta') returning id`)).id;
      const z = (await um<{ id: string }>(`insert into mkt_envios (chave, canal, email, mensagem) values ('z-em', 'email', 'zeca@x.com', 'Oferta') returning id`)).id;
      await db.query(`insert into mkt_descadastros (email, canal) values ('yara@x.com', 'email')`);
      const antes = await st(y);
      return { em: await st(em), wa: await st(wa), antes, y, z };
    });
    expect(r).toMatchObject({ em: "bloqueado", wa: "pendente", antes: "pendente" });
    // …e o CSV confere de novo: quem se descadastrou vira "bloqueado" e fica fora.
    const deOutro = await comoUsuario(db, OUTRO, async () => (await um<{ r: string[] }>(`select public.mkt_conferir_envios($1) as r`, [[r.y, r.z]])).r);
    expect(deOutro).toEqual([]);
    const ok = await comoUsuario(db, ADMIN, async () => ({
      ids: (await um<{ r: string[] }>(`select public.mkt_conferir_envios($1) as r`, [[r.y, r.z]])).r,
      y: (await um<{ status: string }>(`select status from mkt_envios where id = $1`, [r.y])).status,
    }));
    expect(ok).toEqual({ ids: [r.z], y: "bloqueado" });
    expect(await comoAnonimo(db, () => erroDe(() => db.query(`select public.mkt_conferir_envios($1)`, [[r.z]])))).toContain("permission denied");
  });

  it("registro LGPD: quem está logado não grava origem link/whatsapp, data retroativa nem outro usuário", async () => {
    const p = await comoUsuario(db, ADMIN, async () => (await um<{ id: string }>(`insert into pessoas (nome) values ('Fábio') returning id`)).id);
    await comoUsuario(db, CORRETOR, async () => {
      await db.query(`insert into mkt_preferencias_log (pessoa_id, canal, concedido, origem, em, usuario_id) values ($1, 'whatsapp', true, 'link', '2025-01-01', null)`, [p]);
      await db.query(`insert into mkt_descadastros (pessoa_id, canal, origem, em, usuario_id) values ($1, 'sms', 'whatsapp', '2025-01-01', $2)`, [p, ADMIN]);
    });
    const v = await comoUsuario(db, ADMIN, async () => ({
      log: await um<{ origem: string; usuario_id: string; recente: boolean }>(`select origem, usuario_id, em > now() - interval '1 minute' as recente from mkt_preferencias_log where pessoa_id = $1`, [p]),
      desc: await um<{ origem: string; usuario_id: string; recente: boolean }>(`select origem, usuario_id, em > now() - interval '1 minute' as recente from mkt_descadastros where pessoa_id = $1`, [p]),
    }));
    expect(v.log).toEqual({ origem: "manual", usuario_id: CORRETOR, recente: true });
    expect(v.desc).toEqual({ origem: "manual", usuario_id: CORRETOR, recente: true });
  });

  it("link de preferências: só muda o que a pessoa viu; sem telefone não autoriza WhatsApp nem SMS", async () => {
    const { token, pessoa } = await comoUsuario(db, ADMIN, async () => {
      const x = await um<{ id: string; preferencias_token: string }>(`insert into pessoas (nome, email) values ('Duda', 'duda@x.com') returning id, preferencias_token`);
      return { token: x.preferencias_token, pessoa: x.id };
    });
    const info = await comoAnonimo(db, async () => {
      const i = (await um<{ r: { tem_telefone: boolean; tem_email: boolean } }>(`select public.info_preferencias($1) as r`, [token])).r;
      // A página manda só os canais que mostrou (e-mail e ofertas): ela só desmarcou "ofertas".
      await db.query(`select public.salvar_preferencias($1, $2)`, [token, JSON.stringify({ email: true, ofertas: false })]);
      return i;
    });
    expect(info).toMatchObject({ tem_telefone: false, tem_email: true });
    const v1 = await comoUsuario(db, ADMIN, async () => ({
      pessoa: await um<Record<string, boolean>>(`select aceita_whatsapp, aceita_sms, aceita_email, aceita_marketing from pessoas where id = $1`, [pessoa]),
      consent: await todos<{ canal: string; concedido: boolean }>(`select canal, concedido from pessoa_consentimentos where pessoa_id = $1 order by canal`, [pessoa]),
    }));
    expect(v1.pessoa).toEqual({ aceita_whatsapp: false, aceita_sms: false, aceita_email: false, aceita_marketing: false });
    expect(v1.consent).toEqual([{ canal: "marketing", concedido: false }]);
    // Mesmo chamando direto com WhatsApp/SMS marcados, quem não tem telefone não ganha autorização.
    await comoAnonimo(db, async () => {
      await db.query(`select public.salvar_preferencias($1, '{"nada": true}')`, [token]);
      await db.query(`select public.salvar_preferencias($1, '{"whatsapp": true, "sms": true, "email": true}')`, [token]);
    });
    const v2 = await comoUsuario(db, ADMIN, async () => ({
      pessoa: await um<Record<string, boolean>>(`select aceita_whatsapp, aceita_sms, aceita_email from pessoas where id = $1`, [pessoa]),
      sim: await todos<{ canal: string }>(`select canal from pessoa_consentimentos where pessoa_id = $1 and concedido order by canal`, [pessoa]),
    }));
    expect(v2.pessoa).toEqual({ aceita_whatsapp: false, aceita_sms: false, aceita_email: true });
    expect(v2.sim).toEqual([{ canal: "email" }]);
  });

  it("link de um lead com o telefone de outra pessoa não apaga o bloqueio dela", async () => {
    const { vitima, tokenVitima, leadsToken } = await comoUsuario(db, ADMIN, async () => {
      const x = await um<{ id: string; preferencias_token: string }>(`insert into pessoas (nome, telefone) values ('Vitória', '13922220001') returning id, preferencias_token`);
      const o = await um<{ leads_token: string }>(`select leads_token from organizacoes where id = $1`, [org]);
      return { vitima: x.id, tokenVitima: x.preferencias_token, leadsToken: o.leads_token };
    });
    await comoAnonimo(db, async () => {
      await db.query(`select public.salvar_preferencias($1, '{"whatsapp": false}')`, [tokenVitima]);
      await db.query(`select public.receber_lead_marketing($1, $2)`, [leadsToken, JSON.stringify({ nome: "Atacante", telefone: "13922220001", email: "atk@x.com" })]);
    });
    const tokenLead = await comoUsuario(db, ADMIN, async () => (await um<{ t: string }>(`select preferencias_token as t from leads where email = 'atk@x.com'`)).t);
    const depois = await comoAnonimo(db, async () =>
      (await um<{ r: Record<string, boolean> }>(`select public.salvar_preferencias($1, '{"whatsapp": true, "email": true, "sms": true, "ofertas": true}') as r`, [tokenLead])).r,
    );
    expect(depois.whatsapp).toBe(false); // o bloqueio é da Vitória: o link do lead não libera
    const v = await um<{ b: boolean; n: number }>(
      `select privado.mkt_bloqueado($1, $2, null, null, '13922220001', 'whatsapp', 'ofertas') as b,
              (select count(*)::int from mkt_descadastros where pessoa_id = $2) as n`,
      [org, vitima],
    );
    expect(v).toEqual({ b: true, n: 1 });
  });

  it("limite: a 11ª alteração na mesma hora pelo mesmo link é recusada", async () => {
    const token = await comoUsuario(db, ADMIN, async () => (await um<{ t: string }>(`insert into pessoas (nome, telefone) values ('Rafa', '13933330001') returning preferencias_token as t`)).t);
    const erros = await comoAnonimo(db, async () => {
      for (let i = 0; i < 10; i++) await db.query(`select public.salvar_preferencias($1, $2)`, [token, JSON.stringify({ ofertas: i % 2 === 1 })]);
      return erroDe(() => db.query(`select public.salvar_preferencias($1, '{"ofertas": false}')`, [token]));
    });
    expect(erros).toContain("Muitas alterações agora");
  });

  it("juntar repetidos: o link do cadastro removido continua abrindo e salvando para o que fica", async () => {
    const { a, tokenB } = await comoUsuario(db, ADMIN, async () => {
      const a = (await um<{ id: string }>(`insert into pessoas (nome, telefone) values ('Célia Prado', '13944449999') returning id`)).id;
      const b = await um<{ id: string; preferencias_token: string }>(`insert into pessoas (nome, telefone) values ('Célia P', '13944449999') returning id, preferencias_token`);
      await db.query(`select public.juntar_pessoas($1, $2)`, [a, b.id]);
      return { a, tokenB: b.preferencias_token };
    });
    const r = await comoAnonimo(db, async () => {
      const info = (await um<{ r: { nome: string } | null }>(`select public.info_preferencias($1) as r`, [tokenB])).r;
      await db.query(`select public.salvar_preferencias($1, '{"whatsapp": false}')`, [tokenB]);
      return info;
    });
    expect(r?.nome).toBe("Célia Prado");
    const desc = await comoUsuario(db, ADMIN, async () => todos<{ canal: string; origem: string }>(`select canal, origem from mkt_descadastros where pessoa_id = $1`, [a]));
    expect(desc).toEqual([{ canal: "whatsapp", origem: "link" }]);
  });

  it("preço que baixou de imóvel indisponível não vira evento (não ocupa a fila das automações)", async () => {
    const r = await comoUsuario(db, ADMIN, async () => {
      const alugado = (await um<{ id: string }>(`insert into imoveis (codigo, valor_aluguel, status) values ('MKT-AL', 3000, 'alugado') returning id`)).id;
      const livre = (await um<{ id: string }>(`insert into imoveis (codigo, valor_aluguel) values ('MKT-LV', 3000) returning id`)).id;
      await db.query(`update imoveis set valor_aluguel = 2500 where id in ($1, $2)`, [alugado, livre]);
      const ev = async (id: string) => (await todos<{ tipo: string }>(`select tipo from mkt_eventos where imovel_id = $1 order by criado_em, tipo`, [id])).map((e) => e.tipo);
      return { alugado: await ev(alugado), livre: await ev(livre) };
    });
    expect(r).toEqual({ alugado: [], livre: ["novo_imovel", "reducao_preco"] });
  });

  it("voltar para a fila: desfaz o histórico nos primeiros minutos sem duplicar; depois disso ou com campanha cancelada, não volta", async () => {
    const r = await comoUsuario(db, ADMIN, async () => {
      const l = (await um<{ id: string }>(`insert into leads (nome, telefone) values ('Hugo', '13955551111') returning id`)).id;
      const e = (await um<{ id: string }>(`insert into mkt_envios (chave, lead_id, telefone, mensagem) values ('h1', $1, '13955551111', 'Olá Hugo') returning id`, [l])).id;
      const eventos = async () => (await todos(`select id from lead_eventos where lead_id = $1 and descricao like 'WhatsApp enviado%'`, [l])).length;
      await db.query(`update mkt_envios set status = 'enviado' where id = $1`, [e]);
      const n1 = await eventos();
      await db.query(`update mkt_envios set status = 'pendente' where id = $1`, [e]);
      const n2 = await eventos();
      await db.query(`update mkt_envios set status = 'enviado' where id = $1`, [e]);
      const n3 = await eventos();
      // A data do envio não muda depois de gravada (senão daria para "renovar" os 10 minutos).
      await db.query(`update mkt_envios set enviado_em = now() + interval '1 day' where id = $1`, [e]);
      const fixo = (await um<{ ok: boolean }>(`select enviado_em <= now() as ok from mkt_envios where id = $1`, [e])).ok;
      const velho = (
        await um<{ id: string }>(
          `insert into mkt_envios (chave, lead_id, telefone, mensagem, status, enviado_em) values ('h2', $1, '13955551111', 'Antigo', 'enviado', now() - interval '1 hour') returning id`,
          [l],
        )
      ).id;
      const voltarVelho = await erroDe(() => db.query(`update mkt_envios set status = 'pendente' where id = $1`, [velho]));
      const camp = (await um<{ id: string }>(`insert into mkt_campanhas (nome, mensagem, status) values ('Cancelada', 'Oi', 'fila') returning id`)).id;
      const ec = (await um<{ id: string }>(`insert into mkt_envios (chave, campanha_id, lead_id, telefone, mensagem) values ('h3', $1, $2, '13955551111', 'Oi') returning id`, [camp, l])).id;
      await db.query(`update mkt_campanhas set status = 'cancelada' where id = $1`, [camp]);
      await db.query(`update mkt_envios set status = 'cancelado' where id = $1`, [ec]);
      const voltarCancelada = await erroDe(() => db.query(`update mkt_envios set status = 'pendente' where id = $1`, [ec]));
      return { n1, n2, n3, fixo, voltarVelho, voltarCancelada };
    });
    expect([r.n1, r.n2, r.n3]).toEqual([1, 0, 1]);
    expect(r.fixo).toBe(true);
    expect(r.voltarVelho).toContain("10 minutos");
    expect(r.voltarCancelada).toContain("Campanha cancelada");
  });

  it("pesquisa: a tarefa da nota baixa vence no dia de Brasília (o banco roda em UTC)", async () => {
    const token = await comoUsuario(db, ADMIN, async () => (await um<{ token: string }>(`insert into mkt_pesquisas (nome) values ('Paulo Fuso') returning token`)).token);
    await db.exec(`set timezone = 'UTC'`);
    await comoAnonimo(db, () => db.query(`select public.responder_pesquisa($1, 3, null)`, [token]));
    const v = await comoUsuario(db, ADMIN, async () =>
      um<{ ok: boolean }>(`select vencimento = (now() at time zone 'America/Sao_Paulo')::date as ok from tarefas where titulo like 'Retornar para Paulo Fuso%'`),
    );
    expect(v.ok).toBe(true);
  });

  it("outra organização: conversa, envio, pesquisa e mensagem com cadastro de outra imobiliária são recusados", async () => {
    const a = await comoUsuario(db, ADMIN, async () => {
      const lead = (await um<{ id: string }>(`insert into leads (nome, telefone) values ('Lead da A', '13966660001') returning id`)).id;
      const pessoa = (await um<{ id: string }>(`insert into pessoas (nome) values ('Pessoa da A') returning id`)).id;
      const conv = (await um<{ id: string }>(`insert into mkt_conversas (canal, contato, lead_id) values ('whatsapp', '5513966660001', $1) returning id`, [lead])).id;
      return { lead, pessoa, conv };
    });
    const r = await comoUsuario(db, OUTRO, async () => ({
      conversa: await erroDe(() => db.query(`insert into mkt_conversas (canal, contato, lead_id) values ('whatsapp', '5513966660001', $1)`, [a.lead])),
      envio: await erroDe(() => db.query(`insert into mkt_envios (chave, lead_id, telefone, mensagem) values ('b1', $1, '13966660001', 'x')`, [a.lead])),
      pesquisa: await erroDe(() => db.query(`insert into mkt_pesquisas (pessoa_id, nome) values ($1, 'x')`, [a.pessoa])),
      mensagem: await erroDe(() => db.query(`insert into mkt_mensagens (conversa_id, direcao, texto, data) values ($1, 'entrada', 'x', '2099-01-01')`, [a.conv])),
    }));
    expect(r.conversa).toContain("outra organização");
    expect(r.envio).toContain("outra organização");
    expect(r.pesquisa).toContain("outra organização");
    expect(r.mensagem).toContain("outra organização");
    // Mensagem com data no futuro (da própria imobiliária) não joga o último contato para depois de hoje.
    const v = await comoUsuario(db, ADMIN, async () => {
      await db.query(`insert into mkt_mensagens (conversa_id, direcao, texto, data) values ($1, 'entrada', 'Oi', '2099-01-01')`, [a.conv]);
      return um<{ ok: boolean; conv: boolean }>(
        `select l.ultimo_contato <= now() as ok, (select ultima_em <= now() from mkt_conversas where id = $2) as conv from leads l where l.id = $1`,
        [a.lead, a.conv],
      );
    });
    expect(v).toEqual({ ok: true, conv: true });
  });

  it("webhook do WhatsApp: assinatura conferida no banco, corpo lido no banco, lote e SAIR limitados", async () => {
    const SEGREDO = "segredo-do-app-da-meta-123";
    await comoUsuario(db, ADMIN3, () => db.query(`select public.criar_organizacao('Imob Zap')`));
    const token = await comoUsuario(db, ADMIN3, async () => {
      const t = (await um<{ r: { webhook_token: string } }>(`select public.mkt_config_ler() as r`)).r.webhook_token;
      await db.query(`update mkt_config set whatsapp_app_secret = $1`, [SEGREDO]);
      await db.query(`insert into mkt_envios (chave, telefone, mensagem) values ('z1', '13999990000', 'Oferta')`);
      return t;
    });
    // HMAC do banco = HMAC do Node (chave curta e chave maior que o bloco de 64 bytes)
    const hm = (msg: string, chave: string) => createHmac("sha256", chave).update(msg, "utf8").digest("hex");
    const banco = async (msg: string, chave: string) =>
      (await um<{ h: string }>(`select encode(privado.mkt_hmac_sha256(convert_to($1, 'UTF8'), convert_to($2, 'UTF8')), 'hex') as h`, [msg, chave])).h;
    expect(await banco("Olá, ação!", SEGREDO)).toBe(hm("Olá, ação!", SEGREDO));
    expect(await banco("x", "k".repeat(100))).toBe(hm("x", "k".repeat(100)));

    const corpo = (mensagens: unknown[]) =>
      JSON.stringify({
        object: "whatsapp_business_account",
        entry: [{ id: "1", changes: [{ field: "messages", value: { contacts: [{ profile: { name: "Carla" }, wa_id: "5513999990000" }], messages: mensagens } }] }],
      });
    const c1 = corpo([
      { from: "5513999990000", id: "wamid.A", timestamp: "1762182000", type: "text", text: { body: "Oi, quero visitar" } },
      { from: "5513999990000", id: "wamid.B", timestamp: "4102444800", type: "image", image: { caption: "foto da sala" } },
      { from: "12", id: "x", type: "text", text: { body: "curto" } },
    ]);
    const sair = corpo([
      { from: "5513999990000", id: "wamid.S1", timestamp: "1762182100", type: "text", text: { body: "SAIR" } },
      { from: "5513999990000", id: "wamid.S2", timestamp: "1762182200", type: "text", text: { body: "sair" } },
    ]);
    const grande = corpo(Array.from({ length: 101 }, (_, i) => ({ from: "5513988880000", id: `g${i}`, type: "text", text: { body: "oi" } })));
    const r = await comoAnonimo(db, async () => ({
      ok: (await um<{ r: Record<string, number> }>(`select public.whatsapp_receber_assinado($1, $2, $3) as r`, [token, c1, `sha256=${hm(c1, SEGREDO)}`])).r,
      errada: await erroDe(() => db.query(`select public.whatsapp_receber_assinado($1, $2, $3)`, [token, c1, `sha256=${hm(c1, "outro-segredo-qualquer")}`])),
      semAssinatura: await erroDe(() => db.query(`select public.whatsapp_receber_assinado($1, $2, null)`, [token, c1])),
      // Chamar a versão antiga direto (com a chave anon e o token) não pula a assinatura.
      direto: await erroDe(() => db.query(`select public.whatsapp_receber($1, $2)`, [token, JSON.stringify({ mensagens: [{ telefone: "5513977770000", texto: "SAIR" }] })])),
      lote: await erroDe(() => db.query(`select public.whatsapp_receber_assinado($1, $2, $3)`, [token, grande, `sha256=${hm(grande, SEGREDO)}`])),
      sair: (await um<{ r: Record<string, number> }>(`select public.whatsapp_receber_assinado($1, $2, $3) as r`, [token, sair, `sha256=${hm(sair, SEGREDO)}`])).r,
    }));
    expect(r.ok).toEqual({ mensagens: 2, status: 0 });
    expect(r.errada).toContain("Assinatura inválida");
    expect(r.semAssinatura).toContain("Assinatura inválida");
    expect(r.direto).toContain("Assinatura inválida");
    expect(r.lote).toContain("Lote grande demais");
    expect(r.sair).toEqual({ mensagens: 2, status: 0 });
    const v = await comoUsuario(db, ADMIN3, async () => ({
      conversa: await um<{ nome: string; contato: string }>(`select nome, contato from mkt_conversas`),
      msgs: await todos<{ texto: string; tipo: string; futuro: boolean }>(
        `select texto, tipo, data > now() as futuro from mkt_mensagens where externo_id in ('wamid.A','wamid.B') order by externo_id`,
      ),
      desc: (await todos(`select id from mkt_descadastros where canal = 'whatsapp'`)).length,
      envio: (await um<{ status: string }>(`select status from mkt_envios where chave = 'z1'`)).status,
      leads: (await todos(`select id from leads where telefone = '5513988880000'`)).length,
    }));
    expect(v.conversa).toEqual({ nome: "Carla", contato: "5513999990000" });
    expect(v.msgs).toEqual([
      { texto: "Oi, quero visitar", tipo: "texto", futuro: false },
      { texto: "foto da sala", tipo: "imagem", futuro: false },
    ]);
    expect(v.desc).toBe(1); // "SAIR" e "sair" na mesma rajada: um descadastro só
    expect(v.envio).toBe("bloqueado");
    expect(v.leads).toBe(0); // o lote grande foi recusado inteiro
  });

  it("o banco lê o corpo do WhatsApp igual ao lerWebhookWhatsapp (mesma regra nos dois lados)", async () => {
    const payload = {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "1",
          changes: [
            {
              field: "messages",
              value: {
                contacts: [{ profile: { name: "Carla" }, wa_id: "5513999990000" }, { profile: { name: "  " }, wa_id: "5513888880000" }],
                messages: [
                  { from: "5513999990000", id: "m1", timestamp: "1762182000", type: "text", text: { body: "Oi, quero visitar" } },
                  { from: "+55 (13) 88888-0000", id: "m2", timestamp: 1762182060, type: "interactive", interactive: { list_reply: { title: "Visita sábado" } } },
                  { from: "5513999990000", id: "m3", timestamp: "1762182120", type: "document", document: { filename: "rg.pdf" } },
                  { from: "5513999990000", id: "m4", timestamp: "1762182180", type: "location", location: { name: "Casa", latitude: -23.5, longitude: -46.6 } },
                  { from: "5513999990000", id: "m5", timestamp: "1762182240", type: "reaction", reaction: { emoji: "👍" } },
                  { from: "5513999990000", id: "m6", timestamp: "1762182300", type: "contacts" },
                  { from: "5513999990000", id: "m7", timestamp: "1762182360", type: "button", button: { text: "Quero" } },
                  { from: "12", id: "x", type: "text", text: { body: "curto" } },
                  "lixo",
                ],
                statuses: [{ id: "wamid.Z", status: "read" }, { id: "wamid.Y", status: "desconhecido" }, { status: "sent" }],
              },
            },
            { field: "outro", value: "não é objeto" },
          ],
        },
      ],
    };
    const ts = lerWebhookWhatsapp(payload);
    const sql = (await um<{ r: { mensagens: { data: string }[]; status: unknown[] } }>(`select privado.mkt_whatsapp_ler($1) as r`, [JSON.stringify(payload)])).r;
    const semData = <T extends { data: string }>(l: T[]) => l.map(({ data, ...resto }) => ({ ...resto, data: Date.parse(data) }));
    expect(semData(sql.mensagens)).toEqual(semData(ts.mensagens));
    expect(sql.status).toEqual(ts.status);
  });
});
