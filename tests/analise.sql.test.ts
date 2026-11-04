/**
 * Análise cadastral e garantias no banco (PGlite): decisão com justificativa,
 * exceção só por admin/gestor (regra recalculada no banco), reabertura,
 * auditoria só leitura, LGPD nas consultas, conversão em contrato, renovação
 * de garantias, isolamento por organização e a ficha online pública (token).
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
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
      await db.query(`insert into analise_consultas (analise_id, bureau, score, restricoes, base_legal, consultado_em) values ($1, 'spc', 650, true, 'protecao_credito', privado.analise_hoje())`, [a.id]); // hoje em Brasília
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
      // O candidato é o locatário do contrato (a RPC confere).
      await db.query(`insert into contrato_partes (contrato_id, pessoa_id, papel) values ($1, $2, 'locatario')`, [contrato, a.pessoa]);
      const antes = await erroDe(() => db.query(`select public.levar_garantias_contrato($1, $2)`, [a.id, contrato]));
      await db.query(`update analises set decisao = 'aprovado', decisao_justificativa = 'Tudo certo com a documentação' where id = $1`, [a.id]);
      const n = (await um<{ n: number }>(`select public.levar_garantias_contrato($1, $2) as n`, [a.id, contrato])).n;
      const de_novo = (await um<{ n: number }>(`select public.levar_garantias_contrato($1, $2) as n`, [a.id, contrato])).n;
      const gs = (await db.query<{ tipo: string; pessoa_id: string | null }>(`select tipo, pessoa_id from contrato_garantias where contrato_id = $1 order by tipo`, [contrato])).rows;
      const partes = (await db.query<{ papel: string }>(`select papel from contrato_partes where contrato_id = $1 order by papel`, [contrato])).rows;
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
    expect(r.partes.map((p) => p.papel)).toEqual(["fiador", "locatario"]);
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

describe("correções da revisão (migração 20261107000003)", () => {
  /** Contrato no imóvel; com `locatario`, a pessoa entra como locatária. */
  async function novoContrato(imovel: string, locatario: string | null, status = "ativo") {
    return comoUsuario(db, ADMIN, async () => {
      const id = (
        await um<{ id: string }>(
          `insert into contratos (imovel_id, data_inicio, prazo_meses, data_fim, valor_aluguel, dia_vencimento, data_base_reajuste, status) values ($1, '2026-12-01', 30, '2029-05-31', 1500, 10, '2026-12-01', $2) returning id`,
          [imovel, status],
        )
      ).id;
      if (locatario) await db.query(`insert into contrato_partes (contrato_id, pessoa_id, papel) values ($1, $2, 'locatario')`, [id, locatario]);
      return id;
    });
  }
  const aprovar = (id: string) =>
    comoUsuario(db, ADMIN, () => db.query(`update analises set decisao = 'aprovado', decisao_justificativa = 'Tudo certo com a documentação' where id = $1`, [id]));
  const levar = (u: string, analise: string, contrato: string) =>
    comoUsuario(db, u, async () => (await um<{ n: number }>(`select public.levar_garantias_contrato($1, $2) as n`, [analise, contrato])).n);
  /** Grava sem gatilhos (simula dado "torto" vindo de antes da correção). */
  async function semGatilho(sql: string, params: unknown[] = []) {
    await db.exec(`set session_replication_role = replica;`);
    try {
      return await db.query(sql, params);
    } finally {
      await db.exec(`set session_replication_role = origin;`);
    }
  }

  it("fiança 'aprovada' não dribla a aprovação do fiador (gatilho, regra e contrato)", async () => {
    const a = await novaAnalise({ completa: true, nome: "Quel Fiança", cpf: "12345678143" });
    const r = await comoUsuario(db, CORRETOR, async () => {
      await db.query(`delete from analise_garantias where analise_id = $1`, [a.id]);
      const p = (await um<{ id: string }>(`insert into pessoas (nome) values ('João Fiador Pendente') returning id`)).id;
      const f = (await um<{ id: string }>(`insert into analise_fiadores (analise_id, pessoa_id) values ($1, $2) returning id`, [a.id, p])).id;
      const nascer = await erroDe(() => db.query(`insert into analise_garantias (analise_id, tipo, fiador_id, status) values ($1, 'fiador', $2, 'aprovada')`, [a.id, f]));
      const g = (await um<{ id: string }>(`insert into analise_garantias (analise_id, tipo, fiador_id, status) values ($1, 'fiador', $2, 'proposta') returning id`, [a.id, f])).id;
      const mudar = await erroDe(() => db.query(`update analise_garantias set status = 'aprovada' where id = $1`, [g]));
      const contratada = await erroDe(() => db.query(`update analise_garantias set status = 'contratada' where id = $1`, [g]));
      return { p, g, nascer, mudar, contratada };
    });
    expect(r.nascer).toContain("fiador aprovado");
    expect(r.mudar).toContain("fiador aprovado");
    expect(r.contratada).toContain("marcada sozinha");

    // Mesmo gravada à força, a fiança com fiador pendente não conta para a regra…
    await semGatilho(`update analise_garantias set status = 'aprovada' where id = $1`, [r.g]);
    const regras = await comoUsuario(db, ADMIN, async () => (await um<{ r: string[] }>(`select public.analise_checar_regras($1) as r`, [a.id])).r);
    expect(regras).toContain("Nenhuma garantia aprovada");
    // …e não vai ao contrato (nem o fiador pendente vira parte).
    await comoUsuario(db, ADMIN, () =>
      db.query(`update analises set decisao = 'aprovado', decisao_justificativa = 'Cliente antigo da casa', excecao_justificativa = 'Pagou 5 anos sem atraso' where id = $1`, [a.id]),
    );
    const c = await novoContrato(a.imovel, a.pessoa);
    expect(await levar(ADMIN, a.id, c)).toBe(0);
    const fiadores = (await db.query(`select 1 from contrato_partes where contrato_id = $1 and papel = 'fiador'`, [c])).rows;
    const garantias = (await db.query(`select 1 from contrato_garantias where contrato_id = $1`, [c])).rows;
    expect({ fiadores: fiadores.length, garantias: garantias.length }).toEqual({ fiadores: 0, garantias: 0 });
  });

  it("trocar a pessoa de um fiador (aprovado ou não) é recusado: exclua e inclua", async () => {
    const a = await novaAnalise({ completa: false, nome: "Rafa Troca", cpf: "23456789254" });
    const { f, outro } = await comoUsuario(db, ADMIN, async () => {
      const p1 = (await um<{ id: string }>(`insert into pessoas (nome) values ('Fiador Analisado') returning id`)).id;
      const outro = (await um<{ id: string }>(`insert into pessoas (nome) values ('Fiador Nunca Analisado') returning id`)).id;
      const f = (await um<{ id: string }>(`insert into analise_fiadores (analise_id, pessoa_id) values ($1, $2) returning id`, [a.id, p1])).id;
      await db.query(`update analise_fiadores set status = 'aprovado' where id = $1`, [f]);
      return { f, outro };
    });
    for (const u of [CORRETOR, ADMIN]) {
      const erro = await comoUsuario(db, u, () => erroDe(() => db.query(`update analise_fiadores set pessoa_id = $2 where id = $1`, [f, outro])));
      expect(erro, u).toContain("exclua este e inclua o novo");
    }
    // O candidato também não pode ser fiador dele mesmo (no banco).
    expect(
      await comoUsuario(db, ADMIN, () => erroDe(() => db.query(`insert into analise_fiadores (analise_id, pessoa_id) values ($1, $2)`, [a.id, a.pessoa]))),
    ).toContain("fiador dele mesmo");
  });

  it("vincular confere locatário, imóvel, situação do contrato, prazo e desistência; contrato só pela RPC", async () => {
    const a = await novaAnalise({ completa: true, nome: "Sara Vínculo", cpf: "34567891309" });
    await aprovar(a.id);
    const inquilinoAtual = await comoUsuario(db, ADMIN, async () => (await um<{ id: string }>(`insert into pessoas (nome) values ('Inquilino Atual') returning id`)).id);
    const outroImovel = await comoUsuario(db, ADMIN, async () => (await um<{ id: string }>(`insert into imoveis (codigo, cidade) values ('AN-VINC-2', 'Canoas') returning id`)).id);
    const doInquilinoAtual = await novoContrato(a.imovel, inquilinoAtual, "ativo");
    const deOutroImovel = await novoContrato(outroImovel, a.pessoa, "ativo");
    const encerrado = await novoContrato(a.imovel, a.pessoa, "encerrado");
    const certo = await novoContrato(a.imovel, a.pessoa, "rascunho");

    const tentar = (c: string) => comoUsuario(db, ADMIN, () => erroDe(() => db.query(`select public.levar_garantias_contrato($1, $2)`, [a.id, c])));
    expect(await tentar(doInquilinoAtual)).toContain("não é locatário deste contrato");
    expect(await tentar(deOutroImovel)).toContain("outro imóvel");
    expect(await tentar(encerrado)).toContain("ativo ou em rascunho");
    // Direto pela API (sem a RPC): recusado.
    expect(await comoUsuario(db, CORRETOR, () => erroDe(() => db.query(`update analises set contrato_id = $2 where id = $1`, [a.id, certo])))).toContain("Vincular contrato");

    // Desistência: precisa retomar antes.
    await comoUsuario(db, CORRETOR, () => db.query(`update analises set status = 'desistencia', desistencia_motivo = 'Achou outro imóvel' where id = $1`, [a.id]));
    expect(await tentar(certo)).toContain("desistiu");
    await comoUsuario(db, CORRETOR, () => db.query(`update analises set status = 'em_analise' where id = $1`, [a.id]));

    // Aprovação vencida (validade de ontem): reabrir e decidir de novo.
    await semGatilho(`update analises set validade_ate = privado.analise_hoje() - 1 where id = $1`, [a.id]);
    expect(await tentar(certo)).toContain("venceu");
    await semGatilho(`update analises set validade_ate = privado.analise_hoje() + 30 where id = $1`, [a.id]);

    expect(await levar(ADMIN, a.id, certo)).toBe(1);
    const an = await um<{ status: string; contrato_id: string }>(`select status, contrato_id from analises where id = $1`, [a.id]);
    expect(an).toEqual({ status: "contratada", contrato_id: certo });
  });

  it("desvincular: só admin/gestor (também pela API); garantias voltam e vão para o contrato certo", async () => {
    const a = await novaAnalise({ completa: true, nome: "Tina Desvínculo", cpf: "45678912445" });
    await aprovar(a.id);
    const errado = await novoContrato(a.imovel, a.pessoa, "rascunho");
    expect(await levar(ADMIN, a.id, errado)).toBe(1);

    expect(await comoUsuario(db, FINANCEIRO, () => erroDe(() => db.query(`update analises set contrato_id = null where id = $1`, [a.id])))).toContain(
      "Só administradores e gestores desvinculam",
    );
    expect(await comoUsuario(db, FINANCEIRO, () => erroDe(() => db.query(`select public.desvincular_contrato_analise($1)`, [a.id])))).toContain(
      "Só administradores e gestores desvinculam",
    );
    expect(await comoUsuario(db, OUTRA, () => erroDe(() => db.query(`select public.desvincular_contrato_analise($1)`, [a.id])))).toContain("não encontrada");

    const n = await comoUsuario(db, ADMIN, async () => (await um<{ n: number }>(`select public.desvincular_contrato_analise($1) as n`, [a.id])).n);
    expect(n).toBe(1);
    const gs = (await db.query<{ status: string; contrato_garantia_id: string | null }>(`select status, contrato_garantia_id from analise_garantias where analise_id = $1`, [a.id])).rows;
    expect(gs).toEqual([{ status: "aprovada", contrato_garantia_id: null }]);
    const antigo = await um<{ status: string; observacoes: string }>(`select status, observacoes from contrato_garantias where contrato_id = $1`, [errado]);
    expect(antigo.status).toBe("encerrada");
    expect(antigo.observacoes).toContain("desvinculada deste contrato");
    expect(await um<{ status: string; contrato_id: string | null }>(`select status, contrato_id from analises where id = $1`, [a.id])).toEqual({ status: "aprovada", contrato_id: null });

    // O contrato certo recebe o seguro-fiança aprovado.
    const certo = await novoContrato(a.imovel, a.pessoa, "rascunho");
    expect(await levar(ADMIN, a.id, certo)).toBe(1);
    const novo = await um<{ tipo: string; status: string }>(`select tipo, status from contrato_garantias where contrato_id = $1`, [certo]);
    expect(novo).toEqual({ tipo: "seguro_fianca", status: "ativa" });

    // Excluir o contrato continua soltando a análise sozinho (on delete set null), para quem pode excluir.
    await comoUsuario(db, FINANCEIRO, () => db.query(`delete from contratos where id = $1`, [certo]));
    expect((await um<{ contrato_id: string | null }>(`select contrato_id from analises where id = $1`, [a.id])).contrato_id).toBeNull();
  });

  it("juntar repetidos: o fiador aprovado que sai leva rendas, documentos, consultas e garantias", async () => {
    const a = await novaAnalise({ completa: false, nome: "Ulisses Junta", cpf: "56789123563" });
    const r = await comoUsuario(db, ADMIN, async () => {
      const sai = (await um<{ id: string }>(`insert into pessoas (nome) values ('Rui Fiador (cad. 1)') returning id`)).id;
      const fica = (await um<{ id: string }>(`insert into pessoas (nome) values ('Rui Fiador (cad. 2)') returning id`)).id;
      const f1 = (await um<{ id: string }>(`insert into analise_fiadores (analise_id, pessoa_id, imovel_matricula) values ($1, $2, '55.555') returning id`, [a.id, sai])).id;
      const f2 = (await um<{ id: string }>(`insert into analise_fiadores (analise_id, pessoa_id) values ($1, $2) returning id`, [a.id, fica])).id;
      await db.query(`insert into analise_rendas (analise_id, fiador_id, tipo, valor_declarado, valor_comprovado) values ($1, $2, 'aposentadoria', 9000, 9000)`, [a.id, f1]);
      await db.query(
        `insert into analise_documentos (analise_id, fiador_id, parte, item, rotulo, status) values
           ($1, $2, 'fiador', 'rg_cpf', 'RG do Rui', 'validado'), ($1, $2, 'fiador', 'matricula', 'Matrícula', 'validado'), ($1, $3, 'fiador', 'rg_cpf', 'RG do Rui', 'pendente')`,
        [a.id, f1, f2],
      );
      await db.query(`insert into analise_consultas (analise_id, fiador_id, bureau, score, base_legal) values ($1, $2, 'serasa', 780, 'protecao_credito')`, [a.id, f1]);
      await db.query(`insert into analise_garantias (analise_id, tipo, fiador_id) values ($1, 'fiador', $2)`, [a.id, f1]);
      await db.query(`update analise_fiadores set status = 'aprovado', parecer = 'Imóvel quitado' where id = $1`, [f1]);
      // Fica o cadastro 2 (pendente); sai o 1 (aprovado).
      await db.query(`select public.juntar_pessoas($1, $2)`, [fica, sai]);
      const fs = (await db.query<{ id: string; pessoa_id: string; status: string; analisado_por: string; parecer: string; imovel_matricula: string }>(
        `select id, pessoa_id, status, analisado_por, parecer, imovel_matricula from analise_fiadores where analise_id = $1`,
        [a.id],
      )).rows;
      const so = fs[0]?.id;
      const conta = async (t: string) => (await um<{ n: number }>(`select count(*)::int as n from ${t} where analise_id = $1 and fiador_id = $2`, [a.id, so])).n;
      const docs = (await db.query<{ item: string; status: string }>(`select item, status from analise_documentos where fiador_id = $1 order by item`, [so])).rows;
      return { fs, fica, rendas: await conta("analise_rendas"), consultas: await conta("analise_consultas"), garantias: await conta("analise_garantias"), docs };
    });
    expect(r.fs).toHaveLength(1);
    expect(r.fs[0]).toMatchObject({ pessoa_id: r.fica, status: "aprovado", analisado_por: ADMIN, parecer: "Imóvel quitado", imovel_matricula: "55.555" });
    expect({ rendas: r.rendas, consultas: r.consultas, garantias: r.garantias }).toEqual({ rendas: 1, consultas: 1, garantias: 1 });
    expect(r.docs).toEqual([
      { item: "matricula", status: "validado" },
      { item: "rg_cpf", status: "validado" },
    ]);
  });

  it("autorização (LGPD): data, origem, IP e texto sempre juntos; IP e texto só pela ficha; IP da conexão à parte", async () => {
    const a = await novaAnalise({ completa: false, nome: "Vera Prova", cpf: "67891234663" });
    await comoUsuario(db, ADMIN, () => db.query(`update analises set ficha_ativa = true, ficha_expira_em = privado.analise_hoje() + 15 where id = $1`, [a.id]));
    const enviar = (ip: string, cabecalhos: string) =>
      comoAnonimo(db, async () => {
        await db.query(`select set_config('request.headers', $1, false)`, [cabecalhos]);
        try {
          await db.query(`select public.ficha_enviar($1, $2)`, [a.token, JSON.stringify({ consentimento: true, ip })]);
        } finally {
          await db.query(`select set_config('request.headers', '', false)`);
        }
      });
    const prova = () =>
      um<{ consentimento_em: string | null; consentimento_origem: string | null; consentimento_ip: string | null; consentimento_ip_rede: string | null; consentimento_texto: string | null }>(
        `select consentimento_em, consentimento_origem, consentimento_ip, consentimento_ip_rede, consentimento_texto from analises where id = $1`,
        [a.id],
      );

    await enviar("200.0.0.1", JSON.stringify({ "x-forwarded-for": "9.9.9.9" }));
    expect(await prova()).toMatchObject({ consentimento_origem: "ficha online", consentimento_ip: "200.0.0.1", consentimento_ip_rede: "9.9.9.9" });
    expect((await prova()).consentimento_texto).toContain("Lei Geral de Proteção de Dados");
    const ev = await um<{ dados: { ip_informado: string; ip_rede: string } }>(`select dados from analise_eventos where analise_id = $1 and tipo = 'ficha_enviada'`, [a.id]);
    expect(ev.dados).toMatchObject({ ip_informado: "200.0.0.1", ip_rede: "9.9.9.9" });

    // Ninguém mexe no IP pela API.
    await comoUsuario(db, ADMIN, () => db.query(`update analises set consentimento_ip = '1.1.1.1', consentimento_texto = 'adulterado' where id = $1`, [a.id]));
    expect(await prova()).toMatchObject({ consentimento_ip: "200.0.0.1" });
    // Retirada: some tudo junto.
    await comoUsuario(db, ADMIN, () => db.query(`update analises set consentimento_em = null where id = $1`, [a.id]));
    expect(await prova()).toEqual({ consentimento_em: null, consentimento_origem: null, consentimento_ip: null, consentimento_ip_rede: null, consentimento_texto: null });

    // Nova autorização pela ficha, com o texto da organização já mudado: tudo desta submissão.
    await comoUsuario(db, ADMIN, () =>
      db.query(
        `insert into analise_config (organizacao_id, texto_consentimento) values ($1, 'Texto v2 da autorização')
         on conflict (organizacao_id) do update set texto_consentimento = excluded.texto_consentimento`,
        [org],
      ),
    );
    await enviar("200.0.0.2", "");
    expect(await prova()).toMatchObject({ consentimento_ip: "200.0.0.2", consentimento_ip_rede: null, consentimento_texto: "Texto v2 da autorização" });
    await comoUsuario(db, ADMIN, () => db.query(`update analise_config set texto_consentimento = null where organizacao_id = $1`, [org]));

    // Registro manual (assinatura): sem IP nem texto da ficha.
    await comoUsuario(db, ADMIN, () =>
      db.query(`update analises set consentimento_em = now() - interval '1 day', consentimento_origem = 'assinatura', consentimento_ip = '5.5.5.5' where id = $1`, [a.id]),
    );
    expect(await prova()).toMatchObject({ consentimento_origem: "assinatura", consentimento_ip: null, consentimento_ip_rede: null, consentimento_texto: null });
  });

  it("datas do dia no horário de Brasília", async () => {
    const a = await novaAnalise({ completa: true, nome: "Wagner Data", cpf: "78912345745" });
    await aprovar(a.id);
    const v = await um<{ ok: boolean }>(`select validade_ate = privado.analise_hoje() + (select coalesce(max(validade_dias), 30) from analise_config where organizacao_id = $2) as ok from analises where id = $1`, [a.id, org]);
    expect(v.ok).toBe(true);
    expect((await um<{ ok: boolean }>(`select privado.analise_hoje() = (now() at time zone 'America/Sao_Paulo')::date as ok`)).ok).toBe(true);
    for (const f of [
      "privado.analise_ficha(uuid)",
      "privado.analises_regras()",
      "privado.analise_garantias_trg()",
      "privado.analise_consultas_trg()",
      "privado.garantia_renovacoes_trg()",
      "public.concluir_renovacao_garantia(uuid, jsonb)",
    ]) {
      const d = (await um<{ d: string }>(`select pg_get_functiondef($1::regprocedure) as d`, [f])).d;
      expect(d, f).not.toMatch(/current_date/i);
    }
    const padroes = (await db.query<{ d: string }>(
      `select column_default as d from information_schema.columns where table_schema = 'public' and ((table_name = 'analise_consultas' and column_name = 'consultado_em') or (table_name = 'garantia_renovacoes' and column_name = 'solicitada_em'))`,
    )).rows;
    expect(padroes).toHaveLength(2);
    for (const p of padroes) expect(p.d).toContain("America/Sao_Paulo");
  });

  it("anotação da auditoria: data e autor do banco; só na análise da própria organização", async () => {
    const a = await novaAnalise({ completa: false, nome: "Xavier Nota", cpf: "89123456809" });
    await comoUsuario(db, FINANCEIRO, () =>
      db.query(`insert into analise_eventos (analise_id, tipo, descricao, data, usuario_id, dados) values ($1, 'nota', 'Candidato avisado', '2026-01-10', $2, '{"x":1}')`, [a.id, ADMIN]),
    );
    const n = await um<{ antiga: boolean; usuario_id: string; dados: unknown }>(
      `select data < now() - interval '1 hour' as antiga, usuario_id, dados from analise_eventos where analise_id = $1 and tipo = 'nota'`,
      [a.id],
    );
    expect(n).toEqual({ antiga: false, usuario_id: FINANCEIRO, dados: null });
    expect(
      await comoUsuario(db, OUTRA, () => erroDe(() => db.query(`insert into analise_eventos (analise_id, tipo, descricao) values ($1, 'nota', 'Intruso')`, [a.id]))),
    ).toContain("Análise não encontrada");
  });

  it("token da ficha é do banco; caminho do arquivo conferido; token antigo não vale para outra organização", async () => {
    const a = await novaAnalise({ completa: false, nome: "Yara Token", cpf: "91234567954" });
    const escolhido = "11111111-2222-3333-4444-555555555555";
    await comoUsuario(db, ADMIN, () => db.query(`update analises set token = $2 where id = $1`, [a.id, escolhido]));
    const atual = (await um<{ token: string }>(`select token from analises where id = $1`, [a.id])).token;
    expect(atual).not.toBe(escolhido);
    expect(atual).not.toBe(a.token);

    // Caminhos fora da pasta desta análise são recusados; o caminho não muda depois.
    const outraAnalise = (await novaAnalise({ completa: false, nome: "Zé Outra", cpf: "13579246828" })).id;
    const registrar = (path: string) =>
      comoUsuario(db, ADMIN, () => erroDe(() => db.query(`insert into analise_arquivos (analise_id, path, nome) values ($1, $2, 'x.pdf')`, [a.id, path])));
    expect(await registrar(`${org}/${outraAnalise}/rg.pdf`)).toContain("Arquivo inválido");
    expect(await registrar(`ficha/${a.token}/rg.pdf`)).toContain("Arquivo inválido"); // token antigo
    expect(await registrar(`${org}/${a.id}/../${outraAnalise}/rg.pdf`)).toContain("Arquivo inválido");
    expect(await registrar(`${org}/${a.id}/`)).toContain("Arquivo inválido");
    expect(await registrar(`${org}/${a.id}/rg.pdf`)).toBe("");
    expect(await registrar(`ficha/${atual}/holerite.pdf`)).toBe("");
    await comoUsuario(db, ADMIN, () => db.query(`update analise_arquivos set path = $2 where analise_id = $1`, [a.id, `ficha/${a.token}/qualquer.pdf`]));
    const paths = (await db.query<{ path: string; enviado_pela_ficha: boolean }>(`select path, enviado_pela_ficha from analise_arquivos where analise_id = $1 order by path`, [a.id])).rows;
    expect(paths).toEqual([
      { path: `${org}/${a.id}/rg.pdf`, enviado_pela_ficha: false },
      { path: `ficha/${atual}/holerite.pdf`, enviado_pela_ficha: true },
    ]);

    // Outra organização tenta "pegar" o token antigo (cujos arquivos ficaram em ficha/<antigo>/): não consegue.
    const r = await comoUsuario(db, OUTRA, async () => {
      const p = (await um<{ id: string }>(`insert into pessoas (nome) values ('Laranja') returning id`)).id;
      const nova = await um<{ id: string; token: string }>(`insert into analises (candidato_id, token) values ($1, $2) returning id, token`, [p, a.token]);
      await db.query(`update analises set token = $2 where id = $1`, [nova.id, a.token]);
      const depois = (await um<{ token: string }>(`select token from analises where id = $1`, [nova.id])).token;
      const le = (await um<{ ok: boolean }>(`select privado.analise_arquivo_da_org($1) as ok`, [`ficha/${a.token}/rg-do-candidato.pdf`])).ok;
      return { criado: nova.token, depois, le, nova: nova.id };
    });
    expect(r.criado).not.toBe(a.token);
    expect(r.depois).not.toBe(a.token);
    expect(r.le).toBe(false);

    // Registro "torto" de antes da correção (outra organização apontando para a pasta do token atual de A): não dá leitura.
    await semGatilho(
      `insert into analise_arquivos (organizacao_id, analise_id, path, nome) select organizacao_id, id, $2, 'rg.pdf' from analises where id = $1`,
      [r.nova, `ficha/${atual}/holerite.pdf`],
    );
    const daOrg = (u: string) => comoUsuario(db, u, async () => (await um<{ ok: boolean }>(`select privado.analise_arquivo_da_org($1) as ok`, [`ficha/${atual}/holerite.pdf`])).ok);
    expect(await daOrg(OUTRA)).toBe(false);
    expect(await daOrg(ADMIN)).toBe(true);
  });

  it("ficha_enviar: limite por ficha", async () => {
    const a = await novaAnalise({ completa: false, nome: "Ana Limite", cpf: "24681357928" });
    await comoUsuario(db, ADMIN, () => db.query(`update analises set ficha_ativa = true, ficha_expira_em = privado.analise_hoje() + 15 where id = $1`, [a.id]));
    const enviar = (token: string) => comoAnonimo(db, () => erroDe(() => db.query(`select public.ficha_enviar($1, $2)`, [token, JSON.stringify({ consentimento: true })])));
    for (let i = 0; i < 3; i++) expect(await enviar(a.token)).toBe("");
    expect(await enviar(a.token)).toContain("Limite de envios desta ficha");

    // 10 envios no mesmo dia (fora do último minuto) também param a ficha.
    const b = await novaAnalise({ completa: false, nome: "Bruno Limite", cpf: "35792468109" });
    await comoUsuario(db, ADMIN, () => db.query(`update analises set ficha_ativa = true, ficha_expira_em = privado.analise_hoje() + 15 where id = $1`, [b.id]));
    await db.query(`select set_config('request.jwt.claim.sub', '', false)`);
    await db.query(
      `insert into analise_eventos (organizacao_id, analise_id, tipo, descricao, data) select $1, $2, 'ficha_enviada', 'Candidato enviou a ficha online', now() - interval '2 hours' from generate_series(1, 10)`,
      [org, b.id],
    );
    expect(await enviar(b.token)).toContain("Limite de envios desta ficha");
  });

  it("candidato, corretor e fiador precisam ser da mesma organização da análise", async () => {
    const estranho = await comoUsuario(db, OUTRA, async () => (await um<{ id: string }>(`insert into pessoas (nome) values ('Proprietário da Outra') returning id`)).id);
    const a = await novaAnalise({ completa: false, nome: "Caio Org", cpf: "29537914852" });
    await comoUsuario(db, ADMIN, async () => {
      expect(await erroDe(() => db.query(`insert into analises (candidato_id) values ($1)`, [estranho]))).toContain("Pessoa não encontrada");
      expect(await erroDe(() => db.query(`insert into analises (candidato_id, corretor_id) values ($1, $2)`, [a.pessoa, estranho]))).toContain("Pessoa não encontrada");
      expect(await erroDe(() => db.query(`update analises set corretor_id = $2 where id = $1`, [a.id, estranho]))).toContain("Pessoa não encontrada");
      expect(await erroDe(() => db.query(`update analises set candidato_id = $2 where id = $1`, [a.id, estranho]))).toContain("Pessoa não encontrada");
      expect(await erroDe(() => db.query(`insert into analise_fiadores (analise_id, pessoa_id) values ($1, $2)`, [a.id, estranho]))).toContain("Pessoa não encontrada");
    });
    // Mesmo com uma análise "torta" (de antes da correção), a ficha não completa o cadastro de outra organização.
    const torta = await semGatilho(
      `insert into analises (organizacao_id, candidato_id, ficha_ativa, ficha_expira_em) values ($1, $2, true, privado.analise_hoje() + 5) returning token`,
      [org, estranho],
    );
    const token = (torta.rows[0] as { token: string }).token;
    expect(await comoAnonimo(db, () => erroDe(() => db.query(`select public.ficha_enviar($1, $2)`, [token, JSON.stringify({ consentimento: true, email: "golpe@exemplo.com" })])))).toBe("");
    expect((await um<{ email: string | null }>(`select email from pessoas where id = $1`, [estranho])).email).toBeNull();
  });

  it("a correção roda de novo sem erro, sem DROP, e vale mesmo depois da migração original", async () => {
    const dir = join(__dirname, "..", "supabase", "migrations");
    const original = readFileSync(join(dir, "20261106000005_analise_cadastral.sql"), "utf8");
    const correcao = readFileSync(join(dir, "20261107000003_correcoes_analise.sql"), "utf8");
    expect(correcao).not.toMatch(/\bdrop\s+(table|trigger|policy|function|constraint|index|column|schema|view)/i);
    await db.exec(original);
    await db.exec(correcao);
    await db.exec(correcao);
    const a = await novaAnalise({ completa: false, nome: "Dora Reaplica", cpf: "46802468123" });
    await comoUsuario(db, ADMIN, () => db.query(`update analises set token = '11111111-2222-3333-4444-555555555555' where id = $1`, [a.id]));
    expect((await um<{ token: string }>(`select token from analises where id = $1`, [a.id])).token).not.toBe("11111111-2222-3333-4444-555555555555");
  });
});

