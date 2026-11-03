/**
 * Site imobiliário e portais no banco (PGlite): leitura pública só do que está
 * publicado, formulários do site (contato, visita, anúncio, empreendimento),
 * feed dos portais, registro de envios, leads dos portais e isolamento por
 * organização.
 */
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { montarFeed } from "@/lib/servicos/portais";
import { comoAnonimo, comoUsuario, criarBanco } from "./pglite";

const DONO = "00000000-0000-0000-0000-000000016a01";
const OUTRO = "00000000-0000-0000-0000-000000016a02";
const PESSOAL = "00000000-0000-0000-0000-000000016a03";

let db: PGlite;
let org: string;
let orgB: string;
let token: string;
const im: Record<string, string> = {};
const foto: Record<string, string> = {};
let emp: string;

async function erroDe(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "";
  } catch (e) {
    return String(e);
  }
}

const umaLinha = async <T>(sql: string, args: unknown[] = []) => (await db.query<T>(sql, args)).rows[0];

beforeAll(async () => {
  db = await criarBanco();
  org = await comoUsuario(db, DONO, async () => (await umaLinha<{ id: string }>(`select public.criar_organizacao('Imob Site') as id`)).id);
  orgB = await comoUsuario(db, OUTRO, async () => (await umaLinha<{ id: string }>(`select public.criar_organizacao('Outra Imob') as id`)).id);

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
    token = (await umaLinha<{ portais_token: string }>(
      `insert into site_config (slug, ativo, nome, whatsapp) values ('imob-site', true, 'Imob Site Oficial', '51999990000') returning portais_token`,
    )).portais_token;
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

  it("contato vira lead (sem repetir) e fica registrado nas solicitações", async () => {
    const r = await comoAnonimo(db, async () => {
      const a = (await umaLinha<{ j: { ok: boolean; duplicado: boolean } }>(
        `select public.site_contato('imob-site', $1) as j`,
        [JSON.stringify({ tipo: "contato", nome: "Ana", telefone: "(51) 98888-7777", mensagem: "Quero saber mais", imovel: "AP-1" })],
      )).j;
      const b = (await umaLinha<{ j: { duplicado: boolean } }>(
        `select public.site_contato('imob-site', $1) as j`,
        [JSON.stringify({ tipo: "contato", nome: "Ana", telefone: "51988887777", mensagem: "Outra dúvida" })],
      )).j;
      const semContato = await erroDe(() => db.query(`select public.site_contato('imob-site', $1)`, [JSON.stringify({ nome: "Sem" })]));
      return { a, b, semContato };
    });
    expect(r.a).toMatchObject({ ok: true, duplicado: false });
    expect(r.b.duplicado).toBe(true);
    expect(r.semContato).toContain("telefone ou e-mail");
    const lead = await umaLinha<{ origem: string; n: number; imovel: string }>(
      `select l.origem, (select count(*)::int from leads where organizacao_id = $1) as n, (select imovel_id::text from lead_imoveis li where li.lead_id = l.id) as imovel from leads l where l.nome = 'Ana'`,
      [org],
    );
    expect(lead).toEqual({ origem: "site", n: 1, imovel: im["AP-1"] });
    const sol = await umaLinha<{ n: number }>(`select count(*)::int as n from site_solicitacoes where organizacao_id = $1 and tipo = 'contato'`, [org]);
    expect(sol.n).toBe(2);
  });

  it("agendar visita cria a visita na agenda e recusa horário ocupado, passado ou bloqueado", async () => {
    const quando = new Date(Date.now() + 3 * 86_400_000);
    quando.setUTCMinutes(0, 0, 0);
    const iso = quando.toISOString();
    const r = await comoAnonimo(db, async () => {
      const ok = (await umaLinha<{ j: { tipo: string } }>(
        `select public.site_contato('imob-site', $1) as j`,
        [JSON.stringify({ tipo: "visita", nome: "Bruno", email: "bruno@exemplo.com", imovel: "AP-1", quando: iso })],
      )).j;
      const ocupado = await erroDe(() =>
        db.query(`select public.site_contato('imob-site', $1)`, [JSON.stringify({ tipo: "visita", nome: "Caio", email: "caio@exemplo.com", imovel: "AP-1", quando: iso })]),
      );
      const passado = await erroDe(() =>
        db.query(`select public.site_contato('imob-site', $1)`, [
          JSON.stringify({ tipo: "visita", nome: "Caio", email: "caio@exemplo.com", imovel: "AP-1", quando: new Date(Date.now() - 86_400_000).toISOString() }),
        ]),
      );
      const semImovel = await erroDe(() => db.query(`select public.site_contato('imob-site', $1)`, [JSON.stringify({ tipo: "visita", nome: "Caio", email: "c@x.com", quando: iso })]));
      const lixo = await erroDe(() => db.query(`select public.site_contato('imob-site', $1)`, [JSON.stringify({ tipo: "visita", nome: "Caio", email: "c@x.com", imovel: "AP-1", quando: "amanhã" })]));
      return { ok, ocupado, passado, semImovel, lixo };
    });
    expect(r.ok.tipo).toBe("visita");
    expect(r.ocupado).toContain("já está reservado");
    expect(r.passado).toContain("a partir de daqui a 1 hora");
    expect(r.semImovel).toContain("Escolha o imóvel");
    expect(r.lixo).toContain("dia e o horário");
    const v = await umaLinha<{ status: string; titulo: string; lead: string; imovel_id: string; data_hora: Date }>(
      `select v.status, v.titulo, l.nome as lead, v.imovel_id, v.data_hora from visitas v join leads l on l.id = v.lead_id where v.organizacao_id = $1`,
      [org],
    );
    expect(v).toMatchObject({ status: "agendada", titulo: "Visita pedida pelo site", lead: "Bruno", imovel_id: im["AP-1"] });
    expect(new Date(v.data_hora).toISOString()).toBe(iso);
    const msg = await umaLinha<{ observacoes: string }>(`select observacoes from leads where nome = 'Bruno'`);
    expect(msg.observacoes).toMatch(/Quer visitar em \d{2}\/\d{2}\/\d{4} às \d{2}:\d{2}/);

    // Período bloqueado do imóvel
    const bloq = new Date(Date.now() + 5 * 86_400_000);
    await comoUsuario(db, DONO, () =>
      db.query(`insert into imovel_indisponibilidades (imovel_id, inicio, fim, motivo) values ($1, $2::timestamptz - interval '1 day', $2::timestamptz + interval '1 day', 'Pintura')`, [
        im["AP-1"],
        bloq.toISOString(),
      ]),
    );
    const bloqueado = await comoAnonimo(db, () =>
      erroDe(() => db.query(`select public.site_contato('imob-site', $1)`, [JSON.stringify({ tipo: "visita", nome: "Davi", email: "d@x.com", imovel: "AP-1", quando: bloq.toISOString() })])),
    );
    expect(bloqueado).toContain("não recebe visitas");
  });

  it("'Anuncie seu imóvel' abre uma captação com os dados do imóvel; empreendimento vira lead de venda", async () => {
    await comoAnonimo(db, async () => {
      await db.query(`select public.site_contato('imob-site', $1)`, [
        JSON.stringify({ tipo: "captacao", nome: "Dona Elza", telefone: "51977776666", tipo_imovel: "casa", finalidade: "ambos", cidade: "Canoas", bairro: "Igara", quartos: "3", area: "120.5", valor: "450000" }),
      ]);
      await db.query(`select public.site_contato('imob-site', $1)`, [JSON.stringify({ tipo: "empreendimento", nome: "Fábio", email: "fabio@x.com", empreendimento: emp })]);
    });
    const c = await umaLinha<{ tipo: string; finalidades: string[]; bairro: string; quartos: number; area: string; valor_pretendido: string; origem: string }>(
      `select tipo, finalidades, bairro, quartos, area::text, valor_pretendido::text, origem from captacoes where proprietario_nome = 'Dona Elza'`,
    );
    expect(c).toEqual({ tipo: "casa", finalidades: ["locacao", "venda"], bairro: "Igara", quartos: 3, area: "120.50", valor_pretendido: "450000.00", origem: "site" });
    const l = await umaLinha<{ funil: string; observacoes: string }>(`select funil, observacoes from leads where nome = 'Fábio'`);
    expect(l.funil).toBe("venda");
    expect(l.observacoes).toContain("Residencial Sol");
    await comoUsuario(db, DONO, () => db.query(`update site_config set captacao_ativa = false where organizacao_id = $1`, [org]));
    const desligado = await comoAnonimo(db, () => erroDe(() => db.query(`select public.site_contato('imob-site', $1)`, [JSON.stringify({ tipo: "captacao", nome: "X", telefone: "51911112222" })])));
    expect(desligado).toContain("não recebe anúncios");
    const empRuim = await comoAnonimo(db, () =>
      erroDe(() => db.query(`select public.site_contato('imob-site', $1)`, [JSON.stringify({ tipo: "empreendimento", nome: "X", telefone: "51911112222", empreendimento: "nao-e-uuid" })])),
    );
    expect(empRuim).toContain("Empreendimento não encontrado");
    await comoUsuario(db, DONO, () => db.query(`update site_config set captacao_ativa = true where organizacao_id = $1`, [org]));
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
      const feed = async (p: string) => (await umaLinha<{ j: { ativo: boolean; imoveis: { codigo: string; fotos: string[]; destaque: string; codigo_portal: string | null }[]; site: { slug: string } } | null }>(
        `select public.portal_feed($1, $2) as j`,
        [token, p],
      )).j;
      return {
        zap: await feed("zap"),
        olx: await feed("olx"),
        vivareal: await feed("vivareal"),
        semConfig: (await umaLinha<{ j: unknown }>(`select public.portal_feed($1, 'zap') as j`, ["00000000-0000-0000-0000-000000000000"])).j,
        fotoPortal: (await umaLinha<{ ok: boolean }>(`select public.site_arquivo_publico($1) as ok`, [`${org}/${im["AP-2"]}/foto-AP-2.jpg`])).ok,
      };
    });
    expect(r.zap?.imoveis.map((i) => i.codigo)).toEqual(["AP-1"]);
    expect(r.zap?.imoveis[0].fotos).toEqual([foto["AP-1"]]);
    expect(r.zap?.site.slug).toBe("imob-site");
    expect(r.olx?.imoveis.map((i) => [i.codigo, i.destaque, i.codigo_portal])).toEqual([["AP-2", "destaque", "OLX-77"]]);
    expect(r.vivareal).toMatchObject({ ativo: false, imoveis: [] });
    expect(r.semConfig).toBeNull();
    // Foto de imóvel que está só no portal (fora do site) também é pública.
    expect(r.fotoPortal).toBe(true);
  });

  it("registra cada envio, marca falhas e quem saiu do feed", async () => {
    await comoAnonimo(db, async () => {
      await db.query(`select public.portal_registrar($1, 'zap', $2)`, [
        token,
        JSON.stringify({ elegiveis: 2, enviados: [im["AP-1"]], falhas: [{ imovel_id: im["CASA-4"], codigo: "CASA-4", problemas: ["Sem fotos"] }], agente: "teste" }),
      ]);
    });
    let st = (await db.query<{ codigo: string; ultimo_status: string; ultimas_falhas: string[]; enviado: boolean }>(
      `select i.codigo, pi.ultimo_status, pi.ultimas_falhas, pi.ultima_sincronizacao is not null as enviado from portal_imoveis pi join imoveis i on i.id = pi.imovel_id where pi.portal = 'zap' order by i.codigo`,
    )).rows;
    expect(st).toEqual([
      { codigo: "AP-1", ultimo_status: "enviado", ultimas_falhas: [], enviado: true },
      { codigo: "CASA-4", ultimo_status: "falha", ultimas_falhas: ["Sem fotos"], enviado: false },
    ]);
    // AP-1 foi alugado: na próxima geração some do feed.
    await comoAnonimo(db, () => db.query(`select public.portal_registrar($1, 'zap', $2)`, [token, JSON.stringify({ origem: "manual", elegiveis: 0, enviados: [] })]));
    st = (await db.query<{ codigo: string; ultimo_status: string; ultimas_falhas: string[]; enviado: boolean }>(
      `select i.codigo, pi.ultimo_status, pi.ultimas_falhas, pi.ultima_sincronizacao is not null as enviado from portal_imoveis pi join imoveis i on i.id = pi.imovel_id where pi.portal = 'zap' order by i.codigo`,
    )).rows;
    expect(st.map((s) => s.ultimo_status)).toEqual(["fora", "fora"]);
    const log = (await db.query<{ origem: string; total_enviados: number; total_falhas: number }>(`select origem, total_enviados, total_falhas from portal_sincronizacoes order by gerado_em, total_enviados desc`)).rows;
    expect(log).toEqual([
      { origem: "portal", total_enviados: 1, total_falhas: 1 },
      { origem: "manual", total_enviados: 0, total_falhas: 0 },
    ]);
    const tokenErrado = await comoAnonimo(db, () => erroDe(() => db.query(`select public.portal_registrar($1, 'zap', '{}')`, ["00000000-0000-0000-0000-000000000000"])));
    expect(tokenErrado).toContain("inválido");
  });

  it("o feed abre e encerra o anúncio na aba Histórico do imóvel (sem mexer nos registrados à mão)", async () => {
    await comoUsuario(db, DONO, () =>
      db.query(`insert into imovel_anuncios (imovel_id, portal, inicio, valor) values ($1, 'OLX', current_date - 10, 1500)`, [im["AP-2"]]),
    );
    const anuncios = () =>
      comoUsuario(db, DONO, async () =>
        (await db.query<{ codigo: string; portal: string; origem: string; valor: string | null; aberto: boolean; fim_hoje: boolean }>(
          `select i.codigo, a.portal, a.origem, a.valor::text as valor, a.fim is null as aberto, a.fim = current_date as fim_hoje
             from imovel_anuncios a join imoveis i on i.id = a.imovel_id order by i.codigo, a.portal, a.origem`,
        )).rows,
      );
    // AP-1 entra no feed do ZAP; AP-2 entra no da OLX, que já tinha anúncio à mão.
    await comoAnonimo(db, async () => {
      await db.query(`select public.portal_registrar($1, 'zap', $2)`, [token, JSON.stringify({ elegiveis: 1, enviados: [im["AP-1"]] })]);
      await db.query(`select public.portal_registrar($1, 'olx', $2)`, [token, JSON.stringify({ elegiveis: 1, enviados: [im["AP-2"]] })]);
    });
    expect(await anuncios()).toEqual([
      { codigo: "AP-1", portal: "ZAP Imóveis", origem: "feed", valor: "1800.00", aberto: true, fim_hoje: null },
      { codigo: "AP-2", portal: "OLX", origem: "manual", valor: "1500.00", aberto: true, fim_hoje: null },
    ]);
    // O preço muda no cadastro: o anúncio do feed acompanha na próxima geração.
    await comoUsuario(db, DONO, () => db.query(`update imoveis set valor_aluguel = 1850 where id = $1`, [im["AP-1"]]));
    await comoAnonimo(db, () => db.query(`select public.portal_registrar($1, 'zap', $2)`, [token, JSON.stringify({ elegiveis: 1, enviados: [im["AP-1"]] })]));
    expect((await anuncios())[0]).toMatchObject({ valor: "1850.00", aberto: true });
    // Saiu de todos os feeds: o do feed encerra hoje; o registrado à mão continua como estava.
    await comoAnonimo(db, async () => {
      await db.query(`select public.portal_registrar($1, 'zap', $2)`, [token, JSON.stringify({ elegiveis: 0, enviados: [] })]);
      await db.query(`select public.portal_registrar($1, 'olx', $2)`, [token, JSON.stringify({ elegiveis: 0, enviados: [] })]);
    });
    expect(await anuncios()).toEqual([
      { codigo: "AP-1", portal: "ZAP Imóveis", origem: "feed", valor: "1850.00", aberto: false, fim_hoje: true },
      { codigo: "AP-2", portal: "OLX", origem: "manual", valor: "1500.00", aberto: true, fim_hoje: null },
    ]);
    await comoUsuario(db, DONO, () => db.query(`update imoveis set valor_aluguel = 1800 where id = $1`, [im["AP-1"]]));
  });

  it("o serviço do feed monta o XML com os dados do banco e registra o envio", async () => {
    await comoUsuario(db, DONO, () =>
      db.query(`update imoveis set descricao = $1 where id = $2`, ["Apartamento de dois quartos no centro, perto de tudo, com sol da manhã e vaga.", im["AP-1"]]),
    );
    // Cliente "de mentira" que chama as funções do banco como o Supabase faria (visitante anônimo).
    const cliente = {
      rpc: async (fn: string, args: Record<string, unknown>) => {
        const nomes = Object.keys(args);
        const valores = nomes.map((k) => (typeof args[k] === "object" ? JSON.stringify(args[k]) : args[k]));
        const lista = nomes.map((k, i) => `${k} => $${i + 1}`).join(", ");
        try {
          const r = await comoAnonimo(db, () => db.query<{ r: unknown }>(`select public.${fn}(${lista}) as r`, valores));
          return { data: r.rows[0].r, error: null };
        } catch (e) {
          return { data: null, error: { message: String(e) } };
        }
      },
    };
    const zap = await montarFeed(cliente as never, token, "zap", { origem: "https://sistema.exemplo", registro: "portal", agente: "teste" });
    expect(zap?.resultado.falhas).toEqual([]);
    expect(zap?.registrado).toBe(true);
    expect(zap?.xml).toContain("<ListingID>AP-1</ListingID>");
    expect(zap?.xml).toContain(`<Item medium="image" primary="true">https://sistema.exemplo/s/imob-site/foto/${foto["AP-1"]}</Item>`);
    expect(zap?.xml).toContain("<DetailViewUrl>https://sistema.exemplo/s/imob-site/imovel/AP-1</DetailViewUrl>");
    expect(zap?.xml).toContain('<RentalPrice currency="BRL" period="Monthly">1800</RentalPrice>');
    const olx = await montarFeed(cliente as never, token, "olx", { origem: "https://sistema.exemplo", registro: "manual" });
    expect(olx?.resultado.enviar).toEqual([]);
    expect(olx?.resultado.falhas.map((f) => f.codigo)).toEqual(["AP-2"]);
    expect(olx?.resultado.falhas[0].problemas).toContain("Escreva uma descrição com pelo menos 50 letras.");
    expect(await montarFeed(cliente as never, token, "vivareal", { origem: "https://x", registro: "portal" })).toMatchObject({ ativo: false, elegiveis: 0 });
    expect(await montarFeed(cliente as never, "00000000-0000-0000-0000-000000000000", "zap", { origem: "https://x", registro: "portal" })).toBeNull();
    const st = (await db.query<{ codigo: string; portal: string; ultimo_status: string }>(
      `select i.codigo, pi.portal, pi.ultimo_status from portal_imoveis pi join imoveis i on i.id = pi.imovel_id where pi.ultimo_status in ('enviado','falha') order by pi.portal, i.codigo`,
    )).rows;
    expect(st).toEqual([
      { codigo: "AP-2", portal: "olx", ultimo_status: "falha" },
      { codigo: "AP-1", portal: "zap", ultimo_status: "enviado" },
    ]);
    // AP-1 voltou ao feed no mesmo dia: o anúncio do feed reabre (sem duplicar).
    const an = (await db.query<{ n: number; abertos: number }>(
      `select count(*)::int as n, count(*) filter (where fim is null)::int as abertos from imovel_anuncios where imovel_id = $1 and portal = 'ZAP Imóveis'`,
      [im["AP-1"]],
    )).rows[0];
    expect(an).toEqual({ n: 1, abertos: 1 });
    // O XML leva o IPTU do ano (o cadastro guarda o do mês).
    await comoUsuario(db, DONO, () => db.query(`update imoveis set valor_iptu = 150 where id = $1`, [im["AP-1"]]));
    const comIptu = await montarFeed(cliente as never, token, "zap", { origem: "https://sistema.exemplo", registro: "manual" });
    expect(comIptu?.xml).toContain('<YearlyTax currency="BRL">1800</YearlyTax>');
  });

  it("lead do portal entra com a origem do portal e ligado ao imóvel", async () => {
    const r = await comoAnonimo(db, async () => (await umaLinha<{ j: { id: string; duplicado: boolean } }>(
      `select public.portal_receber_lead($1, 'vivareal', $2) as j`,
      [token, JSON.stringify({ nome: "Gabi", telefone: "11955554444", mensagem: "Ainda disponível?", imovel: "AP-1", funil: "locacao" })],
    )).j);
    expect(r.duplicado).toBe(false);
    const l = await umaLinha<{ origem: string; imovel: string }>(`select origem, (select imovel_id::text from lead_imoveis where lead_id = l.id) as imovel from leads l where l.id = $1`, [r.id]);
    expect(l).toEqual({ origem: "vivareal", imovel: im["AP-1"] });
    const sol = await umaLinha<{ tipo: string; origem: string }>(`select tipo, origem from site_solicitacoes where lead_id = $1`, [r.id]);
    expect(sol).toEqual({ tipo: "portal", origem: "vivareal" });
    const ruim = await comoAnonimo(db, () => erroDe(() => db.query(`select public.portal_receber_lead($1, 'zap', '{"nome":"X","telefone":"1199"}')`, ["00000000-0000-0000-0000-000000000000"])));
    expect(ruim).toContain("inválido");
    const portalRuim = await comoAnonimo(db, () => erroDe(() => db.query(`select public.portal_receber_lead($1, 'facebook', '{}')`, [token])));
    expect(portalRuim).toContain("Portal desconhecido");
  });

  it("lead do portal sem o tipo de negócio usa o funil do imóvel (só venda → venda)", async () => {
    const r = await comoAnonimo(db, async () => ({
      venda: (await umaLinha<{ j: { id: string } }>(`select public.portal_receber_lead($1, 'zap', $2) as j`, [
        token,
        JSON.stringify({ nome: "Heitor", telefone: "11944443333", imovel: "CASA-4" }),
      ])).j,
      locacao: (await umaLinha<{ j: { id: string } }>(`select public.portal_receber_lead($1, 'olx', $2) as j`, [
        token,
        JSON.stringify({ nome: "Iara", telefone: "11933332222", imovel: "AP-1" }),
      ])).j,
      semImovel: (await umaLinha<{ j: { id: string } }>(`select public.portal_receber_lead($1, 'olx', $2) as j`, [
        token,
        JSON.stringify({ nome: "Jonas", telefone: "11922221111" }),
      ])).j,
    }));
    const funil = async (id: string) => (await umaLinha<{ funil: string }>(`select funil from leads where id = $1`, [id])).funil;
    expect(await funil(r.venda.id)).toBe("venda");
    expect(await funil(r.locacao.id)).toBe("locacao");
    expect(await funil(r.semImovel.id)).toBe("locacao");
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
    const dono = await comoUsuario(db, DONO, async () => ({
      envios: (await db.query(`select 1 from portal_sincronizacoes`)).rows.length,
      mudouEnvio: (await db.query(`update portal_sincronizacoes set total_enviados = 99`)).affectedRows,
      apagouEnvio: (await db.query(`delete from portal_sincronizacoes`)).affectedRows,
      mudouContato: (await db.query(`update site_solicitacoes set nome = 'X'`)).affectedRows,
      apagouContato: (await db.query(`delete from site_solicitacoes where tipo = 'empreendimento'`)).affectedRows,
    }));
    expect(dono).toEqual({ envios: 11, mudouEnvio: 0, apagouEnvio: 0, mudouContato: 0, apagouContato: 1 });
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

  it("conta no modo pessoal não tem site público", async () => {
    const orgP = await comoUsuario(db, PESSOAL, async () => (await umaLinha<{ id: string }>(`select public.criar_organizacao('Meus Imóveis') as id`)).id);
    await comoUsuario(db, PESSOAL, async () => {
      await db.query(`update organizacoes set modo = 'pessoal' where id = $1`, [orgP]);
      await db.query(`insert into site_config (slug, ativo) values ('meus-imoveis', true)`);
      await db.query(`insert into imoveis (codigo, publicar_site) values ('P-1', true)`);
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
