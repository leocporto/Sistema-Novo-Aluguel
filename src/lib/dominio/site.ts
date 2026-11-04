/**
 * Regras puras do site imobiliário: endereço (slug), marca e cores, domínio
 * próprio, catálogo (filtros, ordenação, páginas, parecidos), mapa (projeção
 * dos pontos), vídeo/tour, favoritos e comparação, SEO (JSON-LD e sitemap) e
 * o horário da visita pedida pelo site.
 */
import { formatarReais, paraCentavos } from "./dinheiro";
import { normalizar } from "./imoveis";

type Num = number | string | null | undefined;
const num = (v: Num): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// ---------------------------------------------------------------------------
// Endereço do site (slug), cores e domínio
// ---------------------------------------------------------------------------

/** Endereço do site: 3 a 50 letras minúsculas, números e hífen (sem hífen nas pontas). */
export const RE_SLUG = /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/;
const RESERVADOS = new Set(["api", "admin", "login", "site", "www", "app", "novo", "novoaluguel"]);

export function slugValido(s: string): boolean {
  return RE_SLUG.test(s) && !RESERVADOS.has(s) && !s.includes("--");
}

/** Sugere o endereço a partir do nome da imobiliária ("Imobiliária São João" → "imobiliaria-sao-joao"). */
export function sugerirSlug(nome: string): string {
  let s = normalizar(nome).replace(/\s+/g, "-").replace(/-+/g, "-").slice(0, 50).replace(/^-|-$/g, "");
  if (s.length < 3) s = `${s || "imob"}-site`;
  if (RESERVADOS.has(s)) s = `${s}-imoveis`;
  return s;
}

export const RE_COR = /^#[0-9a-f]{6}$/i;

function hexParaRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function rgbParaHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, "0")).join("")}`;
}

/** Luminância relativa (WCAG). */
export function luminancia(hex: string): number {
  const [r, g, b] = hexParaRgb(hex).map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Contraste entre a cor e o branco (1 a 21). */
export function contrasteComBranco(hex: string): number {
  return 1.05 / (luminancia(hex) + 0.05);
}

/** Escurece a cor (fator 0–1) misturando com preto. */
export function escurecer(hex: string, fator: number): string {
  return rgbParaHex(hexParaRgb(hex).map((c) => c * (1 - fator)) as [number, number, number]);
}

/**
 * Cor de destaque legível com texto branco (contraste mínimo 3:1, padrão de
 * botões e títulos grandes): cores muito claras são escurecidas até passar.
 */
export function corLegivel(hex: string): string {
  if (!RE_COR.test(hex)) return "#2563eb";
  let c = hex.toLowerCase();
  for (let i = 0; i < 20 && contrasteComBranco(c) < 3; i++) c = escurecer(c, 0.08);
  return c;
}

const rgba = (hex: string, a: number) => {
  const [r, g, b] = hexParaRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
};

/** Variáveis de cor do site (tema claro sempre) com a cor da marca. */
export function paletaMarca(primaria: string, secundaria: string): Record<string, string> {
  const p = corLegivel(primaria);
  const s = RE_COR.test(secundaria) ? secundaria.toLowerCase() : "#0f172a";
  return {
    "--accent": p,
    "--accent-hot": escurecer(p, 0.12),
    "--accent-bg": rgba(p, 0.08),
    "--accent-bd": rgba(p, 0.24),
    "--accent-glow": rgba(p, 0.24),
    "--site-escuro": s,
    "--site-sobre-escuro": contrasteComBranco(s) >= 4.5 ? "#ffffff" : "#111827",
  };
}

export const RE_GA4 = /^G-[A-Z0-9]{4,15}$/;
export function ga4Valido(id: string | null | undefined): boolean {
  return !!id && RE_GA4.test(id);
}

/**
 * Domínio próprio digitado pela imobiliária → forma guardada (sem https://, sem
 * caminho e sem "www."). Devolve null se não parecer um domínio.
 */
export function normalizarDominio(entrada: string | null | undefined): string | null {
  if (!entrada) return null;
  let d = entrada.trim().toLowerCase();
  d = d.replace(/^[a-z]+:\/\//, "").split(/[/?#]/)[0].replace(/:\d+$/, "").replace(/\.$/, "");
  d = d.replace(/^www\./, "");
  return /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/.test(d) ? d : null;
}

/** Endereços da hospedagem (Vercel) para apontar o domínio. */
export const DNS_ALVO = { cname: "cname.vercel-dns.com", a: "76.76.21.21" } as const;

/**
 * Prova de posse do domínio: registro TXT em "_novoaluguel.<domínio>" com o
 * código do site. Só quem manda no DNS do domínio consegue criar esse registro,
 * então só o dono abre o site nele (o proxy confere de novo antes de abrir).
 */
export const NOME_TXT = "_novoaluguel";
export const codigoTxt = (siteId: string) => `novoaluguel-site=${siteId}`;

/** O TXT consultado (lista de registros, cada um em pedaços) tem o código deste site? */
export function txtConfere(registros: string[][] | null | undefined, siteId: string): boolean {
  const esperado = codigoTxt(siteId).toLowerCase();
  return (registros ?? []).some((partes) => partes.join("").trim().replace(/^"|"$/g, "").toLowerCase() === esperado);
}

/** Registros que a imobiliária cria no DNS do domínio (na empresa onde comprou o domínio). */
export function instrucoesDns(dominio: string, siteId: string): { tipo: "A" | "CNAME" | "TXT"; nome: string; valor: string; para: string }[] {
  return [
    { tipo: "TXT", nome: NOME_TXT, valor: codigoTxt(siteId), para: `${NOME_TXT}.${dominio}` },
    { tipo: "A", nome: "@", valor: DNS_ALVO.a, para: dominio },
    { tipo: "CNAME", nome: "www", valor: DNS_ALVO.cname, para: `www.${dominio}` },
  ];
}

/**
 * Domínio próprio pedido nesta requisição (para o proxy). Devolve null para os
 * endereços do próprio sistema: localhost, IP, *.vercel.app e os hosts extras
 * informados (ex.: o domínio do sistema).
 */
export function dominioDoHost(host: string | null | undefined, hostsDoSistema: string[] = []): string | null {
  const h = (host ?? "").trim().toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
  if (!h || h === "localhost" || h.endsWith(".localhost") || h.endsWith(".vercel.app") || h.endsWith(".local")) return null;
  if (/^[\d.]+$/.test(h) || h.includes(":") || h.startsWith("[")) return null;
  const extras = hostsDoSistema.map((x) => x.trim().toLowerCase()).filter(Boolean);
  if (extras.some((x) => h === x || h === `www.${x}`)) return null;
  return normalizarDominio(h);
}

/**
 * Caminho interno do site para um endereço aberto pelo domínio próprio:
 * "/" → "/s/<slug>", "/imovel/AP-1" → "/s/<slug>/imovel/AP-1". Devolve null para
 * o que não é página do site (arquivos do Next, APIs e links que já vêm com /s/).
 */
export function caminhoNoSite(pathname: string, slug: string): string | null {
  if (!RE_SLUG.test(slug)) return null;
  const p = pathname || "/";
  if (p === "/s" || p.startsWith("/s/") || p.startsWith("/_next/") || p === "/api" || p.startsWith("/api/")) return null;
  return p === "/" ? `/s/${slug}` : `/s/${slug}${p}`;
}

/** O DNS consultado aponta para a hospedagem? */
export function dnsApontaCerto(r: { a?: string[]; cname?: string[] }): boolean {
  const cn = (r.cname ?? []).map((c) => c.toLowerCase().replace(/\.$/, ""));
  return (r.a ?? []).includes(DNS_ALVO.a) || cn.some((c) => c === DNS_ALVO.cname || c.endsWith(".vercel-dns.com"));
}

// ---------------------------------------------------------------------------
// Catálogo
// ---------------------------------------------------------------------------

export type MidiaSite = { id: string; path: string; tipo?: string; nome?: string | null };

export type ImovelSite = {
  id: string;
  codigo: string;
  titulo: string | null;
  tipo: string;
  finalidades: string[];
  status: string;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  logradouro?: string | null;
  numero?: string | null;
  cep?: string | null;
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
  descricao?: string | null;
  empreendimento_id: string | null;
  empreendimento: string | null;
  capa?: MidiaSite | null;
  fotos?: number;
  criado_em: string;
  // Só na página do imóvel
  video_url?: string | null;
  tour_url?: string | null;
  horario_visitas?: string | null;
  midias?: MidiaSite[];
};

/** Dados públicos do site (função site_info). */
export type InfoSite = {
  slug: string;
  nome: string;
  slogan: string | null;
  logo_path: string | null;
  cor_primaria: string;
  cor_secundaria: string;
  titulo_home: string | null;
  subtitulo_home: string | null;
  sobre: string | null;
  telefone: string | null;
  whatsapp: string | null;
  email: string | null;
  endereco: string | null;
  creci: string | null;
  instagram: string | null;
  facebook: string | null;
  youtube: string | null;
  ga4_id: string | null;
  dominio: string | null;
  seo_titulo: string | null;
  seo_descricao: string | null;
  mostrar_endereco: boolean;
  captacao_ativa: boolean;
  agendamento_ativo: boolean;
  tem_empreendimentos: boolean;
  atualizado_em: string;
};

/** Empreendimento/lançamento publicado (função site_empreendimentos). */
export type EmpreendimentoSite = {
  id: string;
  nome: string;
  construtora: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  logradouro: string | null;
  numero: string | null;
  fase: "lancamento" | "em_obras" | "pronto" | null;
  previsao_entrega: string | null;
  descricao: string | null;
  video_url: string | null;
  tour_url: string | null;
  unidades: number;
  venda_desde: number | null;
  aluguel_desde: number | null;
  capa: MidiaSite | null;
};

export const ROTULO_FASE: Record<string, string> = { lancamento: "Lançamento", em_obras: "Em obras", pronto: "Pronto para morar" };

export type Finalidade = "venda" | "locacao";
export type OrdemSite = "recentes" | "menor_preco" | "maior_preco" | "maior_area";
export const ROTULO_ORDEM: Record<OrdemSite, string> = {
  recentes: "Mais recentes",
  menor_preco: "Menor preço",
  maior_preco: "Maior preço",
  maior_area: "Maior área",
};

export type FiltrosSite = {
  finalidade?: Finalidade;
  tipo?: string;
  cidade?: string;
  bairro?: string;
  precoMin?: number;
  precoMax?: number;
  quartos?: number;
  suites?: number;
  vagas?: number;
  banheiros?: number;
  areaMin?: number;
  areaMax?: number;
  comodidades: string[];
  busca?: string;
  empreendimento?: string;
  ordem: OrdemSite;
  pagina: number;
};

type Params = Record<string, string | string[] | undefined>;
const um = (sp: Params, k: string) => {
  const v = sp[k];
  return (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
};
const positivo = (s: string | undefined) => {
  if (!s) return undefined;
  const limpo = s.replace(/[R$\s]/g, "");
  const n = Number(limpo.includes(",") ? limpo.replace(/\./g, "").replace(",", ".") : limpo.replace(/\.(?=\d{3}(\D|$))/g, ""));
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

/** Lê os filtros da URL do catálogo (?finalidade=locacao&cidade=…). */
export function lerFiltros(sp: Params): FiltrosSite {
  const fin = um(sp, "finalidade");
  const ordem = um(sp, "ordem");
  const com = sp.comodidade;
  return {
    finalidade: fin === "venda" || fin === "locacao" ? fin : undefined,
    tipo: um(sp, "tipo"),
    cidade: um(sp, "cidade"),
    bairro: um(sp, "bairro"),
    precoMin: positivo(um(sp, "preco_min")),
    precoMax: positivo(um(sp, "preco_max")),
    quartos: positivo(um(sp, "quartos")),
    suites: positivo(um(sp, "suites")),
    vagas: positivo(um(sp, "vagas")),
    banheiros: positivo(um(sp, "banheiros")),
    areaMin: positivo(um(sp, "area_min")),
    areaMax: positivo(um(sp, "area_max")),
    comodidades: (Array.isArray(com) ? com : com ? [com] : []).map((c) => c.trim()).filter(Boolean).slice(0, 20),
    busca: um(sp, "busca")?.slice(0, 80),
    empreendimento: um(sp, "empreendimento"),
    ordem: ordem && ordem in ROTULO_ORDEM ? (ordem as OrdemSite) : "recentes",
    pagina: Math.max(1, Math.min(500, Math.trunc(positivo(um(sp, "pagina")) ?? 1))),
  };
}

/** Filtros → query string (sem os vazios). `mudar` sobrepõe valores (ex.: página). */
export function queryFiltros(f: FiltrosSite, mudar: Partial<Record<string, string | number | undefined>> = {}): string {
  const p = new URLSearchParams();
  const base: Record<string, string | number | undefined> = {
    finalidade: f.finalidade,
    tipo: f.tipo,
    cidade: f.cidade,
    bairro: f.bairro,
    preco_min: f.precoMin,
    preco_max: f.precoMax,
    quartos: f.quartos,
    suites: f.suites,
    vagas: f.vagas,
    banheiros: f.banheiros,
    area_min: f.areaMin,
    area_max: f.areaMax,
    busca: f.busca,
    empreendimento: f.empreendimento,
    ordem: f.ordem === "recentes" ? undefined : f.ordem,
    pagina: f.pagina > 1 ? f.pagina : undefined,
    ...mudar,
  };
  for (const [k, v] of Object.entries(base)) if (v !== undefined && v !== "") p.set(k, String(v));
  for (const c of f.comodidades) p.append("comodidade", c);
  const s = p.toString();
  return s ? `?${s}` : "";
}

/** Área que aparece no anúncio (privativa > útil > construída > total). */
export function areaPrincipal(i: Pick<ImovelSite, "area_privativa" | "area_util" | "area_construida" | "area_total">): number | null {
  return num(i.area_privativa) ?? num(i.area_util) ?? num(i.area_construida) ?? num(i.area_total);
}

const temFinalidade = (i: Pick<ImovelSite, "finalidades">, f: Finalidade) => (i.finalidades ?? []).includes(f);

/** Preço do imóvel na finalidade (ou o primeiro que existir: aluguel, depois venda). */
export function precoDe(i: Pick<ImovelSite, "finalidades" | "valor_venda" | "valor_aluguel">, finalidade?: Finalidade): number | null {
  const venda = num(i.valor_venda);
  const aluguel = num(i.valor_aluguel);
  if (finalidade === "venda") return venda && venda > 0 ? venda : null;
  if (finalidade === "locacao") return aluguel && aluguel > 0 ? aluguel : null;
  if (temFinalidade(i, "locacao") && aluguel && aluguel > 0) return aluguel;
  if (venda && venda > 0) return venda;
  return aluguel && aluguel > 0 ? aluguel : null;
}

/** O imóvel aparece na finalidade? (pela finalidade cadastrada ou pelo preço preenchido). */
export function atendeFinalidade(i: Pick<ImovelSite, "finalidades" | "valor_venda" | "valor_aluguel">, f: Finalidade): boolean {
  return temFinalidade(i, f) || (f === "venda" ? (num(i.valor_venda) ?? 0) > 0 : (num(i.valor_aluguel) ?? 0) > 0);
}

const igual = (a: string | null | undefined, b: string | undefined) => !b || normalizar(a) === normalizar(b);

export function filtrarImoveis(lista: ImovelSite[], f: FiltrosSite): ImovelSite[] {
  const termos = normalizar(f.busca).split(" ").filter(Boolean);
  const comodidades = f.comodidades.map(normalizar);
  return lista.filter((i) => {
    if (f.finalidade && !atendeFinalidade(i, f.finalidade)) return false;
    if (f.tipo && normalizar(i.tipo) !== normalizar(f.tipo)) return false;
    if (!igual(i.cidade, f.cidade) || !igual(i.bairro, f.bairro)) return false;
    if (f.empreendimento && i.empreendimento_id !== f.empreendimento) return false;
    if (f.precoMin || f.precoMax) {
      const precos = f.finalidade ? [precoDe(i, f.finalidade)] : [precoDe(i, "locacao"), precoDe(i, "venda")];
      const ok = precos.some((p) => p !== null && (!f.precoMin || p >= f.precoMin) && (!f.precoMax || p <= f.precoMax));
      if (!ok) return false;
    }
    if (f.quartos && (i.quartos ?? 0) < f.quartos) return false;
    if (f.suites && (i.suites ?? 0) < f.suites) return false;
    if (f.vagas && (i.vagas ?? 0) < f.vagas) return false;
    if (f.banheiros && (i.banheiros ?? 0) < f.banheiros) return false;
    if (f.areaMin || f.areaMax) {
      const a = areaPrincipal(i);
      if (a === null || (f.areaMin && a < f.areaMin) || (f.areaMax && a > f.areaMax)) return false;
    }
    if (comodidades.length) {
      const tem = new Set([...(i.comodidades ?? []), ...(i.caracteristicas ?? [])].map(normalizar));
      if (!comodidades.every((c) => tem.has(c))) return false;
    }
    if (termos.length) {
      const texto = normalizar(
        [i.codigo, i.titulo, i.tipo, i.bairro, i.cidade, i.logradouro, i.empreendimento, i.descricao, ...(i.comodidades ?? []), ...(i.caracteristicas ?? [])]
          .filter(Boolean)
          .join(" "),
      );
      if (!termos.every((t) => texto.includes(t))) return false;
    }
    return true;
  });
}

export function ordenarImoveis(lista: ImovelSite[], ordem: OrdemSite, finalidade?: Finalidade): ImovelSite[] {
  const copia = [...lista];
  const preco = (i: ImovelSite) => precoDe(i, finalidade);
  const fim = (v: number | null, asc: boolean) => (v === null ? (asc ? Infinity : -Infinity) : v);
  if (ordem === "menor_preco") copia.sort((a, b) => fim(preco(a), true) - fim(preco(b), true));
  else if (ordem === "maior_preco") copia.sort((a, b) => fim(preco(b), false) - fim(preco(a), false));
  else if (ordem === "maior_area") copia.sort((a, b) => fim(areaPrincipal(b), false) - fim(areaPrincipal(a), false));
  else copia.sort((a, b) => b.criado_em.localeCompare(a.criado_em));
  return copia;
}

export function paginar<T>(lista: T[], pagina: number, porPagina = 12) {
  const paginas = Math.max(1, Math.ceil(lista.length / porPagina));
  const p = Math.min(Math.max(1, pagina), paginas);
  return { itens: lista.slice((p - 1) * porPagina, p * porPagina), pagina: p, paginas, total: lista.length };
}

/** O que falta no cadastro para o anúncio ficar bom no site. */
export function pendenciasSite(i: {
  fotos: number;
  descricao: string | null;
  cidade: string | null;
  bairro: string | null;
  finalidades: string[];
  valor_venda: Num;
  valor_aluguel: Num;
  latitude: Num;
  longitude: Num;
}): string[] {
  const out: string[] = [];
  if (!i.fotos) out.push("sem fotos");
  if ((i.descricao ?? "").trim().length < 50) out.push("descrição curta");
  if (!i.cidade?.trim() || !i.bairro?.trim()) out.push("sem cidade/bairro");
  if (!precoDe(i)) out.push("sem valor");
  if (num(i.latitude) === null || num(i.longitude) === null) out.push("fora do mapa");
  return out;
}

/** Imóveis parecidos: mesma finalidade, de preferência mesmo tipo, cidade/bairro, preço e quartos próximos. */
export function similares(base: ImovelSite, lista: ImovelSite[], n = 4): ImovelSite[] {
  const fin: Finalidade = temFinalidade(base, "locacao") && precoDe(base, "locacao") ? "locacao" : "venda";
  const precoBase = precoDe(base, fin);
  return lista
    .filter((i) => i.id !== base.id && atendeFinalidade(i, fin))
    .map((i) => {
      let pontos = 0;
      if (normalizar(i.tipo) === normalizar(base.tipo)) pontos += 4;
      if (normalizar(i.cidade) === normalizar(base.cidade)) pontos += 3;
      if (base.bairro && normalizar(i.bairro) === normalizar(base.bairro)) pontos += 3;
      const p = precoDe(i, fin);
      if (precoBase && p) {
        const dif = Math.abs(p - precoBase) / precoBase;
        pontos += dif <= 0.15 ? 3 : dif <= 0.3 ? 2 : dif <= 0.5 ? 1 : 0;
      }
      if (base.quartos != null && i.quartos != null) pontos += Math.max(0, 2 - Math.abs(i.quartos - base.quartos));
      return { i, pontos };
    })
    .filter((x) => x.pontos >= 3)
    .sort((a, b) => b.pontos - a.pontos || b.i.criado_em.localeCompare(a.i.criado_em))
    .slice(0, n)
    .map((x) => x.i);
}

/** Opções dos filtros a partir do que existe publicado (cidades, bairros, tipos e comodidades mais comuns). */
export function opcoesFiltro(lista: ImovelSite[], cidade?: string) {
  const contar = (vals: (string | null | undefined)[]) => {
    const m = new Map<string, { rotulo: string; n: number }>();
    for (const v of vals) {
      if (!v?.trim()) continue;
      const k = normalizar(v);
      const atual = m.get(k);
      if (atual) atual.n++;
      else m.set(k, { rotulo: v.trim(), n: 1 });
    }
    return [...m.values()].sort((a, b) => b.n - a.n || a.rotulo.localeCompare(b.rotulo, "pt-BR"));
  };
  const daCidade = cidade ? lista.filter((i) => normalizar(i.cidade) === normalizar(cidade)) : lista;
  return {
    cidades: contar(lista.map((i) => i.cidade)),
    bairros: contar(daCidade.map((i) => i.bairro)),
    tipos: contar(lista.map((i) => i.tipo)),
    comodidades: contar(lista.flatMap((i) => i.comodidades ?? [])).slice(0, 16),
  };
}

const capitalizar = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Título do anúncio: o cadastrado ou "Apartamento com 2 quartos para alugar em Centro, Canoas". */
export function tituloImovel(i: Pick<ImovelSite, "titulo" | "tipo" | "quartos" | "bairro" | "cidade" | "finalidades" | "valor_venda" | "valor_aluguel">): string {
  if (i.titulo?.trim()) return i.titulo.trim();
  const partes = [capitalizar(i.tipo || "Imóvel")];
  if (i.quartos) partes.push(`com ${i.quartos} ${i.quartos === 1 ? "quarto" : "quartos"}`);
  const aluga = atendeFinalidade(i, "locacao");
  const vende = atendeFinalidade(i, "venda");
  partes.push(aluga && vende ? "para alugar ou comprar" : vende ? "à venda" : "para alugar");
  const local = [i.bairro, i.cidade].filter(Boolean).join(", ");
  if (local) partes.push(`em ${local}`);
  return partes.join(" ");
}

/** "2 quartos · 1 suíte · 1 vaga · 60 m²" */
export function resumoImovel(i: Pick<ImovelSite, "quartos" | "suites" | "banheiros" | "vagas" | "area_privativa" | "area_util" | "area_construida" | "area_total">): string {
  const pl = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;
  const a = areaPrincipal(i);
  return [
    i.quartos ? pl(i.quartos, "quarto", "quartos") : null,
    i.suites ? pl(i.suites, "suíte", "suítes") : null,
    i.banheiros ? pl(i.banheiros, "banheiro", "banheiros") : null,
    i.vagas ? pl(i.vagas, "vaga", "vagas") : null,
    a ? `${a.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} m²` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Linhas de preço do anúncio (aluguel com o total do mês; venda). */
export function precosExibidos(i: Pick<ImovelSite, "finalidades" | "valor_venda" | "valor_aluguel" | "valor_condominio" | "valor_iptu">) {
  const aluguel = atendeFinalidade(i, "locacao") ? precoDe(i, "locacao") : null;
  const venda = atendeFinalidade(i, "venda") ? precoDe(i, "venda") : null;
  const cond = num(i.valor_condominio);
  const iptu = num(i.valor_iptu);
  // No cadastro do imóvel o IPTU é MENSAL ("IPTU (R$/mês)"): entra inteiro no total do mês.
  const totalMes = aluguel ? (paraCentavos(aluguel) + paraCentavos(cond) + paraCentavos(iptu)) / 100 : null;
  return { aluguel, venda, condominio: cond, iptu, totalMes: totalMes && totalMes !== aluguel ? totalMes : null };
}

/** Preço curto para o marcador do mapa: "R$ 2,5 mil", "R$ 650 mil", "R$ 1,2 mi". */
export function precoCurto(v: number | null): string {
  if (!v) return "Consulte";
  if (v >= 1_000_000) return `R$ ${(v / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi`;
  if (v >= 1_000) return `R$ ${(v / 1_000).toLocaleString("pt-BR", { maximumFractionDigits: v >= 100_000 ? 0 : 1 })} mil`;
  return formatarReais(v);
}

export function enderecoPublico(i: Pick<ImovelSite, "logradouro" | "numero" | "bairro" | "cidade" | "uf">): string {
  const rua = [i.logradouro, i.numero].filter(Boolean).join(", ");
  return [rua, i.bairro, [i.cidade, i.uf].filter(Boolean).join("/")].filter(Boolean).join(" · ");
}

// ---------------------------------------------------------------------------
// Vídeo e tour
// ---------------------------------------------------------------------------

/** Link do YouTube/Vimeo → endereço do player. */
export function embedVideo(url: string | null | undefined): string | null {
  if (!url) return null;
  const yt = url.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/);
  if (yt) return `https://www.youtube-nocookie.com/embed/${yt[1]}`;
  const vm = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (vm) return `https://player.vimeo.com/video/${vm[1]}`;
  return null;
}

/** Tour virtual só por https. */
export function tourSeguro(url: string | null | undefined): string | null {
  return url && /^https:\/\/[^\s"'<>]+$/.test(url.trim()) ? url.trim() : null;
}

// ---------------------------------------------------------------------------
// Mapa (projeção de Mercator, igual à dos mapas da web)
// ---------------------------------------------------------------------------

export const TAMANHO_TILE = 256;

/** Latitude/longitude → pixel no "mundo" do zoom (0,0 = canto superior esquerdo). */
export function projetar(lat: number, lon: number, zoom: number): { x: number; y: number } {
  const escala = TAMANHO_TILE * 2 ** zoom;
  const la = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const sen = Math.sin((la * Math.PI) / 180);
  return { x: ((lon + 180) / 360) * escala, y: (0.5 - Math.log((1 + sen) / (1 - sen)) / (4 * Math.PI)) * escala };
}

export type PontoMapa = { lat: number; lon: number };

/** Pontos válidos (coordenadas preenchidas e dentro do planeta). */
export function pontosValidos<T extends { latitude: Num; longitude: Num }>(lista: T[]): (T & PontoMapa)[] {
  return lista.flatMap((i) => {
    const lat = num(i.latitude);
    const lon = num(i.longitude);
    if (lat === null || lon === null || Math.abs(lat) > 85 || Math.abs(lon) > 180 || (lat === 0 && lon === 0)) return [];
    return [{ ...i, lat, lon }];
  });
}

/** Zoom e centro (em pixels do mundo) para todos os pontos caberem na caixa. */
export function enquadrar(pontos: PontoMapa[], largura: number, altura: number, margem = 48, zoomMax = 16): { zoom: number; x: number; y: number } {
  if (!pontos.length) {
    const c = projetar(-15.78, -47.93, 4); // Brasil inteiro
    return { zoom: 4, ...c };
  }
  for (let z = zoomMax; z >= 2; z--) {
    const ps = pontos.map((p) => projetar(p.lat, p.lon, z));
    const xs = ps.map((p) => p.x);
    const ys = ps.map((p) => p.y);
    const w = Math.max(...xs) - Math.min(...xs);
    const h = Math.max(...ys) - Math.min(...ys);
    if (w <= largura - 2 * margem && h <= altura - 2 * margem) {
      return { zoom: z, x: (Math.max(...xs) + Math.min(...xs)) / 2, y: (Math.max(...ys) + Math.min(...ys)) / 2 };
    }
  }
  const p = projetar(pontos[0].lat, pontos[0].lon, 2);
  return { zoom: 2, ...p };
}

/** Quadradinhos do mapa (tiles) que cobrem a caixa, com a posição de cada um. */
export function tilesVisiveis(centroX: number, centroY: number, zoom: number, largura: number, altura: number) {
  const n = 2 ** zoom;
  const x0 = centroX - largura / 2;
  const y0 = centroY - altura / 2;
  const out: { chave: string; x: number; y: number; esquerda: number; topo: number }[] = [];
  for (let tx = Math.floor(x0 / TAMANHO_TILE); tx <= Math.floor((x0 + largura) / TAMANHO_TILE); tx++) {
    for (let ty = Math.floor(y0 / TAMANHO_TILE); ty <= Math.floor((y0 + altura) / TAMANHO_TILE); ty++) {
      if (ty < 0 || ty >= n) continue;
      const x = ((tx % n) + n) % n;
      out.push({ chave: `${zoom}/${tx}/${ty}`, x, y: ty, esquerda: tx * TAMANHO_TILE - x0, topo: ty * TAMANHO_TILE - y0 });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Favoritos e comparação (guardados no navegador)
// ---------------------------------------------------------------------------

export const MAX_FAVORITOS = 60;
export const MAX_COMPARAR = 4;

/** Põe ou tira o código da lista (o mais novo primeiro; corta no máximo). */
export function alternarNaLista(lista: string[], codigo: string, maximo: number): string[] {
  if (lista.includes(codigo)) return lista.filter((c) => c !== codigo);
  return [codigo, ...lista].slice(0, maximo);
}

/** Código do imóvel para comparar sem diferença de maiúsculas/espaços. */
export const normalizarCodigo = (c: string) => c.trim().toLowerCase();

/** Códigos vindos da URL (?c=AP-1,AP-2) ou do navegador, limpos e sem repetir. */
export function lerCodigos(valor: string | string[] | undefined | null, maximo: number): string[] {
  const bruto = Array.isArray(valor) ? valor.join(",") : (valor ?? "");
  const vistos = new Set<string>();
  return bruto
    .split(",")
    .map((c) => c.trim().slice(0, 40))
    .filter((c) => c && /^[\p{L}\p{N}._\-/ ]+$/u.test(c) && !vistos.has(c.toLowerCase()) && vistos.add(c.toLowerCase()))
    .slice(0, maximo);
}

// ---------------------------------------------------------------------------
// SEO
// ---------------------------------------------------------------------------

/** Texto curto para a descrição do Google (até ~160 letras, sem cortar palavra). */
export function descricaoSeo(texto: string | null | undefined, max = 160): string {
  const t = (texto ?? "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const corte = t.slice(0, max - 1);
  const ultimo = corte.lastIndexOf(" ");
  // Só recua até o espaço se o corte caiu no meio de uma palavra.
  const meioDePalavra = t[max - 1] !== " ";
  return `${(meioDePalavra && ultimo > max * 0.6 ? corte.slice(0, ultimo) : corte).trim().replace(/[,.;:\-–]+$/, "")}…`;
}

/** JSON dentro de <script> sem permitir fechar a tag (proteção contra XSS). */
export function jsonSeguro(dados: unknown): string {
  return JSON.stringify(dados).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
}

const TIPO_SCHEMA: Record<string, string> = {
  apartamento: "Apartment",
  cobertura: "Apartment",
  "kitnet/studio": "Apartment",
  casa: "SingleFamilyResidence",
  "casa de condomínio": "SingleFamilyResidence",
  "sítio/chácara": "House",
};

/** Dados estruturados do anúncio (schema.org RealEstateListing). */
export function jsonLdImovel(i: ImovelSite, url: string, imagens: string[], vendedor: { nome: string; url: string; telefone?: string | null }) {
  const { aluguel, venda } = precosExibidos(i);
  const area = areaPrincipal(i);
  const oferta = (preco: number, tipo: "LeaseOut" | "Sell") => ({
    "@type": "Offer",
    price: preco.toFixed(2),
    priceCurrency: "BRL",
    availability: i.status === "reservado" ? "https://schema.org/LimitedAvailability" : "https://schema.org/InStock",
    businessFunction: `http://purl.org/goodrelations/v1#${tipo}`,
    url,
  });
  const ofertas = [aluguel ? oferta(aluguel, "LeaseOut") : null, venda ? oferta(venda, "Sell") : null].filter(Boolean);
  return {
    "@context": "https://schema.org",
    "@type": "RealEstateListing",
    name: tituloImovel(i),
    description: descricaoSeo(i.descricao, 500) || undefined,
    url,
    image: imagens.length ? imagens : undefined,
    datePosted: i.criado_em?.slice(0, 10),
    offers: ofertas.length === 1 ? ofertas[0] : ofertas.length ? ofertas : undefined,
    provider: { "@type": "RealEstateAgent", name: vendedor.nome, url: vendedor.url, telephone: vendedor.telefone || undefined },
    mainEntity: {
      "@type": TIPO_SCHEMA[i.tipo] ?? "Accommodation",
      name: tituloImovel(i),
      numberOfRooms: i.quartos ?? undefined,
      numberOfBedrooms: i.quartos ?? undefined,
      numberOfBathroomsTotal: i.banheiros ?? undefined,
      floorSize: area ? { "@type": "QuantitativeValue", value: area, unitCode: "MTK" } : undefined,
      amenityFeature: (i.comodidades ?? []).slice(0, 20).map((c) => ({ "@type": "LocationFeatureSpecification", name: c, value: true })),
      address: {
        "@type": "PostalAddress",
        streetAddress: [i.logradouro, i.numero].filter(Boolean).join(", ") || undefined,
        addressLocality: i.cidade || undefined,
        addressRegion: i.uf || undefined,
        postalCode: i.cep || undefined,
        addressCountry: "BR",
      },
      geo: num(i.latitude) !== null && num(i.longitude) !== null ? { "@type": "GeoCoordinates", latitude: num(i.latitude), longitude: num(i.longitude) } : undefined,
    },
  };
}

/** Dados estruturados da imobiliária (schema.org RealEstateAgent). */
export function jsonLdImobiliaria(s: {
  nome: string;
  url: string;
  logo?: string | null;
  telefone?: string | null;
  email?: string | null;
  endereco?: string | null;
  redes?: (string | null | undefined)[];
}) {
  return {
    "@context": "https://schema.org",
    "@type": "RealEstateAgent",
    name: s.nome,
    url: s.url,
    logo: s.logo || undefined,
    image: s.logo || undefined,
    telephone: s.telefone || undefined,
    email: s.email || undefined,
    address: s.endereco ? { "@type": "PostalAddress", streetAddress: s.endereco, addressCountry: "BR" } : undefined,
    sameAs: (s.redes ?? []).filter((r): r is string => !!r && /^https:\/\//.test(r)),
  };
}

const escXml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** sitemap.xml (com as fotos de cada página). */
export function gerarSitemap(urls: { url: string; atualizado?: string | null; imagens?: string[]; prioridade?: number }[]): string {
  const linhas = urls.map((u) =>
    [
      "  <url>",
      `    <loc>${escXml(u.url)}</loc>`,
      u.atualizado ? `    <lastmod>${escXml(u.atualizado.slice(0, 10))}</lastmod>` : null,
      u.prioridade !== undefined ? `    <priority>${u.prioridade.toFixed(1)}</priority>` : null,
      ...(u.imagens ?? []).slice(0, 10).map((img) => `    <image:image><image:loc>${escXml(img)}</image:loc></image:image>`),
      "  </url>",
    ]
      .filter(Boolean)
      .join("\n"),
  );
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n${linhas.join("\n")}\n</urlset>\n`;
}

// ---------------------------------------------------------------------------
// Visita pedida pelo site
// ---------------------------------------------------------------------------

/** Horários oferecidos no formulário (de meia em meia hora). */
export function horariosVisita(inicio = "08:00", fim = "18:00"): string[] {
  const [hi, mi] = inicio.split(":").map(Number);
  const [hf, mf] = fim.split(":").map(Number);
  const out: string[] = [];
  for (let m = hi * 60 + mi; m <= hf * 60 + mf; m += 30) out.push(`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
  return out;
}

/**
 * Data ("2026-11-10") + hora ("14:30") no horário de Brasília → instante ISO com
 * fuso (-03:00). Devolve null se a data/hora não existir.
 */
export function instanteVisita(data: string | null | undefined, hora: string | null | undefined): string | null {
  if (!data || !hora || !/^\d{4}-\d{2}-\d{2}$/.test(data) || !/^\d{2}:\d{2}$/.test(hora)) return null;
  const iso = `${data}T${hora}:00-03:00`;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  // Rejeita datas inexistentes (ex.: 31/02), que o JavaScript "empurra" para o mês seguinte.
  const brasilia = new Date(d.getTime() - 3 * 3_600_000).toISOString();
  return brasilia.slice(0, 10) === data && brasilia.slice(11, 16) === hora ? iso : null;
}

/**
 * Valida o horário pedido (mesma regra do banco, em site_contato: de 1 h a 120 dias
 * à frente e, em Brasília, das 8h às 18h de meia em meia hora — os horários que o
 * site oferece).
 */
export function problemaHorarioVisita(iso: string | null, agora: Date = new Date()): string | null {
  if (!iso) return "Escolha o dia e o horário da visita.";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "Escolha o dia e o horário da visita.";
  if (t < agora.getTime() + 3_600_000) return "Escolha um horário a partir de daqui a 1 hora.";
  if (t > agora.getTime() + 120 * 86_400_000) return "Escolha uma data nos próximos 120 dias.";
  const local = new Date(t - 3 * 3_600_000);
  const minutos = local.getUTCHours() * 60 + local.getUTCMinutes();
  if (minutos < 8 * 60 || minutos > 18 * 60 || local.getUTCMinutes() % 30 !== 0 || local.getUTCSeconds() !== 0) {
    return "Escolha um horário entre 8h e 18h (de meia em meia hora).";
  }
  return null;
}

/** Valor digitado no "Anuncie seu imóvel" ("450.000", "R$ 1.200,50") → "450000" / "1200.50" (o banco aceita esse formato). */
export function valorParaBanco(texto: string | null | undefined): string | null {
  if (!texto) return null;
  const limpo = texto.replace(/[R$\s]/g, "");
  if (!limpo) return null;
  const normal = limpo.includes(",") ? limpo.replace(/\./g, "").replace(",", ".") : /^\d{1,3}(\.\d{3})+$/.test(limpo) ? limpo.replace(/\./g, "") : limpo;
  const n = Number(normal);
  if (!Number.isFinite(n) || n <= 0) return null;
  return (Math.round(n * 100) / 100).toString();
}
