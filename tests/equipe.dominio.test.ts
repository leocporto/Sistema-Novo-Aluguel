import { describe, expect, it } from "vitest";
import {
  MODULOS,
  agruparProdutividade,
  avisoParaMim,
  contarPorDestino,
  diferencasDoPadrao,
  dividirRodizio,
  escolherRegra,
  formatarCreci,
  formatarDuracao,
  lerLinhaProdutividade,
  linkInterno,
  linhasDoAlvo,
  mascararEmail,
  moduloDaRota,
  normalizarPermissoes,
  ordenarTarefas,
  periodoPorChave,
  permissoesEfetivas,
  permissoesPadrao,
  podeDecidirAprovacao,
  progressoOnboarding,
  prazoItemOnboarding,
  realizadoMeta,
  ritmoDoMes,
  rotaVisivel,
  situacaoValidade,
  somarProdutividade,
  taxaConversao,
  temPermissao,
  tempoMedioResposta,
  textoValidade,
  tituloRegistro,
  validarCreci,
  valorAuditoria,
  type LinhaProdutividade,
} from "@/lib/dominio/equipe";
import { dataLocal, formatarDataLocal } from "@/lib/dominio/datas";

describe("permissões", () => {
  it("normaliza: só módulos/operações conhecidos, na ordem, e 'ver' entra sozinho", () => {
    const n = normalizarPermissoes({ imoveis: ["excluir", "x"], financeiro: ["aprovar", "ver"], lixo: ["ver"], painel: "ver" });
    expect(n.imoveis).toEqual(["ver", "excluir"]);
    expect(n.financeiro).toEqual(["ver", "aprovar"]);
    expect(n.painel).toEqual([]);
    expect(Object.keys(n)).toHaveLength(MODULOS.length);
    expect(normalizarPermissoes(null).equipe).toEqual([]);
  });

  it("o padrão mantém o que cada papel já via (tudo menos o histórico de ações)", () => {
    for (const papel of ["gestor", "financeiro", "corretor"]) {
      const p = permissoesPadrao(papel);
      for (const m of MODULOS) expect(temPermissao(p, m.id, "ver")).toBe(m.id !== "auditoria" || papel === "gestor");
    }
    expect(temPermissao(permissoesPadrao("corretor"), "financeiro", "criar")).toBe(false);
    expect(temPermissao(permissoesPadrao("corretor"), "comercial", "excluir")).toBe(true);
    expect(temPermissao(permissoesPadrao("financeiro"), "repasses", "aprovar")).toBe(true);
    expect(temPermissao(permissoesPadrao("financeiro"), "comercial", "criar")).toBe(false);
    expect(permissoesPadrao("desconhecido").painel).toEqual([]);
  });

  it("admin sempre tudo; perfil próprio substitui o padrão", () => {
    expect(temPermissao(permissoesEfetivas("admin", { painel: [] }), "auditoria", "ver")).toBe(true);
    const p = permissoesEfetivas("corretor", { imoveis: ["ver"] });
    expect(temPermissao(p, "imoveis", "ver")).toBe(true);
    expect(temPermissao(p, "comercial", "ver")).toBe(false);
    expect(temPermissao(permissoesEfetivas("corretor", null), "comercial", "ver")).toBe(true);
  });

  it("diferenças do padrão", () => {
    const d = diferencasDoPadrao("corretor", { ...permissoesPadrao("corretor"), financeiro: ["ver", "criar"], comercial: ["ver"] });
    expect(d).toEqual([
      { modulo: "comercial", mais: [], menos: ["criar", "editar", "excluir"] },
      { modulo: "financeiro", mais: ["criar"], menos: [] },
    ]);
  });

  it("rota → módulo (o mais específico)", () => {
    expect(moduloDaRota("/")).toBe("painel");
    expect(moduloDaRota("/imoveis/123/fotos")).toBe("imoveis");
    expect(moduloDaRota("/despesas")).toBe("financeiro");
    expect(moduloDaRota("/equipe")).toBe("equipe");
    expect(moduloDaRota("/equipe/metas?mes=2026-11")).toBe("equipe");
    expect(moduloDaRota("/equipe/aprovacoes/regras")).toBe("aprovacoes");
    expect(moduloDaRota("/equipe/historico")).toBe("auditoria");
    expect(moduloDaRota("/regua")).toBe("cobrancas");
    expect(moduloDaRota("/chaves/1")).toBe("agenda");
    expect(moduloDaRota("/comercialx")).toBeNull();
    expect(moduloDaRota("/login")).toBeNull();
  });
});

