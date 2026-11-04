/**
 * Automação e IA no banco (PGlite): listas iguais às do app, máscara de dados
 * pessoais, horário comercial, cota diária reservada antes da chamada
 * (organização e usuário), histórico só por função, ações sugeridas com
 * aprovação humana (quem pode decidir, quatro olhos, caminho de situação,
 * nada muda depois de sugerido), automações por regras (validação, trava por
 * dia/objeto, repetição, tarefa, aviso, mensagem para aprovar, prioridade do
 * lead, resposta fora do horário), consultas fechadas do assistente, preço por
 * comparáveis, contratos em risco, inconsistências financeiras, modo pessoal,
 * isolamento entre organizações, juntar cadastros e auditoria.
 */
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { hojeISO, somarDias } from "@/lib/dominio/datas";
import {
  CONSULTAS_IA,
  GATILHOS_IA,
  GATILHOS_IA_IMOB,
  PERMISSAO_RECURSO,
  RECURSOS_IA,
  RECURSOS_IA_IMOB,
  TIPOS_ACAO_IA,
  TIPOS_ACAO_IA_IMOB,
  TIPOS_INCONSISTENCIA,
  ACOES_REGRA,
  ACOES_REGRA_IMOB,
  TITULO_PADRAO_GATILHO,
  dentroDoHorario,
  mascararDadosPessoais,
  saidaParaHistorico,
  permissaoAcao,
  preencherModeloIA,
  validarCondicoes,
  validarConfigAcao,
  validarPayloadAcao,
} from "@/lib/dominio/ia";
import { comoAnonimo, comoUsuario, criarBanco } from "./pglite";

const ADMIN = "00000000-0000-0000-0000-000000022a01";
const GESTOR = "00000000-0000-0000-0000-000000022a02";
const CORRETOR = "00000000-0000-0000-0000-000000022a03";
const FIN = "00000000-0000-0000-0000-000000022a04";
const OUTRO = "00000000-0000-0000-0000-000000022b01";
const PESSOAL = "00000000-0000-0000-0000-000000022c01";

let db: PGlite;
let org: string;
let orgB: string;
let orgP: string;
const id: Record<string, string> = {};
const HOJE = hojeISO();

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

async function novaFatura(contrato: string, comp: string, venc: string, valor: number) {
  return (
    await um<{ id: string }>(`select public.registrar_fatura($1::jsonb) as id`, [
      JSON.stringify({
        contrato_id: contrato,
        competencia: comp,
        periodo_inicio: comp,
        periodo_fim: comp.slice(0, 8) + "28",
        vencimento: venc,
        valor_total: valor,
        itens: [{ descricao: `Aluguel ${comp}`, tipo: "aluguel", valor, destino: "proprietario" }],
      }),
    ])
  ).id;
}

const reservar = (user: string, recurso: string) =>
  comoUsuario(db, user, async () => (await um<{ r: { ok: boolean; id?: string; motivo?: string; mensagem?: string } }>(`select public.ia_reservar($1, 'teste (51) 99999-8888') as r`, [recurso])).r);

const ligarIA = (extra = "") => comoUsuario(db, ADMIN, () => db.query(`update ia_config set ativa = true ${extra} where organizacao_id = $1`, [org]));

beforeAll(async () => {
  db = await criarBanco();
  org = await comoUsuario(db, ADMIN, async () => (await um<{ id: string }>(`select public.criar_organizacao('Imob IA') as id`)).id);
  await db.query(`insert into membros (organizacao_id, user_id, papel) values ($1, $2, 'gestor'), ($1, $3, 'corretor'), ($1, $4, 'financeiro')`, [org, GESTOR, CORRETOR, FIN]);
  orgB = await comoUsuario(db, OUTRO, async () => (await um<{ id: string }>(`select public.criar_organizacao('Outra Imob') as id`)).id);
  orgP = await comoUsuario(db, PESSOAL, async () => (await um<{ id: string }>(`select public.criar_organizacao('Meus Imóveis') as id`)).id);
  await comoUsuario(db, PESSOAL, () => db.query(`update organizacoes set modo = 'pessoal' where id = $1`, [orgP]));

  await comoUsuario(db, ADMIN, async () => {
    const q1 = async (sql: string, p: unknown[] = []) => (await um<{ id: string }>(sql, p)).id;
    id.prop = await q1(`insert into pessoas (nome, papeis, telefone) values ('Paula Dona','{proprietario}','51988887777') returning id`);
    id.loc = await q1(`insert into pessoas (nome, papeis, telefone, email) values ('Luís Inquilino','{locatario}','51999990000','luis@x.com') returning id`);
    id.cor = await q1(`insert into pessoas (nome, papeis) values ('Carla Corretora','{corretor}') returning id`);
    id.imovel = await q1(
      `insert into imoveis (codigo, tipo, finalidades, status, bairro, cidade, area_util, quartos, valor_aluguel) values ('IA-1','apartamento','{locacao}','alugado','Centro','Canoas', 60, 2, 2000) returning id`,
    );
    // Comparáveis: 4 no mesmo bairro (R$/m² 30, 32, 35, 40) e um longe da área.
    for (const [cod, area, valor] of [
      ["IA-2", 50, 1500],
      ["IA-3", 55, 1760],
      ["IA-4", 62, 2170],
      ["IA-5", 70, 2800],
      ["IA-6", 200, 9000],
    ] as const)
      await db.query(
        `insert into imoveis (codigo, tipo, finalidades, status, bairro, cidade, area_util, quartos, valor_aluguel) values ($1,'apartamento','{locacao}','disponivel','Centro','Canoas',$2,2,$3)`,
        [cod, area, valor],
      );
    id.contrato = await q1(
      `insert into contratos (imovel_id, status, data_inicio, prazo_meses, data_fim, valor_aluguel, dia_vencimento, data_base_reajuste, taxa_administracao_pct)
       values ($1, 'ativo', $2, 12, $3, 2000, 10, $2, 10) returning id`,
      [id.imovel, somarDias(HOJE, -345), somarDias(HOJE, 20)],
    );
    await db.query(`insert into contrato_partes (contrato_id, pessoa_id, papel, percentual) values ($1,$2,'proprietario',100), ($1,$3,'locatario',null)`, [
      id.contrato,
      id.prop,
      id.loc,
    ]);
    id.fatura = await novaFatura(id.contrato, `${somarDias(HOJE, -40).slice(0, 7)}-01`, somarDias(HOJE, -10), 2000);
    id.lead = await q1(`insert into leads (nome, telefone, origem, funil) values ('Bruna Lead', '51977776666', 'site', 'locacao') returning id`);
  });
  await comoUsuario(db, OUTRO, () => db.query(`insert into imoveis (codigo, cidade) values ('B-1','Porto Alegre')`));
});

