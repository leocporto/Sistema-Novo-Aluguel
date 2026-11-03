import { describe, expect, it } from "vitest";
import {
  acordoEmRisco,
  agendadoPara,
  agruparInadimplencia,
  aging,
  analisarRecebimento,
  casarParcelas,
  casarRecebimentos,
  chaveLinhaBaixa,
  chavesDoArquivo,
  horaBrasilia,
  horaDeAgendar,
  parcelaNaDescricao,
  distribuirParcela,
  enderecoImovel,
  faixaAtraso,
  filaDoDia,
  identificacaoImovel,
  indicadoresRecuperacao,
  itensDaQuitacao,
  linkSms,
  liquidoDoAcordo,
  numeroNaDescricao,
  planejarAcordo,
  proximosAvisos,
  regraParaDias,
  separarValorRecebido,
  situacaoFatura,
} from "@/lib/dominio/cobrancas";
import { calcularAtraso } from "@/lib/dominio/encargos";
import { crc16, gerarPixCopiaCola, lerPixCopiaCola, normalizarChavePix, textoPix, txidPix } from "@/lib/dominio/pix";
import { renderizarMensagem } from "@/lib/dominio/regua";
import { ultimoRecebimento } from "@/lib/servicos/cobrancas";
import { simularLiquidacao } from "@/lib/servicos/locacao";

describe("Pix copia e cola (BR Code)", () => {
  const exemploBCB =
    "00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***63041D3D";

  it("CRC16 confere com o exemplo do Banco Central", () => {
    expect(crc16(exemploBCB.slice(0, -4))).toBe("1D3D");
  });

  it("gera exatamente o exemplo do manual do Pix", () => {
    expect(gerarPixCopiaCola({ chave: "123e4567-e12b-12d1-a456-426655440000", nome: "Fulano de Tal", cidade: "BRASILIA" })).toBe(exemploBCB);
  });

  it("leva valor e identificador, tira acentos e o código é válido", () => {
    const c = gerarPixCopiaCola({ chave: "ana@exemplo.com.br", nome: "Imobiliária São João", cidade: "Florianópolis", valor: 215050, txid: "FAT-123" });
    const l = lerPixCopiaCola(c);
    expect(l.valido).toBe(true);
    expect(l.campos["54"]).toBe("2150.50");
    expect(l.campos["59"]).toBe("Imobiliaria Sao Joao");
    expect(l.campos["60"]).toBe("Florianopolis");
    expect(l.campos["62"]).toBe("0506FAT123");
    expect(l.campos["26"]).toContain("ana@exemplo.com.br");
    // Mexeu num dígito: o CRC não bate mais.
    expect(lerPixCopiaCola(c.replace("2150.50", "2150.51")).valido).toBe(false);
  });

  it("reconhece e normaliza os tipos de chave", () => {
    expect(normalizarChavePix("529.982.247-25")).toEqual({ tipo: "cpf", chave: "52998224725" });
    expect(normalizarChavePix("11.222.333/0001-81")).toEqual({ tipo: "cnpj", chave: "11222333000181" });
    expect(normalizarChavePix("(51) 98123-4567")).toEqual({ tipo: "telefone", chave: "+5551981234567" });
    expect(normalizarChavePix("+55 51 98123-4567")).toEqual({ tipo: "telefone", chave: "+5551981234567" });
    expect(normalizarChavePix(" Ana@Exemplo.com ")).toEqual({ tipo: "email", chave: "ana@exemplo.com" });
    expect(normalizarChavePix("123E4567-E12B-12D1-A456-426655440000")?.tipo).toBe("aleatoria");
    expect(normalizarChavePix("abc")).toBeNull();
    expect(() => gerarPixCopiaCola({ chave: "", nome: "X" })).toThrow();
  });

  it("limita nome, cidade e txid", () => {
    expect(textoPix("Nome muito comprido de imobiliária que passa", 25)).toHaveLength(25);
    expect(txidPix("")).toBe("***");
    expect(txidPix("AC-12/P3")).toBe("AC12P3");
  });
});

