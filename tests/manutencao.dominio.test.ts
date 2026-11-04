import { describe, expect, it } from "vitest";
import {
  chamadoEmGarantia,
  compararOrcamentos,
  efeitoNaAprovacao,
  garantiaAte,
  mediaNotas,
  mensagemPedidoOrcamento,
  parteDoProprietario,
  partesDaResponsabilidade,
  planoFinanceiro,
  podeConfirmarServico,
  podeDecidirChamado,
  podeIrPara,
  prazoAtendimento,
  precisaAprovacaoProprietario,
  responsavelEfetivo,
  resumoPorImovel,
  resumoPrestadores,
  situacaoGarantia,
  situacaoPrazo,
  statusAoEscolherOrcamento,
  sugerirResponsabilidade,
  textoPrazo,
} from "@/lib/dominio/manutencao";

describe("urgência e prazo de atendimento", () => {
  it("soma as horas da urgência (igual ao gatilho do banco)", () => {
    expect(prazoAtendimento("2026-11-03T12:00:00.000Z", "emergencia")).toBe("2026-11-03T16:00:00.000Z");
    expect(prazoAtendimento("2026-11-03T12:00:00.000Z", "alta")).toBe("2026-11-04T12:00:00.000Z");
    expect(prazoAtendimento("2026-11-03T12:00:00.000Z", "media")).toBe("2026-11-06T12:00:00.000Z");
    expect(prazoAtendimento("2026-11-03T12:00:00.000Z", "baixa")).toBe("2026-11-10T12:00:00.000Z");
    expect(prazoAtendimento("2026-11-03T12:00:00.000Z", "qualquer")).toBe("2026-11-06T12:00:00.000Z");
  });

  it("atrasado só enquanto ninguém agendou o serviço", () => {
    const agora = "2026-11-03T20:00:00.000Z";
    expect(situacaoPrazo({ status: "aberto", prazo_atendimento: "2026-11-03T16:00:00.000Z" }, agora)).toEqual({ situacao: "atrasado", horas: -4 });
    expect(situacaoPrazo({ status: "em_analise", prazo_atendimento: "2026-11-04T20:00:00.000Z" }, agora)).toEqual({ situacao: "no_prazo", horas: 24 });
    expect(situacaoPrazo({ status: "agendado", prazo_atendimento: "2026-11-03T16:00:00.000Z" }, agora).situacao).toBe("atendido");
    expect(textoPrazo(-4)).toBe("atrasado há 4 h");
    expect(textoPrazo(72)).toBe("faltam 3 dias");
  });
});

describe("fluxo de status", () => {
  it("segue o caminho e permite reabrir", () => {
    expect(podeIrPara("aberto", "em_analise")).toBe(true);
    expect(podeIrPara("aberto", "concluido")).toBe(false);
    expect(podeIrPara("em_analise", "aguardando_aprovacao")).toBe(true);
    expect(podeIrPara("aguardando_aprovacao", "em_analise")).toBe(true);
    expect(podeIrPara("concluido", "avaliado")).toBe(true);
    expect(podeIrPara("cancelado", "em_analise")).toBe(true);
    expect(podeIrPara("avaliado", "aberto")).toBe(false);
  });
});

