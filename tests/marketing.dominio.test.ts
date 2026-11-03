import { describe, expect, it } from "vitest";
import {
  calcularNps,
  classeNota,
  comRodape,
  contatoBloqueado,
  contatosParaImovel,
  csvConversoesGoogle,
  csvConversoesMeta,
  dataHoraLocalParaISO,
  deduplicar,
  descricaoImovel,
  destaquesImovel,
  devidoAgora,
  filtrarContatos,
  finalidadeDoTipo,
  funilPorOrigem,
  gerarSlug,
  interessadoNoPreco,
  isoParaDataHoraLocal,
  lerFiltros,
  lerLeadGenerico,
  lerLeadGoogle,
  lerLeadMeta,
  lerUtm,
  lerWebhookWhatsapp,
  linkEmail,
  listaImoveisTexto,
  montarLinkUtm,
  montarPublico,
  origemDaUtm,
  perfilDaPessoa,
  perfilDoLead,
  precoDoImovel,
  recomendarImoveis,
  reducaoPct,
  renderizarMensagem,
  resumoFiltros,
  resumoPerfil,
  separarPorSugestao,
  situacaoCampanha,
  slugValido,
  telefoneE164,
  temPerfil,
  textoAnuncio,
  textosPreco,
  ultimaReducao,
  variaveisUsadas,
  type Contato,
  type Descadastro,
} from "@/lib/dominio/marketing";

const AGORA = Date.parse("2026-11-03T15:00:00Z");
/** Intl usa espaço fixo (NBSP) depois de "R$". */
const sem = (s: string) => s.replace(/\u00a0/g, " ");
const dias = (n: number) => new Date(AGORA - n * 86_400_000).toISOString();

const imovel = {
  id: "i1",
  codigo: "AP-101",
  tipo: "apartamento",
  finalidades: ["locacao"],
  status: "disponivel",
  bairro: "Gonzaga",
  cidade: "Santos",
  quartos: 2,
  valor_aluguel: 2500,
  valor_venda: null,
};

const lead = (over: Partial<Contato> = {}): Contato => ({
  tipo: "lead",
  id: "l1",
  nome: "Ana Lima",
  telefone: "(13) 99999-1111",
  email: "ana@x.com",
  funil: "locacao",
  status: "em_atendimento",
  origem: "site",
  corretor_id: null,
  ultimo_contato: dias(10),
  created_at: dias(100),
  perfil: perfilDoLead({ funil: "locacao", tipos: ["apartamento"], regioes: "Gonzaga", orcamento_min: null, orcamento_max: 3000, quartos_min: 2 }),
  ...over,
});
const pessoa = (over: Partial<Contato> = {}): Contato => ({
  tipo: "pessoa",
  id: "p1",
  nome: "Bruno Souza",
  telefone: "13988882222",
  email: "bruno@x.com",
  papeis: ["locatario"],
  cidade: "Santos",
  bairro: "Boqueirão",
  interesse: ["alugar"],
  aceita: { whatsapp: true, email: false, sms: false, marketing: true },
  perfil: perfilDaPessoa({ interesse: ["alugar"], pref_tipos: [], pref_regioes: null, pref_valor_min: null, pref_valor_max: null, pref_quartos_min: null }),
  ...over,
});

describe("mensagens e modelos", () => {
  it("preenche variáveis (sem diferenciar maiúsculas), some com a que falta e limpa espaços", () => {
    expect(renderizarMensagem("Olá {{ Primeiro_Nome }}! Veja {{imovel}} {{nada}} agora.", { primeiro_nome: "Ana", imovel: "AP-101" })).toBe("Olá Ana! Veja AP-101 agora.");
    expect(variaveisUsadas("{{nome}} e {{ LINK_pesquisa }} e {{nome}}")).toEqual(["nome", "link_pesquisa"]);
  });

  it("oferta leva o jeito de sair da lista; relacionamento e mensagem que já tem o link não repetem", () => {
    const l = "https://x/preferencias/abc";
    expect(comRodape("Oi", "whatsapp", l)).toBe(`Oi\n\nNão quer mais receber? Responda SAIR ou escolha aqui: ${l}`);
    expect(comRodape("Oi", "email", l)).toContain("Para escolher o que recebe ou sair da lista");
    expect(comRodape(`Oi ${l}`, "whatsapp", l)).toBe(`Oi ${l}`);
    expect(comRodape("Oi", "whatsapp", l, "relacionamento")).toBe("Oi");
    expect(comRodape("Oi", "whatsapp", null)).toBe("Oi");
    expect(finalidadeDoTipo("pos_venda")).toBe("relacionamento");
    expect(finalidadeDoTipo("reativacao")).toBe("ofertas");
  });

  it("mailto com assunto e corpo codificados (espaço como %20)", () => {
    expect(linkEmail("ana@x.com", "Olá Ana", "Linha 1\nLinha 2")).toBe("mailto:ana%40x.com?subject=Ol%C3%A1%20Ana&body=Linha%201%0ALinha%202");
  });
});

