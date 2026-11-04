import { describe, expect, it } from "vitest";
import { GET as getItem } from "@/app/api/v1/[recurso]/[id]/route";
import { GET as getLista, POST as postLista } from "@/app/api/v1/[recurso]/route";
import { GET as getOpenapi } from "@/app/api/v1/openapi.json/route";
import { ESPECIFICACAO_API, FILTROS_API, especificacaoCom, filtrosDaConsulta } from "@/lib/dominio/api";
import { cifrar, cifrarTodos, decifrar, decifrarTodos } from "@/lib/servicos/integracoes/segredos";
import { enviarWebhook } from "@/lib/servicos/integracoes/webhooks";
import { crc32, montarZip } from "@/lib/servicos/integracoes/zip";
import {
  CATALOGO,
  CATEGORIAS_INTEGRACAO,
  RECURSOS_API,
  aplicarModelo,
  atrasoMinutos,
  catalogoDoModo,
  chaveDoCabecalho,
  codificarCursor,
  csvContabil,
  dataPlanilha,
  decodificarCursor,
  dicaSegredo,
  entregaOk,
  escoposDoModo,
  eventosDoModo,
  filtrarEscopos,
  filtrarEventos,
  formatarBytes,
  hostBloqueado,
  interpretarContratos,
  ipBloqueado,
  linhaContabil,
  modeloDoMapa,
  prefixoDaChave,
  resumoContabil,
  separarCampos,
  situacaoChave,
  statusIntegracao,
  internoEmUso,
  ROTULO_STATUS_INTEGRACAO,
  sugerirMapeamento,
  validarUrlWebhook,
  type ItemMapa,
  type LancamentoContabil,
} from "@/lib/dominio/integracoes";

describe("catálogo", () => {
  it("todo item tem categoria conhecida e id único; provedor tem campos", () => {
    const cats = new Set(CATEGORIAS_INTEGRACAO.map((c) => c.id));
    const ids = CATALOGO.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const i of CATALOGO) {
      expect(cats.has(i.categoria)).toBe(true);
      if (i.tipo === "provedor") expect(i.campos?.length).toBeGreaterThan(0);
      else expect(i.href).toBeTruthy();
    }
  });

  it("no pessoal somem portais, anúncios e repasses", () => {
    const pessoal = catalogoDoModo("pessoal").map((i) => i.id);
    expect(pessoal).not.toContain("portais_feed");
    expect(pessoal).not.toContain("lead_ads");
    expect(pessoal).not.toContain("banco_pagamentos");
    expect(pessoal).toContain("pix_copia_cola");
    expect(pessoal).toContain("api_rest");
    expect(catalogoDoModo("imobiliaria").length).toBe(CATALOGO.length);
  });

  it("status: nada fica \"Ativo\" sem estar em uso; testável chega no máximo a \"configurado (conexão ok)\"", () => {
    const asaas = CATALOGO.find((i) => i.id === "asaas")!;
    const resend = CATALOGO.find((i) => i.id === "resend")!;
    const serasa = CATALOGO.find((i) => i.id === "serasa")!;
    const pix = CATALOGO.find((i) => i.id === "pix_copia_cola")!;
    const whatsapp = CATALOGO.find((i) => i.id === "whatsapp")!;
    const api = CATALOGO.find((i) => i.id === "api_rest")!;
    const n8n = CATALOGO.find((i) => i.id === "n8n")!;
    const ics = CATALOGO.find((i) => i.id === "ics")!;
    // Interno: "disponível no sistema" até haver sinal de uso na conta.
    expect(statusIntegracao(pix, null)).toBe("no_sistema");
    expect(statusIntegracao(pix, null, { pix: true })).toBe("ativo");
    expect(statusIntegracao(whatsapp, null, { pix: true })).toBe("no_sistema");
    expect(statusIntegracao(whatsapp, null, { whatsapp: true })).toBe("ativo");
    expect(statusIntegracao(api, null, { chavesApi: 0, webhooks: 2 })).toBe("no_sistema");
    expect(statusIntegracao(api, null, { chavesApi: 1 })).toBe("ativo");
    expect(statusIntegracao(n8n, null, { webhooks: 1 })).toBe("ativo");
    expect(statusIntegracao(ics, null, { pix: true, whatsapp: true, chavesApi: 3 })).toBe("no_sistema");
    // Provedor com teste real: nunca "ativo" (o sistema ainda não emite nada por ele).
    expect(statusIntegracao(asaas, null)).toBe("disponivel");
    expect(statusIntegracao(asaas, { ativo: false, ultimo_teste_ok: null })).toBe("configurado");
    expect(statusIntegracao(asaas, { ativo: true, ultimo_teste_ok: false })).toBe("configurado");
    expect(statusIntegracao(asaas, { ativo: true, ultimo_teste_ok: true })).toBe("conexao_ok");
    expect(statusIntegracao(resend, { ativo: true, ultimo_teste_ok: true })).toBe("conexao_ok");
    expect(ROTULO_STATUS_INTEGRACAO.conexao_ok).toBe("Configurado (conexão ok)");
    expect(ROTULO_STATUS_INTEGRACAO.no_sistema).toBe("Disponível no sistema");
    // Sem chamada implementada: depende de contrato; configurado guarda a configuração.
    expect(statusIntegracao(serasa, null)).toBe("depende_contrato");
    expect(statusIntegracao(serasa, { ativo: true, ultimo_teste_ok: null })).toBe("configurado");
    // Nenhum provedor promete baixa automática ou envio que não existe.
    for (const i of CATALOGO.filter((x) => x.tipo === "provedor" && x.testavel)) expect(i.descricao).toMatch(/pronto para ligar/);
    expect(internoEmUso("ga4", { ga4: true })).toBe(true);
    expect(internoEmUso("ga4", null)).toBe(false);
  });

  it("separa segredos da configuração e acusa obrigatórios", () => {
    const smtp = CATALOGO.find((i) => i.id === "smtp")!;
    const r = separarCampos(smtp, { host: " smtp.x.com ", senha: "abc", usuario: "" });
    expect(r.config).toEqual({ host: "smtp.x.com" });
    expect(r.segredos).toEqual({ senha: "abc" });
    expect(separarCampos(smtp, {}).faltando).toEqual(["Servidor SMTP"]);
    expect(dicaSegredo("sk_live_123456789")).toBe("••••6789");
    expect(dicaSegredo("ab")).toBe("••••");
  });
});

