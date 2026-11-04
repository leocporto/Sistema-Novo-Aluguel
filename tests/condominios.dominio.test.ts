import { describe, expect, it } from "vitest";
import {
  apurarItem,
  baseDoOrcamento,
  calcularCotas,
  celulaCsvCond,
  comunicadoParaUnidade,
  conferirFracoes,
  conflitaReserva,
  contratoNoMes,
  expandirNumeros,
  mensagemCobranca,
  parcelaDoRateio,
  parcelasAcordo,
  pesoDoCriterio,
  previstoRealizado,
  quorum,
  ratearPorCriterio,
  resumoCotasMes,
  saidaFundoValida,
  saldosContas,
  situacaoCota,
  situacaoValidade,
  textoAta,
  textoEdital,
  validarReserva,
  type ItemPauta,
} from "@/lib/dominio/condominios";

const U = [
  { id: "a", fracao: 0.25, area: 70 },
  { id: "b", fracao: 0.25, area: 70 },
  { id: "c", fracao: 0.3, area: 84 },
  { id: "d", fracao: 0.2, area: 56 },
];

describe("unidades e frações", () => {
  it("lê números em lote", () => {
    expect(expandirNumeros("101-103, 201; 301 a 302")).toEqual(["101", "102", "103", "201", "301", "302"]);
    expect(expandirNumeros("01-03")).toEqual(["01", "02", "03"]);
    expect(expandirNumeros("Loja 1, Loja 1")).toEqual(["Loja 1"]);
    expect(() => expandirNumeros("10-1")).toThrow(/Intervalo/);
  });

  it("confere a soma das frações (1 ou 100%)", () => {
    expect(conferirFracoes([0.25, 0.25, 0.3, 0.2])).toMatchObject({ ok: true, escala: "unitaria", semFracao: 0 });
    expect(conferirFracoes([25, 25, 30, 20])).toMatchObject({ ok: true, escala: "percentual" });
    expect(conferirFracoes([0.25, 0.25, 0.3, 0.199999]).ok).toBe(true);
    const falta = conferirFracoes([0.25, 0.25, 0.3, 0.19]);
    expect(falta.ok).toBe(false);
    expect(falta.diferenca).toBeCloseTo(0.01, 6);
    expect(conferirFracoes([0.5, null, 0.5])).toMatchObject({ ok: false, semFracao: 1 });
    expect(conferirFracoes([]).ok).toBe(false);
  });

  it("peso por critério em inteiros", () => {
    expect(pesoDoCriterio({ id: "x", fracao: 0.123456 }, "fracao")).toBe(123456);
    expect(pesoDoCriterio({ id: "x", area: 70.25 }, "area")).toBe(7025);
    expect(pesoDoCriterio({ id: "x" }, "igual")).toBe(1);
  });
});

describe("rateio e cotas", () => {
  it("rateia sem perder centavo e recusa unidade sem fração", () => {
    const m = ratearPorCriterio(100001, U, "fracao");
    expect([...m.values()].reduce((a, b) => a + b, 0)).toBe(100001);
    expect(m.get("c")).toBe(30001);
    expect(() => ratearPorCriterio(100, [...U, { id: "e", fracao: 0 }], "fracao")).toThrow(/fração/);
    const igual = ratearPorCriterio(10, U, "igual");
    expect([...igual.values()]).toEqual([3, 3, 2, 2]);
  });

  it("parcelas do rateio extra (sobra nas primeiras) só dentro do prazo", () => {
    const r = { id: "r", descricao: "Obra", valorTotal: 100000, parcelas: 3, primeiraCompetencia: "2026-01-01", criterio: "igual" as const };
    expect(parcelaDoRateio(r, "2026-01-01")).toEqual({ k: 1, valor: 33334 });
    expect(parcelaDoRateio(r, "2026-03-01")).toEqual({ k: 3, valor: 33333 });
    expect(parcelaDoRateio(r, "2026-04-01")).toBeNull();
    expect(parcelaDoRateio(r, "2025-12-01")).toBeNull();
    expect(parcelaDoRateio({ ...r, ativo: false }, "2026-01-01")).toBeNull();
  });

  it("monta a cota: ordinária + fundo + rateio + consumo + reserva do mês anterior", () => {
    const cotas = calcularCotas({
      competencia: "2026-02-01",
      unidades: U,
      criterio: "fracao",
      base: 140001,
      fundoReservaPct: 10,
      rateios: [{ id: "r", descricao: "Pintura", valorTotal: 1000, parcelas: 1, primeiraCompetencia: "2026-02-01", criterio: "igual" }],
      consumos: [{ id: "k", unidadeId: "a", tipo: "agua", valor: 4567 }],
      reservas: [
        { id: "s1", unidadeId: "b", area: "Salão", data: "2026-01-20", valor: 8000 },
        { id: "s2", unidadeId: "b", area: "Salão", data: "2026-02-05", valor: 8000 },
      ],
    });
    expect(cotas.reduce((a, c) => a + c.itens.filter((i) => i.tipo === "ordinaria").reduce((s, i) => s + i.valor, 0), 0)).toBe(140001);
    const a = cotas.find((c) => c.unidadeId === "a")!;
    expect(a.itens.map((i) => i.tipo)).toEqual(["ordinaria", "fundo_reserva", "rateio_extra", "consumo"]);
    expect(a.itens[1].valor).toBe(Math.round(a.itens[0].valor * 0.1));
    const b = cotas.find((c) => c.unidadeId === "b")!;
    expect(b.itens.filter((i) => i.tipo === "reserva_area")).toHaveLength(1);
    expect(b.total).toBe(b.itens.reduce((s, i) => s + i.valor, 0));
    expect(() => calcularCotas({ competencia: "2026-02-01", unidades: U, criterio: "fracao", base: 0, fundoReservaPct: 0 })).toThrow(/total/);
  });

  it("base pelo orçamento: despesas menos outras receitas", () => {
    expect(baseDoOrcamento([{ tipo: "despesa", valor_mensal: 1000 }, { tipo: "despesa", valor_mensal: "500.01" }, { tipo: "receita", valor_mensal: 100 }])).toBe(140001);
  });
});

