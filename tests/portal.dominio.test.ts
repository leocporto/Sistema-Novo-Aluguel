/** Regras puras do Portal de clientes (src/lib/dominio/portal.ts). */
import { describe, expect, it } from "vitest";
import {
  codigoConfirmacao,
  dataDoInforme,
  expiraEm,
  informeRendimentos,
  mensagemPortal,
  perfisDoModo,
  secaoValida,
  secoesPortal,
  situacaoLink,
  tiposDoPerfil,
  tituloTarefa,
  type LinhaInforme,
} from "@/lib/dominio/portal";

describe("confirmação de identidade", () => {
  it("usa os 4 primeiros números do CPF/CNPJ e, sem documento, os 4 últimos do telefone", () => {
    expect(codigoConfirmacao({ documento: "123.456.789-09", telefone: "(51) 99999-1234" })).toEqual({ codigo: "1234", tipo: "cpf" });
    expect(codigoConfirmacao({ documento: "12.345.678/0001-95" })).toEqual({ codigo: "1234", tipo: "cnpj" });
    expect(codigoConfirmacao({ documento: "98765", telefone: null })).toEqual({ codigo: "9876", tipo: "documento" });
    expect(codigoConfirmacao({ documento: "12", telefone: "(51) 99999-4321" })).toEqual({ codigo: "4321", tipo: "telefone" });
    expect(codigoConfirmacao({ documento: null, telefone: "12" })).toBeNull();
    expect(codigoConfirmacao({})).toBeNull();
  });
});

describe("perfis e seções", () => {
  it("no modo pessoal não existe portal do proprietário", () => {
    expect(perfisDoModo("pessoal")).toEqual(["locatario", "prestador"]);
    expect(perfisDoModo("imobiliaria")).toEqual(["proprietario", "locatario", "prestador"]);
    expect(perfisDoModo(undefined)).toContain("proprietario");
  });

  it("cada perfil tem as suas seções", () => {
    expect(secoesPortal("proprietario").map((s) => s.slug)).toEqual(expect.arrayContaining(["imoveis", "repasses", "aprovacoes", "informe"]));
    expect(secoesPortal("locatario").map((s) => s.slug)).toEqual(expect.arrayContaining(["contrato", "cobrancas", "manutencao", "vistorias"]));
    expect(secoesPortal("prestador").map((s) => s.slug)).toEqual(expect.arrayContaining(["ordens", "pagamentos"]));
    expect(secaoValida("locatario", "informe")).toBe(false);
    expect(secaoValida("prestador", "aprovacoes")).toBe(false);
    expect(secaoValida("prestador", "arquivos")).toBe(true);
    expect(tiposDoPerfil("locatario")).toEqual(["renovacao", "desocupacao", "contato"]);
    expect(tiposDoPerfil("proprietario")).toEqual(["contato"]);
  });
});

describe("link", () => {
  const agora = "2026-11-04T12:00:00.000Z";
  it("situação: desativado > expirado > bloqueado > ativo", () => {
    expect(situacaoLink({ ativo: true, expira_em: null }, agora)).toBe("ativo");
    expect(situacaoLink({ ativo: false, expira_em: null }, agora)).toBe("desativado");
    expect(situacaoLink({ ativo: true, expira_em: "2026-11-01T00:00:00.000Z" }, agora)).toBe("expirado");
    expect(situacaoLink({ ativo: true, expira_em: null, bloqueado_ate: "2026-11-04T12:20:00.000Z" }, agora)).toBe("bloqueado");
    expect(situacaoLink({ ativo: true, expira_em: null, bloqueado_ate: "2026-11-04T11:00:00.000Z" }, agora)).toBe("ativo");
  });

  it("validade em dias (0 = sem validade, no máximo 730)", () => {
    const base = new Date("2026-11-04T12:00:00.000Z");
    expect(expiraEm(0, base)).toBeNull();
    expect(expiraEm(30, base)).toBe("2026-12-04T12:00:00.000Z");
    expect(expiraEm(5000, base)).toBe(new Date(base.getTime() + 730 * 86_400_000).toISOString());
  });

  it("mensagem do WhatsApp com o link e a dica de entrada", () => {
    const m = mensagemPortal({ nome: "Ana Maria Souza", perfil: "locatario", link: "https://x/portal/abc", organizacao: "Imob X", tipoCodigo: "cpf" });
    expect(m).toContain("Olá Ana!");
    expect(m).toContain("https://x/portal/abc");
    expect(m).toContain("4 primeiros números do seu CPF");
    expect(m).toContain("não compartilhe");
  });

  it("título da tarefa criada a partir do pedido", () => {
    expect(tituloTarefa({ numero: 7, tipo: "desocupacao", nome: "Bruno" })).toBe("Portal #7: Desocupação (entregar o imóvel) — Bruno");
  });
});

