/**
 * Vistorias no banco: checklist por ambiente, isolamento por organização,
 * histórico só de acréscimo, laudo assinado pelo fluxo de documentos,
 * contestação pública por token e reparos levados ao acerto de saída.
 */
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { comoAnonimo, comoUsuario, criarBanco } from "./pglite";

const USER_A = "00000000-0000-0000-0000-000000013a01";
const USER_B = "00000000-0000-0000-0000-000000013b01";

let db: PGlite;
let orgA: string;
let imovel: string;
let contrato: string;
let locatario: string;

const um = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0];

beforeAll(async () => {
  db = await criarBanco();
  orgA = await comoUsuario(db, USER_A, async () => (await um<{ id: string }>(`select public.criar_organizacao('Imob Vistorias') as id`)).id);
  await comoUsuario(db, USER_B, () => db.query(`select public.criar_organizacao('Outra Imob')`));
  await comoUsuario(db, USER_A, async () => {
    locatario = (await um<{ id: string }>(`insert into pessoas (nome, documento, papeis) values ('Lia Locatária', '52998224725', '{locatario}') returning id`)).id;
    imovel = (await um<{ id: string }>(`insert into imoveis (codigo, cidade, quartos, banheiros) values ('VS-1', 'Porto Alegre', 2, 1) returning id`)).id;
    contrato = (
      await um<{ id: string }>(
        `insert into contratos (imovel_id, data_inicio, prazo_meses, data_fim, valor_aluguel, dia_vencimento, data_base_reajuste)
         values ($1, '2026-01-01', 30, '2028-06-30', 2000, 10, '2026-01-01') returning id`,
        [imovel],
      )
    ).id;
    await db.query(`insert into contrato_partes (contrato_id, pessoa_id, papel) values ($1, $2, 'locatario')`, [contrato, locatario]);
  });
});

async function novaVistoria(tipo = "entrada") {
  return comoUsuario(db, USER_A, async () => {
    const v = (await um<{ id: string; contestacao_token: string }>(`insert into vistorias (tipo, imovel_id, contrato_id, data) values ($1, $2, $3, '2026-11-03') returning id, contestacao_token`, [tipo, imovel, contrato]));
    const amb = (await um<{ id: string }>(`insert into vistoria_ambientes (vistoria_id, nome, tipo) values ($1, 'Sala', 'sala') returning id`, [v.id])).id;
    // vistoria_id e organização vêm do ambiente (gatilho)
    const item = (await um<{ id: string; vistoria_id: string }>(`insert into vistoria_itens (ambiente_id, nome) values ($1, 'Piso') returning id, vistoria_id`, [amb]));
    expect(item.vistoria_id).toBe(v.id);
    await db.query(`insert into vistoria_itens (ambiente_id, nome) values ($1, 'Paredes')`, [amb]);
    return { id: v.id, token: v.contestacao_token, amb, item: item.id };
  });
}

