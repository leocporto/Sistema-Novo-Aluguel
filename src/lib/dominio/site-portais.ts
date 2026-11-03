/**
 * Regras puras da integração com portais (ZAP Imóveis, Viva Real, OLX):
 * campos obrigatórios de cada portal ("falhas de sincronização"), limite de
 * anúncios/destaques do plano, geração do XML (VRSync para ZAP/Viva Real e
 * XML de carga para a OLX) e leitura do lead que o portal manda por webhook.
 * Preço, fotos e disponibilidade vêm sempre do cadastro: o feed é gerado na hora.
 */
import { paraCentavos } from "./dinheiro";
import { normalizar } from "./imoveis";
import { areaPrincipal, embedVideo, tituloImovel } from "./site";

export type Portal = "zap" | "vivareal" | "olx";
export type Destaque = "normal" | "destaque" | "super_destaque";

export const PORTAIS: Record<Portal, { nome: string; formato: "vrsync" | "olx"; maxFotos: number; maxTitulo: number; painel: string }> = {
  zap: { nome: "ZAP Imóveis", formato: "vrsync", maxFotos: 50, maxTitulo: 100, painel: "Canal Pro (Grupo OLX) → Integração → Feed XML (VRSync)" },
  vivareal: { nome: "Viva Real", formato: "vrsync", maxFotos: 50, maxTitulo: 100, painel: "Canal Pro (Grupo OLX) → Integração → Feed XML (VRSync)" },
  olx: { nome: "OLX", formato: "olx", maxFotos: 20, maxTitulo: 70, painel: "OLX Pro → Integração de imóveis → URL do arquivo de carga (XML)" },
};
export const LISTA_PORTAIS = Object.keys(PORTAIS) as Portal[];
/**
 * Nome do portal na aba Histórico do imóvel (imovel_anuncios.portal), igual à
 * lista de portais do "Registrar anúncio". O feed abre/encerra esses anúncios
 * (função portal_registrar no banco usa os mesmos nomes).
 */
export const NOME_ANUNCIO: Record<Portal, string> = { zap: "ZAP Imóveis", vivareal: "VivaReal", olx: "OLX" };
export const ehPortal = (p: string): p is Portal => p in PORTAIS;

export const ROTULO_DESTAQUE: Record<Destaque, string> = { normal: "Normal", destaque: "Destaque", super_destaque: "Super destaque" };
const PESO_DESTAQUE: Record<Destaque, number> = { super_destaque: 2, destaque: 1, normal: 0 };

type Num = number | string | null | undefined;
const num = (v: Num): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export type ImovelPortal = {
  id: string;
  codigo: string;
  titulo: string | null;
  tipo: string;
  finalidades: string[];
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  cep: string | null;
  latitude: Num;
  longitude: Num;
  area_util: Num;
  area_total: Num;
  area_construida: Num;
  area_privativa: Num;
  quartos: number | null;
  suites: number | null;
  banheiros: number | null;
  vagas: number | null;
  valor_venda: Num;
  valor_aluguel: Num;
  valor_condominio: Num;
  valor_iptu: Num;
  comodidades: string[];
  caracteristicas: string[];
  descricao: string | null;
  video_url: string | null;
  destaque: Destaque;
  codigo_portal: string | null;
  /** Endereços das fotos e plantas (link fixo /s/<slug>/foto/<id>). */
  fotos: string[];
  plantas: string[];
  /** Página do imóvel no site (se o site estiver no ar). */
  url?: string | null;
  criado_em: string;
  atualizado_em?: string | null;
};

