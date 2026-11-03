/** Modelos de documento: variáveis {{...}}, preenchimento, valor por extenso e checklists. */

export const TIPOS_DOCUMENTO = [
  "locacao",
  "venda",
  "administracao",
  "intermediacao",
  "exclusividade",
  "proposta",
  "autorizacao",
  "aditivo",
  "vistoria",
  "recibo",
  "notificacao",
  "outro",
] as const;
export const ROTULO_TIPO_DOCUMENTO: Record<string, string> = {
  locacao: "Contrato de locação",
  venda: "Compra e venda",
  administracao: "Contrato de administração",
  intermediacao: "Intermediação",
  exclusividade: "Exclusividade",
  proposta: "Proposta",
  autorizacao: "Autorização",
  aditivo: "Aditivo",
  vistoria: "Vistoria",
  recibo: "Recibo",
  notificacao: "Notificação",
  outro: "Outro",
  arquivo: "Arquivo enviado",
};
/** Tipos que só existem no modo imobiliária. */
export const TIPOS_DOC_SO_IMOBILIARIA = ["venda", "administracao", "intermediacao", "exclusividade", "autorizacao"];

export const ROTULO_STATUS_DOCUMENTO: Record<string, string> = {
  rascunho: "Rascunho",
  em_revisao: "Em revisão",
  aprovado: "Aprovado",
  aguardando_assinatura: "Aguardando assinatura",
  assinado: "Assinado",
  recusado: "Recusado",
  cancelado: "Cancelado",
  arquivo: "Arquivo",
};
export const ROTULO_PAPEL_SIGNATARIO: Record<string, string> = {
  locador: "Locador",
  locatario: "Locatário",
  fiador: "Fiador",
  comprador: "Comprador",
  vendedor: "Vendedor",
  proprietario: "Proprietário",
  imobiliaria: "Imobiliária",
  testemunha: "Testemunha",
  parte: "Parte",
};

/** Variáveis aceitas nos modelos (o que aparece na ajuda do editor). */
export const VARIAVEIS: { chave: string; descricao: string }[] = [
  { chave: "data_hoje", descricao: "Data de hoje (por extenso)" },
  { chave: "cidade", descricao: "Cidade do imóvel" },
  { chave: "organizacao.nome", descricao: "Nome da imobiliária/conta" },
  { chave: "organizacao.documento", descricao: "CNPJ/CPF da imobiliária" },
  { chave: "organizacao.creci", descricao: "CRECI" },
  { chave: "imovel.codigo", descricao: "Código do imóvel" },
  { chave: "imovel.tipo", descricao: "Tipo (apartamento, casa…)" },
  { chave: "imovel.endereco", descricao: "Endereço completo" },
  { chave: "imovel.matricula", descricao: "Matrícula" },
  { chave: "imovel.iptu", descricao: "Inscrição do IPTU" },
  { chave: "imovel.valor_aluguel", descricao: "Aluguel anunciado" },
  { chave: "imovel.valor_venda", descricao: "Valor de venda anunciado" },
  { chave: "proprietarios.nomes", descricao: "Nomes dos proprietários" },
  { chave: "proprietarios.qualificacao", descricao: "Qualificação completa dos proprietários" },
  { chave: "pessoa.nome", descricao: "Nome da pessoa escolhida" },
  { chave: "pessoa.qualificacao", descricao: "Qualificação da pessoa escolhida" },
  { chave: "locatarios.nomes", descricao: "Locatários do contrato" },
  { chave: "locatarios.qualificacao", descricao: "Qualificação dos locatários" },
  { chave: "fiadores.qualificacao", descricao: "Qualificação dos fiadores" },
  { chave: "contrato.numero", descricao: "Número do contrato" },
  { chave: "contrato.valor_aluguel", descricao: "Aluguel (R$)" },
  { chave: "contrato.valor_aluguel_extenso", descricao: "Aluguel por extenso" },
  { chave: "contrato.inicio", descricao: "Início" },
  { chave: "contrato.fim", descricao: "Fim" },
  { chave: "contrato.prazo_meses", descricao: "Prazo (meses)" },
  { chave: "contrato.dia_vencimento", descricao: "Dia do vencimento" },
  { chave: "contrato.indice", descricao: "Índice de reajuste" },
  { chave: "contrato.multa_rescisoria", descricao: "Multa rescisória (nº de aluguéis)" },
  { chave: "contrato.garantia", descricao: "Garantia" },
  { chave: "contrato.taxa_administracao", descricao: "Taxa de administração (%)" },
  { chave: "venda.valor", descricao: "Valor da venda (R$)" },
  { chave: "venda.valor_extenso", descricao: "Valor da venda por extenso" },
  { chave: "venda.comprador.qualificacao", descricao: "Qualificação do comprador" },
  { chave: "venda.comissao_pct", descricao: "Comissão da venda (%)" },
  { chave: "captacao.valor", descricao: "Valor avaliado/pretendido" },
  { chave: "captacao.taxa_adm", descricao: "Taxa de administração proposta (%)" },
  { chave: "captacao.comissao_venda", descricao: "Comissão de venda proposta (%)" },
  { chave: "captacao.exclusividade_fim", descricao: "Fim da exclusividade" },
];

