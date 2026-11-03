import { describe, expect, it } from "vitest";
import { paraCentavos, ratear } from "@/lib/dominio/dinheiro";
import { mesesEntre, somarMeses } from "@/lib/dominio/datas";
import { calcularAtraso } from "@/lib/dominio/encargos";
import { acumular, calcularReajuste, mesesDoPeriodo } from "@/lib/dominio/reajuste";
import { calcularIRRF } from "@/lib/dominio/irrf";
import { competenciasDoContrato, gerarFatura, type ContratoParaFatura } from "@/lib/dominio/fatura";
import { aplicarIrrfIndividual, calcularRepasse, impostoEfetivo } from "@/lib/dominio/repasse";
import { calcularRescisao } from "@/lib/dominio/rescisao";
import { enviosDevidos, renderizarMensagem } from "@/lib/dominio/regua";
import { validarCNPJ, validarCPF } from "@/lib/dominio/documentos";
import { consolidarDimob, dimobParaCSV } from "@/lib/dominio/dimob";

describe("dinheiro", () => {
  it("converte e rateia sem perder centavos", () => {
    expect(paraCentavos("1.234,5".replace(".", ""))).toBe(123450);
    const partes = ratear(100, [33.33, 33.33, 33.34]);
    expect(partes.reduce((a, b) => a + b, 0)).toBe(100);
    expect(ratear(1001, [50, 50])).toEqual([501, 500]);
  });
});

describe("datas", () => {
  it("soma meses respeitando fim de mês", () => {
    expect(somarMeses("2026-01-31", 1)).toBe("2026-02-28");
    expect(somarMeses("2026-11-15", 3)).toBe("2027-02-15");
    expect(mesesEntre("2026-01-10", "2026-07-09")).toBe(5);
    expect(mesesEntre("2026-01-10", "2026-07-10")).toBe(6);
  });
});

describe("multa e juros por atraso", () => {
  it("cobra multa única e juros pro rata", () => {
    const r = calcularAtraso({
      valor: 200000,
      vencimento: "2026-05-10",
      pagamento: "2026-05-25",
      multaPct: 10,
      jurosMesPct: 1,
    });
    expect(r.diasAtraso).toBe(15);
    expect(r.multa).toBe(20000);
    expect(r.juros).toBe(1000);
    expect(r.total).toBe(221000);
  });
  it("não cobra dentro da carência", () => {
    const r = calcularAtraso({
      valor: 200000,
      vencimento: "2026-05-10",
      pagamento: "2026-05-12",
      multaPct: 10,
      jurosMesPct: 1,
      carenciaDias: 3,
    });
    expect(r.multa + r.juros).toBe(0);
  });
});

describe("reajuste", () => {
  it("usa os 12 meses anteriores ao aniversário", () => {
    const m = mesesDoPeriodo("2027-03-01");
    expect(m[0]).toBe("2026-03-01");
    expect(m[11]).toBe("2027-02-01");
  });
  it("acumula índices compostos e aponta meses faltantes", () => {
    expect(acumular([1, 1])).toBeCloseTo(2.01, 6);
    const variacoes = mesesDoPeriodo("2027-03-01").map((c) => ({ competencia: c, variacaoPct: 1 }));
    const r = calcularReajuste({ valorAtual: 100000, dataReajuste: "2027-03-01", variacoes });
    expect(r.percentualAcumulado).toBeCloseTo(12.6825, 4);
    expect(Math.abs(r.valorNovo - 112683)).toBeLessThanOrEqual(1);
    const parcial = calcularReajuste({ valorAtual: 100000, dataReajuste: "2027-03-01", variacoes: variacoes.slice(1) });
    expect(parcial.mesesFaltantes).toEqual(["2026-03-01"]);
  });
  it("não reduz aluguel com índice negativo por padrão", () => {
    const variacoes = mesesDoPeriodo("2027-03-01").map((c) => ({ competencia: c, variacaoPct: -0.5 }));
    expect(calcularReajuste({ valorAtual: 100000, dataReajuste: "2027-03-01", variacoes }).valorNovo).toBe(100000);
  });
});

describe("IRRF", () => {
  it("aplica tabela progressiva e redutor de 2026", () => {
    expect(calcularIRRF(300000)).toBe(0); // até R$ 5.000 fica isento com o redutor
    expect(calcularIRRF(600000)).toBe(56152); // 741,27 − 179,75
    expect(calcularIRRF(800000)).toBe(129127); // sem redutor acima de R$ 7.350
    expect(calcularIRRF(300000, undefined, false)).toBe(5584);
  });
});

const contratoBase: ContratoParaFatura = {
  dataInicio: "2026-03-15",
  dataFim: "2028-09-14",
  valorAluguel: 310000,
  diaVencimento: 10,
  modalidade: "antecipado",
  taxaAdministracaoPct: 10,
  locatarioTipoPessoa: "PF",
  proprietarios: [{ pessoaId: "p1", percentual: 100, tipoPessoa: "PF" }],
  encargos: [
    { descricao: "Condomínio", valor: 50000, destino: "terceiro", inicio: null, fim: null },
    { descricao: "IPTU 1/10", valor: 12000, destino: "proprietario", inicio: "2026-04-01", fim: "2027-01-01" },
  ],
};