describe("listas do banco = listas do app", () => {
  it("recursos, gatilhos, ações, consultas, inconsistências e permissões", async () => {
    const l = await um<Record<string, string[]>>(
      `select privado.ia_recursos() r, privado.ia_recursos_imob() ri, privado.ia_gatilhos() g, privado.ia_gatilhos_imob() gi,
              privado.ia_acoes_regra() ar, privado.ia_acoes_regra_imob() ari, privado.ia_tipos_acao() ta, privado.ia_tipos_acao_imob() tai, privado.ia_consultas() c,
              privado.ia_consultas_imob() ci, privado.ia_inconsistencia_tipos() inc`,
    );
    expect(l.r).toEqual([...RECURSOS_IA]);
    expect(l.ri).toEqual([...RECURSOS_IA_IMOB]);
    expect(l.g).toEqual([...GATILHOS_IA]);
    expect(l.gi).toEqual([...GATILHOS_IA_IMOB]);
    expect(l.ar).toEqual([...ACOES_REGRA]);
    expect(l.ari).toEqual([...ACOES_REGRA_IMOB]);
    expect(l.ta).toEqual([...TIPOS_ACAO_IA]);
    expect(l.tai).toEqual([...TIPOS_ACAO_IA_IMOB]);
    expect(l.c).toEqual(CONSULTAS_IA.filter((c) => !c.soApp).map((c) => c.chave));
    expect(l.ci).toEqual(CONSULTAS_IA.filter((c) => c.imob).map((c) => c.chave));
    expect(l.inc).toEqual([...TIPOS_INCONSISTENCIA]);
    for (const r of RECURSOS_IA) expect((await um<{ p: string[] }>(`select privado.ia_recurso_permissao($1) p`, [r])).p).toEqual(PERMISSAO_RECURSO[r]);
    for (const t of TIPOS_ACAO_IA)
      for (const imob of [true, false]) expect((await um<{ p: string[] }>(`select privado.ia_acao_permissao($1, $2) p`, [t, imob])).p).toEqual(permissaoAcao(t, imob));
    for (const c of CONSULTAS_IA.filter((x) => !x.soApp))
      expect((await um<{ p: string[] }>(`select privado.ia_consulta_permissao($1) p`, [c.chave])).p).toEqual([c.modulo, c.operacao]);
    for (const g of GATILHOS_IA) expect((await um<{ t: string }>(`select privado.ia_titulo_padrao($1) t`, [g])).t).toBe(TITULO_PADRAO_GATILHO[g]);
  });

  it("máscara de dados pessoais, modelo de texto e horário comercial iguais", async () => {
    for (const s of [
      "CPF 529.982.247-25 e CNPJ 11.222.333/0001-81",
      "fone (51) 99999-8888 ou 5551988887777, e-mail ana.silva@exemplo.com.br",
      "sem nada sensível: 3 quartos, R$ 2.500,00, 12/10/2026",
      "Meu RG é 12.345.678-9 e a CNH nº 01234567890; identidade: 9876543",
      "registro geral 1.234.567-x, rg: MG-12.345.678 (sem número logo depois)",
      "banco Itaú ag 0001 conta corrente 12345-6, c/c 998877-1, pix 3f2a9c-77",
      "agência: 1234 e banco 341 / a conta de luz foi paga, conta paga ontem, água 30",
    ])
      expect((await um<{ m: string }>(`select privado.ia_mascarar($1) m`, [s])).m).toBe(mascararDadosPessoais(s));
    const modelo = "Oi {{nome}}, imóvel {{imovel}}, {{valor}} em {{data}} ({{horario}})";
    const sql = (await um<{ t: string }>(`select privado.ia_preencher($1, 'Ana Maria', 'AP-1', 1234.5, '2026-11-05', '08:00 às 18:00') t`, [modelo])).t;
    expect(sql).toBe(preencherModeloIA(modelo, { nome: "Ana Maria", imovel: "AP-1", valor: 1234.5, data: "2026-11-05", horario: "08:00 às 18:00" }));
    expect((await um<{ t: string }>(`select privado.ia_preencher('Oi {{nome}}', null, null, null, null) t`)).t).toBe(preencherModeloIA("Oi {{nome}}", {}));
    const cfg = { horario_inicio: "08:00", horario_fim: "18:00", dias_uteis: [1, 2, 3, 4, 5] };
    for (const iso of ["2026-11-02T11:00:00Z", "2026-11-02T10:59:00Z", "2026-11-02T21:00:00Z", "2026-11-01T14:00:00Z", "2026-11-07T12:00:00Z", "2026-11-03T02:30:00Z"]) {
      const r = (await um<{ h: boolean }>(`select privado.ia_no_horario($1::timestamptz, '08:00', '18:00', '{1,2,3,4,5}') h`, [iso])).h;
      expect(r, iso).toBe(dentroDoHorario(new Date(iso), cfg));
    }
  });

  it("validações de ação, condições e configuração da regra iguais", async () => {
    const casos: [string, object][] = [
      ["mensagem_cliente", { canal: "whatsapp", texto: "Olá" }],
      ["mensagem_cliente", { canal: "fax", texto: "Olá" }],
      ["mensagem_cliente", { canal: "email", texto: "" }],
      ["mudar_etapa_lead", { lead_id: "00000000-0000-0000-0000-000000000001", status: "perdido" }],
      ["mudar_etapa_lead", { lead_id: "00000000-0000-0000-0000-000000000001", status: "visita" }],
      ["desconto", { contrato_id: "00000000-0000-0000-0000-000000000001", tipo: "pct", valor: 120, inicio: "2026-12" }],
      ["desconto", { contrato_id: "00000000-0000-0000-0000-000000000001", tipo: "valor", valor: 100, inicio: "2026-12", fim: "2026-11" }],
      ["desconto", { contrato_id: "00000000-0000-0000-0000-000000000001", tipo: "valor", valor: "100.5", inicio: "2026-12", fim: null }],
      ["alterar_preco", { imovel_id: "00000000-0000-0000-0000-000000000001", campo: "valor_aluguel", valor: 2100 }],
      ["alterar_preco", { imovel_id: "x", campo: "valor_aluguel", valor: 2100 }],
      ["cancelar_cobranca", { fatura_id: "00000000-0000-0000-0000-000000000001", motivo: "" }],
      ["criar_lancamento", { tipo: "pagar", descricao: "Conta", valor: 10, vencimento: "2026-02-30" }],
      ["criar_lancamento", { tipo: "pagar", descricao: "Conta", valor: 10, vencimento: "2026-02-28" }],
      ["criar_tarefa", { titulo: "Ligar", prioridade: "urgente" }],
      ["inventado", {}],
    ];
    for (const [tipo, p] of casos) {
      const sql = (await um<{ e: string | null }>(`select privado.ia_payload_erro($1, $2::jsonb) e`, [tipo, JSON.stringify(p)])).e;
      expect(sql, `${tipo} ${JSON.stringify(p)}`).toBe(validarPayloadAcao(tipo, p));
    }
    const conds: [(typeof GATILHOS_IA)[number], object][] = [
      ["lead_parado", { funil: "venda", sem_corretor: true }],
      ["lead_parado", { valor_min: 10 }],
      ["fatura_vencida", { valor_min: -1 }],
      ["chamado_parado", { urgencia: "alta" }],
      ["garantia_vencendo", { funil: "venda" }],
    ];
    for (const [g, c] of conds)
      expect((await um<{ e: string | null }>(`select privado.ia_condicoes_erro($1, $2::jsonb) e`, [g, JSON.stringify(c)])).e, g).toBe(validarCondicoes(g, c));
    const acoes: [(typeof ACOES_REGRA)[number], (typeof GATILHOS_IA)[number], object][] = [
      ["marcar_prioridade", "fatura_vencida", { prioridade: "quente" }],
      ["marcar_prioridade", "lead_parado", {}],
      ["marcar_prioridade", "lead_parado", { etiqueta: "esfriando" }],
      ["sugerir_mensagem", "fatura_vencida", { mensagem: "" }],
      ["criar_tarefa", "fatura_vencida", { prioridade: "alta", outro: 1 }],
    ];
    for (const [a, g, c] of acoes)
      expect((await um<{ e: string | null }>(`select privado.ia_acao_config_erro($1, $2, $3::jsonb) e`, [a, g, JSON.stringify(c)])).e, `${a} ${g}`).toBe(validarConfigAcao(a, g, c));
  });
});

