import { describe, expect, it } from "vitest";
import {
  analisarChavePix,
  cnpjValido,
  cotasDaDespesa,
  cpfValido,
  crc16,
  normalizarChavePix,
  pixCopiaECola,
  planejarDescontos,
  podeAprovarRepasse,
  repasseAtrasado,
  situacaoDespesa,
  situacaoRepasse,
  totaisDemonstrativo,
  type DespesaADescontar,
} from "@/lib/dominio/repasses";
import {
  dataEsperada,
  descreverRegra,
  dividirValor,
  escolherRegra,
  previsaoPorMes,
  regraAceitaCondicao,
  SEM_REGRA,
  BASE_REGRA,
  textoComissaoLocacao,
  totaisComissoes,
  valorComissao,
  valorEfetivo,
  type RegraComissao,
} from "@/lib/dominio/comissoes";
import { dividirComissao } from "@/lib/dominio/vendas";

const HOJE = "2026-11-03";

describe("situação do repasse", () => {
  it("a aprovar, agendado, liberado, pago e cancelado", () => {
    const base = { status: "pendente", previsto_para: "2026-11-05", aprovado_em: null, programado_para: null };
    expect(situacaoRepasse(base, HOJE)).toBe("a_aprovar");
    expect(situacaoRepasse({ ...base, aprovado_em: "2026-11-02T10:00:00Z" }, HOJE)).toBe("agendado");
    expect(situacaoRepasse({ ...base, aprovado_em: "x", programado_para: "2026-11-03" }, HOJE)).toBe("a_pagar");
    expect(situacaoRepasse({ ...base, status: "pago" }, HOJE)).toBe("pago");
    expect(situacaoRepasse({ ...base, status: "cancelado" }, HOJE)).toBe("cancelado");
    expect(repasseAtrasado({ ...base, previsto_para: "2026-11-01" }, HOJE)).toBe(true);
    expect(repasseAtrasado({ ...base, previsto_para: "2026-11-01", programado_para: "2026-11-10" }, HOJE)).toBe(false);
    expect(podeAprovarRepasse("financeiro")).toBe(true);
    expect(podeAprovarRepasse("corretor")).toBe(false);
  });
});

describe("despesas autorizadas no repasse", () => {
  const donos = [
    { pessoaId: "b", percentual: 40 },
    { pessoaId: "a", percentual: 60 },
  ];
  const despesa = (d: Partial<DespesaADescontar>): DespesaADescontar => ({
    id: "d1",
    descricao: "Conserto",
    valor: 10000,
    vencimento: "2026-10-01",
    imovelId: "i1",
    descontarDeId: null,
    descontadoPorPessoa: {},
    ...d,
  });

  it("rateia pela participação e soma certo no centavo", () => {
    const cotas = cotasDaDespesa(10001, donos);
    expect(cotas.get("a")! + cotas.get("b")!).toBe(10001);
    expect(cotas.get("a")).toBe(6001);
  });

  it("cada dono paga só a sua cota, e o que já foi descontado não volta", () => {
    const p1 = planejarDescontos({ pessoaId: "a", imovelId: "i1", liquido: 150000 }, [despesa({})], donos);
    expect(p1).toEqual([{ lancamentoId: "d1", descricao: "Conserto", valor: 6000, quita: false, sobra: 0 }]);
    const p2 = planejarDescontos({ pessoaId: "b", imovelId: "i1", liquido: 150000 }, [despesa({ descontadoPorPessoa: { a: 6000 } })], donos);
    expect(p2[0]).toMatchObject({ valor: 4000, quita: true });
    const repetido = planejarDescontos({ pessoaId: "a", imovelId: "i1", liquido: 150000 }, [despesa({ descontadoPorPessoa: { a: 6000 } })], donos);
    expect(repetido).toEqual([]);
  });

  it("despesa de um dono só, de outro imóvel, e limite do líquido", () => {
    const so = despesa({ descontarDeId: "b" });
    expect(planejarDescontos({ pessoaId: "a", imovelId: "i1", liquido: 999999 }, [so], donos)).toEqual([]);
    expect(planejarDescontos({ pessoaId: "b", imovelId: "i1", liquido: 999999 }, [so], donos)[0]).toMatchObject({ valor: 10000, quita: true });
    expect(planejarDescontos({ pessoaId: "a", imovelId: "i2", liquido: 999999 }, [despesa({})], donos)).toEqual([]);
    const curto = planejarDescontos({ pessoaId: "b", imovelId: "i1", liquido: 2500 }, [so, despesa({ id: "d2", vencimento: "2026-12-01" })], donos);
    expect(curto[0]).toMatchObject({ lancamentoId: "d1", valor: 2500, quita: false, sobra: 7500 });
    expect(curto[1]).toMatchObject({ lancamentoId: "d2", valor: 0, sobra: 4000 });
  });

  it("situação da despesa", () => {
    expect(situacaoDespesa(100, 0).rotulo).toBe("A descontar");
    expect(situacaoDespesa(100, 60)).toMatchObject({ rotulo: "Descontada em parte", falta: 40 });
    expect(situacaoDespesa(100, 100).rotulo).toBe("Descontada");
  });
});