// Tipos do cadastro → tipos de cada formato -------------------------------------
const VRSYNC_TIPO: Record<string, string> = {
  apartamento: "Residential / Apartment",
  casa: "Residential / Home",
  "casa de condominio": "Residential / Condo",
  cobertura: "Residential / Penthouse",
  "kitnet studio": "Residential / Kitnet",
  "sala comercial": "Commercial / Office",
  loja: "Commercial / Business",
  galpao: "Commercial / Industrial",
  terreno: "Residential / Land Lot",
  "sitio chacara": "Residential / Farm Ranch",
};
const OLX_TIPO: Record<string, [string, string]> = {
  apartamento: ["Apartamento", "Apartamento Padrão"],
  cobertura: ["Apartamento", "Cobertura"],
  "kitnet studio": ["Apartamento", "Kitchenette/Conjugados"],
  casa: ["Casa", "Casa Padrão"],
  "casa de condominio": ["Casa", "Casa de Condomínio"],
  "sala comercial": ["Comercial/Industrial", "Conjunto Comercial/sala"],
  loja: ["Comercial/Industrial", "Loja/Salão"],
  galpao: ["Comercial/Industrial", "Galpão/Depósito/Armazém"],
  terreno: ["Terreno", "Terreno Padrão"],
  "sitio chacara": ["Rural", "Chácara"],
};
/** Comodidades do cadastro que têm nome próprio no VRSync. */
const VRSYNC_COMODIDADE: Record<string, string> = {
  piscina: "Pool",
  "piscina privativa": "Private Pool",
  academia: "Gym",
  elevador: "Elevator",
  churrasqueira: "BBQ",
  "salao de festas": "Party Room",
  playground: "Playground",
  mobiliado: "Furnished",
  "ar condicionado": "Air Conditioning",
  varanda: "Balcony",
  "varanda gourmet": "Gourmet Balcony",
  jardim: "Garden",
  lareira: "Fireplace",
  sauna: "Sauna",
  quadra: "Sports Court",
  "portaria 24h": "Security 24 Hours",
  "aceita pets": "Pets Allowed",
  "armarios embutidos": "Builtin Wardrobe",
  "cozinha planejada": "Kitchen Cabinets",
  "area de servico": "Service Area",
  "espaco gourmet": "Gourmet Area",
  bicicletario: "Bicycles Place",
  coworking: "Coworking",
  "energia solar": "Solar Energy",
  "vista para o mar": "Ocean View",
  quintal: "Backyard",
};

const chaveTipo = (t: string) => normalizar(t);
const ehTerreno = (t: string) => chaveTipo(t) === "terreno";
const ehComercial = (t: string) => ["sala comercial", "loja", "galpao"].includes(chaveTipo(t));

function precos(i: Pick<ImovelPortal, "finalidades" | "valor_venda" | "valor_aluguel">) {
  const venda = num(i.valor_venda);
  const aluguel = num(i.valor_aluguel);
  const fins = i.finalidades ?? [];
  return {
    venda: venda && venda > 0 && (fins.includes("venda") || !fins.includes("locacao")) ? venda : null,
    aluguel: aluguel && aluguel > 0 && (fins.includes("locacao") || !fins.includes("venda")) ? aluguel : null,
  };
}

const soDigitos = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");

/**
 * Confere o que cada portal exige. `problemas` impedem o envio (o imóvel fica
 * de fora e aparece em "Falhas de sincronização"); `avisos` não impedem.
 */