describe("descadastro e LGPD", () => {
  const regras: Descadastro[] = [
    { pessoa_id: null, lead_id: null, email: "ANA@x.com", telefone: null, canal: "email" },
    { pessoa_id: null, lead_id: null, email: null, telefone: "+55 13 98888-2222", canal: "ofertas" },
  ];

  it("bloqueia por e-mail e por telefone (últimos 9 dígitos), só no canal/finalidade certos", () => {
    expect(contatoBloqueado(lead(), "email", "ofertas", regras)).toBe(true);
    expect(contatoBloqueado(lead(), "whatsapp", "ofertas", regras)).toBe(false);
    expect(contatoBloqueado(pessoa(), "whatsapp", "ofertas", regras)).toBe(true);
    // "ofertas" não bloqueia pesquisa/pós-venda
    expect(contatoBloqueado(pessoa(), "whatsapp", "relacionamento", regras)).toBe(false);
    expect(contatoBloqueado(lead({ id: "l9" }), "sms", "ofertas", [{ pessoa_id: null, lead_id: "l9", email: null, telefone: null, canal: "todos" }])).toBe(true);
  });

  it("vale a última autorização da pessoa (aba Comunicação)", () => {
    const cons = [
      { pessoa_id: "p1", canal: "marketing", concedido: true, em: "2026-01-01T00:00:00Z" },
      { pessoa_id: "p1", canal: "marketing", concedido: false, em: "2026-05-01T00:00:00Z" },
      { pessoa_id: "p1", canal: "whatsapp", concedido: false, em: "2026-02-01T00:00:00Z" },
      { pessoa_id: "p1", canal: "whatsapp", concedido: true, em: "2026-03-01T00:00:00Z" },
    ];
    expect(contatoBloqueado(pessoa(), "whatsapp", "ofertas", [], cons)).toBe(true); // retirou "ofertas"
    expect(contatoBloqueado(pessoa(), "whatsapp", "relacionamento", [], cons)).toBe(false); // whatsapp voltou a valer
    expect(contatoBloqueado(lead(), "whatsapp", "ofertas", [], cons)).toBe(false); // consentimento é só de pessoa
  });
});

