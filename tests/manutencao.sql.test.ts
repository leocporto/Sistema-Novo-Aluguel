/**
 * Manutenção e chamados no banco (PGlite): prazo pela urgência, histórico só
 * leitura, isolamento por organização, abertura pelo locatário por link
 * (RPCs públicas por token), envio de fotos validado por função, aprovação do
 * proprietário por link, conclusão com lançamentos no Financeiro, desfazer e
 * excluir.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { comoAnonimo, comoUsuario, criarBanco } from "./pglite";

const GESTOR = "00000000-0000-0000-0000-000000014a01";
const OUTRO = "00000000-0000-0000-0000-000000014a02";
const PESSOAL = "00000000-0000-0000-0000-000000014a03";

let db: PGlite;
let org: string;
let orgB: string;
let imovel: string;
let contrato: string;
let locatario: string;
let prestador: string;
let fatura: string;

async function erroDe(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "";
  } catch (e) {
    return String(e);
  }
}

const um = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0];

beforeAll(async () => {
  db = await criarBanco();
  org = await comoUsuario(db, GESTOR, async () => (await um<{ id: string }>(`select public.criar_organizacao('Imob Manutenção') as id`)).id);
  orgB = await comoUsuario(db, OUTRO, async () => (await um<{ id: string }>(`select public.criar_organizacao('Outra Imob') as id`)).id);
  await comoUsuario(db, GESTOR, async () => {
    imovel = (await um<{ id: string }>(`insert into imoveis (codigo, logradouro, numero, cidade) values ('MAN-1', 'Rua das Flores', '10', 'Porto Alegre') returning id`)).id;
    locatario = (await um<{ id: string }>(`insert into pessoas (nome, telefone, papeis) values ('Lúcia Locatária', '51999990001', '{locatario}') returning id`)).id;
    prestador = (await um<{ id: string }>(`insert into pessoas (nome, telefone, papeis, especialidade) values ('Paulo Encanador', '51999990002', '{prestador}', 'Encanador') returning id`)).id;
    contrato = (
      await um<{ id: string }>(
        `insert into contratos (imovel_id, data_inicio, prazo_meses, data_fim, valor_aluguel, dia_vencimento, data_base_reajuste) values ($1, '2026-01-01', 30, '2028-06-30', 2000, 10, '2026-01-01') returning id`,
        [imovel],
      )
    ).id;
    await db.query(`insert into contrato_partes (contrato_id, pessoa_id, papel) values ($1, $2, 'locatario')`, [contrato, locatario]);
    fatura = (await um<{ id: string }>(`insert into faturas (contrato_id, competencia, vencimento, valor_total) values ($1, '2026-12-01', '2026-12-10', 2000) returning id`, [contrato])).id;
  });
});

describe("chamado interno", () => {
  it("calcula o prazo pela urgência, grava o histórico e o histórico não se apaga", async () => {
    const r = await comoUsuario(db, GESTOR, async () => {
      const c = await um<{ id: string; numero: number; prazo: number; organizacao_id: string }>(
        `insert into chamados (imovel_id, contrato_id, titulo, urgencia, categoria) values ($1, $2, 'Vazamento na pia', 'emergencia', 'hidraulica')
         returning id, numero, organizacao_id, extract(epoch from (prazo_atendimento - created_at))::int as prazo`,
        [imovel, contrato],
      );
      await db.query(`update chamados set status = 'em_analise' where id = $1`, [c.id]);
      await db.query(`update chamados set urgencia = 'baixa' where id = $1`, [c.id]);
      const depois = await um<{ prazo: number }>(`select extract(epoch from (prazo_atendimento - created_at))::int as prazo from chamados where id = $1`, [c.id]);
      const eventos = (await db.query<{ tipo: string; descricao: string }>(`select tipo, descricao from chamado_eventos where chamado_id = $1 order by data, tipo`, [c.id])).rows;
      const apagou = await db.query(`delete from chamado_eventos where chamado_id = $1`, [c.id]);
      const alterou = await db.query(`update chamado_eventos set descricao = 'x' where chamado_id = $1`, [c.id]);
      const restam = await um<{ n: number }>(`select count(*)::int as n from chamado_eventos where chamado_id = $1`, [c.id]);
      return { c, depois, eventos, apagou: apagou.affectedRows, alterou: alterou.affectedRows, restam: restam.n };
    });
    expect(r.c.organizacao_id).toBe(org);
    expect(r.c.prazo).toBe(4 * 3600);
    expect(r.depois.prazo).toBe(168 * 3600);
    expect(r.eventos.map((e) => e.tipo)).toEqual(expect.arrayContaining(["aberto", "status", "urgencia"]));
    expect(r.eventos.find((e) => e.tipo === "status")?.descricao).toBe("Aberto → Em análise");
    expect(r.apagou).toBe(0);
    expect(r.alterou).toBe(0);
    expect(r.restam).toBe(r.eventos.length);
  });

  it("outra organização não vê nem mexe nos chamados", async () => {
    const id = await comoUsuario(db, GESTOR, async () => (await um<{ id: string }>(`insert into chamados (imovel_id, titulo) values ($1, 'Lâmpada queimada') returning id`, [imovel])).id);
    await comoUsuario(db, GESTOR, () => db.query(`insert into chamado_orcamentos (chamado_id, prestador_id, valor) values ($1, $2, 100)`, [id, prestador]));
    await comoUsuario(db, GESTOR, () => db.query(`insert into chamado_links (contrato_id) values ($1) on conflict (contrato_id) do nothing`, [contrato]));
    const r = await comoUsuario(db, OUTRO, async () => {
      const ver = await um<{ c: number; e: number; o: number; l: number }>(
        `select (select count(*) from chamados)::int as c, (select count(*) from chamado_eventos)::int as e,
                (select count(*) from chamado_orcamentos)::int as o, (select count(*) from chamado_links)::int as l`,
      );
      const upd = await db.query(`update chamados set titulo = 'hack' where id = $1`, [id]);
      const ins = await erroDe(() => db.query(`insert into chamados (organizacao_id, imovel_id, titulo) values ($1, $2, 'invasão')`, [org, imovel]));
      return { ver, upd: upd.affectedRows, ins };
    });
    expect(r.ver).toEqual({ c: 0, e: 0, o: 0, l: 0 });
    expect(r.upd).toBe(0);
    expect(r.ins).toContain("row-level security");
    const titulo = await um<{ titulo: string }>(`select titulo from chamados where id = $1`, [id]);
    expect(titulo.titulo).toBe("Lâmpada queimada");
  });
});

describe("abertura pelo locatário (link público)", () => {
  it("abre chamado pelo token, aceita fotos só na pasta certa e recusa token errado", async () => {
    const token = await comoUsuario(db, GESTOR, async () => {
      await db.query(`insert into chamado_links (contrato_id) values ($1) on conflict (contrato_id) do nothing`, [contrato]);
      return (await um<{ token: string }>(`select token from chamado_links where contrato_id = $1`, [contrato])).token;
    });
    const r = await comoAnonimo(db, async () => {
      const info = await um<{ i: { imovel: string; locatario: string; ativo: boolean } }>(`select public.info_chamado_link($1) as i`, [token]);
      const aberto = await um<{ a: { id: string; numero: number; upload_token: string; pasta: string } }>(`select public.abrir_chamado_link($1, $2) as a`, [
        token,
        { nome: "Lúcia", telefone: "51999990001", titulo: "Chuveiro não esquenta", categoria: "eletrica", urgencia: "alta", descricao: "Desde ontem", local: "Banheiro" },
      ]);
      const pasta = aberto.a.pasta;
      const pode = await um<{ ok: boolean; errado: boolean; fora: boolean; subir: boolean }>(
        `select public.chamado_pode_enviar($1) as ok, public.chamado_pode_enviar($2) as errado, public.chamado_pode_enviar($3) as fora, public.chamado_pode_enviar($4) as subir`,
        [`${pasta}/foto.jpg`, `${pasta.split("/").slice(0, 2).join("/")}/${"0".repeat(8)}-0000-0000-0000-${"0".repeat(12)}/foto.jpg`, `${orgB}/${aberto.a.id}/${aberto.a.upload_token}/foto.jpg`, `${pasta}/../x.jpg`],
      );
      await db.query(`select public.registrar_midia_chamado_link($1, $2, $3, $4, 'foto.jpg', 'foto')`, [token, aberto.a.id, aberto.a.upload_token, `${pasta}/foto.jpg`]);
      const midiaErrada = await erroDe(() =>
        db.query(`select public.registrar_midia_chamado_link($1, $2, $3, $4, 'x.jpg', 'foto')`, [token, aberto.a.id, aberto.a.upload_token, `${orgB}/x/y/z.jpg`]),
      );
      const invalido = await erroDe(() => db.query(`select public.abrir_chamado_link($1, $2)`, ["00000000-0000-0000-0000-000000000000", { nome: "X", titulo: "Teste" }]));
      const semNome = await erroDe(() => db.query(`select public.abrir_chamado_link($1, $2)`, [token, { nome: "", titulo: "Teste" }]));
      const direto = await erroDe(() => db.query(`select * from chamados`));
      const depois = await um<{ i: { chamados: { numero: number; status: string }[] } }>(`select public.info_chamado_link($1) as i`, [token]);
      return { info: info.i, aberto: aberto.a, pode, midiaErrada, invalido, semNome, direto, lista: depois.i.chamados };
    });
    expect(r.info).toMatchObject({ imovel: "MAN-1", locatario: "Lúcia", ativo: true });
    expect(r.pode).toEqual({ ok: true, errado: false, fora: false, subir: false });
    expect(r.midiaErrada).toContain("Não foi possível registrar");
    expect(r.invalido).toContain("Link inválido");
    expect(r.semNome).toContain("Digite seu nome");
    expect(r.direto).toContain("permission denied");
    expect(r.lista.some((c) => c.numero === r.aberto.numero && c.status === "aberto")).toBe(true);

    const salvo = await comoUsuario(db, GESTOR, async () =>
      um<{ origem: string; aberto_por: string; solicitante_pessoa_id: string; urgencia: string; midias: number; organizacao_id: string; contrato_id: string }>(
        `select origem, aberto_por, solicitante_pessoa_id, urgencia, organizacao_id, contrato_id, (select count(*)::int from chamado_midias m where m.chamado_id = c.id) as midias from chamados c where id = $1`,
        [r.aberto.id],
      ),
    );
    expect(salvo).toMatchObject({ origem: "link", aberto_por: "locatario", solicitante_pessoa_id: locatario, urgencia: "alta", midias: 1, organizacao_id: org, contrato_id: contrato });

    // Link desativado para de funcionar
    await comoUsuario(db, GESTOR, () => db.query(`update chamado_links set ativo = false where contrato_id = $1`, [contrato]));
    const desativado = await comoAnonimo(db, async () => ({
      info: (await um<{ i: unknown }>(`select public.info_chamado_link($1) as i`, [token])).i,
      abrir: await erroDe(() => db.query(`select public.abrir_chamado_link($1, $2)`, [token, { nome: "Lúcia", titulo: "Outro problema" }])),
    }));
    expect(desativado.info).toBeNull();
    expect(desativado.abrir).toContain("Link inválido");
    await comoUsuario(db, GESTOR, () => db.query(`update chamado_links set ativo = true where contrato_id = $1`, [contrato]));
  });

  it("problema repetido dentro da garantia aponta o chamado anterior; locatário confirma o serviço", async () => {
    const anterior = await comoUsuario(db, GESTOR, async () =>
      (
        await um<{ id: string }>(
          `insert into chamados (imovel_id, contrato_id, titulo, categoria, status, concluido_em, garantia_ate) values ($1, $2, 'Telhado consertado', 'telhado', 'concluido', current_date - 10, current_date + 80) returning id`,
          [imovel, contrato],
        )
      ).id,
    );
    const token = await comoUsuario(db, GESTOR, async () => (await um<{ token: string }>(`select token from chamado_links where contrato_id = $1`, [contrato])).token);
    const r = await comoAnonimo(db, async () => {
      const a = (await um<{ a: { id: string; garantia: boolean } }>(`select public.abrir_chamado_link($1, $2) as a`, [token, { nome: "Lúcia", titulo: "Goteira voltou", categoria: "telhado" }])).a;
      await db.query(`select public.confirmar_servico_chamado($1, $2, 'Ficou ótimo')`, [token, anterior]);
      const deNovo = await erroDe(() => db.query(`select public.confirmar_servico_chamado($1, $2, null)`, [token, anterior]));
      return { a, deNovo };
    });
    expect(r.a.garantia).toBe(true);
    expect(r.deNovo).toContain("já confirmou");
    const v = await comoUsuario(db, GESTOR, async () =>
      um<{ origem: string; confirmou: boolean; ev: number }>(
        `select (select chamado_origem_id from chamados where id = $1) as origem,
                (select locatario_confirmou_em is not null from chamados where id = $2) as confirmou,
                (select count(*)::int from chamado_eventos where chamado_id = $2 and tipo = 'confirmacao') as ev`,
        [r.a.id, anterior],
      ),
    );
    expect(v).toEqual({ origem: anterior, confirmou: true, ev: 1 });
  });
});

describe("aprovação do proprietário por link", () => {
  it("mostra os orçamentos, registra a resposta uma vez só e não existe no modo pessoal", async () => {
    const c = await comoUsuario(db, GESTOR, async () => {
      const id = (await um<{ id: string }>(`insert into chamados (imovel_id, titulo, categoria, responsabilidade, pct_proprietario) values ($1, 'Troca de telhas', 'telhado', 'proprietario', 100) returning id`, [imovel])).id;
      const o1 = (await um<{ id: string }>(`insert into chamado_orcamentos (chamado_id, prestador_id, valor, prazo_dias, garantia_dias, status) values ($1, $2, 900, 3, 90, 'escolhido') returning id`, [id, prestador])).id;
      await db.query(`insert into chamado_orcamentos (chamado_id, prestador_nome, valor, prazo_dias, garantia_dias, status) values ($1, 'Telhados Silva', 1200, 2, 180, 'recusado')`, [id]);
      await db.query(`update chamados set orcamento_id = $2, prestador_id = $3, valor_aprovado = 900, status = 'aguardando_aprovacao', aprovacao_status = 'pendente' where id = $1`, [id, o1, prestador]);
      expect(await erroDe(() => db.query(`update chamados set status = 'agendado' where id = $1`, [id]))).toContain("aguardando a aprovação do proprietário");
      return um<{ id: string; aprovacao_token: string }>(`select id, aprovacao_token from chamados where id = $1`, [id]);
    });
    const r = await comoAnonimo(db, async () => {
      const info = (await um<{ i: { orcamentos: { prestador: string; valor: number; escolhido: boolean }[]; parte_proprietario: number; aprovacao_status: string } }>(`select public.info_aprovacao_chamado($1) as i`, [c.aprovacao_token])).i;
      const semNome = await erroDe(() => db.query(`select public.responder_aprovacao_chamado($1, $2)`, [c.aprovacao_token, { aprovar: true, nome: "" }]));
      const resp = (await um<{ r: { aprovado: boolean } }>(`select public.responder_aprovacao_chamado($1, $2) as r`, [c.aprovacao_token, { aprovar: true, nome: "Dono do Imóvel", obs: "Pode fazer" }])).r;
      const deNovo = await erroDe(() => db.query(`select public.responder_aprovacao_chamado($1, $2)`, [c.aprovacao_token, { aprovar: false, nome: "Dono do Imóvel" }]));
      return { info, semNome, resp, deNovo };
    });
    expect(r.info.orcamentos).toHaveLength(2);
    expect(r.info.orcamentos[0]).toMatchObject({ prestador: "Paulo Encanador", escolhido: true });
    expect(Number(r.info.parte_proprietario)).toBe(900);
    expect(r.semNome).toContain("nome completo");
    expect(r.resp.aprovado).toBe(true);
    expect(r.deNovo).toContain("não está mais aguardando");
    const depois = await comoUsuario(db, GESTOR, async () =>
      um<{ status: string; aprovacao_status: string; aprovacao_nome: string; aprovacao_canal: string; ev: string }>(
        `select status, aprovacao_status, aprovacao_nome, aprovacao_canal, (select descricao from chamado_eventos where chamado_id = c.id and tipo = 'aprovacao' order by data desc limit 1) as ev from chamados c where id = $1`,
        [c.id],
      ),
    );
    expect(depois).toMatchObject({ status: "aprovado", aprovacao_status: "aprovado", aprovacao_nome: "Dono do Imóvel", aprovacao_canal: "link" });
    expect(depois.ev).toContain("pelo link");

    // Modo pessoal: não há aprovação de proprietário de terceiros
    const tokenPessoal = await comoUsuario(db, PESSOAL, async () => {
      const o = (await um<{ id: string }>(`select public.criar_organizacao('Meus imóveis') as id`)).id;
      await db.query(`update organizacoes set modo = 'pessoal' where id = $1`, [o]);
      const im = (await um<{ id: string }>(`insert into imoveis (codigo) values ('CASA-1') returning id`)).id;
      return (await um<{ t: string }>(`insert into chamados (imovel_id, titulo, status, aprovacao_status) values ($1, 'Pintura', 'aguardando_aprovacao', 'pendente') returning aprovacao_token as t`, [im])).t;
    });
    const pessoal = await comoAnonimo(db, async () => ({
      info: (await um<{ i: unknown }>(`select public.info_aprovacao_chamado($1) as i`, [tokenPessoal])).i,
      resp: await erroDe(() => db.query(`select public.responder_aprovacao_chamado($1, $2)`, [tokenPessoal, { aprovar: true, nome: "Alguém Qualquer" }])),
    }));
    expect(pessoal.info).toBeNull();
    expect(pessoal.resp).toContain("inválido");
  });
});

describe("conclusão e financeiro", () => {
  it("lança em aberto (mesmo acima do limite de aprovação), cobra na fatura, desfaz e exclui", async () => {
    await comoUsuario(db, GESTOR, () => db.query(`update organizacoes set aprovacao_pagamento_acima = 100 where id = $1`, [org]));
    const r = await comoUsuario(db, GESTOR, async () => {
      const id = (
        await um<{ id: string }>(
          `insert into chamados (imovel_id, contrato_id, titulo, categoria, status, responsabilidade, pct_locatario, pct_proprietario, prestador_id, valor_aprovado)
           values ($1, $2, 'Conserto do aquecedor', 'hidraulica', 'em_execucao', 'dividido', 40, 60, $3, 1000) returning id`,
          [imovel, contrato, prestador],
        )
      ).id;
      const p = {
        concluido_em: "2026-11-20",
        valor_final: 1000,
        aprovado_por: "Lúcia (locatária)",
        garantia_dias: 90,
        garantia_ate: "2027-02-18",
        cobranca_locatario: "fatura",
        lancamentos: [
          { tipo: "pagar", descricao: "Manutenção — aquecedor (parte do proprietário)", valor: 600, vencimento: "2026-11-25", pessoa_id: prestador, descontar_repasse: true, terceiros: true },
          { tipo: "pagar", descricao: "Manutenção — aquecedor (parte do locatário)", valor: 400, vencimento: "2026-11-25", pessoa_id: prestador, descontar_repasse: false },
        ],
        fatura: { fatura_id: fatura, valor: 400, descricao: "Manutenção #1 — aquecedor (sua parte)", destino: "imobiliaria" },
      };
      await db.query(`select public.concluir_chamado($1, $2)`, [id, p]);
      const lancs = (await db.query<{ valor: string; status: string; descontar_repasse: boolean; terceiros: boolean; categoria: string; requer_aprovacao: boolean; imovel_id: string }>(
        `select valor, status, descontar_repasse, terceiros, categoria, requer_aprovacao, imovel_id from lancamentos where chamado_id = $1 order by valor desc`,
        [id],
      )).rows;
      const fat = await um<{ valor_total: string; itens: number }>(`select valor_total, (select count(*)::int from fatura_itens where fatura_id = f.id and tipo = 'outro') as itens from faturas f where id = $1`, [fatura]);
      const ch = await um<{ status: string; garantia_ate: string; fatura_item_id: string | null; conclusao_aprovada_por: string }>(`select status, garantia_ate::text, fatura_item_id, conclusao_aprovada_por from chamados where id = $1`, [id]);
      const deNovo = await erroDe(() => db.query(`select public.concluir_chamado($1, $2)`, [id, p]));
      const dobrada = await erroDe(() => db.query(`select public.cobrar_chamado_na_fatura($1, $2, 10, 'x', 'imobiliaria')`, [id, fatura]));

      await db.query(`select public.desfazer_conclusao_chamado($1)`, [id]);
      const paga = (await um<{ id: string }>(`insert into faturas (contrato_id, competencia, vencimento, valor_total, status) values ($1, '2026-10-01', '2026-10-10', 2000, 'paga') returning id`, [contrato])).id;
      const naPaga = await erroDe(() => db.query(`select public.cobrar_chamado_na_fatura($1, $2, 10, 'x', 'imobiliaria')`, [id, paga]));
      const aposDesfazer = await um<{ lancs: number; total: string; status: string }>(
        `select (select count(*)::int from lancamentos where chamado_id = $1) as lancs, (select valor_total from faturas where id = $2) as total, (select status from chamados where id = $1) as status`,
        [id, fatura],
      );

      // Conclui de novo sem fatura; um pagamento baixado impede desfazer/excluir
      await db.query(`select public.concluir_chamado($1, $2)`, [id, { ...p, fatura: null, cobranca_locatario: "receber", lancamentos: [{ ...p.lancamentos[1], valor: 50 }] }]);
      const baixa = (await um<{ id: string }>(`select id from lancamentos where chamado_id = $1`, [id])).id;
      await db.query(`update lancamentos set status = 'liquidado', liquidado_em = '2026-11-25', valor_pago = 50 where id = $1`, [baixa]);
      const desfazerPago = await erroDe(() => db.query(`select public.desfazer_conclusao_chamado($1)`, [id]));
      const excluirPago = await erroDe(() => db.query(`select public.excluir_chamado($1)`, [id]));
      return { lancs, fat, ch, deNovo, dobrada, naPaga, aposDesfazer, desfazerPago, excluirPago };
    });
    expect(r.lancs).toHaveLength(2);
    expect(r.lancs.map((l) => [Number(l.valor), l.status, l.descontar_repasse, l.terceiros, l.categoria])).toEqual([
      [600, "aberto", true, true, "Manutenção"],
      [400, "aberto", false, false, "Manutenção"],
    ]);
    expect(r.lancs.every((l) => l.requer_aprovacao && l.imovel_id === imovel)).toBe(true);
    expect(r.fat).toEqual({ valor_total: "2400.00", itens: 1 });
    expect(r.ch).toMatchObject({ status: "concluido", garantia_ate: "2027-02-18", conclusao_aprovada_por: "Lúcia (locatária)" });
    expect(r.ch.fatura_item_id).not.toBeNull();
    expect(r.deNovo).toContain("Só dá para concluir");
    expect(r.dobrada).toContain("já está numa fatura");
    expect(r.naPaga).toContain("fatura em aberto");
    expect(r.aposDesfazer).toEqual({ lancs: 0, total: "2000.00", status: "em_execucao" });
    expect(r.desfazerPago).toContain("Estorne no Financeiro");
    expect(r.excluirPago).toContain("Estorne a baixa");
  });

  it("excluir leva junto os lançamentos em aberto e o compromisso agendado", async () => {
    const r = await comoUsuario(db, GESTOR, async () => {
      const visita = (await um<{ id: string }>(`insert into visitas (tipo, titulo, data_hora, imovel_id) values ('outro', 'Manutenção', '2026-11-30T13:00:00Z', $1) returning id`, [imovel])).id;
      const id = (await um<{ id: string }>(`insert into chamados (imovel_id, titulo, status, visita_id) values ($1, 'Porta emperrada', 'agendado', $2) returning id`, [imovel, visita])).id;
      await db.query(`insert into lancamentos (tipo, descricao, valor, vencimento, chamado_id) values ('pagar', 'Chaveiro', 80, '2026-11-30', $1)`, [id]);
      await db.query(`select public.excluir_chamado($1)`, [id]);
      return um<{ c: number; l: number; v: number }>(
        `select (select count(*)::int from chamados where id = $1) as c, (select count(*)::int from lancamentos where chamado_id = $1) as l, (select count(*)::int from visitas where id = $2) as v`,
        [id, visita],
      );
    });
    expect(r).toEqual({ c: 0, l: 0, v: 0 });
  });
});

describe("fotos do locatário no bucket (Storage simulado)", () => {
  it("o anônimo só grava na pasta do chamado que acabou de abrir pelo link", async () => {
    // Banco próprio com um schema "storage" mínimo, para as policies do bucket serem criadas e testadas.
    const st = new PGlite();
    await st.exec(`
      create role anon nologin; create role authenticated nologin;
      create schema auth;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
      create schema storage;
      create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
      create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
      alter table storage.objects enable row level security;
      create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
      grant usage on schema storage to anon, authenticated;
      grant select, insert, delete on storage.objects to anon, authenticated;
      grant execute on function storage.foldername(text) to anon, authenticated;
    `);
    const dir = join(__dirname, "..", "supabase", "migrations");
    for (const f of readdirSync(dir).sort()) await st.exec(readFileSync(join(dir, f), "utf8"));
    await st.exec(`grant usage on schema public to authenticated; grant select, insert, update, delete on all tables in schema public to authenticated;`);
    const U = "00000000-0000-0000-0000-000000014b01";
    const r = await comoUsuario(st, U, async () => {
      const o = (await st.query<{ id: string }>(`select public.criar_organizacao('Storage') as id`)).rows[0].id;
      const im = (await st.query<{ id: string }>(`insert into imoveis (codigo) values ('S-1') returning id`)).rows[0].id;
      const c = (
        await st.query<{ id: string }>(
          `insert into contratos (imovel_id, data_inicio, prazo_meses, data_fim, valor_aluguel, dia_vencimento, data_base_reajuste) values ($1, '2026-01-01', 12, '2026-12-31', 1000, 5, '2026-01-01') returning id`,
          [im],
        )
      ).rows[0].id;
      await st.query(`insert into storage.objects (bucket_id, name) values ('manutencao', $1)`, [`${o}/x/foto.jpg`]);
      const t = (await st.query<{ token: string }>(`insert into chamado_links (contrato_id) values ($1) returning token`, [c])).rows[0].token;
      return { o, t };
    });
    const anon = await comoAnonimo(st, async () => {
      const a = (await st.query<{ a: { pasta: string } }>(`select public.abrir_chamado_link($1, $2) as a`, [r.t, { nome: "Ana", titulo: "Pia entupida" }])).rows[0].a;
      await st.query(`insert into storage.objects (bucket_id, name) values ('manutencao', $1)`, [`${a.pasta}/foto.jpg`]);
      return { negado: await erroDe(() => st.query(`insert into storage.objects (bucket_id, name) values ('manutencao', $1)`, [`${r.o}/qualquer/foto.jpg`])) };
    });
    expect(anon.negado).toContain("row-level security");
    const b = await st.query<{ public: boolean }>(`select public from storage.buckets where id = 'manutencao'`);
    expect(b.rows).toEqual([{ public: false }]);
  });
});

describe("correções da revisão", () => {
  it("link de chamado só para contrato da mesma organização (gatilho e RPCs)", async () => {
    const contrato2 = await comoUsuario(db, GESTOR, async () => {
      const im2 = (await um<{ id: string }>(`insert into imoveis (codigo) values ('MAN-2') returning id`)).id;
      return (
        await um<{ id: string }>(
          `insert into contratos (imovel_id, data_inicio, prazo_meses, data_fim, valor_aluguel, dia_vencimento, data_base_reajuste) values ($1, '2026-02-01', 30, '2028-07-31', 2100, 10, '2026-02-01') returning id`,
          [im2],
        )
      ).id;
    });
    // Outra organização com o UUID do contrato alheio não consegue criar o link.
    const invasao = await comoUsuario(db, OUTRO, () => erroDe(() => db.query(`insert into chamado_links (contrato_id) values ($1)`, [contrato2])));
    expect(invasao).toContain("Contrato não encontrado");
    // Mesmo que um link "torto" exista (gravado à força, sem o gatilho), as RPCs públicas não confiam nele.
    await db.exec(`set session_replication_role = replica;`);
    const torto = (await um<{ token: string }>(`insert into chamado_links (organizacao_id, contrato_id) values ($1, $2) returning token`, [orgB, contrato2])).token;
    await db.exec(`set session_replication_role = origin;`);
    const r = await comoAnonimo(db, async () => ({
      info: (await um<{ i: unknown }>(`select public.info_chamado_link($1) as i`, [torto])).i,
      abrir: await erroDe(() => db.query(`select public.abrir_chamado_link($1, $2)`, [torto, { nome: "Intruso", titulo: "Ver dados alheios" }])),
    }));
    expect(r.info).toBeNull();
    expect(r.abrir).toContain("Link inválido");
    await db.query(`delete from chamado_links where token = $1`, [torto]);
    // A dona do contrato gera o link dela normalmente.
    const ok = await comoUsuario(db, GESTOR, () => erroDe(() => db.query(`insert into chamado_links (contrato_id) values ($1)`, [contrato2])));
    expect(ok).toBe("");
  });

  it("desfazer e excluir recusam despesa descontada só em parte num repasse", async () => {
    const { id, lanc } = await comoUsuario(db, GESTOR, async () => {
      const id = (
        await um<{ id: string }>(
          `insert into chamados (imovel_id, titulo, categoria, status, responsabilidade, pct_proprietario, prestador_id, valor_aprovado)
           values ($1, 'Infiltração na parede', 'telhado', 'em_execucao', 'proprietario', 100, $2, 300) returning id`,
          [imovel, prestador],
        )
      ).id;
      await db.query(`select public.concluir_chamado($1, $2)`, [
        id,
        { concluido_em: "2026-11-02", valor_final: 300, aprovado_por: "Gestor", lancamentos: [{ tipo: "pagar", descricao: "Manutenção — infiltração", valor: 300, vencimento: "2026-11-10", pessoa_id: prestador, descontar_repasse: true, terceiros: true }] },
      ]);
      return { id, lanc: (await um<{ id: string }>(`select id from lancamentos where chamado_id = $1`, [id])).id };
    });
    // Desconto parcial (Repasses grava em repasse_descontos e só preenche repasse_id quando desconta tudo).
    await db.exec(`do $$ begin
      if to_regclass('public.repasse_descontos') is null then
        create table public.repasse_descontos (id uuid primary key default gen_random_uuid(), organizacao_id uuid, repasse_id uuid, lancamento_id uuid,
          tipo text not null default 'despesa', descricao text, valor numeric(14,2));
      end if;
    end $$;`);
    await db.exec(`set session_replication_role = replica;`);
    await db.query(`insert into public.repasse_descontos (organizacao_id, repasse_id, lancamento_id, descricao, valor) values ($1, gen_random_uuid(), $2, 'parte', 100)`, [org, lanc]);
    await db.exec(`set session_replication_role = origin;`);
    const r = await comoUsuario(db, GESTOR, async () => ({
      desfazer: await erroDe(() => db.query(`select public.desfazer_conclusao_chamado($1)`, [id])),
      excluir: await erroDe(() => db.query(`select public.excluir_chamado($1)`, [id])),
      lancs: (await um<{ n: number }>(`select count(*)::int as n from lancamentos where chamado_id = $1`, [id])).n,
    }));
    expect(r.desfazer).toContain("descontada (toda ou em parte)");
    expect(r.excluir).toContain("descontada (toda ou em parte)");
    expect(r.lancs).toBe(1);
    await db.query(`delete from public.repasse_descontos where lancamento_id = $1`, [lanc]);
    const depois = await comoUsuario(db, GESTOR, () => erroDe(() => db.query(`select public.desfazer_conclusao_chamado($1)`, [id])));
    expect(depois).toBe("");
  });

  it("pedido de novo: ao aprovar volta para onde estava; ao recusar, orçamento volta a 'recebido' e a agenda é desmarcada", async () => {
    const c = await comoUsuario(db, GESTOR, async () => {
      const visita = (await um<{ id: string }>(`insert into visitas (tipo, titulo, data_hora, imovel_id) values ('outro', 'Manutenção', '2026-12-01T13:00:00Z', $1) returning id`, [imovel])).id;
      const id = (
        await um<{ id: string }>(
          `insert into chamados (imovel_id, titulo, categoria, status, responsabilidade, pct_locatario, prestador_id, valor_aprovado, visita_id, agendado_para, iniciado_em)
           values ($1, 'Fiação do chuveiro', 'eletrica', 'em_execucao', 'locatario', 100, $2, 500, $3, '2026-12-01T13:00:00Z', now()) returning id`,
          [imovel, prestador, visita],
        )
      ).id;
      const orc = (await um<{ id: string }>(`insert into chamado_orcamentos (chamado_id, prestador_id, valor, status) values ($1, $2, 500, 'escolhido') returning id`, [id, prestador])).id;
      // A ação passou a conta para o proprietário durante a execução: pede a aprovação dele de novo.
      await db.query(
        `update chamados set orcamento_id = $2, responsabilidade = 'proprietario', pct_locatario = 0, pct_proprietario = 100,
           status = 'aguardando_aprovacao', aprovacao_status = 'pendente', status_antes_aprovacao = 'em_execucao' where id = $1`,
        [id, orc],
      );
      const t = await um<{ aprovacao_token: string }>(`select aprovacao_token from chamados where id = $1`, [id]);
      return { id, orc, visita, token: t.aprovacao_token };
    });
    const info = await comoAnonimo(db, async () => (await um<{ i: { pago_direto: boolean; aprovacao_status: string } }>(`select public.info_aprovacao_chamado($1) as i`, [c.token])).i);
    expect(info).toMatchObject({ pago_direto: false, aprovacao_status: "pendente" });
    await comoAnonimo(db, () => db.query(`select public.responder_aprovacao_chamado($1, $2)`, [c.token, { aprovar: true, nome: "Dono do Imóvel" }]));
    const aprovado = await comoUsuario(db, GESTOR, () => um<{ status: string; antes: string | null }>(`select status, status_antes_aprovacao as antes from chamados where id = $1`, [c.id]));
    expect(aprovado).toEqual({ status: "em_execucao", antes: null });

    // De novo (agora a partir de "agendado"), e o proprietário recusa pela equipe (registro manual).
    const r = await comoUsuario(db, GESTOR, async () => {
      await db.query(`update chamados set status = 'aguardando_aprovacao', aprovacao_status = 'pendente', status_antes_aprovacao = 'agendado' where id = $1`, [c.id]);
      await db.query(`select public.registrar_aprovacao_chamado($1, $2)`, [c.id, { aprovar: false, nome: "Dono do Imóvel", obs: "Caro demais" }]);
      return um<{ status: string; canal: string; agendado: string | null; orc: string; visita: string; ev: number }>(
        `select c.status, c.aprovacao_canal as canal, c.agendado_para::text as agendado,
                (select status from chamado_orcamentos where id = $2) as orc,
                (select status from visitas where id = $3) as visita,
                (select count(*)::int from visita_eventos where visita_id = $3 and tipo = 'cancelada') as ev
           from chamados c where c.id = $1`,
        [c.id, c.orc, c.visita],
      );
    });
    expect(r).toEqual({ status: "em_analise", canal: "manual", agendado: null, orc: "recebido", visita: "cancelada", ev: 1 });
  });

  it("concluir marca o compromisso da agenda como realizado; registro manual não existe no modo pessoal", async () => {
    const r = await comoUsuario(db, GESTOR, async () => {
      const visita = (await um<{ id: string }>(`insert into visitas (tipo, titulo, data_hora, imovel_id) values ('outro', 'Manutenção', '2026-11-02T13:00:00Z', $1) returning id`, [imovel])).id;
      const id = (
        await um<{ id: string }>(
          `insert into chamados (imovel_id, titulo, categoria, status, responsabilidade, pct_locatario, prestador_id, valor_aprovado, visita_id, pago_direto)
           values ($1, 'Troca de fechadura', 'chaveiro', 'agendado', 'locatario', 100, $2, 150, $3, true) returning id`,
          [imovel, prestador, visita],
        )
      ).id;
      await db.query(`select public.concluir_chamado($1, $2)`, [id, { concluido_em: "2026-11-02", valor_final: 150, aprovado_por: "Locatário", lancamentos: [] }]);
      return um<{ status: string; ev: number }>(
        `select status, (select count(*)::int from visita_eventos where visita_id = $1 and tipo = 'realizada') as ev from visitas where id = $1`,
        [visita],
      );
    });
    expect(r).toEqual({ status: "realizada", ev: 1 });

    const pessoal = await comoUsuario(db, PESSOAL, async () => {
      const im = (await um<{ id: string }>(`insert into imoveis (codigo) values ('CASA-2') returning id`)).id;
      const id = (await um<{ id: string }>(`insert into chamados (imovel_id, titulo, status, aprovacao_status) values ($1, 'Telhado', 'aguardando_aprovacao', 'pendente') returning id`, [im])).id;
      return erroDe(() => db.query(`select public.registrar_aprovacao_chamado($1, $2)`, [id, { aprovar: true, nome: "Eu" }]));
    });
    expect(pessoal).toContain("modo pessoal");
  });
});

describe("juntar cadastros repetidos", () => {
  it("leva prestador e solicitante dos chamados e dos orçamentos para o cadastro que fica", async () => {
    const r = await comoUsuario(db, GESTOR, async () => {
      const repetido = (await um<{ id: string }>(`insert into pessoas (nome, telefone, papeis) values ('Paulo Encanador (2)', '51999990009', '{prestador}') returning id`)).id;
      const c = (
        await um<{ id: string }>(
          `insert into chamados (imovel_id, contrato_id, titulo, urgencia, categoria, prestador_id, solicitante_pessoa_id) values ($1, $2, 'Torneira pingando', 'baixa', 'hidraulica', $3, $3) returning id`,
          [imovel, contrato, repetido],
        )
      ).id;
      await db.query(`insert into chamado_orcamentos (chamado_id, prestador_id, valor) values ($1, $2, 150)`, [c, repetido]);
      await db.query(`select public.juntar_pessoas($1, $2)`, [prestador, repetido]);
      const ch = await um<{ prestador_id: string; solicitante_pessoa_id: string }>(`select prestador_id, solicitante_pessoa_id from chamados where id = $1`, [c]);
      const orc = await um<{ prestador_id: string }>(`select prestador_id from chamado_orcamentos where chamado_id = $1`, [c]);
      const sumiu = await um<{ n: number }>(`select count(*)::int as n from pessoas where id = $1`, [repetido]);
      return { ch, orc, sumiu: sumiu.n };
    });
    expect(r.ch.prestador_id).toBe(prestador);
    expect(r.ch.solicitante_pessoa_id).toBe(prestador);
    expect(r.orc.prestador_id).toBe(prestador);
    expect(r.sumiu).toBe(0);
  });
});