export function validarParaPortal(i: ImovelPortal, portal: Portal): { problemas: string[]; avisos: string[] } {
  const problemas: string[] = [];
  const avisos: string[] = [];
  const cfg = PORTAIS[portal];
  const tipoOk = cfg.formato === "vrsync" ? VRSYNC_TIPO[chaveTipo(i.tipo)] : OLX_TIPO[chaveTipo(i.tipo)];
  if (!tipoOk) problemas.push(`O tipo "${i.tipo || "—"}" não existe no ${cfg.nome}. Escolha outro tipo no cadastro.`);
  const { venda, aluguel } = precos(i);
  if (!venda && !aluguel) problemas.push("Informe o valor do aluguel ou da venda.");
  if (!i.fotos.length) problemas.push("Envie pelo menos 1 foto.");
  else if (i.fotos.length < 5) avisos.push("Anúncios com 5 fotos ou mais aparecem melhor.");
  if (i.fotos.length > cfg.maxFotos) avisos.push(`O ${cfg.nome} aceita até ${cfg.maxFotos} fotos; vão as primeiras.`);
  if ((i.descricao ?? "").replace(/\s+/g, " ").trim().length < 50) problemas.push("Escreva uma descrição com pelo menos 50 letras.");
  if (!i.cidade?.trim() || !i.bairro?.trim()) problemas.push("Preencha a cidade e o bairro.");
  if (!/^[A-Za-z]{2}$/.test(i.uf ?? "")) problemas.push("Preencha a UF (ex.: SP).");
  if (soDigitos(i.cep).length !== 8) problemas.push("Preencha o CEP (8 números).");
  if (ehTerreno(i.tipo) ? !num(i.area_total) : !areaPrincipal(i)) problemas.push("Informe a área em m².");
  if (!ehTerreno(i.tipo) && !ehComercial(i.tipo) && i.quartos == null) problemas.push("Informe o número de quartos.");
  if (!i.logradouro?.trim() || !i.numero?.trim()) avisos.push("Sem rua e número o portal localiza o imóvel só pelo bairro.");
  const titulo = tituloImovel(i);
  if (titulo.length > cfg.maxTitulo) avisos.push(`O título passa de ${cfg.maxTitulo} letras e será cortado.`);
  return { problemas, avisos };
}

export type ResultadoFeed = {
  enviar: ImovelPortal[];
  falhas: { imovel_id: string; codigo: string; problemas: string[] }[];
  foraDoLimite: ImovelPortal[];
  avisos: { codigo: string; aviso: string }[];
};

/**
 * Separa o que vai no feed: tira quem tem problema, respeita o limite de
 * anúncios do plano (destaques e os mais recentes primeiro) e o limite de
 * destaques (os que passam viram anúncio normal).
 */
export function selecionarParaFeed(lista: ImovelPortal[], portal: Portal, limites: { anuncios?: number | null; destaques?: number | null } = {}): ResultadoFeed {
  const falhas: ResultadoFeed["falhas"] = [];
  const avisos: ResultadoFeed["avisos"] = [];
  const validos: ImovelPortal[] = [];
  for (const i of lista) {
    const v = validarParaPortal(i, portal);
    if (v.problemas.length) falhas.push({ imovel_id: i.id, codigo: i.codigo, problemas: v.problemas });
    else validos.push(i);
    for (const a of v.avisos) avisos.push({ codigo: i.codigo, aviso: a });
  }
  validos.sort((a, b) => PESO_DESTAQUE[b.destaque] - PESO_DESTAQUE[a.destaque] || b.criado_em.localeCompare(a.criado_em));
  const max = limites.anuncios ?? null;
  const enviar = max === null ? validos : validos.slice(0, max);
  const foraDoLimite = max === null ? [] : validos.slice(max);
  let destaquesUsados = 0;
  const maxDest = limites.destaques ?? null;
  const ajustados = enviar.map((i) => {
    if (i.destaque === "normal") return i;
    if (maxDest !== null && destaquesUsados >= maxDest) {
      avisos.push({ codigo: i.codigo, aviso: `Passou do limite de ${maxDest} destaque(s) do plano: foi como anúncio normal.` });
      return { ...i, destaque: "normal" as Destaque };
    }
    destaquesUsados++;
    return i;
  });
  for (const i of foraDoLimite) avisos.push({ codigo: i.codigo, aviso: `Ficou fora: o plano permite ${max} anúncio(s).` });
  return { enviar: ajustados, falhas, foraDoLimite, avisos };
}