describe("público das campanhas", () => {
  const contatos: Contato[] = [
    lead(),
    lead({ id: "l2", nome: "Caio", telefone: "11977776666", email: null, status: "perdido", perdido_em: dias(90), ultimo_contato: dias(90) }),
    lead({ id: "l3", nome: "Duda", telefone: null, email: "duda@x.com", status: "novo", ultimo_contato: dias(70), funil: "venda", origem: "instagram", perfil: null }),
    lead({ id: "l4", nome: "Eva", status: "ganho" }),
    pessoa(),
    pessoa({ id: "p2", nome: "Ana Lima (cadastro)", telefone: "13999991111", email: null, papeis: ["proprietario"], interesse: [], bairro: "Centro", aceita: { whatsapp: false, email: false, sms: false, marketing: true } }),
  ];

  it("filtra por público, etapa, parados há X dias, perdidos e papel", () => {
    const ids = (f: Parameters<typeof filtrarContatos>[1]) => filtrarContatos(contatos, f, { agoraMs: AGORA }).map((c) => c.id);
    expect(ids({ publico: "leads" })).toEqual(["l1", "l3"]); // ganho e perdido saem
    expect(ids({ publico: "leads", incluir_perdidos: true, parado_dias: 60 })).toEqual(["l2", "l3"]);
    expect(ids({ etapas: ["perdido"] })).toEqual(["l2"]);
    expect(ids({ publico: "pessoas", papel: "proprietario" })).toEqual(["p2"]);
    expect(ids({ funil: "locacao" })).toEqual(["l1", "p1"]); // pessoa que quer alugar entra
    expect(ids({ origem: "instagram" })).toEqual(["l3"]); // filtro de lead tira as pessoas
    expect(ids({ regiao: "boqueirao" })).toEqual(["p1"]);
  });

  it("perfil que combina com o imóvel (ou interesse já marcado no lead)", () => {
    const ids = filtrarContatos([...contatos, lead({ id: "l5", perfil: null, imoveis: ["i1"] })], { combina_imovel: true }, { agoraMs: AGORA, imovel }).map((c) => c.id);
    expect(ids).toEqual(["l1", "l5"]);
  });

  it("não repete a mesma pessoa (lead e cadastro com o mesmo telefone): fica o cadastro", () => {
    expect(deduplicar(contatos.filter((c) => ["l1", "p2"].includes(c.id))).map((c) => c.id)).toEqual(["p2"]);
  });

  it("monta o público com os motivos de quem fica fora", () => {
    const r = montarPublico(contatos, { publico: "ambos" }, {
      canal: "whatsapp",
      finalidade: "ofertas",
      soAutorizados: true,
      descadastros: [{ pessoa_id: null, lead_id: null, email: null, telefone: "13988882222", canal: "whatsapp" }],
      agoraMs: AGORA,
    });
    expect(r.incluidos.map((c) => c.id)).toEqual([]);
    expect(Object.fromEntries(r.excluidos.map((e) => [e.contato.id, e.motivo]))).toEqual({
      p1: "Pediu para não receber",
      p2: "Não autorizou (aba Comunicação)",
      l3: "Sem telefone",
    });
    const semExigir = montarPublico(contatos, { publico: "ambos" }, { canal: "whatsapp", finalidade: "ofertas", soAutorizados: false, descadastros: [], agoraMs: AGORA });
    expect(semExigir.incluidos.map((c) => c.id).sort()).toEqual(["p1", "p2"]);
  });

  it("lê os filtros gravados com segurança", () => {
    expect(lerFiltros({ publico: "x", parado_dias: "45", etapas: ["novo", ""], incluir_perdidos: true, regiao: "  " })).toEqual({
      publico: "ambos",
      funil: undefined,
      etapas: ["novo"],
      origem: undefined,
      utm_source: undefined,
      corretor: undefined,
      parado_dias: 45,
      incluir_perdidos: true,
      reativar: false,
      papel: undefined,
      regiao: undefined,
      interesse: undefined,
      combina_imovel: false,
    });
    expect(lerFiltros(null).publico).toBe("ambos");
  });

  it("situação calculada pela fila e agendamento", () => {
    expect(situacaoCampanha({ status: "rascunho", agendada_para: null }, 0, AGORA)).toBe("rascunho");
    expect(situacaoCampanha({ status: "fila", agendada_para: dias(-1) }, 3, AGORA)).toBe("agendada");
    expect(situacaoCampanha({ status: "fila", agendada_para: dias(1) }, 3, AGORA)).toBe("enviando");
    expect(situacaoCampanha({ status: "fila", agendada_para: null }, 0, AGORA)).toBe("concluida");
    expect(situacaoCampanha({ status: "cancelada", agendada_para: null }, 3, AGORA)).toBe("cancelada");
    expect(dataHoraLocalParaISO("2026-11-10T09:30")).toBe("2026-11-10T09:30:00-03:00");
    expect(isoParaDataHoraLocal("2026-11-10T12:30:00Z")).toBe("2026-11-10T09:30");
    expect(dataHoraLocalParaISO("")).toBeNull();
  });
});

describe("pesquisa de satisfação (NPS)", () => {
  it("promotores − detratores, ignorando notas inválidas", () => {
    expect(calcularNps([10, 9, 8, 7, 6, 0, null, 11])).toEqual({ respostas: 6, promotores: 2, neutros: 2, detratores: 2, nps: 0, media: 6.7 });
    expect(calcularNps([10, 10, 9, 3]).nps).toBe(50);
    expect(calcularNps([]).nps).toBeNull();
    expect([classeNota(9), classeNota(7), classeNota(6)]).toEqual(["promotor", "neutro", "detrator"]);
  });
});