describe("geração de faturas", () => {
  it("cobra aluguel proporcional no primeiro mês e não vence antes do início", () => {
    const f = gerarFatura(contratoBase, "2026-03-01")!;
    expect(f.itens[0].valor).toBe(170000); // 17/31 de 3.100,00
    expect(f.vencimento).toBe("2026-03-15");
    expect(f.itens.map((i) => i.descricao)).not.toContain("IPTU 1/10");
    expect(f.total).toBe(170000 + 50000);
  });
  it("mês cheio com encargos e modalidade vencido", () => {
    const f = gerarFatura({ ...contratoBase, modalidade: "vencido" }, "2026-04-01")!;
    expect(f.itens[0].valor).toBe(310000);
    expect(f.vencimento).toBe("2026-05-10");
    expect(f.total).toBe(310000 + 50000 + 12000);
  });
  it("retorna null fora da vigência e lista competências", () => {
    expect(gerarFatura(contratoBase, "2026-02-01")).toBeNull();
    expect(competenciasDoContrato("2026-03-15", null, "2026-06-20")).toEqual([
      "2026-03-01",
      "2026-04-01",
      "2026-05-01",
      "2026-06-01",
    ]);
  });
  it("retém IRRF quando locatário é PJ e proprietário PF", () => {
    const f = gerarFatura(
      { ...contratoBase, valorAluguel: 800000, locatarioTipoPessoa: "PJ", encargos: [] },
      "2026-04-01",
    )!;
    // base = 8.000 − 800 (taxa adm) = 7.200 → 27,5% − 908,73 = 1.071,27; redutor = 978,62 − 958,644 = 19,976
    expect(f.irrfPorProprietario.p1).toBe(105129);
    expect(f.total).toBe(800000 - 105129);
  });
});

describe("repasse ao proprietário", () => {
  it("desconta taxa de administração, intermediação e rateia entre proprietários", () => {
    const r = calcularRepasse(
      [
        { descricao: "Aluguel", tipo: "aluguel", valor: 200000, destino: "proprietario" },
        { descricao: "Condomínio", tipo: "encargo", valor: 50000, destino: "terceiro" },
        { descricao: "Multa", tipo: "multa", valor: 20000, destino: "proprietario" },
        { descricao: "Juros", tipo: "juros", valor: 1000, destino: "proprietario" },
      ],
      {
        taxaAdministracaoPct: 10,
        taxaIntermediacaoPct: 50,
        primeiraFatura: true,
        valorAluguelContrato: 200000,
        repassarMultaJuros: true,
        proprietarios: [
          { pessoaId: "a", percentual: 50 },
          { pessoaId: "b", percentual: 50 },
        ],
      },
    );
    expect(r.repasses[0].valorBruto).toBe(100000 + 10500);
    expect(r.repasses[0].taxaAdministracao).toBe(10000);
    expect(r.repasses[0].taxaIntermediacao).toBe(50000);
    expect(r.repasses[0].valorLiquido).toBe(110500 - 10000 - 50000);
    expect(r.receitaImobiliaria).toBe(20000 + 100000);
    expect(r.valorTerceiros).toBe(50000);
  });
  it("usa o IRRF calculado individualmente", () => {
    const base = calcularRepasse(
      [
        { descricao: "Aluguel", tipo: "aluguel", valor: 800000, destino: "proprietario" },
        { descricao: "IRRF", tipo: "irrf", valor: -105129, destino: "proprietario" },
      ],
      {
        taxaAdministracaoPct: 10,
        taxaIntermediacaoPct: 0,
        primeiraFatura: false,
        valorAluguelContrato: 800000,
        repassarMultaJuros: true,
        proprietarios: [{ pessoaId: "p1", percentual: 100 }],
      },
    );
    const r = aplicarIrrfIndividual(base, { p1: 105129 });
    expect(r.repasses[0].valorLiquido).toBe(800000 - 80000 - 105129);
  });
});

