/**
 * Análise cadastral e garantias no banco (PGlite): decisão com justificativa,
 * exceção só por admin/gestor (regra recalculada no banco), reabertura,
 * auditoria só leitura, LGPD nas consultas, conversão em contrato, renovação
 * de garantias, isolamento por organização e a ficha online pública (token).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { comoAnonimo, comoUsuario, criarBanco } from "./pglite";

const ADMIN = "00000000-0000-0000-0000-000000015a01";
const FINANCEIRO = "00000000-0000-0000-0000-000000015a02";
const CORRETOR = "00000000-0000-0000-0000-000000015a03";
const OUTRA = "00000000-0000-0000-0000-000000015a09";

// CPFs válidos (dígitos verificadores corretos)
const CPF_CANDIDATO = "52998224725";
const CPF_FIADOR = "11144477735";

let db: PGlite;
let org: string;

async function erroDe(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "";
  } catch (e) {
    return String(e);
  }
}

const um = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0];

/** Candidato com análise "redonda" (dentro da regra) ou faltando coisas. */
async function novaAnalise(opcoes: { completa: boolean; nome?: string; cpf?: string }) {
  return comoUsuario(db, ADMIN, async () => {
    const pessoa = (await um<{ id: string }>(`insert into pessoas (nome, tipo_pessoa, documento, papeis) values ($1, 'PF', $2, '{locatario}') returning id`, [
      opcoes.nome ?? "Carla Candidata",
      opcoes.cpf ?? CPF_CANDIDATO,
    ])).id;
    const imovel = (await um<{ id: string }>(`insert into imoveis (codigo, cidade, valor_aluguel) values ($1, 'Porto Alegre', 1500) returning id`, [`AN-${Math.random().toString(36).slice(2, 7)}`])).id;
    const a = await um<{ id: string; numero: number; token: string; status: string }>(
      `insert into analises (candidato_id, imovel_id, valor_aluguel, valor_encargos, renda_declarada) values ($1, $2, 1500, 300, 7000) returning id, numero, token, status`,
      [pessoa, imovel],
    );
    await db.query(`insert into analise_documentos (analise_id, rotulo, obrigatorio) values ($1, 'RG e CPF', true), ($1, 'Comprovante de renda', true)`, [a.id]);
    if (opcoes.completa) {
      await db.query(`insert into analise_rendas (analise_id, tipo, fonte, valor_declarado, valor_comprovado) values ($1, 'clt', 'Empresa X', 7000, 7000)`, [a.id]);
      await db.query(`update analise_documentos set status = 'validado' where analise_id = $1`, [a.id]);
      await db.query(`insert into analise_consultas (analise_id, bureau, score, restricoes, base_legal) values ($1, 'serasa', 820, false, 'protecao_credito')`, [a.id]);
      await db.query(`insert into analise_garantias (analise_id, tipo, garantidora, status, valor) values ($1, 'seguro_fianca', 'Seguradora Y', 'aprovada', 54000)`, [a.id]);
    }
    return { ...a, pessoa, imovel };
  });
}

beforeAll(async () => {
  db = await criarBanco();
  org = await comoUsuario(db, ADMIN, async () => (await um<{ id: string }>(`select public.criar_organizacao('Imob Análise') as id`)).id);
  await db.query(`insert into membros (organizacao_id, user_id, papel) values ($1, $2, 'financeiro'), ($1, $3, 'corretor')`, [org, FINANCEIRO, CORRETOR]);
  await comoUsuario(db, OUTRA, () => db.query(`select public.criar_organizacao('Outra Imob')`));
});

