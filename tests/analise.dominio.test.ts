import { describe, expect, it } from "vitest";
import {
  CONFIG_PADRAO,
  aluguelMaximo,
  aprovacaoVencida,
  checarConsultaCredito,
  checklistPadrao,
  comprometimentoPct,
  configComPadrao,
  contratoSugerido,
  custoMensal,
  diasParaVencer,
  faixaVencimento,
  foraDaRegra,
  formatarPct,
  linkNovoContrato,
  mensagemFicha,
  mensagemGarantidora,
  mensagemProprietario,
  mensagemRenovacao,
  normalizarResultadoCredito,
  papelAprovaExcecao,
  papelDecide,
  progressoDocumentos,
  rendaComprovada,
  rendaDeclarada,
  rendaMinimaFiador,
  semaforoComprometimento,
  situacaoDocumento,
  textoConsentimentoPadrao,
  ultimaConsulta,
  validarDecisao,
  type DadosRegra,
} from "@/lib/dominio/analise";

const base: DadosRegra = {
  aluguel: 1500,
  encargos: 300,
  documentoCandidato: "529.982.247-25",
  rendas: [{ valor_declarado: 7000, valor_comprovado: "7000.00" }],
  consultas: [{ consultado_em: "2026-11-01", score: 820, restricoes: false }],
  documentos: [
    { status: "validado", obrigatorio: true },
    { status: "dispensado", obrigatorio: true },
    { status: "pendente", obrigatorio: false },
  ],
  garantias: [{ status: "aprovada" }],
  fiadores: [],
};

describe("renda e comprometimento", () => {
  it("soma em centavos, separa candidato e fiador e calcula o %", () => {
    const rendas = [
      { valor_declarado: "3000.10", valor_comprovado: "3000.10" },
      { valor_declarado: 2000.2, valor_comprovado: 1999.9 },
      { valor_declarado: 500, valor_comprovado: null },
      { valor_declarado: 6000, valor_comprovado: 6000, fiador_id: "f1" },
    ];
    expect(rendaComprovada(rendas)).toBe(5000);
    expect(rendaDeclarada(rendas)).toBe(5500.3);
    expect(rendaComprovada(rendas, "f1")).toBe(6000);
    expect(custoMensal("1500.10", 299.9)).toBe(1800);
    expect(comprometimentoPct(1500, 300, 5000)).toBe(36);
    expect(comprometimentoPct(1000, 0, 3000)).toBe(33.3);
    expect(comprometimentoPct(1000, 0, 0)).toBeNull();
  });

  it("semáforo verde, amarelo, vermelho e sem renda", () => {
    const cfg = { limite_comprometimento_pct: 30, alerta_comprometimento_pct: 25 };
    expect(semaforoComprometimento(25, cfg)).toBe("verde");
    expect(semaforoComprometimento(25.1, cfg)).toBe("amarelo");
    expect(semaforoComprometimento(30, cfg)).toBe("amarelo");
    expect(semaforoComprometimento(30.1, cfg)).toBe("vermelho");
    expect(semaforoComprometimento(null, cfg)).toBe("sem_renda");
  });

  it("renda mínima do fiador e aluguel máximo pela regra", () => {
    expect(rendaMinimaFiador(1500, 300, 3)).toBe(5400);
    expect(rendaMinimaFiador("1500.50", 0, 2.5)).toBe(3751.25);
    expect(aluguelMaximo(6000, 300, 30)).toBe(1500);
    expect(aluguelMaximo(1000, 500, 30)).toBe(0);
  });
});