describe("imposto do proprietário no repasse", () => {
  const itens = [
    { descricao: "Aluguel", tipo: "aluguel" as const, valor: 200000, destino: "proprietario" as const },
    { descricao: "Condomínio", tipo: "encargo" as const, valor: 50000, destino: "proprietario" as const },
  ];
  const base = {
    taxaAdministracaoPct: 10,
    taxaIntermediacaoPct: 0,
    primeiraFatura: false,
    valorAluguelContrato: 200000,
    repassarMultaJuros: true,
  };
  it("desconta o % de cada proprietário sobre aluguel menos taxa (encargos não entram)", () => {
    const r = calcularRepasse(itens, {
      ...base,
      proprietarios: [
        { pessoaId: "pf", percentual: 50, impostoPct: 15 },
        { pessoaId: "pj", percentual: 50, impostoPct: 6 },
      ],
    });
    // parte de cada: aluguel 1.000 − taxa 100 = 900 de base
    expect(r.repasses[0].imposto).toBe(13500);
    expect(r.repasses[1].imposto).toBe(5400);
    expect(r.repasses[0].valorLiquido).toBe(100000 + 25000 - 10000 - 13500);
    expect(r.repasses[1].valorLiquido).toBe(100000 + 25000 - 10000 - 5400);
  });
  it("sem % não desconta nada e IRRF individual preserva o imposto", () => {
    const r = calcularRepasse(itens, { ...base, proprietarios: [{ pessoaId: "a", percentual: 100 }] });
    expect(r.repasses[0].imposto).toBe(0);
    const comIr = aplicarIrrfIndividual(
      calcularRepasse(itens, { ...base, proprietarios: [{ pessoaId: "a", percentual: 100, impostoPct: 10 }] }),
      { a: 1000 },
    );
    expect(comIr.repasses[0].valorLiquido).toBe(250000 - 20000 - 1000 - 18000);
  });
  it("usa o padrão PF/PJ da imobiliária quando o cadastro está em branco", () => {
    expect(impostoEfetivo(null, "PF", { pf: 15, pj: 6 })).toBe(15);
    expect(impostoEfetivo(null, "PJ", { pf: 15, pj: 6 })).toBe(6);
    expect(impostoEfetivo("0", "PJ", { pf: 15, pj: 6 })).toBe(0);
    expect(impostoEfetivo(8.5, "PF", { pf: 15, pj: 6 })).toBe(8.5);
  });
});

describe("rescisão", () => {
  it("calcula multa proporcional e saldo de dias", () => {
    const r = calcularRescisao({
      valorAluguel: 200000,
      dataInicio: "2026-01-01",
      prazoMeses: 30,
      dataEntrega: "2026-07-15",
      pagoAte: "2026-06-30",
      multaAlugueis: 3,
      caucao: 100000,
    });
    expect(r.mesesRestantes).toBe(24);
    expect(r.multa).toBe(480000);
    expect(r.diasSaldo).toBe(15);
    expect(r.saldoAluguel).toBe(96774);
    expect(r.totalDevido).toBe(480000 + 96774 - 100000);
  });
  it("sem multa após o prazo, 1 aluguel sem aviso prévio", () => {
    const base = {
      valorAluguel: 200000,
      dataInicio: "2024-01-01",
      prazoMeses: 30,
      dataEntrega: "2026-08-31",
      pagoAte: "2026-08-31",
      multaAlugueis: 3,
    };
    expect(calcularRescisao(base).multa).toBe(0);
    expect(calcularRescisao({ ...base, avisoPrevioCumprido: false }).multa).toBe(200000);
  });
});

describe("régua de cobrança", () => {
  const regras = [
    { id: "r1", diasRelativos: -3, ativo: true },
    { id: "r2", diasRelativos: 2, ativo: true },
  ];
  const faturas = [{ id: "f1", vencimento: "2026-05-10", status: "aberta" }];
  it("dispara lembrete antes e cobrança depois do vencimento", () => {
    expect(enviosDevidos(regras, faturas, "2026-05-07", new Set())).toEqual([
      { regraId: "r1", faturaId: "f1", dataAlvo: "2026-05-07" },
    ]);
    expect(enviosDevidos(regras, faturas, "2026-05-12", new Set()).map((e) => e.regraId)).toEqual(["r2"]);
    expect(enviosDevidos(regras, faturas, "2026-05-12", new Set(["r2:f1"]))).toEqual([]);
    expect(enviosDevidos(regras, faturas, "2026-05-20", new Set())).toEqual([]);
  });
  it("renderiza variáveis", () => {
    const txt = renderizarMensagem("Olá {{nome}}, vence {{vencimento}}: {{valor}}", {
      nome: "Ana",
      valor: 1500,
      vencimento: "2026-05-10",
      competencia: "2026-05-01",
      imovel: "Apto 101",
    });
    expect(txt).toBe("Olá Ana, vence 10/05/2026: R$ 1.500,00");
  });
});

describe("documentos", () => {
  it("valida CPF e CNPJ", () => {
    expect(validarCPF("529.982.247-25")).toBe(true);
    expect(validarCPF("111.111.111-11")).toBe(false);
    expect(validarCNPJ("11.222.333/0001-81")).toBe(true);
    expect(validarCNPJ("11.222.333/0001-80")).toBe(false);
  });
});

describe("DIMOB", () => {
  it("consolida por contrato/locador e mês", () => {
    const base = {
      contratoCodigo: "C1",
      dataContrato: "2026-01-01",
      imovelEndereco: "Rua A, 1",
      imovelCep: "90000000",
      imovelCidade: "Porto Alegre",
      imovelUf: "RS",
      locadorNome: "Ana",
      locadorDocumento: "52998224725",
      locatarioNome: "Bruno",
      locatarioDocumento: "11222333000181",
    };
    const linhas = consolidarDimob(
      [
        { ...base, competencia: "2026-01-01", aluguelBruto: 100000, comissao: 10000, irrf: 0 },
        { ...base, competencia: "2026-02-01", aluguelBruto: 100000, comissao: 10000, irrf: 0 },
        { ...base, competencia: "2025-12-01", aluguelBruto: 100000, comissao: 10000, irrf: 0 },
      ],
      2026,
    );
    expect(linhas).toHaveLength(1);
    expect(linhas[0].meses[1].aluguel).toBe(100000);
    const csv = dimobParaCSV(linhas);
    expect(csv.split("\n")[1]).toContain("1000,00;100,00;0,00");
  });
});