describe("configuração da IA", () => {
  it("só administrador/gestor configuram; o envio automático fora do horário é só do administrador", async () => {
    expect(await comoUsuario(db, CORRETOR, () => erroDe(() => db.query(`insert into ia_config (organizacao_id) values ($1)`, [org])))).toMatch(/row-level security/);
    await comoUsuario(db, ADMIN, () => db.query(`insert into ia_config (organizacao_id, recursos) values ($1, '{leads,assistente,inventado}')`, [org]).catch(() => null));
    // recurso inventado viola o check: a linha nasce com o padrão.
    await comoUsuario(db, ADMIN, () => db.query(`insert into ia_config (organizacao_id) values ($1) on conflict (organizacao_id) do nothing`, [org]));
    const gestorLiga = await comoUsuario(db, GESTOR, () => erroDe(() => db.query(`update ia_config set fora_horario_envio_auto = true where organizacao_id = $1`, [org])));
    expect(gestorLiga).toMatch(/Só o administrador liga o envio automático/);
    await comoUsuario(db, ADMIN, () => db.query(`update ia_config set fora_horario_envio_auto = true, recursos = '{assistente,leads,assistente}' where organizacao_id = $1`, [org]));
    const c1 = await comoUsuario(db, CORRETOR, () => um<{ fora_horario_envio_auto: boolean; recursos: string[] }>(`select fora_horario_envio_auto, recursos from ia_config`));
    expect(c1).toEqual({ fora_horario_envio_auto: true, recursos: ["assistente", "leads"] });
    // Gestor muda o texto aprovado: o envio automático desliga sozinho.
    await comoUsuario(db, GESTOR, () => db.query(`update ia_config set mensagem_fora_horario = 'Outro texto {{nome}}' where organizacao_id = $1`, [org]));
    expect((await comoUsuario(db, ADMIN, () => um<{ a: boolean }>(`select fora_horario_envio_auto a from ia_config`))).a).toBe(false);
    expect(await comoUsuario(db, ADMIN, () => erroDe(() => db.query(`update ia_config set horario_fim = '07:00' where organizacao_id = $1`, [org])))).toMatch(/depois do início/);
    expect(await comoUsuario(db, OUTRO, () => todos(`select * from ia_config`))).toHaveLength(0);
    await comoUsuario(db, ADMIN, () => db.query(`update ia_config set recursos = privado.ia_recursos() where organizacao_id = $1`, [org]));
  });
});

describe("cota da IA (reservar antes, concluir depois)", () => {
  it("desligada, recurso desligado, modo, permissão e limites por usuário e organização", async () => {
    expect((await reservar(ADMIN, "assistente")).motivo).toBe("desligada");
    await ligarIA(", limite_dia_usuario = 2, limite_dia_org = 3, recursos = '{assistente,busca_imoveis,leads}'");
    expect((await reservar(ADMIN, "resumo")).motivo).toBe("recurso_desligado");
    expect(await comoUsuario(db, ADMIN, () => erroDe(() => db.query(`select public.ia_reservar('inventado')`)))).toMatch(/Recurso de IA desconhecido/);
    const a1 = await reservar(ADMIN, "assistente");
    const a2 = await reservar(ADMIN, "busca_imoveis");
    expect(a1.ok && a2.ok).toBe(true);
    expect((await reservar(ADMIN, "assistente")).motivo).toBe("limite_usuario");
    expect((await reservar(GESTOR, "assistente")).ok).toBe(true);
    expect((await reservar(CORRETOR, "assistente")).motivo).toBe("limite_org");
    // Entrada gravada mascarada.
    const e = await comoUsuario(db, ADMIN, () => um<{ entrada_resumo: string; status: string }>(`select entrada_resumo, status from ia_execucoes where id = $1`, [a1.id]));
    expect(e).toEqual({ entrada_resumo: "teste [telefone]", status: "reservada" });

    // Concluir: só quem reservou, só uma vez; custo calculado no banco; saída mascarada.
    expect(await comoUsuario(db, GESTOR, () => erroDe(() => db.query(`select public.ia_concluir($1, '{"status":"ok"}')`, [a1.id])))).toMatch(/não encontrada/);
    await comoUsuario(db, ADMIN, () =>
      db.query(`select public.ia_concluir($1, $2::jsonb)`, [
        a1.id,
        JSON.stringify({ status: "ok", saida: "CPF 529.982.247-25", tokens_entrada: 1000, tokens_saida: 200, tokens_cache_leitura: 2000, duracao_ms: 850 }),
      ]),
    );
    const fim = await comoUsuario(db, ADMIN, () => um<Record<string, unknown>>(`select status, saida, tokens_entrada, tokens_saida, tokens_cache, custo_estimado::float8 c, duracao_ms from ia_execucoes where id = $1`, [a1.id]));
    expect(fim).toMatchObject({ status: "ok", saida: "CPF [CPF]", tokens_entrada: 3000, tokens_saida: 200, tokens_cache: 2000, duracao_ms: 850 });
    expect(fim.c).toBeCloseTo((1000 * 3 + 2000 * 0.1 * 3 + 200 * 15) / 1e6, 8);
    expect(await comoUsuario(db, ADMIN, () => erroDe(() => db.query(`select public.ia_concluir($1, '{"status":"ok"}')`, [a1.id])))).toMatch(/já foi encerrada/);

    // Modo pessoal: leads não existem.
    await comoUsuario(db, PESSOAL, () => db.query(`insert into ia_config (organizacao_id, ativa) values ($1, true)`, [orgP]));
    expect((await reservar(PESSOAL, "leads")).motivo).toBe("modo");
    expect((await reservar(PESSOAL, "resumo")).ok).toBe(true);

    // Permissão: o financeiro (padrão) não edita imóveis → não gera descrição.
    await ligarIA(", limite_dia_usuario = 50, limite_dia_org = 300, recursos = privado.ia_recursos()");
    expect((await reservar(FIN, "descricao_anuncio")).motivo).toBe("permissao");
    expect((await reservar(FIN, "assistente")).ok).toBe(true);
  });

  it("histórico: só pelas funções; cada um vê o seu, administrador e gestor veem tudo; outra organização não vê", async () => {
    expect(await comoUsuario(db, ADMIN, () => erroDe(() => db.query(`insert into ia_execucoes (recurso) values ('assistente')`)))).toMatch(/não pode ser alterado/);
    // Sem política de alteração: a API não enxerga linha para mudar ou apagar.
    await comoUsuario(db, ADMIN, () => db.query(`update ia_execucoes set status = 'ok', saida = 'mudei'`));
    await comoUsuario(db, ADMIN, () => db.query(`delete from ia_execucoes`));
    expect((await um<{ n: number }>(`select count(*)::int n from ia_execucoes where saida = 'mudei'`)).n).toBe(0);
    expect((await um<{ n: number }>(`select count(*)::int n from ia_execucoes`)).n).toBeGreaterThan(3);
    const fin = await comoUsuario(db, FIN, () => todos<{ usuario_id: string }>(`select usuario_id from ia_execucoes`));
    expect(fin.length).toBeGreaterThan(0);
    expect(fin.every((x) => x.usuario_id === FIN)).toBe(true);
    const gestor = await comoUsuario(db, GESTOR, () => todos<{ usuario_id: string }>(`select distinct usuario_id from ia_execucoes`));
    expect(gestor.length).toBeGreaterThan(1);
    expect(await comoUsuario(db, OUTRO, () => todos(`select * from ia_execucoes`))).toHaveLength(0);
    expect(await comoAnonimo(db, () => erroDe(() => db.query(`select public.ia_reservar('assistente')`)))).toMatch(/permission denied/);
    const uso = await comoUsuario(db, GESTOR, async () => (await um<{ r: Record<string, number> }>(`select public.ia_uso_resumo(current_date - 1, current_date + 1) r`)).r);
    expect(uso.chamadas).toBe(4);
    expect(uso.ok).toBe(1);
    expect(Number(uso.custo)).toBeGreaterThan(0);
    const usoFin = await comoUsuario(db, FIN, async () => (await um<{ r: Record<string, number> }>(`select public.ia_uso_resumo(null, null) r`)).r);
    expect(usoFin.chamadas).toBe(fin.length);
  });

  it("leitura de documento: o histórico guarda só os nomes dos campos encontrados (LGPD)", async () => {
    const r = await reservar(ADMIN, "extracao_documento");
    expect(r.ok).toBe(true);
    const saida = JSON.stringify({ legivel: true, campos: { nome: "Ana Maria Souza", rg: "12.345.678-9", nascimento: "1990-05-01", endereco: "Rua A, 10", renda: 5400, orgao: null, uf: "" } });
    await comoUsuario(db, ADMIN, () => db.query(`select public.ia_concluir($1, $2::jsonb)`, [r.id, JSON.stringify({ status: "ok", saida })]));
    const e = await comoUsuario(db, ADMIN, () => um<{ saida: string }>(`select saida from ia_execucoes where id = $1`, [r.id]));
    expect(JSON.parse(e.saida)).toEqual({ campos_encontrados: ["endereco", "nascimento", "nome", "renda", "rg"], legivel: true });
    expect(e.saida).not.toMatch(/Ana|12\.345|1990|Rua|5400/);
    // Mesma regra no app (o que o servidor manda) e texto que não é JSON não fica guardado.
    expect(JSON.parse(saidaParaHistorico("extracao_documento", JSON.parse(saida))!)).toEqual(JSON.parse(e.saida));
    expect((await um<{ s: string | null }>(`select privado.ia_saida_extracao('Nome: Ana, RG 123') s`)).s).toBeNull();
  });
});

