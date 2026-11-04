/**
 * Site imobiliário e portais no banco (PGlite): leitura pública só do que está
 * publicado, formulários do site (contato, visita, anúncio, empreendimento),
 * limites contra abuso, feed dos portais, registro de envios calculado pelo
 * banco, leads dos portais, papéis, endereços antigos e isolamento por
 * organização.
 */
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { selecionarParaFeed, type ImovelPortal } from "@/lib/dominio/site-portais";
import { montarFeed } from "@/lib/servicos/portais";
import { comoAnonimo, comoUsuario, criarBanco } from "./pglite";

const DONO = "00000000-0000-0000-0000-000000016a01";
const OUTRO = "00000000-0000-0000-0000-000000016a02";
const PESSOAL = "00000000-0000-0000-0000-000000016a03";
const EQUIV = "00000000-0000-0000-0000-000000016a04";
const CORRETOR = "00000000-0000-0000-0000-000000016a05";
const INTRUSO = "00000000-0000-0000-0000-000000016a06";
const ZERO = "00000000-0000-0000-0000-000000000000";

let db: PGlite;
let org: string;
let orgB: string;
let token: string;
let tokenLeads: string;
const im: Record<string, string> = {};
const foto: Record<string, string> = {};
let emp: string;

const DESCRICAO = "Apartamento de dois quartos no centro, perto de tudo, com sol da manhã e vaga.";
/** Data de hoje em Brasília, calculada pelo banco (o banco de teste roda em UTC). */
const HOJE_SP = "(now() at time zone 'America/Sao_Paulo')::date";

async function erroDe(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "";
  } catch (e) {
    return String(e);
  }
}

const umaLinha = async <T>(sql: string, args: unknown[] = []) => (await db.query<T>(sql, args)).rows[0];

/** Instante de "daqui a N dias, às HH:MM de Brasília" (ISO em UTC). */
function horarioSP(dias: number, hora: string): string {
  const data = new Date(Date.now() + dias * 86_400_000 - 3 * 3_600_000).toISOString().slice(0, 10);
  return new Date(`${data}T${hora}:00-03:00`).toISOString();
}

/** Cliente "de mentira" que chama as funções do banco como o Supabase faria (anônimo ou logado). */
function clienteFalso(usuario?: string) {
  return {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      const nomes = Object.keys(args);
      const valores = nomes.map((k) => (args[k] !== null && typeof args[k] === "object" ? JSON.stringify(args[k]) : args[k]));
      const lista = nomes.map((k, i) => `${k} => $${i + 1}`).join(", ");
      const rodar = () => db.query<{ r: unknown }>(`select public.${fn}(${lista}) as r`, valores);
      try {
        const r = usuario ? await comoUsuario(db, usuario, rodar) : await comoAnonimo(db, rodar);
        return { data: r.rows[0].r, error: null };
      } catch (e) {
        return { data: null, error: { message: String(e) } };
      }
    },
  };
}

const contato = (slug: string, p: Record<string, unknown>) => db.query(`select public.site_contato($1, $2)`, [slug, JSON.stringify(p)]);
const sincronizar = (tk: string, portal: string, origem = "portal") =>
  umaLinha<{ j: { id: string; enviados: string[]; falhas: { imovel_id: string; codigo: string; problemas: string[] }[]; fora_limite: string[] } | null }>(
    `select public.portal_sincronizar($1, $2, $3) as j`,
    [tk, portal, origem],
  );

beforeAll(async () => {
  db = await criarBanco();
  // O Supabase roda em UTC: depois das 21h de Brasília a data de UTC já é amanhã.
  await db.exec(`set timezone to 'UTC'`);
  org = await comoUsuario(db, DONO, async () => (await umaLinha<{ id: string }>(`select public.criar_organizacao('Imob Site') as id`)).id);
  orgB = await comoUsuario(db, OUTRO, async () => (await umaLinha<{ id: string }>(`select public.criar_organizacao('Outra Imob') as id`)).id);
  await db.query(`insert into membros (organizacao_id, user_id, papel) values ($1, $2, 'corretor')`, [org, CORRETOR]);

  await comoUsuario(db, DONO, async () => {
    emp = (await umaLinha<{ id: string }>(
      `insert into empreendimentos (nome, bairro, cidade, publicar_site, fase, descricao_site) values ('Residencial Sol', 'Centro', 'Canoas', true, 'lancamento', 'Lançamento no centro') returning id`,
    )).id;
    const novo = async (codigo: string, extra: string, valores: string) =>
      (im[codigo] = (await umaLinha<{ id: string }>(`insert into imoveis (codigo, ${extra}) values ('${codigo}', ${valores}) returning id`)).id);
    await novo(
      "AP-1",
      "tipo, finalidades, status, publicar_site, logradouro, numero, bairro, cidade, uf, cep, latitude, longitude, quartos, area_util, valor_aluguel, empreendimento_id",
      `'apartamento', '{locacao}', 'disponivel', true, 'Rua das Flores', '120', 'Centro', 'Canoas', 'RS', '92010000', -29.9177123, -51.1836456, 2, 60, 1800, '${emp}'`,
    );
    await novo("AP-2", "status, publicar_site, cidade, valor_aluguel", `'disponivel', false, 'Canoas', 1500`);
    await novo("AP-3", "status, publicar_site, cidade, valor_aluguel", `'alugado', true, 'Canoas', 1700`);
    await novo("CASA-4", "tipo, finalidades, status, publicar_site, bairro, cidade, valor_venda", `'casa', '{venda}', 'disponivel', true, 'Niterói', 'Canoas', 650000`);
    for (const c of ["AP-1", "AP-2", "AP-3"]) {
      foto[c] = (await umaLinha<{ id: string }>(
        `insert into imovel_midias (imovel_id, tipo, path, capa) values ($1, 'foto', $2, true) returning id`,
        [im[c], `${org}/${im[c]}/foto-${c}.jpg`],
      )).id;
    }
    await db.query(`insert into imovel_midias (imovel_id, tipo, path) values ($1, 'documento', $2)`, [im["AP-1"], `${org}/${im["AP-1"]}/matricula.pdf`]);
    const cfg = await umaLinha<{ portais_token: string; leads_portais_token: string }>(
      `insert into site_config (slug, ativo, nome, whatsapp) values ('imob-site', true, 'Imob Site Oficial', '51999990000') returning portais_token, leads_portais_token`,
    );
    token = cfg.portais_token;
    tokenLeads = cfg.leads_portais_token;
  });
});

