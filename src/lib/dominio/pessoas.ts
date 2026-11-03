/**
 * Regras puras do cadastro de pessoas: documentação pendente, cadastros
 * repetidos, importação e exportação de planilha.
 */
import { validarCNPJ, validarCPF, somenteDigitos } from "./documentos";
import { normalizar } from "./imoveis";

export type PessoaBase = {
  id?: string;
  nome: string;
  tipo_pessoa?: "PF" | "PJ" | string | null;
  documento?: string | null;
  email?: string | null;
  telefone?: string | null;
  papeis?: string[];
  banco?: string | null;
  conta?: string | null;
  pix_chave?: string | null;
};

const tem = (categorias: string[], ...nomes: string[]) => nomes.some((n) => categorias.includes(n));

/**
 * O que falta no cadastro, conforme os papéis da pessoa.
 * `categorias` = categorias dos documentos já anexados.
 */
export function pendencias(p: PessoaBase, categorias: string[], modo: "imobiliaria" | "pessoal" = "imobiliaria"): string[] {
  const out: string[] = [];
  const papeis = p.papeis ?? [];
  const pj = p.tipo_pessoa === "PJ";
  if (!somenteDigitos(p.documento ?? "")) out.push(pj ? "Sem CNPJ" : "Sem CPF");
  if (!p.telefone && !p.email) out.push("Sem telefone e sem e-mail");

  const locaOuFia = papeis.includes("locatario") || papeis.includes("fiador");
  const dono = papeis.includes("proprietario");
  if (locaOuFia || dono) {
    if (pj) {
      if (!tem(categorias, "Contrato social")) out.push("Falta o contrato social");
    } else if (!tem(categorias, "RG ou CNH")) out.push("Falta RG ou CNH");
  }
  if (locaOuFia) {
    if (!tem(categorias, "Comprovante de residência")) out.push("Falta comprovante de residência");
    if (!tem(categorias, "Comprovante de renda")) out.push("Falta comprovante de renda");
  }
  if (dono && modo === "imobiliaria" && !p.pix_chave && !(p.banco && p.conta)) out.push("Sem dados bancários ou Pix para o repasse");
  return out;
}

// -----------------------------------------------------------------------------
// Repetidos
// -----------------------------------------------------------------------------
export type MotivoPessoaRepetida = "documento" | "email" | "telefone" | "nome";
export const ROTULO_MOTIVO_PESSOA: Record<MotivoPessoaRepetida, string> = {
  documento: "mesmo CPF/CNPJ",
  email: "mesmo e-mail",
  telefone: "mesmo telefone",
  nome: "mesmo nome",
};

function chavesPessoa(p: PessoaBase): [MotivoPessoaRepetida, string][] {
  const out: [MotivoPessoaRepetida, string][] = [];
  const doc = somenteDigitos(p.documento ?? "");
  if (doc) out.push(["documento", doc]);
  const email = (p.email ?? "").trim().toLowerCase();
  if (email) out.push(["email", email]);
  const tel = somenteDigitos(p.telefone ?? "");
  if (tel.length >= 8) out.push(["telefone", tel.slice(-9)]);
  const nome = normalizar(p.nome);
  if (nome.split(" ").length >= 2) out.push(["nome", nome]);
  return out;
}

/** Grupos de cadastros que parecem ser a mesma pessoa. */
export function acharPessoasRepetidas<T extends PessoaBase>(lista: T[]): { motivo: MotivoPessoaRepetida; itens: T[] }[] {
  const mapa = new Map<string, { motivo: MotivoPessoaRepetida; itens: T[] }>();
  for (const p of lista) {
    for (const [motivo, chave] of chavesPessoa(p)) {
      const k = `${motivo}:${chave}`;
      const g = mapa.get(k) ?? { motivo, itens: [] };
      g.itens.push(p);
      mapa.set(k, g);
    }
  }
  // Um mesmo par aparece uma vez só (pelo motivo mais forte).
  const vistos = new Set<string>();
  const ordem: MotivoPessoaRepetida[] = ["documento", "email", "telefone", "nome"];
  return [...mapa.values()]
    .filter((g) => g.itens.length > 1)
    .sort((a, b) => ordem.indexOf(a.motivo) - ordem.indexOf(b.motivo))
    .filter((g) => {
      const k = g.itens
        .map((i) => i.id ?? i.nome)
        .sort()
        .join("|");
      if (vistos.has(k)) return false;
      vistos.add(k);
      return true;
    });
}