describe("ações sugeridas com aprovação humana", () => {
  const sugerir = (user: string, tipo: string, payload: object, extra: Record<string, unknown> = {}) =>
    comoUsuario(db, user, async () =>
      (
        await um<{ id: string; status: string; criada_por: string }>(
          `insert into ia_acoes (tipo, titulo, payload, origem, status, chave) values ($1, 'Sugestão', $2::jsonb, $3, $4, $5) returning id, status, criada_por`,
          [tipo, JSON.stringify(payload), extra.origem ?? "ia", extra.status ?? "pendente", extra.chave ?? null],
        )
      ),
    );

  it("nasce pendente, valida os dados e o modo; automação só pelo banco", async () => {
    const a = await sugerir(CORRETOR, "mensagem_cliente", { canal: "whatsapp", destino: "51999990000", texto: "Olá!" }, { status: "executada", chave: "x" });
    expect(a.status).toBe("pendente");
    expect(a.criada_por).toBe(CORRETOR);
    id.acaoMsg = a.id;
    expect(await erroDe(() => sugerir(CORRETOR, "mensagem_cliente", { canal: "fax", texto: "Olá" }))).toMatch(/Canal da mensagem inválido/);
    expect(await erroDe(() => sugerir(CORRETOR, "mensagem_cliente", { canal: "sms", texto: "Oi" }, { origem: "automacao" }))).toMatch(/só são criadas pelo próprio sistema/);
    expect(
      await erroDe(() =>
        comoUsuario(db, PESSOAL, () => db.query(`insert into ia_acoes (tipo, titulo, payload) values ('mudar_etapa_lead', 'x', $1::jsonb)`, [JSON.stringify({ lead_id: id.lead, status: "visita" })])),
      ),
    ).toMatch(/só existe no modo imobiliária/);
  });

  it("quem pode decidir: não o corretor, nem quem pediu (a não ser o administrador); recusar pede motivo", async () => {
    const decidir = (user: string, acao: string, status: string, motivo: string | null = null) =>
      comoUsuario(db, user, () => db.query(`update ia_acoes set status = $2, motivo = $3 where id = $1`, [acao, status, motivo]));
    expect(await erroDe(() => decidir(CORRETOR, id.acaoMsg, "aprovada"))).toMatch(/não pode decidir/);
    expect(await erroDe(() => decidir(GESTOR, id.acaoMsg, "recusada"))).toMatch(/motivo da recusa/);
    // O que foi sugerido não muda (nem junto com a decisão).
    await comoUsuario(db, GESTOR, () => db.query(`update ia_acoes set status = 'aprovada', payload = '{"canal":"sms","texto":"trocado"}', titulo = 'Outro' where id = $1`, [id.acaoMsg]));
    const ap = await comoUsuario(db, GESTOR, () => um<Record<string, unknown>>(`select status, payload, titulo, decidida_por from ia_acoes where id = $1`, [id.acaoMsg]));
    expect(ap).toMatchObject({ status: "aprovada", titulo: "Sugestão", decidida_por: GESTOR, payload: { canal: "whatsapp", destino: "51999990000", texto: "Olá!" } });
    // Aprovada → feita (pela via normal, fora do banco) por quem pode executar.
    expect(await erroDe(() => decidir(GESTOR, id.acaoMsg, "recusada", "x"))).toMatch(/não permitida/);
    await comoUsuario(db, CORRETOR, () => db.query(`update ia_acoes set status = 'executada', resultado = 'WhatsApp aberto' where id = $1`, [id.acaoMsg]));
    expect((await comoUsuario(db, CORRETOR, () => um<{ status: string; executada_por: string }>(`select status, executada_por from ia_acoes where id = $1`, [id.acaoMsg])))).toEqual({
      status: "executada",
      executada_por: CORRETOR,
    });

    // Gestor não aprova a própria; o administrador aprova a do gestor.
    const g = await sugerir(GESTOR, "alterar_preco", { imovel_id: id.imovel, campo: "valor_aluguel", valor: 2100 });
    expect(await erroDe(() => decidir(GESTOR, g.id, "aprovada"))).toMatch(/não pode decidir/);
    await decidir(ADMIN, g.id, "aprovada");
    // Cobrança: o financeiro (tem "aprovar" em Cobranças) decide; o corretor nem vê.
    const c = await sugerir(GESTOR, "cancelar_cobranca", { fatura_id: id.fatura, motivo: "Lançada em dobro" });
    expect(await comoUsuario(db, CORRETOR, () => todos(`select id from ia_acoes where id = $1`, [c.id]))).toHaveLength(0);
    await decidir(FIN, c.id, "recusada", "A cobrança está certa");
    expect((await comoUsuario(db, FIN, () => um<{ status: string; motivo: string }>(`select status, motivo from ia_acoes where id = $1`, [c.id])))).toEqual({
      status: "recusada",
      motivo: "A cobrança está certa",
    });
    // Cancelar: só quem pediu ou administrador/gestor.
    const t = await sugerir(CORRETOR, "criar_tarefa", { titulo: "Ligar para a Bruna" });
    // O financeiro nem enxerga a tarefa do Comercial: nada muda.
    await decidir(FIN, t.id, "cancelada");
    expect((await comoUsuario(db, ADMIN, () => um<{ status: string }>(`select status from ia_acoes where id = $1`, [t.id]))).status).toBe("pendente");
    await decidir(CORRETOR, t.id, "cancelada");
    expect((await comoUsuario(db, ADMIN, () => um<{ status: string; decidida_por: string }>(`select status, decidida_por from ia_acoes where id = $1`, [t.id])))).toEqual({
      status: "cancelada",
      decidida_por: CORRETOR,
    });
    // Quem vê (gestor não; ele vê tudo) mas não pediu: o financeiro numa ação de Cobranças que ele não criou.
    const c2 = await sugerir(CORRETOR, "renegociar_cobranca", { fatura_id: id.fatura });
    expect(await erroDe(() => decidir(FIN, c2.id, "cancelada"))).toMatch(/Só quem pediu/);
    // Outra organização não vê nada.
    expect(await comoUsuario(db, OUTRO, () => todos(`select id from ia_acoes`))).toHaveLength(0);
  });

  it("decisão e execução atômicas: duas telas ao mesmo tempo não fazem a ação duas vezes", async () => {
    const a = await sugerir(CORRETOR, "alterar_preco", { imovel_id: id.imovel, campo: "valor_aluguel", valor: 2050 });
    // Dois gestores aprovam "ao mesmo tempo": o update condicional só pega a linha uma vez.
    const aprovar = (user: string) =>
      comoUsuario(db, user, async () => (await db.query(`update ia_acoes set status = 'aprovada' where id = $1 and status = 'pendente' returning id`, [a.id])).rows.length);
    expect(await aprovar(GESTOR)).toBe(1);
    expect(await aprovar(ADMIN)).toBe(0);
    // Sem o filtro da situação, repetir a mesma situação é recusado (não passa calado).
    expect(await comoUsuario(db, ADMIN, () => erroDe(() => db.query(`update ia_acoes set status = 'aprovada' where id = $1`, [a.id])))).toMatch(/já está nesta situação/);
    // Tipo que o sistema faz sozinho não vira "feita" sem passar por "executando".
    expect(await comoUsuario(db, ADMIN, () => erroDe(() => db.query(`update ia_acoes set status = 'executada' where id = $1`, [a.id])))).toMatch(/não permitida/);
    // Trava: só uma tela passa para "executando".
    const travar = (user: string) =>
      comoUsuario(db, user, async () => (await db.query(`update ia_acoes set status = 'executando' where id = $1 and status in ('aprovada','erro') returning id`, [a.id])).rows.length);
    expect(await travar(ADMIN)).toBe(1);
    expect(await travar(GESTOR)).toBe(0);
    // Quem não começou não fecha (nem marca erro antes de 10 minutos).
    expect(await comoUsuario(db, GESTOR, () => erroDe(() => db.query(`update ia_acoes set status = 'executada' where id = $1`, [a.id])))).toMatch(/sendo feita por outra pessoa/);
    expect(await comoUsuario(db, GESTOR, () => erroDe(() => db.query(`update ia_acoes set status = 'erro' where id = $1`, [a.id])))).toMatch(/sendo feita por outra pessoa/);
    await comoUsuario(db, ADMIN, () => db.query(`update ia_acoes set status = 'executada', resultado = 'Preço atualizado' where id = $1 and status = 'executando'`, [a.id]));
    const fim = await comoUsuario(db, ADMIN, () => um<Record<string, unknown>>(`select status, executada_por, resultado, decidida_por from ia_acoes where id = $1`, [a.id]));
    expect(fim).toMatchObject({ status: "executada", executada_por: ADMIN, resultado: "Preço atualizado", decidida_por: GESTOR });
    expect(await comoUsuario(db, ADMIN, () => erroDe(() => db.query(`update ia_acoes set status = 'executada' where id = $1`, [a.id])))).toMatch(/já está nesta situação/);
    expect(await comoUsuario(db, ADMIN, () => erroDe(() => db.query(`update ia_acoes set status = 'executando' where id = $1`, [a.id])))).toMatch(/não permitida/);

    // Execução que parou no meio há mais de 10 minutos: outra pessoa marca erro e tenta de novo.
    const b = await sugerir(CORRETOR, "alterar_preco", { imovel_id: id.imovel, campo: "valor_aluguel", valor: 2060 });
    await comoUsuario(db, GESTOR, () => db.query(`update ia_acoes set status = 'aprovada' where id = $1 and status = 'pendente'`, [b.id]));
    await comoUsuario(db, ADMIN, () => db.query(`update ia_acoes set status = 'executando' where id = $1`, [b.id]));
    await db.query(`update ia_acoes set executada_em = now() - interval '11 minutes' where id = $1`, [b.id]);
    await comoUsuario(db, GESTOR, () => db.query(`update ia_acoes set status = 'erro' where id = $1 and status = 'executando'`, [b.id]));
    const travada = await comoUsuario(db, GESTOR, () => um<{ status: string; erro: string; executada_por: string }>(`select status, erro, executada_por from ia_acoes where id = $1`, [b.id]));
    expect(travada.status).toBe("erro");
    expect(travada.erro).toMatch(/não terminou/);
    await comoUsuario(db, GESTOR, () => db.query(`update ia_acoes set status = 'executando' where id = $1 and status in ('aprovada','erro')`, [b.id]));
    expect((await comoUsuario(db, GESTOR, () => um<{ status: string }>(`select status from ia_acoes where id = $1`, [b.id]))).status).toBe("executando");
  });

  it("sem 'exigir aprovação', quem tem a permissão do módulo confirma a própria", async () => {
    await comoUsuario(db, ADMIN, () => db.query(`update ia_config set exigir_aprovacao = false where organizacao_id = $1`, [org]));
    const t = await sugerir(CORRETOR, "mudar_etapa_lead", { lead_id: id.lead, status: "em_atendimento" });
    await comoUsuario(db, CORRETOR, () => db.query(`update ia_acoes set status = 'aprovada' where id = $1`, [t.id]));
    expect((await comoUsuario(db, CORRETOR, () => um<{ status: string }>(`select status from ia_acoes where id = $1`, [t.id]))).status).toBe("aprovada");
    // Mesmo assim, sem a permissão do módulo não decide (financeiro não edita o Comercial).
    const t2 = await sugerir(CORRETOR, "mudar_etapa_lead", { lead_id: id.lead, status: "visita" });
    expect(await comoUsuario(db, FIN, () => erroDe(() => db.query(`update ia_acoes set status = 'aprovada' where id = $1`, [t2.id])))).toMatch(/não pode decidir|0 rows|^$/);
    expect((await comoUsuario(db, ADMIN, () => um<{ status: string }>(`select status from ia_acoes where id = $1`, [t2.id]))).status).toBe("pendente");
    await comoUsuario(db, ADMIN, () => db.query(`update ia_config set exigir_aprovacao = true where organizacao_id = $1`, [org]));
  });
});