describe("site público (anônimo)", () => {
  it("mostra só imóveis publicados e disponíveis, sem o endereço exato", async () => {
    const r = await comoAnonimo(db, async () => {
      const info = (await umaLinha<{ j: { nome: string; tem_empreendimentos: boolean } }>(`select public.site_info('Imob-Site') as j`)).j;
      const lista = (await umaLinha<{ j: { codigo: string; logradouro: string | null; latitude: number; capa: { id: string } | null; empreendimento: string | null }[] }>(
        `select public.site_imoveis('imob-site') as j`,
      )).j;
      const detalhe = (await umaLinha<{ j: { codigo: string; midias: { tipo: string }[] } | null }>(`select public.site_imovel('imob-site', 'ap-1') as j`)).j;
      const naoPublicado = (await umaLinha<{ j: unknown }>(`select public.site_imovel('imob-site', 'AP-2') as j`)).j;
      const alugado = (await umaLinha<{ j: unknown }>(`select public.site_imovel('imob-site', 'AP-3') as j`)).j;
      const emps = (await umaLinha<{ j: { nome: string; unidades: number; aluguel_desde: number }[] }>(`select public.site_empreendimentos('imob-site') as j`)).j;
      const inexistente = (await umaLinha<{ j: unknown }>(`select public.site_info('nao-existe') as j`)).j;
      return { info, lista, detalhe, naoPublicado, alugado, emps, inexistente };
    });
    expect(r.info.nome).toBe("Imob Site Oficial");
    expect(r.info.tem_empreendimentos).toBe(true);
    expect(r.lista.map((i) => i.codigo).sort()).toEqual(["AP-1", "CASA-4"]);
    const ap1 = r.lista.find((i) => i.codigo === "AP-1")!;
    expect(ap1.logradouro).toBeNull();
    expect(ap1.latitude).toBe(-29.918);
    expect(ap1.capa?.id).toBe(foto["AP-1"]);
    expect(ap1.empreendimento).toBe("Residencial Sol");
    expect(r.detalhe?.codigo).toBe("AP-1");
    expect(r.detalhe?.midias.map((m) => m.tipo)).toEqual(["foto"]);
    expect(r.naoPublicado).toBeNull();
    expect(r.alugado).toBeNull();
    expect(r.emps).toHaveLength(1);
    expect(r.emps[0].unidades).toBe(1);
    expect(r.emps[0].aluguel_desde).toBe(1800);
    expect(r.inexistente).toBeNull();
  });

  it("com endereço liberado mostra rua e coordenada exata; site fora do ar não aparece", async () => {
    await comoUsuario(db, DONO, () => db.query(`update site_config set mostrar_endereco = true where organizacao_id = $1`, [org]));
    const exato = await comoAnonimo(db, async () => (await umaLinha<{ j: { logradouro: string; latitude: number } }>(`select public.site_imovel('imob-site', 'AP-1') as j`)).j);
    expect(exato.logradouro).toBe("Rua das Flores");
    expect(exato.latitude).toBe(-29.9177123);
    await comoUsuario(db, DONO, () => db.query(`update site_config set ativo = false, mostrar_endereco = false where organizacao_id = $1`, [org]));
    const fora = await comoAnonimo(db, async () => ({
      info: (await umaLinha<{ j: unknown }>(`select public.site_info('imob-site') as j`)).j,
      lista: (await umaLinha<{ j: unknown[] }>(`select public.site_imoveis('imob-site') as j`)).j,
      foto: (await umaLinha<{ ok: boolean }>(`select public.site_arquivo_publico($1) as ok`, [`${org}/${im["AP-1"]}/foto-AP-1.jpg`])).ok,
    }));
    expect(fora.info).toBeNull();
    expect(fora.lista).toEqual([]);
    expect(fora.foto).toBe(false);
    await comoUsuario(db, DONO, () => db.query(`update site_config set ativo = true where organizacao_id = $1`, [org]));
  });

  it("fotos: o anônimo só enxerga foto de imóvel publicado (não documentos)", async () => {
    const r = await comoAnonimo(db, async () => ({
      publicada: (await umaLinha<{ ok: boolean }>(`select public.site_arquivo_publico($1) as ok`, [`${org}/${im["AP-1"]}/foto-AP-1.jpg`])).ok,
      naoPublicada: (await umaLinha<{ ok: boolean }>(`select public.site_arquivo_publico($1) as ok`, [`${org}/${im["AP-2"]}/foto-AP-2.jpg`])).ok,
      alugado: (await umaLinha<{ ok: boolean }>(`select public.site_arquivo_publico($1) as ok`, [`${org}/${im["AP-3"]}/foto-AP-3.jpg`])).ok,
      documento: (await umaLinha<{ ok: boolean }>(`select public.site_arquivo_publico($1) as ok`, [`${org}/${im["AP-1"]}/matricula.pdf`])).ok,
      link: (await umaLinha<{ p: string | null }>(`select public.site_foto('imob-site', $1) as p`, [foto["AP-1"]])).p,
      linkNegado: (await umaLinha<{ p: string | null }>(`select public.site_foto('imob-site', $1) as p`, [foto["AP-2"]])).p,
    }));
    expect(r).toEqual({ publicada: true, naoPublicada: false, alugado: false, documento: false, link: `${org}/${im["AP-1"]}/foto-AP-1.jpg`, linkNegado: null });
  });

  it("contato vira lead (sem repetir) e a resposta não conta se o contato já existia", async () => {
    const r = await comoAnonimo(db, async () => {
      const a = (await umaLinha<{ j: unknown }>(
        `select public.site_contato('imob-site', $1) as j`,
        [JSON.stringify({ tipo: "contato", nome: "Ana", telefone: "(51) 98888-7777", mensagem: "Quero saber mais", imovel: "AP-1" })],
      )).j;
      const b = (await umaLinha<{ j: unknown }>(
        `select public.site_contato('imob-site', $1) as j`,
        [JSON.stringify({ tipo: "contato", nome: "Ana", telefone: "51988887777", mensagem: "Outra dúvida" })],
      )).j;
      const semContato = await erroDe(() => contato("imob-site", { nome: "Sem" }));
      const telefoneCurto = await erroDe(() => contato("imob-site", { nome: "Sem", telefone: "123" }));
      return { a, b, semContato, telefoneCurto };
    });
    // Só {ok}: quem chama não descobre se o telefone já era lead ou captação aberta.
    expect(r.a).toEqual({ ok: true });
    expect(r.b).toEqual({ ok: true });
    expect(r.semContato).toContain("telefone ou e-mail");
    expect(r.telefoneCurto).toContain("telefone ou e-mail");
    const lead = await umaLinha<{ origem: string; n: number; imovel: string }>(
      `select l.origem, (select count(*)::int from leads where organizacao_id = $1) as n, (select imovel_id::text from lead_imoveis li where li.lead_id = l.id) as imovel from leads l where l.nome = 'Ana'`,
      [org],
    );
    expect(lead).toEqual({ origem: "site", n: 1, imovel: im["AP-1"] });
    // O sistema continua sabendo que o segundo era repetido.
    const sol = (await db.query<{ duplicado: boolean }>(`select duplicado from site_solicitacoes where organizacao_id = $1 and tipo = 'contato' order by created_at, duplicado`, [org])).rows;
    expect(sol.map((s) => s.duplicado)).toEqual([false, true]);
  });

  it("agendar visita cria a visita na agenda e recusa horário ocupado, passado, fora do horário ou bloqueado (mesma mensagem)", async () => {
    const iso = horarioSP(3, "14:00");
    const r = await comoAnonimo(db, async () => {
      const ok = (await umaLinha<{ j: unknown }>(
        `select public.site_contato('imob-site', $1) as j`,
        [JSON.stringify({ tipo: "visita", nome: "Bruno", email: "bruno@exemplo.com", imovel: "AP-1", quando: iso })],
      )).j;
      const ocupado = await erroDe(() => contato("imob-site", { tipo: "visita", nome: "Caio", email: "caio@exemplo.com", imovel: "AP-1", quando: iso }));
      const passado = await erroDe(() =>
        contato("imob-site", { tipo: "visita", nome: "Caio", email: "caio@exemplo.com", imovel: "AP-1", quando: new Date(Date.now() - 86_400_000).toISOString() }),
      );
      const madrugada = await erroDe(() => contato("imob-site", { tipo: "visita", nome: "Caio", email: "caio@exemplo.com", imovel: "AP-1", quando: horarioSP(4, "03:00") }));
      const quebrado = await erroDe(() => contato("imob-site", { tipo: "visita", nome: "Caio", email: "caio@exemplo.com", imovel: "AP-1", quando: horarioSP(4, "10:15") }));
      const semImovel = await erroDe(() => contato("imob-site", { tipo: "visita", nome: "Caio", email: "c@x.com", quando: iso }));
      const lixo = await erroDe(() => contato("imob-site", { tipo: "visita", nome: "Caio", email: "c@x.com", imovel: "AP-1", quando: "amanhã" }));
      return { ok, ocupado, passado, madrugada, quebrado, semImovel, lixo };
    });
    expect(r.ok).toEqual({ ok: true });
    expect(r.ocupado).toContain("Esse horário não está disponível");
    expect(r.passado).toContain("a partir de daqui a 1 hora");
    expect(r.madrugada).toContain("entre 8h e 18h");
    expect(r.quebrado).toContain("entre 8h e 18h");
    expect(r.semImovel).toContain("Escolha o imóvel");
    expect(r.lixo).toContain("dia e o horário");
    const v = await umaLinha<{ status: string; titulo: string; lead: string; imovel_id: string; data_hora: Date }>(
      `select v.status, v.titulo, l.nome as lead, v.imovel_id, v.data_hora from visitas v join leads l on l.id = v.lead_id where v.organizacao_id = $1 and l.nome = 'Bruno'`,
      [org],
    );
    expect(v).toMatchObject({ status: "agendada", titulo: "Visita pedida pelo site", lead: "Bruno", imovel_id: im["AP-1"] });
    expect(new Date(v.data_hora).toISOString()).toBe(iso);
    const msg = await umaLinha<{ observacoes: string }>(`select observacoes from leads where nome = 'Bruno'`);
    expect(msg.observacoes).toContain("Quer visitar em");
    expect(msg.observacoes).toContain("às 14:00");

    // Período bloqueado do imóvel: a MESMA mensagem do horário ocupado (não revela a agenda).
    const bloq = horarioSP(5, "10:00");
    await comoUsuario(db, DONO, () =>
      db.query(`insert into imovel_indisponibilidades (imovel_id, inicio, fim, motivo) values ($1, $2::timestamptz - interval '1 day', $2::timestamptz + interval '1 day', 'Pintura')`, [
        im["AP-1"],
        bloq,
      ]),
    );
    const bloqueado = await comoAnonimo(db, () => erroDe(() => contato("imob-site", { tipo: "visita", nome: "Davi", email: "d@x.com", imovel: "AP-1", quando: bloq })));
    expect(bloqueado).toContain("Esse horário não está disponível");
  });

  it("'Anuncie seu imóvel' abre uma captação com os dados do imóvel; empreendimento vira lead de venda", async () => {
    await comoAnonimo(db, async () => {
      await contato("imob-site", { tipo: "captacao", nome: "Dona Elza", telefone: "51977776666", tipo_imovel: "casa", finalidade: "ambos", cidade: "Canoas", bairro: "Igara", quartos: "3", area: "120.5", valor: "450000" });
      await contato("imob-site", { tipo: "empreendimento", nome: "Fábio", email: "fabio@x.com", empreendimento: emp });
    });
    const c = await umaLinha<{ tipo: string; finalidades: string[]; bairro: string; quartos: number; area: string; valor_pretendido: string; origem: string }>(
      `select tipo, finalidades, bairro, quartos, area::text, valor_pretendido::text, origem from captacoes where proprietario_nome = 'Dona Elza'`,
    );
    expect(c).toEqual({ tipo: "casa", finalidades: ["locacao", "venda"], bairro: "Igara", quartos: 3, area: "120.50", valor_pretendido: "450000.00", origem: "site" });
    const l = await umaLinha<{ funil: string; observacoes: string }>(`select funil, observacoes from leads where nome = 'Fábio'`);
    expect(l.funil).toBe("venda");
    expect(l.observacoes).toContain("Residencial Sol");
    await comoUsuario(db, DONO, () => db.query(`update site_config set captacao_ativa = false where organizacao_id = $1`, [org]));
    const desligado = await comoAnonimo(db, () => erroDe(() => contato("imob-site", { tipo: "captacao", nome: "X", telefone: "51911112222" })));
    expect(desligado).toContain("não recebe anúncios");
    const empRuim = await comoAnonimo(db, () => erroDe(() => contato("imob-site", { tipo: "empreendimento", nome: "X", telefone: "51911112222", empreendimento: "nao-e-uuid" })));
    expect(empRuim).toContain("Empreendimento não encontrado");
    await comoUsuario(db, DONO, () => db.query(`update site_config set captacao_ativa = true where organizacao_id = $1`, [org]));
  });
});