/** Cadastros existentes que batem com o candidato. */
export function pessoaRepetidaDe<T extends PessoaBase>(c: PessoaBase, existentes: T[]): { motivo: MotivoPessoaRepetida; item: T } | null {
  const minhas = new Set(chavesPessoa(c).filter(([m]) => m !== "nome").map(([m, k]) => `${m}:${k}`));
  for (const e of existentes) {
    if (c.id && e.id === c.id) continue;
    for (const [m, k] of chavesPessoa(e)) if (minhas.has(`${m}:${k}`)) return { motivo: m, item: e };
  }
  return null;
}

// -----------------------------------------------------------------------------
// Planilha
// -----------------------------------------------------------------------------
export const COLUNAS_PESSOA: { campo: string; rotulo: string; nomes: string[] }[] = [
  { campo: "nome", rotulo: "Nome", nomes: ["nome", "nome completo", "razao social", "cliente"] },
  { campo: "tipo_pessoa", rotulo: "Tipo", nomes: ["tipo", "tipo pessoa", "pf pj"] },
  { campo: "documento", rotulo: "CPF/CNPJ", nomes: ["cpf cnpj", "cpf", "cnpj", "documento", "cpf/cnpj"] },
  { campo: "rg_ie", rotulo: "RG/IE", nomes: ["rg", "rg ie", "ie", "inscricao estadual"] },
  { campo: "email", rotulo: "E-mail", nomes: ["email", "e mail"] },
  { campo: "telefone", rotulo: "Telefone", nomes: ["telefone", "celular", "whatsapp", "fone"] },
  { campo: "papeis", rotulo: "Papéis", nomes: ["papeis", "papel", "perfil", "categoria"] },
  { campo: "cep", rotulo: "CEP", nomes: ["cep"] },
  { campo: "logradouro", rotulo: "Rua", nomes: ["rua", "logradouro", "endereco"] },
  { campo: "numero", rotulo: "Número", nomes: ["numero", "n", "num"] },
  { campo: "complemento", rotulo: "Complemento", nomes: ["complemento"] },
  { campo: "bairro", rotulo: "Bairro", nomes: ["bairro"] },
  { campo: "cidade", rotulo: "Cidade", nomes: ["cidade", "municipio"] },
  { campo: "uf", rotulo: "UF", nomes: ["uf", "estado"] },
  { campo: "banco", rotulo: "Banco", nomes: ["banco"] },
  { campo: "agencia", rotulo: "Agência", nomes: ["agencia"] },
  { campo: "conta", rotulo: "Conta", nomes: ["conta"] },
  { campo: "pix_chave", rotulo: "Pix", nomes: ["pix", "chave pix"] },
  { campo: "observacoes", rotulo: "Observações", nomes: ["observacoes", "obs", "anotacoes"] },
];

const PAPEL_DE: Record<string, string> = {
  proprietario: "proprietario",
  dono: "proprietario",
  locador: "proprietario",
  locatario: "locatario",
  inquilino: "locatario",
  fiador: "fiador",
  garantidor: "fiador",
  comprador: "comprador",
  investidor: "investidor",
  corretor: "corretor",
  parceiro: "parceiro",
  prestador: "prestador",
  fornecedor: "prestador",
  cliente: "cliente",
};

export type LinhaPessoa = { linha: number; dados: Record<string, unknown>; erros: string[] };

export function interpretarPlanilhaPessoas(linhas: unknown[][]): { colunas: (string | null)[]; itens: LinhaPessoa[] } {
  if (!linhas.length) return { colunas: [], itens: [] };
  const cab = linhas[0].map((c) => normalizar(String(c ?? "")));
  const colunas = cab.map((h) => COLUNAS_PESSOA.find((c) => c.nomes.includes(h))?.campo ?? null);
  const itens = linhas.slice(1).map((l, idx) => {
    const dados: Record<string, unknown> = {};
    const erros: string[] = [];
    colunas.forEach((campo, i) => {
      if (!campo) return;
      const txt = l[i] === null || l[i] === undefined ? "" : String(l[i]).trim();
      if (txt) dados[campo] = txt;
    });
    if (!dados.nome) erros.push("Falta o nome");
    const doc = somenteDigitos(String(dados.documento ?? ""));
    const tipo = normalizar(String(dados.tipo_pessoa ?? ""));
    dados.tipo_pessoa = tipo.includes("pj") || tipo.includes("juridica") || doc.length === 14 ? "PJ" : "PF";
    if (doc) {
      const ok = dados.tipo_pessoa === "PJ" ? validarCNPJ(doc) : validarCPF(doc);
      if (!ok) erros.push(`${dados.tipo_pessoa === "PJ" ? "CNPJ" : "CPF"} inválido`);
      dados.documento = doc;
    } else delete dados.documento;
    if (typeof dados.uf === "string") dados.uf = dados.uf.toUpperCase().slice(0, 2);
    if (typeof dados.email === "string") dados.email = dados.email.toLowerCase();
    const papeis = String(dados.papeis ?? "")
      .split(/\s*(?:,|\/|;|\+|\s+e\s+)\s*/i)
      .map((p) => PAPEL_DE[normalizar(p)])
      .filter(Boolean);
    dados.papeis = papeis.length ? [...new Set(papeis)] : ["cliente"];
    return { linha: idx + 2, dados, erros };
  });
  return { colunas, itens };
}

