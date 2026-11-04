import { describe, expect, it } from "vitest";
import {
  colunasDoResultado,
  colunasPadrao,
  descreverAgenda,
  entradasPrevistas,
  etapasFunil,
  fontesDoModo,
  fontesPermitidas,
  formatarDias,
  formatarPct,
  formatarVariacao,
  inadimplencia,
  lerData,
  lerLinhaFinanceira,
  lerPeriodo,
  mediaDias,
  mesesEntreDatas,
  moduloDaFonte,
  nomeAbaExcel,
  nomeArquivo,
  normalizarNumeroFiltro,
  periodoAnterior,
  periodoRelativo,
  permissoesBi,
  proximaExecucao,
  queryPeriodo,
  reajustesAte,
  receitaImobiliaria,
  refVizinha,
  rendimentoAnual,
  resultadoFinanceiro,
  saldoPrevisto,
  separarDestinatarios,
  somarFinanceiro,
  tabelaDoResultado,
  tabelaParaCSV,
  tabelaParaXLS,
  taxa,
  taxaOcupacao,
  tomVariacao,
  validarDefinicao,
  valorReajustado,
  acumuladoIndices,
  variacao,
  type LinhaPrevisao,
  type TabelaRelatorio,
} from "@/lib/dominio/bi";
import { permissoesTotais } from "@/lib/dominio/equipe";

describe("período", () => {
  const hoje = "2026-11-04";

  it("sem nada na URL: o mês atual, comparado com o mesmo ponto do mês passado", () => {
    const p = lerPeriodo({}, hoje);
    expect([p.tipo, p.inicio, p.fim, p.rotulo]).toEqual(["mes", "2026-11-01", "2026-11-30", "novembro de 2026"]);
    expect([p.anterior.inicio, p.anterior.fim]).toEqual(["2026-10-01", "2026-10-04"]);
    expect(p.anterior.rotulo).toBe("outubro de 2026 até 04/10");
  });

  it("mês fechado compara com o mês anterior inteiro (inclusive fevereiro)", () => {
    const p = lerPeriodo({ p: "mes", ref: "2026-03" }, hoje);
    expect([p.inicio, p.fim, p.anterior.inicio, p.anterior.fim]).toEqual(["2026-03-01", "2026-03-31", "2026-02-01", "2026-02-28"]);
  });

  it("dia 31 em andamento: o mês anterior para no último dia dele", () => {
    const p = lerPeriodo({ p: "mes" }, "2026-03-31");
    expect(p.anterior.fim).toBe("2026-02-28");
    const q = lerPeriodo({ p: "mes" }, "2026-05-31");
    // Último dia do mês = período completo: compara com o mês anterior inteiro.
    expect(q.anterior.fim).toBe("2026-04-30");
  });

  it("trimestre e ano", () => {
    const t = lerPeriodo({ p: "tri", ref: "2026-T2" }, hoje);
    expect([t.inicio, t.fim, t.rotulo, t.anterior.inicio, t.anterior.fim]).toEqual(["2026-04-01", "2026-06-30", "2º trimestre de 2026", "2026-01-01", "2026-03-31"]);
    const tAtual = lerPeriodo({ p: "tri" }, hoje);
    expect([tAtual.ref, tAtual.anterior.inicio, tAtual.anterior.fim]).toEqual(["2026-T4", "2026-07-01", "2026-08-04"]);
    const a = lerPeriodo({ p: "ano", ref: "2025" }, hoje);
    expect([a.inicio, a.fim, a.anterior.inicio, a.anterior.fim]).toEqual(["2025-01-01", "2025-12-31", "2024-01-01", "2024-12-31"]);
    expect(lerPeriodo({ p: "ano", ref: "1500" }, hoje).ref).toBe("2026");
  });

  it("intervalo: datas válidas; comparação com os mesmos dias logo antes; inválido = últimos 30 dias", () => {
    const i = lerPeriodo({ p: "int", de: "2026-01-11", ate: "2026-01-20" }, hoje);
    expect([i.inicio, i.fim, i.anterior.inicio, i.anterior.fim]).toEqual(["2026-01-11", "2026-01-20", "2026-01-01", "2026-01-10"]);
    const ruim = lerPeriodo({ p: "int", de: "2026-02-30", ate: "2026-01-01" }, hoje);
    expect([ruim.inicio, ruim.fim]).toEqual(["2026-10-06", "2026-11-04"]);
    expect(lerPeriodo({ p: "int", de: "2000-01-01", ate: "2026-01-01" }, hoje).inicio).toBe("2026-10-06");
  });

  it("vizinhos, parâmetros da URL e meses do período", () => {
    expect(refVizinha({ tipo: "mes", inicio: "2026-01-01" }, -1)).toBe("2025-12");
    expect(refVizinha({ tipo: "tri", inicio: "2026-01-01" }, -1)).toBe("2025-T4");
    expect(refVizinha({ tipo: "ano", inicio: "2026-01-01" }, 1)).toBe("2027");
    expect(refVizinha({ tipo: "int", inicio: "2026-01-01" }, 1)).toBeNull();
    expect(queryPeriodo(lerPeriodo({ p: "int", de: "2026-01-01", ate: "2026-01-31" }, hoje), { rent: "contrato" })).toBe("p=int&de=2026-01-01&ate=2026-01-31&rent=contrato");
    expect(queryPeriodo(lerPeriodo({ p: "tri", ref: "2026-T1" }, hoje))).toBe("p=tri&ref=2026-T1");
    expect(mesesEntreDatas("2026-01-15", "2026-03-02")).toEqual(["2026-01-01", "2026-02-01", "2026-03-01"]);
    expect(periodoAnterior("int", "2026-11-01", "2026-11-10", "2026-11-04")).toMatchObject({ inicio: "2026-10-22", fim: "2026-10-25" });
  });

  it("períodos dos envios programados", () => {
    expect(periodoRelativo("mes_anterior", "2026-01-15")).toMatchObject({ inicio: "2025-12-01", fim: "2025-12-31" });
    expect(periodoRelativo("mes_atual", hoje)).toMatchObject({ inicio: "2026-11-01", fim: hoje });
    expect(periodoRelativo("ultimos_30", hoje)).toMatchObject({ inicio: "2026-10-06", fim: hoje });
    expect(periodoRelativo("ano_atual", hoje)).toMatchObject({ inicio: "2026-01-01", fim: hoje });
  });
});

