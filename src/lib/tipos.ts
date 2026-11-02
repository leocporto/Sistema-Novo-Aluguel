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
}

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
  outros_descontos: Num;
  valor_liquido: Num;
  previsto_para: string;
  status: "pendente" | "pago" | "cancelado";
  pago_em: string | null;
  comprovante: string | null;
}

export const ROTULO_STATUS_IMOVEL: Record<string, string> = {
  disponivel: "Disponível",
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
  fiador: "Fiador",
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