describe("origem das conversões", () => {
  it("lê UTM/gclid/fbclid da URL e acha a origem do lead", () => {
    expect(lerUtm({ utm_source: " Facebook ", utm_medium: ["cpc", "x"], gclid: "abc<script>", fbclid: "" })).toEqual({ utm_source: "Facebook", utm_medium: "cpc", gclid: "abcscript" });
    expect(origemDaUtm({ utm_source: "ig" })).toBe("instagram");
    expect(origemDaUtm({ utm_source: "facebook" })).toBe("facebook");
    expect(origemDaUtm({ fbclid: "x" })).toBe("facebook");
    expect(origemDaUtm({ utm_source: "google", gclid: "x" })).toBe("site");
    expect(origemDaUtm({ utm_source: "newsletter" })).toBe("email");
    expect(origemDaUtm({ utm_source: "olx" })).toBe("olx");
    expect(montarLinkUtm("https://x/lp/ap", { source: "facebook", medium: "cpc", campaign: "nov" })).toBe("https://x/lp/ap?utm_source=facebook&utm_medium=cpc&utm_campaign=nov");
    expect(montarLinkUtm("https://x/?a=1", { source: "wa", medium: "msg" })).toBe("https://x/?a=1&utm_source=wa&utm_medium=msg");
  });

  it("funil lead → visita → proposta → negócio por origem, com valor em centavos", () => {
    const leads = [
      { id: "1", origem: "facebook", status: "ganho", etapa_max: 4, visitas: 1, propostas: 1, valor: 1500.1 },
      { id: "2", origem: "facebook", status: "perdido", etapa_max: 2, visitas: 0, propostas: 0, valor: null },
      { id: "3", origem: "facebook", status: "novo", etapa_max: 0, visitas: 0, propostas: 1, valor: null },
      { id: "4", origem: "google", status: "ganho", etapa_max: 1, visitas: 0, propostas: 0, valor: 0.2 },
      { id: "5", origem: "", status: "novo", etapa_max: 0, visitas: 0, propostas: 0, valor: null },
    ];
    expect(funilPorOrigem(leads, (l) => l.origem)).toEqual([
      { chave: "facebook", leads: 3, visitas: 2, propostas: 2, negocios: 1, conversao: 33.3, valor: 1500.1 },
      { chave: "(sem informação)", leads: 1, visitas: 0, propostas: 0, negocios: 0, conversao: 0, valor: 0 },
      { chave: "google", leads: 1, visitas: 1, propostas: 1, negocios: 1, conversao: 100, valor: 0.2 },
    ]);
  });

  it("CSV de conversões offline do Google Ads e da Meta", () => {
    expect(csvConversoesGoogle([{ gclid: "Cj0K", data: "2026-11-03T15:00:00Z", valor: 1500 }, { gclid: "", data: "2026-11-03T15:00:00Z", valor: 1 }], "Negócio fechado")).toBe(
      "Parameters:TimeZone=America/Sao_Paulo\nGoogle Click ID,Conversion Name,Conversion Time,Conversion Value,Conversion Currency\nCj0K,Negócio fechado,2026-11-03 12:00:00,1500.00,BRL\n",
    );
    expect(telefoneE164("(13) 99999-1111")).toBe("5513999991111");
    expect(telefoneE164("+55 13 99999-1111")).toBe("5513999991111");
    const meta = csvConversoesMeta([{ email: " ANA@X.com ", telefone: "13999991111", nome: "Ana Maria Lima", cidade: "São Paulo", evento: "Purchase", data: "2026-11-03T15:00:00Z", valor: 2500 }]);
    expect(meta.split("\n")[1]).toBe(`ana@x.com,5513999991111,ana,lima,saopaulo,br,Purchase,${Date.parse("2026-11-03T15:00:00Z") / 1000},2500.00,BRL`);
  });
});

