/** Regras puras do site imobiliário e da integração com portais. */
import { describe, expect, it, vi } from "vitest";
import {
  alternarNaLista,
  caminhoNoSite,
  codigoTxt,
  contrasteComBranco,
  corLegivel,
  descricaoSeo,
  dnsApontaCerto,
  dominioDoHost,
  embedVideo,
  enquadrar,
  filtrarImoveis,
  gerarSitemap,
  instanteVisita,
  instrucoesDns,
  jsonLdImovel,
  jsonSeguro,
  lerCodigos,
  lerFiltros,
  normalizarDominio,
  opcoesFiltro,
  ordenarImoveis,
  paginar,
  paletaMarca,
  pendenciasSite,
  pontosValidos,
  precoCurto,
  precoDe,
  precosExibidos,
  problemaHorarioVisita,
  projetar,
  queryFiltros,
  resumoImovel,
  similares,
  slugValido,
  sugerirSlug,
  tilesVisiveis,
  tituloImovel,
  tourSeguro,
  txtConfere,
  valorParaBanco,
  type ImovelSite,
} from "@/lib/dominio/site";
import { cdata, escXml, gerarOlx, gerarVrsync, iptuAnual, lerLeadPortal, selecionarParaFeed, validarParaPortal, type ImovelPortal } from "@/lib/dominio/site-portais";
import { gerarICS } from "@/lib/dominio/agenda";
import { NextRequest } from "next/server";
import { reescreverDominioProprio } from "@/lib/servicos/site-dominio";

const base: ImovelSite = {
  id: "1",
  codigo: "AP-1",
  titulo: null,
  tipo: "apartamento",
  finalidades: ["locacao"],
  status: "disponivel",
  bairro: "Centro",
  cidade: "Canoas",
  uf: "RS",
  latitude: -29.9,
  longitude: -51.18,
  area_util: 60,
  area_total: null,
  area_construida: null,
  area_privativa: null,
  quartos: 2,
  suites: 1,
  banheiros: 1,
  vagas: 1,
  valor_venda: null,
  valor_aluguel: 1800,
  valor_condominio: 400,
  valor_iptu: 1200,
  comodidades: ["Piscina", "Elevador"],
  caracteristicas: [],
  descricao: "Apartamento claro perto do metrô",
  empreendimento_id: null,
  empreendimento: null,
  criado_em: "2026-10-01T10:00:00Z",
};
const im = (p: Partial<ImovelSite>): ImovelSite => ({ ...base, ...p });

