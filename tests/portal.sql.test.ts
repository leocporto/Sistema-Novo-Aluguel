/**
 * Portal de clientes no banco (PGlite): links por pessoa e perfil (só a equipe
 * gera; proprietário só na imobiliária), confirmação de identidade com limite
 * de tentativas e sessão por hash, leitura só dos dados da própria pessoa,
 * pedidos (renovação/desocupação/contato) com limites, chamado e fotos pelo
 * portal, aprovação de orçamento conferindo o valor visto, orçamento e
 * execução do prestador, portal do corretor (só os dele) e juntar repetidos.
 */
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { comoAnonimo, comoUsuario, criarBanco } from "./pglite";

const GESTOR = "00000000-0000-0000-0000-000000018a01";
const OUTRO = "00000000-0000-0000-0000-000000018a02";
const PESSOAL = "00000000-0000-0000-0000-000000018a03";
const CORRETOR = "00000000-0000-0000-0000-000000018a04";
const FINANCEIRO = "00000000-0000-0000-0000-000000018a05";
const CORRETOR2 = "00000000-0000-0000-0000-000000018a06";

let db: PGlite;
let org: string;
let orgB: string;
let orgP: string;
const ids: Record<string, string> = {};
const tokens: Record<string, string> = {};
const sessoes: Record<string, string> = {};

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

type Resp = Record<string, unknown> & { erro?: string; ok?: boolean; sessao?: string; restantes?: number };
const anon = <T = Resp>(sql: string, params: unknown[] = []) => comoAnonimo(db, async () => (await um<{ r: T }>(sql, params)).r);
const dados = <T = unknown>(perfil: string, secao: string, p: Record<string, unknown> = {}) =>
  anon<T>(`select public.portal_dados($1, $2, $3, $4) as r`, [tokens[perfil], sessoes[perfil] ?? null, secao, p]);

async function entrar(perfil: string, codigo: string) {
  const r = await anon(`select public.portal_entrar($1, $2, '10.0.0.1', 'teste') as r`, [tokens[perfil], codigo]);
  if (r.ok && r.sessao) sessoes[perfil] = r.sessao;
  return r;
}

beforeAll(async () => {
  db = await criarBanco();
  org = await comoUsuario(db, GESTOR, async () => (await um<{ id: string }>(`select public.criar_organizacao('Imob Portal') as id`)).id);
  orgB = await comoUsuario(db, OUTRO, async () => (await um<{ id: string }>(`select public.criar_organizacao('Outra Imob') as id`)).id);
  orgP = await comoUsuario(db, PESSOAL, async () => (await um<{ id: string }>(`select public.criar_organizacao('Meus Imóveis') as id`)).id);
  await db.query(`update organizacoes set modo = 'pessoal' where id = $1`, [orgP]);
  await db.query(`insert into membros (organizacao_id, user_id, papel, nome) values ($1, $2, 'corretor', 'Rita'), ($1, $3, 'financeiro', 'Fábio'), ($1, $4, 'corretor', 'Caio')`, [
    org,
    CORRETOR,
    FINANCEIRO,
    CORRETOR2,
  ]);

  await comoUsuario(db, GESTOR, async () => {
    ids.prop = await id(`insert into pessoas (nome, documento, telefone, papeis) values ('Ana Proprietária', '123.456.789-09', '51911110000', '{proprietario}') returning id`);
    ids.prop2 = await id(`insert into pessoas (nome, documento, papeis) values ('Otávio Dono', '987.654.321-00', '{proprietario}') returning id`);
    ids.loc = await id(`insert into pessoas (nome, documento, telefone, papeis) values ('Bruno Locatário', '111.222.333-44', '51922220000', '{locatario}') returning id`);
    ids.loc2 = await id(`insert into pessoas (nome, telefone, papeis) values ('Carla Sem Documento', '(51) 99999-4321', '{locatario}') returning id`);
    ids.prest = await id(`insert into pessoas (nome, documento, telefone, papeis, especialidade) values ('Paulo Encanador', '555.666.777-88', '51933330000', '{prestador}', 'Encanador') returning id`);
    ids.prest2 = await id(`insert into pessoas (nome, documento, papeis) values ('Pedro Eletricista', '999.888.777-66', '{prestador}') returning id`);
    ids.semDoc = await id(`insert into pessoas (nome, papeis) values ('Sem Contato', '{locatario}') returning id`);
    ids.corretorPessoa = await id(`insert into pessoas (nome, papeis) values ('Rita Corretora', '{corretor}') returning id`);
    ids.corretor2Pessoa = await id(`insert into pessoas (nome, papeis) values ('Caio Corretor', '{corretor}') returning id`);

    ids.imovel1 = await id(`insert into imoveis (codigo, logradouro, numero, bairro, cidade, uf, corretor_id) values ('AP-1', 'Rua A', '10', 'Centro', 'Porto Alegre', 'RS', $1) returning id`, [ids.corretorPessoa]);
    ids.imovel2 = await id(`insert into imoveis (codigo, logradouro, numero, cidade, corretor_id) values ('AP-2', 'Rua B', '20', 'Canoas', $1) returning id`, [ids.corretor2Pessoa]);
    await db.query(`insert into imovel_proprietarios (imovel_id, pessoa_id, percentual) values ($1, $2, 100), ($3, $4, 100)`, [ids.imovel1, ids.prop, ids.imovel2, ids.prop2]);
    const contrato = `insert into contratos (imovel_id, data_inicio, prazo_meses, data_fim, valor_aluguel, dia_vencimento, data_base_reajuste) values ($1, '2026-01-01', 30, '2028-06-30', $2, 10, '2026-01-01') returning id`;
    ids.contrato1 = await id(contrato, [ids.imovel1, 2000]);
    ids.contrato2 = await id(contrato, [ids.imovel2, 1500]);
    await db.query(
      `insert into contrato_partes (contrato_id, pessoa_id, papel, percentual) values ($1, $2, 'locatario', null), ($1, $3, 'proprietario', 100), ($4, $5, 'locatario', null), ($4, $6, 'proprietario', 100)`,
      [ids.contrato1, ids.loc, ids.prop, ids.contrato2, ids.loc2, ids.prop2],
    );
    ids.fatura1 = await id(`insert into faturas (contrato_id, competencia, vencimento, valor_total) values ($1, '2026-11-01', '2026-11-10', 2000) returning id`, [ids.contrato1]);
    ids.fatura2 = await id(`insert into faturas (contrato_id, competencia, vencimento, valor_total) values ($1, '2026-11-01', '2026-11-10', 1500) returning id`, [ids.contrato2]);
    ids.faturaPaga = await id(`insert into faturas (contrato_id, competencia, vencimento, valor_total, status, pago_em, valor_pago) values ($1, '2025-12-01', '2025-12-10', 2000, 'paga', '2026-01-05', 2000) returning id`, [ids.contrato1]);
    // Repasses: dezembro/2025 pago em janeiro/2026 (entra no informe de 2026) e um do outro dono.
    await db.query(
      `insert into repasses (contrato_id, fatura_id, pessoa_id, competencia, percentual, aluguel, valor_bruto, taxa_administracao, valor_liquido, previsto_para, status, pago_em)
       values ($1, $2, $3, '2025-12-01', 100, 2000, 2000, 200, 1800, '2026-01-07', 'pago', '2026-01-07'),
              ($4, null, $5, '2026-02-01', 100, 1500, 1500, 150, 1350, '2026-02-15', 'pago', '2026-02-15')`,
      [ids.contrato1, ids.faturaPaga, ids.prop, ids.contrato2, ids.prop2],
    );
    ids.docProp = await id(`insert into documentos (titulo, tipo, contrato_id, status, conteudo) values ('Contrato de locação AP-1', 'locacao', $1, 'assinado', 'TEXTO DO CONTRATO 1') returning id`, [ids.contrato1]);
    ids.docOutro = await id(`insert into documentos (titulo, tipo, contrato_id, status, conteudo) values ('Contrato AP-2', 'locacao', $1, 'assinado', 'TEXTO 2') returning id`, [ids.contrato2]);
    ids.docRestrito = await id(`insert into documentos (titulo, tipo, contrato_id, status, conteudo, restrito) values ('Interno', 'outro', $1, 'aprovado', 'SEGREDO', true) returning id`, [ids.contrato1]);
    ids.docAdm = await id(`insert into documentos (titulo, tipo, imovel_id, status, conteudo) values ('Contrato de administração', 'administracao', $1, 'assinado', 'ADM') returning id`, [ids.imovel1]);
  });
});