describe("recomendação por perfil", () => {
  const imoveis = [
    imovel,
    { ...imovel, id: "i2", codigo: "AP-200", valor_aluguel: 2900 },
    { ...imovel, id: "i3", codigo: "AP-300", valor_aluguel: 3500 },
    { ...imovel, id: "i4", codigo: "CA-1", tipo: "casa", valor_aluguel: 2000 },
    { ...imovel, id: "i5", codigo: "AP-1", valor_aluguel: 1800, bairro: "Centro" },
  ];

  it("só recomenda para quem tem perfil, do mais barato para o mais caro", () => {
    const perfil = lead().perfil!;
    expect(temPerfil(perfil)).toBe(true);
    expect(recomendarImoveis(perfil, imoveis).map((i) => i.codigo)).toEqual(["AP-101", "AP-200"]);
    expect(temPerfil(perfilDoLead({ funil: "locacao", tipos: [], regioes: null, orcamento_min: null, orcamento_max: null, quartos_min: null }))).toBe(false);
    expect(recomendarImoveis(pessoa().perfil!, imoveis)).toEqual([]); // só "alugar" não é perfil
    expect(sem(resumoPerfil(perfil))).toBe("Alugar · apartamento · Gonzaga · até R$ 3.000,00 · 2+ quartos");
  });

  it("acha quem tem perfil para o imóvel (e quem já se interessou por ele)", () => {
    const c = [lead(), lead({ id: "l7", perfil: null, imoveis: ["i3"] }), pessoa()];
    expect(contatosParaImovel(imoveis[2], c).map((x) => x.id)).toEqual(["l7"]);
    expect(contatosParaImovel(imoveis[0], c).map((x) => x.id)).toEqual(["l1"]);
    expect(contatosParaImovel(imoveis[2], c, false)).toEqual([]);
  });

  it("textos de imóvel para mensagem e anúncio", () => {
    expect(descricaoImovel(imovel)).toBe("AP-101 · Apartamento · 2 qtos · Gonzaga");
    expect(sem(precoDoImovel({ valor_aluguel: 2500, valor_venda: 400000 }))).toBe("R$ 2.500,00/mês");
    expect(sem(precoDoImovel({ valor_aluguel: 2500, valor_venda: 400000 }, "venda"))).toBe("R$ 400.000,00");
    expect(precoDoImovel({ valor_aluguel: null, valor_venda: null })).toBe("valor sob consulta");
    expect(sem(listaImoveisTexto([imovel]))).toBe("• AP-101 · Apartamento · 2 qtos · Gonzaga — R$ 2.500,00/mês");
    const im = { ...imovel, area_util: 70, suites: 1, vagas: 1, comodidades: ["Piscina"], valor_condominio: 600 };
    expect(destaquesImovel(im)).toEqual(["70 m²", "2 quartos", "1 suíte", "1 vaga"]);
    const t = sem(textoAnuncio(im, { imobiliaria: "Imob X", telefone: "13 3333-0000", creci: "123" }));
    expect(t).toContain("Apartamento para alugar — Gonzaga, Santos");
    expect(t).toContain("Valor: R$ 2.500,00/mês + condomínio R$ 600,00");
    expect(t).toContain("Fale com a Imob X — 13 3333-0000 · CRECI 123");
  });
});

describe("automações e landing pages", () => {
  it("dispara só para o que venceu há pouco (janela de 15 dias)", () => {
    expect(devidoAgora("2026-10-01", 30, "2026-11-03")).toBe(true); // venceu 31/10
    expect(devidoAgora("2026-10-10", 30, "2026-11-03")).toBe(false); // vence 09/11
    expect(devidoAgora("2026-09-01", 30, "2026-11-03")).toBe(false); // venceu 01/10: velho demais
    expect(devidoAgora(null, 0, "2026-11-03")).toBe(false);
    expect(reducaoPct(2500, 2250)).toBe(10);
    expect(reducaoPct("3000", "2900")).toBe(3.3);
    expect(reducaoPct(2000, 2100)).toBe(0);
    expect(reducaoPct(null, 100)).toBe(0);
  });

  it("endereço da landing page", () => {
    expect(gerarSlug("  Apartamentos à venda no Gonzaga!! ")).toBe("apartamentos-a-venda-no-gonzaga");
    expect(slugValido("ap-centro")).toBe(true);
    expect(slugValido("-ap")).toBe(false);
    expect(slugValido("Ap")).toBe(false);
    expect(gerarSlug("x".repeat(80)).length).toBe(60);
  });
});