import { aplicarPreferencia, contarPorMes, mesAnoAnterior, mesesAte, progressoMeta, somarPorMes, variacaoPct } from "@/lib/dominio/painel";

describe("painel", () => {
  it("monta os meses atravessando o ano", () => {
    expect(mesesAte("2026-02", 4)).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
    expect(mesAnoAnterior("2026-02")).toBe("2025-02");
  });
  it("soma e conta por mês", () => {
    const meses = ["2026-10", "2026-11"];
    expect(somarPorMes([{ data: "2026-10-05", valor: 100 }, { data: "2026-11-01T10:00:00Z", valor: 50.5 }, { data: "2026-09-01", valor: 9 }], meses)).toEqual([100, 50.5]);
    expect(contarPorMes(["2026-11-02", "2026-11-30", null], meses)).toEqual([0, 2]);
  });
  it("calcula variação e metas", () => {
    expect(variacaoPct(120, 100)).toBe(20);
    expect(variacaoPct(5, 0)).toBeNull();
    expect(progressoMeta(3, 4)).toEqual({ pct: 75, atingida: false });
    expect(progressoMeta(5, 4)?.atingida).toBe(true);
    expect(progressoMeta(5, 0)).toBeNull();
  });
  it("aplica ordem e escondidos, encaixando quadros novos", () => {
    const padrao = ["a", "b", "c", "d"];
    expect(aplicarPreferencia(padrao, null)).toEqual({ visiveis: padrao, ocultos: [] });
    expect(aplicarPreferencia(padrao, { ordem: ["c", "a", "x"], ocultos: ["a"] })).toEqual({ visiveis: ["c", "d", "b"], ocultos: ["a"] });
  });
});

import { quadroPermitido, rotaPermitida } from "@/lib/modos";

describe("modos de uso", () => {
  it("esconde comercial e repasses no modo pessoal", () => {
    expect(rotaPermitida("/comercial", "pessoal")).toBe(false);
    expect(rotaPermitida("/comercial/leads/1", "pessoal")).toBe(false);
    expect(rotaPermitida("/captacao/abc", "pessoal")).toBe(false);
    expect(rotaPermitida("/captacao", "imobiliaria")).toBe(true);
    expect(rotaPermitida("/agenda/abc", "pessoal")).toBe(true);
    expect(rotaPermitida("/chaves", "pessoal")).toBe(true);
    expect(rotaPermitida("/vendas/x/propostas", "pessoal")).toBe(false);
    expect(rotaPermitida("/repasses/extrato", "pessoal")).toBe(false);
    expect(rotaPermitida("/despesas", "pessoal")).toBe(true);
    expect(rotaPermitida("/comercial", "imobiliaria")).toBe(true);
    expect(quadroPermitido("leads_mes", "pessoal")).toBe(false);
    expect(quadroPermitido("faturamento", "pessoal")).toBe(true);
  });
});

import { acharDuplicados, duplicadosDe, gerarUnidades, interpretarPlanilha, lerCSV, numeroBR, similares } from "@/lib/dominio/imoveis";