describe("links do portal (equipe)", () => {
  it("a equipe gera links; o corretor não; pessoa sem CPF/telefone não recebe link", async () => {
    await comoUsuario(db, GESTOR, async () => {
      for (const [k, pessoa, perfil] of [
        ["prop", ids.prop, "proprietario"],
        ["prop2", ids.prop2, "proprietario"],
        ["loc", ids.loc, "locatario"],
        ["loc2", ids.loc2, "locatario"],
        ["prest", ids.prest, "prestador"],
      ]) {
        const r = await um<{ id: string; token: string }>(`insert into portal_acessos (pessoa_id, perfil) values ($1, $2) returning id, token`, [pessoa, perfil]);
        ids[`acesso_${k}`] = r.id;
        tokens[k] = r.token;
      }
    });
    const semDoc = await erroDe(() => comoUsuario(db, GESTOR, () => db.query(`insert into portal_acessos (pessoa_id, perfil) values ($1, 'locatario')`, [ids.semDoc])));
    const corretor = await erroDe(() => comoUsuario(db, CORRETOR, () => db.query(`insert into portal_acessos (pessoa_id, perfil) values ($1, 'prestador')`, [ids.prest2])));
    const fin = await comoUsuario(db, FINANCEIRO, async () => (await um<{ token: string }>(`insert into portal_acessos (pessoa_id, perfil) values ($1, 'prestador') returning token`, [ids.prest2])).token);
    tokens.prest2 = fin;
    const repetido = await erroDe(() => comoUsuario(db, GESTOR, () => db.query(`insert into portal_acessos (pessoa_id, perfil) values ($1, 'locatario')`, [ids.loc])));
    const verCorretor = await comoUsuario(db, CORRETOR, async () => (await um<{ n: number }>(`select count(*)::int as n from portal_acessos`)).n);
    const eventos = await comoUsuario(db, GESTOR, async () => (await um<{ n: number }>(`select count(*)::int as n from portal_eventos where tipo = 'gerado'`)).n);
    expect(semDoc).toContain("Cadastre o CPF/CNPJ ou o telefone");
    expect(corretor).toMatch(/row-level security|Só administradores/);
    expect(fin).toMatch(/^[0-9a-f-]{36}$/);
    expect(repetido).toContain("duplicate key");
    expect(verCorretor).toBe(0);
    expect(eventos).toBe(6);
  });

  it("modo pessoal: sem portal do proprietário; locatário e prestador sim", async () => {
    const r = await comoUsuario(db, PESSOAL, async () => {
      const dono = await id(`insert into pessoas (nome, documento, papeis) values ('Eu Mesmo', '222.333.444-55', '{proprietario}') returning id`);
      const inq = await id(`insert into pessoas (nome, documento, papeis) values ('Inquilino', '333.444.555-66', '{locatario}') returning id`);
      const erro = await erroDe(() => db.query(`insert into portal_acessos (pessoa_id, perfil) values ($1, 'proprietario')`, [dono]));
      const ok = await um<{ perfil: string }>(`insert into portal_acessos (pessoa_id, perfil) values ($1, 'locatario') returning perfil`, [inq]);
      return { erro, ok: ok.perfil };
    });
    expect(r.erro).toContain("modo imóveis pessoais");
    expect(r.ok).toBe("locatario");
  });

  it("outra organização não vê nem cria links nesta", async () => {
    const r = await comoUsuario(db, OUTRO, async () => {
      const ver = await um<{ a: number; e: number; s: number }>(
        `select (select count(*) from portal_acessos)::int as a, (select count(*) from portal_eventos)::int as e, (select count(*) from portal_solicitacoes)::int as s`,
      );
      const ins = await erroDe(() => db.query(`insert into portal_acessos (organizacao_id, pessoa_id, perfil) values ($1, $2, 'locatario')`, [org, ids.loc]));
      const sess = await erroDe(() => db.query(`select * from portal_sessoes`));
      return { ver, ins, sess };
    });
    expect(r.ver).toEqual({ a: 0, e: 0, s: 0 });
    expect(r.ins).toMatch(/row-level security|Pessoa não encontrada|Só administradores/);
    expect(r.sess).toBe("");
  });
});