describe("webhooks", () => {
  it("lê mensagens, nomes e status da WhatsApp Cloud API", () => {
    const r = lerWebhookWhatsapp({
      object: "whatsapp_business_account",
      entry: [
        {
          id: "1",
          changes: [
            {
              field: "messages",
              value: {
                contacts: [{ profile: { name: "Carla" }, wa_id: "5513999990000" }],
                messages: [
                  { from: "5513999990000", id: "wamid.A", timestamp: "1762182000", type: "text", text: { body: "Oi, quero visitar" } },
                  { from: "5513999990000", id: "wamid.B", timestamp: "1762182060", type: "image", image: { caption: "foto da sala" } },
                  { from: "12", id: "x", type: "text", text: { body: "curto" } },
                ],
                statuses: [{ id: "wamid.Z", status: "read" }, { id: "wamid.Y", status: "desconhecido" }],
              },
            },
          ],
        },
      ],
    });
    expect(r.mensagens).toEqual([
      { telefone: "5513999990000", nome: "Carla", texto: "Oi, quero visitar", tipo: "texto", externo_id: "wamid.A", data: new Date(1762182000 * 1000).toISOString() },
      { telefone: "5513999990000", nome: "Carla", texto: "foto da sala", tipo: "imagem", externo_id: "wamid.B", data: new Date(1762182060 * 1000).toISOString() },
    ]);
    expect(r.status).toEqual([{ externo_id: "wamid.Z", status: "lida" }]);
    expect(lerWebhookWhatsapp("lixo")).toEqual({ mensagens: [], status: [] });
  });

  it("lead do formulário do Google Ads, aviso do Meta Lead Ads e corpo genérico", () => {
    const g = lerLeadGoogle({
      lead_id: "L1",
      form_id: 9,
      campaign_id: 77,
      google_key: "k",
      is_test: false,
      gcl_id: "Cj0",
      user_column_data: [
        { column_id: "FULL_NAME", string_value: "Rita Alves" },
        { column_id: "PHONE_NUMBER", string_value: "+5513988887777" },
        { column_id: "EMAIL", string_value: "rita@x.com" },
        { column_id: "CITY", string_value: "Santos" },
      ],
    })!;
    expect(g.plataforma).toBe("google");
    expect(g.chave).toBe("k");
    expect(g.lead).toMatchObject({ nome: "Rita Alves", telefone: "+5513988887777", email: "rita@x.com", gclid: "Cj0", utm_source: "google", utm_campaign: "google-77" });
    expect(g.lead!.mensagem).toContain("city: Santos");
    expect(lerLeadGoogle({ nome: "x" })).toBeNull();

    const m = lerLeadMeta({ object: "page", entry: [{ changes: [{ field: "leadgen", value: { leadgen_id: "444", form_id: "55", ad_id: "66" } }, { field: "feed", value: {} }] }] });
    expect(m).toEqual([{ plataforma: "meta", externo_id: "444", formulario_id: "55", campanha: "66", lead: null }]);

    const z = lerLeadGenerico({ name: "Zeca", phone: "11999990000", utm_source: "instagram", utm_campaign: "lanc" })!;
    expect(z.lead).toMatchObject({ nome: "Zeca", telefone: "11999990000", origem: "instagram", utm_campaign: "lanc" });
    expect(z.plataforma).toBe("meta");
    expect(lerLeadGenerico({ telefone: "1" })).toBeNull();
  });
});