describe("site público: limites contra abuso e texto limpo", () => {
  it("por telefone/e-mail: no máximo 3 por hora (inclui o 'Anuncie' repetido, que antes escapava do limite)", async () => {
    const r = await comoAnonimo(db, async () => ({
      terceira: await erroDe(() => contato("imob-site", { tipo: "contato", nome: "Ana", telefone: "51988887777", mensagem: "Terceira" })),
      quarta: await erroDe(() => contato("imob-site", { tipo: "contato", nome: "Ana", email: "outro@x.com", telefone: "(51) 9 8888-7777", mensagem: "Quarta" })),
      elza2: await erroDe(() => contato("imob-site", { tipo: "captacao", nome: "Dona Elza", telefone: "51977776666", mensagem: "de novo 2" })),
      elza3: await erroDe(() => contato("imob-site", { tipo: "captacao", nome: "Dona Elza", telefone: "51977776666", mensagem: "de novo 3" })),
      elza4: await erroDe(() => contato("imob-site", { tipo: "captacao", nome: "Dona Elza", telefone: "51977776666", mensagem: "de novo 4" })),
    }));
    expect(r.terceira).toBe("");
    expect(r.quarta).toContain("Muitas mensagens");
    expect(r.elza2).toBe("");
    expect(r.elza3).toBe("");
    expect(r.elza4).toContain("Muitas mensagens");
    const notas = await umaLinha<{ n: number }>(
      `select count(*)::int as n from captacao_eventos e join captacoes c on c.id = e.captacao_id where c.proprietario_nome = 'Dona Elza' and e.tipo = 'nota'`,
    );
    expect(notas.n).toBe(2);
  });

  it("o mesmo envio repetido (clique duplo) não grava de novo", async () => {
    await comoAnonimo(db, async () => {
      expect(await erroDe(() => contato("imob-site", { tipo: "contato", nome: "Zeca", email: "zeca@x.com", mensagem: "Oi" }))).toBe("");
      expect(await erroDe(() => contato("imob-site", { tipo: "contato", nome: "Zeca", email: "zeca@x.com", mensagem: "Oi" }))).toBe("");
    });
    const n = await umaLinha<{ n: number; eventos: number }>(
      `select (select count(*)::int from site_solicitacoes where email = 'zeca@x.com') as n,
              (select count(*)::int from lead_eventos e join leads l on l.id = e.lead_id where l.email = 'zeca@x.com') as eventos`,
    );
    expect(n).toEqual({ n: 1, eventos: 1 });
  });

  it("visitas: no máximo 2 pedidos em aberto por contato", async () => {
    const r = await comoAnonimo(db, async () => ({
      segunda: await erroDe(() => contato("imob-site", { tipo: "visita", nome: "Bruno", email: "bruno@exemplo.com", imovel: "AP-1", quando: horarioSP(3, "16:00") })),
      terceira: await erroDe(() => contato("imob-site", { tipo: "visita", nome: "Bruno", email: "bruno@exemplo.com", imovel: "AP-1", quando: horarioSP(4, "11:00") })),
    }));
    expect(r.segunda).toBe("");
    expect(r.terceira).toContain("Você já tem pedidos de visita em aberto");
  });

  it("por organização: 60 por hora pelo site — e o spam do site não tira os leads dos portais", async () => {
    await db.query(`insert into site_solicitacoes (organizacao_id, tipo, origem, nome) select $1, 'contato', 'site', 'spam' from generate_series(1, 60)`, [org]);
    const r = await comoAnonimo(db, async () => ({
      site: await erroDe(() => contato("imob-site", { tipo: "contato", nome: "Nova", telefone: "51955554444" })),
      portal: await erroDe(() => db.query(`select public.portal_receber_lead($1, 'zap', $2)`, [tokenLeads, JSON.stringify({ nome: "Pelo Zap", telefone: "11966665555" })])),
    }));
    await db.query(`delete from site_solicitacoes where nome = 'spam'`);
    expect(r.site).toContain("Muitas mensagens");
    expect(r.portal).toBe("");
  });

  it("tira caracteres de controle (o \\r sozinho quebrava o calendário .ics)", async () => {
    await comoAnonimo(db, () =>
      contato("imob-site", {
        tipo: "visita",
        nome: "Eva\rSUMMARY:falso",
        email: "eva@x.com",
        imovel: "AP-1",
        quando: horarioSP(8, "09:30"),
        mensagem: "oi\r\nlinha 2\rEND:VEVENT\u0001",
      }),
    );
    const v = await umaLinha<{ contato_nome: string; observacoes: string; lead: string; sol: string }>(
      `select v.contato_nome, v.observacoes, l.observacoes as lead, s.mensagem as sol
         from visitas v join leads l on l.id = v.lead_id join site_solicitacoes s on s.visita_id = v.id
        where l.email = 'eva@x.com'`,
    );
    expect(v.contato_nome).toBe("Eva SUMMARY:falso");
    expect(v.observacoes).toContain("oi\nlinha 2\nEND:VEVENT");
    for (const t of [v.contato_nome, v.observacoes, v.lead, v.sol]) {
      expect(t).not.toContain("\r");
      expect(t).not.toContain("\u0001");
    }
  });
});