describe("chaves e API", () => {
  it("escopos por modo e formato da chave", () => {
    expect(escoposDoModo("pessoal").map((e) => e.id)).not.toContain("leads:leitura");
    expect(filtrarEscopos(["leads:leitura", "imoveis:leitura", "imoveis:leitura", "x"], "pessoal")).toEqual(["imoveis:leitura"]);
    const chave = `na_${"a".repeat(10)}_${"b".repeat(48)}`;
    expect(prefixoDaChave(chave)).toBe(`na_${"a".repeat(10)}`);
    expect(prefixoDaChave("na_curta")).toBeNull();
    expect(chaveDoCabecalho(`Bearer ${chave}`)).toBe(chave);
    expect(chaveDoCabecalho("bearer   x  ")).toBe("x");
    expect(chaveDoCabecalho(null, " y ")).toBe("y");
    expect(chaveDoCabecalho("Basic abc")).toBeNull();
    expect(situacaoChave({ revogada_em: null, expira_em: null }, "2026-01-01T00:00:00Z")).toBe("ativa");
    expect(situacaoChave({ revogada_em: null, expira_em: "2025-01-01T00:00:00Z" }, "2026-01-01T00:00:00Z")).toBe("expirada");
    expect(situacaoChave({ revogada_em: "2025-01-01", expira_em: null }, "2026-01-01T00:00:00Z")).toBe("revogada");
  });

  it("cursor opaco vai e volta; lixo é recusado", () => {
    const bruto = "2026-11-04T17:12:08.123456Z|0b6c2a4e-1d2f-4a3b-9c8d-7e6f5a4b3c2d";
    const c = codificarCursor(bruto)!;
    expect(c).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodificarCursor(c)).toBe(bruto);
    expect(decodificarCursor(null)).toBeNull();
    expect(decodificarCursor("@@@")).toBe(false);
    expect(decodificarCursor(codificarCursor("2026-01-01|x"))).toBe(false);
  });

  it("especificação OpenAPI: todo recurso tem lista e item; filtros só os conhecidos", () => {
    for (const r of RECURSOS_API) {
      expect(ESPECIFICACAO_API.paths).toHaveProperty(`/${r}`);
      expect(ESPECIFICACAO_API.paths).toHaveProperty(`/${r}/{id}`);
      expect(FILTROS_API[r]).toBeDefined();
    }
    expect(ESPECIFICACAO_API.openapi).toBe("3.1.0");
    expect(Object.keys(ESPECIFICACAO_API.webhooks)).toHaveLength(13);
    expect(especificacaoCom("https://app.x.com/").servers[0].url).toBe("https://app.x.com/api/v1");
    const sp = new URLSearchParams("status=ativo&senha=1&imovel_id=abc&limite=3");
    expect(filtrosDaConsulta("contratos", sp)).toEqual({ status: "ativo", imovel_id: "abc" });
    expect(JSON.parse(JSON.stringify(ESPECIFICACAO_API))).toBeTruthy();
  });
});