describe("responsabilidade financeira", () => {
  it("sugere pela categoria", () => {
    expect(sugerirResponsabilidade("telhado").responsavel).toBe("proprietario");
    expect(sugerirResponsabilidade("chaveiro").responsavel).toBe("locatario");
    expect(sugerirResponsabilidade("pintura").responsavel).toBe("locatario");
    expect(sugerirResponsabilidade("outros").motivo).toContain("contrato");
  });

  it("divide em percentuais e valida", () => {
    expect(partesDaResponsabilidade("locatario", "imobiliaria")).toEqual({ locatario: 100, proprietario: 0, imobiliaria: 0 });
    expect(partesDaResponsabilidade("dividido", "imobiliaria", { locatario: 30, proprietario: 50, imobiliaria: 20 })).toEqual({ locatario: 30, proprietario: 50, imobiliaria: 20 });
    expect(() => partesDaResponsabilidade("dividido", "imobiliaria", { locatario: 30, proprietario: 50 })).toThrow("somar 100%");
    expect(() => partesDaResponsabilidade("dividido", "imobiliaria", { proprietario: 100 })).toThrow("duas partes");
    expect(() => partesDaResponsabilidade("imobiliaria", "pessoal")).toThrow("modo pessoal");
    // No pessoal a parte da imobiliária é ignorada
    expect(() => partesDaResponsabilidade("dividido", "pessoal", { locatario: 50, proprietario: 30, imobiliaria: 20 })).toThrow("somar 100%");
  });

  it("aprovação do proprietário só na imobiliária e quando ele paga algo", () => {
    expect(precisaAprovacaoProprietario("imobiliaria", { locatario: 0, proprietario: 100, imobiliaria: 0 })).toBe(true);
    expect(precisaAprovacaoProprietario("imobiliaria", { locatario: 100, proprietario: 0, imobiliaria: 0 })).toBe(false);
    expect(precisaAprovacaoProprietario("pessoal", { locatario: 0, proprietario: 100, imobiliaria: 0 })).toBe(false);
  });
});

describe("aprovação do proprietário quando muda quem paga", () => {
  const base = { modo: "imobiliaria" as const, aprovacaoStatus: "aprovado" };
  it("parte dele apareceu ou aumentou depois do serviço aprovado: pede de novo (em qualquer etapa antes da conclusão)", () => {
    expect(efeitoNaAprovacao({ ...base, status: "aprovado", aprovacaoStatus: "nao_precisa", parteAntes: 0, parteDepois: 100 })).toBe("pedir");
    expect(efeitoNaAprovacao({ ...base, status: "agendado", parteAntes: 50, parteDepois: 100 })).toBe("pedir");
    expect(efeitoNaAprovacao({ ...base, status: "em_execucao", aprovacaoStatus: "nao_precisa", parteAntes: 0, parteDepois: 40 })).toBe("pedir");
  });
  it("parte dele igual ou menor depois de aprovar: segue", () => {
    expect(efeitoNaAprovacao({ ...base, status: "agendado", parteAntes: 100, parteDepois: 50 })).toBe("manter");
    expect(efeitoNaAprovacao({ ...base, status: "em_execucao", parteAntes: 60, parteDepois: 60 })).toBe("manter");
    expect(efeitoNaAprovacao({ ...base, status: "aprovado", aprovacaoStatus: "nao_precisa", parteAntes: 0, parteDepois: 0 })).toBe("manter");
  });
  it("esperando a resposta e a parte dele zerou: libera; se continua, espera", () => {
    expect(efeitoNaAprovacao({ ...base, status: "aguardando_aprovacao", aprovacaoStatus: "pendente", parteAntes: 100, parteDepois: 0 })).toBe("liberar");
    expect(efeitoNaAprovacao({ ...base, status: "aguardando_aprovacao", aprovacaoStatus: "pendente", parteAntes: 100, parteDepois: 30 })).toBe("manter");
  });
  it("antes do orçamento escolhido, depois de concluído e no modo pessoal: nada muda", () => {
    expect(efeitoNaAprovacao({ ...base, status: "em_analise", parteAntes: 0, parteDepois: 100 })).toBe("manter");
    expect(efeitoNaAprovacao({ ...base, status: "concluido", parteAntes: 0, parteDepois: 100 })).toBe("manter");
    expect(efeitoNaAprovacao({ ...base, modo: "pessoal", status: "agendado", parteAntes: 0, parteDepois: 100 })).toBe("manter");
  });
  it("parte do proprietário segura (divisão inválida conta como zero)", () => {
    expect(parteDoProprietario("proprietario", "imobiliaria")).toBe(100);
    expect(parteDoProprietario("dividido", "imobiliaria", { locatario: 30, proprietario: 70 })).toBe(70);
    expect(parteDoProprietario("dividido", "imobiliaria", { locatario: 30, proprietario: 30 })).toBe(0);
    expect(parteDoProprietario(null, "imobiliaria")).toBe(0);
  });
});

