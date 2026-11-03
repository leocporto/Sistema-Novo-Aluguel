import { describe, expect, it } from "vitest";
import {
  aplicarFila,
  ambientesSugeridos,
  chaveOp,
  checklistDoAmbiente,
  compararVistorias,
  consumoMedidores,
  contestacaoAberta,
  descreverOp,
  juntarOp,
  prazoContestacao,
  progressoVistoria,
  proximosStatus,
  resumoFila,
  separarResultado,
  textoLaudo,
  totaisReparos,
  valorPendencia,
  vinculosDaFoto,
  type DadosLaudo,
  type OpCampo,
} from "@/lib/dominio/vistorias";

describe("checklist e ambientes", () => {
  it("tem checklist padrão por tipo de ambiente (e um genérico)", () => {
    expect(checklistDoAmbiente("banheiro")).toContain("Box");
    expect(checklistDoAmbiente("banheiro")).toContain("Hidráulica (vazamentos e ralos)");
    expect(checklistDoAmbiente("sala")).toEqual(expect.arrayContaining(["Paredes", "Piso", "Teto", "Portas", "Pintura"]));
    expect(checklistDoAmbiente("inexistente")).toEqual(checklistDoAmbiente("outro"));
  });

  it("sugere ambientes pelo cadastro do imóvel", () => {
    const ap = ambientesSugeridos({ tipo: "apartamento", quartos: 2, banheiros: 1, vagas: 1 });
    expect(ap.map((a) => a.nome)).toEqual(["Sala", "Cozinha", "Quarto 1", "Quarto 2", "Banheiro", "Área de serviço", "Garagem"]);
    const casa = ambientesSugeridos({ tipo: "casa", quartos: 1, banheiros: 2, vagas: 0 });
    expect(casa.map((a) => a.nome)).toContain("Área externa");
    expect(casa.filter((a) => a.tipo === "banheiro")).toHaveLength(2);
    expect(ambientesSugeridos({ tipo: "sala comercial", banheiros: 1 }).map((a) => a.tipo)).toEqual(["salao", "banheiro"]);
    expect(ambientesSugeridos({ tipo: "kitnet/studio" }).some((a) => a.tipo === "quarto")).toBe(false);
  });

  it("calcula o andamento do checklist e os danos", () => {
    const p = progressoVistoria([{ estado: "bom" }, { estado: "ruim" }, { estado: null }, { estado: "danificado" }]);
    expect(p).toMatchObject({ total: 4, avaliados: 3, faltam: 1, pct: 75, danos: 2 });
    expect(progressoVistoria([]).pct).toBe(0);
  });

  it("só deixa mudar a situação pelos caminhos certos", () => {
    expect(proximosStatus("rascunho")).toEqual(["em_andamento"]);
    expect(proximosStatus("em_andamento")).toEqual(["concluida"]);
    expect(proximosStatus("concluida")).toEqual(["em_andamento", "assinada"]);
    // Assinada pode ser reaberta (ex.: contestação aceita): o laudo novo é gerado depois.
    expect(proximosStatus("assinada")).toEqual(["em_andamento"]);
    expect(proximosStatus("contestada")).toEqual(["em_andamento"]);
    expect(proximosStatus("qualquer")).toEqual([]);
  });
});