describe("taxas, variações e formatos", () => {
  it("taxa e variação com 1 casa; sem base = null", () => {
    expect(taxa(1, 3)).toBe(33.3);
    expect(taxa(5, 0)).toBeNull();
    expect(variacao(150, 100)).toBe(50);
    expect(variacao(50, 100)).toBe(-50);
    expect(variacao(10, 0)).toBeNull();
    expect(variacao(-50, -100)).toBe(50);
    expect(mediaDias(31, 2)).toBe(16);
    expect(mediaDias(10, 0)).toBeNull();
  });

  it("formatos em pt-BR", () => {
    expect(formatarPct(12.345)).toBe("12,3%");
    expect(formatarPct(null)).toBe("—");
    expect(formatarVariacao(12.5)).toBe("+12,5%");
    expect(formatarVariacao(-3)).toBe("−3,0%");
    expect(formatarVariacao(0)).toBe("0,0%");
    expect(formatarDias(1)).toBe("1 dia");
    expect(formatarDias(1200)).toBe("1.200 dias");
    expect(tomVariacao(10)).toBe("sucesso");
    expect(tomVariacao(10, "menor_melhor")).toBe("perigo");
    expect(tomVariacao(-5, "menor_melhor")).toBe("sucesso");
    expect(tomVariacao(null)).toBe("neutro");
  });

  it("datas que vêm do banco como texto ou Date", () => {
    expect(lerData("2026-05-01")).toBe("2026-05-01");
    expect(lerData(new Date("2026-05-01T00:00:00Z"))).toBe("2026-05-01");
    expect(lerData(null)).toBeNull();
  });
});