describe("portais", () => {
  it("feed respeita o site, as exceções por imóvel e o portal ativo", async () => {
    await comoUsuario(db, DONO, async () => {
      await db.query(`insert into site_portais (portal, ativo, publicar_todos) values ('zap', true, true), ('olx', true, false), ('vivareal', false, true)`);
      await db.query(`insert into portal_imoveis (imovel_id, portal, publicado, destaque, codigo_portal) values ($1, 'olx', true, 'destaque', 'OLX-77'), ($2, 'zap', false, 'normal', null)`, [
        im["AP-2"],
        im["CASA-4"],
      ]);
    });
    const r = await comoAnonimo(db, async () => {
      const feed = async (p: string) =>
        (await umaLinha<{ j: { ativo: boolean; configurado: boolean; imoveis: { codigo: string; fotos: string[]; destaque: string; codigo_portal: string | null }[]; site: { slug: string } } | null }>(
          `select public.portal_feed($1, $2) as j`,
          [token, p],
        )).j;
      return {
        zap: await feed("zap"),
        olx: await feed("olx"),
        vivareal: await feed("vivareal"),
        semConfig: (await umaLinha<{ j: unknown }>(`select public.portal_feed($1, 'zap') as j`, [ZERO])).j,
        portalRuim: (await umaLinha<{ j: unknown }>(`select public.portal_feed($1, 'facebook') as j`, [token])).j,
        fotoPortal: (await umaLinha<{ ok: boolean }>(`select public.site_arquivo_publico($1) as ok`, [`${org}/${im["AP-2"]}/foto-AP-2.jpg`])).ok,
      };
    });
    expect(r.zap?.imoveis.map((i) => i.codigo)).toEqual(["AP-1"]);
    expect(r.zap?.configurado).toBe(true);
    expect(r.zap?.imoveis[0].fotos).toEqual([foto["AP-1"]]);
    expect(r.zap?.site.slug).toBe("imob-site");
    expect(r.olx?.imoveis.map((i) => [i.codigo, i.destaque, i.codigo_portal])).toEqual([["AP-2", "destaque", "OLX-77"]]);
    // Pausado: feed válido e vazio (o portal tira os anúncios), não "não encontrado".
    expect(r.vivareal).toMatchObject({ ativo: false, configurado: true, imoveis: [] });
    expect(r.semConfig).toBeNull();
    expect(r.portalRuim).toBeNull();
    // Foto de imóvel que está só no portal (fora do site) também é pública.
    expect(r.fotoPortal).toBe(true);
  });

  it("o banco calcula o envio sozinho: enviado, falhas com os textos dele e quem saiu do feed", async () => {
    await comoUsuario(db, DONO, async () => {
      await db.query(`update imoveis set descricao = $1 where id = $2`, [DESCRICAO, im["AP-1"]]);
      await db.query(`update portal_imoveis set publicado = true where imovel_id = $1 and portal = 'zap'`, [im["CASA-4"]]);
    });
    const r1 = (await comoAnonimo(db, () => sincronizar(token, "zap"))).j;
    expect(r1?.enviados).toEqual([im["AP-1"]]);
    expect(r1?.falhas).toEqual([
      {
        imovel_id: im["CASA-4"],
        codigo: "CASA-4",
        problemas: [
          "Envie pelo menos 1 foto.",
          "Escreva uma descrição com pelo menos 50 letras.",
          "Preencha a UF (ex.: SP).",
          "Preencha o CEP (8 números).",
          "Informe a área em m².",
          "Informe o número de quartos.",
        ],
      },
    ]);
    const status = async () =>
      (await db.query<{ codigo: string; ultimo_status: string | null; ultimas_falhas: string[]; enviado: boolean }>(
        `select i.codigo, pi.ultimo_status, pi.ultimas_falhas, pi.ultima_sincronizacao is not null as enviado from portal_imoveis pi join imoveis i on i.id = pi.imovel_id where pi.portal = 'zap' order by i.codigo`,
      )).rows;
    let st = await status();
    expect(st.map((s) => [s.codigo, s.ultimo_status, s.enviado])).toEqual([
      ["AP-1", "enviado", true],
      ["CASA-4", "falha", false],
    ]);
    expect(st[1].ultimas_falhas).toContain("Envie pelo menos 1 foto.");

    // Com o link do feed não dá mais para mandar a lista pronta: a função antiga não é pública…
    const anonAntiga = await comoAnonimo(db, () =>
      erroDe(() => db.query(`select public.portal_registrar($1, 'zap', $2)`, [token, JSON.stringify({ enviados: [], falhas: [{ imovel_id: im["AP-1"], problemas: ["Seu plano venceu, ligue 0800"] }] })])),
    );
    expect(anonAntiga).toContain("permission denied");
    // …e, mesmo logado, as listas enviadas são ignoradas: vale o que o banco calcula.
    await comoUsuario(db, DONO, () =>
      db.query(`select public.portal_registrar($1, 'zap', $2)`, [token, JSON.stringify({ enviados: [], falhas: [{ imovel_id: im["AP-1"], codigo: "AP-1", problemas: ["Seu plano venceu, ligue 0800"] }] })]),
    );
    st = await status();
    expect(st.map((s) => [s.codigo, s.ultimo_status])).toEqual([
      ["AP-1", "enviado"],
      ["CASA-4", "falha"],
    ]);
    const forjado = await umaLinha<{ n: number }>(
      `select (select count(*)::int from portal_imoveis where 'Seu plano venceu, ligue 0800' = any (ultimas_falhas))
            + (select count(*)::int from portal_sincronizacoes where falhas::text like '%Seu plano%') as n`,
    );
    expect(forjado.n).toBe(0);
    // Conferência "manual" é só para quem é da imobiliária.
    expect(await comoAnonimo(db, () => erroDe(() => sincronizar(token, "zap", "manual")))).toContain("Só a imobiliária");

    // AP-1 sai do feed (tirado do portal): na próxima busca fica "fora".
    await comoUsuario(db, DONO, () => db.query(`update portal_imoveis set publicado = false where imovel_id = $1 and portal = 'zap'`, [im["AP-1"]]));
    await comoAnonimo(db, () => sincronizar(token, "zap"));
    st = await status();
    expect(st.map((s) => s.ultimo_status)).toEqual(["fora", "falha"]);
    await comoUsuario(db, DONO, () => db.query(`update portal_imoveis set publicado = null where imovel_id = $1 and portal = 'zap'`, [im["AP-1"]]));

    const log = (await db.query<{ origem: string; total_enviados: number; total_falhas: number }>(
      `select origem, total_enviados, total_falhas from portal_sincronizacoes where portal = 'zap' order by gerado_em, id`,
    )).rows;
    expect(log.map((l) => [l.origem, l.total_enviados, l.total_falhas])).toEqual([
      ["portal", 1, 1],
      ["portal", 1, 1],
      ["portal", 0, 1],
    ]);
    const tokenErrado = await comoAnonimo(db, () => erroDe(() => sincronizar(ZERO, "zap")));
    expect(tokenErrado).toContain("inválido");
  });

  it("“Conferir agora” (manual) não marca enviado nem abre anúncio no Histórico; só a busca do portal", async () => {
    const ap5 = await comoUsuario(db, DONO, async () => {
      const id = (await umaLinha<{ id: string }>(
        `insert into imoveis (codigo, tipo, finalidades, status, publicar_site, logradouro, numero, bairro, cidade, uf, cep, quartos, area_util, valor_aluguel)
         values ('AP-5', 'apartamento', '{locacao}', 'disponivel', true, 'Rua B', '5', 'Centro', 'Canoas', 'RS', '92010000', 1, 40, 1200) returning id`,
      )).id;
      await db.query(`insert into imovel_midias (imovel_id, tipo, path) values ($1, 'foto', $2)`, [id, `${org}/${id}/f.jpg`]);
      return id;
    });
    const linha = async () =>
      (await db.query<{ ultimo_status: string | null; enviado: boolean; conferido: boolean }>(
        `select ultimo_status, ultima_sincronizacao is not null as enviado, verificado_em is not null as conferido from portal_imoveis where imovel_id = $1 and portal = 'zap'`,
        [ap5],
      )).rows[0];
    const anuncios = async () => (await umaLinha<{ n: number }>(`select count(*)::int as n from imovel_anuncios where imovel_id = $1`, [ap5])).n;

    // 1) O portal busca: sem descrição, AP-5 vai como falha.
    await comoAnonimo(db, () => sincronizar(token, "zap"));
    expect(await linha()).toMatchObject({ ultimo_status: "falha", enviado: false });
    // 2) Corrige e confere no sistema: fica pronto, aguardando o portal — sem "enviado" e sem anúncio.
    await comoUsuario(db, DONO, () => db.query(`update imoveis set descricao = $1 where id = $2`, [DESCRICAO, ap5]));
    const manual = (await comoUsuario(db, DONO, () => sincronizar(token, "zap", "manual"))).j;
    expect(manual?.enviados).toContain(ap5);
    expect(await linha()).toEqual({ ultimo_status: null, enviado: false, conferido: true });
    expect(await anuncios()).toBe(0);
    const ultimoLog = await umaLinha<{ origem: string }>(`select origem from portal_sincronizacoes order by gerado_em desc, id desc limit 1`);
    expect(ultimoLog.origem).toBe("manual");
    // AP-1 continua como estava (a conferência não mexe em quem já foi enviado).
    expect((await umaLinha<{ s: string }>(`select ultimo_status as s from portal_imoveis where imovel_id = $1 and portal = 'zap'`, [im["AP-1"]])).s).toBe("enviado");
    // 3) Agora o portal busca de verdade: enviado e anúncio aberto no Histórico.
    await comoAnonimo(db, () => sincronizar(token, "zap"));
    expect(await linha()).toMatchObject({ ultimo_status: "enviado", enviado: true });
    expect(await anuncios()).toBe(1);
    await comoUsuario(db, DONO, () => db.query(`delete from imoveis where id = $1`, [ap5]));
  });

  it("o feed abre e encerra o anúncio na aba Histórico do imóvel (datas de Brasília; sem mexer nos registrados à mão)", async () => {
    await comoUsuario(db, DONO, async () => {
      // AP-2 completo para a OLX (já tinha anúncio registrado à mão).
      await db.query(`update imoveis set bairro = 'Centro', uf = 'RS', cep = '92010-000', area_util = 50, quartos = 1, descricao = $1 where id = $2`, [DESCRICAO, im["AP-2"]]);
      await db.query(`insert into imovel_anuncios (imovel_id, portal, inicio, valor) values ($1, 'OLX', current_date - 10, 1500)`, [im["AP-2"]]);
    });
    const anuncios = () =>
      comoUsuario(db, DONO, async () =>
        (await db.query<{ codigo: string; portal: string; origem: string; valor: string | null; aberto: boolean; inicio_hoje: boolean; fim_hoje: boolean | null }>(
          `select i.codigo, a.portal, a.origem, a.valor::text as valor, a.fim is null as aberto,
                  a.inicio = ${HOJE_SP} as inicio_hoje, a.fim = ${HOJE_SP} as fim_hoje
             from imovel_anuncios a join imoveis i on i.id = a.imovel_id order by i.codigo, a.portal, a.origem`,
        )).rows,
      );
    await comoAnonimo(db, async () => {
      await sincronizar(token, "zap");
      await sincronizar(token, "olx");
    });
    expect(await anuncios()).toEqual([
      { codigo: "AP-1", portal: "ZAP Imóveis", origem: "feed", valor: "1800.00", aberto: true, inicio_hoje: true, fim_hoje: null },
      { codigo: "AP-2", portal: "OLX", origem: "manual", valor: "1500.00", aberto: true, inicio_hoje: false, fim_hoje: null },
    ]);
    // O preço muda no cadastro: o anúncio do feed acompanha na próxima busca.
    await comoUsuario(db, DONO, () => db.query(`update imoveis set valor_aluguel = 1850 where id = $1`, [im["AP-1"]]));
    await comoAnonimo(db, () => sincronizar(token, "zap"));
    expect((await anuncios())[0]).toMatchObject({ valor: "1850.00", aberto: true });
    // Saiu de todos os feeds: o do feed encerra hoje (Brasília); o registrado à mão continua como estava.
    await comoUsuario(db, DONO, async () => {
      await db.query(`update portal_imoveis set publicado = false where imovel_id = $1 and portal = 'zap'`, [im["AP-1"]]);
      await db.query(`update portal_imoveis set publicado = false where imovel_id = $1 and portal = 'olx'`, [im["AP-2"]]);
    });
    await comoAnonimo(db, async () => {
      await sincronizar(token, "zap");
      await sincronizar(token, "olx");
    });
    expect(await anuncios()).toEqual([
      { codigo: "AP-1", portal: "ZAP Imóveis", origem: "feed", valor: "1850.00", aberto: false, inicio_hoje: true, fim_hoje: true },
      { codigo: "AP-2", portal: "OLX", origem: "manual", valor: "1500.00", aberto: true, inicio_hoje: false, fim_hoje: null },
    ]);
    await comoUsuario(db, DONO, async () => {
      await db.query(`update imoveis set valor_aluguel = 1800 where id = $1`, [im["AP-1"]]);
      await db.query(`update portal_imoveis set publicado = null where imovel_id = $1 and portal = 'zap'`, [im["AP-1"]]);
      await db.query(`update portal_imoveis set publicado = true where imovel_id = $1 and portal = 'olx'`, [im["AP-2"]]);
    });
  });

  it("o serviço do feed monta o XML e o registro bate com o que o banco calcula; a prévia não registra", async () => {
    const anonimo = clienteFalso();
    const dono = clienteFalso(DONO);
    const zap = await montarFeed(anonimo as never, token, "zap", { origem: "https://sistema.exemplo", registro: "portal", agente: "teste" });
    expect(zap?.resultado.enviar.map((i) => i.codigo)).toEqual(["AP-1"]);
    expect(zap?.resultado.falhas.map((f) => f.codigo)).toEqual(["CASA-4"]);
    expect(zap?.registrado).toBe(true);
    expect(zap?.registro?.enviados).toEqual(zap?.resultado.enviar.map((i) => i.id));
    expect(zap?.registro?.falhas).toEqual(zap?.resultado.falhas);
    expect(zap?.xml).toContain("<ListingID>AP-1</ListingID>");
    expect(zap?.xml).toContain(`<Item medium="image" primary="true">https://sistema.exemplo/s/imob-site/foto/${foto["AP-1"]}</Item>`);
    expect(zap?.xml).toContain("<DetailViewUrl>https://sistema.exemplo/s/imob-site/imovel/AP-1</DetailViewUrl>");
    expect(zap?.xml).toContain('<RentalPrice currency="BRL" period="Monthly">1800</RentalPrice>');
    // AP-1 voltou ao feed no mesmo dia: o anúncio do feed reabre (sem duplicar).
    const an = (await db.query<{ n: number; abertos: number }>(
      `select count(*)::int as n, count(*) filter (where fim is null)::int as abertos from imovel_anuncios where imovel_id = $1 and portal = 'ZAP Imóveis'`,
      [im["AP-1"]],
    )).rows[0];
    expect(an).toEqual({ n: 1, abertos: 1 });

    // "Ver o arquivo" (prévia) não registra nada.
    const contar = async () => (await umaLinha<{ n: number }>(`select count(*)::int as n from portal_sincronizacoes`)).n;
    const antes = await contar();
    const previa = await montarFeed(anonimo as never, token, "zap", { origem: "https://x", registro: null });
    expect(previa?.xml).toContain("<ListingID>AP-1</ListingID>");
    expect(previa?.registrado).toBe(false);
    expect(await contar()).toBe(antes);

    // Conferência no sistema: anônimo não consegue; quem é da imobiliária sim.
    expect((await montarFeed(anonimo as never, token, "olx", { origem: "https://x", registro: "manual" }))?.registrado).toBe(false);
    const olx = await montarFeed(dono as never, token, "olx", { origem: "https://sistema.exemplo", registro: "manual" });
    expect(olx?.registrado).toBe(true);
    expect(olx?.resultado.enviar.map((i) => i.codigo)).toEqual(["AP-2"]);
    expect(olx?.registro?.enviados).toEqual([im["AP-2"]]);
    expect(await montarFeed(anonimo as never, token, "vivareal", { origem: "https://x", registro: "portal" })).toMatchObject({ ativo: false, configurado: true, elegiveis: 0 });
    expect(await montarFeed(anonimo as never, ZERO, "zap", { origem: "https://x", registro: "portal" })).toBeNull();
    const st = (await db.query<{ codigo: string; portal: string; ultimo_status: string | null }>(
      `select i.codigo, pi.portal, pi.ultimo_status from portal_imoveis pi join imoveis i on i.id = pi.imovel_id order by pi.portal, i.codigo`,
    )).rows;
    expect(st).toEqual([
      // Conferido (manual) depois de ter saído do feed: pronto, aguardando a busca do portal.
      { codigo: "AP-2", portal: "olx", ultimo_status: null },
      { codigo: "AP-1", portal: "zap", ultimo_status: "enviado" },
      { codigo: "CASA-4", portal: "zap", ultimo_status: "falha" },
    ]);
    // O XML leva o IPTU do ano (o cadastro guarda o do mês).
    await comoUsuario(db, DONO, () => db.query(`update imoveis set valor_iptu = 150 where id = $1`, [im["AP-1"]]));
    const comIptu = await montarFeed(anonimo as never, token, "zap", { origem: "https://sistema.exemplo", registro: null });
    expect(comIptu?.xml).toContain('<YearlyTax currency="BRL">1800</YearlyTax>');
    await comoUsuario(db, DONO, () => db.query(`update portal_imoveis set publicado = false where imovel_id = $1 and portal = 'zap'`, [im["CASA-4"]]));
  });

  it("lead do portal entra pelo endereço de LEADS (não pelo do feed), com a origem do portal e ligado ao imóvel", async () => {
    expect(tokenLeads).not.toBe(token);
    const r = await comoAnonimo(db, async () => ({
      ok: (await umaLinha<{ j: unknown }>(`select public.portal_receber_lead($1, 'vivareal', $2) as j`, [
        tokenLeads,
        JSON.stringify({ nome: "Gabi", telefone: "11955554444", mensagem: "Ainda disponível?", imovel: "AP-1", funil: "locacao" }),
      ])).j,
      peloFeed: await erroDe(() => db.query(`select public.portal_receber_lead($1, 'vivareal', $2)`, [token, JSON.stringify({ nome: "X", telefone: "11955550000" })])),
    }));
    expect(r.ok).toEqual({ ok: true });
    expect(r.peloFeed).toContain("inválido");
    const l = await umaLinha<{ id: string; origem: string; imovel: string }>(
      `select l.id, l.origem, (select imovel_id::text from lead_imoveis where lead_id = l.id) as imovel from leads l where l.nome = 'Gabi'`,
    );
    expect(l).toMatchObject({ origem: "vivareal", imovel: im["AP-1"] });
    const sol = await umaLinha<{ tipo: string; origem: string }>(`select tipo, origem from site_solicitacoes where lead_id = $1`, [l.id]);
    expect(sol).toEqual({ tipo: "portal", origem: "vivareal" });
    const ruim = await comoAnonimo(db, () => erroDe(() => db.query(`select public.portal_receber_lead($1, 'zap', '{"nome":"X","telefone":"1199"}')`, [ZERO])));
    expect(ruim).toContain("inválido");
    const portalRuim = await comoAnonimo(db, () => erroDe(() => db.query(`select public.portal_receber_lead($1, 'facebook', '{}')`, [tokenLeads])));
    expect(portalRuim).toContain("Portal desconhecido");
  });

  it("lead reenviado pelo portal (mesmo id) não repete; limite de 120 por hora por portal", async () => {
    const enviar = (portal: string, p: Record<string, unknown>) =>
      comoAnonimo(db, () => erroDe(() => db.query(`select public.portal_receber_lead($1, $2, $3)`, [tokenLeads, portal, JSON.stringify(p)])));
    expect(await enviar("olx", { nome: "Hugo", telefone: "11977771111", id_externo: "L-77" })).toBe("");
    expect(await enviar("olx", { nome: "Hugo", telefone: "11977771111", id_externo: "L-77" })).toBe("");
    const n = await umaLinha<{ sol: number; eventos: number }>(
      `select (select count(*)::int from site_solicitacoes where id_externo = 'L-77') as sol,
              (select count(*)::int from lead_eventos e join leads l on l.id = e.lead_id where l.nome = 'Hugo') as eventos`,
    );
    expect(n).toEqual({ sol: 1, eventos: 1 });
    await db.query(`insert into site_solicitacoes (organizacao_id, tipo, origem, nome) select $1, 'portal', 'olx', 'spam' from generate_series(1, 120)`, [org]);
    const cheio = await enviar("olx", { nome: "Íris", telefone: "11977772222" });
    const outroPortal = await enviar("zap", { nome: "Íris", telefone: "11977772222" });
    await db.query(`delete from site_solicitacoes where nome = 'spam'`);
    expect(cheio).toContain("Muitas mensagens");
    expect(outroPortal).toBe("");
  });

  it("lead do portal sem o tipo de negócio usa o funil do imóvel (só venda → venda)", async () => {
    await comoAnonimo(db, async () => {
      await db.query(`select public.portal_receber_lead($1, 'zap', $2)`, [tokenLeads, JSON.stringify({ nome: "Heitor", telefone: "11944443333", imovel: "CASA-4" })]);
      await db.query(`select public.portal_receber_lead($1, 'olx', $2)`, [tokenLeads, JSON.stringify({ nome: "Iara", telefone: "11933332222", imovel: "AP-1" })]);
      await db.query(`select public.portal_receber_lead($1, 'olx', $2)`, [tokenLeads, JSON.stringify({ nome: "Jonas", telefone: "11922221111" })]);
    });
    const funil = async (nome: string) => (await umaLinha<{ funil: string }>(`select funil from leads where nome = $1`, [nome])).funil;
    expect(await funil("Heitor")).toBe("venda");
    expect(await funil("Iara")).toBe("locacao");
    expect(await funil("Jonas")).toBe("locacao");
  });
});