describe("regras e decisão", () => {
  it("calcula o que está fora da regra no banco", async () => {
    const a = await novaAnalise({ completa: false });
    const regras = await comoUsuario(db, ADMIN, async () => (await um<{ r: string[] }>(`select public.analise_checar_regras($1) as r`, [a.id])).r);
    expect(regras).toContain("Renda não comprovada");
    expect(regras).toContain("Sem consulta de crédito registrada");
    expect(regras).toContain("2 documento(s) obrigatório(s) sem validação");
    expect(regras).toContain("Nenhuma garantia aprovada");

    const ok = await novaAnalise({ completa: true, nome: "Bia Boa", cpf: "39053344705" });
    const vazias = await comoUsuario(db, ADMIN, async () => (await um<{ r: string[] }>(`select public.analise_checar_regras($1) as r`, [ok.id])).r);
    expect(vazias).toEqual([]);

    // 1.800 / 5.000 = 36% > 30%
    await comoUsuario(db, ADMIN, () => db.query(`update analise_rendas set valor_comprovado = 5000 where analise_id = $1`, [ok.id]));
    const alto = await comoUsuario(db, ADMIN, async () => (await um<{ r: string[] }>(`select public.analise_checar_regras($1) as r`, [ok.id])).r);
    expect(alto).toEqual(["Comprometimento de 36,0% da renda (limite 30%)"]);
  });

  it("decisão exige justificativa, papel certo e exceção só por admin/gestor", async () => {
    const a = await novaAnalise({ completa: false, nome: "Davi Fora", cpf: "16899535009" });
    // Sem justificativa
    expect(await comoUsuario(db, ADMIN, () => erroDe(() => db.query(`update analises set decisao = 'reprovado' where id = $1`, [a.id])))).toContain("justificativa da decisão");
    // Corretor não decide
    expect(
      await comoUsuario(db, CORRETOR, () => erroDe(() => db.query(`update analises set decisao = 'reprovado', decisao_justificativa = 'Renda insuficiente para o aluguel' where id = $1`, [a.id]))),
    ).toContain("não pode decidir");
    // Financeiro não aprova fora da regra
    const fin = await comoUsuario(db, FINANCEIRO, () =>
      erroDe(() => db.query(`update analises set decisao = 'aprovado', decisao_justificativa = 'Cliente antigo da casa', excecao_justificativa = 'Conhecemos bem' where id = $1`, [a.id])),
    );
    expect(fin).toContain("Só administrador ou gestor aprova como exceção");
    // Admin sem justificar a exceção
    expect(
      await comoUsuario(db, ADMIN, () => erroDe(() => db.query(`update analises set decisao = 'aprovado', decisao_justificativa = 'Cliente antigo da casa' where id = $1`, [a.id]))),
    ).toContain("justificativa da exceção");
    // Admin com justificativa: aprova como exceção
    await comoUsuario(db, ADMIN, () =>
      db.query(`update analises set decisao = 'aprovado', decisao_justificativa = 'Cliente antigo da casa', excecao_justificativa = 'Pagou 5 anos sem atraso em outro imóvel' where id = $1`, [a.id]),
    );
    const r = await um<{ status: string; excecao: boolean; fora_da_regra: string[]; decidido_por: string; validade_ate: string | null }>(
      `select status, excecao, fora_da_regra, decidido_por, validade_ate from analises where id = $1`,
      [a.id],
    );
    expect(r.status).toBe("aprovada");
    expect(r.excecao).toBe(true);
    expect(r.fora_da_regra).toContain("Renda não comprovada");
    expect(r.decidido_por).toBe(ADMIN);
    expect(r.validade_ate).not.toBeNull();

    const d = await um<{ decisao: string; excecao: boolean; papel: string; usuario_id: string }>(`select decisao, excecao, papel, usuario_id from analise_decisoes where analise_id = $1`, [a.id]);
    expect(d).toEqual({ decisao: "aprovado", excecao: true, papel: "admin", usuario_id: ADMIN });
    const tipos = (await db.query<{ tipo: string }>(`select tipo from analise_eventos where analise_id = $1`, [a.id])).rows.map((e) => e.tipo);
    expect(tipos).toContain("criada");
    expect(tipos).toContain("excecao");

    // Decidida: valores travados; mudar a decisão exige reabrir
    expect(await comoUsuario(db, ADMIN, () => erroDe(() => db.query(`update analises set valor_aluguel = 900 where id = $1`, [a.id])))).toContain("já foi decidida");
    expect(
      await comoUsuario(db, ADMIN, () => erroDe(() => db.query(`update analises set decisao = 'reprovado', decisao_justificativa = 'Mudei de ideia sobre isso' where id = $1`, [a.id]))),
    ).toContain("Reabra a análise");
    // Reabrir: financeiro não pode; admin precisa de motivo
    expect(await comoUsuario(db, FINANCEIRO, () => erroDe(() => db.query(`update analises set decisao = null, reaberta_motivo = 'Rever renda' where id = $1`, [a.id])))).toContain(
      "reabrem",
    );
    expect(await comoUsuario(db, ADMIN, () => erroDe(() => db.query(`update analises set decisao = null where id = $1`, [a.id])))).toContain("motivo");
    await comoUsuario(db, ADMIN, () => db.query(`update analises set decisao = null, reaberta_motivo = 'Rever a renda com holerites' where id = $1`, [a.id]));
    const reaberta = await um<{ status: string; excecao: boolean; decidido_em: string | null }>(`select status, excecao, decidido_em from analises where id = $1`, [a.id]);
    expect(reaberta).toEqual({ status: "em_analise", excecao: false, decidido_em: null });
    // O histórico da decisão continua lá
    expect((await db.query(`select 1 from analise_decisoes where analise_id = $1`, [a.id])).rows).toHaveLength(1);
  });

  it("financeiro aprova dentro da regra; não dá para 'decidir por fora' sem decisão", async () => {
    const a = await novaAnalise({ completa: true, nome: "Eva Certa", cpf: "71428793860" });
    await comoUsuario(db, FINANCEIRO, () => db.query(`update analises set excecao = true, decidido_em = now(), observacoes = 'x' where id = $1`, [a.id]));
    const antes = await um<{ excecao: boolean; decidido_em: string | null }>(`select excecao, decidido_em from analises where id = $1`, [a.id]);
    expect(antes).toEqual({ excecao: false, decidido_em: null });
    await comoUsuario(db, FINANCEIRO, () =>
      db.query(`update analises set decisao = 'aprovado_condicoes', decisao_justificativa = 'Renda e crédito dentro da regra', decisao_condicoes = 'Seguro incêndio pago à vista' where id = $1`, [a.id]),
    );
    const r = await um<{ status: string; excecao: boolean; fora_da_regra: string[] }>(`select status, excecao, fora_da_regra from analises where id = $1`, [a.id]);
    expect(r).toEqual({ status: "aprovada_condicoes", excecao: false, fora_da_regra: [] });
  });

  it("só admin/gestor mudam as regras; regra configurável muda a decisão", async () => {
    expect(await comoUsuario(db, FINANCEIRO, () => erroDe(() => db.query(`insert into analise_config (limite_comprometimento_pct, alerta_comprometimento_pct) values (40, 35)`)))).toContain(
      "Só administradores e gestores",
    );
    await comoUsuario(db, ADMIN, () => db.query(`insert into analise_config (limite_comprometimento_pct, alerta_comprometimento_pct, score_minimo) values (40, 35, 700)`));
    const a = await novaAnalise({ completa: true, nome: "Fábio Score", cpf: "86288366757" });
    await comoUsuario(db, ADMIN, async () => {
      await db.query(`update analise_rendas set valor_comprovado = 5000 where analise_id = $1`, [a.id]); // 36% < 40%
      await db.query(`insert into analise_consultas (analise_id, bureau, score, restricoes, base_legal, consultado_em) values ($1, 'spc', 650, true, 'protecao_credito', current_date)`, [a.id]);
    });
    const regras = await comoUsuario(db, ADMIN, async () => (await um<{ r: string[] }>(`select public.analise_checar_regras($1) as r`, [a.id])).r);
    expect(regras).toEqual(["Score 650 abaixo do mínimo 700", "Restrições de crédito no nome do candidato"]);
    const ev = await um<{ n: number }>(`select count(*)::int as n from analise_eventos where tipo = 'regras' and organizacao_id = $1`, [org]);
    expect(ev.n).toBe(1);

    // A tela salva com "upsert" (insert ... on conflict do update): sem mudança, nenhum evento a mais; com mudança, um só.
    const upsert = (limite: number) =>
      comoUsuario(db, ADMIN, () =>
        db.query(
          `insert into analise_config (organizacao_id, limite_comprometimento_pct, alerta_comprometimento_pct, score_minimo) values ($1, $2, 35, 700)
           on conflict (organizacao_id) do update set limite_comprometimento_pct = excluded.limite_comprometimento_pct,
             alerta_comprometimento_pct = excluded.alerta_comprometimento_pct, score_minimo = excluded.score_minimo`,
          [org, limite],
        ),
      );
    const eventos = async () => (await um<{ n: number }>(`select count(*)::int as n from analise_eventos where tipo = 'regras' and organizacao_id = $1`, [org])).n;
    await upsert(40);
    await upsert(40);
    expect(await eventos()).toBe(1);
    await upsert(41);
    expect(await eventos()).toBe(2);
    await upsert(40);
    expect(await eventos()).toBe(3);
  });

  it("aprovar ou reprovar fiador só por quem decide (corretor não muda pela API)", async () => {
    const a = await novaAnalise({ completa: false, nome: "Olga Fiança", cpf: "35379838839" });
    const r = await comoUsuario(db, CORRETOR, async () => {
      const p = (await um<{ id: string }>(`insert into pessoas (nome) values ('Fiador do Corretor') returning id`)).id;
      const p2 = (await um<{ id: string }>(`insert into pessoas (nome) values ('Fiador Já Aprovado') returning id`)).id;
      const f = (await um<{ id: string }>(`insert into analise_fiadores (analise_id, pessoa_id) values ($1, $2) returning id`, [a.id, p])).id;
      const mudar = await erroDe(() => db.query(`update analise_fiadores set status = 'aprovado' where id = $1`, [f]));
      const nascer = await erroDe(() => db.query(`insert into analise_fiadores (analise_id, pessoa_id, status) values ($1, $2, 'aprovado')`, [a.id, p2]));
      // Outros campos o corretor pode editar
      await db.query(`update analise_fiadores set imovel_matricula = '9.876' where id = $1`, [f]);
      return { f, mudar, nascer };
    });
    expect(r.mudar).toContain("Só administrador, gestor ou financeiro");
    expect(r.nascer).toContain("Só administrador, gestor ou financeiro");
    await comoUsuario(db, FINANCEIRO, () => db.query(`update analise_fiadores set status = 'aprovado' where id = $1`, [r.f]));
    const f = await um<{ status: string; analisado_por: string; imovel_matricula: string }>(`select status, analisado_por, imovel_matricula from analise_fiadores where id = $1`, [r.f]);
    expect(f).toEqual({ status: "aprovado", analisado_por: FINANCEIRO, imovel_matricula: "9.876" });
  });

  it("depois da decisão o imóvel fica travado (só sai se o imóvel for excluído)", async () => {
    const a = await novaAnalise({ completa: true, nome: "Paulo Imóvel", cpf: "62648716050" });
    const r = await comoUsuario(db, ADMIN, async () => {
      const outro = (await um<{ id: string }>(`insert into imoveis (codigo, cidade) values ('AN-OUTRO', 'Gravataí') returning id`)).id;
      await db.query(`update analises set decisao = 'aprovado', decisao_justificativa = 'Tudo certo com a documentação' where id = $1`, [a.id]);
      const trocar = await erroDe(() => db.query(`update analises set imovel_id = $2 where id = $1`, [a.id, outro]));
      const tirar = await erroDe(() => db.query(`update analises set imovel_id = null where id = $1`, [a.id]));
      await db.query(`delete from imoveis where id = $1`, [a.imovel]);
      const depois = await um<{ imovel_id: string | null; decisao: string }>(`select imovel_id, decisao from analises where id = $1`, [a.id]);
      return { trocar, tirar, depois };
    });
    expect(r.trocar).toContain("já foi decidida");
    expect(r.tirar).toContain("já foi decidida");
    expect(r.depois).toEqual({ imovel_id: null, decisao: "aprovado" });
  });
});

