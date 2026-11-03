/**
 * Datas são trafegadas como strings ISO "AAAA-MM-DD" e manipuladas em UTC,
 * para que o fuso horário do servidor nunca desloque um vencimento.
 */

export type DataISO = string;

export function parseData(d: DataISO): Date {
  const [a, m, dia] = d.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, dia));
}

export function formatarISO(d: Date): DataISO {
  return d.toISOString().slice(0, 10);
}

export function hojeISO(agora: Date = new Date()): DataISO {
  // Data civil em Brasília (UTC-3), independente do fuso do servidor.
  const brasilia = new Date(agora.getTime() - 3 * 60 * 60 * 1000);
  return formatarISO(brasilia);
}

export function diasNoMes(ano: number, mes1a12: number): number {
  return new Date(Date.UTC(ano, mes1a12, 0)).getUTCDate();
}

/** Primeiro dia do mês da data informada. */
export function inicioDoMes(d: DataISO): DataISO {
  return `${d.slice(0, 7)}-01`;
}

export function fimDoMes(d: DataISO): DataISO {
  const dt = parseData(d);
  const ultimo = diasNoMes(dt.getUTCFullYear(), dt.getUTCMonth() + 1);
  return `${d.slice(0, 7)}-${String(ultimo).padStart(2, "0")}`;
}

/**
 * Soma meses mantendo o dia; se o dia não existir no mês de destino
 * (ex.: 31/01 + 1 mês), usa o último dia do mês.
 */
export function somarMeses(d: DataISO, meses: number): DataISO {
  const dt = parseData(d);
  const ano = dt.getUTCFullYear();
  const mes = dt.getUTCMonth() + meses;
  const alvoAno = ano + Math.floor(mes / 12);
  const alvoMes = ((mes % 12) + 12) % 12;
  const dia = Math.min(dt.getUTCDate(), diasNoMes(alvoAno, alvoMes + 1));
  return formatarISO(new Date(Date.UTC(alvoAno, alvoMes, dia)));
}

export function somarDias(d: DataISO, dias: number): DataISO {
  const dt = parseData(d);
  dt.setUTCDate(dt.getUTCDate() + dias);
  return formatarISO(dt);
}

/** Diferença em dias corridos (b - a). */
export function diasEntre(a: DataISO, b: DataISO): number {
  return Math.round((parseData(b).getTime() - parseData(a).getTime()) / 86_400_000);
}

/** Data com o dia indicado no mês de referência (limitado ao último dia do mês). */
export function diaNoMes(competencia: DataISO, dia: number): DataISO {
  const dt = parseData(competencia);
  const ano = dt.getUTCFullYear();
  const mes = dt.getUTCMonth() + 1;
  const d = Math.min(Math.max(1, dia), diasNoMes(ano, mes));
  return `${competencia.slice(0, 7)}-${String(d).padStart(2, "0")}`;
}

/** Número de meses completos entre duas datas (b >= a). */
export function mesesEntre(a: DataISO, b: DataISO): number {
  const da = parseData(a);
  const db = parseData(b);
  let meses = (db.getUTCFullYear() - da.getUTCFullYear()) * 12 + (db.getUTCMonth() - da.getUTCMonth());
  if (db.getUTCDate() < da.getUTCDate()) meses -= 1;
  return Math.max(0, meses);
}

export function formatarDataBR(d: DataISO | null | undefined): string {
  if (!d) return "—";
  const [a, m, dia] = d.slice(0, 10).split("-");
  return `${dia}/${m}/${a}`;
}

export function formatarCompetencia(d: DataISO | null | undefined): string {
  if (!d) return "—";
  const [a, m] = d.slice(0, 7).split("-");
  return `${m}/${a}`;
}

/** Instante atual em milissegundos (isolado para manter os componentes puros). */
export function agoraMs(): number {
  return Date.now();
}
