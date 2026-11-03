// Tipos das linhas do banco (valores numeric chegam como number ou string).
type Num = number | string;

export interface Organizacao {
  id: string;
  nome: string;
  documento: string | null;
  creci: string | null;
  email: string | null;
  telefone: string | null;
  multa_atraso_pct: Num;
  juros_mes_pct: Num;
  taxa_administracao_pct: Num;
  taxa_intermediacao_pct: Num;
  carencia_dias: number;
  imposto_pf_pct: Num;
  imposto_pj_pct: Num;
  /** imobiliaria = administra imóveis de terceiros; pessoal = imóveis próprios (sem taxa nem repasse). */
  modo: "imobiliaria" | "pessoal";
}

export const ehPessoal = (o: Pick<Organizacao, "modo"> | null | undefined) => o?.modo === "pessoal";

export interface Pessoa {
  id: string;
  tipo_pessoa: "PF" | "PJ";
  nome: string;
  documento: string | null;
  rg_ie: string | null;
  data_nascimento: string | null;
  estado_civil: string | null;
  profissao: string | null;
  email: string | null;
  telefone: string | null;
  cep: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  banco: string | null;
  agencia: string | null;
  conta: string | null;
  tipo_conta: string | null;
  pix_chave: string | null;
  papeis: string[];
  observacoes: string | null;
  /** % de imposto descontado no repasse; null = padrão da imobiliária. */
  imposto_pct: Num | null;
  aceita_whatsapp: boolean;
  aceita_email: boolean;
  aceita_sms: boolean;
  aceita_marketing: boolean;
  canal_preferido: string | null;
  consentimento_em: string | null;
  consentimento_origem: string | null;
  interesse: string[];
  pref_tipos: string[];
  pref_regioes: string | null;
  pref_valor_min: Num | null;
  pref_valor_max: Num | null;
  pref_quartos_min: number | null;
  especialidade: string | null;
  created_at?: string;
}

export interface Imovel {
  id: string;
  codigo: string;
  finalidades: string[];
  tipo: string;
  status: string;
  cep: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  area_util: Num | null;
  area_total: Num | null;
  quartos: number | null;
  suites: number | null;
  banheiros: number | null;
  vagas: number | null;
  valor_venda: Num | null;
  valor_aluguel: Num | null;
  valor_condominio: Num | null;
  valor_iptu: Num | null;
  titulo: string | null;
  descricao: string | null;
  caracteristicas: string[];
  matricula: string | null;
  inscricao_iptu: string | null;
  publicar_site: boolean;
  area_construida: Num | null;
  area_privativa: Num | null;
  latitude: Num | null;
  longitude: Num | null;
  comodidades: string[];
  outros_encargos: Num | null;
  outros_encargos_descricao: string | null;
  video_url: string | null;
  tour_url: string | null;
  exclusivo: boolean;
  exclusividade_inicio: string | null;
  exclusividade_fim: string | null;
  autorizacao_numero: string | null;
  autorizacao_data: string | null;
  autorizacao_validade: string | null;
  corretor_id: string | null;
  empreendimento_id: string | null;
  bloco: string | null;
  unidade: string | null;
  captado_em: string;
  vendido_em: string | null;
}

export interface Contrato {
  id: string;
  numero: number;
  codigo: string | null;
  imovel_id: string;
  status: string;
  finalidade: string;
  data_inicio: string;
  prazo_meses: number;
  data_fim: string;
  valor_aluguel: Num;
  dia_vencimento: number;
  modalidade: "antecipado" | "vencido";
  indice_reajuste: string;
  periodicidade_reajuste_meses: number;
  data_base_reajuste: string;
  taxa_administracao_pct: Num;
  taxa_intermediacao_pct: Num;
  tipo_repasse: "automatico" | "garantido" | "manual";
  dias_repasse: number;
  repassar_multa_juros: boolean;
  multa_atraso_pct: Num;
  juros_mes_pct: Num;
  carencia_dias: number;
  multa_rescisoria_alugueis: Num;
  garantia_tipo: string;
  garantia_valor: Num | null;
  garantia_detalhes: string | null;
  seguro_incendio_apolice: string | null;
  seguro_incendio_vencimento: string | null;
  data_rescisao: string | null;
  observacoes: string | null;
}

export interface ContratoParte {
  contrato_id: string;
  pessoa_id: string;
  papel: "locatario" | "fiador" | "proprietario";
  percentual: Num | null;
  pessoa?: Pessoa;
}

