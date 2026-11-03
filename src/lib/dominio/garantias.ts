/** Garantias locatícias: rótulos e alertas de vencimento. */
import { somarDias, type DataISO } from "./datas";

export const TIPOS_GARANTIA = ["fiador", "caucao", "seguro_fianca", "titulo_capitalizacao", "carta_fianca", "outro"] as const;
export const ROTULO_TIPO_GARANTIA: Record<string, string> = {
  fiador: "Fiador",
  caucao: "Caução (depósito)",
  seguro_fianca: "Seguro-fiança",
  titulo_capitalizacao: "Título de capitalização",
  carta_fianca: "Carta-fiança bancária",
  outro: "Outra",
};
export const ROTULO_STATUS_GARANTIA: Record<string, string> = {
  ativa: "Ativa",
  vencida: "Vencida",
  devolvida: "Devolvida",
  executada: "Executada",
  encerrada: "Encerrada",
};

export type GarantiaAlerta = { tipo: string; fim: string | null; status: string };

/** Situação da garantia ativa: vencida, vence em até 30 dias ou em dia. */
export function situacaoGarantia(g: GarantiaAlerta, hoje: DataISO): "vencida" | "vencendo" | "ok" | "inativa" {
  if (g.status !== "ativa") return "inativa";
  if (!g.fim) return "ok";
  if (g.fim < hoje) return "vencida";
  if (g.fim <= somarDias(hoje, 30)) return "vencendo";
  return "ok";
}