describe("vistorias — banco", () => {
  it("salva o checklist de uma vez e recusa estado inválido", async () => {
    const v = await novaVistoria();
    await comoUsuario(db, USER_A, async () => {
      const n = await um<{ n: number }>(`select public.salvar_itens_vistoria($1::jsonb) as n`, [JSON.stringify([{ id: v.item, estado: "bom", observacao: "  riscos leves " }])]);
      expect(n.n).toBe(1);
      // Sem mudança: não regrava
      const n2 = await um<{ n: number }>(`select public.salvar_itens_vistoria($1::jsonb) as n`, [JSON.stringify([{ id: v.item, estado: "bom", observacao: "riscos leves" }])]);
      expect(n2.n).toBe(0);
      const it = await um<{ estado: string; observacao: string }>(`select estado, observacao from vistoria_itens where id = $1`, [v.item]);
      expect(it).toEqual({ estado: "bom", observacao: "riscos leves" });
      await expect(db.query(`select public.salvar_itens_vistoria($1::jsonb)`, [JSON.stringify([{ id: v.item, estado: "otimo" }])])).rejects.toThrow();
    });
  });

  it("isola por organização (outra conta não vê nem pendura dados)", async () => {
    const v = await novaVistoria();
    const vistoB = await comoUsuario(db, USER_B, async () => ({
      vistorias: (await db.query(`select id from vistorias`)).rows.length,
      ambientes: (await db.query(`select id from vistoria_ambientes`)).rows.length,
      itens: (await db.query(`select id from vistoria_itens`)).rows.length,
      eventos: (await db.query(`select id from vistoria_eventos`)).rows.length,
    }));
    expect(vistoB).toEqual({ vistorias: 0, ambientes: 0, itens: 0, eventos: 0 });
    await expect(comoUsuario(db, USER_B, () => db.query(`insert into vistoria_itens (ambiente_id, nome) values ($1, 'Invasor')`, [v.amb]))).rejects.toThrow();
    await expect(comoUsuario(db, USER_B, () => db.query(`insert into vistorias (organizacao_id, imovel_id) values ($1, $2)`, [orgA, imovel]))).rejects.toThrow();
    const n = await comoUsuario(db, USER_B, async () => (await db.query(`select public.salvar_itens_vistoria($1::jsonb) as n`, [JSON.stringify([{ id: v.item, estado: "danificado" }])])).rows[0] as { n: number });
    expect(n.n).toBe(0);
  });

  it("histórico só acrescenta (não altera nem apaga)", async () => {
    const v = await novaVistoria();
    await comoUsuario(db, USER_A, async () => {
      const e = await um<{ id: string }>(`insert into vistoria_eventos (vistoria_id, tipo, descricao) values ($1, 'nota', 'original') returning id`, [v.id]);
      await db.query(`update vistoria_eventos set descricao = 'mudado' where id = $1`, [e.id]);
      await db.query(`delete from vistoria_eventos where id = $1`, [e.id]);
      const r = await um<{ descricao: string }>(`select descricao from vistoria_eventos where id = $1`, [e.id]);
      expect(r.descricao).toBe("original");
    });
  });

  it("marca a vistoria como assinada quando todos assinam o laudo", async () => {
    const v = await novaVistoria();
    const token = await comoUsuario(db, USER_A, async () => {
      const doc = await um<{ id: string }>(`insert into documentos (titulo, tipo, imovel_id, contrato_id, conteudo, status) values ('Laudo', 'vistoria', $1, $2, 'texto do laudo', 'aguardando_assinatura') returning id`, [imovel, contrato]);
      const s = await um<{ token: string }>(`insert into documento_signatarios (documento_id, nome, papel, pessoa_id) values ($1, 'Lia Locatária', 'locatario', $2) returning token`, [doc.id, locatario]);
      await db.query(`update vistorias set status = 'concluida', documento_id = $2 where id = $1`, [v.id, doc.id]);
      return s.token;
    });
    await comoAnonimo(db, () => db.query(`select public.assinar_documento($1, $2::jsonb)`, [token, JSON.stringify({ nome: "Lia Locatária", cpf: "529.982.247-25", aceite: true })]));
    const r = await comoUsuario(db, USER_A, () => um<{ status: string; assinada_em: string | null }>(`select status, assinada_em from vistorias where id = $1`, [v.id]));
    expect(r.status).toBe("assinada");
    expect(r.assinada_em).not.toBeNull();
    const ev = await comoUsuario(db, USER_A, () => db.query(`select 1 from vistoria_eventos where vistoria_id = $1 and tipo = 'assinada'`, [v.id]));
    expect(ev.rows.length).toBe(1);
  });

  it("reaberta depois de assinada: o laudo antigo fica como histórico e o novo assina de novo", async () => {
    const v = await novaVistoria();
    const assinar = async (titulo: string) => {
      const token = await comoUsuario(db, USER_A, async () => {
        const doc = await um<{ id: string }>(`insert into documentos (titulo, tipo, imovel_id, contrato_id, conteudo, status) values ($1, 'vistoria', $2, $3, 'texto', 'aguardando_assinatura') returning id`, [titulo, imovel, contrato]);
        const s = await um<{ token: string }>(`insert into documento_signatarios (documento_id, nome, papel, pessoa_id) values ($1, 'Lia Locatária', 'locatario', $2) returning token`, [doc.id, locatario]);
        await db.query(`update vistorias set status = 'concluida', documento_id = $2 where id = $1`, [v.id, doc.id]);
        return { doc: doc.id, token: s.token };
      });
      await comoAnonimo(db, () => db.query(`select public.assinar_documento($1, $2::jsonb)`, [token.token, JSON.stringify({ nome: "Lia Locatária", cpf: "529.982.247-25", aceite: true })]));
      return token.doc;
    };
    const doc1 = await assinar("Laudo 1");
    // Reabrir (como a tela faz): solta o laudo assinado e a data de assinatura.
    await comoUsuario(db, USER_A, () => db.query(`update vistorias set status = 'em_andamento', documento_id = null, assinada_em = null where id = $1`, [v.id]));
    const doc2 = await assinar("Laudo 2");
    const r = await comoUsuario(db, USER_A, () => um<{ status: string; assinada_em: string | null; documento_id: string }>(`select status, assinada_em, documento_id from vistorias where id = $1`, [v.id]));
    expect(r).toMatchObject({ status: "assinada", documento_id: doc2 });
    expect(r.assinada_em).not.toBeNull();
    // O laudo antigo continua assinado em Documentos (histórico).
    const d1 = await comoUsuario(db, USER_A, () => um<{ status: string }>(`select status from documentos where id = $1`, [doc1]));
    expect(d1.status).toBe("assinado");
    const ev = await comoUsuario(db, USER_A, () => db.query(`select 1 from vistoria_eventos where vistoria_id = $1 and tipo = 'assinada'`, [v.id]));
    expect(ev.rows.length).toBe(2);
  });

  it("contestação pública: só com token válido, dentro do prazo e com fotos da pasta certa", async () => {
    const v = await novaVistoria();
    // Em andamento: o link ainda não mostra nada
    const antes = await comoAnonimo(db, () => um<{ info: unknown }>(`select public.info_contestacao_vistoria($1) as info`, [v.token]));
    expect(antes.info).toBeNull();
    await comoUsuario(db, USER_A, () => db.query(`update vistorias set status = 'concluida', contestacao_ate = '2999-01-01' where id = $1`, [v.id]));

    const info = await comoAnonimo(db, () => um<{ info: { aberta: boolean; ambientes: { nome: string; itens: { id: string; nome: string }[] }[] } }>(`select public.info_contestacao_vistoria($1) as info`, [v.token]));
    expect(info.info.aberta).toBe(true);
    expect(info.info.ambientes[0].nome).toBe("Sala");
    expect(info.info.ambientes[0].itens.map((i) => i.nome).sort()).toEqual(["Paredes", "Piso"]);

    // Visitante não lê a tabela direto
    await expect(comoAnonimo(db, () => db.query(`select * from vistorias`))).rejects.toThrow();
    // Token errado
    await expect(comoAnonimo(db, () => db.query(`select public.contestar_vistoria(gen_random_uuid(), '{"nome":"Lia","texto":"não concordo com o piso"}'::jsonb)`))).rejects.toThrow(/inválido/);
    // Foto fora da pasta da contestação
    await expect(
      comoAnonimo(db, () =>
        db.query(`select public.contestar_vistoria($1, $2::jsonb)`, [v.token, JSON.stringify({ nome: "Lia Locatária", texto: "O piso já estava riscado.", fotos: [`${orgA}/outra/x.jpg`] })]),
      ),
    ).rejects.toThrow(/Foto inválida/);
    // Texto curto demais
    await expect(comoAnonimo(db, () => db.query(`select public.contestar_vistoria($1, $2::jsonb)`, [v.token, JSON.stringify({ nome: "Lia Locatária", texto: "não" })]))).rejects.toThrow();

    const foto = `${orgA}/contestacoes/${v.token}/1.jpg`;
    await comoAnonimo(db, () =>
      db.query(`select public.contestar_vistoria($1, $2::jsonb)`, [
        v.token,
        JSON.stringify({ nome: "Lia Locatária", texto: "O piso da sala já estava riscado quando entrei.", fotos: [foto], itens: [{ item_id: v.item, texto: "riscos antigos" }, { item_id: "lixo", texto: "x" }] }),
      ]),
    );
    const c = await comoUsuario(db, USER_A, () => um<{ status: string; nome: string; fotos: string[]; itens: { item: string }[]; vstatus: string }>(
      `select c.status, c.nome, c.fotos, c.itens, v.status as vstatus from vistoria_contestacoes c join vistorias v on v.id = c.vistoria_id where c.vistoria_id = $1`,
      [v.id],
    ));
    expect(c).toMatchObject({ status: "aberta", nome: "Lia Locatária", fotos: [foto], vstatus: "contestada" });
    expect(c.itens).toHaveLength(1);
    expect(c.itens[0].item).toBe("Sala · Piso");
    // Outra organização não vê a contestação
    const b = await comoUsuario(db, USER_B, () => db.query(`select 1 from vistoria_contestacoes`));
    expect(b.rows.length).toBe(0);

    // Pasta de fotos aberta só com organização + token certos
    const aberta = await comoAnonimo(db, () => um<{ a: boolean; b: boolean; c: boolean }>(
      `select public.vistoria_contestacao_aberta($1, $2) as a, public.vistoria_contestacao_aberta($1, gen_random_uuid()::text) as b, public.vistoria_contestacao_aberta('nao-e-uuid', $2) as c`,
      [orgA, v.token],
    ));
    expect(aberta).toEqual({ a: true, b: false, c: false });

    // Prazo vencido
    await comoUsuario(db, USER_A, () => db.query(`update vistorias set contestacao_ate = '2020-01-01' where id = $1`, [v.id]));
    await expect(comoAnonimo(db, () => db.query(`select public.contestar_vistoria($1, $2::jsonb)`, [v.token, JSON.stringify({ nome: "Lia Locatária", texto: "Mais uma reclamação aqui." })]))).rejects.toThrow(/prazo/);
    const fechada = await comoAnonimo(db, () => um<{ a: boolean }>(`select public.vistoria_contestacao_aberta($1, $2) as a`, [orgA, v.token]));
    expect(fechada.a).toBe(false);
  });

  it("leva os reparos do locatário para o acerto de saída", async () => {
    const entrada = await novaVistoria("entrada");
    await expect(comoUsuario(db, USER_A, () => db.query(`select public.aplicar_vistoria_no_acerto($1)`, [entrada.id]))).rejects.toThrow(/saída/);
    const saida = await novaVistoria("saida");
    // Sem desocupação ainda
    await expect(comoUsuario(db, USER_A, () => db.query(`select public.aplicar_vistoria_no_acerto($1)`, [saida.id]))).rejects.toThrow(/desocupação/);

    const total = await comoUsuario(db, USER_A, async () => {
      await db.query(`insert into contrato_desocupacoes (contrato_id, aviso_em) values ($1, '2026-10-01')`, [contrato]);
      const p1 = await um<{ id: string }>(`insert into vistoria_pendencias (vistoria_id, ambiente_id, descricao, responsavel, valor_estimado) values ($1, $2, 'Pintura', 'locatario', 200) returning id`, [saida.id, saida.amb]);
      const p2 = await um<{ id: string }>(`insert into vistoria_pendencias (vistoria_id, descricao, responsavel, valor_estimado) values ($1, 'Torneira', 'locatario', 80) returning id`, [saida.id]);
      await db.query(`insert into vistoria_orcamentos (pendencia_id, prestador_nome, valor, aprovado) values ($1, 'Hidráulica Já', 350, true), ($1, 'Outro', 500, false)`, [p2.id]);
      // Só um orçamento aprovado por pendência
      await expect(db.query(`insert into vistoria_orcamentos (pendencia_id, valor, aprovado) values ($1, 10, true)`, [p2.id])).rejects.toThrow();
      await db.query(`insert into vistoria_pendencias (vistoria_id, descricao, responsavel, valor_estimado) values ($1, 'Telhado', 'proprietario', 900)`, [saida.id]);
      await db.query(`insert into vistoria_pendencias (vistoria_id, descricao, responsavel, valor_estimado, status) values ($1, 'Cancelada', 'locatario', 999, 'cancelada')`, [saida.id]);
      expect(p1.id).toBeTruthy();
      return (await um<{ t: string }>(`select public.aplicar_vistoria_no_acerto($1) as t`, [saida.id])).t;
    });
    expect(Number(total)).toBe(550);
    const d = await comoUsuario(db, USER_A, () => um<{ reparos: string; vistoria_resultado: string; status: string; vistoria_obs: string }>(`select reparos, vistoria_resultado, status, vistoria_obs from contrato_desocupacoes where contrato_id = $1`, [contrato]));
    expect(Number(d.reparos)).toBe(550);
    expect(d.vistoria_resultado).toBe("com_reparos");
    expect(d.status).toBe("vistoria");
    expect(d.vistoria_obs).toContain("Pintura (Sala)");
    const v = await comoUsuario(db, USER_A, () => um<{ desocupacao_id: string | null }>(`select desocupacao_id from vistorias where id = $1`, [saida.id]));
    expect(v.desocupacao_id).not.toBeNull();
    // Outra organização não consegue aplicar
    await expect(comoUsuario(db, USER_B, () => db.query(`select public.aplicar_vistoria_no_acerto($1)`, [saida.id]))).rejects.toThrow(/não encontrada/);
  });
});