describe("entrada no portal (anônimo)", () => {
  it("antes de entrar só mostra o primeiro nome; sem sessão não lê nada; token errado não existe", async () => {
    const info = await anon<{ entrou: boolean; primeiro_nome: string; tipo_codigo: string; nome: string | null; perfil: string }>(`select public.portal_inicio($1, null) as r`, [tokens.loc]);
    const semSessao = await dados("loc", "contrato");
    const errado = await anon(`select public.portal_inicio('00000000-0000-0000-0000-000000000000', null) as r`);
    const dadosErrado = await anon(`select public.portal_dados('00000000-0000-0000-0000-000000000000', null, 'inicio') as r`);
    const direto = await erroDe(() => comoAnonimo(db, () => db.query(`select * from portal_acessos`)));
    expect(info).toMatchObject({ entrou: false, primeiro_nome: "Bruno", tipo_codigo: "cpf", nome: null, perfil: "locatario" });
    expect(semSessao).toEqual({ erro: "sessao" });
    expect(errado).toBeNull();
    expect(dadosErrado).toEqual({ erro: "link" });
    expect(direto).toContain("permission denied");
  });

  it("errou 5 vezes: bloqueia 30 minutos (o contador não é desfeito); depois entra com os números certos", async () => {
    const tentativas = [];
    for (let i = 0; i < 5; i++) tentativas.push(await entrar("loc", "0000"));
    expect(tentativas.map((t) => t.restantes)).toEqual([4, 3, 2, 1, 0]);
    const bloqueado = await entrar("loc", "1112");
    expect(bloqueado.ok).toBe(false);
    expect(String(bloqueado.erro)).toContain("Muitas tentativas");
    const ev = await comoUsuario(db, GESTOR, async () =>
      (await db.query<{ tipo: string }>(`select tipo from portal_eventos where acesso_id = $1 and tipo in ('falha','bloqueio') order by data`, [ids.acesso_loc])).rows.map((e) => e.tipo),
    );
    expect(ev).toEqual(["falha", "falha", "falha", "falha", "bloqueio"]);
    await db.query(`update portal_acessos set bloqueado_ate = now() - interval '1 minute' where id = $1`, [ids.acesso_loc]);
    const ok = await entrar("loc", "111.2");
    expect(ok.ok).toBe(true);
    expect(String(ok.sessao)).toMatch(/^[0-9a-f]{64}$/);
    const inicio = await anon<{ entrou: boolean; nome: string }>(`select public.portal_inicio($1, $2) as r`, [tokens.loc, sessoes.loc]);
    expect(inicio).toMatchObject({ entrou: true, nome: "Bruno Locatário" });
    // O banco guarda só o hash da sessão.
    const guardado = await um<{ n: number }>(`select count(*)::int as n from portal_sessoes where hash = $1`, [sessoes.loc]);
    expect(guardado.n).toBe(0);
    // Sessão de um link não abre outro.
    expect(await anon(`select public.portal_dados($1, $2, 'inicio') as r`, [tokens.loc2, sessoes.loc])).toEqual({ erro: "sessao" });

    // Sem documento, entra com os 4 últimos números do telefone.
    expect((await entrar("loc2", "4321")).ok).toBe(true);
    for (const [k, c] of [
      ["prop", "1234"],
      ["prop2", "9876"],
      ["prest", "5556"],
      ["prest2", "9998"],
    ])
      expect((await entrar(k, c)).ok).toBe(true);
  });
});

describe("cada perfil só vê o que é dele", () => {
  it("proprietário: imóveis, contratos, documentos, repasses e informe dele", async () => {
    const imoveis = await dados<{ codigo: string; contrato: { locatario: string } }[]>("prop", "imoveis");
    const contratos = await dados<{ contratos: { numero: number; imovel: string }[]; documentos: { titulo: string }[] }>("prop", "contratos");
    const docProprio = await dados<{ conteudo: string }>("prop", "documento", { id: ids.docProp });
    const docAlheio = await dados("prop", "documento", { id: ids.docOutro });
    const docRestrito = await dados("prop", "documento", { id: ids.docRestrito });
    const repasses = await dados<{ imovel: string }[]>("prop", "repasses");
    const informe = await dados<{ ano: number; linhas: { imovel: string; locatario: { nome: string } }[] }>("prop", "informe", { ano: "2026" });
    const informe25 = await dados<{ linhas: unknown[] }>("prop", "informe", { ano: "2025" });
    const alugueis = await dados<{ imovel: string; status: string }[]>("prop", "alugueis");
    expect(imoveis.map((i) => i.codigo)).toEqual(["AP-1"]);
    expect(imoveis[0].contrato.locatario).toBe("Bruno Locatário");
    expect(contratos.contratos.map((c) => c.imovel)).toEqual(["AP-1"]);
    expect(contratos.documentos.map((d) => d.titulo).sort()).toEqual(["Contrato de administração", "Contrato de locação AP-1"]);
    expect(docProprio.conteudo).toBe("TEXTO DO CONTRATO 1");
    expect(docAlheio).toBeNull();
    expect(docRestrito).toBeNull();
    expect(repasses.map((r) => r.imovel)).toEqual(["AP-1"]);
    expect(informe.ano).toBe(2026);
    expect(informe.linhas.map((l) => [l.imovel, l.locatario.nome])).toEqual([["AP-1", "Bruno Locatário"]]);
    expect(informe25.linhas).toEqual([]);
    expect(new Set(alugueis.map((a) => a.imovel))).toEqual(new Set(["AP-1"]));
  });

  it("locatário: contrato e cobranças dele (com o link da 2ª via), recibo só da fatura dele, sem documentos de administração", async () => {
    const contrato = await dados<{ numero: number; imovel: string; documentos: { titulo: string }[] }[]>("loc", "contrato");
    const cobr = await dados<{ faturas: { id: string; token: string | null; status: string }[] }>("loc", "cobrancas");
    const cobr2 = await dados<{ faturas: { id: string }[] }>("loc2", "cobrancas");
    const recibo = await dados<{ fatura: { numero: number } }>("loc", "recibo", { id: ids.faturaPaga });
    const reciboAlheio = await dados("loc2", "recibo", { id: ids.faturaPaga });
    const reciboAberta = await dados("loc", "recibo", { id: ids.fatura1 });
    const docAdm = await dados("loc", "documento", { id: ids.docAdm });
    const pag = await dados<{ antigos: { fatura_id: string }[] }>("loc", "pagamentos");
    const prestLeContrato = await dados("prest", "contrato");
    expect(contrato.map((c) => c.imovel)).toEqual(["AP-1"]);
    expect(contrato[0].documentos.map((d) => d.titulo)).toEqual(["Contrato de locação AP-1"]);
    const aberta = cobr.faturas.find((f) => f.id === ids.fatura1);
    expect(aberta?.token).toMatch(/^[0-9a-f-]{36}$/);
    expect(cobr.faturas.find((f) => f.id === ids.faturaPaga)?.token ?? null).toBeNull();
    expect(cobr.faturas.some((f) => f.id === ids.fatura2)).toBe(false);
    expect(cobr2.faturas.map((f) => f.id)).toEqual([ids.fatura2]);
    expect(recibo.fatura.numero).toBeGreaterThan(0);
    expect(reciboAlheio).toBeNull();
    expect(reciboAberta).toBeNull();
    expect(docAdm).toBeNull();
    expect(pag.antigos.map((p) => p.fatura_id)).toEqual([ids.faturaPaga]);
    expect(prestLeContrato).toBeNull();
  });
});