describe("comparação entrada × saída", () => {
  it("destaca o que piorou casando nomes sem acento e maiúsculas", () => {
    const entrada = [
      { nome: "Sala", itens: [{ nome: "Piso", estado: "bom" }, { nome: "Paredes", estado: "novo" }, { nome: "Janelas", estado: "regular" }] },
      { nome: "Área de serviço", itens: [{ nome: "Tanque", estado: "bom" }] },
    ];
    const saida = [
      { nome: "sala", itens: [{ id: "x", nome: "piso", estado: "danificado" }, { nome: "Paredes", estado: "novo" }, { nome: "Janelas", estado: "bom" }, { nome: "Cortina", estado: "bom" }] },
      { nome: "Area de Servico", itens: [{ nome: "Tanque", estado: "nao_se_aplica" }] },
    ];
    const r = compararVistorias(entrada, saida);
    expect(r.contagem).toEqual({ piorou: 1, melhorou: 1, igual: 1, sem_avaliacao: 1, item_novo: 1, nao_vistoriado: 0 });
    const piso = r.linhas.find((l) => l.item === "piso")!;
    expect(piso).toMatchObject({ antes: "bom", depois: "danificado", situacao: "piorou", itemId: "x" });
  });

  it("aponta o que não foi vistoriado agora", () => {
    const r = compararVistorias([{ nome: "Garagem", itens: [{ nome: "Portão", estado: "bom" }] }], []);
    expect(r.linhas).toEqual([expect.objectContaining({ ambiente: "Garagem", item: "Portão", situacao: "nao_vistoriado" })]);
  });

  it("calcula o consumo dos medidores entre as leituras", () => {
    const c = consumoMedidores(
      [
        { tipo: "agua", numero: "A-1", leitura: 100.5 },
        { tipo: "energia", numero: null, leitura: 2000 },
      ],
      [
        { tipo: "agua", numero: "a1", leitura: 120.75 },
        { tipo: "energia", numero: "E9", leitura: 2350 },
        { tipo: "gas", numero: null, leitura: 5 },
      ],
    );
    expect(c.map((m) => m.consumo)).toEqual([20.25, 350, null]);
  });
});

describe("reparos e acerto (centavos)", () => {
  const pend = [
    { responsavel: "locatario", status: "aberta", valor_estimado: "200.10", orcamentos: [] },
    { responsavel: "locatario", status: "resolvida", valor_estimado: 80, orcamentos: [{ valor: "350.45", aprovado: true }, { valor: 500, aprovado: false }] },
    { responsavel: "proprietario", status: "em_reparo", valor_estimado: 900, orcamentos: [] },
    { responsavel: "locatario", status: "cancelada", valor_estimado: 999, orcamentos: [] },
  ];
  it("usa o orçamento aprovado ou, sem ele, o estimado", () => {
    expect(valorPendencia(pend[0])).toBe(20010);
    expect(valorPendencia(pend[1])).toBe(35045);
  });
  it("soma por responsável sem as canceladas", () => {
    const t = totaisReparos(pend);
    expect(t.paraAcerto).toBe(55055);
    expect(t.porResponsavel.proprietario).toBe(90000);
    expect(t.total).toBe(145055);
    expect(t.comOrcamentoAprovado).toBe(1);
    expect(t.abertas).toBe(2);
  });
});

describe("contestação", () => {
  it("conta o prazo em dias corridos", () => {
    expect(prazoContestacao("2026-11-25", 10)).toBe("2026-12-05");
    expect(contestacaoAberta("2026-12-05", "2026-12-05")).toBe(true);
    expect(contestacaoAberta("2026-12-05", "2026-12-06")).toBe(false);
    expect(contestacaoAberta(null, "2030-01-01")).toBe(true);
  });
});

describe("laudo", () => {
  it("monta o texto do laudo com ambientes, medidores, danos e prazo", () => {
    const d: DadosLaudo = {
      numero: 7,
      tipo: "saida",
      data: "2026-11-03",
      imovel: { codigo: "AP-101", endereco: "Rua A, 10", cidade: "Porto Alegre" },
      contratoNumero: 12,
      locatarios: ["Lia"],
      locadores: ["Ana"],
      responsavel: "Carlos",
      acompanhante: "Lia",
      organizacao: "Imob X",
      ambientes: [{ nome: "Sala", observacoes: "Cheiro de cigarro", itens: [{ nome: "Piso", estado: "ruim", observacao: "riscado" }, { nome: "Teto", estado: null, observacao: null }] }],
      medidores: [{ tipo: "agua", numero: "123", leitura: 45.5 }],
      pendencias: [{ descricao: "Raspar piso", ambiente: "Sala", responsavel: "locatario", valor: 35000 }],
      fotos: 3,
      videos: 1,
      comparacao: { referencia: 2, pioraram: [{ ambiente: "Sala", item: "Piso", antes: "bom", depois: "ruim" }] },
      observacoes: null,
      conclusao: "Imóvel precisa de reparo no piso.",
      contestacaoAte: "2026-11-13",
      dataExtenso: "3 de novembro de 2026",
    };
    const t = textoLaudo(d);
    expect(t.startsWith("# LAUDO DE VISTORIA DE SAÍDA Nº 7")).toBe(true);
    expect(t).toContain("Piso: Ruim — riscado");
    expect(t).toContain("Teto: não avaliado");
    expect(t).toContain("Água (nº 123): 45,5 m³");
    expect(t).toContain("Raspar piso (Sala) — responsável: Locatário — R$");
    expect(t).toContain("Sala · Piso: Bom → Ruim");
    expect(t).toContain("3 foto(s) e 1 vídeo(s)");
    expect(t).toContain("até 13/11/2026");
    expect(t.trim().endsWith("Porto Alegre, 3 de novembro de 2026.")).toBe(true);
  });
});