describe("regras para aprovar (igual ao banco)", () => {
  it("dentro da regra não lista nada", () => {
    expect(foraDaRegra(base, CONFIG_PADRAO)).toEqual([]);
  });

  it("aponta cada regra quebrada com o mesmo texto do banco", () => {
    const vazio: DadosRegra = { ...base, documentoCandidato: "111.111.111-11", rendas: [], consultas: [], documentos: [{ status: "pendente", obrigatorio: true }, { status: "recebido", obrigatorio: true }], garantias: [{ status: "solicitada" }] };
    expect(foraDaRegra(vazio, CONFIG_PADRAO).map((m) => m.texto)).toEqual([
      "Renda não comprovada",
      "CPF/CNPJ do candidato ausente ou inválido",
      "Sem consulta de crédito registrada",
      "2 documento(s) obrigatório(s) sem validação",
      "Nenhuma garantia aprovada",
    ]);
    const alto = { ...base, rendas: [{ valor_comprovado: 5000 }] };
    expect(foraDaRegra(alto, CONFIG_PADRAO)).toEqual([{ codigo: "comprometimento", texto: "Comprometimento de 36,0% da renda (limite 30%)" }]);
    expect(foraDaRegra(alto, { ...CONFIG_PADRAO, limite_comprometimento_pct: 37.5 })).toEqual([]);
  });

  it("vale a consulta mais recente; score mínimo e restrições configuráveis", () => {
    const consultas = [
      { consultado_em: "2026-10-01", score: 400, restricoes: true },
      { consultado_em: "2026-11-02", score: 650, restricoes: true },
      { consultado_em: "2026-11-03", score: 900, restricoes: false, fiador_id: "f1" },
    ];
    expect(ultimaConsulta(consultas)?.score).toBe(650);
    expect(ultimaConsulta(consultas, "f1")?.score).toBe(900);
    const d = { ...base, consultas };
    expect(foraDaRegra(d, { ...CONFIG_PADRAO, score_minimo: 700 }).map((m) => m.codigo)).toEqual(["score", "restricoes"]);
    expect(foraDaRegra(d, { ...CONFIG_PADRAO, aceitar_restricoes: true })).toEqual([]);
    expect(foraDaRegra({ ...base, consultas: [] }, { ...CONFIG_PADRAO, exigir_consulta: false })).toEqual([]);
  });

  it("fiador aprovado conta como garantia, mas precisa de renda", () => {
    const d = { ...base, garantias: [], fiadores: [{ id: "f1", nome: "Fernando", status: "aprovado" }], rendas: [...base.rendas, { valor_comprovado: 5000, fiador_id: "f1" }] };
    expect(foraDaRegra(d, CONFIG_PADRAO)).toEqual([{ codigo: "fiador_renda", texto: "Fiador Fernando com renda abaixo de 3× o aluguel e encargos" }]);
    expect(foraDaRegra({ ...d, rendas: [...base.rendas, { valor_comprovado: 5400, fiador_id: "f1" }] }, CONFIG_PADRAO)).toEqual([]);
    expect(foraDaRegra({ ...base, garantias: [] }, { ...CONFIG_PADRAO, exigir_garantia: false })).toEqual([]);
  });
});

describe("decisão", () => {
  it("valida justificativa, condições, papel e exceção", () => {
    const ok = { decisao: "aprovado", justificativa: "Renda e crédito em ordem", foraDaRegra: 0, papel: "financeiro" };
    expect(validarDecisao(ok)).toBeNull();
    expect(validarDecisao({ ...ok, decisao: null })).toBe("Escolha a decisão.");
    expect(validarDecisao({ ...ok, papel: "corretor" })).toContain("não pode decidir");
    expect(validarDecisao({ ...ok, justificativa: "ok" })).toContain("justificativa da decisão");
    expect(validarDecisao({ ...ok, decisao: "aprovado_condicoes" })).toContain("condições");
    expect(validarDecisao({ ...ok, foraDaRegra: 2 })).toContain("só administrador ou gestor");
    expect(validarDecisao({ ...ok, foraDaRegra: 2, papel: "gestor" })).toContain("justificativa da exceção");
    expect(validarDecisao({ ...ok, foraDaRegra: 2, papel: "gestor", excecaoJustificativa: "Cliente antigo e pontual" })).toBeNull();
    // Reprovar fora da regra não é exceção
    expect(validarDecisao({ ...ok, decisao: "reprovado", foraDaRegra: 3 })).toBeNull();
    expect(papelDecide("admin") && papelDecide("financeiro") && !papelDecide("corretor")).toBe(true);
    expect(papelAprovaExcecao("gestor") && !papelAprovaExcecao("financeiro")).toBe(true);
  });

  it("aprovação vence se não virar contrato no prazo", () => {
    expect(aprovacaoVencida({ status: "aprovada", validade_ate: "2026-11-02" }, "2026-11-03")).toBe(true);
    expect(aprovacaoVencida({ status: "aprovada", validade_ate: "2026-11-03" }, "2026-11-03")).toBe(false);
    expect(aprovacaoVencida({ status: "contratada", validade_ate: "2026-01-01" }, "2026-11-03")).toBe(false);
  });
});