describe("portais: o banco e o sistema separam os imóveis do mesmo jeito", () => {
  let orgE: string;
  let tokenE: string;
  const e: Record<string, string> = {};

  beforeAll(async () => {
    orgE = await comoUsuario(db, EQUIV, async () => (await umaLinha<{ id: string }>(`select public.criar_organizacao('Imob Equiv') as id`)).id);
    await comoUsuario(db, EQUIV, async () => {
      tokenE = (await umaLinha<{ t: string }>(`insert into site_config (slug, ativo) values ('imob-equiv', true) returning portais_token as t`)).t;
      await db.query(`insert into site_portais (portal, ativo, publicar_todos, limite_anuncios, limite_destaques) values ('zap', true, true, 3, 1), ('olx', true, true, null, null)`);
      const cols = "codigo, tipo, finalidades, status, publicar_site, logradouro, numero, bairro, cidade, uf, cep, quartos, area_util, area_total, valor_aluguel, valor_venda, descricao";
      const ok = `'apartamento', '{locacao}', 'disponivel', true, 'Rua A', '1', 'Centro', 'Canoas', 'RS', '92010000', 2, 50, null, 1500, null, '${DESCRICAO}'`;
      // Vários no MESMO comando: mesmo created_at (empate desfeito pelo id, igual nos dois lados).
      const linhas = (
        await db.query<{ id: string; codigo: string }>(
          `insert into imoveis (${cols}) values
             ('E-01', ${ok}),
             ('E-02', 'Sítio/Chácara', '{venda}', 'disponivel', true, null, null, 'Rural', 'Canoas', 'RS', '92010000', null, null, 5000, null, 900000, '${DESCRICAO}'),
             ('E-03', 'terreno', '{venda}', 'disponivel', true, null, null, 'Centro', 'Canoas', 'RS', '92010-000', null, null, 300, null, 200000, '${DESCRICAO}'),
             ('E-04', 'sala comercial', '{locacao}', 'disponivel', true, 'Rua A', '2', 'Centro', 'Canoas', 'RS', '92010000', null, 30, null, 900, null, '${DESCRICAO}'),
             ('E-05', 'outro', '{locacao}', 'disponivel', true, 'Rua A', '3', 'Centro', 'Canoas', 'RS', '92010000', 2, 50, null, 1500, null, '${DESCRICAO}'),
             ('E-06', 'apartamento', '{locacao}', 'disponivel', true, 'Rua A', '4', 'Centro', 'Canoas', 'RS', '92010000', 2, 50, null, null, 500000, '${DESCRICAO}'),
             ('E-07', 'Casa de Condomínio', '{locacao}', 'disponivel', true, 'Rua A', '5', '   ', 'Canoas', 'RS', '92010000', 3, 90, null, 2500, null, '${DESCRICAO}'),
             ('E-08', 'cobertura', '{locacao}', 'disponivel', true, 'Rua A', '6', 'Centro', 'Canoas', 'S1', '9201000', 3, 120, null, 4000, null, '${DESCRICAO}'),
             ('E-09', 'apartamento', '{locacao}', 'disponivel', true, 'Rua A', '7', 'Centro', 'Canoas', 'RS', '92010000', 2, 0, null, 1500, null, '${DESCRICAO}'),
             ('E-10', 'apartamento', '{locacao}', 'disponivel', true, 'Rua A', '8', 'Centro', 'Canoas', 'RS', '92010000', 2, 50, null, 1500, null, '  curta   demais   ' || repeat(' ', 60)),
             ('E-11', ${ok}), ('E-12', ${ok}), ('E-13', ${ok}), ('E-14', ${ok}), ('E-15', ${ok})
           returning id, codigo`,
        )
      ).rows;
      for (const l of linhas) e[l.codigo] = l.id;
      for (const l of linhas) {
        if (l.codigo === "E-13") continue; // sem foto
        await db.query(`insert into imovel_midias (imovel_id, tipo, path) values ($1, 'foto', $2)`, [l.id, `${orgE}/${l.id}/f.jpg`]);
      }
      await db.query(`insert into portal_imoveis (imovel_id, portal, destaque) values ($1, 'zap', 'super_destaque'), ($2, 'zap', 'destaque'), ($3, 'zap', 'destaque')`, [
        e["E-11"],
        e["E-12"],
        e["E-04"],
      ]);
    });
  });

  it("mesmas falhas (e textos), mesma ordem e mesmo limite do plano — ZAP e OLX", async () => {
    for (const portal of ["zap", "olx"] as const) {
      const feed = await montarFeed(clienteFalso() as never, tokenE, portal, { origem: "https://x", registro: "portal" });
      const reg = feed?.registro;
      expect(reg, portal).toBeTruthy();
      const ordenar = <T extends { codigo: string }>(l: T[]) => [...l].sort((a, b) => a.codigo.localeCompare(b.codigo));
      expect(reg?.enviados, portal).toEqual(feed?.resultado.enviar.map((i) => i.id));
      expect(reg?.fora_limite, portal).toEqual(feed?.resultado.foraDoLimite.map((i) => i.id));
      expect(ordenar(reg?.falhas ?? []), portal).toEqual(ordenar(feed?.resultado.falhas ?? []));
      expect(reg?.falhas.map((f) => f.codigo).sort(), portal).toEqual(["E-02", "E-05", "E-06", "E-07", "E-08", "E-09", "E-10", "E-13"]);
    }
    // No ZAP (limite 3): super destaque, depois os destaques; os normais ficam fora do limite.
    const dados = (await comoAnonimo(db, () => umaLinha<{ j: { imoveis: ImovelPortal[]; limite_anuncios: number } }>(`select public.portal_feed($1, 'zap') as j`, [tokenE]))).j;
    const ts = selecionarParaFeed(dados.imoveis, "zap", { anuncios: dados.limite_anuncios });
    const codigos = ts.enviar.map((i) => i.codigo);
    expect(codigos[0]).toBe("E-11");
    expect(codigos.slice(1).sort()).toEqual(["E-04", "E-12"]);
    expect(ts.foraDoLimite.map((i) => i.codigo).sort()).toEqual(["E-01", "E-03", "E-14", "E-15"]);
  });

  it("desligar o portal: o feed continua respondendo, vazio (não 404), e os anúncios do feed encerram hoje", async () => {
    const abertos = async (portal: string) =>
      (await umaLinha<{ n: number }>(`select count(*)::int as n from imovel_anuncios where organizacao_id = $1 and portal = $2 and fim is null`, [orgE, portal])).n;
    expect(await abertos("ZAP Imóveis")).toBe(3);
    await comoUsuario(db, EQUIV, () => db.query(`delete from site_portais where portal = 'zap'`));
    expect(await abertos("ZAP Imóveis")).toBe(0);
    const fechados = await umaLinha<{ n: number }>(`select count(*)::int as n from imovel_anuncios where organizacao_id = $1 and portal = 'ZAP Imóveis' and fim = ${HOJE_SP}`, [orgE]);
    expect(fechados.n).toBe(3);
    expect((await umaLinha<{ n: number }>(`select count(*)::int as n from portal_imoveis where organizacao_id = $1 and portal = 'zap'`, [orgE])).n).toBe(0);
    const feed = await comoAnonimo(db, async () => (await umaLinha<{ j: unknown }>(`select public.portal_feed($1, 'zap') as j`, [tokenE])).j);
    expect(feed).toMatchObject({ ativo: false, configurado: false, imoveis: [] });
    const xml = await montarFeed(clienteFalso() as never, tokenE, "zap", { origem: "https://x", registro: "portal" });
    expect(xml).not.toBeNull();
    expect(xml?.xml).toContain("<Listings></Listings>");
    expect(xml?.registrado).toBe(false);
    expect(await abertos("OLX")).toBeGreaterThan(0);
  });

  it("excluir o site: o endereço antigo do feed responde vazio, os anúncios encerram e o endereço fica reservado", async () => {
    await comoUsuario(db, EQUIV, () => db.query(`delete from site_config where organizacao_id = $1`, [orgE]));
    const r = await comoAnonimo(db, async () => ({
      feed: (await umaLinha<{ j: unknown }>(`select public.portal_feed($1, 'olx') as j`, [tokenE])).j,
      registrar: await erroDe(() => sincronizar(tokenE, "olx")),
    }));
    expect(r.feed).toMatchObject({ ativo: false, configurado: false, imoveis: [] });
    expect(r.registrar).toContain("inválido");
    expect((await umaLinha<{ n: number }>(`select count(*)::int as n from imovel_anuncios where organizacao_id = $1 and origem = 'feed' and fim is null`, [orgE])).n).toBe(0);
    expect((await umaLinha<{ n: number }>(`select count(*)::int as n from portal_imoveis where organizacao_id = $1`, [orgE])).n).toBe(0);
    // Outra imobiliária não pega o endereço que acabou de ser liberado.
    const pegar = await comoUsuario(db, INTRUSO, async () => {
      await umaLinha(`select public.criar_organizacao('Aproveitadora') as id`);
      return erroDe(() => db.query(`insert into site_config (slug) values ('imob-equiv')`));
    });
    expect(pegar).toContain("já está em uso");
    // A própria imobiliária pode voltar a usar.
    expect(await comoUsuario(db, EQUIV, () => erroDe(() => db.query(`insert into site_config (slug) values ('imob-equiv')`)))).toBe("");
    // Excluir a organização inteira continua funcionando (a exclusão em cascata não guarda nada).
    expect(await erroDe(() => db.query(`delete from organizacoes where id = $1`, [orgE]))).toBe("");
  });
});