describe("atraso, acordo e cobrança", () => {
  it("multa uma vez e juros pro rata (mesma conta das cobranças)", () => {
    const s = situacaoCota({ valor: 50000, vencimento: "2026-01-10" }, [], { multaPct: 2, jurosMesPct: 1 }, "2026-02-09");
    expect(s.multa).toBe(1000);
    expect(s.juros).toBe(500);
    expect(s.totalComEncargos).toBe(51500);
    const depois = situacaoCota(
      { valor: 50000, vencimento: "2026-01-10" },
      [{ data: "2026-01-25", valor: 21000, principal: 20000, multa: 1000, juros: 0, desconto: 0 }],
      { multaPct: 2, jurosMesPct: 1 },
      "2026-02-24",
    );
    expect(depois.multa).toBe(0);
    expect(depois.juros).toBe(300);
  });

  it("parcelas do acordo somam o total", () => {
    const p = parcelasAcordo(100001, 3);
    expect(p).toEqual([33334, 33334, 33333]);
    expect(() => parcelasAcordo(100, 0)).toThrow();
  });

  it("mensagem de cobrança pronta", () => {
    const m = mensagemCobranca({ nome: "Bia Souza", condominio: "Ed. Sol", unidade: "A - 102", competencias: ["01/2026", "02/2026"], corrigido: 1234.5, organizacao: "Imob" });
    expect(m).toContain("Olá, Bia!");
    expect(m).toContain("as cotas de 01/2026, 02/2026");
    expect(m).toMatch(/R\$\s1\.234,50/);
  });
});

describe("livro-caixa, fundo e orçamento", () => {
  it("saldo por conta com transferência; só o que foi pago conta", () => {
    const s = saldosContas(
      [
        { id: "cc", saldoInicial: 10000 },
        { id: "fr", saldoInicial: 0 },
      ],
      [
        { tipo: "receita", valor: 5000, status: "pago", conta_id: "cc" },
        { tipo: "despesa", valor: 2000, status: "pago", conta_id: "cc" },
        { tipo: "despesa", valor: 9999, status: "aberto", conta_id: "cc" },
        { tipo: "transferencia", valor: 1000, status: "pago", conta_id: "cc", conta_destino_id: "fr" },
      ],
    );
    expect(s.get("cc")).toBe(12000);
    expect(s.get("fr")).toBe(1000);
  });

  it("saída do fundo só com aprovação e por admin/gestor", () => {
    expect(saidaFundoValida({ papel: "admin" })).toMatch(/aprovação/);
    expect(saidaFundoValida({ papel: "financeiro", aprovacao: "AGE 10/02" })).toMatch(/Só administradores/);
    expect(saidaFundoValida({ papel: "gestor", assembleiaId: "x" })).toBeNull();
  });

  it("previsto × realizado até o mês", () => {
    const l = previstoRealizado(
      [
        { categoria: "Limpeza", tipo: "despesa", mensal: 1000 },
        { categoria: "Energia", tipo: "despesa", mensal: 500 },
      ],
      [
        { categoria: "Limpeza", tipo: "despesa", mes: 1, valor: 900 },
        { categoria: "Limpeza", tipo: "despesa", mes: 2, valor: 1200 },
        { categoria: "Obras", tipo: "despesa", mes: 2, valor: 300 },
      ],
      2,
    );
    const limp = l.find((x) => x.categoria === "Limpeza")!;
    expect(limp).toMatchObject({ previstoAte: 200000, realizadoAte: 210000, diferenca: 10000, pct: 105 });
    expect(l.find((x) => x.categoria === "Obras")!.pct).toBeNull();
    expect(l[0].categoria).toBe("Limpeza");
  });
});