/** Troca {{variavel}} pelo valor; o que não tiver valor vira "________". */
export function preencherModelo(texto: string, dados: Record<string, string | number | null | undefined>): string {
  return texto.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, chave: string) => {
    const v = dados[chave];
    return v === null || v === undefined || v === "" ? "________" : String(v);
  });
}

/** Variáveis usadas num texto (para avisar o que ficou em branco). */
export function variaveisDoTexto(texto: string): string[] {
  return [...new Set([...texto.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((m) => m[1]))];
}

const UNIDADES = ["", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez", "onze", "doze", "treze", "quatorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove"];
const DEZENAS = ["", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"];
const CENTENAS = ["", "cento", "duzentos", "trezentos", "quatrocentos", "quinhentos", "seiscentos", "setecentos", "oitocentos", "novecentos"];

function ate999(n: number): string {
  if (n === 0) return "";
  if (n === 100) return "cem";
  const c = Math.floor(n / 100);
  const r = n % 100;
  const partes: string[] = [];
  if (c) partes.push(CENTENAS[c]);
  if (r < 20) {
    if (r) partes.push(UNIDADES[r]);
  } else {
    const d = Math.floor(r / 10);
    const u = r % 10;
    partes.push(u ? `${DEZENAS[d]} e ${UNIDADES[u]}` : DEZENAS[d]);
  }
  return partes.join(" e ");
}

function inteiroPorExtenso(n: number): string {
  if (n === 0) return "zero";
  const grupos: [number, string, string][] = [
    [1_000_000_000, "bilhão", "bilhões"],
    [1_000_000, "milhão", "milhões"],
    [1000, "mil", "mil"],
  ];
  const partes: string[] = [];
  let resto = n;
  for (const [base, sing, plur] of grupos) {
    const q = Math.floor(resto / base);
    if (!q) continue;
    resto %= base;
    partes.push(base === 1000 && q === 1 ? "mil" : `${ate999(q)} ${q === 1 ? sing : plur}`);
  }
  if (resto) partes.push(ate999(resto));
  if (partes.length > 1) {
    const ultimo = partes.pop()!;
    // "e" antes do último grupo quando ele é < 100 ou centena redonda (ex.: mil e duzentos)
    const usaE = resto > 0 && (resto < 100 || resto % 100 === 0);
    return `${partes.join(", ")}${usaE ? " e " : " "}${ultimo}`;
  }
  return partes[0];
}

/** Valor em reais por extenso: 1.250,50 → "mil duzentos e cinquenta reais e cinquenta centavos". */
export function reaisPorExtenso(valor: number): string {
  const centavosTotais = Math.round(Math.abs(valor) * 100);
  const reais = Math.floor(centavosTotais / 100);
  const centavos = centavosTotais % 100;
  const partes: string[] = [];
  if (reais) {
    const milhoesRedondos = reais >= 1_000_000 && reais % 1_000_000 === 0;
    partes.push(`${inteiroPorExtenso(reais)}${milhoesRedondos ? " de" : ""} ${reais === 1 ? "real" : "reais"}`);
  }
  if (centavos) partes.push(`${inteiroPorExtenso(centavos)} ${centavos === 1 ? "centavo" : "centavos"}`);
  return partes.length ? partes.join(" e ") : "zero reais";
}

/** Documentação obrigatória sugerida por tipo de documento. */
export const CHECKLIST_DOCUMENTO: Record<string, { id: string; rotulo: string }[]> = {
  locacao: [
    { id: "id_locatario", rotulo: "Documento de identidade do locatário" },
    { id: "renda", rotulo: "Comprovante de renda do locatário" },
    { id: "residencia", rotulo: "Comprovante de residência" },
    { id: "garantia", rotulo: "Garantia aprovada (fiador, caução ou seguro)" },
    { id: "vistoria", rotulo: "Laudo de vistoria de entrada" },
    { id: "matricula", rotulo: "Matrícula do imóvel" },
  ],
  venda: [
    { id: "id_partes", rotulo: "Documentos de comprador e vendedor" },
    { id: "matricula", rotulo: "Matrícula atualizada" },
    { id: "certidoes", rotulo: "Certidões negativas do vendedor" },
    { id: "iptu", rotulo: "Certidão de IPTU" },
    { id: "condominio", rotulo: "Quitação de condomínio" },
  ],
  administracao: [
    { id: "id_proprietario", rotulo: "Documento do proprietário" },
    { id: "matricula", rotulo: "Matrícula do imóvel" },
    { id: "dados_bancarios", rotulo: "Dados bancários / Pix para repasse" },
    { id: "iptu", rotulo: "Carnê do IPTU" },
  ],
  intermediacao: [
    { id: "id_proprietario", rotulo: "Documento do proprietário" },
    { id: "matricula", rotulo: "Matrícula do imóvel" },
  ],
  exclusividade: [
    { id: "id_proprietario", rotulo: "Documento do proprietário" },
    { id: "matricula", rotulo: "Matrícula do imóvel" },
  ],
  autorizacao: [{ id: "id_proprietario", rotulo: "Documento do proprietário" }],
};