describe("financeiro", () => {
  const linha = (m: string, x: Record<string, number>) => lerLinhaFinanceira({ mes: m, ...Object.fromEntries(Object.entries(x).map(([k, v]) => [k, String(v)])) });

  it("soma em centavos (sem erro de vírgula) e lê números que chegam como texto", () => {
    const t = somarFinanceiro([linha("2026-05-01", { aluguel_recebido: 0.1, despesas: 0.2 }), linha("2026-06-01", { aluguel_recebido: 0.2, despesas: 0.1 })]);
    expect(t.aluguel_recebido).toBe(0.3);
    expect(t.despesas).toBe(0.3);
  });

  it("receita da imobiliária e resultado em cada modo", () => {
    const t = somarFinanceiro([linha("2026-05-01", { aluguel_recebido: 2500, taxa_administracao: 200, taxa_intermediacao: 50, comissao_vendas: 30000, outras_receitas: 150, despesas: 400 })]);
    expect(receitaImobiliaria(t)).toBe(30400);
    expect(resultadoFinanceiro(t, false)).toBe(30000);
    expect(resultadoFinanceiro(t, true)).toBe(2250);
  });

  it("inadimplência = (em aberto + em acordo) ÷ vencido", () => {
    expect(inadimplencia(4000, 1500, 500)).toEqual({ vencido: 4000, emAberto: 1500, emAcordo: 500, naoPago: 2000, pct: 50 });
    expect(inadimplencia(0, 0, 0).pct).toBeNull();
  });

  it("ocupação e rendimento anual", () => {
    expect(taxaOcupacao({ dias_ocupados: 151, dias_disponiveis: 303 })).toBe(49.8);
    // R$ 1.200 em 61 dias sobre R$ 400 mil ≈ 1,8% ao ano.
    expect(rendimentoAnual(1200, 400000, 61)).toBe(1.8);
    expect(rendimentoAnual(1200, null, 61)).toBeNull();
    expect(rendimentoAnual(1200, 400000, 0)).toBeNull();
  });
});

describe("previsão", () => {
  it("reajustes pendentes pelos aniversários da data-base", () => {
    expect(reajustesAte("2026-05-01", 12, "2027-04-01")).toBe(0);
    expect(reajustesAte("2026-05-01", 12, "2027-05-01")).toBe(1);
    expect(reajustesAte("2026-05-20", 12, "2028-05-01")).toBe(2);
    expect(reajustesAte("2026-05-01", 6, "2026-11-01")).toBe(1);
    expect(reajustesAte("2026-05-01", 0, "2030-01-01")).toBe(0);
    expect(reajustesAte(null, 12, "2030-01-01")).toBe(0);
  });

  it("índice acumulado e valor reajustado em centavos", () => {
    expect(acumuladoIndices([1, 1])).toBeCloseTo(0.0201, 6);
    expect(valorReajustado(2000, acumuladoIndices(Array(12).fill(1)), 1)).toBe(2253.65);
    expect(valorReajustado(2000, 0.1, 0)).toBe(2000);
  });

  it("entradas e saldo previstos em cada modo", () => {
    const l: LinhaPrevisao = {
      mes: "2026-12-01",
      atrasado: false,
      faturas_em_aberto: 1000,
      alugueis_previstos: 2000,
      reajuste_previsto: 0,
      outras_receitas: 100,
      despesas: 300,
      repasses_agendados: 0,
      repasses_estimados: 2700,
      taxa_adm_prevista: 300,
      contratos: 1,
    };
    expect(entradasPrevistas(l)).toBe(3100);
    expect(saldoPrevisto(l, true)).toBe(2800);
    expect(saldoPrevisto(l, false)).toBe(100);
  });
});

describe("funil", () => {
  it("conversão de cada etapa sobre a anterior e sobre o total", () => {
    const e = etapasFunil({ leads: 10, com_visita: 5, com_proposta: 2, fechados: 1 });
    expect(e.map((x) => [x.valor, x.daAnterior, x.doTotal])).toEqual([
      [10, null, null],
      [5, 50, 50],
      [2, 40, 20],
      [1, 50, 10],
    ]);
  });
});