describe("LGPD, auditoria e exclusão", () => {
  it("consulta por consentimento exige a autorização registrada; consulta não se altera", async () => {
    const a = await novaAnalise({ completa: false, nome: "Gil Lgpd", cpf: "24843803480" });
    await comoUsuario(db, ADMIN, async () => {
      expect(await erroDe(() => db.query(`insert into analise_consultas (analise_id, bureau, base_legal) values ($1, 'serasa', 'consentimento')`, [a.id]))).toContain("Registre a autorização");
      await db.query(`update analises set consentimento_em = now(), consentimento_origem = 'assinatura' where id = $1`, [a.id]);
      const c = await um<{ id: string; consentimento_em: string | null; consultado_por: string }>(
        `insert into analise_consultas (analise_id, bureau, base_legal, score, consultado_por) values ($1, 'serasa', 'consentimento', 700, $2) returning id, consentimento_em, consultado_por`,
        [a.id, FINANCEIRO],
      );
      expect(c.consentimento_em).not.toBeNull();
      expect(c.consultado_por).toBe(ADMIN); // não dá para registrar em nome de outro
      expect(await erroDe(() => db.query(`update analise_consultas set score = 999 where id = $1`, [c.id]))).toContain("não se altera");
    });
  });

  it("auditoria é só leitura e sobrevive à exclusão; decidida só admin/gestor exclui", async () => {
    const a = await novaAnalise({ completa: true, nome: "Hugo Audit", cpf: "52513127765" });
    await comoUsuario(db, FINANCEIRO, async () => {
      await db.query(`update analises set decisao = 'reprovado', decisao_justificativa = 'Desistiu da documentação' where id = $1`, [a.id]);
      // Eventos e decisões: sem alterar nem apagar
      await db.query(`update analise_eventos set descricao = 'adulterado' where analise_id = $1`, [a.id]);
      await db.query(`delete from analise_eventos where analise_id = $1`, [a.id]);
      await db.query(`delete from analise_decisoes where analise_id = $1`, [a.id]);
      // Anotação manual só como "nota"
      await db.query(`insert into analise_eventos (analise_id, tipo, descricao) values ($1, 'nota', 'Ligou pedindo prazo')`, [a.id]);
      expect(await erroDe(() => db.query(`insert into analise_eventos (analise_id, tipo, descricao) values ($1, 'decisao', 'Aprovado (falso)')`, [a.id]))).toContain("row-level security");
      expect(await erroDe(() => db.query(`delete from analises where id = $1`, [a.id]))).toContain("Só administradores e gestores excluem");
    });
    expect((await db.query(`select 1 from analise_eventos where descricao = 'adulterado'`)).rows).toHaveLength(0);
    expect((await db.query(`select 1 from analise_decisoes where analise_id = $1`, [a.id])).rows).toHaveLength(1);
    await comoUsuario(db, ADMIN, () => db.query(`delete from analises where id = $1`, [a.id]));
    const tipos = (await db.query<{ tipo: string }>(`select tipo from analise_eventos where analise_id = $1`, [a.id])).rows.map((e) => e.tipo);
    expect(tipos).toContain("excluida");
    expect(tipos).toContain("nota");
    expect((await db.query(`select 1 from analise_decisoes where analise_id = $1`, [a.id])).rows).toHaveLength(1);
  });

  it("excluir renda e documento do checklist fica na auditoria", async () => {
    const a = await novaAnalise({ completa: true, nome: "Rita Rastro", cpf: "84434891030" });
    await comoUsuario(db, FINANCEIRO, async () => {
      await db.query(`delete from analise_rendas where analise_id = $1`, [a.id]);
      await db.query(`delete from analise_documentos where analise_id = $1 and rotulo = 'RG e CPF'`, [a.id]);
    });
    const ev = (await db.query<{ tipo: string; descricao: string; usuario_id: string }>(`select tipo, descricao, usuario_id from analise_eventos where analise_id = $1 order by data`, [a.id])).rows;
    expect(ev.find((e) => e.descricao.startsWith("Renda excluída"))).toMatchObject({ tipo: "renda", usuario_id: FINANCEIRO });
    expect(ev.find((e) => e.descricao.startsWith("Renda excluída"))?.descricao).toContain("comprovada R$ 7000,00");
    expect(ev.find((e) => e.descricao.startsWith("Documento tirado do checklist"))).toMatchObject({ tipo: "documento", usuario_id: FINANCEIRO });
    // Fiador excluído: os itens dele saem junto, sem um evento por item
    const r = await comoUsuario(db, ADMIN, async () => {
      const p = (await um<{ id: string }>(`insert into pessoas (nome) values ('Fiador Que Sai') returning id`)).id;
      const f = (await um<{ id: string }>(`insert into analise_fiadores (analise_id, pessoa_id) values ($1, $2) returning id`, [a.id, p])).id;
      await db.query(`insert into analise_documentos (analise_id, fiador_id, parte, rotulo) values ($1, $2, 'fiador', 'RG do fiador'), ($1, $2, 'fiador', 'Matrícula')`, [a.id, f]);
      await db.query(`insert into analise_rendas (analise_id, fiador_id, valor_declarado) values ($1, $2, 3000)`, [a.id, f]);
      const antes = (await um<{ n: number }>(`select count(*)::int as n from analise_eventos where analise_id = $1`, [a.id])).n;
      await db.query(`delete from analise_fiadores where id = $1`, [f]);
      const depois = (await um<{ n: number }>(`select count(*)::int as n from analise_eventos where analise_id = $1`, [a.id])).n;
      return { antes, depois };
    });
    expect(r.depois - r.antes).toBe(1); // só "Fiador removido"
  });

  it("documento recusado exige motivo e registra quem validou", async () => {
    const a = await novaAnalise({ completa: false, nome: "Ivo Doc", cpf: "87748248800" });
    await comoUsuario(db, FINANCEIRO, async () => {
      const d = await um<{ id: string }>(`select id from analise_documentos where analise_id = $1 limit 1`, [a.id]);
      expect(await erroDe(() => db.query(`update analise_documentos set status = 'recusado' where id = $1`, [d.id]))).toContain("motivo da recusa");
      await db.query(`update analise_documentos set status = 'validado', validado_por = $2 where id = $1`, [d.id, ADMIN]);
      const v = await um<{ validado_por: string; validado_em: string | null }>(`select validado_por, validado_em from analise_documentos where id = $1`, [d.id]);
      expect(v.validado_por).toBe(FINANCEIRO);
      expect(v.validado_em).not.toBeNull();
    });
  });
});