export interface ContratoEncargo {
  id: string;
  contrato_id: string;
  descricao: string;
  tipo: string;
  valor: Num;
  destino: "proprietario" | "imobiliaria" | "terceiro";
  inicio: string | null;
  fim: string | null;
}

export interface Fatura {
  id: string;
  numero: number;
  contrato_id: string;
  competencia: string;
  periodo_inicio: string | null;
  periodo_fim: string | null;
  vencimento: string;
  valor_total: Num;
  status: "aberta" | "paga" | "cancelada";
  pago_em: string | null;
  valor_pago: Num | null;
  forma_pagamento: string | null;
  irrf_por_proprietario: Record<string, number>;
  linha_digitavel: string | null;
  pix_copia_cola: string | null;
  observacoes: string | null;
}

export interface FaturaItem {
  id: string;
  fatura_id: string;
  descricao: string;
  tipo: string;
  valor: Num;
  destino: "proprietario" | "imobiliaria" | "terceiro";
}

export interface Repasse {
  id: string;
  contrato_id: string;
  fatura_id: string | null;
  pessoa_id: string;
  competencia: string;
  percentual: Num;
  aluguel: Num;
  encargos: Num;
  multa_juros: Num;
  valor_bruto: Num;
  taxa_administracao: Num;
  taxa_intermediacao: Num;
  irrf: Num;
  imposto: Num;
  imposto_pct: Num;
  outros_descontos: Num;
  valor_liquido: Num;
  previsto_para: string;
  status: "pendente" | "pago" | "cancelado";
  pago_em: string | null;
  comprovante: string | null;
}

export const ROTULO_STATUS_IMOVEL: Record<string, string> = {
  disponivel: "Desalugado",
  alugado: "Alugado",
  vendido: "Vendido",
  reservado: "Reservado",
  inativo: "Inativo",
};

export const ROTULO_GARANTIA: Record<string, string> = {
  sem_garantia: "Sem garantia",
  fiador: "Fiador",
  caucao: "Caução",
  seguro_fianca: "Seguro fiança",
  titulo_capitalizacao: "Título de capitalização",
};

export const ROTULO_REPASSE: Record<string, string> = {
  automatico: "Automático (após o pagamento)",
  garantido: "Garantido (mesmo sem pagamento)",
  manual: "Manual",
};

export const ROTULO_PAPEL: Record<string, string> = {
  proprietario: "Proprietário",
  locatario: "Locatário",
  fiador: "Fiador / garantidor",
  comprador: "Comprador",
  investidor: "Investidor",
  corretor: "Corretor",
  parceiro: "Parceiro",
  prestador: "Prestador de serviço",
  cliente: "Cliente",
};

export const TIPOS_IMOVEL = [
  "apartamento",
  "casa",
  "casa de condomínio",
  "cobertura",
  "kitnet/studio",
  "sala comercial",
  "loja",
  "galpão",
  "terreno",
  "sítio/chácara",
  "outro",
];

// -----------------------------------------------------------------------------
// Comercial
// -----------------------------------------------------------------------------
export type StatusLead = "novo" | "em_atendimento" | "visita" | "proposta" | "ganho" | "perdido";
export const ROTULO_STATUS_LEAD: Record<StatusLead, string> = {
  novo: "Novo",
  em_atendimento: "Em atendimento",
  visita: "Visita",
  proposta: "Proposta",
  ganho: "Fechado",
  perdido: "Perdido",
};
export const ROTULO_ORIGEM_LEAD: Record<string, string> = {
  whatsapp: "WhatsApp",
  site: "Site",
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
  portal: "Portal (outro)",
  zap: "ZAP Imóveis",
  vivareal: "VivaReal",
  olx: "OLX",
  imovelweb: "Imovelweb",
  indicacao: "Indicação",
  placa: "Placa",
  telefone: "Telefone",
  email: "E-mail",
  visita: "Visita à imobiliária",
  outro: "Outro",
};
export const ROTULO_INTERESSE: Record<string, string> = { locacao: "Alugar", compra: "Comprar" };

export interface Lead {
  id: string;
  nome: string;
  telefone: string | null;
  email: string | null;
  origem: string;
  interesse: "locacao" | "compra";
  imovel_id: string | null;
  status: StatusLead;
  observacoes: string | null;
  atendido_em: string | null;
  created_at: string;
  funil: string;
  corretor_id: string | null;
  atribuido_em: string | null;
  prioridade: string;
  etiquetas: string[];
  orcamento_min: Num | null;
  orcamento_max: Num | null;
  regioes: string | null;
  tipos: string[];
  quartos_min: number | null;
  motivo_perda: string | null;
  perdido_em: string | null;
  proximo_contato: string | null;
  ultimo_contato: string | null;
  etapa_max: number;
}

