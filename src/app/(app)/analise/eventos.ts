/** Rótulos e cores dos eventos da auditoria da análise cadastral. */
export const ROTULO_EVENTO: Record<string, string> = {
  criada: "Aberta",
  decisao: "Decisão",
  excecao: "Exceção",
  reaberta: "Reaberta",
  excluida: "Excluída",
  convertida: "Virou contrato",
  contrato_desvinculado: "Contrato desvinculado",
  desistencia: "Desistência",
  retomada: "Retomada",
  identidade: "Documento conferido",
  consentimento: "Autorização (LGPD)",
  documento: "Documento",
  arquivo: "Arquivo",
  renda: "Renda",
  consulta: "Consulta de crédito",
  consulta_excluida: "Consulta excluída",
  fiador: "Fiador",
  garantia: "Garantia",
  ficha_enviada: "Ficha online",
  regras: "Regras alteradas",
  renovacao_solicitada: "Renovação pedida",
  renovacao_renovada: "Renovada",
  renovacao_recusada: "Renovação recusada",
  renovacao_cancelada: "Renovação cancelada",
  nota: "Anotação",
};

export const COR_EVENTO: Record<string, "azul" | "verde" | "amarelo" | "vermelho" | "cinza"> = {
  criada: "azul",
  decisao: "verde",
  excecao: "amarelo",
  reaberta: "amarelo",
  excluida: "vermelho",
  convertida: "verde",
  desistencia: "cinza",
  consulta: "azul",
  consulta_excluida: "vermelho",
  regras: "amarelo",
  renovacao_renovada: "verde",
  renovacao_recusada: "vermelho",
  ficha_enviada: "azul",
};

/** Grupos de filtro da tela de auditoria. */
export const GRUPOS_EVENTO: Record<string, { rotulo: string; tipos: string[] }> = {
  decisoes: { rotulo: "Decisões", tipos: ["decisao", "excecao", "reaberta", "convertida", "contrato_desvinculado", "desistencia", "retomada"] },
  excecoes: { rotulo: "Exceções", tipos: ["excecao"] },
  documentos: { rotulo: "Documentos", tipos: ["documento", "arquivo", "identidade", "ficha_enviada"] },
  credito: { rotulo: "Crédito e LGPD", tipos: ["consulta", "consulta_excluida", "consentimento", "renda"] },
  garantias: { rotulo: "Garantias", tipos: ["garantia", "fiador", "renovacao_solicitada", "renovacao_renovada", "renovacao_recusada", "renovacao_cancelada"] },
  exclusoes: { rotulo: "Exclusões e regras", tipos: ["excluida", "consulta_excluida", "regras"] },
};