describe("informe de rendimentos", () => {
  const base: Omit<LinhaInforme, "competencia"> = {
    status: "pago",
    faturaPaga: true,
    imovel: "AP-1",
    locatarioNome: "Bruno",
    locatarioDocumento: "111.222.333-44",
    aluguel: 2000,
    encargos: 300,
    multaJuros: 0,
    taxaAdministracao: 200,
    taxaIntermediacao: 0,
    irrf: 0,
    imposto: 0,
    outrosDescontos: 0,
    liquido: 2100,
  };

  it("conta pelo mês em que o aluguel foi pago (regime de caixa)", () => {
    expect(dataDoInforme({ competencia: "2025-12-01", faturaPagoEm: "2026-01-05", repassePagoEm: "2026-01-08" })).toBe("2026-01-05");
    expect(dataDoInforme({ competencia: "2026-03-01", faturaPagoEm: null, repassePagoEm: "2026-03-12" })).toBe("2026-03-12");
    expect(dataDoInforme({ competencia: "2026-04-01" })).toBe("2026-04-01");
  });

  it("soma por mês e por imóvel/locatário; só o que foi recebido no ano; em centavos", () => {
    const linhas: LinhaInforme[] = [
      { ...base, competencia: "2025-12-01", faturaPagoEm: "2026-01-05" }, // dezembro pago em janeiro → entra em 2026
      { ...base, competencia: "2026-01-01", faturaPagoEm: "2026-02-04", multaJuros: 40.1, liquido: 2140.1 },
      { ...base, competencia: "2026-12-01", faturaPagoEm: "2027-01-03" }, // pago no ano seguinte → fora
      { ...base, competencia: "2026-03-01", faturaPagoEm: null, faturaPaga: false, status: "pendente" }, // não recebido
      { ...base, competencia: "2026-04-01", faturaPagoEm: "2026-04-10", status: "cancelado" }, // cancelado → fora
      {
        ...base,
        competencia: "2026-02-01",
        faturaPagoEm: "2026-03-05",
        imovel: "CS-9",
        locatarioNome: "Loja Ltda",
        locatarioDocumento: "12.345.678/0001-95",
        aluguel: 5000.33,
        encargos: 0,
        taxaAdministracao: 500.03,
        irrf: 75.01,
        imposto: 10.1,
        outrosDescontos: 120,
        liquido: 4295.19,
      },
    ];
    const r = informeRendimentos(linhas, 2026);
    expect(r.quantidade).toBe(3);
    expect(r.pendentes).toBe(1);
    expect(r.meses[0].rendimento).toBe(200000);
    expect(r.meses[1].rendimento).toBe(204010);
    expect(r.meses[2]).toEqual({ rendimento: 500033, encargos: 0, taxas: 50003, irrf: 7501, imposto: 1010, descontos: 12000, liquido: 429519 });
    expect(r.total.rendimento).toBe(200000 + 204010 + 500033);
    expect(r.total.encargos).toBe(60000);
    expect(r.total.taxas).toBe(20000 + 20000 + 50003);
    expect(r.total.irrf).toBe(7501);
    expect(r.porImovel.map((p) => [p.imovel, p.documento, p.totais.rendimento])).toEqual([
      ["AP-1", "11122233344", 404010],
      ["CS-9", "12345678000195", 500033],
    ]);
    // A soma dos meses bate com o total.
    expect(r.meses.reduce((s, m) => s + m.liquido, 0)).toBe(r.total.liquido);
  });
});