describe("documentos e checklist", () => {
  it("checklist por tipo de pessoa e parte", () => {
    const pf = checklistPadrao("candidato", "PF");
    expect(pf[0].item).toBe("rg_cpf");
    expect(pf.filter((i) => i.obrigatorio)).toHaveLength(3);
    expect(checklistPadrao("candidato", "PJ").some((i) => i.item === "contrato_social")).toBe(true);
    expect(checklistPadrao("fiador", "PF").some((i) => i.item === "matricula" && i.obrigatorio)).toBe(true);
    expect(checklistPadrao("fiador", null)).toEqual(checklistPadrao("fiador", "PF"));
    // Cópia: mexer no resultado não muda o padrão
    pf[0].rotulo = "x";
    expect(checklistPadrao("candidato", "PF")[0].rotulo).not.toBe("x");
  });

  it("progresso e validação de CPF/CNPJ", () => {
    expect(progressoDocumentos(base.documentos)).toEqual({ total: 3, validados: 2, recebidos: 0, recusados: 0, obrigatorios: 2, obrigatoriosPendentes: 0, pct: 67 });
    expect(situacaoDocumento("529.982.247-25")).toBe("valido");
    expect(situacaoDocumento("11.222.333/0001-81")).toBe("valido");
    expect(situacaoDocumento("123")).toBe("invalido");
    expect(situacaoDocumento(null)).toBe("ausente");
  });
});

describe("vencimentos", () => {
  it("faixas de 30/60/90 dias", () => {
    const hoje = "2026-11-03";
    expect(faixaVencimento("2026-11-02", hoje)).toBe("vencida");
    expect(faixaVencimento("2026-11-03", hoje)).toBe("30");
    expect(faixaVencimento("2026-12-03", hoje)).toBe("30");
    expect(faixaVencimento("2026-12-04", hoje)).toBe("60");
    expect(faixaVencimento("2027-02-01", hoje)).toBe("90");
    expect(faixaVencimento("2027-03-01", hoje)).toBe("depois");
    expect(faixaVencimento(null, hoje)).toBe("sem_data");
    expect(diasParaVencer("2026-11-13", hoje)).toBe(10);
  });
});

describe("configuração e mensagens", () => {
  it("regras com padrão (numeric do banco chega como texto)", () => {
    expect(configComPadrao(null)).toEqual(CONFIG_PADRAO);
    const c = configComPadrao({ limite_comprometimento_pct: "35.00", score_minimo: null, aceitar_restricoes: true });
    expect(c.limite_comprometimento_pct).toBe(35);
    expect(c.alerta_comprometimento_pct).toBe(25);
    expect(c.aceitar_restricoes).toBe(true);
    expect(c.score_minimo).toBeNull();
  });

  it("mensagens prontas e link do contrato", () => {
    const f = mensagemFicha({ nome: "Lia Souza", organizacao: "Imob X", link: "https://x/ficha/abc", validade: "2026-11-18", imovel: "AP-1" });
    expect(f).toContain("Olá, Lia!");
    expect(f).toContain("https://x/ficha/abc");
    expect(f).toContain("18/11/2026");
    expect(mensagemGarantidora({ garantidora: "Porto", tipo: "seguro_fianca", candidato: "Lia", aluguel: 1500, proposta: "P-9", solicitadaEm: "2026-11-01", organizacao: "Imob X" })).toContain(
      "seguro-fiança nº P-9, enviada em 01/11/2026",
    );
    expect(mensagemRenovacao({ para: "seguradora", tipo: "seguro_fianca", apolice: "AP-1", fim: "2026-12-01", contrato: 12, organizacao: "Imob X" })).toContain(
      "Solicitamos a renovação do seguro-fiança (apólice/nº AP-1), que vence em 01/12/2026, ligada ao contrato de locação nº 12",
    );
    expect(mensagemRenovacao({ para: "locatario", nome: "Bruno Lima", tipo: "seguro_incendio", fim: null, organizacao: "Imob X" })).toContain("Olá, Bruno!");
    expect(mensagemProprietario({ proprietario: "Ana", candidato: "Lia", aluguel: 1500, encargos: 300, comprometimento: 25.7, garantia: "Seguro-fiança", decisao: "aprovado", organizacao: "Imob X" })).toContain(
      "compromete 25,7% da renda",
    );
    expect(textoConsentimentoPadrao("Imob X")).toContain("Autorizo Imob X");
    expect(linkNovoContrato({ id: "a1", imovel_id: "i1", candidato_id: "p1", valor_aluguel: "1500.00" })).toBe("/contratos/novo?imovel=i1&locatario=p1&aluguel=1500&analise=a1");
  });
});