describe("fornecedores, validade e reservas", () => {
  it("contrato gera despesa conforme a periodicidade e a vigência", () => {
    const tri = { periodicidade: "trimestral" as const, inicio: "2026-01-15" };
    expect(["2026-01-01", "2026-02-01", "2026-04-01", "2026-07-01"].map((m) => contratoNoMes(tri, m))).toEqual([true, false, true, true]);
    expect(contratoNoMes({ periodicidade: "unico", inicio: "2026-03-01" }, "2026-03-01")).toBe(true);
    expect(contratoNoMes({ periodicidade: "unico", inicio: "2026-03-01" }, "2026-04-01")).toBe(false);
    expect(contratoNoMes({ periodicidade: "mensal", inicio: "2026-01-01", fim: "2026-02-28" }, "2026-03-01")).toBe(false);
    expect(contratoNoMes({ periodicidade: "mensal", inicio: "2026-05-01" }, "2026-04-01")).toBe(false);
  });

  it("validade: vencido, vence em breve, ok", () => {
    expect(situacaoValidade("2026-01-01", "2026-02-01").situacao).toBe("vencido");
    expect(situacaoValidade("2026-03-01", "2026-02-01").situacao).toBe("vence");
    expect(situacaoValidade("2027-03-01", "2026-02-01").situacao).toBe("ok");
    expect(situacaoValidade(null, "2026-02-01").situacao).toBeNull();
  });

  it("regras da reserva e conflito de horário", () => {
    const area = { antecedencia_min_horas: 24, antecedencia_max_dias: 30, duracao_max_horas: 6 };
    const agora = Date.UTC(2026, 0, 1, 12);
    const h = 3_600_000;
    expect(validarReserva(area, agora + 48 * h, agora + 52 * h, agora)).toBeNull();
    expect(validarReserva(area, agora + 2 * h, agora + 4 * h, agora)).toMatch(/antecedência/);
    expect(validarReserva(area, agora + 48 * h, agora + 56 * h, agora)).toMatch(/no máximo 6/);
    expect(validarReserva(area, agora + 40 * 24 * h, agora + 40 * 24 * h + h, agora)).toMatch(/30 dias/);
    const lista = [{ inicio: 10, fim: 20, status: "confirmada" }, { inicio: 30, fim: 40, status: "cancelada" }];
    expect(conflitaReserva(lista, 15, 25)).toBe(true);
    expect(conflitaReserva(lista, 20, 25)).toBe(false);
    expect(conflitaReserva(lista, 32, 35)).toBe(false);
  });
});