describe("automações por regras", () => {
  it("valida gatilho, condições, ação e modo; corretor não configura", async () => {
    const criar = (user: string, cols: string, vals: unknown[]) => comoUsuario(db, user, () => db.query(`insert into automacoes_regras ${cols}`, vals));
    expect(await erroDe(() => criar(CORRETOR, `(nome, gatilho, acao) values ('x','fatura_vencida','criar_tarefa')`, []))).toMatch(/row-level security/);
    expect(await erroDe(() => criar(ADMIN, `(nome, gatilho, acao, condicoes) values ('x','fatura_vencida','criar_tarefa', '{"funil":"venda"}')`, []))).toMatch(/não vale para este gatilho/);
    expect(await erroDe(() => criar(ADMIN, `(nome, gatilho, acao, acao_config) values ('x','fatura_vencida','marcar_prioridade','{"prioridade":"quente"}')`, []))).toMatch(
      /só vale para leads/,
    );
    expect(await erroDe(() => criar(PESSOAL, `(nome, gatilho, acao) values ('x','lead_novo','criar_tarefa')`, []))).toMatch(/só existem no modo imobiliária/);
    // No pessoal, tarefa não aparece em lugar nenhum (só no Comercial): a regra não cria tarefa…
    expect(await erroDe(() => criar(PESSOAL, `(nome, gatilho, acao) values ('x','fatura_vencida','criar_tarefa')`, []))).toMatch(/não cria tarefa/);
    // …e nem a ação sugerida de tarefa existe lá; avisar o responsável, sim.
    expect(
      await erroDe(() => comoUsuario(db, PESSOAL, () => db.query(`insert into ia_acoes (tipo, titulo, payload) values ('criar_tarefa', 'x', '{"titulo":"Ligar"}'::jsonb)`))),
    ).toMatch(/só existe no modo imobiliária/);
    await criar(PESSOAL, `(nome, gatilho, acao) values ('Aviso de atraso','fatura_vencida','avisar_responsavel')`, []);
    expect(await erroDe(() => criar(ADMIN, `(nome, gatilho, acao) values ('x','inventado','criar_tarefa')`, []))).toMatch(/check constraint/);
  });

  it("rodada: tarefa, aviso, mensagem para aprovar e prioridade, uma vez por dia por objeto", async () => {
    await comoUsuario(db, ADMIN, async () => {
      id.rTarefa = (
        await um<{ id: string }>(
          `insert into automacoes_regras (nome, gatilho, dias, acao, acao_config, repetir_dias) values ('Cobrar atraso','fatura_vencida',5,'criar_tarefa','{"prioridade":"alta"}', 0) returning id`,
        )
      ).id;
      id.rMsg = (
        await um<{ id: string }>(
          `insert into automacoes_regras (nome, gatilho, dias, acao, acao_config) values ('Lembrete atraso','fatura_vencida',1,'sugerir_mensagem','{"mensagem":"Oi {{nome}}, o aluguel de {{valor}} venceu em {{data}}."}') returning id`,
        )
      ).id;
      id.rAviso = (await um<{ id: string }>(`insert into automacoes_regras (nome, gatilho, dias, acao) values ('Contrato acabando','contrato_vencendo',30,'avisar_responsavel') returning id`)).id;
      id.rLead = (
        await um<{ id: string }>(
          `insert into automacoes_regras (nome, gatilho, dias, acao, acao_config, condicoes) values ('Quente','lead_novo',1,'marcar_prioridade','{"prioridade":"quente","etiqueta":"site"}','{"origem":"site"}') returning id`,
        )
      ).id;
    });
    expect(await comoUsuario(db, CORRETOR, () => erroDe(() => db.query(`select public.automacoes_rodar(true)`)))).toMatch(/Só o administrador ou o gestor/);
    const r1 = await comoUsuario(db, CORRETOR, async () => (await um<{ r: Record<string, number | boolean> }>(`select public.automacoes_rodar() r`)).r);
    expect(r1).toMatchObject({ rodou: true, regras: 4, disparos: 4 });
    // Trava de 10 minutos.
    expect((await comoUsuario(db, CORRETOR, async () => (await um<{ r: { rodou: boolean } }>(`select public.automacoes_rodar() r`)).r)).rodou).toBe(false);

    const tarefa = await comoUsuario(db, ADMIN, () => um<{ titulo: string; prioridade: string; contrato_id: string }>(`select titulo, prioridade, contrato_id from tarefas`));
    expect(tarefa.titulo).toMatch(/^Cobrar Luís: aluguel vencido em \d{2}\/\d{2}\/\d{4} \(R\$ 2\.000,00\)$/);
    expect(tarefa.prioridade).toBe("alta");
    expect(tarefa.contrato_id).toBe(id.contrato);
    const msg = await comoUsuario(db, GESTOR, () => um<{ status: string; origem: string; payload: { texto: string; destino: string }; criada_por: string | null }>(
      `select status, origem, payload, criada_por from ia_acoes where regra_id = $1`,
      [id.rMsg],
    ));
    expect(msg).toMatchObject({ status: "pendente", origem: "automacao", criada_por: null });
    expect(msg.payload.texto).toMatch(/^Oi Luís, o aluguel de R\$ 2\.000,00 venceu em/);
    expect(msg.payload.destino).toBe("51999990000");
    const avisos = await comoUsuario(db, ADMIN, () => todos<{ titulo: string; link: string }>(`select titulo, link from ia_avisos`));
    expect(avisos).toHaveLength(1);
    expect(avisos[0].link).toBe(`/contratos/${id.contrato}`);
    expect(await comoUsuario(db, CORRETOR, () => todos(`select * from ia_avisos`))).toHaveLength(0);
    // Gestor também recebe (não há responsável): marca como lido, mas não muda o texto.
    await comoUsuario(db, GESTOR, () => db.query(`update ia_avisos set lido_em = now(), titulo = 'mudei'`));
    const lido = await comoUsuario(db, GESTOR, () => um<{ titulo: string; lido_em: string | null }>(`select titulo, lido_em from ia_avisos`));
    expect(lido.titulo).not.toBe("mudei");
    expect(lido.lido_em).not.toBeNull();
    const lead = await comoUsuario(db, ADMIN, () => um<{ prioridade: string; etiquetas: string[] }>(`select prioridade, etiquetas from leads where id = $1`, [id.lead]));
    expect(lead).toEqual({ prioridade: "quente", etiquetas: ["site"] });

    // Forçar de novo no mesmo dia: nada repete (trava regra + objeto + dia).
    const r2 = await comoUsuario(db, ADMIN, async () => (await um<{ r: Record<string, number> }>(`select public.automacoes_rodar(true) r`)).r);
    expect(r2.disparos).toBe(0);
    expect((await comoUsuario(db, ADMIN, () => todos(`select id from tarefas`))).length).toBe(1);
    // O histórico das automações é só leitura.
    await comoUsuario(db, ADMIN, () => db.query(`delete from automacoes_execucoes`));
    expect(await comoUsuario(db, ADMIN, () => erroDe(() => db.query(`insert into automacoes_execucoes (regra_id, gatilho, acao, objeto_tipo, objeto_id, dia) values ($1,'x','y','z',$1,current_date)`, [id.rTarefa])))).toMatch(
      /não pode ser alterado/,
    );
    const execs = await comoUsuario(db, ADMIN, () => todos<{ status: string }>(`select status from automacoes_execucoes`));
    expect(execs).toHaveLength(4);
    expect(await comoUsuario(db, OUTRO, () => todos(`select * from automacoes_execucoes`))).toHaveLength(0);
  });

  it("resposta fora do horário: uma por conversa e período; sugerida, ou pré-aprovada com o texto do administrador", async () => {
    // Sem dias úteis = sempre fora do horário.
    await comoUsuario(db, ADMIN, () =>
      db.query(`update ia_config set fora_horario_ativo = true, dias_uteis = '{}', mensagem_fora_horario = 'Oi {{nome}}! Voltamos às {{horario}}.' where organizacao_id = $1`, [org]),
    );
    const conv = (await um<{ id: string }>(`insert into mkt_conversas (organizacao_id, canal, contato, nome) values ($1, 'whatsapp', '5551966665555', 'Rita Souza') returning id`, [org])).id;
    await db.query(`insert into mkt_mensagens (organizacao_id, conversa_id, direcao, texto) values ($1, $2, 'entrada', 'Tem apartamento?')`, [org, conv]);
    await comoUsuario(db, ADMIN, () => db.query(`select public.automacoes_rodar(true)`));
    const a = await comoUsuario(db, ADMIN, () => um<{ status: string; aprovacao_automatica: boolean; chave: string; payload: { texto: string; conversa_id: string } }>(
      `select status, aprovacao_automatica, chave, payload from ia_acoes where referencia_id = $1`,
      [conv],
    ));
    expect(a.status).toBe("pendente");
    expect(a.payload.texto).toBe("Oi Rita! Voltamos às 08:00 às 18:00.");
    expect(a.chave).toBe(`fora_horario:${conv}:${HOJE}`);
    // Mais duas mensagens na mesma noite: nenhuma resposta repetida.
    for (const [t, seg] of [["Alô?", 1], ["Ainda tem?", 2]] as const) {
      await db.query(`insert into mkt_mensagens (organizacao_id, conversa_id, direcao, texto, data) values ($1, $2, 'entrada', $3, now() + make_interval(secs => $4))`, [org, conv, t, seg]);
      await comoUsuario(db, ADMIN, () => db.query(`select public.automacoes_rodar(true)`));
    }
    expect(await comoUsuario(db, ADMIN, () => todos(`select id from ia_acoes where referencia_id = $1`, [conv]))).toHaveLength(1);
    // Com a aprovação dispensada pelo administrador, a de outra conversa já nasce aprovada (o envio continua pelo botão).
    await comoUsuario(db, ADMIN, () => db.query(`update ia_config set fora_horario_envio_auto = true where organizacao_id = $1`, [org]));
    const conv2 = (await um<{ id: string }>(`insert into mkt_conversas (organizacao_id, canal, contato, nome) values ($1, 'whatsapp', '5551955554444', 'Davi') returning id`, [org])).id;
    await db.query(`insert into mkt_mensagens (organizacao_id, conversa_id, direcao, texto) values ($1, $2, 'entrada', 'Boa noite')`, [org, conv2]);
    await comoUsuario(db, ADMIN, () => db.query(`select public.automacoes_rodar(true)`));
    const b = await comoUsuario(db, ADMIN, () => um<{ status: string; aprovacao_automatica: boolean; resultado: string }>(
      `select status, aprovacao_automatica, resultado from ia_acoes where referencia_id = $1`,
      [conv2],
    ));
    expect(b).toMatchObject({ status: "aprovada", aprovacao_automatica: true });
    expect(b.resultado).toMatch(/pelo botão/);
    await comoUsuario(db, ADMIN, () => db.query(`update ia_config set fora_horario_ativo = false, dias_uteis = '{1,2,3,4,5}' where organizacao_id = $1`, [org]));
  });
});