describe("identificação do imóvel na cobrança", () => {
  it("mostra código e endereço mesmo com campos faltando", () => {
    expect(identificacaoImovel({ codigo: "AP-101", logradouro: "Rua A", numero: "10", cidade: "Porto Alegre", uf: "RS" })).toBe("AP-101 · Rua A, 10 — Porto Alegre/RS");
    expect(identificacaoImovel({ codigo: "AP-101" })).toBe("AP-101");
    expect(identificacaoImovel({ codigo: "", bairro: "Centro" })).toBe("Centro");
    expect(identificacaoImovel(null)).toBe("Imóvel sem identificação");
    expect(enderecoImovel({ codigo: "X", complemento: "apto 2", cidade: "Canoas" })).toBe("apto 2 — Canoas");
  });
});

describe("saldo da fatura, multa e juros separados", () => {
  const regras = { multaPct: 10, jurosMesPct: 1, carenciaDias: 0 };
  const f = { valorTotal: 200000, vencimento: "2026-05-10" };

  it("sem pagamento: igual ao cálculo de atraso, com multa e juros separados", () => {
    const s = situacaoFatura(f, [], regras, "2026-05-25");
    const a = calcularAtraso({ valor: 200000, vencimento: "2026-05-10", pagamento: "2026-05-25", multaPct: 10, jurosMesPct: 1 });
    expect(s.multa).toBe(a.multa);
    expect(s.juros).toBe(a.juros);
    expect(s.saldo).toBe(200000);
    expect(s.totalComEncargos).toBe(a.total);
    expect(s.diasAtraso).toBe(15);
  });

  it("pagamento parcial em atraso: multa uma vez só e juros desde o último pagamento", () => {
    const pg = [{ data: "2026-05-20", valor: 120000, principal: 100000, multa: 20000, juros: 0, desconto: 0 }];
    const s = situacaoFatura(f, pg, regras, "2026-05-30");
    expect(s.saldo).toBe(100000);
    expect(s.parcial).toBe(true);
    expect(s.multa).toBe(0); // já cobrada
    expect(s.diasJuros).toBe(10);
    expect(s.juros).toBe(Math.round((100000 * 0.01 * 10) / 30));
  });

  it("dentro da carência não sugere nada; até o vencimento sugere a pontualidade", () => {
    expect(situacaoFatura(f, [], { ...regras, carenciaDias: 5 }, "2026-05-13").multa).toBe(0);
    const s = situacaoFatura(f, [], regras, "2026-05-08", { pct: 5, aluguel: 180000 });
    expect(s.descontoPontualidade).toBe(9000);
    expect(s.multa + s.juros).toBe(0);
    expect(situacaoFatura(f, [], regras, "2026-05-11", { pct: 5, aluguel: 180000 }).descontoPontualidade).toBe(0);
  });

  it("confere o recebimento: parcial, quitação e excessos", () => {
    expect(analisarRecebimento(200000, { valor: 50000, multa: 0, juros: 0, desconto: 0 })).toEqual({ principal: 50000, quita: false, falta: 150000 });
    expect(analisarRecebimento(200000, { valor: 221000, multa: 20000, juros: 1000, desconto: 0 })).toEqual({ principal: 200000, quita: true, falta: 0 });
    expect(analisarRecebimento(200000, { valor: 191000, multa: 0, juros: 0, desconto: 9000 }).quita).toBe(true);
    expect(analisarRecebimento(200000, { valor: 210000, multa: 0, juros: 0, desconto: 0 }).erro).toMatch(/passa do que falta/);
    expect(analisarRecebimento(200000, { valor: 1000, multa: 2000, juros: 0, desconto: 0 }).erro).toMatch(/passam do valor/);
    expect(analisarRecebimento(0, { valor: 1000, multa: 0, juros: 0, desconto: 0 }).erro).toBeTruthy();
  });

  it("itens da quitação: multa e juros em linhas separadas, desconto negativo", () => {
    const itens = itensDaQuitacao(
      [
        { multa: 20000, juros: 500, desconto: 0 },
        { multa: 0, juros: 300, desconto: 1000 },
      ],
      { multaPct: 10, destinoEncargos: "proprietario", rotuloDesconto: "Desconto do acordo nº 3" },
    );
    expect(itens).toEqual([
      { descricao: "Multa por atraso (10%)", tipo: "multa", valor: 20000, destino: "proprietario" },
      { descricao: "Juros de mora", tipo: "juros", valor: 800, destino: "proprietario" },
      { descricao: "Desconto do acordo nº 3", tipo: "desconto", valor: -1000, destino: "proprietario" },
    ]);
  });

  it("separa valor sem detalhe (extrato) em aluguel, multa e juros", () => {
    const s = { saldo: 200000, multa: 20000, juros: 1000 };
    expect(separarValorRecebido(150000, s)).toEqual({ valor: 150000, multa: 0, juros: 0, desconto: 0 });
    expect(separarValorRecebido(210000, s)).toEqual({ valor: 210000, multa: 10000, juros: 0, desconto: 0 });
    expect(separarValorRecebido(221000, s)).toEqual({ valor: 221000, multa: 20000, juros: 1000, desconto: 0 });
    expect(separarValorRecebido(230000, s)).toBeNull();
  });

  it("baixa com multa e juros digitados separadamente", () => {
    const fatura = { valor_total: 2000, vencimento: "2026-10-10" } as never;
    const contrato = { multa_atraso_pct: 10, juros_mes_pct: 1, carencia_dias: 0, repassar_multa_juros: true, tipo_repasse: "automatico" } as never;
    const r = simularLiquidacao(fatura, contrato, "2026-10-20", false, { multa: 200, juros: 6.67 });
    expect(r.total).toBe(220667);
    expect(r.itensExtras.map((i) => [i.tipo, i.valor])).toEqual([
      ["multa", 20000],
      ["juros", 667],
    ]);
  });
});