describe("juntar cadastros repetidos", () => {
  it("public.juntar_pessoas leva candidato e fiador para o cadastro que fica, mesmo com a análise decidida", async () => {
    const a = await novaAnalise({ completa: true, nome: "Nina Repetida", cpf: "07068093868" });
    const r = await comoUsuario(db, ADMIN, async () => {
      const copia = (await um<{ id: string }>(`insert into pessoas (nome, papeis) values ('Nina R.', '{locatario}') returning id`)).id;
      const f = (await um<{ id: string }>(`insert into pessoas (nome) values ('Fiador Repetido') returning id`)).id;
      const fFica = (await um<{ id: string }>(`insert into pessoas (nome, papeis) values ('Fiador Repetido (certo)', '{fiador}') returning id`)).id;
      await db.query(`insert into analise_fiadores (analise_id, pessoa_id) values ($1, $2)`, [a.id, f]);
      await db.query(`update analises set decisao = 'aprovado', decisao_justificativa = 'Tudo certo com a documentação' where id = $1`, [a.id]);
      // Sem o "juntar", trocar o candidato de uma análise decidida é recusado
      const travado = await erroDe(() => db.query(`update analises set candidato_id = $2 where id = $1`, [a.id, copia]));
      // O que sai é o candidato (antes dava erro de chave estrangeira em analises_candidato_id_fkey)
      await db.query(`select public.juntar_pessoas($1, $2)`, [copia, a.pessoa]);
      await db.query(`select public.juntar_pessoas($1, $2)`, [fFica, f]);
      const depois = await um<{ candidato_id: string; decisao: string }>(`select candidato_id, decisao from analises where id = $1`, [a.id]);
      const fiador = await um<{ pessoa_id: string }>(`select pessoa_id from analise_fiadores where analise_id = $1`, [a.id]);
      const sumiram = (await db.query(`select 1 from pessoas where id in ($1, $2)`, [a.pessoa, f])).rows.length;
      const travadoDeNovo = await erroDe(() => db.query(`update analises set candidato_id = $2 where id = $1`, [a.id, fFica]));
      const ev = (await db.query<{ descricao: string }>(`select descricao from analise_eventos where analise_id = $1 and tipo = 'candidato'`, [a.id])).rows;
      return { travado, depois, fiador, copia, fFica, sumiram, travadoDeNovo, ev };
    });
    expect(r.travado).toContain("já foi decidida");
    expect(r.depois).toEqual({ candidato_id: r.copia, decisao: "aprovado" });
    expect(r.fiador.pessoa_id).toBe(r.fFica);
    expect(r.sumiram).toBe(0);
    expect(r.travadoDeNovo).toContain("já foi decidida");
    expect(r.ev.map((e) => e.descricao)).toContain("Cadastro do candidato juntado com um cadastro repetido");
  });

  it("fiador repetido na mesma análise vira um só", async () => {
    const a = await novaAnalise({ completa: false, nome: "Otto Dobrado", cpf: "44985525049" });
    const n = await comoUsuario(db, ADMIN, async () => {
      const f1 = (await um<{ id: string }>(`insert into pessoas (nome) values ('Fiador A') returning id`)).id;
      const f2 = (await um<{ id: string }>(`insert into pessoas (nome) values ('Fiador A (repetido)') returning id`)).id;
      await db.query(`insert into analise_fiadores (analise_id, pessoa_id) values ($1, $2), ($1, $3)`, [a.id, f1, f2]);
      await db.query(`select public.juntar_pessoas($1, $2)`, [f1, f2]);
      return (await um<{ n: number }>(`select count(*)::int as n from analise_fiadores where analise_id = $1`, [a.id])).n;
    });
    expect(n).toBe(1);
  });
});