describe("assistente: consultas da lista fechada (RLS vale)", () => {
  it("responde, valida parâmetros e respeita modo e organização", async () => {
    const r = await comoUsuario(db, ADMIN, async () => (await um<{ r: { titulo: string; resumo: { rotulo: string; valor: number }[]; linhas: unknown[][] } }>(`select public.ia_consulta('inadimplencia', '{}') r`)).r);
    expect(r.titulo).toBe("Aluguéis em atraso");
    expect(r.resumo).toEqual([
      { rotulo: "Cobranças em atraso", valor: 1, tipo: "inteiro" },
      { rotulo: "Total em atraso", valor: 2000, tipo: "moeda" },
    ]);
    const venc = await comoUsuario(db, ADMIN, async () => (await um<{ r: { resumo: { valor: number }[] } }>(`select public.ia_consulta('contratos_vencendo', '{"dias": 30}') r`)).r);
    expect(venc.resumo[0].valor).toBe(1);
    const rec = await comoUsuario(db, ADMIN, async () =>
      (await um<{ r: { linhas: unknown[][] } }>(`select public.ia_consulta('aluguel_recebido', $1::jsonb) r`, [JSON.stringify({ de: somarDias(HOJE, -60), ate: HOJE })])).r,
    );
    expect(rec.linhas.length).toBeGreaterThan(0);
    expect(await comoUsuario(db, ADMIN, () => erroDe(() => db.query(`select public.ia_consulta('select * from pessoas', '{}')`)))).toMatch(/Consulta desconhecida/);
    expect(await comoUsuario(db, ADMIN, () => erroDe(() => db.query(`select public.ia_consulta('despesas', '{"de":"2026-13-01","ate":"2026-12-01"}')`)))).toMatch(/Período inválido/);
    expect(await comoUsuario(db, PESSOAL, () => erroDe(() => db.query(`select public.ia_consulta('leads_periodo', '{"de":"2026-01-01","ate":"2026-01-31"}')`)))).toMatch(
      /só existe no modo imobiliária/,
    );
    const outra = await comoUsuario(db, OUTRO, async () => (await um<{ r: { resumo: { valor: number }[] } }>(`select public.ia_consulta('inadimplencia', '{}') r`)).r);
    expect(outra.resumo[0].valor).toBe(0);
    // Perfil sem Cobranças → recusa.
    const perfil = await comoUsuario(db, ADMIN, async () => (await um<{ id: string }>(`insert into perfis_acesso (nome, papel_base, permissoes) values ('Só imóveis', 'corretor', '{"painel":["ver"],"imoveis":["ver"]}') returning id`)).id);
    await db.query(`update membros set perfil_id = $1 where user_id = $2`, [perfil, CORRETOR]);
    expect(await comoUsuario(db, CORRETOR, () => erroDe(() => db.query(`select public.ia_consulta('inadimplencia', '{}')`)))).toMatch(/não permite ver em Cobranças/);
    await db.query(`update membros set perfil_id = null where user_id = $1`, [CORRETOR]);
  });
});