describe("app de campo (fila offline)", () => {
  it("junta alterações do mesmo item e mantém as fotos separadas", () => {
    let f: OpCampo[] = [];
    f = juntarOp(f, { op: "item", id: "i1", ambienteId: "a1", estado: "bom", observacao: null });
    f = juntarOp(f, { op: "medidor", id: "m1", tipo: "agua", numero: "1", leitura: 10 });
    f = juntarOp(f, { op: "item", id: "i1", ambienteId: "a1", estado: "ruim", observacao: "trincado" });
    f = juntarOp(f, { op: "foto", id: "f1", ambienteId: "a1", itemId: "i1", medidorId: null, tipo: "foto", legenda: null, nome: "1.jpg", mime: "image/jpeg", tiradaEm: "2026-11-03T10:00:00Z" });
    f = juntarOp(f, { op: "foto", id: "f2", ambienteId: "a1", itemId: null, medidorId: null, tipo: "video", legenda: null, nome: "2.mp4", mime: "video/mp4", tiradaEm: "2026-11-03T10:01:00Z" });
    f = juntarOp(f, { op: "status", status: "em_andamento" });
    f = juntarOp(f, { op: "status", status: "concluida" });
    expect(f).toHaveLength(5);
    expect(f[0]).toMatchObject({ op: "item", estado: "ruim", observacao: "trincado" });
    expect(f.at(-1)).toEqual({ op: "status", status: "concluida" });
    expect(resumoFila(f)).toBe("3 alterações e 2 fotos/vídeos");
    expect(resumoFila([])).toBe("nada pendente");
  });

  it("reaplica a fila sobre os dados do servidor", () => {
    const amb = [{ id: "a1", nome: "Sala", tipo: "sala", observacoes: null, itens: [{ id: "i1", nome: "Piso", estado: null, observacao: null }] }];
    const r = aplicarFila(amb, [], [
      { op: "item", id: "i1", ambienteId: "a1", estado: "bom", observacao: "ok" },
      { op: "ambiente", id: "a2", nome: "Quarto", tipo: "quarto", itens: [{ id: "i2", nome: "Piso" }] },
      { op: "ambiente_obs", id: "a2", observacoes: "sem lâmpada" },
      { op: "medidor", id: "m1", tipo: "energia", numero: null, leitura: 1500 },
      { op: "status", status: "em_andamento" },
    ]);
    expect(r.ambientes[0].itens[0]).toMatchObject({ estado: "bom", observacao: "ok" });
    expect(r.ambientes[1]).toMatchObject({ nome: "Quarto", observacoes: "sem lâmpada" });
    expect(r.medidores).toEqual([{ id: "m1", tipo: "energia", numero: null, leitura: 1500 }]);
    expect(r.status).toBe("em_andamento");
    // não altera o original
    expect(amb[0].itens[0].estado).toBeNull();
  });

  const foto = (id: string, extra: Partial<Extract<OpCampo, { op: "foto" }>> = {}): OpCampo => ({
    op: "foto",
    id,
    ambienteId: "a1",
    itemId: null,
    medidorId: null,
    tipo: "foto",
    legenda: null,
    nome: `${id}.jpg`,
    mime: "image/jpeg",
    tiradaEm: "2026-11-03T10:00:00Z",
    path: `org/v/${id}.jpg`,
    ...extra,
  });

  it("separa o que o sistema aceitou do que recusou, sem travar o resto", () => {
    const i1: OpCampo = { op: "item", id: "i1", ambienteId: "a1", estado: "bom", observacao: null };
    const i2: OpCampo = { op: "item", id: "i2", ambienteId: "a1", estado: "ruim", observacao: "trincado" };
    const f1 = foto("f1");
    const enviadas = [i1, i2, f1];
    // Enquanto enviava, a pessoa mudou o i1 de novo e tirou outra foto.
    const i1Novo: OpCampo = { ...i1, estado: "regular" } as OpCampo;
    const filaAtual = [i1Novo, i2, f1, foto("f2")];
    const r = separarResultado(filaAtual, enviadas, [
      { chave: "item|i2", tipo: "invalida", motivo: "O item foi excluído no computador." },
      { chave: "item|i1", tipo: "travada", motivo: "Vistoria concluída." },
    ]);
    // Fica na fila só o que mudou depois do envio.
    expect(r.resto.map(chaveOp)).toEqual(["item|i1", "foto|f2"]);
    expect(r.resto[0]).toMatchObject({ estado: "regular" });
    expect(r.aceitas.map(chaveOp)).toEqual(["foto|f1"]);
    // O i1 recusado não vai para a lista porque a versão nova ainda vai ser enviada.
    expect(r.recusadas).toEqual([{ op: i2, tipo: "invalida", motivo: "O item foi excluído no computador." }]);
    // Sem recusas: tudo aceito, fila vazia.
    expect(separarResultado(enviadas, enviadas, [])).toMatchObject({ resto: [], aceitas: enviadas, recusadas: [] });
  });

  it("guarda a foto mesmo se o ambiente, o item ou o medidor foi excluído", () => {
    const existe = { ambientes: new Set(["a1", "a2"]), itens: new Map([["i1", "a1"]]), medidores: new Set(["m1"]) };
    expect(vinculosDaFoto({ ambienteId: "a1", itemId: "i1", medidorId: null }, existe)).toEqual({ ambienteId: "a1", itemId: "i1", medidorId: null, perdidos: [] });
    // O item manda no ambiente.
    expect(vinculosDaFoto({ ambienteId: "a2", itemId: "i1", medidorId: null }, existe)).toMatchObject({ ambienteId: "a1", itemId: "i1", perdidos: [] });
    expect(vinculosDaFoto({ ambienteId: "a1", itemId: "ix", medidorId: null }, existe)).toEqual({ ambienteId: "a1", itemId: null, medidorId: null, perdidos: ["item"] });
    expect(vinculosDaFoto({ ambienteId: "ax", itemId: "iy", medidorId: null }, existe)).toEqual({ ambienteId: null, itemId: null, medidorId: null, perdidos: ["ambiente", "item"] });
    expect(vinculosDaFoto({ ambienteId: null, itemId: null, medidorId: "mx" }, existe)).toMatchObject({ medidorId: null, perdidos: ["medidor"] });
    expect(vinculosDaFoto({ ambienteId: null, itemId: null, medidorId: null }, existe).perdidos).toEqual([]);
  });

  it("descreve as alterações para a pessoa entender o que foi recusado", () => {
    const amb = [{ id: "a1", nome: "Sala", tipo: "sala", observacoes: null, itens: [{ id: "i1", nome: "Piso", estado: null, observacao: null }] }];
    const med = [{ id: "m1", tipo: "agua", numero: null, leitura: null }];
    expect(descreverOp({ op: "item", id: "i1", ambienteId: "a1", estado: "ruim", observacao: "trincado" }, amb, med)).toBe("Sala · Piso: Ruim (trincado)");
    expect(descreverOp(foto("f1", { itemId: "i1" }), amb, med)).toBe("Foto de Sala · Piso");
    expect(descreverOp(foto("f2", { ambienteId: null, medidorId: "m1", tipo: "video" }), amb, med)).toBe("Vídeo de medidor de água");
    expect(descreverOp(foto("f3", { ambienteId: null }), amb, med)).toBe("Foto geral");
    expect(descreverOp({ op: "medidor", id: "m1", tipo: "energia", numero: null, leitura: 1500.5 }, amb, med)).toBe("Medidor de energia elétrica: 1500,5 kWh");
    expect(descreverOp({ op: "ambiente_obs", id: "a1", observacoes: "x" }, amb, med)).toBe("Observações de Sala");
    expect(descreverOp({ op: "status", status: "concluida" }, amb, med)).toBe("Concluir a vistoria");
  });
});
