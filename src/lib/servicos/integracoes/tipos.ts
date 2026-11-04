/*
 * Contratos (interfaces) dos provedores externos. Cada integração que depender
 * de contrato/credencial implementa a interface da sua categoria quando o
 * contrato existir; até lá a configuração fica guardada (integracoes_config +
 * integracoes_segredos) e a tela diz "estrutura pronta". Nada aqui finge
 * chamada: só o "testar conexão" de provedores.ts faz chamadas reais.
 */

export type Ambiente = "sandbox" | "producao";

export type CredenciaisProvedor = {
  ambiente: Ambiente;
  config: Record<string, string>;
  segredos: Record<string, string>;
};

export type ResultadoTeste = { ok: boolean; mensagem: string };

/** Banco ou gateway: boleto registrado, Pix com cobrança e aviso de pagamento. */
export interface ProvedorCobranca {
  emitirBoleto(c: CredenciaisProvedor, cobranca: { faturaNumero: number; valorCentavos: number; vencimento: string; pagador: { nome: string; documento: string; email?: string } }): Promise<{ idExterno: string; linhaDigitavel: string; url?: string }>;
  criarPixCobranca(c: CredenciaisProvedor, cobranca: { faturaNumero: number; valorCentavos: number; vencimento: string; txid: string }): Promise<{ idExterno: string; copiaECola: string }>;
  consultar(c: CredenciaisProvedor, idExterno: string): Promise<{ status: "aberta" | "paga" | "cancelada"; pagoEm?: string; valorPagoCentavos?: number }>;
  /** Arquivo de retorno (CNAB 240/400) ou aviso (webhook) do banco → pagamentos para a baixa automática. */
  lerRetorno?(conteudo: string): { nossoNumero: string; seuNumero?: string; pagoEm: string; valorCentavos: number }[];
}

/** Pagamentos em lote (repasses) pelo banco. */
export interface ProvedorPagamentos {
  pagarPix(c: CredenciaisProvedor, pagamento: { chave: string; valorCentavos: number; descricao: string; idempotencia: string }): Promise<{ idExterno: string; status: "agendado" | "pago" | "recusado" }>;
}

/** Assinatura eletrônica externa (Clicksign, D4Sign, DocuSign). */
export interface ProvedorAssinatura {
  enviar(c: CredenciaisProvedor, doc: { titulo: string; pdf: Uint8Array; signatarios: { nome: string; email: string; cpf?: string }[] }): Promise<{ idExterno: string; links: string[] }>;
  situacao(c: CredenciaisProvedor, idExterno: string): Promise<{ status: "pendente" | "assinado" | "recusado"; arquivoAssinado?: Uint8Array }>;
}

/** E-mail transacional (Resend, SMTP). */
export interface ProvedorEmail {
  enviar(c: CredenciaisProvedor, msg: { para: string; assunto: string; html: string; texto?: string; responderPara?: string }): Promise<{ idExterno: string }>;
}

/** Birô de crédito (Serasa, Boa Vista) — só com base legal registrada na análise. */
export interface ProvedorConsultaCadastral {
  consultar(c: CredenciaisProvedor, pedido: { documento: string; baseLegal: "consentimento" | "protecao_credito" }): Promise<{ score?: number; restricoes: { tipo: string; valorCentavos?: number; data?: string }[]; protocolo: string }>;
}

/** Seguradora / garantidora (seguro-fiança). */
export interface ProvedorSeguroFianca {
  cotar(c: CredenciaisProvedor, pedido: { documento: string; aluguelCentavos: number; encargosCentavos: number; prazoMeses: number }): Promise<{ protocolo: string; status: "aprovado" | "recusado" | "em_analise"; premioCentavos?: number }>;
}

/** Emissão de NFS-e. */
export interface ProvedorNfse {
  emitir(c: CredenciaisProvedor, nota: { tomador: { nome: string; documento: string; email?: string }; servico: string; valorCentavos: number; competencia: string }): Promise<{ numero: string; codigoVerificacao: string; pdfUrl?: string }>;
}

/** Cópia externa dos documentos (S3, Google Drive). */
export interface ProvedorArmazenamento {
  enviar(c: CredenciaisProvedor, arquivo: { caminho: string; conteudo: Uint8Array; tipo: string }): Promise<{ idExterno: string }>;
}

/** Agenda em duas vias (Google, Microsoft) via OAuth. */
export interface ProvedorCalendario {
  urlAutorizacao(c: CredenciaisProvedor, retorno: string, estado: string): string;
  sincronizar(c: CredenciaisProvedor, tokens: { acesso: string; renovacao: string }, eventos: { id: string; titulo: string; inicio: string; fim: string; local?: string }[]): Promise<{ enviados: number }>;
}