describe("assistente: receitas e despesas com a mesma conta do BI", () => {
  type R = { titulo: string; resumo: { rotulo: string; valor: number }[]; linhas: [string, number, number][] };
  const consulta = (user: string, chave: string, de: string, ate: string) =>
    comoUsuario(db, user, async () => (await um<{ r: R }>(`select public.ia_consulta($1, $2::jsonb) r`, [chave, JSON.stringify({ de, ate })])).r);
  const total = (r: R, rotulo = "Total") => Number(r.resumo.find((x) => x.rotulo === rotulo)?.valor ?? 0);

  it("pessoal: o aluguel recebido não aparece de novo como receita", async () => {
    await comoUsuario(db, PESSOAL, async () => {
      const im = (await um<{ id: string }>(`insert into imoveis (codigo, finalidades, status) values ('P-IA','{locacao}','alugado') returning id`)).id;
      const ct = (
        await um<{ id: string }>(
          `insert into contratos (imovel_id, status, data_inicio, prazo_meses, data_fim, valor_aluguel, dia_vencimento, data_base_reajuste)
           values ($1, 'ativo', '2026-01-01', 30, '2028-06-30', 1000, 10, '2026-01-01') returning id`,
          [im],
        )
      ).id;
      const f = await novaFatura(ct, "2026-03-01", "2026-03-10", 1000);
      await db.query(`select public.registrar_recebimento($1::jsonb)`, [JSON.stringify({ pagamentos: [{ fatura_id: f, pago_em: "2026-03-08", valor: 1000, principal: 1000 }] })]);
      await db.query(
        `insert into lancamentos (tipo, descricao, categoria, valor, vencimento, status, liquidado_em, imovel_id) values
          ('receber', 'Multa por atraso avulsa', 'Multas', 300, '2026-03-12', 'liquidado', '2026-03-12', $1),
          ('pagar', 'IPTU', 'Impostos', 200, '2026-03-15', 'liquidado', '2026-03-15', $1)`,
        [im],
      );
    });
    const rec = await consulta(PESSOAL, "receitas", "2026-03-01", "2026-03-31");
    expect(total(rec)).toBe(300);
    expect(rec.linhas.map((l) => l[0])).toEqual(["Multas"]);
    const resumo = await consulta(PESSOAL, "resumo_financeiro", "2026-03-01", "2026-03-31");
    expect(total(resumo, "Aluguel recebido")).toBe(1000);
    expect(total(resumo, "Outras receitas")).toBe(total(rec));
    expect(total(resumo, "Despesas")).toBe(total(await consulta(PESSOAL, "despesas", "2026-03-01", "2026-03-31")));
  });

  it("imobiliária: despesas sem valores de terceiros nem as descontadas no repasse", async () => {
    await comoUsuario(db, ADMIN, () =>
      db.query(
        `insert into lancamentos (tipo, descricao, categoria, valor, vencimento, status, liquidado_em, imovel_id, terceiros, descontar_repasse) values
          ('pagar', 'Aluguel do escritório', 'Escritório', 300, '2026-04-05', 'liquidado', '2026-04-05', null, false, false),
          ('pagar', 'Condomínio do proprietário', 'Condomínio', 1000, '2026-04-08', 'liquidado', '2026-04-08', $1, true, false),
          ('pagar', 'Conserto (desconta do repasse)', 'Manutenção', 100, '2026-04-09', 'liquidado', '2026-04-09', $1, false, true),
          ('receber', 'Taxa de vistoria', 'Serviços', 150, '2026-04-20', 'liquidado', '2026-04-20', null, false, false)`,
        [id.imovel],
      ),
    );
    const desp = await consulta(ADMIN, "despesas", "2026-04-01", "2026-04-30");
    expect(total(desp)).toBe(300);
    const resumo = await consulta(ADMIN, "resumo_financeiro", "2026-04-01", "2026-04-30");
    expect(total(resumo, "Despesas")).toBe(300);
    expect(total(resumo, "Outras receitas")).toBe(total(await consulta(ADMIN, "receitas", "2026-04-01", "2026-04-30")));
  });
});