describe("webhooks", () => {
  it("espera crescente entre tentativas, com teto de 1 dia", () => {
    expect([1, 2, 3, 4, 5, 6, 7].map(atrasoMinutos)).toEqual([5, 15, 45, 135, 405, 1215, 1440]);
    expect(atrasoMinutos(0)).toBe(5);
    expect(entregaOk(204)).toBe(true);
    expect(entregaOk(301)).toBe(false);
    expect(entregaOk(null)).toBe(false);
  });

  it("eventos por modo", () => {
    expect(eventosDoModo("pessoal").map((e) => e.id)).not.toContain("lead.criado");
    expect(filtrarEventos(["lead.criado", "fatura.paga", "x"], "pessoal")).toEqual(["fatura.paga"]);
    expect(filtrarEventos(["lead.criado", "fatura.paga"], "imobiliaria")).toEqual(["lead.criado", "fatura.paga"]);
  });

  it("bloqueia destinos internos (IPv4, IPv6, nomes) e aceita públicos", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.0.10", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "::", "fe80::1", "fd00:ec2::254", "fc00::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "64:ff9b::a00:1", "999.1.1.1", "lixo"])
      expect(ipBloqueado(ip), ip).toBe(true);
    for (const ip of ["8.8.8.8", "172.32.0.1", "200.147.67.142", "2606:4700:4700::1111", "::ffff:8.8.8.8"]) expect(ipBloqueado(ip), ip).toBe(false);
    for (const h of ["localhost", "api.localhost", "intranet", "metadata.google.internal", "app.local", "10.0.0.1", "[::1]", "x.nip.io"]) expect(hostBloqueado(h), h).toBe(true);
    for (const h of ["n8n.exemplo.com.br", "hooks.zapier.com", "8.8.8.8"]) expect(hostBloqueado(h), h).toBe(false);
  });

  it("valida a URL do webhook", () => {
    expect(validarUrlWebhook("https://n8n.exemplo.com.br/webhook/1")).toBeNull();
    expect(validarUrlWebhook("http://n8n.exemplo.com.br/webhook/1")).toMatch(/https/);
    expect(validarUrlWebhook("https://user:pw@exemplo.com/x")).toMatch(/usuário/);
    expect(validarUrlWebhook("https://127.0.0.1/x")).toMatch(/interno/);
    expect(validarUrlWebhook("nada")).toMatch(/inválido/);
  });
});

describe("exportação contábil", () => {
  const mapa: ItemMapa[] = [
    { origem_tipo: "plano", origem_id: "p1", origem_texto: null, conta_contabil: "31101", historico_padrao: "Taxa {descricao}" },
    { origem_tipo: "categoria", origem_id: null, origem_texto: "Água e Luz", conta_contabil: "41205" },
    { origem_tipo: "padrao", origem_id: null, origem_texto: "despesa", conta_contabil: "49999" },
    { origem_tipo: "padrao", origem_id: null, origem_texto: "banco", conta_contabil: "11201" },
    { origem_tipo: "conta_financeira", origem_id: "c1", origem_texto: null, conta_contabil: "11205" },
  ];
  const base: LancamentoContabil = { data: "2026-10-05", tipo: "receber", descricao: "adm out", categoria: null, valor: 100.1, documento: "NF 1", pessoa: "Ana", plano_id: "p1", plano_codigo: "3.1", conta_id: "c1", conta_nome: "Itaú" };

  it("conta pelo de-para, depois categoria, plano e padrão; contrapartida pelo banco", () => {
    const a = linhaContabil(base, mapa);
    expect(a).toMatchObject({ conta: "31101", contrapartida: "11205", natureza: "C", historico: "Taxa adm out", valor: 100.1 });
    const b = linhaContabil({ ...base, tipo: "pagar", plano_id: null, plano_codigo: null, categoria: "agua e luz", conta_id: null }, mapa);
    expect(b).toMatchObject({ conta: "41205", contrapartida: "11201", natureza: "D", historico: "adm out - Ana" });
    const c = linhaContabil({ ...base, tipo: "pagar", plano_id: "px", plano_codigo: "4.9", categoria: null }, mapa);
    expect(c.conta).toBe("4.9");
    const d = linhaContabil({ ...base, tipo: "pagar", plano_id: null, plano_codigo: null, categoria: "Outra" }, mapa);
    expect(d.conta).toBe("49999");
    const e = linhaContabil({ ...base, tipo: "receber", plano_id: null, plano_codigo: null, categoria: null }, []);
    expect(e.conta).toBe("");
    const r = resumoContabil([a, b, e]);
    expect(r).toEqual({ debitos: 100.1, creditos: 200.2, semConta: 1, total: 3 });
  });

  it("CSV no layout genérico (; e vírgula decimal, fórmula neutralizada)", () => {
    const csv = csvContabil([linhaContabil({ ...base, descricao: "=SOMA(A1)", plano_id: null, categoria: null }, [])]);
    const linhas = csv.replace(/^﻿/, "").split("\r\n");
    expect(linhas[0]).toBe("Data;Conta;Contrapartida;Historico;D/C;Valor;Documento;Categoria");
    expect(linhas[1]).toBe("05/10/2026;3.1;;'=SOMA(A1) - Ana;C;100,10;NF 1;");
  });
});