describe("pagar pelo portal", () => {
  it("2ª via com Pix dentro do portal mesmo com o link público desligado; só a cobrança dele", async () => {
    await db.query(`update organizacoes set cobranca_link_publico = false, cobranca_pix_chave = 'pix@imob.com.br', cobranca_meios = '{pix}' where id = $1`, [org]);
    const via = await dados<{ tipo: string; token: string; link_publico: boolean; organizacao: { pix_chave: string; meios: string[] }; fatura: { numero: number; status: string } }>("loc", "pagar", {
      id: ids.fatura1,
    });
    const alheia = await dados("loc", "pagar", { id: ids.fatura2 });
    const outroLoc = await dados("loc2", "pagar", { id: ids.fatura1 });
    const semId = await dados("loc", "pagar", { id: "x" });
    const inicio = await dados<{ proxima: { id: string } }>("loc", "inicio");
    // A página pública continua desligada: o portal é que não depende dela.
    const publica = await anon(`select public.segunda_via($1) as r`, [via.token]);
    await db.query(`update organizacoes set cobranca_link_publico = true where id = $1`, [org]);
    expect(via).toMatchObject({ tipo: "fatura", link_publico: false, organizacao: { pix_chave: "pix@imob.com.br", meios: ["pix"] }, fatura: { status: "aberta" } });
    expect(via.token).toMatch(/^[0-9a-f-]{36}$/);
    expect(alheia).toBeNull();
    expect(outroLoc).toBeNull();
    expect(semId).toBeNull();
    expect(inicio.proxima.id).toBe(ids.fatura1);
    expect(publica).toBeNull();
  });
});

describe("pedidos pelo portal", () => {
  it("renovação/desocupação só do contrato dele, sem repetir; prestador só manda contato; limite por dia", async () => {
    const ok = await anon(`select public.portal_solicitar($1, $2, $3) as r`, [tokens.loc, sessoes.loc, { tipo: "renovacao", contrato_id: ids.contrato1 }]);
    const repetido = await erroDe(() => anon(`select public.portal_solicitar($1, $2, $3) as r`, [tokens.loc, sessoes.loc, { tipo: "renovacao", contrato_id: ids.contrato1 }]));
    const alheio = await erroDe(() => anon(`select public.portal_solicitar($1, $2, $3) as r`, [tokens.loc, sessoes.loc, { tipo: "desocupacao", contrato_id: ids.contrato2 }]));
    const prest = await erroDe(() => anon(`select public.portal_solicitar($1, $2, $3) as r`, [tokens.prest, sessoes.prest, { tipo: "renovacao" }]));
    const semSessao = await erroDe(() => anon(`select public.portal_solicitar($1, null, $2) as r`, [tokens.loc, { tipo: "contato", mensagem: "Oi" }]));
    expect(ok.ok).toBe(true);
    expect(repetido).toContain("Já existe um pedido igual");
    expect(alheio).toContain("Escolha o contrato");
    expect(prest).toContain("Tipo de pedido inválido");
    expect(semSessao).toContain("Sessão expirada");
    // A desocupação vira pedido para a equipe (não cria a desocupação sozinha).
    await anon(`select public.portal_solicitar($1, $2, $3) as r`, [tokens.loc, sessoes.loc, { tipo: "desocupacao", contrato_id: ids.contrato1, data_desejada: "2027-01-31" }]);
    const deso = await um<{ n: number }>(`select count(*)::int as n from contrato_desocupacoes where contrato_id = $1`, [ids.contrato1]);
    expect(deso.n).toBe(0);
    for (let i = 0; i < 3; i++) await anon(`select public.portal_solicitar($1, $2, $3) as r`, [tokens.loc, sessoes.loc, { tipo: "contato", mensagem: `Mensagem ${i}` }]);
    const limite = await erroDe(() => anon(`select public.portal_solicitar($1, $2, $3) as r`, [tokens.loc, sessoes.loc, { tipo: "contato", mensagem: "Mais uma" }]));
    expect(limite).toContain("Limite de envios");
    const minhas = await dados<{ tipo: string }[]>("loc", "solicitacoes");
    expect(minhas).toHaveLength(5);
    // "Hoje" é a data de São Paulo (de 21h à meia-noite o UTC já está no dia seguinte).
    const hoje = (await um<{ d: string }>(`select ((now() at time zone 'America/Sao_Paulo')::date)::text as d`)).d;
    const pe = await anon(`select public.portal_solicitar($1, $2, $3) as r`, [tokens.prop, sessoes.prop, { tipo: "contato", mensagem: "Posso passar hoje?", data_desejada: hoje }]);
    expect(pe.ok).toBe(true);
  });

  it("a equipe trata (sem reescrever a mensagem) e pode excluir; o corretor não vê", async () => {
    const r = await comoUsuario(db, GESTOR, async () => {
      const s = await um<{ id: string }>(`select id from portal_solicitacoes where tipo = 'renovacao'`);
      await db.query(`update portal_solicitacoes set status = 'concluida', resposta = 'Vamos preparar o aditivo.' where id = $1`, [s.id]);
      const depois = await um<{ tratado_em: string | null; tratado_por: string | null }>(`select tratado_em, tratado_por from portal_solicitacoes where id = $1`, [s.id]);
      const reescrever = await erroDe(() => db.query(`update portal_solicitacoes set mensagem = 'outra' where id = $1`, [s.id]));
      const inserir = await erroDe(() => db.query(`insert into portal_solicitacoes (perfil, mensagem) values ('locatario', 'falso')`));
      const c = await um<{ id: string }>(`select id from portal_solicitacoes where mensagem = 'Mensagem 0'`);
      const del = await db.query(`delete from portal_solicitacoes where id = $1`, [c.id]);
      return { depois, reescrever, inserir, del: del.affectedRows };
    });
    const corretor = await comoUsuario(db, CORRETOR, async () => (await um<{ n: number }>(`select count(*)::int as n from portal_solicitacoes`)).n);
    expect(r.depois.tratado_em).not.toBeNull();
    expect(r.depois.tratado_por).toBe(GESTOR);
    expect(r.reescrever).toContain("não pode ser alterado");
    expect(r.inserir).toContain("row-level security");
    expect(r.del).toBe(1);
    expect(corretor).toBe(0);
  });
});