describe("acordos e parcelamento", () => {
  const debitos = [
    { faturaId: "b", vencimento: "2026-08-10", saldo: 200000, multa: 20000, juros: 4000 },
    { faturaId: "a", vencimento: "2026-07-10", saldo: 200000, multa: 20000, juros: 6000 },
  ];

  it("soma, aplica desconto nos encargos e divide em entrada + parcelas que fecham o total", () => {
    const p = planejarAcordo({ debitos, desconto: { tipo: "pct_encargos", valor: 50 }, entrada: 50000, parcelas: 3, primeiroVencimento: "2026-12-10", dataAcordo: "2026-11-03" });
    expect(p.erro).toBeUndefined();
    expect(p.principal).toBe(400000);
    expect(p.multa + p.juros).toBe(50000);
    expect(p.desconto).toBe(25000);
    expect(p.total).toBe(425000);
    expect(p.faturas.map((f) => f.faturaId)).toEqual(["a", "b"]);
    expect(p.faturas.reduce((s, f) => s + f.total, 0)).toBe(p.total);
    expect(p.faturas.reduce((s, f) => s + f.desconto, 0)).toBe(25000);
    expect(p.parcelas.map((x) => x.numero)).toEqual([0, 1, 2, 3]);
    expect(p.parcelas[0]).toEqual({ numero: 0, vencimento: "2026-11-03", valor: 50000 });
    expect(p.parcelas.map((x) => x.vencimento).slice(1)).toEqual(["2026-12-10", "2027-01-10", "2027-02-10"]);
    expect(p.parcelas.reduce((s, x) => s + x.valor, 0)).toBe(p.total);
  });

  it("recusa desconto maior que a dívida, entrada que cobre tudo e parcelas fora do limite", () => {
    expect(planejarAcordo({ debitos, desconto: { tipo: "valor", valor: 999999 }, parcelas: 2, primeiroVencimento: "2026-12-10", dataAcordo: "2026-11-03" }).erro).toBeTruthy();
    expect(planejarAcordo({ debitos, entrada: 450000, parcelas: 2, primeiroVencimento: "2026-12-10", dataAcordo: "2026-11-03" }).erro).toBeTruthy();
    expect(planejarAcordo({ debitos, parcelas: 0, primeiroVencimento: "2026-12-10", dataAcordo: "2026-11-03" }).erro).toBeTruthy();
    expect(planejarAcordo({ debitos: [], parcelas: 2, primeiroVencimento: "2026-12-10", dataAcordo: "2026-11-03" }).erro).toBeTruthy();
  });

  it("o desconto abate juros, depois multa e por fim o aluguel", () => {
    expect(liquidoDoAcordo({ principal: 100000, multa: 10000, juros: 2000, desconto: 5000 })).toEqual({ principal: 100000, multa: 7000, juros: 0, descontoPrincipal: 0 });
    expect(liquidoDoAcordo({ principal: 100000, multa: 10000, juros: 2000, desconto: 15000 })).toEqual({ principal: 97000, multa: 0, juros: 0, descontoPrincipal: 3000 });
  });

  it("distribui a parcela da fatura mais antiga para a mais nova e quita a que fecha", () => {
    const fs = [
      { faturaId: "nova", vencimento: "2026-08-10", principal: 100000, multa: 10000, juros: 1000, desconto: 0, pago: { principal: 0, multa: 0, juros: 0 } },
      { faturaId: "velha", vencimento: "2026-07-10", principal: 100000, multa: 10000, juros: 2000, desconto: 3000, pago: { principal: 0, multa: 0, juros: 0 } },
    ];
    const { rateio, sobra } = distribuirParcela(fs, 120000);
    expect(sobra).toBe(0);
    // velha: líquido 100000 + 9000 + 0 (desconto comeu os juros e 1000 da multa)
    expect(rateio[0]).toEqual({ faturaId: "velha", valor: 109000, principal: 100000, multa: 9000, juros: 0, desconto: 0, quita: true });
    // nova: sobram 11000 → juros, multa e o resto no aluguel
    expect(rateio[1]).toEqual({ faturaId: "nova", valor: 11000, principal: 0, multa: 10000, juros: 1000, desconto: 0, quita: false });
    const depois = distribuirParcela([{ ...fs[0], pago: { principal: 0, multa: 10000, juros: 1000 } }], 100000);
    expect(depois.rateio[0]).toMatchObject({ principal: 100000, quita: true });
    expect(distribuirParcela(fs, 999999).sobra).toBeGreaterThan(0);
  });

  it("sugere quebra quando a parcela passa do limite de atraso", () => {
    const ps = [
      { status: "paga", vencimento: "2026-08-10" },
      { status: "aberta", vencimento: "2026-09-10" },
    ];
    expect(acordoEmRisco(ps, "2026-10-20", 30)).toEqual({ atrasadas: 1, maiorAtraso: 40, sugerirQuebra: true });
    expect(acordoEmRisco(ps, "2026-09-20", 30).sugerirQuebra).toBe(false);
  });
});