const csv = (v: unknown) => {
  const s = v === null || v === undefined ? "" : Array.isArray(v) ? v.join(", ") : String(v);
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** CSV com ponto e vírgula e BOM (abre direto no Excel em português). */
export function pessoasParaCSV(lista: Record<string, unknown>[], rotuloPapel: Record<string, string> = {}): string {
  const cab = COLUNAS_PESSOA.map((c) => c.rotulo).join(";");
  const linhas = lista.map((p) =>
    COLUNAS_PESSOA.map((c) => {
      if (c.campo === "papeis") return csv(((p.papeis as string[]) ?? []).map((x) => rotuloPapel[x] ?? x));
      return csv(p[c.campo]);
    }).join(";"),
  );
  return `﻿${[cab, ...linhas].join("\n")}\n`;
}

export function modeloCSVPessoas(): string {
  return pessoasParaCSV([
    {
      nome: "Maria da Silva",
      tipo_pessoa: "PF",
      documento: "",
      email: "maria@email.com",
      telefone: "(11) 99999-9999",
      papeis: ["locatario"],
      cidade: "São Paulo",
      uf: "SP",
    },
  ]);
}

// -----------------------------------------------------------------------------
// Perfil de interesse × imóveis
// -----------------------------------------------------------------------------
export type PerfilInteresse = {
  interesse: string[];
  pref_tipos: string[];
  pref_regioes: string | null;
  pref_valor_min: number | null;
  pref_valor_max: number | null;
  pref_quartos_min: number | null;
};
export type ImovelOferta = {
  id: string;
  tipo: string;
  finalidades: string[];
  status: string;
  bairro: string | null;
  cidade: string | null;
  quartos: number | null;
  valor_aluguel: number | null;
  valor_venda: number | null;
};

/** Imóveis disponíveis que atendem ao perfil (vazio no perfil = não filtra por aquilo). */
export function imoveisQueCombinam<T extends ImovelOferta>(perfil: PerfilInteresse, imoveis: T[]): T[] {
  const querAlugar = perfil.interesse.includes("alugar");
  const querComprar = perfil.interesse.includes("comprar") || perfil.interesse.includes("investir");
  const regioes = (perfil.pref_regioes ?? "")
    .split(",")
    .map((r) => normalizar(r))
    .filter(Boolean);
  const tipos = perfil.pref_tipos.map((t) => normalizar(t));
  return imoveis.filter((i) => {
    if (i.status !== "disponivel") return false;
    const alugavel = i.finalidades.includes("locacao") || i.finalidades.includes("temporada");
    const vendavel = i.finalidades.includes("venda");
    if ((querAlugar || querComprar) && !((querAlugar && alugavel) || (querComprar && vendavel))) return false;
    if (tipos.length && !tipos.includes(normalizar(i.tipo))) return false;
    if (regioes.length) {
      const local = `${normalizar(i.bairro)} ${normalizar(i.cidade)}`;
      if (!regioes.some((r) => local.includes(r))) return false;
    }
    if (perfil.pref_quartos_min && (i.quartos ?? 0) < perfil.pref_quartos_min) return false;
    const valor = querComprar && !querAlugar ? i.valor_venda : querAlugar && !querComprar ? i.valor_aluguel : (i.valor_aluguel ?? i.valor_venda);
    if (perfil.pref_valor_min != null && (valor == null || Number(valor) < perfil.pref_valor_min)) return false;
    if (perfil.pref_valor_max != null && (valor == null || Number(valor) > perfil.pref_valor_max)) return false;
    return true;
  });
}