describe("cadastro de imóveis", () => {
  it("acha duplicados por endereço (abreviação e acento), matrícula e código", () => {
    const lista = [
      { id: "1", codigo: "AP-1", logradouro: "Rua São João", numero: "10", cidade: "Santos", matricula: "123" },
      { id: "2", codigo: "AP-2", logradouro: "R. Sao Joao", numero: "10", cidade: "santos" },
      { id: "3", codigo: "CA-9", logradouro: "Av. Brasil", numero: "5", matricula: "12.3" },
      { id: "4", codigo: "ap 1" },
    ];
    const g = acharDuplicados(lista);
    expect(g.find((x) => x.motivo === "endereco")?.itens.map((i) => i.id)).toEqual(["1", "2"]);
    expect(g.find((x) => x.motivo === "matricula")?.itens.map((i) => i.id)).toEqual(["1", "3"]);
    expect(g.find((x) => x.motivo === "codigo")?.itens.map((i) => i.id)).toEqual(["1", "4"]);
    expect(duplicadosDe({ logradouro: "rua são joão", numero: "10", cidade: "Santos" }, lista).map((d) => d.item.id)).toEqual(["1", "2"]);
  });

  it("lê CSV e interpreta a planilha", () => {
    const csv = 'Código;Tipo;Finalidade;Rua;Número;Aluguel;Quartos\nAP-1;Apartamento;venda e locação;"Rua A; fundos";10;"2.500,00";2\n;casa;;;;abc;\n';
    const linhas = lerCSV(csv);
    expect(linhas[1][3]).toBe("Rua A; fundos");
    const { itens } = interpretarPlanilha(linhas);
    expect(itens[0].dados).toMatchObject({ codigo: "AP-1", tipo: "apartamento", finalidades: ["venda", "locacao"], valor_aluguel: 2500, quartos: 2 });
    expect(itens[0].erros).toEqual([]);
    expect(itens[1].erros.length).toBe(2);
    expect(numeroBR("R$ 1.234,5")).toBe(1234.5);
    expect(numeroBR("2.500")).toBe(2500);
    expect(numeroBR("12.5")).toBe(12.5);
  });

  it("gera unidades e acha similares", () => {
    const u = gerarUnidades({ prefixo: "sol", blocos: ["A", "B"], andarInicial: 1, andarFinal: 2, porAndar: 2 });
    expect(u).toHaveLength(8);
    expect(u[0]).toEqual({ codigo: "SOL-A-101", bloco: "A", unidade: "101" });
    expect(gerarUnidades({ prefixo: "T", blocos: [], andarInicial: 3, andarFinal: 3, porAndar: 1 })[0].codigo).toBe("T-301");
    const base = { id: "b", tipo: "apartamento", cidade: "Santos", bairro: "Gonzaga", quartos: 2, valor_aluguel: 2000, valor_venda: null, finalidades: ["locacao"], status: "disponivel" };
    const lista = [
      { ...base, id: "x", valor_aluguel: 2200 },
      { ...base, id: "y", tipo: "casa", cidade: "Recife", bairro: "Boa Viagem", valor_aluguel: 9000 },
    ];
    expect(similares(base, lista).map((s) => s.id)).toEqual(["x"]);
  });
});

describe("modos: telas do imóvel", () => {
  it("bloqueia comercialização e empreendimentos no pessoal", () => {
    expect(rotaPermitida("/imoveis/abc/comercializacao", "pessoal")).toBe(false);
    expect(rotaPermitida("/imoveis/abc/midia", "pessoal")).toBe(true);
    expect(rotaPermitida("/empreendimentos/1", "pessoal")).toBe(false);
    expect(rotaPermitida("/imoveis/abc/comercializacao", "imobiliaria")).toBe(true);
  });
});

import { simularLiquidacao } from "@/lib/servicos/locacao";

describe("multa manual na baixa", () => {
  const fatura = { valor_total: 2000, vencimento: "2026-10-10" } as never;
  const contrato = { multa_atraso_pct: 10, juros_mes_pct: 1, carencia_dias: 0, repassar_multa_juros: true, tipo_repasse: "automatico" } as never;
  it("sem multa quando o usuário não aplica (0) e com o valor digitado quando aplica", () => {
    const sem = simularLiquidacao(fatura, contrato, "2026-10-20", false, 0);
    expect(sem.total).toBe(200000);
    expect(sem.itensExtras).toEqual([]);
    expect(sem.sugestao).toBeGreaterThan(20000);
    const com = simularLiquidacao(fatura, contrato, "2026-10-20", false, 150);
    expect(com.total).toBe(215000);
    expect(com.itensExtras).toEqual([{ descricao: "Multa por atraso", tipo: "multa", valor: 15000, destino: "proprietario" }]);
  });
});

import { acharPessoasRepetidas, interpretarPlanilhaPessoas, pendencias, pessoaRepetidaDe, pessoasParaCSV } from "@/lib/dominio/pessoas";

describe("cadastro de pessoas", () => {
  it("lista a documentação pendente conforme o papel e o modo", () => {
    const loc = { nome: "Ana", papeis: ["locatario"], telefone: "11" };
    expect(pendencias(loc, [])).toEqual(["Sem CPF", "Falta RG ou CNH", "Falta comprovante de residência", "Falta comprovante de renda"]);
    expect(pendencias({ ...loc, documento: "52998224725" }, ["RG ou CNH", "Comprovante de residência", "Comprovante de renda"])).toEqual([]);
    const dono = { nome: "Beto", papeis: ["proprietario"], documento: "52998224725", email: "b@b.com" };
    expect(pendencias(dono, ["RG ou CNH"])).toEqual(["Sem dados bancários ou Pix para o repasse"]);
    expect(pendencias(dono, ["RG ou CNH"], "pessoal")).toEqual([]);
    expect(pendencias({ nome: "X Ltda", tipo_pessoa: "PJ", papeis: ["proprietario"], documento: "11222333000181", pix_chave: "x", email: "x@x.com" }, [])).toEqual(["Falta o contrato social"]);
  });

  it("acha cadastros repetidos e um repetido para importação", () => {
    const lista = [
      { id: "1", nome: "Maria Silva", documento: "529.982.247-25", telefone: "(11) 98888-7777" },
      { id: "2", nome: "Maria S.", documento: "52998224725" },
      { id: "3", nome: "João Souza", telefone: "11988887777" },
      { id: "4", nome: "joão souza" },
    ];
    const g = acharPessoasRepetidas(lista);
    expect(g.map((x) => [x.motivo, x.itens.map((i) => i.id)])).toEqual([
      ["documento", ["1", "2"]],
      ["telefone", ["1", "3"]],
      ["nome", ["3", "4"]],
    ]);
    expect(pessoaRepetidaDe({ nome: "Outra", email: "", telefone: "988887777" }, lista)?.item.id).toBe("1");
  });

  it("lê planilha de pessoas e exporta CSV", () => {
    const { itens } = interpretarPlanilhaPessoas([
      ["Nome", "CPF", "Telefone", "Papel"],
      ["Carla", "529.982.247-25", "11 9999", "inquilino e fiador"],
      ["", "123", "", ""],
    ]);
    expect(itens[0].dados).toMatchObject({ nome: "Carla", documento: "52998224725", tipo_pessoa: "PF", papeis: ["locatario", "fiador"] });
    expect(itens[0].erros).toEqual([]);
    expect(itens[1].erros).toEqual(["Falta o nome", "CPF inválido"]);
    const saida = pessoasParaCSV([{ nome: 'Ana "A"', papeis: ["locatario"] }], { locatario: "Locatário" });
    expect(saida.split("\n")[1].startsWith('"Ana ""A"""')).toBe(true);
    expect(saida).toContain("Locatário");
  });
});