describe("manutenção pelo portal", () => {
  it("locatário abre chamado e envia foto só na pasta liberada", async () => {
    const ch = await anon<{ id: string; numero: number; envio: string; pasta: string }>(`select public.portal_abrir_chamado($1, $2, $3) as r`, [
      tokens.loc,
      sessoes.loc,
      { contrato_id: ids.contrato1, titulo: "Torneira pingando", categoria: "hidraulica", urgencia: "baixa", local: "Cozinha" },
    ]);
    ids.chamadoLoc = ch.id;
    const pode = await anon<{ ok: boolean; outra: boolean; fora: boolean; subir: boolean }>(
      `select json_build_object('ok', public.portal_pode_enviar($1), 'outra', public.portal_pode_enviar($2), 'fora', public.portal_pode_enviar($3), 'subir', public.portal_pode_enviar($4)) as r`,
      [`${ch.pasta}/foto.jpg`, `${org}/${ch.id}/${"0".repeat(8)}-0000-0000-0000-${"0".repeat(12)}/foto.jpg`, `${orgB}/${ch.id}/${ch.envio}/foto.jpg`, `${ch.pasta}/../x.jpg`],
    );
    await anon(`select public.portal_registrar_midia($1, $2, $3, $4, 'foto.jpg', 'foto') as r`, [tokens.loc, sessoes.loc, ch.envio, `${ch.pasta}/foto.jpg`]);
    const errado = await erroDe(() => anon(`select public.portal_registrar_midia($1, $2, $3, $4, 'x.jpg', 'foto') as r`, [tokens.loc, sessoes.loc, ch.envio, `${orgB}/a/b/c.jpg`]));
    const outroPerfil = await erroDe(() => anon(`select public.portal_registrar_midia($1, $2, $3, $4, 'f.jpg', 'foto') as r`, [tokens.prest, sessoes.prest, ch.envio, `${ch.pasta}/f.jpg`]));
    const alheio = await erroDe(() => anon(`select public.portal_abrir_chamado($1, $2, $3) as r`, [tokens.loc, sessoes.loc, { contrato_id: ids.contrato2, titulo: "Invasão" }]));
    const salvo = await comoUsuario(db, GESTOR, async () =>
      um<{ origem: string; aberto_por: string; solicitante_pessoa_id: string; midias: number; momento: string }>(
        `select c.origem, c.aberto_por, c.solicitante_pessoa_id, (select count(*)::int from chamado_midias m where m.chamado_id = c.id) as midias,
                (select momento from chamado_midias m where m.chamado_id = c.id limit 1) as momento from chamados c where c.id = $1`,
        [ch.id],
      ),
    );
    const lista = await dados<{ chamados: { numero: number }[] }>("loc", "manutencao");
    expect(pode).toEqual({ ok: true, outra: false, fora: false, subir: false });
    expect(errado).toContain("Não foi possível registrar");
    expect(outroPerfil).toContain("O envio expirou");
    expect(alheio).toContain("Contrato não encontrado");
    expect(salvo).toMatchObject({ origem: "link", aberto_por: "locatario", solicitante_pessoa_id: ids.loc, midias: 1, momento: "antes" });
    expect(lista.chamados.map((c) => c.numero)).toContain(ch.numero);
  });

  it("proprietário aprova o orçamento só com o valor que viu; outro dono não acha o chamado", async () => {
    await comoUsuario(db, GESTOR, async () => {
      ids.chamadoAprov = await id(`insert into chamados (imovel_id, contrato_id, titulo, categoria) values ($1, $2, 'Telhado com goteira', 'telhado') returning id`, [ids.imovel1, ids.contrato1]);
      ids.orc = await id(`insert into chamado_orcamentos (chamado_id, prestador_id, valor, status, prazo_dias) values ($1, $2, 800, 'escolhido', 3) returning id`, [ids.chamadoAprov, ids.prest]);
      await db.query(`update chamados set status = 'em_analise' where id = $1`, [ids.chamadoAprov]);
      await db.query(
        `update chamados set status = 'aguardando_aprovacao', orcamento_id = $2, prestador_id = $3, valor_aprovado = 800, responsabilidade = 'proprietario', pct_proprietario = 100, aprovacao_status = 'pendente' where id = $1`,
        [ids.chamadoAprov, ids.orc, ids.prest],
      );
    });
    const lista = await dados<{ pendentes: { id: string; valor: string; parte_proprietario: string; orcamento_id: string }[] }>("prop", "aprovacoes");
    const p = lista.pendentes.find((x) => x.id === ids.chamadoAprov)!;
    expect(Number(p.valor)).toBe(800);
    const outroDono = await dados<{ pendentes: unknown[] }>("prop2", "aprovacoes");
    expect(outroDono.pendentes).toEqual([]);
    const base = { chamado: ids.chamadoAprov, orcamento: p.orcamento_id, nome: "Ana Proprietária", aprovar: true };
    const mudou = await erroDe(() => anon(`select public.portal_responder_orcamento($1, $2, $3) as r`, [tokens.prop, sessoes.prop, { ...base, valor: "750", parte: "750" }]));
    const naoDono = await erroDe(() => anon(`select public.portal_responder_orcamento($1, $2, $3) as r`, [tokens.prop2, sessoes.prop2, { ...base, valor: "800", parte: "800" }]));
    const ok = await anon(`select public.portal_responder_orcamento($1, $2, $3) as r`, [tokens.prop, sessoes.prop, { ...base, valor: String(p.valor), parte: String(p.parte_proprietario) }]);
    const de_novo = await erroDe(() => anon(`select public.portal_responder_orcamento($1, $2, $3) as r`, [tokens.prop, sessoes.prop, { ...base, valor: "800", parte: "800" }]));
    const ch = await um<{ status: string; aprovacao_status: string; aprovacao_nome: string; aprovacao_canal: string }>(
      `select status, aprovacao_status, aprovacao_nome, aprovacao_canal from chamados where id = $1`,
      [ids.chamadoAprov],
    );
    expect(mudou).toContain("O orçamento mudou");
    expect(naoDono).toContain("Chamado não encontrado");
    expect(ok.ok).toBe(true);
    expect(de_novo).toContain("não está mais aguardando");
    expect(ch).toEqual({ status: "aprovado", aprovacao_status: "aprovado", aprovacao_nome: "Ana Proprietária", aprovacao_canal: "link" });
  });

  it("prestador: envia orçamento pedido a ele, inicia, avisa que terminou e manda fotos do depois", async () => {
    await comoUsuario(db, GESTOR, async () => {
      ids.chamadoOrc = await id(`insert into chamados (imovel_id, titulo, categoria) values ($1, 'Curto no quadro', 'eletrica') returning id`, [ids.imovel2]);
      ids.pedido = await id(`insert into chamado_orcamentos (chamado_id, prestador_id) values ($1, $2) returning id`, [ids.chamadoOrc, ids.prest]);
    });
    const ordens = await dados<{ pedidos: { orcamento_id: string }[]; servicos: { id: string }[] }>("prest", "ordens");
    const ordens2 = await dados<{ pedidos: unknown[]; servicos: unknown[] }>("prest2", "ordens");
    expect(ordens.pedidos.map((x) => x.orcamento_id)).toEqual([ids.pedido]);
    expect(ordens.servicos.map((x) => x.id)).toContain(ids.chamadoAprov);
    expect(ordens2).toEqual({ pedidos: [], servicos: [] });
    const alheio = await erroDe(() => anon(`select public.portal_enviar_orcamento($1, $2, $3) as r`, [tokens.prest2, sessoes.prest2, { orcamento: ids.pedido, valor: "300" }]));
    const semValor = await erroDe(() => anon(`select public.portal_enviar_orcamento($1, $2, $3) as r`, [tokens.prest, sessoes.prest, { orcamento: ids.pedido, valor: "0" }]));
    await anon(`select public.portal_enviar_orcamento($1, $2, $3) as r`, [tokens.prest, sessoes.prest, { orcamento: ids.pedido, valor: "350.5", prazo_dias: "2", garantia_dias: "90", descricao: "Troca do disjuntor" }]);
    const orc = await um<{ status: string; valor: string; recebido_em: string | null }>(`select status, valor, recebido_em from chamado_orcamentos where id = $1`, [ids.pedido]);
    expect(alheio).toContain("Pedido de orçamento não encontrado");
    expect(semValor).toContain("Informe o valor");
    expect(orc.status).toBe("recebido");
    expect(Number(orc.valor)).toBe(350.5);
    expect(orc.recebido_em).not.toBeNull();

    const detalhe = await dados<{ designado: boolean; pode_iniciar: boolean; contato: { nome: string } | null }>("prest", "ordem", { id: ids.chamadoAprov });
    const detalheAlheio = await dados("prest2", "ordem", { id: ids.chamadoAprov });
    expect(detalhe.designado).toBe(true);
    expect(detalhe.pode_iniciar).toBe(true);
    expect(detalhe.contato?.nome).toBe("Bruno Locatário");
    expect(detalheAlheio).toBeNull();
    const alheioExec = await erroDe(() => anon(`select public.portal_execucao($1, $2, $3) as r`, [tokens.prest2, sessoes.prest2, { chamado: ids.chamadoAprov, acao: "iniciar" }]));
    await anon(`select public.portal_execucao($1, $2, $3) as r`, [tokens.prest, sessoes.prest, { chamado: ids.chamadoAprov, acao: "iniciar" }]);
    await anon(`select public.portal_execucao($1, $2, $3) as r`, [tokens.prest, sessoes.prest, { chamado: ids.chamadoAprov, acao: "concluir", comentario: "Telhas trocadas" }]);
    const envio = await anon<{ envio: string; pasta: string }>(`select public.portal_preparar_envio($1, $2, $3) as r`, [tokens.prest, sessoes.prest, ids.chamadoAprov]);
    await anon(`select public.portal_registrar_midia($1, $2, $3, $4, 'depois.jpg', 'foto') as r`, [tokens.prest, sessoes.prest, envio.envio, `${envio.pasta}/depois.jpg`]);
    const envioAlheio = await erroDe(() => anon(`select public.portal_preparar_envio($1, $2, $3) as r`, [tokens.prest2, sessoes.prest2, ids.chamadoAprov]));
    const ch = await um<{ status: string; prestador_concluiu_em: string | null; prestador_comentario: string; conclusao_aprovada_em: string | null }>(
      `select status, prestador_concluiu_em, prestador_comentario, conclusao_aprovada_em from chamados where id = $1`,
      [ids.chamadoAprov],
    );
    const midia = await um<{ momento: string; enviado_por: string; portal_pessoa_id: string }>(
      `select momento, enviado_por, portal_pessoa_id from chamado_midias where chamado_id = $1 and path like '%depois.jpg'`,
      [ids.chamadoAprov],
    );
    const eventos = await um<{ n: number }>(`select count(*)::int as n from chamado_eventos where chamado_id = $1 and tipo = 'portal'`, [ids.chamadoAprov]);
    expect(alheioExec).toContain("Serviço não encontrado");
    expect(envioAlheio).toContain("Chamado não encontrado");
    // A conclusão continua sendo da equipe: o chamado fica em execução com o aviso do prestador.
    expect(ch.status).toBe("em_execucao");
    expect(ch.prestador_concluiu_em).not.toBeNull();
    expect(ch.prestador_comentario).toBe("Telhas trocadas");
    expect(ch.conclusao_aprovada_em).toBeNull();
    expect(midia).toEqual({ momento: "depois", enviado_por: "equipe", portal_pessoa_id: ids.prest });
    expect(eventos.n).toBeGreaterThanOrEqual(3);
  });
});