describe("régua: fila do dia", () => {
  const regras = [
    { id: "antes", diasRelativos: -3, ativo: true },
    { id: "dia", diasRelativos: 0, ativo: true },
    { id: "d3", diasRelativos: 3, ativo: true },
  ];
  it("um aviso por fatura (o mais recente), fora de acordo e da cobrança jurídica", () => {
    const fs = [
      { id: "f1", vencimento: "2026-05-10", status: "aberta" },
      { id: "f2", vencimento: "2026-05-07", status: "aberta", juridico: true },
      { id: "f3", vencimento: "2026-05-10", status: "renegociada" },
    ];
    // 10/05: o aviso do dia é o mais recente; o de 07/05 (3 dias antes) ainda está na janela e fica superado.
    const fila = filaDoDia(regras, fs, "2026-05-10", new Set());
    expect(fila).toEqual([{ faturaId: "f1", regraId: "dia", dataAlvo: "2026-05-10", superados: ["antes"] }]);
    expect(filaDoDia(regras, fs, "2026-05-10", new Set(["dia:f1", "antes:f1"]))).toEqual([]);
    expect(proximosAvisos(regras, fs, "2026-05-10", 5)).toEqual([{ faturaId: "f1", regraId: "d3", dataAlvo: "2026-05-13" }]);
  });

  it("escolhe a mensagem pelos dias", () => {
    const rs = [
      { id: "a", dias_relativos: -3, ativo: true },
      { id: "b", dias_relativos: 0, ativo: true },
      { id: "c", dias_relativos: 3, ativo: true },
      { id: "d", dias_relativos: 15, ativo: true },
    ];
    expect(regraParaDias(rs, 20)?.id).toBe("d");
    expect(regraParaDias(rs, 5)?.id).toBe("c");
    expect(regraParaDias(rs, 1)?.id).toBe("c");
    expect(regraParaDias(rs, 0)?.id).toBe("b");
    expect(regraParaDias(rs, -2)?.id).toBe("a");
  });

  it("mensagem com multa, juros, saldo e Pix", () => {
    const txt = renderizarMensagem("{{nome}}: {{saldo}} + multa {{multa}} + juros {{juros}} = {{valor}} ({{dias}} dias). Pix: {{pix}}", {
      nome: "Ana",
      valor: 2210,
      saldo: 2000,
      multa: 200,
      juros: 10,
      dias: 15,
      vencimento: "2026-05-10",
      competencia: "2026-05-01",
      imovel: "AP-101",
      pix: "000201",
    });
    expect(txt.replace(/\u00a0/g, " ")).toBe("Ana: R$ 2.000,00 + multa R$ 200,00 + juros R$ 10,00 = R$ 2.210,00 (15 dias). Pix: 000201");
    expect(linkSms("(51) 98123-4567", "Oi")).toBe("sms:+5551981234567?body=Oi");
  });
});