describe("demonstrativo", () => {
  it("soma em centavos e deixa os cancelados de fora", () => {
    const linha = { aluguel: "1800.10", encargos: 0, multa_juros: 0, valor_bruto: "1800.10", taxa_administracao: "180.01", taxa_intermediacao: 0, irrf: 0, imposto: "10", outros_descontos: "0.2", valor_liquido: "1609.89" };
    const t = totaisDemonstrativo([
      { ...linha, status: "pago" },
      { ...linha, status: "pendente" },
      { ...linha, status: "cancelado" },
    ]);
    expect(t.aluguel).toBe(3600.2);
    expect(t.taxas).toBe(360.02);
    expect(t.impostos).toBe(20);
    expect(t.descontos).toBe(0.4);
    expect(t.liquido).toBe(3219.78);
    expect(t.pago).toBe(1609.89);
    expect(t.aPagar).toBe(1609.89);
  });
});

describe("Pix copia-e-cola", () => {
  it("CRC16 do padrão (CCITT-FALSE)", () => {
    expect(crc16("123456789")).toBe("29B1");
  });

  it("monta o BR Code com chave, valor, nome e cidade", () => {
    const pix = pixCopiaECola({ chave: "Ana@Pix.com", nome: "Ana Lúcia da Conceição Proprietária", cidade: "São José dos Pinhais", valor: 1560, txid: "REP-123" });
    expect(pix.startsWith("000201")).toBe(true);
    expect(pix).toContain("0014br.gov.bcb.pix0111ana@pix.com");
    expect(pix).toContain("54071560.00");
    expect(pix).toContain("5925ANA LUCIA DA CONCEICAO P");
    expect(pix).toContain("6015SAO JOSE DOS PI");
    expect(pix).toContain("62100506REP123");
    expect(pix.slice(-4)).toBe(crc16(pix.slice(0, -4)));
    expect(() => pixCopiaECola({ chave: " ", nome: "X" })).toThrow();
  });

  it("normaliza a chave cadastrada", () => {
    expect(normalizarChavePix("123.456.789-09")).toBe("12345678909");
    expect(normalizarChavePix("12.345.678/0001-90")).toBe("12345678000190");
    expect(normalizarChavePix("(51) 99999-8888")).toBe("+5551999998888");
    expect(normalizarChavePix("+55 51 99999-8888")).toBe("+5551999998888");
    expect(normalizarChavePix("123E4567-E89B-12D3-A456-426614174000")).toBe("123e4567-e89b-12d3-a456-426614174000");
    expect(normalizarChavePix("")).toBeNull();
  });

  it("CPF e CNPJ: confere os dígitos verificadores", () => {
    expect(cpfValido("52998224725")).toBe(true);
    expect(cpfValido("12345678909")).toBe(true);
    expect(cpfValido("12945678901")).toBe(false);
    expect(cpfValido("11111111111")).toBe(false);
    expect(cnpjValido("11222333000181")).toBe(true);
    expect(cnpjValido("12345678000190")).toBe(false);
  });

  it("CPF só com números não vira telefone (mesmo com 9 na 3ª posição)", () => {
    // CPF válido que também tem cara de celular: fica CPF, com aviso de ambiguidade.
    expect(analisarChavePix("52998224725")).toMatchObject({ chave: "52998224725", tipo: "cpf", ambigua: true });
    expect(analisarChavePix("52998224725")?.aviso).toMatch(/CPF ou um celular/);
    expect(normalizarChavePix("52998224725")).toBe("52998224725");
    // Formatado como CPF: CPF, sem dúvida.
    expect(analisarChavePix("529.982.247-25")).toMatchObject({ chave: "52998224725", tipo: "cpf", ambigua: false, aviso: null });
    // 11 números que não formam CPF válido e têm formato de celular: celular.
    expect(analisarChavePix("12945678901")).toMatchObject({ chave: "+5512945678901", tipo: "telefone" });
    expect(analisarChavePix("11987654321")).toMatchObject({ chave: "+5511987654321", tipo: "telefone" });
    // Escrito como telefone (espaço/hífen ou parênteses): celular.
    expect(analisarChavePix("11 98765-4321")).toMatchObject({ chave: "+5511987654321", tipo: "telefone" });
    expect(analisarChavePix("(11)98765-4321")).toMatchObject({ chave: "+5511987654321", tipo: "telefone" });
    // CPF com dígitos errados: avisa.
    expect(analisarChavePix("123.456.789-00")?.aviso).toMatch(/não conferem/);
    expect(analisarChavePix("11.222.333/0001-81")).toMatchObject({ chave: "11222333000181", tipo: "cnpj", aviso: null });
    expect(analisarChavePix("ana@pix.com")?.tipo).toBe("email");
    // O Pix copia-e-cola usa a chave como CPF (campo 01 com 11 dígitos), não +55.
    const pix = pixCopiaECola({ chave: "52998224725", nome: "Ana", valor: 10 });
    expect(pix).toContain("0014br.gov.bcb.pix011152998224725");
    expect(pix).not.toContain("+55");
  });
});

