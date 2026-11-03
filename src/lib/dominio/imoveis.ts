/**
 * Regras puras do cadastro de imóveis: duplicados, importação de planilha,
 * imóveis similares e geração de unidades de empreendimento.
 */

/** Texto sem acento, minúsculo, sem pontuação e com espaços simples. */
export function normalizar(s: string | null | undefined): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const ABREVIACOES: [RegExp, string][] = [
  [/^(r|rua)\s/, "rua "],
  [/^(av|avenida)\s/, "avenida "],
  [/^(al|alameda)\s/, "alameda "],
  [/^(tv|trav|travessa)\s/, "travessa "],
  [/^(rod|rodovia)\s/, "rodovia "],
  [/^(est|estrada)\s/, "estrada "],
  [/^(pc|pca|praca)\s/, "praca "],
];

function normalizarLogradouro(s: string | null | undefined): string {
  let n = normalizar(s);
  for (const [re, rep] of ABREVIACOES) n = n.replace(re, rep);
  return n;
}

export type ImovelChave = {
  id?: string;
  codigo?: string | null;
  logradouro?: string | null;
  numero?: string | null;
  complemento?: string | null;
  cidade?: string | null;
  matricula?: string | null;
  inscricao_iptu?: string | null;
};

/** Chave de endereço (vazia se faltar rua ou número). */
export function chaveEndereco(i: ImovelChave): string {
  const rua = normalizarLogradouro(i.logradouro);
  const num = normalizar(i.numero);
  if (!rua || !num) return "";
  return [rua, num, normalizar(i.complemento), normalizar(i.cidade)].join("|");
}

const soDigitosOuTexto = (s: string | null | undefined) => normalizar(s).replace(/\s/g, "");

export type MotivoDuplicado = "codigo" | "endereco" | "matricula" | "iptu";
export const ROTULO_MOTIVO_DUPLICADO: Record<MotivoDuplicado, string> = {
  codigo: "mesmo código",
  endereco: "mesmo endereço",
  matricula: "mesma matrícula",
  iptu: "mesma inscrição de IPTU",
};

function chaves(i: ImovelChave): [MotivoDuplicado, string][] {
  const out: [MotivoDuplicado, string][] = [];
  const c = soDigitosOuTexto(i.codigo);
  if (c) out.push(["codigo", c]);
  const e = chaveEndereco(i);
  if (e) out.push(["endereco", e]);
  const m = soDigitosOuTexto(i.matricula);
  if (m) out.push(["matricula", m]);
  const t = soDigitosOuTexto(i.inscricao_iptu);
  if (t) out.push(["iptu", t]);
  return out;
}

/** Grupos de imóveis que parecem ser o mesmo (2 ou mais por grupo). */
export function acharDuplicados<T extends ImovelChave>(lista: T[]): { motivo: MotivoDuplicado; itens: T[] }[] {
  const mapa = new Map<string, { motivo: MotivoDuplicado; itens: T[] }>();
  for (const i of lista) {
    for (const [motivo, chave] of chaves(i)) {
      const k = `${motivo}:${chave}`;
      const g = mapa.get(k) ?? { motivo, itens: [] };
      g.itens.push(i);
      mapa.set(k, g);
    }
  }
  return [...mapa.values()].filter((g) => g.itens.length > 1);
}

/** Imóveis já cadastrados que batem com o candidato, com o motivo. */
export function duplicadosDe<T extends ImovelChave>(candidato: ImovelChave, existentes: T[]): { motivo: MotivoDuplicado; item: T }[] {
  const minhas = new Map(chaves(candidato).map(([m, c]) => [`${m}:${c}`, m]));
  const out: { motivo: MotivoDuplicado; item: T }[] = [];
  for (const e of existentes) {
    if (candidato.id && e.id === candidato.id) continue;
    for (const [m, c] of chaves(e)) {
      if (minhas.has(`${m}:${c}`)) {
        out.push({ motivo: m, item: e });
        break;
      }
    }
  }
  return out;
}

// -----------------------------------------------------------------------------
// Importação de planilha
// -----------------------------------------------------------------------------

/** Lê CSV (vírgula, ponto e vírgula ou tab; aspas duplas). */
export function lerCSV(texto: string): string[][] {
  const limpo = texto.replace(/^﻿/, "");
  const primeira = limpo.split(/\r?\n/, 1)[0] ?? "";
  const contar = (ch: string) => primeira.split(ch).length - 1;
  const sep = [";", "\t", ","].sort((a, b) => contar(b) - contar(a))[0];
  const linhas: string[][] = [];
  let campo = "";
  let linha: string[] = [];
  let aspas = false;
  for (let i = 0; i < limpo.length; i++) {
    const ch = limpo[i];
    if (aspas) {
      if (ch === '"' && limpo[i + 1] === '"') {
        campo += '"';
        i++;
      } else if (ch === '"') aspas = false;
      else campo += ch;
    } else if (ch === '"') aspas = true;
    else if (ch === sep) {
      linha.push(campo);
      campo = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && limpo[i + 1] === "\n") i++;
      linha.push(campo);
      linhas.push(linha);
      linha = [];
      campo = "";
    } else campo += ch;
  }
  if (campo || linha.length) {
    linha.push(campo);
    linhas.push(linha);
  }
  return linhas.filter((l) => l.some((c) => c.trim()));
}