describe("relatórios de inadimplência", () => {
  it("faixas de atraso e agrupamento por locatário", () => {
    expect([1, 30, 31, 60, 61, 90, 91, 0].map(faixaAtraso)).toEqual(["1-30", "1-30", "31-60", "31-60", "61-90", "61-90", "90+", null]);
    const itens = [
      { dias: 10, valor: 1000, quem: "Ana" },
      { dias: 45, valor: 2000, quem: "Ana" },
      { dias: 120, valor: 500, quem: "Bia" },
    ];
    const a = aging(itens);
    expect(a.total).toBe(3500);
    expect(a.faixas.map((f) => f.valor)).toEqual([1000, 2000, 0, 500]);
    const g = agruparInadimplencia(itens, (i) => i.quem, (i) => i.quem);
    expect(g.map((x) => [x.rotulo, x.valor, x.maiorAtraso])).toEqual([
      ["Ana", 3000, 45],
      ["Bia", 500, 120],
    ]);
    expect(g[0].faixas["31-60"]).toBe(2000);
  });

  it("indicadores de recuperação", () => {
    const r = indicadoresRecuperacao({
      de: "2026-10-01",
      ate: "2026-10-31",
      hoje: "2026-11-03",
      faturas: [
        { id: "f1", vencimento: "2026-10-05", valorTotal: 100000, status: "paga" },
        { id: "f2", vencimento: "2026-10-10", valorTotal: 100000, status: "paga" },
        { id: "f3", vencimento: "2026-10-15", valorTotal: 100000, status: "aberta" },
        { id: "f4", vencimento: "2026-09-10", valorTotal: 50000, status: "paga" },
      ],
      recebimentos: [
        { faturaId: "f1", data: "2026-10-05", valor: 100000, principal: 100000, multa: 0, juros: 0 },
        { faturaId: "f2", data: "2026-10-20", valor: 110500, principal: 100000, multa: 10000, juros: 500 },
        { faturaId: "f3", data: "2026-10-25", valor: 40000, principal: 40000, multa: 0, juros: 0 },
        { faturaId: "f4", data: "2026-10-12", valor: 50000, principal: 50000, multa: 0, juros: 0 },
      ],
      acordos: [
        { status: "cumprido", data: "2026-08-01", cumpridoEm: "2026-10-10", quebradoEm: null, total: 1000 },
        { status: "quebrado", data: "2026-09-01", cumpridoEm: null, quebradoEm: "2026-10-12", total: 1000 },
        { status: "ativo", data: "2026-10-02", cumpridoEm: null, quebradoEm: null, total: 3000 },
      ],
    });
    expect(r.venceu).toBe(300000);
    expect(r.pagoEmDia).toBe(100000);
    expect(r.atrasou).toBe(200000);
    expect(r.recuperado).toBe(140000);
    expect(r.emAberto).toBe(60000);
    expect(r.pctRecuperado).toBe(70);
    expect(r.pctInadimplencia).toBe(20);
    expect(r.recebidoEmAtraso).toBe(110500 + 40000 + 50000);
    expect(r.encargosRecebidos).toBe(10500);
    expect(r.acordos).toEqual({ criados: 1, cumpridos: 1, quebrados: 1, ativos: 1, valorAtivo: 3000, taxaCumprimento: 50 });
    expect(r.prazoMedio).toBeGreaterThan(0);
  });
});