describe("CRECI e documentos", () => {
  it("situação da validade com aviso antecipado", () => {
    expect(situacaoValidade(null, "2026-11-04")).toEqual({ situacao: "sem_data", dias: null });
    expect(situacaoValidade("2026-11-03", "2026-11-04")).toEqual({ situacao: "vencido", dias: -1 });
    expect(situacaoValidade("2026-12-01", "2026-11-04", 30)).toEqual({ situacao: "vencendo", dias: 27 });
    expect(situacaoValidade("2027-01-10", "2026-11-04", 60).situacao).toBe("em_dia");
    expect(textoValidade(-1)).toBe("venceu ontem");
    expect(textoValidade(-5)).toBe("venceu há 5 dias");
    expect(textoValidade(0)).toBe("vence hoje");
    expect(textoValidade(12)).toBe("vence em 12 dias");
  });

  it("valida e formata o CRECI", () => {
    expect(validarCreci("", "")).toBeNull();
    expect(validarCreci("12345-F", "sp")).toBeNull();
    expect(validarCreci("abc", "SP")).toContain("número");
    expect(validarCreci("123", "XX")).toContain("UF");
    expect(formatarCreci("12345-F", "sp")).toBe("CRECI 12345-F/SP");
    expect(formatarCreci(null, "SP")).toBe("—");
  });

  it("mascara e-mail", () => {
    expect(mascararEmail("nina@x.com")).toBe("ni**@x.com");
    expect(mascararEmail("ab@x.com")).toBe("a*@x.com");
    expect(mascararEmail("sem-arroba")).toBe("sem-arroba");
  });
});

const linha = (p: Partial<LinhaProdutividade>): LinhaProdutividade =>
  lerLinhaProdutividade({ pessoa_id: "p", nome: "P", user_id: null, equipe_id: null, filial_id: null, ...p } as Record<string, unknown>);

describe("produtividade e metas", () => {
  const linhas = [
    linha({ pessoa_id: "a", nome: "Ana", equipe_id: "e1", filial_id: "f1", leads_atendidos: 4, resposta_soma_min: 120, resposta_qtd: 4, vendas: 1, valor_vendas: 500000.5, propostas: 4, propostas_aceitas: 1 }),
    linha({ pessoa_id: "b", nome: "Bia", equipe_id: "e1", filial_id: "f1", leads_atendidos: 2, resposta_soma_min: 300, resposta_qtd: 1, locacoes: 2, propostas: 2, propostas_aceitas: 2 }),
    linha({ pessoa_id: "c", nome: "Caio", leads_recebidos: 3 }),
  ];

  it("lê números vindos como texto e soma", () => {
    expect(lerLinhaProdutividade({ pessoa_id: "x", nome: "X", valor_vendas: "10.50", visitas: "3" }).valor_vendas).toBe(10.5);
    const t = somarProdutividade(linhas);
    expect(t.leads_atendidos).toBe(6);
    expect(t.valor_vendas).toBe(500000.5);
    expect(tempoMedioResposta(t)).toBe(84);
    expect(taxaConversao(t)).toBe(50);
    expect(taxaConversao(somarProdutividade([]))).toBeNull();
  });

  it("agrupa por equipe e filial, com 'sem equipe' por último", () => {
    const g = agruparProdutividade(linhas, "equipe", { equipes: new Map([["e1", "Vendas"]]) });
    expect(g.map((x) => [x.nome, x.pessoas])).toEqual([
      ["Vendas", 2],
      ["Sem equipe", 1],
    ]);
    expect(agruparProdutividade(linhas, "filial").map((x) => x.nome)).toEqual(["Filial", "Sem filial"]);
    expect(agruparProdutividade(linhas, "pessoa")[0].nome).toBe("Ana");
  });

  it("realizado da meta por pessoa, equipe ou filial", () => {
    const t = somarProdutividade(linhasDoAlvo(linhas, "equipe", "e1"));
    expect(realizadoMeta("locacoes", t)).toBe(2);
    expect(realizadoMeta("valor_vendas", t)).toBe(500000.5);
    expect(realizadoMeta("leads", somarProdutividade(linhasDoAlvo(linhas, "pessoa", "c")))).toBe(3);
    expect(linhasDoAlvo(linhas, "filial", "f1")).toHaveLength(2);
  });

  it("ritmo do mês e duração", () => {
    expect(ritmoDoMes("2026-11-01", "2026-11-15")).toBe(50);
    expect(ritmoDoMes("2026-10-01", "2026-11-15")).toBe(100);
    expect(ritmoDoMes("2026-12-01", "2026-11-15")).toBe(0);
    expect(formatarDuracao(null)).toBe("—");
    expect(formatarDuracao(45)).toBe("45 min");
    expect(formatarDuracao(135)).toBe("2 h 15 min");
    expect(formatarDuracao(120)).toBe("2 h");
    expect(formatarDuracao(4320)).toBe("3 dias");
  });

  it("períodos dos filtros", () => {
    expect(periodoPorChave("mes", "2026-11-04")).toMatchObject({ inicio: "2026-11-01", fim: "2026-11-04" });
    expect(periodoPorChave("mes_passado", "2026-01-10")).toMatchObject({ inicio: "2025-12-01", fim: "2025-12-31" });
    expect(periodoPorChave("90d", "2026-11-04").inicio).toBe("2026-08-07");
    expect(periodoPorChave("ano", "2026-11-04").inicio).toBe("2026-01-01");
  });
});