describe("link revogado ou trocado", () => {
  it("desativar derruba a sessão; trocar o link invalida o endereço antigo", async () => {
    await comoUsuario(db, GESTOR, () => db.query(`update portal_acessos set ativo = false where id = $1`, [ids.acesso_loc2]));
    expect(await dados("loc2", "inicio")).toEqual({ erro: "link" });
    await comoUsuario(db, GESTOR, () => db.query(`update portal_acessos set ativo = true where id = $1`, [ids.acesso_loc2]));
    expect(await dados("loc2", "inicio")).toEqual({ erro: "sessao" });

    const antigo = tokens.prest2;
    const novo = await comoUsuario(db, GESTOR, async () => (await um<{ token: string }>(`update portal_acessos set token = gen_random_uuid() where token = $1 returning token`, [antigo])).token);
    expect(await anon(`select public.portal_inicio($1, null) as r`, [antigo])).toBeNull();
    expect(await anon(`select public.portal_dados($1, $2, 'inicio') as r`, [novo, sessoes.prest2])).toEqual({ erro: "sessao" });
    const tipos = await comoUsuario(db, GESTOR, async () => (await db.query<{ tipo: string }>(`select distinct tipo from portal_eventos`)).rows.map((r) => r.tipo));
    expect(tipos).toEqual(expect.arrayContaining(["gerado", "entrada", "falha", "bloqueio", "revogado", "reativado", "trocado", "solicitacao"]));
    const corretorTroca = await comoUsuario(db, CORRETOR, async () => (await db.query(`update portal_acessos set token = gen_random_uuid() where id = $1`, [ids.acesso_prop])).affectedRows);
    expect(corretorTroca).toBe(0);
  });

  it("excluir o link, a pessoa ou a organização não apaga o registro de acessos (nem dá erro)", async () => {
    const pessoa = await comoUsuario(db, GESTOR, async () => {
      const p = await id(`insert into pessoas (nome, documento, papeis) values ('Lúcia Pintora', '321.654.987-00', '{prestador}') returning id`);
      await db.query(`insert into portal_acessos (pessoa_id, perfil) values ($1, 'prestador')`, [p]);
      return p;
    });
    const token = (await um<{ token: string }>(`select token from portal_acessos where pessoa_id = $1`, [pessoa])).token;
    const r = await anon(`select public.portal_entrar($1, '3216') as r`, [token]);
    expect(r.ok).toBe(true);
    // O financeiro exclui o link: o registro fica (com a pessoa e o perfil) e ganha "Link excluído".
    await comoUsuario(db, FINANCEIRO, () => db.query(`delete from portal_acessos where pessoa_id = $1`, [pessoa]));
    const eventos = await comoUsuario(db, GESTOR, async () =>
      (await db.query<{ tipo: string; acesso_id: string | null; pessoa_nome: string; perfil: string }>(`select tipo, acesso_id, pessoa_nome, perfil from portal_eventos where pessoa_id = $1 order by data`, [pessoa])).rows,
    );
    expect(eventos.map((e) => e.tipo)).toEqual(["gerado", "entrada", "excluido"]);
    expect(eventos.every((e) => e.acesso_id === null && e.pessoa_nome === "Lúcia Pintora" && e.perfil === "prestador")).toBe(true);
    // Ninguém da equipe apaga nem altera o registro.
    const apagar = await comoUsuario(db, GESTOR, async () => (await db.query(`delete from portal_eventos where pessoa_id = $1`, [pessoa])).affectedRows);
    const alterar = await comoUsuario(db, GESTOR, async () => (await db.query(`update portal_eventos set descricao = 'x' where pessoa_id = $1`, [pessoa])).affectedRows);
    expect(apagar).toBe(0);
    expect(alterar).toBe(0);

    // Excluir a pessoa leva o link junto, mas o registro fica.
    const outra = await comoUsuario(db, GESTOR, async () => {
      const p = await id(`insert into pessoas (nome, telefone, papeis) values ('Rui Vidraceiro', '51977776666', '{prestador}') returning id`);
      await db.query(`insert into portal_acessos (pessoa_id, perfil) values ($1, 'prestador')`, [p]);
      return p;
    });
    await db.query(`delete from pessoas where id = $1`, [outra]);
    const daPessoa = await um<{ tipos: string[]; nome: string }>(`select array_agg(tipo order by data) as tipos, max(pessoa_nome) as nome from portal_eventos where pessoa_id = $1`, [outra]);
    expect(daPessoa.tipos).toEqual(["gerado", "excluido"]);
    expect(daPessoa.nome).toBe("Rui Vidraceiro");

    // Excluir a organização inteira continua funcionando (o registro vai junto com ela).
    const temp = await comoUsuario(db, "00000000-0000-0000-0000-000000018a07", async () => {
      const o = (await um<{ id: string }>(`select public.criar_organizacao('Temporária') as id`)).id;
      const p = await id(`insert into pessoas (nome, documento) values ('Teo', '111.111.111-11') returning id`);
      await db.query(`insert into portal_acessos (pessoa_id, perfil) values ($1, 'locatario')`, [p]);
      return o;
    });
    expect(await erroDe(() => db.query(`delete from organizacoes where id = $1`, [temp]))).toBe("");
    expect((await um<{ n: number }>(`select count(*)::int as n from portal_eventos where organizacao_id = $1`, [temp])).n).toBe(0);
  });

  it("modo trocado para pessoal: o link do proprietário para de funcionar", async () => {
    const outroOrg = await comoUsuario(db, OUTRO, async () => {
      const dono = await id(`insert into pessoas (nome, documento) values ('Dono B', '444.555.666-77') returning id`);
      return (await um<{ token: string }>(`insert into portal_acessos (pessoa_id, perfil) values ($1, 'proprietario') returning token`, [dono])).token;
    });
    expect(await anon(`select public.portal_inicio($1, null) as r`, [outroOrg])).not.toBeNull();
    await db.query(`update organizacoes set modo = 'pessoal' where id = $1`, [orgB]);
    expect(await anon(`select public.portal_inicio($1, null) as r`, [outroOrg])).toBeNull();
    const r = await anon(`select public.portal_entrar($1, '4445') as r`, [outroOrg]);
    expect(r.ok).toBe(false);
    await db.query(`update organizacoes set modo = 'imobiliaria' where id = $1`, [orgB]);
  });
});