describe("isolamento por organização", () => {
  it("outra organização não vê nem mexe", async () => {
    const a = await novaAnalise({ completa: true, nome: "Júlia Isolada", cpf: "93541134780" });
    await comoUsuario(db, OUTRA, async () => {
      for (const t of ["analises", "analise_documentos", "analise_rendas", "analise_consultas", "analise_garantias", "analise_eventos", "analise_decisoes", "analise_config"])
        expect((await db.query(`select 1 from ${t}`)).rows, t).toHaveLength(0);
      expect(await erroDe(() => db.query(`select public.analise_checar_regras($1)`, [a.id]))).toContain("não encontrada");
      // Não consegue pendurar nada na análise de outra organização
      expect(await erroDe(() => db.query(`insert into analise_documentos (analise_id, rotulo) values ($1, 'Intruso')`, [a.id]))).toContain("row-level security");
      const upd = await db.query(`update analises set observacoes = 'x' where id = $1 returning id`, [a.id]);
      expect(upd.rows).toHaveLength(0);
    });
  });
});

describe("contrato e garantias", () => {
  it("leva as garantias aprovadas e o fiador para o contrato", async () => {
    const a = await novaAnalise({ completa: true, nome: "Kátia Contrato", cpf: "45317828791" });
    const r = await comoUsuario(db, ADMIN, async () => {
      const fiadorPessoa = (await um<{ id: string }>(`insert into pessoas (nome, tipo_pessoa, documento, papeis) values ('Fernando Fiador', 'PF', $1, '{fiador}') returning id`, [CPF_FIADOR])).id;
      const f = (await um<{ id: string }>(`insert into analise_fiadores (analise_id, pessoa_id, imovel_matricula) values ($1, $2, '12.345') returning id`, [a.id, fiadorPessoa])).id;
      await db.query(`insert into analise_rendas (analise_id, fiador_id, tipo, valor_declarado, valor_comprovado) values ($1, $2, 'aposentadoria', 6000, 6000)`, [a.id, f]);
      await db.query(`update analise_fiadores set status = 'aprovado', parecer = 'Imóvel quitado' where id = $1`, [f]);
      const contrato = (await um<{ id: string }>(
        `insert into contratos (imovel_id, data_inicio, prazo_meses, data_fim, valor_aluguel, dia_vencimento, data_base_reajuste) values ($1, '2026-12-01', 30, '2029-05-31', 1500, 10, '2026-12-01') returning id`,
        [a.imovel],
      )).id;
      const antes = await erroDe(() => db.query(`select public.levar_garantias_contrato($1, $2)`, [a.id, contrato]));
      await db.query(`update analises set decisao = 'aprovado', decisao_justificativa = 'Tudo certo com a documentação' where id = $1`, [a.id]);
      const n = (await um<{ n: number }>(`select public.levar_garantias_contrato($1, $2) as n`, [a.id, contrato])).n;
      const de_novo = (await um<{ n: number }>(`select public.levar_garantias_contrato($1, $2) as n`, [a.id, contrato])).n;
      const gs = (await db.query<{ tipo: string; pessoa_id: string | null }>(`select tipo, pessoa_id from contrato_garantias where contrato_id = $1 order by tipo`, [contrato])).rows;
      const partes = (await db.query<{ papel: string }>(`select papel from contrato_partes where contrato_id = $1`, [contrato])).rows;
      const an = await um<{ status: string; contrato_id: string }>(`select status, contrato_id from analises where id = $1`, [a.id]);
      const reabrir = await erroDe(() => db.query(`update analises set decisao = null, reaberta_motivo = 'Rever tudo de novo' where id = $1`, [a.id]));
      return { antes, n, de_novo, gs, partes, an, contrato, fiadorPessoa, reabrir };
    });
    expect(r.antes).toContain("Só um candidato aprovado");
    expect(r.n).toBe(2);
    expect(r.de_novo).toBe(0);
    expect(r.gs).toEqual([
      { tipo: "fiador", pessoa_id: r.fiadorPessoa },
      { tipo: "seguro_fianca", pessoa_id: null },
    ]);
    expect(r.partes.map((p) => p.papel)).toEqual(["fiador"]);
    expect(r.an).toEqual({ status: "contratada", contrato_id: r.contrato });
    expect(r.reabrir).toContain("já virou contrato");
  });

  it("solicita e conclui a renovação da garantia e do seguro incêndio", async () => {
    const r = await comoUsuario(db, FINANCEIRO, async () => {
      const imovel = (await um<{ id: string }>(`insert into imoveis (codigo, cidade) values ('REN-1', 'Canoas') returning id`)).id;
      const contrato = (await um<{ id: string }>(
        `insert into contratos (imovel_id, data_inicio, prazo_meses, data_fim, valor_aluguel, dia_vencimento, data_base_reajuste, seguro_incendio_vencimento) values ($1, '2026-01-01', 30, '2028-06-30', 2000, 10, '2026-01-01', '2026-12-20') returning id`,
        [imovel],
      )).id;
      const g = (await um<{ id: string }>(`insert into contrato_garantias (contrato_id, tipo, instituicao, numero, fim) values ($1, 'seguro_fianca', 'Seguradora Z', 'AP-1', '2026-12-01') returning id`, [contrato])).id;
      const sol = (await um<{ id: string; fim_anterior: string; contrato_id: string }>(
        `insert into garantia_renovacoes (contrato_garantia_id, contrato_id, canal, destinatario) values ($1, $2, 'email', 'seguradora') returning id, fim_anterior::text, contrato_id`,
        [g, contrato],
      ));
      const cedo = await erroDe(() => db.query(`select public.concluir_renovacao_garantia($1, $2)`, [sol.id, JSON.stringify({ nova_fim: "2026-11-01" })]));
      await db.query(`select public.concluir_renovacao_garantia($1, $2)`, [sol.id, JSON.stringify({ nova_fim: "2027-12-01", numero: "AP-2", valor: "60.000,00" })]);
      const dup = await erroDe(() => db.query(`select public.concluir_renovacao_garantia($1, $2)`, [sol.id, JSON.stringify({ nova_fim: "2028-12-01" })]));
      const gar = await um<{ fim: string; numero: string; valor: string; status: string }>(`select fim::text, numero, valor, status from contrato_garantias where id = $1`, [g]);
      const s = await um<{ status: string; concluida_em: string | null }>(`select status, concluida_em from garantia_renovacoes where id = $1`, [sol.id]);

      const inc = (await um<{ id: string; fim_anterior: string }>(
        `insert into garantia_renovacoes (objeto, contrato_id, canal, destinatario) values ('seguro_incendio', $1, 'whatsapp', 'locatario') returning id, fim_anterior::text`,
        [contrato],
      ));
      await db.query(`select public.concluir_renovacao_garantia($1, $2)`, [inc.id, JSON.stringify({ nova_fim: "2027-12-20", numero: "INC-9" })]);
      const c = await um<{ v: string; a: string }>(`select seguro_incendio_vencimento::text as v, seguro_incendio_apolice as a from contratos where id = $1`, [contrato]);
      const ev = (await db.query<{ tipo: string }>(`select tipo from analise_eventos where contrato_id = $1 order by data`, [contrato])).rows.map((e) => e.tipo);
      return { sol, cedo, dup, gar, s, inc, c, ev };
    });
    expect(r.sol.fim_anterior).toBe("2026-12-01");
    expect(r.cedo).toContain("precisa ser depois");
    expect(r.dup).toContain("já foi concluída");
    expect(r.gar).toEqual({ fim: "2027-12-01", numero: "AP-2", valor: "60000.00", status: "ativa" });
    expect(r.s.status).toBe("renovada");
    expect(r.s.concluida_em).not.toBeNull();
    expect(r.inc.fim_anterior).toBe("2026-12-20");
    expect(r.c).toEqual({ v: "2027-12-20", a: "INC-9" });
    expect(r.ev).toContain("renovacao_solicitada");
    expect(r.ev).toContain("renovacao_renovada");
  });

  it("renovação sem pedido antes: cria e conclui junto (falhou = nada gravado); exclusão fica na auditoria", async () => {
    const r = await comoUsuario(db, FINANCEIRO, async () => {
      const imovel = (await um<{ id: string }>(`insert into imoveis (codigo, cidade) values ('REN-2', 'Canoas') returning id`)).id;
      const contrato = (await um<{ id: string }>(
        `insert into contratos (imovel_id, data_inicio, prazo_meses, data_fim, valor_aluguel, dia_vencimento, data_base_reajuste) values ($1, '2026-01-01', 30, '2028-06-30', 2000, 10, '2026-01-01') returning id`,
        [imovel],
      )).id;
      const g = (await um<{ id: string }>(`insert into contrato_garantias (contrato_id, tipo, instituicao, numero, fim) values ($1, 'titulo_capitalizacao', 'Banco T', 'TC-1', '2026-12-01') returning id`, [contrato])).id;
      const eventos = async () => (await um<{ n: number }>(`select count(*)::int as n from analise_eventos where contrato_id = $1`, [contrato])).n;
      const falha = await erroDe(() =>
        db.query(`select public.registrar_renovacao_garantia($1)`, [JSON.stringify({ objeto: "garantia", contrato_id: contrato, contrato_garantia_id: g, nova_fim: "2026-06-01" })]),
      );
      const depoisDaFalha = { linhas: (await db.query(`select 1 from garantia_renovacoes where contrato_id = $1`, [contrato])).rows.length, eventos: await eventos() };
      const id = (await um<{ id: string }>(`select public.registrar_renovacao_garantia($1) as id`, [
        JSON.stringify({ objeto: "garantia", contrato_id: contrato, contrato_garantia_id: g, nova_fim: "2027-12-01", valor: "15.000" }),
      ])).id;
      const ren = await um<{ status: string; nova_fim: string; novo_valor: string }>(`select status, nova_fim::text, novo_valor from garantia_renovacoes where id = $1`, [id]);
      const gar = await um<{ fim: string; valor: string }>(`select fim::text, valor from contrato_garantias where id = $1`, [g]);
      await db.query(`delete from garantia_renovacoes where id = $1`, [id]);
      const ev = (await db.query<{ tipo: string; usuario_id: string }>(`select tipo, usuario_id from analise_eventos where contrato_id = $1 order by data`, [contrato])).rows;
      return { falha, depoisDaFalha, ren, gar, ev };
    });
    expect(r.falha).toContain("precisa ser depois");
    expect(r.depoisDaFalha).toEqual({ linhas: 0, eventos: 0 });
    expect(r.ren).toEqual({ status: "renovada", nova_fim: "2027-12-01", novo_valor: "15000.00" });
    expect(r.gar).toEqual({ fim: "2027-12-01", valor: "15000.00" });
    expect(r.ev.map((e) => e.tipo)).toEqual(["renovacao_solicitada", "renovacao_renovada", "renovacao_excluida"]);
    expect(r.ev[2].usuario_id).toBe(FINANCEIRO);
  });
});