export const ROTULO_STATUS_VISITA: Record<string, string> = { agendada: "Agendada", realizada: "Realizada", cancelada: "Cancelada" };
export const ROTULO_STATUS_PROPOSTA: Record<string, string> = {
  em_negociacao: "Em negociação",
  aceita: "Aceita",
  recusada: "Recusada",
  cancelada: "Cancelada",
};
export const ROTULO_TIPO_PROPOSTA: Record<string, string> = { locacao: "Locação", venda: "Venda" };

export const TIPOS_META = ["locacoes", "vendas", "captacoes", "leads", "faturamento"] as const;
export type TipoMeta = (typeof TIPOS_META)[number];
export const ROTULO_META: Record<TipoMeta, string> = {
  locacoes: "Imóveis alugados",
  vendas: "Imóveis vendidos",
  captacoes: "Imóveis captados",
  leads: "Leads recebidos",
  faturamento: "Faturamento (R$)",
};

// -----------------------------------------------------------------------------
// Despesas (escritório no modo imobiliária; imóveis no modo pessoal)
// -----------------------------------------------------------------------------
export const CATEGORIAS_DESPESA_ESCRITORIO = [
  "Aluguel da sala",
  "Água, luz e internet",
  "Salários e pró-labore",
  "Marketing e portais",
  "Impostos e taxas",
  "Comissões",
  "Sistemas e assinaturas",
  "Material e manutenção",
  "Outros",
];
export const CATEGORIAS_DESPESA_IMOVEL = ["Condomínio", "IPTU", "Manutenção", "Seguro", "Água e luz", "Taxas", "Reforma", "Outros"];

// -----------------------------------------------------------------------------
// Cadastro de imóveis
// -----------------------------------------------------------------------------
export const COMODIDADES: { grupo: string; itens: string[] }[] = [
  { grupo: "Imóvel", itens: ["Mobiliado", "Semimobiliado", "Ar-condicionado", "Varanda", "Varanda gourmet", "Churrasqueira", "Lareira", "Armários embutidos", "Cozinha planejada", "Área de serviço", "Quintal", "Jardim", "Piscina privativa", "Aquecimento solar", "Energia solar"] },
  { grupo: "Condomínio", itens: ["Portaria 24h", "Elevador", "Piscina", "Academia", "Salão de festas", "Playground", "Quadra", "Espaço gourmet", "Sauna", "Bicicletário", "Coworking", "Lavanderia coletiva"] },
  { grupo: "Outros", itens: ["Aceita pets", "Vista para o mar", "Próximo ao metrô", "Acessibilidade", "Gerador", "Câmeras de segurança", "Cerca elétrica"] },
];

export const CATEGORIAS_DOCUMENTO_IMOVEL = ["Matrícula", "Escritura", "IPTU", "Habite-se", "Planta aprovada", "Laudo de vistoria", "Outro"];
export const PORTAIS_ANUNCIO = ["ZAP Imóveis", "VivaReal", "OLX", "Imovelweb", "Chaves na Mão", "Site próprio", "Instagram", "Facebook", "Outro"];

// -----------------------------------------------------------------------------
// Pessoas: vínculos, relacionamento, documentos e comunicação
// -----------------------------------------------------------------------------
export const TIPOS_VINCULO: Record<string, string> = {
  conjuge: "Cônjuge / companheiro(a)",
  representante: "Representante legal",
  procurador: "Procurador",
  socio: "Sócio",
  herdeiro: "Herdeiro",
  contato: "Contato",
  outro: "Outro",
};

export const TIPOS_INTERACAO: Record<string, string> = {
  nota: "Anotação interna",
  ligacao: "Ligação",
  whatsapp: "WhatsApp",
  email: "E-mail",
  reuniao: "Reunião",
  visita: "Visita",
};

export const CATEGORIAS_DOCUMENTO_PESSOA = [
  "RG ou CNH",
  "CPF/CNPJ",
  "Comprovante de residência",
  "Comprovante de renda",
  "Certidão de casamento",
  "Contrato social",
  "Procuração",
  "Outro",
];

export const CANAIS_COMUNICACAO: Record<string, string> = {
  whatsapp: "WhatsApp",
  email: "E-mail",
  sms: "SMS",
  marketing: "Ofertas e novidades",
};

export const INTERESSES_PESSOA: Record<string, string> = { alugar: "Alugar", comprar: "Comprar", investir: "Investir" };