describe("portal do corretor", () => {
  it("só admin/gestor ligam o usuário ao cadastro; o corretor vê só os dele", async () => {
    const negado = await erroDe(() => comoUsuario(db, CORRETOR, () => db.query(`select public.ligar_membro_pessoa($1, $2)`, [CORRETOR, ids.corretor2Pessoa])));
    await comoUsuario(db, GESTOR, async () => {
      await db.query(`select public.ligar_membro_pessoa($1, $2)`, [CORRETOR, ids.corretorPessoa]);
      await db.query(`select public.ligar_membro_pessoa($1, $2)`, [CORRETOR2, ids.corretor2Pessoa]);
      ids.leadRita = await id(`insert into leads (nome, telefone, corretor_id) values ('Lead da Rita', '5190000', $1) returning id`, [ids.corretorPessoa]);
      ids.leadCaio = await id(`insert into leads (nome, telefone, corretor_id) values ('Lead do Caio', '5191111', $1) returning id`, [ids.corretor2Pessoa]);
    });
    const repetido = await erroDe(() => comoUsuario(db, GESTOR, () => db.query(`select public.ligar_membro_pessoa($1, $2)`, [FINANCEIRO, ids.corretorPessoa])));
    const r = await comoUsuario(db, CORRETOR, async () => {
      const leads = await um<{ r: { nome: string }[] }>(`select public.corretor_portal('leads') as r`);
      const espiar = await um<{ r: { nome: string }[] }>(`select public.corretor_portal('leads', $1) as r`, [ids.corretor2Pessoa]);
      const imoveis = await um<{ r: { codigo: string }[] }>(`select public.corretor_portal('imoveis') as r`);
      const resumo = await um<{ r: { pessoa: { nome: string }; leads_abertos: number } }>(`select public.corretor_portal('resumo') as r`);
      const contatoAlheio = await erroDe(() => db.query(`select public.corretor_registrar_contato($1, $2)`, [ids.leadCaio, { tipo: "ligacao", descricao: "Tentei" }]));
      await db.query(`select public.corretor_registrar_contato($1, $2)`, [ids.leadRita, { tipo: "whatsapp", descricao: "Mandei fotos", proximo_contato: "2026-11-20" }]);
      return { leads: leads.r, espiar: espiar.r, imoveis: imoveis.r, resumo: resumo.r, contatoAlheio };
    });
    const gestorVe = await comoUsuario(db, GESTOR, async () => (await um<{ r: { nome: string }[] }>(`select public.corretor_portal('leads', $1) as r`, [ids.corretor2Pessoa])).r);
    const lead = await um<{ status: string; proximo_contato: string; eventos: number }>(
      `select status, proximo_contato::text, (select count(*)::int from lead_eventos where lead_id = l.id) as eventos from leads l where id = $1`,
      [ids.leadRita],
    );
    const pessoal = await erroDe(() => comoUsuario(db, PESSOAL, () => db.query(`select public.corretor_portal('resumo')`)));
    expect(negado).toContain("Só administradores e gestores");
    expect(repetido).toContain("já está ligado a outro usuário");
    expect(r.leads.map((l) => l.nome)).toEqual(["Lead da Rita"]);
    expect(r.espiar.map((l) => l.nome)).toEqual(["Lead da Rita"]);
    expect(r.imoveis.map((i) => i.codigo)).toEqual(["AP-1"]);
    expect(r.resumo.pessoa.nome).toBe("Rita Corretora");
    expect(r.contatoAlheio).toContain("Este lead não é seu");
    expect(gestorVe.map((l) => l.nome)).toEqual(["Lead do Caio"]);
    expect(lead).toEqual({ status: "em_atendimento", proximo_contato: "2026-11-20", eventos: 2 });
    expect(pessoal).toContain("só existe no modo imobiliária");
  });

  it("metas: a parte do corretor é a mesma conta do Comercial, só com os negócios dele (nunca passa da equipe)", async () => {
    // Janeiro/2026: os dois contratos começaram (AP-1 é da Rita, AP-2 do Caio); receitas recebidas ligadas a eles e uma do escritório.
    await db.query(
      `insert into lancamentos (organizacao_id, tipo, descricao, valor, vencimento, status, liquidado_em, contrato_id)
       values ($1, 'receber', 'Taxa AP-1', 200, '2026-01-10', 'liquidado', '2026-01-10', $2),
              ($1, 'receber', 'Taxa AP-2', 150, '2026-01-12', 'liquidado', '2026-01-12', $3),
              ($1, 'receber', 'Receita do escritório', 30, '2026-01-15', 'liquidado', '2026-01-15', null)`,
      [org, ids.contrato1, ids.contrato2],
    );
    await db.query(`insert into metas (organizacao_id, competencia, tipo, valor) values ($1, '2026-01-01', 'faturamento', 1000), ($1, '2026-01-01', 'locacoes', 4)`, [org]);
    type M = { meu: Record<string, number>; equipe: Record<string, number>; metas: Record<string, number>; comissoes: number };
    const rita = await comoUsuario(db, CORRETOR, async () => (await um<{ r: M }>(`select public.corretor_portal('metas', null, $1) as r`, [{ mes: "2026-01" }])).r);
    const caio = await comoUsuario(db, CORRETOR2, async () => (await um<{ r: M }>(`select public.corretor_portal('metas', null, $1) as r`, [{ mes: "2026-01" }])).r);
    expect(rita.equipe).toMatchObject({ locacoes: 2, faturamento: 380 });
    expect(rita.meu).toMatchObject({ locacoes: 1, faturamento: 200 });
    expect(caio.meu).toMatchObject({ locacoes: 1, faturamento: 150 });
    expect(Number(rita.metas.faturamento)).toBe(1000);
    for (const t of ["locacoes", "vendas", "captacoes", "leads", "faturamento"]) {
      expect(Number(rita.meu[t])).toBeLessThanOrEqual(Number(rita.equipe[t]));
      expect(Number(rita.meu[t]) + Number(caio.meu[t])).toBeLessThanOrEqual(Number(rita.equipe[t]));
    }
    expect(Number(rita.comissoes)).toBe(0);
  });

  it("documentos do corretor: cada corretor só os dele, na pasta dele; a gestão vê todos", async () => {
    const pasta = (p: string) => `${org}/${p}/arquivo.pdf`;
    const r = await comoUsuario(db, CORRETOR, async () => {
      await db.query(`insert into corretor_documentos (corretor_id, titulo, path) values ($1, 'CRECI', $2)`, [ids.corretorPessoa, pasta(ids.corretorPessoa)]);
      const alheio = await erroDe(() => db.query(`insert into corretor_documentos (corretor_id, titulo, path) values ($1, 'X', $2)`, [ids.corretor2Pessoa, pasta(ids.corretor2Pessoa)]));
      const foraDaPasta = await erroDe(() => db.query(`insert into corretor_documentos (corretor_id, titulo, path) values ($1, 'Y', $2)`, [ids.corretorPessoa, `${org}/outra/arquivo.pdf`]));
      const ok = await um<{ ok: boolean; outro: boolean }>(`select privado.corretor_arquivo_ok($1) as ok, privado.corretor_arquivo_ok($2) as outro`, [pasta(ids.corretorPessoa), pasta(ids.corretor2Pessoa)]);
      return { alheio, foraDaPasta, ok };
    });
    await comoUsuario(db, CORRETOR2, () => db.query(`insert into corretor_documentos (corretor_id, titulo, path) values ($1, 'RG', $2)`, [ids.corretor2Pessoa, pasta(ids.corretor2Pessoa)]));
    const ritaVe = await comoUsuario(db, CORRETOR, async () => (await db.query<{ titulo: string }>(`select titulo from corretor_documentos`)).rows.map((x) => x.titulo));
    const gestorVe = await comoUsuario(db, GESTOR, async () => (await um<{ n: number }>(`select count(*)::int as n from corretor_documentos`)).n);
    expect(r.alheio).toContain("row-level security");
    expect(r.foraDaPasta).toContain("fora da pasta");
    expect(r.ok).toEqual({ ok: true, outro: false });
    expect(ritaVe).toEqual(["CRECI"]);
    expect(gestorVe).toBe(2);
  });
});