describe("baixa automática: casar entradas com cobranças", () => {
  const cobrancas = [
    { id: "a", numero: 101, vencimento: "2026-10-10", saldo: 200000, minimo: 190000, maximo: 222000, nome: "Bruno Souza" },
    { id: "b", numero: 102, vencimento: "2026-10-10", saldo: 150000, minimo: 150000, maximo: 166000, nome: "Carla Lima" },
    { id: "c", numero: 103, vencimento: "2026-10-12", saldo: 150000, minimo: 150000, maximo: 166000, nome: "Diego Alves" },
  ];
  it("acha o número da fatura no texto", () => {
    expect(numeroNaDescricao("PIX RECEBIDO FAT101 BRUNO")).toBe(101);
    expect(numeroNaDescricao("Pagamento fatura nº 55")).toBe(55);
    expect(numeroNaDescricao("TED 123")).toBeNull();
  });
  it("casa pelo txid, pelo valor único e pelo nome; não arrisca quando há empate", () => {
    const c = casarRecebimentos(
      [
        { id: "1", data: "2026-10-11", valor: 200000, descricao: "PIX FAT101" },
        { id: "2", data: "2026-10-11", valor: 150000, descricao: "PIX RECEBIDO CARLA LIMA" },
        { id: "3", data: "2026-10-11", valor: 150000, descricao: "PIX RECEBIDO" },
        { id: "4", data: "2026-10-11", valor: -5000, descricao: "TARIFA FAT102" },
      ],
      cobrancas,
    );
    expect(c).toEqual([
      { linhaId: "1", faturaId: "a", confianca: "alta", motivo: "O texto cita a fatura #101" },
      { linhaId: "2", faturaId: "b", confianca: "media", motivo: "Valor e nome do locatário batem" },
      { linhaId: "3", faturaId: "c", confianca: "media", motivo: "Valor igual ao saldo" },
    ]);
    // Dois candidatos iguais e sem nome: não casa.
    expect(casarRecebimentos([{ id: "9", data: "2026-10-11", valor: 150000, descricao: "PIX" }], cobrancas)).toEqual([]);
  });
});