describe("relatórios personalizados", () => {
  it("fontes e colunas do modo", () => {
    expect(fontesDoModo(false)).not.toContain("leads");
    expect(fontesDoModo(true)).toContain("repasses");
    expect(colunasPadrao("imoveis", true)).toEqual(["codigo", "titulo", "tipo", "status", "finalidades", "bairro"]);
    expect(colunasPadrao("contratos", false)).not.toContain("proprietario");
  });

  it("fontes que o perfil de acesso deixa usar (cada fonte é de um módulo)", () => {
    expect(moduloDaFonte("lancamentos")).toBe("financeiro");
    expect(moduloDaFonte("leads")).toBe("comercial");
    expect(moduloDaFonte("visitas")).toBe("agenda");
    expect(fontesPermitidas(true, permissoesTotais())).toEqual(fontesDoModo(true));
    expect(fontesPermitidas(true, { relatorios: ["ver"], imoveis: ["ver"], comercial: ["ver"] })).toEqual(["imoveis", "leads", "propostas"]);
    // No pessoal, a fonte da imobiliária some mesmo com o módulo liberado.
    expect(fontesPermitidas(false, { comercial: ["ver"], financeiro: ["ver"] })).toEqual(["lancamentos"]);
    expect(fontesPermitidas(true, { relatorios: ["ver"] })).toEqual([]);
  });

  it("validação", () => {
    expect(validarDefinicao({ fonte: "imoveis", colunas: ["codigo"] }, false)).toBeNull();
    expect(validarDefinicao({ fonte: "leads", colunas: ["nome"] }, false)).toBe("Esta fonte só existe no modo imobiliária.");
    expect(validarDefinicao({ fonte: "imoveis", colunas: ["corretor"] }, false)).toBe("A coluna corretor só existe no modo imobiliária.");
    expect(validarDefinicao({ fonte: "imoveis", colunas: ["codigo"], filtros: [{ campo: "captado_em", op: "igual", valor: "2026-02-29" }] }, true)).toBe("Data inválida no filtro de captado_em.");
    expect(validarDefinicao({ fonte: "imoveis", colunas: ["codigo"], filtros: [{ campo: "captado_em", op: "ultimos_dias", valor: "30" }] }, true)).toBeNull();
    expect(validarDefinicao({ fonte: "imoveis", colunas: ["codigo"], filtros: [{ campo: "codigo", op: "ultimos_dias", valor: "30" }] }, true)).toBe("Esse filtro não vale para a coluna codigo.");
    expect(validarDefinicao({ fonte: "imoveis", colunas: ["codigo"], agrupar_por: "bairro", totais: ["valor_aluguel"], ordenar_por: "quantidade" }, true)).toBeNull();
    expect(validarDefinicao({ fonte: "imoveis", colunas: ["codigo"], ordenar_por: "quantidade" }, true)).toBe("Escolha ordenar por uma das colunas do relatório.");
  });

  it("número do filtro com vírgula vira ponto", () => {
    expect(normalizarNumeroFiltro("1.234,56")).toBe("1234.56");
    expect(normalizarNumeroFiltro(" 2000 ")).toBe("2000");
  });

  it("resultado vira tabela com rótulos, tipos e a linha de totais", () => {
    const def = { fonte: "imoveis", colunas: ["codigo", "valor_aluguel", "captado_em"], totais: ["valor_aluguel"] };
    const t = tabelaDoResultado(def, { linhas: [["A-1", "2000.00", "2026-01-01"], ["B-2", null, null]], total: 2, totais: { valor_aluguel: "2000.00" } }, "Teste");
    expect(t.colunas).toEqual([
      { rotulo: "Código", tipo: "texto" },
      { rotulo: "Aluguel", tipo: "dinheiro" },
      { rotulo: "Captado em", tipo: "data" },
    ]);
    expect(t.linhas).toEqual([
      ["A-1", 2000, "2026-01-01"],
      ["B-2", null, null],
    ]);
    expect(t.totais).toEqual(["Total", 2000, null]);
    const g = colunasDoResultado({ fonte: "imoveis", colunas: ["codigo"], agrupar_por: "captado_em", totais: ["valor_aluguel"] });
    expect(g.map((c) => [c.rotulo, c.tipo])).toEqual([
      ["Captado em (mês)", "texto"],
      ["Quantidade", "inteiro"],
      ["Aluguel", "dinheiro"],
    ]);
  });
});