describe("Storage da ficha (bucket simulado)", () => {
  it("no máximo 40 arquivos por link, só em ficha/<token>/<arquivo>; arquivo anterior ao token não vale pelo token", async () => {
    const st = new PGlite();
    await st.exec(`
      create role anon nologin; create role authenticated nologin;
      create schema auth;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
      create schema storage;
      create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
      create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, created_at timestamptz not null default now());
      alter table storage.objects enable row level security;
      create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
      grant usage on schema storage to anon, authenticated;
      grant select, insert, delete on storage.objects to anon, authenticated;
      grant execute on function storage.foldername(text) to anon, authenticated;
    `);
    const dir = join(__dirname, "..", "supabase", "migrations");
    for (const f of readdirSync(dir).sort()) await st.exec(readFileSync(join(dir, f), "utf8"));
    await st.exec(`grant usage on schema public to authenticated; grant select, insert, update, delete on all tables in schema public to authenticated;`);
    const U = "00000000-0000-0000-0000-000000015a51";
    const r = await comoUsuario(st, U, async () => {
      await st.query(`select public.criar_organizacao('Storage Análise')`);
      const p = (await st.query<{ id: string }>(`insert into pessoas (nome) values ('Candidato Storage') returning id`)).rows[0].id;
      const a = (await st.query<{ id: string; token: string }>(`insert into analises (candidato_id) values ($1) returning id, token`, [p])).rows[0];
      await st.query(`update analises set ficha_ativa = true, ficha_expira_em = privado.analise_hoje() + 10 where id = $1`, [a.id]);
      return a;
    });
    // Um objeto "esquecido" de antes de a análise ter este token.
    await st.query(`insert into storage.objects (bucket_id, name, created_at) values ('analises', $1, now() - interval '1 day')`, [`ficha/${r.token}/antigo.pdf`]);
    const enviar = (name: string) => comoAnonimo(st, () => erroDe(() => st.query(`insert into storage.objects (bucket_id, name) values ('analises', $1)`, [name])));
    expect(await enviar(`ficha/${r.token}/sub/pasta.pdf`)).toContain("row-level security");
    expect(await enviar(`ficha/00000000-0000-0000-0000-000000000000/x.pdf`)).toContain("row-level security");
    expect(await enviar(`ficha/${r.token.toUpperCase()}/maiusculas.pdf`)).toContain("row-level security"); // não escapa da contagem
    for (let i = 1; i <= 39; i++) expect(await enviar(`ficha/${r.token}/${i}.pdf`), String(i)).toBe("");
    expect(await enviar(`ficha/${r.token}/41.pdf`)).toContain("row-level security");
    const le = (path: string) => comoUsuario(st, U, async () => (await st.query<{ ok: boolean }>(`select privado.analise_arquivo_da_org($1) as ok`, [path])).rows[0].ok);
    expect(await le(`ficha/${r.token}/1.pdf`)).toBe(true);
    expect(await le(`ficha/${r.token}/antigo.pdf`)).toBe(false);
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