describe("plano de lançamentos no financeiro", () => {
  it("imobiliária, proprietário: conta a pagar marcada para descontar no repasse", () => {
    const p = planoFinanceiro({ modo: "imobiliaria", valor: 850, responsabilidade: "proprietario", titulo: "Telhado" });
    expect(p.pagar).toEqual([{ tipo: "pagar", parte: "proprietario", valor: 850, descontarRepasse: true, descricao: "Manutenção — Telhado" }]);
    expect(p.cobrarLocatario).toBe(0);
  });

  it("pessoal, proprietário: despesa comum (sem repasse)", () => {
    const p = planoFinanceiro({ modo: "pessoal", valor: 850, responsabilidade: "proprietario" });
    expect(p.pagar).toEqual([{ tipo: "pagar", parte: "proprietario", valor: 850, descontarRepasse: false, descricao: "Manutenção" }]);
  });

  it("dividido em centavos sem perder nada", () => {
    const p = planoFinanceiro({ modo: "imobiliaria", valor: 100, responsabilidade: "dividido", partes: { locatario: 33.333, proprietario: 33.333, imobiliaria: 33.334 } });
    expect(p.partes.locatario + p.partes.proprietario + p.partes.imobiliaria).toBeCloseTo(100, 10);
    expect(p.pagar.map((l) => [l.parte, l.valor, l.descontarRepasse])).toEqual([
      ["proprietario", p.partes.proprietario, true],
      ["geral", 100 - p.partes.proprietario, false],
    ]);
    expect(p.pagar[1].descricao).toContain("locatário e imobiliária");
    expect(p.cobrarLocatario).toBe(p.partes.locatario);
  });

  it("locatário: pagamos o prestador e cobramos dele", () => {
    const p = planoFinanceiro({ modo: "imobiliaria", valor: 120.5, responsabilidade: "locatario" });
    expect(p.pagar).toEqual([{ tipo: "pagar", parte: "locatario", valor: 120.5, descontarRepasse: false, descricao: "Manutenção" }]);
    expect(p.cobrarLocatario).toBe(120.5);
  });

  it("pago direto pelo responsável: nada a lançar; não vale com divisão nem para a imobiliária", () => {
    const p = planoFinanceiro({ modo: "imobiliaria", valor: 300, responsabilidade: "locatario", pagoDireto: true });
    expect(p.pagar).toEqual([]);
    expect(p.cobrarLocatario).toBe(0);
    expect(() => planoFinanceiro({ modo: "imobiliaria", valor: 300, responsabilidade: "dividido", partes: { locatario: 50, proprietario: 50 }, pagoDireto: true })).toThrow("dividida");
    expect(() => planoFinanceiro({ modo: "imobiliaria", valor: 300, responsabilidade: "imobiliaria", pagoDireto: true })).toThrow("imobiliária");
    expect(() => planoFinanceiro({ modo: "imobiliaria", valor: 0, responsabilidade: "locatario" })).toThrow("valor");
  });
});

describe("orçamentos", () => {
  it("ordena pelo valor e marca o mais barato, o mais rápido e a maior garantia", () => {
    const r = compararOrcamentos([
      { id: "a", valor: 900, prazo_dias: 5, garantia_dias: 90 },
      { id: "b", valor: 750, prazo_dias: 7, garantia_dias: 30 },
      { id: "c", valor: null, prazo_dias: null, garantia_dias: null, status: "solicitado" },
      { id: "d", valor: 1200, prazo_dias: 2, garantia_dias: 180 },
    ]);
    expect(r.map((o) => o.id)).toEqual(["b", "a", "d", "c"]);
    expect(r.find((o) => o.id === "b")).toMatchObject({ menorValor: true, menorPrazo: false, diferencaMenor: 0 });
    expect(r.find((o) => o.id === "a")).toMatchObject({ menorValor: false, diferencaMenor: 150 });
    expect(r.find((o) => o.id === "d")).toMatchObject({ menorPrazo: true, maiorGarantia: true });
    expect(r.find((o) => o.id === "c")).toMatchObject({ menorValor: false, diferencaMenor: null });
  });
});