describe("correções da revisão", () => {
  it("bloqueio sem cadastro não pega envio sem cadastro (só telefone/e-mail iguais)", () => {
    // Bloqueio de um telefone digitado (sem pessoa nem lead)
    const regra: Descadastro[] = [{ pessoa_id: null, lead_id: null, email: null, telefone: "13911112222", canal: "todos" }];
    const semCadastro = (telefone: string) => ({ tipo: "lead" as const, id: "", email: null, telefone });
    expect(contatoBloqueado(semCadastro("13955556666"), "whatsapp", "relacionamento", regra)).toBe(false);
    expect(contatoBloqueado(semCadastro("+55 13 91111-2222"), "whatsapp", "relacionamento", regra)).toBe(true);
    // Bloqueio de uma pessoa: não pega envio sem cadastro de outra
    const daPessoa: Descadastro[] = [{ pessoa_id: "p1", lead_id: null, email: null, telefone: null, canal: "todos" }];
    expect(contatoBloqueado({ tipo: "pessoa", id: "", email: null, telefone: "13900001111" }, "whatsapp", "ofertas", daPessoa)).toBe(false);
    expect(contatoBloqueado(lead({ id: "" }), "whatsapp", "ofertas", [{ pessoa_id: null, lead_id: null, email: null, telefone: null, canal: "todos" }])).toBe(false);
    expect(contatoBloqueado(pessoa(), "whatsapp", "ofertas", daPessoa)).toBe(true);
  });

  it("sugestão de imóveis só para quem tem perfil e imóvel que combina", () => {
    const sp = separarPorSugestao(
      [lead(), lead({ id: "l2", perfil: null }), pessoa(), lead({ id: "l3", perfil: { ...lead().perfil!, pref_regioes: "Ponta da Praia" } })],
      [imovel],
    );
    expect(sp.comImoveis.map((c) => c.id)).toEqual(["l1"]);
    expect(sp.semPerfil.map((c) => c.id)).toEqual(["l2", "p1"]); // pessoa só com "alugar" não tem perfil
    expect(sp.semImovel.map((c) => c.id)).toEqual(["l3"]);
    expect(separarPorSugestao([lead()], []).semImovel).toHaveLength(1);
  });

  it("redução de preço: a última mudança de cada preço precisa ser uma queda", () => {
    expect(ultimaReducao([])).toBeNull();
    const h = [
      { campo: "aluguel", valor_anterior: 3000, valor_novo: 2700, alterado_em: "2026-11-01T10:00:00Z" },
      { campo: "condominio", valor_anterior: 500, valor_novo: 400, alterado_em: "2026-11-02T10:00:00Z" },
      { campo: "venda", valor_anterior: "500000", valor_novo: "480000", alterado_em: "2026-10-20T10:00:00Z" },
    ];
    expect(ultimaReducao(h)).toEqual({ campo: "aluguel", anterior: 3000, novo: 2700, em: "2026-11-01T10:00:00Z" });
    // Aluguel subiu depois: só a venda vale
    const subiu = [...h, { campo: "aluguel", valor_anterior: 2700, valor_novo: 2900, alterado_em: "2026-11-02T12:00:00Z" }];
    expect(ultimaReducao(subiu)).toMatchObject({ campo: "venda", anterior: 500000, novo: 480000 });
    // Preço zerado não é "redução"
    expect(ultimaReducao([{ campo: "aluguel", valor_anterior: 3000, valor_novo: 0, alterado_em: "2026-11-01T10:00:00Z" }])).toBeNull();
    const t = textosPreco("aluguel", 3000, 2700);
    expect({ preco: sem(t.preco!), precoAnterior: sem(t.precoAnterior!) }).toEqual({ preco: "R$ 2.700,00/mês", precoAnterior: "R$ 3.000,00/mês" });
    expect(sem(textosPreco("venda", "500000", "480000").precoAnterior!)).toBe("R$ 500.000,00");
    expect(textosPreco("aluguel", null, null)).toEqual({ preco: null, precoAnterior: null });
  });

  it("aviso de preço só para quem procura aquele negócio (aluguel × compra)", () => {
    const comprador = lead({ id: "l5", funil: "venda", perfil: perfilDoLead({ funil: "venda", tipos: ["apartamento"], regioes: null, orcamento_min: null, orcamento_max: null, quartos_min: null }) });
    expect(interessadoNoPreco(lead(), "aluguel", "i1")).toBe(true);
    expect(interessadoNoPreco(lead(), "venda", "i1")).toBe(false);
    expect(interessadoNoPreco(comprador, "venda", "i1")).toBe(true);
    expect(interessadoNoPreco(comprador, "aluguel", "i1")).toBe(false);
    expect(interessadoNoPreco(pessoa({ perfil: perfilDaPessoa({ interesse: ["investir"] }) }), "venda", "i1")).toBe(true);
    // Sem interesse informado: só quem já se interessou por este imóvel
    const semInteresse = lead({ id: "l6", perfil: null, imoveis: ["i1"] });
    expect(interessadoNoPreco(semInteresse, "aluguel", "i1")).toBe(true);
    expect(interessadoNoPreco(semInteresse, "aluguel", "i2")).toBe(false);
  });

  it("reativação usa a mesma regra de Comercial › Reativar", () => {
    const f = lerFiltros({ publico: "leads", reativar: true });
    expect(f.reativar).toBe(true);
    const c = [
      lead({ id: "parado", ultimo_contato: dias(61) }),
      lead({ id: "recente", ultimo_contato: dias(10) }),
      lead({ id: "perdido-velho", status: "perdido", perdido_em: dias(31) }),
      lead({ id: "perdido-novo", status: "perdido", perdido_em: dias(5) }),
      lead({ id: "ganho", status: "ganho", ultimo_contato: dias(200) }),
      pessoa(),
    ];
    expect(filtrarContatos(c, f, { agoraMs: AGORA }).map((x) => x.id)).toEqual(["parado", "perdido-velho"]);
    expect(resumoFiltros(f)).toContain("para reativar");
  });
});