// XML ---------------------------------------------------------------------------
const INVALIDOS_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;
export function escXml(s: string | number | null | undefined): string {
  return String(s ?? "")
    .replace(INVALIDOS_XML, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
export function cdata(s: string | null | undefined): string {
  return `<![CDATA[${String(s ?? "").replace(INVALIDOS_XML, "").replace(/]]>/g, "]]]]><![CDATA[>")}]]>`;
}
const tag = (nome: string, valor: string | number | null | undefined, attrs = "") =>
  valor === null || valor === undefined || valor === "" ? "" : `<${nome}${attrs}>${escXml(valor)}</${nome}>`;
const inteiro = (v: Num) => {
  const n = num(v);
  return n === null ? null : Math.round(n);
};
/**
 * IPTU anual a partir do cadastro: no imóvel o IPTU é guardado por MÊS
 * ("IPTU (R$/mês)"), mas os portais pedem o valor do ano (VRSync YearlyTax e
 * ValorIPTU da OLX). Conta em centavos para não perder arredondamento.
 */
export function iptuAnual(mensal: Num): number | null {
  const centavos = paraCentavos(num(mensal));
  return centavos > 0 ? Math.round((centavos * 12) / 100) : null;
}
const cepFormatado = (c: string | null) => {
  const d = soDigitos(c);
  return d.length === 8 ? `${d.slice(0, 5)}-${d.slice(5)}` : null;
};

export type CabecalhoFeed = { nome: string; email?: string | null; telefone?: string | null; mostrarEndereco: boolean; codigoAnunciante?: string | null; geradoEm: string };

/** Feed VRSync (ZAP Imóveis e Viva Real). */
export function gerarVrsync(lista: ImovelPortal[], cab: CabecalhoFeed): string {
  const listings = lista.map((i) => {
    const { venda, aluguel } = precos(i);
    const transacao = venda && aluguel ? "Sale/Rent" : venda ? "For Sale" : "For Rent";
    const tipo = VRSYNC_TIPO[chaveTipo(i.tipo)] ?? "Residential / Home";
    const area = areaPrincipal(i);
    const video = embedVideo(i.video_url) && /youtu/.test(i.video_url ?? "") ? i.video_url : null;
    const feats = [...new Set((i.comodidades ?? []).map((c) => VRSYNC_COMODIDADE[normalizar(c)]).filter(Boolean))];
    const pub = i.destaque === "super_destaque" ? "SUPER_PREMIUM" : i.destaque === "destaque" ? "PREMIUM" : "STANDARD";
    const midias = [
      ...i.fotos.slice(0, PORTAIS.zap.maxFotos).map((u, k) => `<Item medium="image"${k === 0 ? ' primary="true"' : ""}>${escXml(u)}</Item>`),
      ...i.plantas.slice(0, 10).map((u) => `<Item medium="image" caption="Planta">${escXml(u)}</Item>`),
      video ? `<Item medium="video">${escXml(video)}</Item>` : "",
    ].join("");
    return [
      "<Listing>",
      tag("ListingID", i.codigo),
      `<Title>${cdata(tituloImovel(i).slice(0, PORTAIS.zap.maxTitulo))}</Title>`,
      tag("TransactionType", transacao),
      tag("Featured", i.destaque === "normal" ? "false" : "true"),
      tag("PublicationType", pub),
      tag("DetailViewUrl", i.url),
      `<Media>${midias}</Media>`,
      "<Details>",
      tag("UsageType", ehComercial(i.tipo) ? "Commercial" : "Residential"),
      tag("PropertyType", tipo),
      `<Description>${cdata(i.descricao)}</Description>`,
      venda ? tag("ListPrice", Math.round(venda), ' currency="BRL"') : "",
      aluguel ? tag("RentalPrice", Math.round(aluguel), ' currency="BRL" period="Monthly"') : "",
      tag("PropertyAdministrationFee", inteiro(i.valor_condominio) || null, ' currency="BRL"'),
      tag("YearlyTax", iptuAnual(i.valor_iptu), ' currency="BRL"'),
      !ehTerreno(i.tipo) && area ? tag("LivingArea", Math.round(area), ' unit="square metres"') : "",
      tag("LotArea", inteiro(i.area_total) || null, ' unit="square metres"'),
      tag("Bedrooms", i.quartos),
      tag("Bathrooms", i.banheiros),
      tag("Suites", i.suites),
      tag("Garage", i.vagas, ' type="Parking Space"'),
      feats.length ? `<Features>${feats.map((f) => tag("Feature", f)).join("")}</Features>` : "",
      "</Details>",
      `<Location displayAddress="${cab.mostrarEndereco ? "All" : "Neighborhood"}">`,
      '<Country abbreviation="BR">Brasil</Country>',
      tag("State", (i.uf ?? "").toUpperCase(), ` abbreviation="${escXml((i.uf ?? "").toUpperCase())}"`),
      tag("City", i.cidade),
      tag("Neighborhood", i.bairro),
      tag("Address", i.logradouro),
      tag("StreetNumber", i.numero),
      tag("Complement", i.complemento),
      tag("PostalCode", cepFormatado(i.cep)),
      tag("Latitude", num(i.latitude)),
      tag("Longitude", num(i.longitude)),
      "</Location>",
      "<ContactInfo>",
      tag("Name", cab.nome),
      tag("Email", cab.email),
      tag("Telephone", soDigitos(cab.telefone) || null),
      "</ContactInfo>",
      "</Listing>",
    ]
      .filter(Boolean)
      .join("");
  });
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<ListingDataFeed xmlns="http://www.vivareal.com/schemas/1.0/VRSync" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.vivareal.com/schemas/1.0/VRSync http://xml.vivareal.com/vrsync.xsd">',
    `<Header>${tag("Provider", cab.nome)}${tag("Email", cab.email)}${tag("ContactName", cab.nome)}${tag("PublishDate", cab.geradoEm.slice(0, 19))}${tag("Telephone", soDigitos(cab.telefone) || null)}</Header>`,
    `<Listings>${listings.join("\n")}</Listings>`,
    "</ListingDataFeed>",
    "",
  ].join("\n");
}

/** XML de carga da OLX (padrão Carga/Imóveis). */
export function gerarOlx(lista: ImovelPortal[], cab: CabecalhoFeed): string {
  const imoveis = lista.map((i) => {
    const { venda, aluguel } = precos(i);
    const [tipo, subtipo] = OLX_TIPO[chaveTipo(i.tipo)] ?? ["Casa", "Casa Padrão"];
    const area = areaPrincipal(i);
    const fotos = i.fotos
      .slice(0, PORTAIS.olx.maxFotos)
      .map((u, k) => `<Foto><NomeArquivo>foto-${k + 1}.jpg</NomeArquivo><URLArquivo>${escXml(u)}</URLArquivo><Principal>${k === 0 ? 1 : 0}</Principal></Foto>`)
      .join("");
    const video = embedVideo(i.video_url) ? i.video_url : null;
    return [
      "<Imovel>",
      tag("CodigoImovel", i.codigo),
      i.codigo_portal ? tag("CodigoOLX", i.codigo_portal) : "",
      `<TituloImovel>${cdata(tituloImovel(i).slice(0, PORTAIS.olx.maxTitulo))}</TituloImovel>`,
      tag("TipoImovel", tipo),
      tag("SubTipoImovel", subtipo),
      tag("CategoriaImovel", "Padrão"),
      tag("Destaque", i.destaque === "normal" ? 0 : 1),
      tag("UF", (i.uf ?? "").toUpperCase()),
      tag("Cidade", i.cidade),
      tag("Bairro", i.bairro),
      tag("Endereco", i.logradouro),
      tag("Numero", i.numero),
      tag("Complemento", i.complemento),
      tag("CEP", soDigitos(i.cep)),
      tag("MostrarEndereco", cab.mostrarEndereco ? 1 : 0),
      tag("Latitude", num(i.latitude)),
      tag("Longitude", num(i.longitude)),
      venda ? tag("PrecoVenda", Math.round(venda)) : "",
      aluguel ? tag("PrecoLocacao", Math.round(aluguel)) : "",
      tag("PrecoCondominio", inteiro(i.valor_condominio) || null),
      tag("ValorIPTU", iptuAnual(i.valor_iptu)),
      area && !ehTerreno(i.tipo) ? tag("AreaUtil", Math.round(area)) : "",
      tag("AreaTotal", inteiro(i.area_total) || null),
      tag("QtdDormitorios", i.quartos),
      tag("QtdSuites", i.suites),
      tag("QtdBanheiros", i.banheiros),
      tag("QtdVagas", i.vagas),
      `<Observacao>${cdata(i.descricao)}</Observacao>`,
      i.comodidades?.length ? `<Caracteristicas>${cdata(i.comodidades.join(", "))}</Caracteristicas>` : "",
      `<Fotos>${fotos}</Fotos>`,
      video ? `<Videos><Video><URLArquivo>${escXml(video)}</URLArquivo></Video></Videos>` : "",
      tag("URLImovel", i.url),
      "</Imovel>",
    ]
      .filter(Boolean)
      .join("");
  });
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Carga xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">',
    `<Anunciante>${tag("Nome", cab.nome)}${tag("Codigo", cab.codigoAnunciante)}${tag("Email", cab.email)}${tag("Telefone", soDigitos(cab.telefone) || null)}${tag("DataGeracao", cab.geradoEm.slice(0, 19))}</Anunciante>`,
    `<Imoveis>${imoveis.join("\n")}</Imoveis>`,
    "</Carga>",
    "",
  ].join("\n");
}