describe("endereço, cores e domínio", () => {
  it("sugere e valida o slug", () => {
    expect(sugerirSlug("Imobiliária São João Ltda.")).toBe("imobiliaria-sao-joao-ltda");
    expect(sugerirSlug("AB")).toBe("ab-site");
    expect(sugerirSlug("Admin")).toBe("admin-imoveis");
    expect(slugValido("imob-legal")).toBe(true);
    expect(slugValido("Imob")).toBe(false);
    expect(slugValido("-imob")).toBe(false);
    expect(slugValido("im--ob")).toBe(false);
    expect(slugValido("api")).toBe(false);
  });

  it("deixa a cor da marca legível com texto branco", () => {
    expect(corLegivel("#2563eb")).toBe("#2563eb");
    const amarelo = corLegivel("#ffee00");
    expect(contrasteComBranco(amarelo)).toBeGreaterThanOrEqual(3);
    expect(corLegivel("azul")).toBe("#2563eb");
    const p = paletaMarca("#16a34a", "#ffffff");
    expect(p["--accent-bg"]).toMatch(/^rgba\(/);
    expect(p["--site-sobre-escuro"]).toBe("#111827");
    expect(paletaMarca("#16a34a", "#0f172a")["--site-sobre-escuro"]).toBe("#ffffff");
  });

  it("normaliza o domínio e confere o DNS", () => {
    expect(normalizarDominio("https://www.MinhaImob.com.br/imoveis?x=1")).toBe("minhaimob.com.br");
    expect(normalizarDominio("imob.com.br.")).toBe("imob.com.br");
    expect(normalizarDominio("não é domínio")).toBeNull();
    expect(normalizarDominio("localhost")).toBeNull();
    const site = "5b0c7a52-1d1e-4c4b-9f0e-0a1b2c3d4e5f";
    expect(instrucoesDns("imob.com.br", site).map((r) => [r.tipo, r.nome, r.valor])).toEqual([
      ["TXT", "_novoaluguel", `novoaluguel-site=${site}`],
      ["A", "@", "76.76.21.21"],
      ["CNAME", "www", "cname.vercel-dns.com"],
    ]);
    expect(dnsApontaCerto({ a: ["76.76.21.21"] })).toBe(true);
    expect(dnsApontaCerto({ cname: ["cname.vercel-dns.com."] })).toBe(true);
    expect(dnsApontaCerto({ a: ["1.2.3.4"], cname: [] })).toBe(false);
  });

  it("posse do domínio: o TXT precisa ter o código DESTE site", () => {
    const site = "5b0c7a52-1d1e-4c4b-9f0e-0a1b2c3d4e5f";
    expect(codigoTxt(site)).toBe(`novoaluguel-site=${site}`);
    // Registros TXT podem vir em pedaços e com outros registros junto.
    expect(txtConfere([["v=spf1 -all"], ["novoaluguel-site=", site]], site)).toBe(true);
    expect(txtConfere([[`"NOVOALUGUEL-SITE=${site.toUpperCase()}"`]], site)).toBe(true);
    expect(txtConfere([["novoaluguel-site=00000000-0000-0000-0000-000000000000"]], site)).toBe(false);
    expect(txtConfere([], site)).toBe(false);
    expect(txtConfere(null, site)).toBe(false);
  });

  it("proxy: reconhece o domínio próprio e monta o caminho interno do site", () => {
    expect(dominioDoHost("www.MinhaImob.com.br")).toBe("minhaimob.com.br");
    expect(dominioDoHost("minhaimob.com.br:443")).toBe("minhaimob.com.br");
    // Endereços do próprio sistema não são domínio de imobiliária.
    expect(dominioDoHost("localhost:3000")).toBeNull();
    expect(dominioDoHost("127.0.0.1")).toBeNull();
    expect(dominioDoHost("novo-aluguel.vercel.app")).toBeNull();
    expect(dominioDoHost("app.novoaluguel.com.br", ["app.novoaluguel.com.br"])).toBeNull();
    expect(dominioDoHost("")).toBeNull();
    expect(dominioDoHost(null)).toBeNull();
    expect(caminhoNoSite("/", "imob-site")).toBe("/s/imob-site");
    expect(caminhoNoSite("/imovel/AP-1", "imob-site")).toBe("/s/imob-site/imovel/AP-1");
    expect(caminhoNoSite("/robots.txt", "imob-site")).toBe("/s/imob-site/robots.txt");
    expect(caminhoNoSite("/sitemap.xml", "imob-site")).toBe("/s/imob-site/sitemap.xml");
    // Links que já vêm com /s/ (foto fixa), APIs e arquivos do Next passam direto.
    expect(caminhoNoSite("/s/imob-site/foto/123", "imob-site")).toBeNull();
    expect(caminhoNoSite("/api/portais/x/zap", "imob-site")).toBeNull();
    expect(caminhoNoSite("/_next/data/x.json", "imob-site")).toBeNull();
    expect(caminhoNoSite("/", "Slug Ruim")).toBeNull();
  });

  it("proxy: domínio sem site confirmado recebe 404 (nunca o login do sistema) quando HOSTS_DO_SISTEMA está configurado", async () => {
    // Sem banco aqui: nenhum site é dono do domínio.
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    const req = (host: string) => new NextRequest(`https://${host}/login`, { headers: { host } });
    try {
      vi.stubEnv("HOSTS_DO_SISTEMA", " app.novoaluguel.com.br ");
      const fora = await reescreverDominioProprio(req("imob-sem-txt.com.br"));
      expect(fora?.status).toBe(404);
      expect(await reescreverDominioProprio(req("app.novoaluguel.com.br"))).toBeNull();
      expect(await reescreverDominioProprio(req("www.app.novoaluguel.com.br"))).toBeNull();
      expect(await reescreverDominioProprio(req("localhost:3000"))).toBeNull();
      // Sem a variável não dá para separar o endereço do sistema: segue o fluxo normal.
      vi.stubEnv("HOSTS_DO_SISTEMA", "");
      expect(await reescreverDominioProprio(req("outro-sem-txt.com.br"))).toBeNull();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("catálogo", () => {
  const lista = [
    im({ id: "1", codigo: "AP-1" }),
    im({ id: "2", codigo: "CASA-2", tipo: "casa", finalidades: ["venda"], valor_aluguel: null, valor_venda: 650000, bairro: "Niterói", quartos: 3, area_util: 140, comodidades: ["Churrasqueira"], criado_em: "2026-10-05T10:00:00Z" }),
    im({ id: "3", codigo: "AP-3", valor_aluguel: 2500, quartos: 3, bairro: "Igara", criado_em: "2026-09-01T10:00:00Z", latitude: null, longitude: null }),
    im({ id: "4", codigo: "SALA-4", tipo: "sala comercial", cidade: "Porto Alegre", bairro: "Moinhos", valor_aluguel: 3000, quartos: null, area_util: 40, criado_em: "2026-08-01T10:00:00Z" }),
  ];

  it("lê os filtros da URL e monta de volta", () => {
    const f = lerFiltros({ finalidade: "locacao", preco_max: "2.600", quartos: "2", comodidade: ["Piscina", " "], ordem: "menor_preco", pagina: "2", lixo: "x" });
    expect(f).toMatchObject({ finalidade: "locacao", precoMax: 2600, quartos: 2, comodidades: ["Piscina"], ordem: "menor_preco", pagina: 2 });
    expect(lerFiltros({ ordem: "hackear", pagina: "-3" })).toMatchObject({ ordem: "recentes", pagina: 1 });
    expect(queryFiltros(f, { pagina: 3 })).toBe("?finalidade=locacao&preco_max=2600&quartos=2&ordem=menor_preco&pagina=3&comodidade=Piscina");
    expect(queryFiltros(lerFiltros({}))).toBe("");
  });

  it("filtra por finalidade, local, preço, quartos, área, comodidades e texto", () => {
    const cod = (f: Record<string, string | string[]>) => filtrarImoveis(lista, lerFiltros(f)).map((i) => i.codigo);
    expect(cod({ finalidade: "venda" })).toEqual(["CASA-2"]);
    expect(cod({ cidade: "porto alegre" })).toEqual(["SALA-4"]);
    expect(cod({ finalidade: "locacao", preco_min: "2000", preco_max: "2800" })).toEqual(["AP-3"]);
    expect(cod({ preco_max: "700000", preco_min: "600000" })).toEqual(["CASA-2"]);
    expect(cod({ quartos: "3" })).toEqual(["CASA-2", "AP-3"]);
    expect(cod({ area_min: "100" })).toEqual(["CASA-2"]);
    expect(cod({ comodidade: "piscina", bairro: "Centro" })).toEqual(["AP-1"]);
    expect(cod({ busca: "metro igara" })).toEqual(["AP-3"]);
    expect(cod({ tipo: "Sala Comercial" })).toEqual(["SALA-4"]);
  });

  it("ordena (preço vazio vai para o fim), pagina e acha parecidos", () => {
    const sem = im({ id: "9", codigo: "SEM", valor_aluguel: null, criado_em: "2026-11-01T00:00:00Z" });
    expect(ordenarImoveis([...lista, sem], "menor_preco", "locacao").map((i) => i.codigo)).toEqual(["AP-1", "AP-3", "SALA-4", "CASA-2", "SEM"]);
    expect(ordenarImoveis(lista, "maior_preco").map((i) => i.codigo)[0]).toBe("CASA-2");
    expect(ordenarImoveis(lista, "recentes").map((i) => i.codigo)).toEqual(["CASA-2", "AP-1", "AP-3", "SALA-4"]);
    expect(ordenarImoveis(lista, "maior_area").map((i) => i.codigo)[0]).toBe("CASA-2");
    const pg = paginar([1, 2, 3, 4, 5], 9, 2);
    expect(pg).toEqual({ itens: [5], pagina: 3, paginas: 3, total: 5 });
    expect(similares(lista[0], lista).map((i) => i.codigo)).toEqual(["AP-3"]);
    expect(similares(lista[3], lista)).toEqual([]);
  });

  it("monta título, resumo, preços e opções de filtro", () => {
    expect(tituloImovel(base)).toBe("Apartamento com 2 quartos para alugar em Centro, Canoas");
    expect(tituloImovel(lista[1])).toBe("Casa com 3 quartos à venda em Niterói, Canoas");
    expect(tituloImovel(im({ titulo: "  Lindo apê  " }))).toBe("Lindo apê");
    expect(resumoImovel(base)).toBe("2 quartos · 1 suíte · 1 banheiro · 1 vaga · 60 m²");
    // IPTU do cadastro é mensal ("IPTU (R$/mês)"): entra inteiro no total do mês.
    expect(precosExibidos(base)).toEqual({ aluguel: 1800, venda: null, condominio: 400, iptu: 1200, totalMes: 3400 });
    expect(precosExibidos(im({ valor_condominio: null, valor_iptu: 150.35 })).totalMes).toBe(1950.35);
    expect(precosExibidos(im({ valor_condominio: null, valor_iptu: null })).totalMes).toBeNull();
    expect(precoDe(im({ finalidades: ["venda", "locacao"], valor_venda: 500000 }))).toBe(1800);
    expect(precoCurto(2500)).toBe("R$ 2,5 mil");
    expect(precoCurto(650000)).toBe("R$ 650 mil");
    expect(precoCurto(1250000)).toBe("R$ 1,3 mi");
    expect(precoCurto(null)).toBe("Consulte");
    const op = opcoesFiltro(lista, "Canoas");
    expect(op.cidades.map((c) => [c.rotulo, c.n])).toEqual([
      ["Canoas", 3],
      ["Porto Alegre", 1],
    ]);
    expect(op.bairros.map((b) => b.rotulo)).toEqual(["Centro", "Igara", "Niterói"]);
  });

  it("lista o que falta no cadastro para o site", () => {
    expect(pendenciasSite({ ...base, fotos: 3, descricao: "x".repeat(60) })).toEqual([]);
    expect(pendenciasSite({ ...base, fotos: 0, descricao: null, bairro: null, valor_aluguel: null, latitude: null })).toEqual([
      "sem fotos",
      "descrição curta",
      "sem cidade/bairro",
      "sem valor",
      "fora do mapa",
    ]);
  });

  it("vídeo e tour só de fontes seguras", () => {
    expect(embedVideo("https://youtu.be/dQw4w9WgXcQ")).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
    expect(embedVideo("https://vimeo.com/123456")).toBe("https://player.vimeo.com/video/123456");
    expect(embedVideo("javascript:alert(1)")).toBeNull();
    expect(tourSeguro("https://my.matterport.com/show/?m=abc")).toBe("https://my.matterport.com/show/?m=abc");
    expect(tourSeguro("http://inseguro.com")).toBeNull();
    expect(tourSeguro('https://x.com/"><script>')).toBeNull();
  });
});

describe("mapa", () => {
  it("projeta, enquadra e lista os quadradinhos", () => {
    expect(projetar(0, 0, 0)).toEqual({ x: 128, y: 128 });
    const pts = pontosValidos([
      { latitude: -29.9, longitude: -51.18 },
      { latitude: "-29.95", longitude: "-51.1" },
      { latitude: null, longitude: -51 },
      { latitude: 0, longitude: 0 },
    ]);
    expect(pts).toHaveLength(2);
    const v = enquadrar(pts, 800, 400);
    expect(v.zoom).toBeGreaterThanOrEqual(10);
    expect(v.zoom).toBeLessThanOrEqual(16);
    for (const p of pts) {
      const q = projetar(p.lat, p.lon, v.zoom);
      expect(Math.abs(q.x - v.x)).toBeLessThanOrEqual(400 - 48);
      expect(Math.abs(q.y - v.y)).toBeLessThanOrEqual(200 - 48);
    }
    expect(enquadrar([], 800, 400).zoom).toBe(4);
    expect(enquadrar([{ lat: -23.5, lon: -46.6 }], 800, 400).zoom).toBe(16);
    const tiles = tilesVisiveis(512, 512, 2, 256, 256);
    expect(tiles.map((t) => t.chave)).toEqual(["2/1/1", "2/1/2", "2/2/1", "2/2/2"]);
    expect(tilesVisiveis(0, 0, 1, 512, 512).every((t) => t.y >= 0 && t.x >= 0 && t.x < 2)).toBe(true);
  });
});

describe("favoritos, comparação e SEO", () => {
  it("guarda favoritos e lê códigos da URL", () => {
    expect(alternarNaLista(["A", "B"], "C", 3)).toEqual(["C", "A", "B"]);
    expect(alternarNaLista(["A", "B", "C"], "D", 3)).toEqual(["D", "A", "B"]);
    expect(alternarNaLista(["A", "B"], "A", 3)).toEqual(["B"]);
    expect(lerCodigos("AP-1, ap-1,CASA 2,<script>,,X", 3)).toEqual(["AP-1", "CASA 2", "X"]);
    expect(lerCodigos(["A", "B"], 4)).toEqual(["A", "B"]);
    expect(lerCodigos(undefined, 4)).toEqual([]);
  });

  it("descrição curta, JSON-LD seguro e sitemap", () => {
    expect(descricaoSeo("a ".repeat(200), 20)).toBe("a a a a a a a a a a…");
    expect(descricaoSeo("curta")).toBe("curta");
    expect(descricaoSeo("Apartamento bonito, perto do centro", 22)).toBe("Apartamento bonito…");
    expect(jsonSeguro({ x: "</script><b>" })).not.toContain("<");
    const ld = jsonLdImovel(im({ status: "reservado", logradouro: "Rua A", numero: "1" }), "https://x/s/a/imovel/AP-1", ["https://x/f.jpg"], { nome: "Imob", url: "https://x" });
    expect(ld["@type"]).toBe("RealEstateListing");
    expect(ld.offers).toMatchObject({ price: "1800.00", priceCurrency: "BRL", availability: "https://schema.org/LimitedAvailability" });
    expect(ld.mainEntity["@type"]).toBe("Apartment");
    expect(ld.mainEntity.address.streetAddress).toBe("Rua A, 1");
    const xml = gerarSitemap([{ url: "https://x/s/a?b=1&c=2", atualizado: "2026-11-01T10:00:00Z", imagens: ["https://x/f.jpg"], prioridade: 0.8 }]);
    expect(xml).toContain("<loc>https://x/s/a?b=1&amp;c=2</loc>");
    expect(xml).toContain("<lastmod>2026-11-01</lastmod>");
    expect(xml).toContain("<image:loc>https://x/f.jpg</image:loc>");
  });
});

describe("visita e anúncio pelo site", () => {
  it("converte data e hora de Brasília e confere o prazo", () => {
    expect(instanteVisita("2026-11-10", "14:30")).toBe("2026-11-10T14:30:00-03:00");
    expect(instanteVisita("2026-02-31", "10:00")).toBeNull();
    expect(instanteVisita("2026-11-10", "25:00")).toBeNull();
    expect(instanteVisita("", "10:00")).toBeNull();
    const agora = new Date("2026-11-03T12:00:00-03:00");
    expect(problemaHorarioVisita("2026-11-03T12:30:00-03:00", agora)).toContain("1 hora");
    expect(problemaHorarioVisita("2026-11-04T10:00:00-03:00", agora)).toBeNull();
    expect(problemaHorarioVisita("2027-06-01T10:00:00-03:00", agora)).toContain("120 dias");
    expect(problemaHorarioVisita(null, agora)).toContain("Escolha");
    // Mesma regra do banco: das 8h às 18h de Brasília, de meia em meia hora.
    expect(problemaHorarioVisita("2026-11-04T08:00:00-03:00", agora)).toBeNull();
    expect(problemaHorarioVisita("2026-11-04T18:00:00-03:00", agora)).toBeNull();
    expect(problemaHorarioVisita("2026-11-04T07:30:00-03:00", agora)).toContain("entre 8h e 18h");
    expect(problemaHorarioVisita("2026-11-04T18:30:00-03:00", agora)).toContain("entre 8h e 18h");
    expect(problemaHorarioVisita("2026-11-04T10:15:00-03:00", agora)).toContain("meia em meia hora");
    expect(problemaHorarioVisita("2026-11-05T03:00:00Z", agora)).toContain("entre 8h e 18h");
    expect(problemaHorarioVisita("lixo", agora)).toContain("Escolha");
  });

  it("calendário .ics: texto do visitante não quebra linha nem injeta evento", () => {
    const ics = gerarICS(
      [{ id: "v1", titulo: "Visita\rEND:VEVENT", inicio: "2026-11-10T17:00:00.000Z", duracao_min: 45, descricao: "oi\r\nlinha 2\rBEGIN:VEVENT\rUID:x\u0001" }],
      "Agenda",
      "2026-11-01T00:00:00.000Z",
    );
    // Toda quebra de linha do arquivo é CRLF (nenhum CR ou LF solto no meio de uma linha).
    expect(ics.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
    expect(ics.match(/^BEGIN:VEVENT$/gm)).toHaveLength(1);
    expect(ics.match(/^END:VEVENT$/gm)).toHaveLength(1);
    expect(ics).toContain("SUMMARY:Visita\\nEND:VEVENT");
    expect(ics).not.toContain("\u0001");
  });

  it("valor digitado vira número para o banco", () => {
    expect(valorParaBanco("R$ 450.000")).toBe("450000");
    expect(valorParaBanco("1.200,50")).toBe("1200.5");
    expect(valorParaBanco("1200.5")).toBe("1200.5");
    expect(valorParaBanco("abc")).toBeNull();
    expect(valorParaBanco("0")).toBeNull();
  });
});

describe("portais", () => {
  const ok: ImovelPortal = {
    id: "i1",
    codigo: "AP-1",
    titulo: null,
    tipo: "apartamento",
    finalidades: ["locacao", "venda"],
    logradouro: "Rua das Flores",
    numero: "120",
    complemento: null,
    bairro: "Centro",
    cidade: "Canoas",
    uf: "RS",
    cep: "92010-000",
    latitude: -29.9,
    longitude: -51.18,
    area_util: 60.4,
    area_total: null,
    area_construida: null,
    area_privativa: null,
    quartos: 2,
    suites: 1,
    banheiros: 1,
    vagas: 1,
    valor_venda: 450000,
    valor_aluguel: 1800,
    valor_condominio: 400,
    valor_iptu: 1200,
    comodidades: ["Piscina", "Elevador", "Coisa nova"],
    caracteristicas: [],
    descricao: "Apartamento claro, reformado, com sol da manhã & vista <livre> para o parque ]]> fim.",
    video_url: "https://youtu.be/dQw4w9WgXcQ",
    destaque: "destaque",
    codigo_portal: null,
    fotos: ["https://x/s/a/foto/1", "https://x/s/a/foto/2", "https://x/s/a/foto/3", "https://x/s/a/foto/4", "https://x/s/a/foto/5"],
    plantas: ["https://x/s/a/foto/9"],
    url: "https://x/s/a/imovel/AP-1",
    criado_em: "2026-10-01T00:00:00Z",
  };

  it("aponta o que falta para cada portal", () => {
    expect(validarParaPortal(ok, "zap")).toEqual({ problemas: [], avisos: [] });
    const ruim = validarParaPortal({ ...ok, tipo: "outro", valor_venda: null, valor_aluguel: null, fotos: [], descricao: "curta", cep: "123", uf: "", bairro: null, area_util: null, quartos: null, numero: null }, "olx");
    expect(ruim.problemas).toEqual([
      'O tipo "outro" não existe no OLX. Escolha outro tipo no cadastro.',
      "Informe o valor do aluguel ou da venda.",
      "Envie pelo menos 1 foto.",
      "Escreva uma descrição com pelo menos 50 letras.",
      "Preencha a cidade e o bairro.",
      "Preencha a UF (ex.: SP).",
      "Preencha o CEP (8 números).",
      "Informe a área em m².",
      "Informe o número de quartos.",
    ]);
    expect(ruim.avisos).toContain("Sem rua e número o portal localiza o imóvel só pelo bairro.");
    // Terreno: área total; sala comercial: sem quartos.
    expect(validarParaPortal({ ...ok, tipo: "terreno", area_util: null, area_total: 300, quartos: null }, "zap").problemas).toEqual([]);
    expect(validarParaPortal({ ...ok, tipo: "sala comercial", quartos: null }, "zap").problemas).toEqual([]);
    expect(validarParaPortal({ ...ok, fotos: ok.fotos.slice(0, 2) }, "zap").avisos).toContain("Anúncios com 5 fotos ou mais aparecem melhor.");
  });

  it("respeita o limite de anúncios e de destaques do plano", () => {
    const lista = [
      { ...ok, id: "a", codigo: "A", destaque: "normal" as const, criado_em: "2026-10-03T00:00:00Z" },
      { ...ok, id: "b", codigo: "B", destaque: "super_destaque" as const, criado_em: "2026-10-01T00:00:00Z" },
      { ...ok, id: "c", codigo: "C", destaque: "destaque" as const, criado_em: "2026-10-02T00:00:00Z" },
      { ...ok, id: "d", codigo: "D", fotos: [] },
    ];
    const r = selecionarParaFeed(lista, "zap", { anuncios: 2, destaques: 1 });
    expect(r.enviar.map((i) => [i.codigo, i.destaque])).toEqual([
      ["B", "super_destaque"],
      ["C", "normal"],
    ]);
    expect(r.foraDoLimite.map((i) => i.codigo)).toEqual(["A"]);
    expect(r.falhas).toEqual([{ imovel_id: "d", codigo: "D", problemas: ["Envie pelo menos 1 foto."] }]);
    expect(r.avisos.map((a) => a.codigo)).toEqual(expect.arrayContaining(["C", "A"]));
    expect(selecionarParaFeed(lista, "zap").enviar).toHaveLength(3);
    // Empate (cadastrados no mesmo instante): fica a ordem em que o feed trouxe — a mesma do banco.
    const empate = ["x", "y", "z"].map((id) => ({ ...ok, id, codigo: id.toUpperCase(), destaque: "normal" as const, criado_em: "2026-10-05T10:00:00.123456+00:00" }));
    expect(selecionarParaFeed(empate, "zap", { anuncios: 2 }).enviar.map((i) => i.id)).toEqual(["x", "y"]);
    // Microssegundos: o mais recente vem antes (comparação de texto simples, como o banco).
    const micro = [
      { ...ok, id: "a", destaque: "normal" as const, criado_em: "2026-10-05T10:00:00+00:00" },
      { ...ok, id: "b", destaque: "normal" as const, criado_em: "2026-10-05T10:00:00.5+00:00" },
      { ...ok, id: "c", destaque: "normal" as const, criado_em: "2026-10-05T10:00:00.45+00:00" },
    ];
    expect(selecionarParaFeed(micro, "zap").enviar.map((i) => i.id)).toEqual(["b", "c", "a"]);
  });

  it("gera o VRSync (ZAP/Viva Real) com preço, fotos, endereço e escape", () => {
    const xml = gerarVrsync([ok], { nome: "Imob & Cia", email: "a@b.com", telefone: "(51) 9999-0000", mostrarEndereco: false, geradoEm: "2026-11-03T10:00:00.000Z" });
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain("<ListingID>AP-1</ListingID>");
    expect(xml).toContain("<TransactionType>Sale/Rent</TransactionType>");
    expect(xml).toContain('<ListPrice currency="BRL">450000</ListPrice>');
    expect(xml).toContain('<RentalPrice currency="BRL" period="Monthly">1800</RentalPrice>');
    // Portal pede o IPTU do ANO; o cadastro guarda o do mês (1200 × 12).
    expect(xml).toContain('<YearlyTax currency="BRL">14400</YearlyTax>');
    expect(xml).toContain('<PropertyAdministrationFee currency="BRL">400</PropertyAdministrationFee>');
    expect(xml).toContain('<LivingArea unit="square metres">60</LivingArea>');
    expect(xml).toContain("<PropertyType>Residential / Apartment</PropertyType>");
    expect(xml).toContain("<PublicationType>PREMIUM</PublicationType>");
    expect(xml).toContain('<Item medium="image" primary="true">https://x/s/a/foto/1</Item>');
    expect(xml).toContain('<Item medium="image" caption="Planta">https://x/s/a/foto/9</Item>');
    expect(xml).toContain('<Item medium="video">https://youtu.be/dQw4w9WgXcQ</Item>');
    expect(xml).toContain("<Feature>Pool</Feature><Feature>Elevator</Feature>");
    expect(xml).not.toContain("Coisa nova");
    expect(xml).toContain('<Location displayAddress="Neighborhood">');
    expect(xml).toContain("<PostalCode>92010-000</PostalCode>");
    expect(xml).toContain("<Provider>Imob &amp; Cia</Provider>");
    expect(xml).toContain("<Telephone>5199990000</Telephone>");
    expect(xml).toContain("]]]]><![CDATA[>");
  });

  it("gera o XML de carga da OLX", () => {
    const xml = gerarOlx([{ ...ok, codigo_portal: "998877" }], { nome: "Imob", mostrarEndereco: true, codigoAnunciante: "CLI-1", geradoEm: "2026-11-03T10:00:00.000Z" });
    expect(xml).toContain("<CodigoImovel>AP-1</CodigoImovel><CodigoOLX>998877</CodigoOLX>");
    expect(xml).toContain("<TipoImovel>Apartamento</TipoImovel><SubTipoImovel>Apartamento Padrão</SubTipoImovel>");
    expect(xml).toContain("<PrecoVenda>450000</PrecoVenda><PrecoLocacao>1800</PrecoLocacao>");
    expect(xml).toContain("<PrecoCondominio>400</PrecoCondominio><ValorIPTU>14400</ValorIPTU>");
    expect(iptuAnual(150.35)).toBe(1804);
    expect(iptuAnual(null)).toBeNull();
    expect(iptuAnual(0)).toBeNull();
    expect(xml).toContain("<CEP>92010000</CEP><MostrarEndereco>1</MostrarEndereco>");
    expect(xml).toContain("<Foto><NomeArquivo>foto-1.jpg</NomeArquivo><URLArquivo>https://x/s/a/foto/1</URLArquivo><Principal>1</Principal></Foto>");
    expect(xml).toContain("<Codigo>CLI-1</Codigo>");
    expect(escXml(`a<b>&"'`)).toBe("a&lt;b&gt;&amp;&quot;&apos;");
    expect(cdata("x\u0001y")).toBe("<![CDATA[xy]]>");
  });

  it("lê o lead do portal (formato Grupo OLX e em português)", () => {
    expect(
      lerLeadPortal(
        { leadOrigin: "VivaReal", originLeadId: "L-9", clientListingId: "AP-1", name: "Maria", email: "m@x.com", ddd: "11", phone: "99999-8888", message: "Ainda disponível?", transactionType: "RENT" },
        "vivareal",
      ),
    ).toEqual({ nome: "Maria", email: "m@x.com", telefone: "11999998888", imovel: "AP-1", funil: "locacao", mensagem: "Ainda disponível? (lead Viva Real nº L-9)", id_externo: "L-9" });
    expect(lerLeadPortal({ nome: "João", telefone: "51 98888-7777", imovel: "CASA-2", funil: "venda" }, "olx")).toMatchObject({ nome: "João", telefone: "51 98888-7777", funil: "venda", id_externo: null });
    expect(lerLeadPortal({ name: "Sem contato" }, "zap")).toEqual({ erro: "Lead sem telefone e sem e-mail." });
    expect(lerLeadPortal([], "zap")).toEqual({ erro: "Envie um objeto JSON." });
    expect(lerLeadPortal({ email: "x@y.com" }, "zap")).toEqual({ erro: "Lead sem nome." });
  });
});