describe("importação de contratos", () => {
  const cab = ["Cod Imovel", "CPF Inquilino", "CPF Fiador", "Início", "Prazo", "Valor do aluguel", "Vencimento", "Índice", "Garantia", "Coluna X"];

  it("sugere o mapeamento pelos títulos (sem repetir campo) e aplica modelo salvo", () => {
    const m = sugerirMapeamento(cab);
    expect(m).toEqual(["imovel_codigo", "locatario_documento", "fiador_documento", "data_inicio", "prazo_meses", "valor_aluguel", "dia_vencimento", "indice_reajuste", "garantia_tipo", null]);
    const modelo = modeloDoMapa(cab, m);
    expect(modelo["Cod Imovel"]).toBe("imovel_codigo");
    expect(aplicarModelo(["cod imovel", "Outra"], modelo)).toEqual(["imovel_codigo", null]);
    expect(sugerirMapeamento(["Taxa de administração"], "pessoal")).toEqual([null]);
  });

  it("datas da planilha", () => {
    expect(dataPlanilha("01/03/2024")).toBe("2024-03-01");
    expect(dataPlanilha("1/3/24")).toBe("2024-03-01");
    expect(dataPlanilha("2024-03-01")).toBe("2024-03-01");
    expect(dataPlanilha(45352)).toBe("2024-03-01");
    expect(dataPlanilha(new Date(Date.UTC(2024, 2, 1)))).toBe("2024-03-01");
    expect(dataPlanilha("31/02/2024")).toBeNull();
    expect(dataPlanilha("ontem")).toBeNull();
  });

  it("valida cada linha", () => {
    const m = sugerirMapeamento(cab);
    const linhas = interpretarContratos(
      [
        cab,
        ["AP-1", "111.444.777-35", "", "01/03/2024", "30", "2.500,00", "10", "IGP-M", "caução", "x"],
        ["AP-2", "11144477700", "11144477735", "32/01/2024", "0", "-1", "40", "SELIC", "fiador", ""],
        ["", "", "", "", "", "", "", "", "fiador", ""],
        ["AP-3", "52998224725", "11144477735", "2024-01-01", "", "1000", "", "", "", ""],
        ["", "", "", "", "", "", "", "", "", ""],
      ],
      m,
    );
    expect(linhas).toHaveLength(4);
    expect(linhas[0].erros).toEqual([]);
    expect(linhas[0].dados).toMatchObject({ imovel_codigo: "AP-1", locatario_documento: "11144477735", valor_aluguel: 2500, prazo_meses: 30, indice_reajuste: "IGPM", garantia_tipo: "caucao", status: "ativo", data_inicio: "2024-03-01" });
    expect(linhas[1].erros.join(" | ")).toMatch(/locatário inválido.*início inválida.*prazo.*aluguel.*vencimento.*índice/);
    expect(linhas[2].erros).toEqual(expect.arrayContaining(["sem código do imóvel", "sem CPF/CNPJ do locatário", "garantia por fiador sem o CPF/CNPJ do fiador"]));
    expect(linhas[3]).toMatchObject({ linha: 5, erros: [], dados: { prazo_meses: 30, dia_vencimento: 10, garantia_tipo: "sem_garantia", fiador_documento: "11144477735" } });
  });

  it("prazo calculado pelo fim quando não vem", () => {
    const l = interpretarContratos(
      [
        ["Imovel", "CPF", "Inicio", "Fim", "Aluguel"],
        ["A", "11144477735", "01/01/2024", "31/12/2025", "900"],
      ],
      sugerirMapeamento(["Imovel", "CPF", "Inicio", "Fim", "Aluguel"]),
    );
    expect(l[0].dados.prazo_meses).toBe(24);
    expect(l[0].erros).toEqual([]);
  });
});