export function gerarFeed(portal: Portal, lista: ImovelPortal[], cab: CabecalhoFeed): string {
  return PORTAIS[portal].formato === "olx" ? gerarOlx(lista, cab) : gerarVrsync(lista, cab);
}

// Leads dos portais ---------------------------------------------------------------

export type LeadPortal = { nome: string; telefone: string; email: string; mensagem: string; imovel: string | null; funil: "locacao" | "venda" | null };

/**
 * Lê o lead que o portal envia (JSON). Aceita o formato do Grupo OLX (leadOrigin,
 * name, email, ddd + phone ou phoneNumber, message, clientListingId,
 * transactionType SELL/RENT) e nomes em português (nome, telefone, mensagem, imovel).
 */
export function lerLeadPortal(corpo: unknown, portal: Portal): LeadPortal | { erro: string } {
  if (!corpo || typeof corpo !== "object" || Array.isArray(corpo)) return { erro: "Envie um objeto JSON." };
  const o = corpo as Record<string, unknown>;
  const s = (...chaves: string[]) => {
    for (const k of chaves) {
      const v = o[k];
      if (typeof v === "string" && v.trim()) return v.trim();
      if (typeof v === "number") return String(v);
    }
    return "";
  };
  const nome = s("name", "nome", "leadName", "contactName").slice(0, 120);
  const email = s("email", "leadEmail", "e-mail").slice(0, 160);
  const ddd = soDigitos(s("ddd"));
  const fone = s("phoneNumber", "phone", "telefone", "celular", "cellphone", "mobile");
  const telefone = (ddd && soDigitos(fone).length <= 9 ? `${ddd}${soDigitos(fone)}` : fone).slice(0, 40);
  const imovel = s("clientListingId", "externalId", "listingCode", "codigo", "imovel", "reference").slice(0, 40) || null;
  const tt = normalizar(s("transactionType", "transacao", "funil", "businessType"));
  const funil = /sell|sale|venda|compra/.test(tt) ? "venda" : /rent|loca|alug/.test(tt) ? "locacao" : null;
  const idLead = s("originLeadId", "leadId", "id");
  const mensagem = [s("message", "mensagem", "comment", "comments"), idLead ? `(lead ${PORTAIS[portal].nome} nº ${idLead.slice(0, 60)})` : ""]
    .filter(Boolean)
    .join(" ")
    .slice(0, 2000);
  if (!nome) return { erro: "Lead sem nome." };
  if (!telefone && !email) return { erro: "Lead sem telefone e sem e-mail." };
  return { nome, telefone, email, mensagem, imovel, funil };
}