import { imoveisQueCombinam } from "@/lib/dominio/pessoas";

describe("imóveis que combinam com o perfil", () => {
  it("filtra por finalidade, tipo, região, quartos e faixa de valor", () => {
    const base = { tipo: "apartamento", finalidades: ["locacao"], status: "disponivel", bairro: "Gonzaga", cidade: "Santos", quartos: 2, valor_aluguel: 2500, valor_venda: null };
    const lista = [
      { ...base, id: "a" },
      { ...base, id: "b", valor_aluguel: 5000 },
      { ...base, id: "c", bairro: "Centro", cidade: "São Paulo" },
      { ...base, id: "d", status: "alugado" },
      { ...base, id: "e", finalidades: ["venda"], valor_aluguel: null, valor_venda: 400000 },
    ];
    const perfil = { interesse: ["alugar"], pref_tipos: ["Apartamento"], pref_regioes: "gonzaga, boqueirão", pref_valor_min: null, pref_valor_max: 3000, pref_quartos_min: 2 };
    expect(imoveisQueCombinam(perfil, lista).map((i) => i.id)).toEqual(["a"]);
    expect(imoveisQueCombinam({ ...perfil, interesse: ["comprar"], pref_valor_max: 500000 }, lista).map((i) => i.id)).toEqual(["e"]);
  });
});

describe("modos: pessoas", () => {
  it("aba Interesse só na imobiliária", () => {
    expect(rotaPermitida("/pessoas/x/interesse", "pessoal")).toBe(false);
    expect(rotaPermitida("/pessoas/x/documentos", "pessoal")).toBe(true);
    expect(rotaPermitida("/pessoas/x/interesse", "imobiliaria")).toBe(true);
  });
});

describe("taxa de administração zero", () => {
  it("com 0% o proprietário recebe o aluguel inteiro e a imobiliária não fica com nada", () => {
    const r = calcularRepasse([{ descricao: "Aluguel", tipo: "aluguel", valor: 200000, destino: "proprietario" }], {
      taxaAdministracaoPct: 0,
      taxaIntermediacaoPct: 0,
      primeiraFatura: true,
      valorAluguelContrato: 200000,
      repassarMultaJuros: true,
      proprietarios: [{ pessoaId: "a", percentual: 100 }],
    });
    expect(r.repasses[0].taxaAdministracao).toBe(0);
    expect(r.repasses[0].valorLiquido).toBe(200000);
    expect(r.receitaImobiliaria).toBe(0);
  });
});

import { conversaoPorEtapa, horasAtePrimeiroAtendimento, paraReativar, resumoPor, rotuloEtapa, textoHoras } from "@/lib/dominio/crm";