describe("indicadores de recuperação com desconto", () => {
  it("desconto de pontualidade conta como pago em dia e desconto do acordo como recuperado", () => {
    const r = indicadoresRecuperacao({
      de: "2026-10-01",
      ate: "2026-10-31",
      hoje: "2026-11-03",
      faturas: [
        // Pagou em dia com 5% de pontualidade: 950 em dinheiro + 50 de desconto.
        { id: "p1", vencimento: "2026-10-10", valorTotal: 100000, status: "paga" },
        // Atrasou e foi quitada num acordo com 200 de desconto no aluguel.
        { id: "a1", vencimento: "2026-10-05", valorTotal: 100000, status: "paga" },
      ],
      recebimentos: [
        { faturaId: "p1", data: "2026-10-08", valor: 95000, principal: 95000, multa: 0, juros: 0, desconto: 5000 },
        { faturaId: "a1", data: "2026-10-28", valor: 80000, principal: 80000, multa: 0, juros: 0, desconto: 20000 },
      ],
      acordos: [],
    });
    expect(r.venceu).toBe(200000);
    expect(r.pagoEmDia).toBe(100000);
    expect(r.atrasou).toBe(100000);
    expect(r.recuperado).toBe(100000);
    expect(r.emAberto).toBe(0);
    expect(r.pctInadimplencia).toBe(0);
    expect(r.pctRecuperado).toBe(100);
    // Dinheiro recebido em atraso é só o que entrou (sem o desconto).
    expect(r.recebidoEmAtraso).toBe(80000);
  });

  it("sem o desconto (como era antes) a fatura paga com pontualidade aparecia como atrasada", () => {
    const base = {
      de: "2026-10-01",
      ate: "2026-10-31",
      hoje: "2026-11-03",
      faturas: [{ id: "p1", vencimento: "2026-10-10", valorTotal: 100000, status: "paga" }],
      acordos: [],
    };
    const semDesconto = indicadoresRecuperacao({ ...base, recebimentos: [{ faturaId: "p1", data: "2026-10-08", valor: 95000, principal: 95000, multa: 0, juros: 0 }] });
    expect(semDesconto.emAberto).toBe(5000);
    const comDesconto = indicadoresRecuperacao({ ...base, recebimentos: [{ faturaId: "p1", data: "2026-10-08", valor: 95000, principal: 95000, multa: 0, juros: 0, desconto: 5000 }] });
    expect(comDesconto.emAberto).toBe(0);
  });
});

describe("baixa automática de parcelas de acordo", () => {
  const parcelas = [
    { id: "p1", acordoNumero: 12, numero: 1, valor: 150000, vencimento: "2026-11-10", nome: "Bruno Souza" },
    { id: "p2", acordoNumero: 12, numero: 2, valor: 150000, vencimento: "2026-12-10", nome: "Bruno Souza" },
    { id: "p3", acordoNumero: 7, numero: 0, valor: 50000, vencimento: "2026-11-01", nome: "Carla Dias" },
  ];

  it("lê o identificador AC..P.. do Pix", () => {
    expect(parcelaNaDescricao("PIX RECEBIDO AC12P2 BRUNO")).toEqual({ acordo: 12, parcela: 2 });
    expect(parcelaNaDescricao("pix ac0007p0")).toEqual({ acordo: 7, parcela: 0 });
    expect(parcelaNaDescricao("PIX FAT123")).toBeNull();
  });

  it("casa pelo identificador (valor exato), pelo nome + valor, e não usa a mesma parcela duas vezes", () => {
    const r = casarParcelas(
      [
        { id: "l1", data: "2026-12-09", valor: 150000, descricao: "PIX AC12P2" },
        { id: "l2", data: "2026-11-09", valor: 150000, descricao: "PIX BRUNO SOUZA" },
        { id: "l3", data: "2026-11-01", valor: 40000, descricao: "PIX AC7P0" },
        { id: "l4", data: "2026-11-09", valor: 150000, descricao: "PIX BRUNO SOUZA" },
      ],
      parcelas,
    );
    expect(r).toEqual([
      { linhaId: "l1", parcelaId: "p2", confianca: "alta", motivo: "O texto cita a parcela 2 do acordo nº 12" },
      { linhaId: "l2", parcelaId: "p1", confianca: "media", motivo: "Valor da parcela e nome do locatário batem" },
    ]);
  });
});