describe("distribuição por rodízio", () => {
  it("quem tem menos carga recebe primeiro; empate segue a ordem", () => {
    const m = dividirRodizio(["1", "2", "3", "4", "5"], ["bia", "caio"], { bia: 2, caio: 0 });
    expect([...m.values()]).toEqual(["caio", "caio", "bia", "caio", "bia"]);
    expect(contarPorDestino(m)).toEqual({ caio: 3, bia: 2 });
    expect(dividirRodizio(["1"], []).size).toBe(0);
  });
});

describe("aprovações", () => {
  const regras = [
    { id: "r1", tipo: "despesa", valor_minimo: 0, ativa: true },
    { id: "r2", tipo: "despesa", valor_minimo: 5000, ativa: true },
    { id: "r3", tipo: "qualquer", valor_minimo: 10000, ativa: true },
    { id: "r4", tipo: "despesa", valor_minimo: 1000, ativa: false },
  ];
  it("escolhe a regra do tipo com maior valor mínimo alcançado (igual ao banco)", () => {
    expect(escolherRegra(regras, "despesa", 300)?.id).toBe("r1");
    expect(escolherRegra(regras, "despesa", 8000)?.id).toBe("r2");
    expect(escolherRegra(regras, "despesa", 20000)?.id).toBe("r2");
    expect(escolherRegra(regras, "ferias", 20000)?.id).toBe("r3");
    expect(escolherRegra(regras, "ferias", null)).toBeNull();
  });

  it("quem pode decidir", () => {
    const a = { aprovador_id: null, aprovador_papel: "financeiro", aprovador_perfil_id: null, solicitante_id: "u1" };
    const u = (userId: string, papel: string, podeAprovar = true, perfilEfetivo: string | null = null) => ({ userId, papel, podeAprovar, perfilEfetivo });
    expect(podeDecidirAprovacao(a, u("u2", "financeiro"))).toBe(true);
    expect(podeDecidirAprovacao(a, u("u2", "gestor"))).toBe(true);
    expect(podeDecidirAprovacao(a, u("u2", "corretor"))).toBe(false);
    expect(podeDecidirAprovacao(a, u("u1", "financeiro"))).toBe(false);
    expect(podeDecidirAprovacao(a, u("u1", "admin"))).toBe(true);
    expect(podeDecidirAprovacao(a, u("u2", "financeiro", false))).toBe(false);
    expect(podeDecidirAprovacao({ ...a, aprovador_papel: null, aprovador_id: "u3" }, u("u2", "gestor"))).toBe(false);
    expect(podeDecidirAprovacao({ ...a, aprovador_papel: null, aprovador_perfil_id: "pf" }, u("u2", "corretor", true, "pf"))).toBe(true);
    expect(podeDecidirAprovacao({ ...a, aprovador_papel: null }, u("u2", "gestor"))).toBe(true);
  });
});

