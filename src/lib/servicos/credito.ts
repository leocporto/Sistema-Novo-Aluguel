import "server-only";
import { ROTULO_BUREAU, type BaseLegal, type Bureau, type ResultadoCredito } from "@/lib/dominio/analise";

/**
 * Camada de integração com birôs de crédito (Serasa, SPC, Boa Vista, Quod…).
 *
 * Como funciona: a tela Crédito chama consultarCreditoAutomatico (actions.ts),
 * que confere a base legal da LGPD, chama o conector do birô e grava o resultado
 * em analise_consultas com origem 'integracao' e a resposta bruta em "resposta"
 * (o gatilho do banco registra quem consultou e manda para a auditoria).
 *
 * NENHUM conector está ligado: a consulta automática depende de contrato com o
 * birô e das credenciais dele (cada birô tem a sua API, homologação e cobrança
 * por consulta). Não há integração "de mentira" aqui. Para ligar um birô:
 *   1. contratar o serviço de consulta (pessoa física/jurídica) do birô;
 *   2. escrever o conector abaixo (implementa ConectorCredito com a API dele);
 *   3. pôr as credenciais em variáveis de ambiente do servidor (Vercel) — nunca no código;
 *   4. registrar o conector em CONECTORES.
 * Até lá, a equipe consulta no site do birô e registra o resultado à mão.
 */

export type PedidoCredito = {
  documento: string;
  nome: string | null;
  baseLegal: BaseLegal;
  /** Identificador nosso (id da análise/fiador), para conferir a cobrança do birô. */
  referencia: string;
};

export type RespostaConector = Partial<Record<keyof ResultadoCredito, unknown>> & {
  /** Resposta original do birô, guardada como prova da análise. */
  bruta: unknown;
};

export interface ConectorCredito {
  bureau: Bureau;
  /** As credenciais estão no servidor? */
  configurado(): boolean;
  consultar(p: PedidoCredito): Promise<RespostaConector>;
}

/** Conectores registrados. Vazio de propósito até haver contrato e credenciais. */
const CONECTORES: Partial<Record<Bureau, ConectorCredito>> = {};

/** Conector pronto para uso (registrado e com credenciais), ou null. */
export function conectorCredito(bureau: string): ConectorCredito | null {
  const c = CONECTORES[bureau as Bureau];
  return c && c.configurado() ? c : null;
}

export type SituacaoIntegracao = { bureau: Bureau; nome: string; ligado: boolean };

/** Situação de cada birô para a tela (o que já dá para consultar automaticamente). */
export function situacaoIntegracaoCredito(): SituacaoIntegracao[] {
  return (["serasa", "spc", "boa_vista", "quod"] as const).map((b) => ({ bureau: b, nome: ROTULO_BUREAU[b], ligado: conectorCredito(b) !== null }));
}