/** "1.234,56" / "1234,56" / "1234.56" / "R$ 2.500" → número. */
export function numeroBR(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  let s = String(v).replace(/[R$\s%]/g, "").trim();
  if (!s) return null;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Campos aceitos na planilha e os nomes de coluna reconhecidos para cada um. */
export const COLUNAS_IMPORTACAO: { campo: string; rotulo: string; nomes: string[]; tipo: "texto" | "numero" | "inteiro" | "lista" }[] = [
  { campo: "codigo", rotulo: "Código", nomes: ["codigo", "cod", "referencia", "ref"], tipo: "texto" },
  { campo: "tipo", rotulo: "Tipo", nomes: ["tipo", "tipo do imovel", "categoria"], tipo: "texto" },
  { campo: "finalidades", rotulo: "Finalidade", nomes: ["finalidade", "finalidades", "negocio"], tipo: "lista" },
  { campo: "cep", rotulo: "CEP", nomes: ["cep"], tipo: "texto" },
  { campo: "logradouro", rotulo: "Rua", nomes: ["logradouro", "rua", "endereco", "avenida"], tipo: "texto" },
  { campo: "numero", rotulo: "Número", nomes: ["numero", "n", "num", "nro"], tipo: "texto" },
  { campo: "complemento", rotulo: "Complemento", nomes: ["complemento", "compl", "apto", "apartamento"], tipo: "texto" },
  { campo: "bairro", rotulo: "Bairro", nomes: ["bairro"], tipo: "texto" },
  { campo: "cidade", rotulo: "Cidade", nomes: ["cidade", "municipio"], tipo: "texto" },
  { campo: "uf", rotulo: "UF", nomes: ["uf", "estado"], tipo: "texto" },
  { campo: "quartos", rotulo: "Quartos", nomes: ["quartos", "dormitorios", "dorms"], tipo: "inteiro" },
  { campo: "suites", rotulo: "Suítes", nomes: ["suites", "suite"], tipo: "inteiro" },
  { campo: "banheiros", rotulo: "Banheiros", nomes: ["banheiros", "wc"], tipo: "inteiro" },
  { campo: "vagas", rotulo: "Vagas", nomes: ["vagas", "garagem", "vagas de garagem"], tipo: "inteiro" },
  { campo: "area_util", rotulo: "Área útil", nomes: ["area util", "area util m2", "area"], tipo: "numero" },
  { campo: "area_construida", rotulo: "Área construída", nomes: ["area construida"], tipo: "numero" },
  { campo: "area_privativa", rotulo: "Área privativa", nomes: ["area privativa"], tipo: "numero" },
  { campo: "area_total", rotulo: "Área total", nomes: ["area total", "area do terreno", "terreno"], tipo: "numero" },
  { campo: "valor_aluguel", rotulo: "Aluguel", nomes: ["aluguel", "valor aluguel", "valor do aluguel", "valor locacao"], tipo: "numero" },
  { campo: "valor_venda", rotulo: "Venda", nomes: ["venda", "valor venda", "valor de venda", "preco"], tipo: "numero" },
  { campo: "valor_condominio", rotulo: "Condomínio", nomes: ["condominio", "valor condominio"], tipo: "numero" },
  { campo: "valor_iptu", rotulo: "IPTU", nomes: ["iptu", "valor iptu", "iptu mensal"], tipo: "numero" },
  { campo: "matricula", rotulo: "Matrícula", nomes: ["matricula"], tipo: "texto" },
  { campo: "inscricao_iptu", rotulo: "Inscrição IPTU", nomes: ["inscricao iptu", "inscricao", "inscricao municipal"], tipo: "texto" },
  { campo: "descricao", rotulo: "Descrição", nomes: ["descricao", "observacoes", "obs"], tipo: "texto" },
];

const FINALIDADE_DE: Record<string, string> = {
  locacao: "locacao",
  aluguel: "locacao",
  alugar: "locacao",
  venda: "venda",
  vender: "venda",
  temporada: "temporada",
};

export type LinhaImportada = { linha: number; dados: Record<string, unknown>; erros: string[] };

/** Converte as linhas da planilha (1ª = cabeçalho) em imóveis prontos para gravar. */
export function interpretarPlanilha(linhas: unknown[][]): { colunas: (string | null)[]; itens: LinhaImportada[] } {
  if (linhas.length === 0) return { colunas: [], itens: [] };
  const cab = linhas[0].map((c) => normalizar(String(c ?? "")));
  const colunas = cab.map((h) => COLUNAS_IMPORTACAO.find((c) => c.nomes.includes(h))?.campo ?? null);
  const itens: LinhaImportada[] = [];
  linhas.slice(1).forEach((l, idx) => {
    const dados: Record<string, unknown> = {};
    const erros: string[] = [];
    colunas.forEach((campo, i) => {
      if (!campo) return;
      const def = COLUNAS_IMPORTACAO.find((c) => c.campo === campo)!;
      const bruto = l[i];
      const txt = bruto === null || bruto === undefined ? "" : String(bruto).trim();
      if (!txt) return;
      if (def.tipo === "texto") dados[campo] = txt;
      else if (def.tipo === "lista") {
        const fins = txt
          .split(/\s*(?:,|\/|;|\+|\s+e\s+)\s*/i)
          .map((p) => FINALIDADE_DE[normalizar(p)])
          .filter(Boolean);
        if (fins.length) dados[campo] = [...new Set(fins)];
        else erros.push(`Finalidade "${txt}" não reconhecida`);
      } else {
        const n = numeroBR(bruto);
        if (n === null) erros.push(`${def.rotulo}: "${txt}" não é número`);
        else dados[campo] = def.tipo === "inteiro" ? Math.round(n) : n;
      }
    });
    if (!dados.codigo) erros.push("Falta o código");
    if (typeof dados.tipo === "string") dados.tipo = normalizar(dados.tipo as string) || "apartamento";
    if (typeof dados.uf === "string") dados.uf = (dados.uf as string).toUpperCase().slice(0, 2);
    if (!dados.finalidades) dados.finalidades = dados.valor_venda && !dados.valor_aluguel ? ["venda"] : ["locacao"];
    itens.push({ linha: idx + 2, dados, erros });
  });
  return { colunas, itens };
}

/** Planilha-modelo para baixar (CSV com ponto e vírgula, abre direto no Excel). */
export function modeloCSV(): string {
  const cab = COLUNAS_IMPORTACAO.map((c) => c.rotulo).join(";");
  const ex =
    "AP-101;apartamento;locacao;01310-100;Av. Paulista;1000;Apto 101;Bela Vista;São Paulo;SP;2;1;2;1;68;;;;2500,00;;800,00;120,00;12345;0001234;Próximo ao metrô";
  return `﻿${cab}\n${ex}\n`;
}

// -----------------------------------------------------------------------------
// Similares e unidades
// -----------------------------------------------------------------------------

export type ImovelComparavel = {
  id: string;
  tipo: string;
  cidade: string | null;
  bairro: string | null;
  quartos: number | null;
  valor_aluguel: number | null;
  valor_venda: number | null;
  finalidades: string[];
  status: string;
};

/** Imóveis parecidos com `base` (mesmo tipo e cidade, valor ±25%, quartos ±1), do mais parecido ao menos. */
export function similares<T extends ImovelComparavel>(base: ImovelComparavel, lista: T[], limite = 6): (T & { pontos: number })[] {
  const valorBase = Number(base.valor_aluguel ?? base.valor_venda ?? 0);
  const usaAluguel = base.valor_aluguel != null;
  return lista
    .filter((i) => i.id !== base.id && i.status !== "inativo")
    .map((i) => {
      let pontos = 0;
      if (normalizar(i.tipo) === normalizar(base.tipo)) pontos += 3;
      if (base.cidade && normalizar(i.cidade) === normalizar(base.cidade)) pontos += 2;
      if (base.bairro && normalizar(i.bairro) === normalizar(base.bairro)) pontos += 2;
      if (base.quartos != null && i.quartos != null && Math.abs(i.quartos - base.quartos) <= 1) pontos += 1;
      const v = Number((usaAluguel ? i.valor_aluguel : i.valor_venda) ?? 0);
      if (valorBase && v && Math.abs(v - valorBase) / valorBase <= 0.25) pontos += 2;
      if (i.finalidades.some((f) => base.finalidades.includes(f))) pontos += 1;
      return { ...i, pontos };
    })
    .filter((i) => i.pontos >= 5)
    .sort((a, b) => b.pontos - a.pontos)
    .slice(0, limite);
}

/** Códigos das unidades de um empreendimento: blocos × andares × unidades por andar. */
export function gerarUnidades(opcoes: {
  prefixo: string;
  blocos: string[];
  andarInicial: number;
  andarFinal: number;
  porAndar: number;
}): { codigo: string; bloco: string | null; unidade: string }[] {
  const { prefixo, andarInicial, andarFinal, porAndar } = opcoes;
  const blocos = opcoes.blocos.map((b) => b.trim()).filter(Boolean);
  const out: { codigo: string; bloco: string | null; unidade: string }[] = [];
  for (const bloco of blocos.length ? blocos : [null]) {
    for (let andar = andarInicial; andar <= andarFinal; andar++) {
      for (let u = 1; u <= porAndar; u++) {
        const unidade = `${andar}${String(u).padStart(2, "0")}`;
        const codigo = [prefixo.trim().toUpperCase(), bloco?.toUpperCase(), unidade].filter(Boolean).join("-");
        out.push({ codigo, bloco, unidade });
      }
    }
  }
  return out;
}