describe("regras de comissão", () => {
  const r = (x: Partial<RegraComissao>): RegraComissao => ({
    id: "r",
    tipo: "locacao",
    pessoa_id: null,
    equipe_id: null,
    percentual: 10,
    condicionada: false,
    dias_pagamento: 30,
    ativa: true,
    created_at: "2026-01-01T00:00:00Z",
    ...x,
  });
  const regras = [
    r({ id: "geral-velha", percentual: 30 }),
    r({ id: "geral-nova", percentual: 35, created_at: "2026-06-01T00:00:00Z" }),
    r({ id: "equipe", equipe_id: "e1", percentual: 40 }),
    r({ id: "pessoa", pessoa_id: "p1", percentual: 50 }),
    r({ id: "inativa", pessoa_id: "p2", percentual: 90, ativa: false }),
    r({ id: "venda", tipo: "venda", percentual: 60 }),
  ];

  it("corretor > equipe > geral (a mais nova)", () => {
    expect(escolherRegra(regras, "locacao", "p1", "e1")?.id).toBe("pessoa");
    expect(escolherRegra(regras, "locacao", "p3", "e1")?.id).toBe("equipe");
    expect(escolherRegra(regras, "locacao", "p2", null)?.id).toBe("geral-nova");
    expect(escolherRegra(regras, "administracao", "p1", "e1")).toBeNull();
    expect(escolherRegra(regras, "venda", "p1", "e1")?.id).toBe("venda");
  });

  it("valor, divisão e textos batem com o banco", () => {
    expect(valorComissao(2500, 40)).toBe(1000);
    expect(valorComissao(333.33, 33.333)).toBe(111.11);
    expect(dividirValor(900, 50)).toEqual({ outro: 450, fica: 450 });
    expect(dividirValor(100, 33.333)).toEqual({ outro: 33.33, fica: 66.67 });
    expect(descreverRegra({ percentual: 40, condicionada: true, dias_pagamento: 10 })).toBe("40% · paga em 10 dias · só depois que a imobiliária receber");
    expect(textoComissaoLocacao(null)).toContain("quando a proposta é aceita");
    expect(textoComissaoLocacao({ condicionada: true, dias_pagamento: 15 })).toContain("próximo aluguel do imóvel");
  });

  it("divisão da venda igual ao concluir_venda (arredonda e nunca passa do total)", () => {
    const d = dividirComissao(30000, [{ percentual: 60 }, { percentual: 40 }]);
    expect(d.porPessoa).toEqual([18000, 12000]);
    expect(d.imobiliaria).toBe(0);
    const metade = dividirComissao(0.05, [{ percentual: 50 }, { percentual: 50 }]);
    expect(metade.porPessoa).toEqual([0.03, 0.02]);
    expect(metade.imobiliaria).toBe(0);
    const resto = dividirComissao(20000, [{ percentual: 33.333 }, { percentual: 33.333 }]);
    expect(resto.porPessoa).toEqual([6666.6, 6666.6]);
    expect(resto.imobiliaria).toBe(6666.8);
  });
});