describe("armazenamento", () => {
  it("formata tamanhos", () => {
    expect(formatarBytes(0)).toBe("0 KB");
    expect(formatarBytes(512)).toBe("512 bytes");
    expect(formatarBytes(1536)).toBe("1,5 KB");
    expect(formatarBytes(250 * 1024 * 1024)).toBe("250 MB");
  });

  it("zip sem compressão: CRC32 e estrutura (cabeçalhos, diretório central e fim)", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
    const a = new TextEncoder().encode("olá");
    const zip = montarZip([
      { nome: "documentos/contrato.txt", dados: a, data: new Date(2026, 10, 4, 10, 30, 0) },
      { nome: "/fotos/á.jpg", dados: new Uint8Array([1, 2, 3]) },
    ]);
    const v = new DataView(zip.buffer);
    expect(v.getUint32(0, true)).toBe(0x04034b50);
    expect(v.getUint32(14, true)).toBe(crc32(a));
    const fim = zip.length - 22;
    expect(v.getUint32(fim, true)).toBe(0x06054b50);
    expect(v.getUint16(fim + 10, true)).toBe(2);
    const inicioCentral = v.getUint32(fim + 16, true);
    expect(v.getUint32(inicioCentral, true)).toBe(0x02014b50);
    expect(new TextDecoder().decode(zip.slice(30, 30 + 23))).toBe("documentos/contrato.txt");
    expect(new TextDecoder().decode(zip)).toContain("fotos/á.jpg");
    expect(new TextDecoder().decode(zip)).not.toContain("/fotos/á.jpg");
  });
});

describe("servidor: segredos, entrega de webhook e rotas da API", () => {
  it("segredos cifrados com INTEGRACOES_CHAVE (e lidos sem ela quando gravados sem cifra)", () => {
    const antes = process.env.INTEGRACOES_CHAVE;
    delete process.env.INTEGRACOES_CHAVE;
    expect(cifrar("abc")).toBe("abc");
    expect(decifrar("abc")).toBe("abc");
    process.env.INTEGRACOES_CHAVE = "uma-chave-mestra-bem-comprida";
    const c = cifrar("sk_live_123");
    expect(c.startsWith("v1:")).toBe(true);
    expect(c).not.toContain("sk_live_123");
    expect(decifrar(c)).toBe("sk_live_123");
    expect(decifrarTodos(cifrarTodos({ a: "1", b: "2" }))).toEqual({ a: "1", b: "2" });
    process.env.INTEGRACOES_CHAVE = "outra-chave-mestra-diferente";
    expect(decifrar(c)).toBeNull();
    if (antes === undefined) delete process.env.INTEGRACOES_CHAVE;
    else process.env.INTEGRACOES_CHAVE = antes;
  });

  it("webhook para destino interno é bloqueado antes de conectar", async () => {
    const base = { id: "x", evento: "webhook.teste", tentativa: 1, corpo: "{}", assinatura: "sha256=0" };
    for (const url of ["https://127.0.0.1/h", "https://localhost/h", "https://[::1]/h", "https://169.254.169.254/latest/meta-data", "http://exemplo.com.br/h", "https://u:p@exemplo.com.br/h", "lixo"]) {
      const r = await enviarWebhook({ ...base, url });
      expect(r.status, url).toBeNull();
      expect(r.erro, url).toMatch(/bloqueado|inválido/);
    }
  });

  it("rotas /api/v1: recurso desconhecido 404, sem chave 401, POST em recurso de leitura 405, OpenAPI pública", async () => {
    const ctx = (p: Record<string, string>) => ({ params: Promise.resolve(p) }) as never;
    const r404 = await getLista(new Request("https://x.com/api/v1/planetas"), ctx({ recurso: "planetas" }));
    expect(r404.status).toBe(404);
    expect(await r404.json()).toMatchObject({ erro: { codigo: "nao_encontrado" } });
    const r401 = await getLista(new Request("https://x.com/api/v1/imoveis"), ctx({ recurso: "imoveis" }));
    expect(r401.status).toBe(401);
    const r401b = await getItem(new Request("https://x.com/api/v1/imoveis/1", { headers: { Authorization: "Basic x" } }), ctx({ recurso: "imoveis", id: "1" }));
    expect(r401b.status).toBe(401);
    const r405 = await postLista(new Request("https://x.com/api/v1/imoveis", { method: "POST" }), ctx({ recurso: "imoveis" }));
    expect(r405.status).toBe(405);
    const spec = await getOpenapi(new Request("https://app.x.com/api/v1/openapi.json"));
    expect((await spec.json()).servers[0].url).toBe("https://app.x.com/api/v1");
  });
});