describe("juntar cadastros repetidos", () => {
  it("links, pedidos e fotos do portal vão para o cadastro que fica", async () => {
    const r = await comoUsuario(db, GESTOR, async () => {
      const dup = await id(`insert into pessoas (nome, telefone, papeis) values ('Bruno L.', '51900001111', '{locatario}') returning id`);
      await db.query(`insert into portal_acessos (pessoa_id, perfil) values ($1, 'locatario'), ($1, 'prestador')`, [dup]);
      await db.query(`select public.juntar_pessoas($1, $2)`, [ids.loc, dup]);
      return (await db.query<{ perfil: string; ativo: boolean }>(`select perfil, ativo from portal_acessos where pessoa_id = $1 order by perfil, ativo`, [ids.loc])).rows;
    });
    const def = await um<{ d: string }>(`select pg_get_functiondef('public.juntar_pessoas(uuid, uuid)'::regprocedure) as d`);
    expect(def.d).toContain("privado.portal_juntar_pessoas(a.id, b.id)");
    // O link de locatário repetido fica desativado (um ativo por perfil); o de prestador passa ativo.
    expect(r).toEqual([
      { perfil: "locatario", ativo: false },
      { perfil: "locatario", ativo: true },
      { perfil: "prestador", ativo: true },
    ]);
  });
});