describe("preço por comparáveis, contratos em risco e inconsistências", () => {
  it("mediana do R$/m² dos parecidos do mesmo bairro", async () => {
    const r = await comoUsuario(db, ADMIN, async () => (await um<{ r: Record<string, unknown> }>(`select public.ia_preco_comparaveis($1, 'locacao') r`, [id.imovel])).r);
    // Comparáveis: 30, 32, 35, 40 R$/m² (o de 200 m² fica de fora) → mediana 33,50 × 60 m².
    expect(r).toMatchObject({ amostra: 4, nivel: "bairro", mediana_m2: 33.5, sugerido: 2010, valor_atual: 2000 });
    expect((r.comparaveis as unknown[]).length).toBe(4);
    const venda = await comoUsuario(db, ADMIN, async () => (await um<{ r: { amostra: number; erro: string } }>(`select public.ia_preco_comparaveis($1, 'venda') r`, [id.imovel])).r);
    expect(venda.erro).toMatch(/menos de 3/);
    expect(await comoUsuario(db, OUTRO, () => erroDe(() => db.query(`select public.ia_preco_comparaveis($1, 'locacao')`, [id.imovel])))).toMatch(/não encontrado/);
  });

  it("contrato perto do fim, com atraso e aviso de desocupação sobe a nota", async () => {
    const antes = await comoUsuario(db, ADMIN, () => um<{ nota: number; motivos: string[]; vago_base: string }>(`select nota, motivos, vago_base from public.ia_contratos_risco(60)`));
    // Fim em 20 dias (+40) e 1 aluguel em atraso (+10).
    expect(antes.nota).toBe(50);
    expect(antes.motivos).toEqual(["Termina em 20 dia(s)", "1 aluguel(éis) em atraso"]);
    expect(antes.vago_base).toBe("estimativa padrão (60 dias)");
    await comoUsuario(db, ADMIN, () => db.query(`insert into contrato_desocupacoes (contrato_id, motivo, aviso_em) values ($1, 'fim_prazo', $2)`, [id.contrato, HOJE]));
    expect((await comoUsuario(db, ADMIN, () => um<{ nota: number }>(`select nota from public.ia_contratos_risco(60)`))).nota).toBe(90);
    expect(await comoUsuario(db, OUTRO, () => todos(`select * from public.ia_contratos_risco(60)`))).toHaveLength(0);
  });

  it("lançamento repetido e sem categoria; conferir esconde; pessoal sem as regras de repasse", async () => {
    await comoUsuario(db, ADMIN, () =>
      db.query(
        `insert into lancamentos (tipo, descricao, categoria, valor, vencimento) values ('pagar','Luz','Energia',150,$1), ('pagar','Luz','Energia',150,$1), ('pagar','Material',null,80,$1)`,
        [HOJE],
      ),
    );
    const lista = await comoUsuario(db, FIN, () => todos<{ tipo: string; chave: string; conferido_em: string | null }>(`select tipo, chave, conferido_em from public.ia_inconsistencias()`));
    const tipos = lista.map((l) => l.tipo);
    expect(tipos).toContain("lancamento_duplicado");
    expect(tipos).toContain("lancamento_sem_categoria");
    const dup = lista.find((l) => l.tipo === "lancamento_duplicado")!;
    expect(await comoUsuario(db, CORRETOR, () => erroDe(() => db.query(`insert into ia_inconsistencias_conferidas (tipo, chave) values ($1, $2)`, [dup.tipo, dup.chave])))).toMatch(
      /row-level security/,
    );
    await comoUsuario(db, FIN, () => db.query(`insert into ia_inconsistencias_conferidas (tipo, chave, observacao) values ($1, $2, 'São duas contas de luz')`, [dup.tipo, dup.chave]));
    const depois = await comoUsuario(db, FIN, () => um<{ conferido_em: string | null; observacao: string }>(`select conferido_em, observacao from public.ia_inconsistencias() where chave = $1`, [dup.chave]));
    expect(depois.conferido_em).not.toBeNull();
    expect(depois.observacao).toBe("São duas contas de luz");
    // Auditoria da conferência.
    expect((await comoUsuario(db, ADMIN, () => todos(`select id from auditoria where tabela = 'ia_inconsistencias_conferidas'`))).length).toBe(1);
    expect(await comoUsuario(db, OUTRO, () => todos(`select * from public.ia_inconsistencias()`))).toHaveLength(0);
  });
});

describe("juntar cadastros e auditoria", () => {
  it("as ações sugeridas vão para o cadastro que fica", async () => {
    await comoUsuario(db, ADMIN, async () => {
      const dup = (await um<{ id: string }>(`insert into pessoas (nome, papeis, telefone) values ('Luís Inquilino 2','{locatario}','51999990000') returning id`)).id;
      const a = (
        await um<{ id: string }>(`insert into ia_acoes (tipo, titulo, payload, pessoa_id) values ('mensagem_cliente', 'Msg', $1::jsonb, $2) returning id`, [
          JSON.stringify({ canal: "whatsapp", texto: "Oi", pessoa_id: dup }),
          dup,
        ])
      ).id;
      await db.query(`select public.juntar_pessoas($1, $2)`, [id.loc, dup]);
      const r = await um<{ pessoa_id: string; payload: { pessoa_id: string } }>(`select pessoa_id, payload from ia_acoes where id = $1`, [a]);
      expect(r.pessoa_id).toBe(id.loc);
      expect(r.payload.pessoa_id).toBe(id.loc);
    });
  });

  it("configuração e regras auditadas; marcas de rodada não", async () => {
    const aud = await comoUsuario(db, ADMIN, () => todos<{ tabela: string; campos: string[] }>(`select tabela, campos from auditoria where tabela in ('ia_config','automacoes_regras')`));
    expect(aud.some((a) => a.tabela === "ia_config")).toBe(true);
    expect(aud.some((a) => a.tabela === "automacoes_regras")).toBe(true);
    expect(aud.some((a) => a.campos.includes("automacoes_em") || a.campos.includes("ultima_execucao_em"))).toBe(false);
  });
});