describe("assembleias", () => {
  const unidades = [
    { id: "a", fracao: 0.25 },
    { id: "b", fracao: 0.25 },
    { id: "c", fracao: 0.3 },
    { id: "d", fracao: 0.2 },
  ];
  const item = (tipo: ItemPauta["tipo_votacao"], opcoes = ["Sim", "Não", "Abstenção"]): ItemPauta => ({ id: "i", ordem: 1, titulo: "Pintura", tipo_votacao: tipo, opcoes });

  it("quórum por unidade e por fração", () => {
    const q = quorum(unidades, ["a", "c"], "fracao");
    expect(q).toMatchObject({ presentes: 2, unidades: 4, pctUnidades: 50, pctPeso: 55 });
    expect(quorum(unidades, ["a"], "unidade").pesoPresente).toBe(1);
  });

  it("apura maioria simples, 2/3, unanimidade, informativo e opções livres", () => {
    const votos = [
      { opcao: "Sim", peso: 0.25 },
      { opcao: "Sim", peso: 0.3 },
      { opcao: "Não", peso: 0.2 },
      { opcao: "Abstenção", peso: 0.25 },
    ];
    expect(apurarItem(item("simples"), votos, 1).aprovado).toBe(true);
    expect(apurarItem(item("dois_tercos"), votos, 1).aprovado).toBe(false);
    expect(apurarItem(item("dois_tercos"), [...votos.slice(0, 2), { opcao: "Sim", peso: 0.2 }], 1).aprovado).toBe(true);
    expect(apurarItem(item("unanimidade"), votos, 1).aprovado).toBe(false);
    expect(apurarItem(item("informativo", []), [], 1).aprovado).toBeNull();
    const livre = apurarItem(item("simples", ["Empresa A", "Empresa B"]), [{ opcao: "Empresa B", peso: 0.3 }, { opcao: "Empresa A", peso: 0.25 }], 1);
    expect(livre.vencedora).toBe("Empresa B");
  });

  it("edital e ata prontos para editar", () => {
    const ed = textoEdital({ condominio: "Ed. Sol", tipo: "extraordinaria", data: "2026-03-10T22:00:00Z", local: "Salão", itens: [{ ordem: 1, titulo: "Pintura da fachada" }], sindico: "Caio" });
    expect(ed).toContain("EXTRAORDINÁRIA");
    expect(ed).toContain("1. Pintura da fachada");
    expect(ed).toContain("10/03/2026");
    const it = item("simples");
    const ap = apurarItem(it, [{ opcao: "Sim", peso: 0.55 }], 1);
    const ata = textoAta({ condominio: "Ed. Sol", tipo: "ordinaria", data: "2026-03-10T22:00:00Z", quorum: quorum(unidades, ["a", "c"], "fracao"), peso: "fracao", itens: [it], apuracao: [ap], presentes: ["A-101"] });
    expect(ata).toContain("Resultado: Aprovado");
    expect(ata).toContain("2 de 4 unidades");
  });
});

describe("comunicados", () => {
  it("público: todos, bloco ou unidades", () => {
    expect(comunicadoParaUnidade({ publico: "todos" }, { id: "u" })).toBe(true);
    expect(comunicadoParaUnidade({ publico: "bloco", bloco_id: "A" }, { id: "u", bloco_id: "A" })).toBe(true);
    expect(comunicadoParaUnidade({ publico: "bloco", bloco_id: "A" }, { id: "u", bloco_id: "B" })).toBe(false);
    expect(comunicadoParaUnidade({ publico: "unidades", unidades: ["u"] }, { id: "u" })).toBe(true);
  });
});

describe("resumo das cotas do mês", () => {
  it("emitido sem as renegociadas; recebido = dinheiro que entrou; em aberto = saldo das abertas; desconto à parte", () => {
    const r = resumoCotasMes(
      [
        { id: "a", status: "paga", valor: 100000, abatido: 100000 },
        { id: "b", status: "aberta", valor: 100000, abatido: 30000 },
        { id: "c", status: "renegociada", valor: 100000, abatido: 0 },
        { id: "d", status: "paga", valor: 50000, abatido: 50000 },
      ],
      [
        { cotaId: "a", valor: 102000, principal: 100000, multa: 2000, juros: 0, desconto: 0 },
        { cotaId: "b", valor: 30000, principal: 30000, multa: 0, juros: 0, desconto: 0 },
        { cotaId: "d", valor: 45000, principal: 45000, multa: 0, juros: 0, desconto: 5000 },
        { cotaId: "outra", valor: 99999, principal: 99999, multa: 0, juros: 0, desconto: 0 },
      ],
    );
    expect(r).toMatchObject({ emitido: 250000, emitidas: 3, pagas: 2, recebido: 177000, encargos: 2000, desconto: 5000, emAberto: 70000, abertas: 1, renegociadas: 1, valorRenegociado: 100000 });
  });
});

describe("CSV dos relatórios", () => {
  it("texto que viraria fórmula ganha apóstrofo; valores do sistema ficam como estão", () => {
    expect(celulaCsvCond("=HYPERLINK(\"http://x\")")).toBe(`"'=HYPERLINK(""http://x"")"`);
    expect(celulaCsvCond("+5511999")).toBe("'+5511999");
    expect(celulaCsvCond("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(celulaCsvCond("-2+3")).toBe("'-2+3");
    expect(celulaCsvCond("Limpeza; jardim")).toBe('"Limpeza; jardim"');
    expect(celulaCsvCond("-R$\u00a01.234,50")).toBe("-R$\u00a01.234,50");
    expect(celulaCsvCond("-12,5%")).toBe("-12,5%");
    expect(celulaCsvCond("R$ 10,00")).toBe("R$ 10,00");
    expect(celulaCsvCond(null)).toBe("");
  });
});
