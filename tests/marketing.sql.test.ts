/**
 * Marketing no banco (PGlite): fila que respeita descadastro e LGPD, histórico
 * no CRM, eventos de imóvel para as automações, regras da configuração,
 * isolamento por organização e as rotas públicas por token (landing page,
 * preferências, pesquisa, webhook do WhatsApp e Lead Ads).
 */
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
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
  it("só admin/gestor mudam tokens e integrações; o horário das automações qualquer um grava", async () => {
    const cfg = await comoUsuario(db, ADMIN, async () => um<{ id: string; webhook_token: string }>(`insert into mkt_config default values returning id, webhook_token`));
    const r = await comoUsuario(db, CORRETOR, async () => ({
      token: await erroDe(() => db.query(`update mkt_config set whatsapp_verify_token = 'x' where id = $1`, [cfg.id])),
      pixel: await erroDe(() => db.query(`update mkt_config set meta_pixel_id = '123456789' where id = $1`, [cfg.id])),
      horario: await erroDe(() => db.query(`update mkt_config set automacoes_em = now() where id = $1`, [cfg.id])),
    }));
    expect(r.token).toContain("Só administradores e gestores");
    expect(r.pixel).toContain("Só administradores e gestores");
    expect(r.horario).toBe("");
    await comoUsuario(db, ADMIN, () => db.query(`update mkt_config set meta_pixel_id = '123456789', whatsapp_numero = '13999990000' where id = $1`, [cfg.id]));
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
      const l1 = (await um<{ r: { id: string; duplicado: boolean } }>(`select public.receber_lead_landing('casa-centro', $1) as r`, [
        JSON.stringify({ nome: "Vera", telefone: "11955554444", origem: "facebook", utm_source: "facebook", utm_medium: "cpc", utm_campaign: "black-friday", fbclid: "FB1" }),
      ])).r;
      const l2 = (await um<{ r: { id: string; duplicado: boolean } }>(`select public.receber_lead_landing('casa-centro', $1) as r`, [
        JSON.stringify({ nome: "Vera", telefone: "(11) 95555-4444", utm_source: "google", gclid: "G1" }),
      ])).r;
      const l3 = (await um<{ r: { id: string } }>(`select public.receber_lead_landing('casa-centro', $1) as r`, [JSON.stringify({ nome: "Ivo", email: "ivo@x.com" })])).r;
      const erroFora = await erroDe(() => db.query(`select public.receber_lead_landing('fora', '{"nome":"x","email":"a@a"}')`));
      const lerTabela = await erroDe(() => db.query(`select * from mkt_landing_pages`));
      return { info, fora, pessoal, l1, l2, l3, erroFora, lerTabela };
    });
    expect(r.info).toMatchObject({ titulo: "Casa no Centro", imobiliaria: "Imob Mkt", meta_pixel_id: "123456789", imovel: { codigo: "LP-1" } });
    expect(r.fora).toBeNull();
    expect(r.pessoal).toBeNull();
    expect(r.l2).toEqual({ id: r.l1.id, duplicado: true });
    expect(r.erroFora).toContain("Página não encontrada");
    expect(r.lerTabela).toContain("permission denied");
    const v = await comoUsuario(db, ADMIN, async () => ({
      lead: await um<Record<string, string | null>>(
        `select l.origem, l.utm_source, l.utm_medium, l.utm_campaign, l.fbclid, l.gclid, l.funil, lp.slug, c.nome as campanha
           from leads l join mkt_landing_pages lp on lp.id = l.landing_id left join mkt_campanhas c on c.id = l.campanha_id where l.id = $1`,
        [r.l1.id],
      ),
      semUtm: await um<{ utm_campaign: string | null }>(`select utm_campaign from leads where id = $1`, [r.l3.id]),
      lp: await um<{ visitas: number; leads: number }>(`select visitas, leads from mkt_landing_pages where slug = 'casa-centro'`),
      imovel: (await todos(`select 1 from lead_imoveis li join imoveis i on i.id = li.imovel_id where li.lead_id = $1 and i.codigo = 'LP-1'`, [r.l1.id])).length,
    }));
    // Primeiro toque fica (o segundo envio veio do Google, mas a origem é Facebook)
    expect(v.lead).toEqual({ origem: "facebook", utm_source: "facebook", utm_medium: "cpc", utm_campaign: "black-friday", fbclid: "FB1", gclid: "G1", funil: "locacao", slug: "casa-centro", campanha: "Black Friday" });
    expect(v.semUtm.utm_campaign).toBe("padrao-lp");
    expect(v.lp).toEqual({ visitas: 1, leads: 3 });
    expect(v.imovel).toBe(1);
  });

  it("landing page de quem quer anunciar vira captação (sem UTM no lead)", async () => {
    await comoUsuario(db, ADMIN, () => db.query(`insert into mkt_landing_pages (slug, titulo, funil) values ('anuncie', 'Anuncie seu imóvel', 'captacao')`));
    const r = await comoAnonimo(db, async () => (await um<{ r: { captacao: boolean; id: string } }>(`select public.receber_lead_landing('anuncie', $1) as r`, [JSON.stringify({ nome: "Seu Jorge", telefone: "11922221111", utm_source: "instagram" })])).r);
    expect(r.captacao).toBe(true);
    const v = await comoUsuario(db, ADMIN, async () => ({
      cap: await um<{ proprietario_nome: string }>(`select proprietario_nome from captacoes where id = $1`, [r.id]),
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
    // Aba Comunicação: só o que mudou nas caixas (WhatsApp desmarcado, ofertas autorizadas agora)
    expect(v.consent).toEqual([
      { canal: "marketing", concedido: true },
      { canal: "whatsapp", concedido: false },
    ]);
    expect(v.desc).toEqual([
      { canal: "sms", origem: "link" },
      { canal: "whatsapp", origem: "link" },
    ]);
    expect(v.log).toEqual([
      { canal: "ofertas", concedido: true },
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
      const g = (await um<{ r: { id: string } }>(`select public.lead_ads_receber($1, $2) as r`, [token, JSON.stringify({ plataforma: "google", chave, externo_id: "L1", lead })])).r;
      const m = (await um<{ r: Record<string, boolean> }>(`select public.lead_ads_receber($1, $2) as r`, [token, JSON.stringify({ plataforma: "meta", externo_id: "444" })])).r;
      const t = (await um<{ r: Record<string, boolean> }>(`select public.lead_ads_receber($1, $2) as r`, [token, JSON.stringify({ plataforma: "google", chave, teste: true, lead })])).r;
      return { semChave, g, m, t };
    });
    expect(r.semChave).toContain("Chave do Google Ads não confere");
    expect(r.m).toEqual({ pendente: true });
    expect(r.t).toEqual({ teste: true });
    const v = await comoUsuario(db, ADMIN, async () => ({
      lead: await um<{ gclid: string; utm_source: string }>(`select gclid, utm_source from leads where id = $1`, [r.g.id]),
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

  it("configuração: corretor só cria com valores padrão e não apaga", async () => {
    const orgC = await comoUsuario(db, ADMIN2, async () => (await um<{ id: string }>(`select public.criar_organizacao('Imob Config') as id`)).id);
    await db.query(`insert into membros (organizacao_id, user_id, papel) values ($1, $2, 'corretor')`, [orgC, CORRETOR2]);
    const r = await comoUsuario(db, CORRETOR2, async () => {
      const criada = await um<{ id: string; webhook_token: string; whatsapp_verify_token: string; meta_pixel_id: string | null; google_lead_key: string }>(
        `insert into mkt_config (webhook_token, whatsapp_verify_token, meta_pixel_id, google_lead_key)
         values ('11111111-1111-1111-1111-111111111111', 'meu-token', '999999999', 'minha-chave') returning id, webhook_token, whatsapp_verify_token, meta_pixel_id, google_lead_key`,
      );
      const apagar = await erroDe(() => db.query(`delete from mkt_config where id = $1`, [criada.id]));
      const horario = await erroDe(() => db.query(`update mkt_config set automacoes_em = now() where id = $1`, [criada.id]));
      return { criada, apagar, horario };
    });
    expect(r.criada.webhook_token).not.toBe("11111111-1111-1111-1111-111111111111");
    expect(r.criada.whatsapp_verify_token).not.toBe("meu-token");
    expect(r.criada.google_lead_key).not.toBe("minha-chave");
    expect(r.criada.meta_pixel_id).toBeNull();
    expect(r.apagar).toContain("Só administradores e gestores");
    expect(r.horario).toBe("");
    // Administrador apaga (e o recriado pelo admin guarda o que ele escolher)
    const admin = await comoUsuario(db, ADMIN2, async () => {
      await db.query(`delete from mkt_config where id = $1`, [r.criada.id]);
      return um<{ meta_pixel_id: string }>(`insert into mkt_config (meta_pixel_id) values ('123123123') returning meta_pixel_id`);
    });
    expect(admin.meta_pixel_id).toBe("123123123");
  });

  it("bloqueio: corretor bloqueia mas não retira nem muda; a própria pessoa muda pelo link mesmo logada", async () => {
    const { desc, token } = await comoUsuario(db, ADMIN, async () => {
      const p = await um<{ id: string; preferencias_token: string }>(`insert into pessoas (nome, telefone) values ('Lia', '13955550009') returning id, preferencias_token`);
      const d = await um<{ id: string }>(`insert into mkt_descadastros (pessoa_id, telefone, canal) values ($1, '13955550009', 'todos') returning id`, [p.id]);
      return { desc: d.id, token: p.preferencias_token };
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
    expect(r.peloLink).toBe("");
    const sobrou = await comoUsuario(db, ADMIN, async () => (await todos(`select id from mkt_descadastros where id = $1`, [desc])).length);
    expect(sobrou).toBe(0); // a pessoa liberou pelo link
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
        await um<{ r: { id: string } }>(`select public.receber_lead_marketing($1, $2) as r`, [
          token,
          JSON.stringify({ nome: "Sara", telefone: "11966661111", origem: "instagram", utm_source: "instagram", utm_medium: "stories", utm_campaign: "Black-Friday", gclid: "GC-77" }),
        ])
      ).r,
    );
    const v = await comoUsuario(db, ADMIN, async () =>
      um<Record<string, string | null>>(`select l.origem, l.utm_source, l.utm_medium, l.gclid, c.nome as campanha from leads l left join mkt_campanhas c on c.id = l.campanha_id where l.id = $1`, [r.id]),
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