describe("tarefas, onboarding, avisos e histórico", () => {
  it("ordena tarefas: abertas, atrasadas, prioridade e prazo", () => {
    const t = ordenarTarefas(
      [
        { id: "1", status: "concluida", prioridade: "urgente", prazo: "2026-01-01" },
        { id: "2", status: "a_fazer", prioridade: "baixa", prazo: "2026-11-01" },
        { id: "3", status: "a_fazer", prioridade: "urgente", prazo: "2026-12-01" },
        { id: "4", status: "em_andamento", prioridade: "normal", prazo: null },
      ],
      "2026-11-04",
    );
    expect(t.map((x) => x.id)).toEqual(["2", "3", "4", "1"]);
  });

  it("onboarding: prazo e progresso", () => {
    expect(prazoItemOnboarding("2026-11-02", 7)).toBe("2026-11-09");
    expect(prazoItemOnboarding("2026-11-02", null)).toBe("2026-11-02");
    expect(
      progressoOnboarding(
        [
          { concluido_em: "2026-11-03T10:00:00Z", prazo: "2026-11-03" },
          { concluido_em: null, prazo: "2026-11-01" },
          { concluido_em: null, prazo: null },
          { concluido_em: null, prazo: "2026-12-01" },
        ],
        "2026-11-04",
      ),
    ).toEqual({ feitos: 1, total: 4, pct: 25, atrasados: 1 });
    expect(progressoOnboarding([], "2026-11-04").pct).toBe(0);
  });

  it("aviso para mim", () => {
    const eu = { papel: "corretor", equipeId: "e1", filialId: "f1" };
    const base = { para: "todos", equipe_id: null, filial_id: null, papel: null, expira_em: null };
    expect(avisoParaMim(base, eu, "2026-11-04")).toBe(true);
    expect(avisoParaMim({ ...base, expira_em: "2026-11-03" }, eu, "2026-11-04")).toBe(false);
    expect(avisoParaMim({ ...base, para: "equipe", equipe_id: "e2" }, eu, "2026-11-04")).toBe(false);
    expect(avisoParaMim({ ...base, para: "filial", filial_id: "f1" }, eu, "2026-11-04")).toBe(true);
    expect(avisoParaMim({ ...base, para: "papel", papel: "financeiro" }, eu, "2026-11-04")).toBe(false);
  });

  it("valores e títulos do histórico", () => {
    expect(valorAuditoria(null)).toBe("vazio");
    expect(valorAuditoria(true)).toBe("sim");
    expect(valorAuditoria("2026-11-04")).toBe("04/11/2026");
    expect(valorAuditoria(["a", "b"])).toBe("a, b");
    expect(valorAuditoria("x".repeat(200))).toHaveLength(118);
    expect(tituloRegistro({ codigo: "AP-1", logradouro: "Rua" })).toBe("AP-1");
    expect(tituloRegistro({ nome: "  ", email: "a@b.com" })).toBe("a@b.com");
    expect(tituloRegistro(null)).toBeNull();
  });
});

describe("links e datas das telas da equipe", () => {
  it("link da solicitação: só tela do sistema", () => {
    expect(linkInterno("/faturas/1")).toBe("/faturas/1");
    expect(linkInterno("  /repasses  ")).toBe("/repasses");
    expect(linkInterno("https://golpe.com")).toBeNull();
    expect(linkInterno("//golpe.com")).toBeNull();
    expect(linkInterno("/\\golpe.com")).toBeNull();
    expect(linkInterno("javascript:alert(1)")).toBeNull();
    expect(linkInterno("/a b")).toBeNull();
    expect(linkInterno(null)).toBeNull();
  });

  it("data de um instante no fuso de Brasília (não em UTC)", () => {
    // 22h30 de 03/11 em Brasília = 01h30 de 04/11 em UTC.
    expect(dataLocal("2026-11-04T01:30:00Z")).toBe("2026-11-03");
    expect(dataLocal("2026-11-04T01:30:00+00:00")).toBe("2026-11-03");
    expect(dataLocal("2026-11-04T12:00:00-03:00")).toBe("2026-11-04");
    expect(dataLocal("2026-11-04")).toBe("2026-11-04");
    expect(dataLocal(null)).toBeNull();
    expect(dataLocal("lixo")).toBeNull();
    expect(formatarDataLocal("2026-11-04T01:30:00Z")).toBe("03/11/2026");
    expect(formatarDataLocal(null)).toBe("—");
  });
});

describe("menu e telas pelo perfil (para a casca)", () => {
  it("rota some do menu sem 'ver' no módulo; Painel e rotas sem módulo ficam", () => {
    const perms = normalizarPermissoes({ imoveis: ["ver"], equipe: ["ver"] });
    expect(rotaVisivel("/imoveis/123", perms)).toBe(true);
    expect(rotaVisivel("/financeiro", perms)).toBe(false);
    expect(rotaVisivel("/equipe/historico", perms)).toBe(false);
    expect(rotaVisivel("/equipe/tarefas", perms)).toBe(true);
    expect(rotaVisivel("/", perms)).toBe(true);
    expect(rotaVisivel("/ajuda", perms)).toBe(true);
  });
});