describe("CRM de leads", () => {
  const l = (status: string, etapa_max: number, extra: Record<string, unknown> = {}) => ({
    id: Math.random().toString(),
    status,
    etapa_max,
    corretor_id: "a",
    origem: "site",
    funil: "locacao",
    created_at: "2026-11-01T10:00:00Z",
    atendido_em: null as string | null,
    motivo_perda: null,
    ...extra,
  });
  it("calcula conversão por etapa", () => {
    const c = conversaoPorEtapa([l("novo", 0), l("visita", 2), l("perdido", 3), l("ganho", 4)]);
    expect(c.map((x) => x.chegaram)).toEqual([4, 3, 3, 2, 1]);
    expect(c[4].pctTotal).toBe(25);
    expect(c[3].pctAnterior).toBeCloseTo(66.7);
  });
  it("resume por corretor com tempo médio de atendimento", () => {
    const r = resumoPor(
      [l("ganho", 4, { atendido_em: "2026-11-01T12:00:00Z" }), l("perdido", 1, { atendido_em: "2026-11-01T14:00:00Z" }), l("novo", 0, { corretor_id: "b" })],
      (x) => x.corretor_id,
    );
    expect(r[0]).toMatchObject({ chave: "a", total: 2, ganhos: 1, perdidos: 1, conversao: 50, tempoMedioHoras: 3 });
    expect(horasAtePrimeiroAtendimento("2026-11-01T10:00:00Z", null)).toBeNull();
    expect(textoHoras(0.25)).toBe("15 min");
    expect(textoHoras(30)).toBe("30 h");
  });
  it("acha leads para reativar e nomeia etapas por funil", () => {
    const agora = new Date("2026-11-03T00:00:00Z").getTime();
    const lista = [
      { status: "perdido", perdido_em: "2026-09-01T00:00:00Z", ultimo_contato: null, created_at: "2026-08-01T00:00:00Z" },
      { status: "perdido", perdido_em: "2026-10-30T00:00:00Z", ultimo_contato: null, created_at: "2026-08-01T00:00:00Z" },
      { status: "em_atendimento", perdido_em: null, ultimo_contato: "2026-08-01T00:00:00Z", created_at: "2026-07-01T00:00:00Z" },
      { status: "ganho", perdido_em: null, ultimo_contato: null, created_at: "2025-01-01T00:00:00Z" },
    ];
    expect(paraReativar(lista, agora)).toHaveLength(2);
    expect(rotuloEtapa("captacao", "ganho")).toBe("Captado");
    expect(rotuloEtapa("venda", "ganho")).toBe("Vendido");
    expect(rotuloEtapa("locacao", "visita")).toBe("Visita");
  });
});

import { avaliacaoMercado, funilCaptacao, progressoChecklist, resumoCaptacoes, sugerirCodigo } from "@/lib/dominio/captacao";

describe("captação: avaliação de mercado", () => {
  it("sugere valor pelo R$/m² mediano de imóveis parecidos + comparativos", () => {
    const cad = [
      { codigo: "A", tipo: "apartamento", bairro: "Gonzaga", cidade: "Santos", area: 50, quartos: 2, valor_aluguel: 2500, valor_venda: null },
      { codigo: "B", tipo: "apartamento", bairro: "Gonzaga", cidade: "Santos", area: 100, quartos: 3, valor_aluguel: 4000, valor_venda: 800000 },
      { codigo: "C", tipo: "casa", bairro: "Gonzaga", cidade: "Santos", area: 200, quartos: 3, valor_aluguel: 9000, valor_venda: null },
    ];
    const r = avaliacaoMercado({ tipo: "Apartamento", bairro: "gonzaga", cidade: "Santos", area: 80, quartos: 2 }, cad, [
      { descricao: "Anúncio ZAP", valor: 3300, area: 60, finalidade: "locacao", fonte: "ZAP" },
    ]);
    expect(r.locacao.amostras).toBe(3);
    expect(r.locacao.precoM2).toBe(50); // mediana de 50, 40, 55
    expect(r.locacao.sugerido).toBe(4000);
    expect(r.venda.sugerido).toBe(640000);
    expect(progressoChecklist({ matricula: true, iptu: true }).feitos).toBe(2);
    expect(sugerirCodigo(["AP-009", "AP-012", "CA-1"])).toBe("AP-013");
    expect(sugerirCodigo([], "casa")).toBe("CA-001");
  });
});

describe("captação: desempenho", () => {
  const base = { corretor_id: "a", origem: "placa", exclusivo: false, motivo_nao_captado: null };
  const lista = [
    { ...base, status: "captado", etapa_max: 5, exclusivo: true },
    { ...base, status: "nao_captado", etapa_max: 3 },
    { ...base, status: "contato", etapa_max: 1, corretor_id: "b" },
  ];
  it("agrupa por corretor com taxa de captação", () => {
    const r = resumoCaptacoes(lista, (c) => c.corretor_id ?? "");
    expect(r[0]).toMatchObject({ chave: "a", total: 2, captados: 1, naoCaptados: 1, exclusivos: 1, taxa: 50 });
    expect(r[1]).toMatchObject({ chave: "b", abertos: 1, taxa: null });
  });
  it("conta quantos chegaram a cada etapa", () => {
    const f = funilCaptacao(lista);
    expect(f.map((x) => x.chegaram)).toEqual([3, 3, 2, 2, 1, 1]);
  });
});

import { conflitos, diaLocal, gerarICS, gradeMes, gradeSemana, horaLocal, instante, linkGoogleAgenda, situacaoChave, sugerirCodigoChave } from "@/lib/dominio/agenda";