describe("números digitados", () => {
  it("ponto com 3 dígitos é milhar (3.500 = três mil e quinhentos)", async () => {
    const casos: [string, string | null][] = [
      ["3.500", "3500.00"],
      ["1.234.567", "1234567.00"],
      ["3.500,75", "3500.75"],
      ["R$ 2.000,00", "2000.00"],
      ["3500", "3500.00"],
      ["3.50", "3.50"],
      ["1234.5", "1234.50"],
      ["abc", null],
      ["", null],
    ];
    for (const [entrada, esperado] of casos) {
      const v = await um<{ v: string | null }>(`select privado.analise_num($1)::text as v`, [entrada]);
      expect(v.v, entrada).toBe(esperado);
    }
  });
});

describe("ficha online (pública, por token)", () => {
  it("só abre com link ativo, recebe dados, renda, autorização e arquivos", async () => {
    const a = await novaAnalise({ completa: false, nome: "Lia Ficha", cpf: "28625587887" });
    // Link inativo ou inválido: nada
    expect((await comoAnonimo(db, () => um<{ i: unknown }>(`select public.ficha_info($1) as i`, [a.token]))).i).toBeNull();
    expect((await comoAnonimo(db, () => um<{ i: unknown }>(`select public.ficha_info($1) as i`, ["00000000-0000-0000-0000-000000000000"]))).i).toBeNull();
    // Visitante não lê tabelas
    expect(await comoAnonimo(db, () => erroDe(() => db.query(`select * from analises`)))).toContain("permission denied");

    await comoUsuario(db, ADMIN, () => db.query(`update analises set ficha_ativa = true, ficha_expira_em = current_date + 15 where id = $1`, [a.id]));
    const info = (await comoAnonimo(db, () => um<{ i: { nome: string; documentos: { id: string; rotulo: string }[]; texto_consentimento: string } }>(`select public.ficha_info($1) as i`, [a.token]))).i;
    expect(info.nome).toBe("Lia Ficha");
    expect(info.documentos).toHaveLength(2);
    expect(info.texto_consentimento).toContain("Lei Geral de Proteção de Dados");

    // Sem autorização não envia
    expect(await comoAnonimo(db, () => erroDe(() => db.query(`select public.ficha_enviar($1, $2)`, [a.token, JSON.stringify({ telefone: "51999990000" })])))).toContain(
      "autorização",
    );
    const dados = {
      telefone: "51999990000",
      email: "lia@exemplo.com",
      moradores: "3",
      rendas: [
        { tipo: "clt", fonte: "Loja A", valor: "4.500,00" },
        { tipo: "invalido", fonte: "Bicos", valor: "1.000" },
        { tipo: "clt", fonte: "lixo", valor: "abc" },
      ],
      consentimento: true,
      ip: "200.1.2.3",
    };
    await comoAnonimo(db, () => db.query(`select public.ficha_enviar($1, $2)`, [a.token, JSON.stringify(dados)]));
    // Reenviar não duplica as rendas ainda não comprovadas
    await comoAnonimo(db, () => db.query(`select public.ficha_enviar($1, $2)`, [a.token, JSON.stringify(dados)]));
    const an = await um<{ renda_declarada: string; moradores: number; consentimento_origem: string; consentimento_ip: string; ficha_enviada_em: string | null }>(
      `select renda_declarada, moradores, consentimento_origem, consentimento_ip, ficha_enviada_em from analises where id = $1`,
      [a.id],
    );
    expect(an).toMatchObject({ renda_declarada: "5500.00", moradores: 3, consentimento_origem: "ficha online", consentimento_ip: "200.1.2.3" });
    const rendas = (await db.query<{ tipo: string; valor_declarado: string }>(`select tipo, valor_declarado from analise_rendas where analise_id = $1 order by valor_declarado`, [a.id])).rows;
    expect(rendas).toEqual([
      { tipo: "outro", valor_declarado: "1000.00" },
      { tipo: "clt", valor_declarado: "4500.00" },
    ]);
    const p = await um<{ telefone: string; email: string }>(`select telefone, email from pessoas where id = $1`, [a.pessoa]);
    expect(p).toEqual({ telefone: "51999990000", email: "lia@exemplo.com" });

    // Arquivo: só na pasta do próprio token
    const doc = info.documentos[0].id;
    expect(
      await comoAnonimo(db, () => erroDe(() => db.query(`select public.ficha_registrar_arquivo($1, $2)`, [a.token, JSON.stringify({ path: `${org}/x/rg.pdf`, nome: "rg.pdf" })]))),
    ).toContain("Arquivo inválido");
    await comoAnonimo(db, () => db.query(`select public.ficha_registrar_arquivo($1, $2)`, [a.token, JSON.stringify({ path: `ficha/${a.token}/1-rg.pdf`, nome: "rg.pdf", documento_id: doc })]));
    const d = await um<{ status: string }>(`select status from analise_documentos where id = $1`, [doc]);
    expect(d.status).toBe("recebido");
    expect((await comoAnonimo(db, () => um<{ ok: boolean }>(`select public.analise_ficha_aceita_upload($1) as ok`, [a.token]))).ok).toBe(true);
    expect((await comoAnonimo(db, () => um<{ ok: boolean }>(`select public.analise_ficha_aceita_upload($1) as ok`, ["nao-e-token"]))).ok).toBe(false);

    // Storage: a equipe lê os arquivos da ficha mesmo depois de trocar o link; outra organização não
    const arquivo = `ficha/${a.token}/1-rg.pdf`;
    const daOrg = (u: string, path: string) => comoUsuario(db, u, async () => (await um<{ ok: boolean }>(`select privado.analise_arquivo_da_org($1) as ok`, [path])).ok);
    expect(await daOrg(ADMIN, arquivo)).toBe(true);
    expect(await daOrg(OUTRA, arquivo)).toBe(false);
    await comoUsuario(db, ADMIN, () => db.query(`update analises set token = gen_random_uuid() where id = $1`, [a.id]));
    expect(await daOrg(ADMIN, arquivo)).toBe(true);
    expect(await daOrg(ADMIN, `ficha/${a.token}/nao-registrado.pdf`)).toBe(false);
    expect((await comoAnonimo(db, () => um<{ ok: boolean }>(`select public.analise_ficha_aceita_upload($1) as ok`, [a.token]))).ok).toBe(false);
    const novo = (await um<{ token: string }>(`select token from analises where id = $1`, [a.id])).token;
    expect((await comoAnonimo(db, () => um<{ i: unknown }>(`select public.ficha_info($1) as i`, [a.token]))).i).toBeNull();
    expect((await comoAnonimo(db, () => um<{ i: unknown }>(`select public.ficha_info($1) as i`, [novo]))).i).not.toBeNull();

    // Depois da decisão, o link fecha sozinho
    await comoUsuario(db, ADMIN, () => db.query(`update analises set decisao = 'reprovado', decisao_justificativa = 'Renda não comprovada a tempo' where id = $1`, [a.id]));
    expect((await comoAnonimo(db, () => um<{ i: unknown }>(`select public.ficha_info($1) as i`, [novo]))).i).toBeNull();
    expect(await comoAnonimo(db, () => erroDe(() => db.query(`select public.ficha_enviar($1, $2)`, [novo, JSON.stringify(dados)])))).toContain("expirado");
    // Visitante não chama as RPCs da equipe
    expect(await comoAnonimo(db, () => erroDe(() => db.query(`select public.analise_checar_regras($1)`, [a.id])))).toContain("permission denied");
  });
});