describe("garantia", () => {
  it("calcula até quando e a situação", () => {
    expect(garantiaAte("2026-11-03", 90)).toBe("2027-02-01");
    expect(garantiaAte("2026-11-03", 0)).toBeNull();
    expect(situacaoGarantia(null, "2026-11-03")).toBe("sem");
    expect(situacaoGarantia("2026-11-02", "2026-11-03")).toBe("vencida");
    expect(situacaoGarantia("2026-11-20", "2026-11-03")).toBe("vencendo");
    expect(situacaoGarantia("2027-02-01", "2026-11-03")).toBe("ativa");
  });

  it("acha o chamado anterior do mesmo imóvel e categoria ainda na garantia", () => {
    const anteriores = [
      { id: "1", imovel_id: "i", categoria: "telhado", status: "concluido", garantia_ate: "2026-12-01" },
      { id: "2", imovel_id: "i", categoria: "telhado", status: "avaliado", garantia_ate: "2027-03-01" },
      { id: "3", imovel_id: "i", categoria: "hidraulica", status: "concluido", garantia_ate: "2027-03-01" },
      { id: "4", imovel_id: "j", categoria: "telhado", status: "concluido", garantia_ate: "2027-03-01" },
      { id: "5", imovel_id: "i", categoria: "telhado", status: "concluido", garantia_ate: "2026-10-01" },
    ];
    expect(chamadoEmGarantia({ imovel_id: "i", categoria: "telhado" }, anteriores, "2026-11-03")?.id).toBe("2");
    expect(chamadoEmGarantia({ imovel_id: "i", categoria: "pintura" }, anteriores, "2026-11-03")).toBeNull();
  });
});

describe("avaliação e histórico", () => {
  it("média das notas e resumo por prestador e por imóvel", () => {
    expect(mediaNotas([5, 4, null, 4])).toBe(4.3);
    expect(mediaNotas([])).toBeNull();
    const chamados = [
      { prestador_id: "p", imovel_id: "i", status: "avaliado", avaliacao_nota: 5, valor_final: "300.10", concluido_em: "2026-10-01", garantia_ate: "2027-01-01", created_at: "2026-09-28T10:00:00Z" },
      { prestador_id: "p", imovel_id: "i", status: "concluido", avaliacao_nota: null, valor_final: 199.9, concluido_em: "2026-11-01", garantia_ate: null, created_at: "2026-10-28T10:00:00Z" },
      { prestador_id: "p", imovel_id: "j", status: "agendado", avaliacao_nota: null, valor_final: null, concluido_em: null, garantia_ate: null, created_at: "2026-11-02T10:00:00Z" },
      { prestador_id: "q", imovel_id: "j", status: "avaliado", avaliacao_nota: 2, valor_final: 50, concluido_em: "2026-09-01", garantia_ate: "2026-10-01", created_at: "2026-08-28T10:00:00Z" },
    ];
    const p = resumoPrestadores(chamados);
    expect(p.get("p")).toEqual({ servicos: 2, avaliacoes: 1, media: 5, gasto: 500, ultimo: "2026-11-01", emAndamento: 1 });
    expect(p.get("q")?.media).toBe(2);
    const im = resumoPorImovel(chamados, "2026-11-03");
    expect(im.get("i")).toEqual({ chamados: 2, abertos: 0, gasto: 500, ultimo: "2026-11-01", garantias: 1 });
    expect(im.get("j")).toMatchObject({ chamados: 2, abertos: 1, gasto: 50, garantias: 0 });
  });

  it("mensagem pronta para pedir orçamento", () => {
    const m = mensagemPedidoOrcamento({ prestador: "Paulo Silva", numero: 7, categoria: "hidraulica", titulo: "Vazamento", descricao: null, endereco: "Rua A, 10", urgencia: "alta" });
    expect(m).toContain("Olá Paulo!");
    expect(m).toContain("chamado #7");
    expect(m).toContain("valor, prazo e garantia");
    expect(m).not.toContain("Detalhes");
  });
});

