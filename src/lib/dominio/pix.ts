/**
 * Pix "copia e cola" estático (BR Code, padrão EMV do Banco Central), gerado
 * no próprio sistema — sem banco, sem integração. Serve para qualquer chave
 * Pix (CPF, CNPJ, e-mail, celular ou aleatória) e pode levar o valor e um
 * identificador (txid) que aparece no extrato de quem recebe.
 */
import type { Centavos } from "./dinheiro";
import { validarCNPJ, validarCPF } from "./documentos";

export type TipoChavePix = "cpf" | "cnpj" | "email" | "telefone" | "aleatoria";

export const ROTULO_TIPO_CHAVE: Record<TipoChavePix, string> = {
  cpf: "CPF",
  cnpj: "CNPJ",
  email: "E-mail",
  telefone: "Celular",
  aleatoria: "Chave aleatória",
};

/** CRC16-CCITT (polinômio 0x1021, valor inicial 0xFFFF), em 4 dígitos hexadecimais. */
export function crc16(texto: string): string {
  let crc = 0xffff;
  for (const byte of new TextEncoder().encode(texto)) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

/** Tira acentos e caracteres fora do padrão e corta no tamanho máximo. */
export function textoPix(s: string | null | undefined, max: number): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9 .,\-/@]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
    .trim();
}

/** Descobre o tipo da chave e devolve no formato que o Pix espera (null = inválida). */
export function normalizarChavePix(chave: string | null | undefined): { tipo: TipoChavePix; chave: string } | null {
  const s = (chave ?? "").trim();
  if (!s) return null;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) return { tipo: "aleatoria", chave: s.toLowerCase() };
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return s.length <= 77 ? { tipo: "email", chave: s.toLowerCase() } : null;
  const d = s.replace(/\D/g, "");
  if (s.startsWith("+")) return d.length >= 12 && d.length <= 13 ? { tipo: "telefone", chave: `+${d}` } : null;
  if (d.length === 14 && validarCNPJ(d)) return { tipo: "cnpj", chave: d };
  // CPF formatado (000.000.000-00) ou 11 dígitos que formam um CPF válido.
  if (d.length === 11 && (/^\d{3}\.\d{3}\.\d{3}-\d{2}$/.test(s) || validarCPF(d))) return { tipo: "cpf", chave: d };
  if (d.length === 10 || d.length === 11) return { tipo: "telefone", chave: `+55${d}` };
  if ((d.length === 12 || d.length === 13) && d.startsWith("55")) return { tipo: "telefone", chave: `+${d}` };
  return null;
}

/** Identificador da cobrança (txid): só letras e números, até 25. */
export function txidPix(s: string | null | undefined): string {
  const t = (s ?? "").replace(/[^A-Za-z0-9]/g, "").slice(0, 25);
  return t || "***";
}

function campo(id: string, valor: string): string {
  if (valor.length > 99) throw new Error(`Campo ${id} do Pix muito longo.`);
  return `${id}${String(valor.length).padStart(2, "0")}${valor}`;
}

export interface DadosPix {
  chave: string;
  /** Nome de quem recebe (até 25 letras, sem acento). */
  nome: string;
  /** Cidade de quem recebe (até 15 letras, sem acento). */
  cidade?: string | null;
  /** Valor em centavos; vazio = quem paga digita. */
  valor?: Centavos | null;
  /** Identificador que volta no extrato (ex.: FAT123). */
  txid?: string | null;
  /** Texto curto que aparece para quem paga (opcional). */
  descricao?: string | null;
}

/**
 * Monta o "Pix copia e cola". Lança erro se a chave for inválida.
 * Formato: 00 versão · 26 conta (GUI br.gov.bcb.pix + chave + descrição) ·
 * 52 categoria · 53 moeda (986) · 54 valor · 58 país · 59 nome · 60 cidade ·
 * 62 txid · 63 CRC16.
 */
export function gerarPixCopiaCola(d: DadosPix): string {
  const ch = normalizarChavePix(d.chave);
  if (!ch) throw new Error("Chave Pix inválida.");
  const nome = textoPix(d.nome, 25) || "RECEBEDOR";
  const cidade = textoPix(d.cidade, 15) || "BRASIL";
  let conta = campo("00", "br.gov.bcb.pix") + campo("01", ch.chave);
  const desc = textoPix(d.descricao, 99 - conta.length - 4);
  if (desc) conta += campo("02", desc);
  let payload =
    campo("00", "01") +
    campo("26", conta) +
    campo("52", "0000") +
    campo("53", "986") +
    (d.valor && d.valor > 0 ? campo("54", (d.valor / 100).toFixed(2)) : "") +
    campo("58", "BR") +
    campo("59", nome) +
    campo("60", cidade) +
    campo("62", campo("05", txidPix(d.txid)));
  payload += "6304";
  return payload + crc16(payload);
}

/** Lê os campos de um "copia e cola" (para conferir) e valida o CRC. */
export function lerPixCopiaCola(codigo: string): { valido: boolean; campos: Record<string, string> } {
  const campos: Record<string, string> = {};
  let i = 0;
  while (i + 4 <= codigo.length) {
    const id = codigo.slice(i, i + 2);
    const tam = Number(codigo.slice(i + 2, i + 4));
    if (!Number.isFinite(tam)) break;
    campos[id] = codigo.slice(i + 4, i + 4 + tam);
    i += 4 + tam;
  }
  const valido = codigo.length > 8 && crc16(codigo.slice(0, -4)) === codigo.slice(-4).toUpperCase() && i === codigo.length;
  return { valido, campos };
}