describe("chave da linha do extrato/arquivo (não baixar duas vezes)", () => {
  it("o mesmo arquivo gera as mesmas chaves; linhas idênticas ganham ordem", () => {
    const linhas = [
      { data: "2026-11-05", valor: 100000, descricao: "PIX  Recebido   João", contaId: "c1" },
      { data: "2026-11-05", valor: 100000, descricao: "pix recebido joao", contaId: "c1" },
      { data: "2026-11-05", valor: 100000, descricao: "PIX RECEBIDO MARIA", contaId: "c1" },
    ];
    const a = chavesDoArquivo(linhas);
    expect(a[0]).toBe(chaveLinhaBaixa(linhas[0], 1));
    expect(a[1]).toBe(chaveLinhaBaixa(linhas[0], 2));
    expect(a[0]).not.toBe(a[1]);
    expect(a[2].endsWith("#1")).toBe(true);
    expect(chavesDoArquivo(linhas)).toEqual(a);
    // Outra conta = outra chave.
    expect(chaveLinhaBaixa({ ...linhas[0], contaId: "c2" })).not.toBe(chaveLinhaBaixa(linhas[0]));
  });
});

describe("envio automático: fila de saída", () => {
  it("só agenda com o envio ligado e a partir do horário (em Brasília)", () => {
    expect(horaBrasilia(new Date("2026-11-03T12:30:00Z"))).toBe(9);
    expect(horaBrasilia(new Date("2026-11-04T01:00:00Z"))).toBe(22);
    expect(horaDeAgendar({ envioAutomatico: true, horaEnvio: 9 }, 8)).toBe(false);
    expect(horaDeAgendar({ envioAutomatico: true, horaEnvio: 9 }, 9)).toBe(true);
    expect(horaDeAgendar({ envioAutomatico: false, horaEnvio: 9 }, 15)).toBe(false);
    expect(agendadoPara("2026-11-03", 9)).toBe("2026-11-03T09:00:00-03:00");
  });
});

describe("desfazer: o que sai é o último recebimento", () => {
  it("mostra o valor e a data do último e o que continua registrado", () => {
    const f = { valor_pago: 2212, valor_total: 2000, pago_em: "2026-10-20" };
    const r = ultimoRecebimento(f, [
      { pago_em: "2026-10-20", valor: 1412, created_at: "2026-10-20T15:00:00Z" },
      { pago_em: "2026-10-15", valor: 800, created_at: "2026-10-15T10:00:00Z" },
    ]);
    expect(r).toEqual({ valor: 1412, pagoEm: "2026-10-20", restante: 800, outros: 1 });
    // Mesmo dia: vale o último lançado.
    expect(
      ultimoRecebimento(f, [
        { pago_em: "2026-10-20", valor: 100, created_at: "2026-10-20T16:00:00Z" },
        { pago_em: "2026-10-20", valor: 2112, created_at: "2026-10-20T09:00:00Z" },
      ]),
    ).toEqual({ valor: 100, pagoEm: "2026-10-20", restante: 2112, outros: 1 });
    // Baixa antiga (sem recebimentos separados): a baixa inteira.
    expect(ultimoRecebimento(f, [])).toEqual({ valor: 2212, pagoEm: "2026-10-20", restante: 0, outros: 0 });
  });
});