describe("migração", () => {
  it("pode rodar de novo sem erro (idempotente, sem DROP)", async () => {
    const sql = readFileSync(join(__dirname, "..", "supabase", "migrations", "20261106000005_analise_cadastral.sql"), "utf8");
    expect(sql).not.toMatch(/\bdrop\s+(table|trigger|policy|function|constraint|index|column)/i);
    await db.exec(sql);
    const def = (await um<{ d: string }>(`select pg_get_functiondef('public.juntar_pessoas(uuid, uuid)'::regprocedure) as d`)).d;
    expect(def.match(/privado\.analise_juntar_pessoas/g)).toHaveLength(1);
    expect(def.indexOf("privado.analise_juntar_pessoas")).toBeLessThan(def.indexOf("delete from public.pessoas where id = b.id"));
  });
});

describe("organização", () => {
  it("apagar a organização inteira funciona com análises, fiadores e auditoria", async () => {
    const U = "00000000-0000-0000-0000-000000015a0f";
    const o = await comoUsuario(db, U, async () => {
      const id = (await um<{ id: string }>(`select public.criar_organizacao('Imob Some') as id`)).id;
      const p = (await um<{ id: string }>(`insert into pessoas (nome, documento) values ('X', $1) returning id`, [CPF_CANDIDATO])).id;
      const f = (await um<{ id: string }>(`insert into pessoas (nome) values ('Y') returning id`)).id;
      const a = (await um<{ id: string }>(`insert into analises (candidato_id, valor_aluguel) values ($1, 1000) returning id`, [p])).id;
      await db.query(`insert into analise_fiadores (analise_id, pessoa_id) values ($1, $2)`, [a, f]);
      await db.query(`insert into analise_rendas (analise_id, valor_declarado, valor_comprovado) values ($1, 5000, 5000)`, [a]);
      await db.query(`insert into analise_garantias (analise_id, tipo, status) values ($1, 'caucao', 'aprovada')`, [a]);
      await db.query(`update analises set decisao = 'reprovado', decisao_justificativa = 'Teste de exclusão total' where id = $1`, [a]);
      return id;
    });
    await db.query(`delete from organizacoes where id = $1`, [o]);
    expect((await db.query(`select 1 from analises where organizacao_id = $1`, [o])).rows).toHaveLength(0);
    expect((await db.query(`select 1 from analise_eventos where organizacao_id = $1`, [o])).rows).toHaveLength(0);
  });
});