describe("envios programados", () => {
  it("próxima execução no horário de Brasília", () => {
    // 04/11/2026 (quarta) 09:00 em Brasília.
    const depois = new Date("2026-11-04T12:00:00Z");
    expect(proximaExecucao("diaria", null, null, 8, depois)?.toISOString()).toBe("2026-11-05T11:00:00.000Z");
    expect(proximaExecucao("diaria", null, null, 10, depois)?.toISOString()).toBe("2026-11-04T13:00:00.000Z");
    expect(proximaExecucao("semanal", 1, null, 8, depois)?.toISOString()).toBe("2026-11-09T11:00:00.000Z");
    expect(proximaExecucao("mensal", null, 1, 8, depois)?.toISOString()).toBe("2026-12-01T11:00:00.000Z");
    // Exatamente na hora: já passou, vai para a próxima.
    expect(proximaExecucao("diaria", null, null, 8, new Date("2026-11-04T11:00:00Z"))?.toISOString()).toBe("2026-11-05T11:00:00.000Z");
  });

  it("descrição da agenda", () => {
    expect(descreverAgenda({ frequencia: "semanal", dia_semana: 1, dia_mes: null, hora: 8 })).toBe("Toda segunda-feira às 8h");
    expect(descreverAgenda({ frequencia: "semanal", dia_semana: 0, dia_mes: null, hora: 8 })).toBe("Todo domingo às 8h");
    expect(descreverAgenda({ frequencia: "mensal", dia_semana: null, dia_mes: 5, hora: 9 })).toBe("Todo dia 5 às 9h");
    expect(descreverAgenda({ frequencia: "diaria", dia_semana: null, dia_mes: null, hora: 7 })).toBe("Todo dia às 7h");
  });

  it("destinatários: e-mails e WhatsApps separados, sem repetir, e os que não deu para entender", () => {
    expect(separarDestinatarios("Socio@X.com, socio@x.com; (51) 99999-0000\n123, nada@")).toEqual({
      emails: ["socio@x.com"],
      whatsapps: ["51999990000"],
      invalidos: ["123", "nada@"],
    });
  });

  it("permissões na tela", () => {
    expect(permissoesBi("admin", {})).toEqual({ ver: true, editar: true, agendar: true, rodar: true });
    expect(permissoesBi("corretor", { relatorios: ["ver"], configuracoes: ["ver", "editar"] })).toEqual({ ver: true, editar: true, agendar: false, rodar: false });
    expect(permissoesBi("financeiro", { relatorios: ["ver"], configuracoes: ["ver"] })).toEqual({ ver: true, editar: false, agendar: false, rodar: true });
    expect(permissoesBi("gestor", { configuracoes: ["editar"] })).toEqual({ ver: false, editar: false, agendar: false, rodar: false });
  });
});

describe("exportação", () => {
  const t: TabelaRelatorio = {
    titulo: "Teste <& \"aspas\">",
    subtitulo: "Período: maio",
    colunas: [
      { rotulo: "Imóvel", tipo: "texto" },
      { rotulo: "Valor", tipo: "dinheiro" },
      { rotulo: "Data", tipo: "data" },
      { rotulo: "Qtd", tipo: "inteiro" },
      { rotulo: "Taxa", tipo: "pct" },
    ],
    linhas: [
      ["=SOMA(A1)", 1234.5, "2026-05-01", 3, 12.5],
      ["Rua; centro \"x\"", null, null, null, null],
    ],
    totais: ["Total", 1234.5, null, 3, null],
  };

  it("CSV: BOM, ponto e vírgula, vírgula decimal, datas dd/mm/aaaa e proteção contra fórmula", () => {
    const csv = tabelaParaCSV(t);
    expect(csv.startsWith("﻿")).toBe(true);
    const linhas = csv.slice(1).split("\r\n");
    expect(linhas[3]).toBe("Imóvel;Valor;Data;Qtd;Taxa");
    expect(linhas[4]).toBe("'=SOMA(A1);1234,50;01/05/2026;3;12,50");
    expect(linhas[5]).toBe('"Rua; centro ""x""";;;;');
    expect(linhas[6]).toBe("Total;1234,50;;3;");
  });

  it("Excel (XML 2003): texto escapado, números e datas tipados, nome da aba seguro", () => {
    const x = tabelaParaXLS(t);
    expect(x).toContain('<?mso-application progid="Excel.Sheet"?>');
    expect(x).toContain("Teste &lt;&amp; &quot;aspas&quot;&gt;");
    expect(x).toContain('<Cell ss:StyleID="m"><Data ss:Type="Number">1234.5</Data></Cell>');
    expect(x).toContain('<Data ss:Type="DateTime">2026-05-01T00:00:00.000</Data>');
    expect(x).toContain('<Data ss:Type="String">=SOMA(A1)</Data>');
    expect(nomeAbaExcel("Relatório: [mês]/2026 com nome muito comprido demais")).toBe("Relatório   mês  2026 com nome");
    expect(nomeArquivo("Financeiro mês a mês", "2026-11-04", "csv")).toBe("financeiro-mes-a-mes-2026-11-04.csv");
  });
});