describe("agenda", () => {
  it("converte horário de Brasília", () => {
    const i = instante("2026-11-04", "09:30");
    expect(i).toBe("2026-11-04T12:30:00.000Z");
    expect(diaLocal("2026-11-05T01:00:00Z")).toBe("2026-11-04");
    expect(horaLocal(i)).toBe("09:30");
  });
  it("monta a grade do mês e da semana (domingo a sábado)", () => {
    const g = gradeMes("2026-11-10");
    expect(g[0][0]).toEqual({ data: "2026-11-01", doMes: true }); // 01/11/2026 é domingo
    expect(g.at(-1)!.at(-1)!.data).toBe("2026-12-05");
    expect(gradeSemana("2026-11-04")).toEqual(["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07"]);
  });
  it("acusa conflito de imóvel, corretor e indisponibilidade", () => {
    const novo = { id: "n", data_hora: instante("2026-11-04", "10:00"), duracao_min: 60, status: "agendada", imovel_id: "i1", corretor_id: "c1" };
    const ex = [
      { id: "a", data_hora: instante("2026-11-04", "10:30"), duracao_min: 30, status: "agendada", imovel_id: "i1", corretor_id: null },
      { id: "b", data_hora: instante("2026-11-04", "10:45"), duracao_min: 30, status: "agendada", imovel_id: "i2", corretor_id: "c1" },
      { id: "c", data_hora: instante("2026-11-04", "11:00"), duracao_min: 30, status: "agendada", imovel_id: "i1", corretor_id: "c1" },
      { id: "d", data_hora: instante("2026-11-04", "10:00"), duracao_min: 30, status: "cancelada", imovel_id: "i1", corretor_id: "c1" },
    ];
    const bl = [{ imovel_id: "i1", inicio: instante("2026-11-04", "08:00"), fim: instante("2026-11-04", "10:15"), motivo: "pintura" }];
    const r = conflitos(novo, ex, bl);
    expect(r).toHaveLength(3);
    expect(r[2]).toContain("pintura");
  });
  it("gera .ics com alarme e link do Google", () => {
    const e = { id: "x1", titulo: "Visita AP-1; Ana", inicio: "2026-11-04T12:30:00.000Z", duracao_min: 45, local: "Rua A, 5", lembrete_min: 60 };
    const ics = gerarICS([e], "Agenda", "2026-11-01T00:00:00.000Z");
    expect(ics).toContain("DTSTART:20261104T123000Z");
    expect(ics).toContain("DTEND:20261104T131500Z");
    expect(ics).toContain(String.raw`SUMMARY:Visita AP-1\; Ana`);
    expect(ics).toContain("TRIGGER:-PT60M");
    expect(linkGoogleAgenda(e)).toContain("dates=20261104T123000Z%2F20261104T131500Z");
  });
  it("situação e código de chave", () => {
    expect(situacaoChave([], "2026-11-04T00:00:00Z").situacao).toBe("disponivel");
    expect(situacaoChave([{ retirada_em: "2026-11-01", previsao_devolucao: "2026-11-02T00:00:00Z", devolvida_em: null }], "2026-11-04T00:00:00Z").situacao).toBe("atrasada");
    expect(sugerirCodigoChave(["CH-001", "ch-004", null])).toBe("CH-005");
  });
});

import { cadeiaPropostas, calcularItbi, comissaoTotal, dividirComissao, resumoPagamentos } from "@/lib/dominio/vendas";

describe("vendas", () => {
  it("divide a comissão no centavo e o resto fica com a imobiliária", () => {
    const total = comissaoTotal(333333.33, 6);
    expect(total).toBe(20000);
    const d = dividirComissao(total, [{ percentual: 33.333 }, { percentual: 33.333 }]);
    expect(d.porPessoa[0] + d.porPessoa[1] + d.imobiliaria).toBe(20000);
    expect(d.imobiliaria).toBeCloseTo(6666.8, 1);
    expect(() => dividirComissao(1000, [{ percentual: 70 }, { percentual: 40 }])).toThrow();
    expect(comissaoTotal(500000, 6, 25000)).toBe(25000);
  });
  it("calcula ITBI pelo maior valor (venda ou venal)", () => {
    expect(calcularItbi(400000, 3)).toBe(12000);
    expect(calcularItbi(400000, 2, 450000)).toBe(9000);
  });
  it("resume o cronograma de pagamentos", () => {
    const r = resumoPagamentos(
      [
        { valor: 20000, vencimento: "2026-11-01", pago_em: "2026-11-01" },
        { valor: 80000, vencimento: "2026-11-02", pago_em: null },
        { valor: 300000, vencimento: "2026-12-30", pago_em: null },
      ],
      500000,
      "2026-11-10",
    );
    expect(r).toMatchObject({ programado: 400000, pago: 20000, aReceber: 380000, atrasado: 80000, semCronograma: 100000, pctPago: 4 });
  });
  it("põe a contraproposta logo abaixo da proposta", () => {
    const c = cadeiaPropostas([
      { id: "b", proposta_pai_id: "a", created_at: "2026-11-02" },
      { id: "a", proposta_pai_id: null, created_at: "2026-11-01" },
      { id: "x", proposta_pai_id: null, created_at: "2026-11-03" },
      { id: "c", proposta_pai_id: "b", created_at: "2026-11-04" },
    ]);
    expect(c.map((p) => `${p.id}${p.nivel}`)).toEqual(["a0", "b1", "c2", "x0"]);
  });
});