describe("configuração e isolamento", () => {
  it("valida slug, cores, GA4 e domínio; slug é único e domínio só abre verificado", async () => {
    const r = await comoUsuario(db, OUTRO, async () => ({
      slugRuim: await erroDe(() => db.query(`insert into site_config (slug) values ('Imob Legal!')`)),
      slugRepetido: await erroDe(() => db.query(`insert into site_config (slug) values ('imob-site')`)),
      cor: await erroDe(() => db.query(`insert into site_config (slug, cor_primaria) values ('outra-imob', 'azul')`)),
      ga: await erroDe(() => db.query(`insert into site_config (slug, ga4_id) values ('outra-imob', 'UA-123')`)),
    }));
    expect(r.slugRuim).toContain("site_config_slug_check");
    expect(r.slugRepetido).toContain("site_config_slug_unico");
    expect(r.cor).toContain("site_config_cores_check");
    expect(r.ga).toContain("site_config_ga4_check");
    await comoUsuario(db, DONO, () => db.query(`update site_config set dominio = 'imobsite.com.br', dominio_verificado_em = now() where organizacao_id = $1`, [org]));
    const verificado = await umaLinha<{ v: boolean }>(`select dominio_verificado_em is not null as v from site_config where organizacao_id = $1`, [org]);
    expect(verificado.v).toBe(true);
    // Trocar o domínio desfaz a verificação.
    await comoUsuario(db, DONO, () => db.query(`update site_config set dominio = 'www2.imobsite.com.br' where organizacao_id = $1`, [org]));
    expect((await umaLinha<{ v: boolean }>(`select dominio_verificado_em is not null as v from site_config where organizacao_id = $1`, [org])).v).toBe(false);
    const candidatos = (d: string) =>
      comoAnonimo(db, async () => (await umaLinha<{ j: { slug: string; id: string }[] }>(`select public.site_dominio_candidatos($1) as j`, [d])).j);
    // Sem verificação o domínio não abre o site.
    expect(await candidatos("www2.imobsite.com.br")).toEqual([]);
    await comoUsuario(db, DONO, () => db.query(`update site_config set dominio_verificado_em = now() where organizacao_id = $1`, [org]));
    const siteId = (await umaLinha<{ id: string }>(`select id from site_config where organizacao_id = $1`, [org])).id;
    expect(await candidatos(" www.WWW2.imobsite.com.br ")).toEqual([{ slug: "imob-site", id: siteId }]);
    expect(await candidatos("outro.com.br")).toEqual([]);
    // Outra imobiliária pode digitar o mesmo domínio (não "rouba" nem bloqueia o dono):
    // quem abre no domínio é só o site cujo código está no TXT do DNS (conferido pelo proxy).
    const dup = await comoUsuario(db, OUTRO, () => erroDe(() => db.query(`insert into site_config (slug, dominio) values ('outra-imob', 'www2.imobsite.com.br')`)));
    expect(dup).toBe("");
    await comoUsuario(db, OUTRO, () => db.query(`delete from site_config where slug = 'outra-imob'`));
  });

  it("outra organização não vê nem mexe no site, nos portais e nos contatos", async () => {
    const r = await comoUsuario(db, OUTRO, async () => {
      await db.query(`insert into site_config (slug) values ('outra-imob')`);
      return {
        sites: (await db.query<{ slug: string }>(`select slug from site_config`)).rows.map((x) => x.slug),
        portais: (await db.query(`select 1 from site_portais`)).rows.length,
        controle: (await db.query(`select 1 from portal_imoveis`)).rows.length,
        envios: (await db.query(`select 1 from portal_sincronizacoes`)).rows.length,
        contatos: (await db.query(`select 1 from site_solicitacoes`)).rows.length,
        apagou: (await db.query(`delete from site_solicitacoes`)).affectedRows,
        mudou: (await db.query(`update site_config set ativo = false where organizacao_id = $1`, [org])).affectedRows,
        inserirEnvio: await erroDe(() => db.query(`insert into portal_sincronizacoes (organizacao_id, portal) values ($1, 'zap')`, [orgB])),
        inserirContato: await erroDe(() => db.query(`insert into site_solicitacoes (organizacao_id, tipo) values ($1, 'contato')`, [orgB])),
        imovelAlheio: await erroDe(() => db.query(`insert into portal_imoveis (organizacao_id, imovel_id, portal) values ($1, $2, 'zap')`, [org, im["AP-1"]])),
        // Com a própria organização e o imóvel de outra: o banco recusa (antes tirava o imóvel do feed alheio).
        imovelAlheioOrgPropria: await erroDe(() =>
          db.query(`insert into portal_imoveis (organizacao_id, imovel_id, portal, publicado) values ($1, $2, 'zap', false)`, [orgB, im["AP-1"]]),
        ),
        imovelAlheioUpsert: await erroDe(() =>
          db.query(
            `insert into portal_imoveis (organizacao_id, imovel_id, portal, publicado) values ($1, $2, 'zap', false)
             on conflict (imovel_id, portal) do update set publicado = false`,
            [orgB, im["AP-1"]],
          ),
        ),
      };
    });
    expect(r.sites).toEqual(["outra-imob"]);
    expect(r).toMatchObject({ portais: 0, controle: 0, envios: 0, contatos: 0, apagou: 0, mudou: 0 });
    expect(r.inserirEnvio).toContain("row-level security");
    expect(r.inserirContato).toContain("row-level security");
    expect(r.imovelAlheio).toContain("row-level security");
    expect(r.imovelAlheioOrgPropria).toContain("Imóvel não encontrado");
    expect(r.imovelAlheioUpsert).toContain("Imóvel não encontrado");
    const feedA = await comoAnonimo(db, async () => (await umaLinha<{ j: { imoveis: { codigo: string }[] } }>(`select public.portal_feed($1, 'zap') as j`, [token])).j);
    expect(feedA.imoveis.map((i) => i.codigo)).toEqual(["AP-1"]);
    // O dono vê os próprios, apaga contato (LGPD), mas não altera o histórico de envios.
    const total = (await umaLinha<{ n: number }>(`select count(*)::int as n from portal_sincronizacoes where organizacao_id = $1`, [org])).n;
    const dono = await comoUsuario(db, DONO, async () => ({
      envios: (await db.query(`select 1 from portal_sincronizacoes`)).rows.length,
      mudouEnvio: (await db.query(`update portal_sincronizacoes set total_enviados = 99`)).affectedRows,
      apagouEnvio: (await db.query(`delete from portal_sincronizacoes`)).affectedRows,
      mudouContato: (await db.query(`update site_solicitacoes set nome = 'X'`)).affectedRows,
      apagouContato: (await db.query(`delete from site_solicitacoes where tipo = 'empreendimento'`)).affectedRows,
    }));
    expect(dono).toEqual({ envios: total, mudouEnvio: 0, apagouEnvio: 0, mudouContato: 0, apagouContato: 1 });
  });

  it("mídia cadastrada com o caminho de um arquivo de outra pasta não vira foto pública", async () => {
    const doc = `${org}/${im["AP-1"]}/matricula.pdf`;
    const r = await comoUsuario(db, OUTRO, async () => {
      await db.query(`update site_config set ativo = true where slug = 'outra-imob'`);
      const imB = (await umaLinha<{ id: string }>(
        `insert into imoveis (codigo, status, publicar_site, cidade, valor_aluguel) values ('B-1', 'disponivel', true, 'Canoas', 1000) returning id`,
      )).id;
      // 1) No imóvel publicado da própria imobiliária, com o caminho do documento da outra.
      const m1 = (await umaLinha<{ id: string }>(`insert into imovel_midias (imovel_id, tipo, path) values ($1, 'foto', $2) returning id`, [imB, doc])).id;
      // 2) "Pendurada" no imóvel publicado da outra imobiliária, com o caminho da pasta dele.
      const m2 = (await umaLinha<{ id: string }>(`insert into imovel_midias (organizacao_id, imovel_id, tipo, path) values ($1, $2, 'foto', $3) returning id`, [
        orgB,
        im["AP-1"],
        doc,
      ])).id;
      return { m1, m2 };
    });
    const pub = await comoAnonimo(db, async () => ({
      arquivo: (await umaLinha<{ ok: boolean }>(`select public.site_arquivo_publico($1) as ok`, [doc])).ok,
      foto1: (await umaLinha<{ p: string | null }>(`select public.site_foto('outra-imob', $1) as p`, [r.m1])).p,
      foto2: (await umaLinha<{ p: string | null }>(`select public.site_foto('imob-site', $1) as p`, [r.m2])).p,
      midiasA: (await umaLinha<{ j: { midias: { id: string }[] } }>(`select public.site_imovel('imob-site', 'AP-1') as j`)).j.midias.map((m) => m.id),
      listaB: (await umaLinha<{ j: { codigo: string; capa: unknown; fotos: number }[] }>(`select public.site_imoveis('outra-imob') as j`)).j,
      fotosFeedA: (await umaLinha<{ j: { imoveis: { codigo: string; fotos: string[] }[] } }>(`select public.portal_feed($1, 'zap') as j`, [token])).j.imoveis.flatMap((i) => i.fotos),
    }));
    expect(pub.arquivo).toBe(false);
    expect(pub.foto1).toBeNull();
    expect(pub.foto2).toBeNull();
    expect(pub.midiasA).toEqual([foto["AP-1"]]);
    expect(pub.listaB).toEqual([expect.objectContaining({ codigo: "B-1", capa: null, fotos: 0 })]);
    expect(pub.fotosFeedA).toEqual([foto["AP-1"]]);
    // A foto legítima continua pública.
    const legitima = await comoAnonimo(db, async () => (await umaLinha<{ ok: boolean }>(`select public.site_arquivo_publico($1) as ok`, [`${org}/${im["AP-1"]}/foto-AP-1.jpg`])).ok);
    expect(legitima).toBe(true);
  });

  it("corretor não muda endereço, domínio nem os códigos dos portais, e não exclui o site — nem pela API", async () => {
    const r = await comoUsuario(db, CORRETOR, async () => ({
      nome: await erroDe(() => db.query(`update site_config set slogan = 'Novo slogan' where organizacao_id = $1`, [org])),
      slug: await erroDe(() => db.query(`update site_config set slug = 'xyz-tmp' where organizacao_id = $1`, [org])),
      token: await erroDe(() => db.query(`update site_config set portais_token = gen_random_uuid() where organizacao_id = $1`, [org])),
      tokenLeads: await erroDe(() => db.query(`update site_config set leads_portais_token = gen_random_uuid() where organizacao_id = $1`, [org])),
      dominio: await erroDe(() => db.query(`update site_config set dominio = 'golpe.com.br' where organizacao_id = $1`, [org])),
      verificado: await erroDe(() => db.query(`update site_config set dominio_verificado_em = now() - interval '1 day' where organizacao_id = $1`, [org])),
      excluir: await erroDe(() => db.query(`delete from site_config where organizacao_id = $1`, [org])),
    }));
    expect(r.nome).toBe("");
    for (const k of ["slug", "token", "tokenLeads", "dominio", "verificado"] as const) expect(r[k], k).toContain("Só administradores e gestores");
    expect(r.excluir).toContain("Só administradores e gestores excluem o site");
    const cfg = await umaLinha<{ slug: string; portais_token: string; slogan: string }>(`select slug, portais_token, slogan from site_config where organizacao_id = $1`, [org]);
    expect(cfg).toEqual({ slug: "imob-site", portais_token: token, slogan: "Novo slogan" });
  });

  it("endereço trocado fica reservado para a mesma imobiliária e os links antigos levam ao novo", async () => {
    await comoUsuario(db, DONO, () => db.query(`update site_config set slug = 'imob-nova' where organizacao_id = $1`, [org]));
    const atual = (s: string) => comoAnonimo(db, async () => (await umaLinha<{ s: string | null }>(`select public.site_slug_atual($1) as s`, [s])).s);
    expect(await atual("imob-site")).toBe("imob-nova");
    expect(await atual("nao-existe")).toBeNull();
    // Outra imobiliária não consegue pegar o endereço antigo (nem criando, nem trocando).
    const outro = await comoUsuario(db, OUTRO, () => erroDe(() => db.query(`update site_config set slug = 'imob-site' where organizacao_id = $1`, [orgB])));
    expect(outro).toContain("já está em uso por outra imobiliária");
    // A dona volta para o endereço antigo quando quiser.
    await comoUsuario(db, DONO, () => db.query(`update site_config set slug = 'imob-site' where organizacao_id = $1`, [org]));
    expect(await atual("imob-site")).toBeNull();
    expect(await atual("imob-nova")).toBe("imob-site");
  });

  it("conta no modo pessoal não tem site público", async () => {
    const orgP = await comoUsuario(db, PESSOAL, async () => (await umaLinha<{ id: string }>(`select public.criar_organizacao('Meus Imóveis') as id`)).id);
    await comoUsuario(db, PESSOAL, async () => {
      await db.query(`update organizacoes set modo = 'pessoal' where id = $1`, [orgP]);
      await db.query(`insert into site_config (organizacao_id, slug, ativo) values ($1, 'meus-imoveis', true)`, [orgP]);
      await db.query(`insert into imoveis (organizacao_id, codigo, publicar_site) values ($1, 'P-1', true)`, [orgP]);
    });
    const r = await comoAnonimo(db, async () => ({
      info: (await umaLinha<{ j: unknown }>(`select public.site_info('meus-imoveis') as j`)).j,
      lista: (await umaLinha<{ j: unknown[] }>(`select public.site_imoveis('meus-imoveis') as j`)).j,
      contato: await erroDe(() => db.query(`select public.site_contato('meus-imoveis', '{"nome":"A","telefone":"11999998888"}')`)),
    }));
    expect(r.info).toBeNull();
    expect(r.lista).toEqual([]);
    expect(r.contato).toContain("Site não encontrado");
  });
});