describe("percentual, crédito automático e contrato sugerido", () => {
  it("percentual com uma casa: 30,4% não vira 30%", () => {
    expect(formatarPct(30.4)).toBe("30,4%");
    expect(formatarPct(30)).toBe("30,0%");
    expect(formatarPct(25.66)).toBe("25,7%");
    expect(formatarPct(null)).toBe("—");
    // 1.826 / 6.000 = 30,43% → acima do limite de 30% e o número mostra isso
    const pct = comprometimentoPct(1526, 300, 6000);
    expect(pct).toBe(30.4);
    expect(semaforoComprometimento(pct, { limite_comprometimento_pct: 30, alerta_comprometimento_pct: 25 })).toBe("vermelho");
    expect(formatarPct(pct)).toBe("30,4%");
  });

  it("LGPD antes da consulta automática", () => {
    const cpf = "529.982.247-25";
    expect(checarConsultaCredito({ baseLegal: null, documento: cpf, consentimentoEm: null })).toContain("base legal");
    expect(checarConsultaCredito({ baseLegal: "qualquer", documento: cpf, consentimentoEm: null })).toContain("base legal");
    expect(checarConsultaCredito({ baseLegal: "protecao_credito", documento: "123", consentimentoEm: null })).toContain("CPF/CNPJ válido");
    expect(checarConsultaCredito({ baseLegal: "consentimento", documento: cpf, consentimentoEm: null })).toContain("autorização");
    expect(checarConsultaCredito({ baseLegal: "consentimento", documento: cpf, consentimentoEm: "2026-11-01T12:00:00Z" })).toBeNull();
    expect(checarConsultaCredito({ baseLegal: "protecao_credito", documento: "11.222.333/0001-81", consentimentoEm: null })).toBeNull();
  });

  it("resposta do birô conferida antes de gravar", () => {
    expect(normalizarResultadoCredito({ score: "812", restricoes: false, protocolo: "  P-1 " })).toEqual({
      score: 812,
      faixa_risco: null,
      restricoes: false,
      restricoes_qtd: null,
      restricoes_valor: null,
      restricoes_descricao: null,
      protocolo: "P-1",
    });
    // Quantidade ou valor de pendência = tem restrição, mesmo se o flag não veio
    const r = normalizarResultadoCredito({ score: 1500, restricoes_qtd: "2", restricoes_valor: "350.456", restricoes_descricao: "Protesto" });
    expect(r).toMatchObject({ score: null, restricoes: true, restricoes_qtd: 2, restricoes_valor: 350.46, restricoes_descricao: "Protesto" });
    expect(normalizarResultadoCredito({ score: -3, restricoes_qtd: -1 })).toMatchObject({ score: null, restricoes: false, restricoes_qtd: null });
  });

  it("contrato sugerido: candidato locatário, mesmo imóvel, criado depois da decisão", () => {
    const k = (id: string, extra: Partial<{ status: string; imovel_id: string | null; created_at: string; candidatoLocatario: boolean }> = {}) => ({
      id,
      numero: Number(id.replace(/\D/g, "")) || 1,
      status: "ativo",
      imovel_id: "i1",
      created_at: "2026-11-10T10:00:00Z",
      candidatoLocatario: true,
      ...extra,
    });
    const a = { imovel_id: "i1", decidido_em: "2026-11-05T15:00:00Z" };
    expect(contratoSugerido([k("c1", { candidatoLocatario: false })], a)).toBeNull(); // só o imóvel bate
    expect(contratoSugerido([k("c2", { imovel_id: "i2" })], a)).toBeNull(); // outro imóvel
    expect(contratoSugerido([k("c3", { created_at: "2026-11-01T10:00:00Z" })], a)).toBeNull(); // antes da decisão
    expect(contratoSugerido([k("c4", { status: "encerrado" })], a)).toBeNull();
    expect(contratoSugerido([k("c5", { created_at: "2026-11-06T10:00:00Z" }), k("c6", { status: "rascunho", created_at: "2026-11-08T10:00:00Z" })], a)?.id).toBe("c6");
    expect(contratoSugerido([k("c7", { imovel_id: "i9" })], { imovel_id: null, decidido_em: null })?.id).toBe("c7");
  });
});