describe("correções da 2ª revisão", () => {
  it("quem decide é lista fechada (papel novo ou vazio não decide)", () => {
    expect(["admin", "gestor", "financeiro"].map(podeDecidirChamado)).toEqual([true, true, true]);
    expect(podeDecidirChamado("corretor")).toBe(false);
    expect(podeDecidirChamado("estagiario")).toBe(false);
    expect(podeDecidirChamado(null)).toBe(false);
  });

  it("“A definir” conta como a sugestão da categoria também para a aprovação do proprietário", () => {
    expect(responsavelEfetivo(null, "telhado")).toBe("proprietario");
    expect(responsavelEfetivo("", "chaveiro")).toBe("locatario");
    expect(responsavelEfetivo("imobiliaria", "telhado")).toBe("imobiliaria");
    // Telhado aguardando o proprietário e alguém troca para "A definir": a parte dele continua 100% → nada de liberar sem ele.
    const depois = parteDoProprietario(responsavelEfetivo(null, "telhado"), "imobiliaria");
    expect(efeitoNaAprovacao({ modo: "imobiliaria", status: "aguardando_aprovacao", aprovacaoStatus: "pendente", parteAntes: 100, parteDepois: depois })).toBe("manter");
  });

  it("escolher outro orçamento num pedido de novo guarda a etapa de antes", () => {
    expect(statusAoEscolherOrcamento({ precisa: true, status: "em_analise", statusAntes: null })).toEqual({ status: "aguardando_aprovacao", status_antes_aprovacao: null });
    expect(statusAoEscolherOrcamento({ precisa: false, status: "em_analise", statusAntes: null })).toEqual({ status: "aprovado", status_antes_aprovacao: null });
    expect(statusAoEscolherOrcamento({ precisa: true, status: "aguardando_aprovacao", statusAntes: "agendado" })).toEqual({ status: "aguardando_aprovacao", status_antes_aprovacao: "agendado" });
    expect(statusAoEscolherOrcamento({ precisa: false, status: "aguardando_aprovacao", statusAntes: "em_execucao" })).toEqual({ status: "em_execucao", status_antes_aprovacao: null });
  });

  it("locatário só confirma o serviço depois do horário marcado", () => {
    const agora = "2026-11-05T15:00:00.000Z";
    expect(podeConfirmarServico({ status: "agendado", agendado_para: "2026-11-10T12:00:00.000Z" }, agora)).toBe(false);
    expect(podeConfirmarServico({ status: "agendado", agendado_para: "2026-11-05T12:00:00.000Z" }, agora)).toBe(true);
    expect(podeConfirmarServico({ status: "agendado", agendado_para: null }, agora)).toBe(false);
    expect(podeConfirmarServico({ status: "em_execucao", agendado_para: null }, agora)).toBe(true);
    expect(podeConfirmarServico({ status: "aprovado", agendado_para: null }, agora)).toBe(false);
  });

  it("histórico por imóvel usa o dia de Brasília (aberto às 22h não vira o dia seguinte)", () => {
    const im = resumoPorImovel([{ imovel_id: "i", status: "aberto", valor_final: null, concluido_em: null, garantia_ate: null, created_at: "2026-11-06T01:30:00.000Z" }], "2026-11-05");
    expect(im.get("i")?.ultimo).toBe("2026-11-05");
  });
});
