import { type DataISO, diasEntre, formatarCompetencia, formatarDataBR, somarDias } from "./datas";
import { formatarReais } from "./dinheiro";

export interface RegraRegua {
  id: string;
  /** Dias em relação ao vencimento: negativo = antes, 0 = no dia, positivo = depois. */
  diasRelativos: number;
  ativo: boolean;
}

export interface FaturaRegua {
  id: string;
  vencimento: DataISO;
  status: string;
}

/** Quantos dias de atraso no disparo ainda são tolerados (ex.: sistema fora do ar). */
export const JANELA_RECUPERACAO_DIAS = 3;

/**
 * Lista os envios da régua de cobrança devidos em `hoje`: para cada fatura em
 * aberto e regra ativa cuja data-alvo (vencimento + dias) já chegou, dentro da
 * janela de recuperação, e que ainda não foi enviada.
 */
export function enviosDevidos(
  regras: RegraRegua[],
  faturas: FaturaRegua[],
  hoje: DataISO,
  jaEnviados: Set<string>,
): { regraId: string; faturaId: string; dataAlvo: DataISO }[] {
  const out: { regraId: string; faturaId: string; dataAlvo: DataISO }[] = [];
  for (const f of faturas) {
    if (f.status !== "aberta") continue;
    for (const r of regras) {
      if (!r.ativo) continue;
      const alvo = somarDias(f.vencimento, r.diasRelativos);
      const atraso = diasEntre(alvo, hoje);
      if (atraso < 0 || atraso > JANELA_RECUPERACAO_DIAS) continue;
      if (jaEnviados.has(`${r.id}:${f.id}`)) continue;
      out.push({ regraId: r.id, faturaId: f.id, dataAlvo: alvo });
    }
  }
  return out;
}

export interface VariaveisMensagem {
  nome: string;
  /** Valor a pagar (R$), já com multa e juros quando em atraso. */
  valor: number;
  vencimento: DataISO;
  competencia: DataISO;
  imovel: string;
  link?: string;
  /** Saldo do aluguel sem encargos (R$). */
  saldo?: number;
  multa?: number;
  juros?: number;
  /** Dias de atraso (ou 0). */
  dias?: number;
  /** Pix copia e cola. */
  pix?: string;
}

/** Substitui {{variavel}} no modelo da mensagem. */
export function renderizarMensagem(modelo: string, v: VariaveisMensagem): string {
  const mapa: Record<string, string> = {
    nome: v.nome,
    valor: formatarReais(v.valor),
    vencimento: formatarDataBR(v.vencimento),
    competencia: formatarCompetencia(v.competencia),
    imovel: v.imovel,
    link: v.link ?? "",
    saldo: formatarReais(v.saldo ?? v.valor),
    multa: formatarReais(v.multa ?? 0),
    juros: formatarReais(v.juros ?? 0),
    dias: String(v.dias ?? 0),
    pix: v.pix ?? "",
  };
  return modelo.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k: string) => mapa[k] ?? m);
}