describe("totais e previsão de comissões", () => {
  const lista = [
    { status: "prevista", valor: "100.10", previsao: "2026-12-10" },
    { status: "a_pagar", valor: 200, vencimento: "2026-10-30" },
    { status: "a_pagar", valor: 50, vencimento: "2026-11-20" },
    { status: "paga", valor: 300 },
    { status: "estornada", valor: 40 },
    { status: "cancelada", valor: 999 },
  ];

  it("totais", () => {
    expect(totaisComissoes(lista, HOJE)).toEqual({ previstas: 100.1, aPagar: 250, pagas: 300, estornadas: 40, vencidas: 200, quantidade: 5 });
  });

  it("data esperada e previsão por mês (atrasado cai no mês atual)", () => {
    expect(dataEsperada({ status: "prevista", valor: 1, created_at: "2026-11-01T12:00:00Z" })).toBe("2026-12-01");
    expect(dataEsperada({ status: "paga", valor: 1 })).toBeNull();
    const p = previsaoPorMes(
      [
        { data: "2026-10-30", valor: 200, origem: "a_pagar" },
        { data: "2026-11-20", valor: 50, origem: "a_pagar" },
        { data: "2026-12-10", valor: 100.1, origem: "prevista" },
        { data: null, valor: 500, origem: "venda_aberta" },
        { data: "2027-01-05", valor: 18, origem: "administracao" },
        { data: "2030-01-01", valor: 1, origem: "prevista" },
      ],
      HOJE,
      3,
    );
    expect(p.meses.map((m) => [m.mes, m.total])).toEqual([
      ["2026-11", 250],
      ["2026-12", 100.1],
      ["2027-01", 18],
    ]);
    expect(p.meses[0].aPagar).toBe(250);
    expect(p.semData).toBe(500);
    expect(p.total).toBe(868.1);
  });
});

describe("ajustes de comissão e textos das regras", () => {
  it("valor efetivo = pago + complementos − devoluções (estornada/cancelada = zero)", () => {
    expect(valorEfetivo({ status: "paga", valor: 8000 }, { complementos: 200, devolucoes: 0 })).toBe(8200);
    expect(valorEfetivo({ status: "paga", valor: 8000 }, { complementos: "0", devolucoes: "1000.00" })).toBe(7000);
    expect(valorEfetivo({ status: "paga", valor: "8000.00" }, null)).toBe(8000);
    expect(valorEfetivo({ status: "a_pagar", valor: 1234.56 })).toBe(1234.56);
    expect(valorEfetivo({ status: "estornada", valor: 8000 }, { complementos: 500, devolucoes: 0 })).toBe(0);
    expect(valorEfetivo({ status: "cancelada", valor: 10 })).toBe(0);
  });

  it("textos não prometem conta diferente da do banco", () => {
    // Sem regra de venda o banco dá 100% − a parte do captador (least(100, 100 − captador)).
    expect(SEM_REGRA.venda).toMatch(/100% da comissão da venda menos a parte do captador/);
    expect(BASE_REGRA.venda).toMatch(/100% menos a parte do captador/);
    expect(SEM_REGRA.angariacao).not.toMatch(/30 dias/);
    expect(SEM_REGRA.administracao).not.toMatch(/30 dias/);
    // Administração nunca espera recebimento (o banco força e recusa a condição).
    expect(regraAceitaCondicao("administracao")).toBe(false);
    expect(regraAceitaCondicao("locacao")).toBe(true);
    expect(descreverRegra({ tipo: "administracao", percentual: 10, condicionada: false, dias_pagamento: 30 })).toBe("10% · paga em 30 dias · taxa já recebida na baixa");
    expect(textoComissaoLocacao({ condicionada: true, dias_pagamento: 15 })).toMatch(/volta a ficar prevista/);
  });
});
