/** Regras puras da agenda: calendário, conflitos, horário de Brasília, .ics e chaves. */
import { diasNoMes, parseData, somarDias, type DataISO } from "./datas";

export const TIPOS_COMPROMISSO = ["visita", "avaliacao", "vistoria", "reuniao", "entrega_chaves", "lembrete", "outro"] as const;
export type TipoCompromisso = (typeof TIPOS_COMPROMISSO)[number];
export const ROTULO_TIPO_COMPROMISSO: Record<string, string> = {
  visita: "Visita",
  avaliacao: "Avaliação de captação",
  vistoria: "Vistoria",
  reuniao: "Reunião",
  entrega_chaves: "Entrega de chaves",
  lembrete: "Lembrete",
  outro: "Outro",
};
/** Tipos que só fazem sentido na imobiliária. */
export const TIPOS_SO_IMOBILIARIA = ["avaliacao"];

export const ROTULO_INTERESSE: Record<string, string> = { alto: "Gostou muito", medio: "Talvez", baixo: "Pouco interesse", nenhum: "Não gostou" };

const FUSO_MS = 3 * 60 * 60 * 1000; // Brasília (UTC-3, sem horário de verão)

/** Dia civil em Brasília de um instante ISO. */
export function diaLocal(iso: string): DataISO {
  return new Date(new Date(iso).getTime() - FUSO_MS).toISOString().slice(0, 10);
}
/** Hora "HH:MM" em Brasília. */
export function horaLocal(iso: string): string {
  return new Date(new Date(iso).getTime() - FUSO_MS).toISOString().slice(11, 16);
}
/** Instante ISO a partir de data e hora de Brasília. */
export function instante(data: DataISO, hora: string): string {
  return new Date(`${data}T${hora.length === 5 ? `${hora}:00` : hora}-03:00`).toISOString();
}
export function somarMinutos(iso: string, min: number): string {
  return new Date(new Date(iso).getTime() + min * 60_000).toISOString();
}

/** Dia da semana (0 = domingo) de uma data ISO. */
export const diaDaSemana = (d: DataISO) => parseData(d).getUTCDay();

/** Grade do mês em semanas (domingo a sábado), incluindo os dias de fora para completar. */
export function gradeMes(mes: DataISO): { data: DataISO; doMes: boolean }[][] {
  const inicio = `${mes.slice(0, 7)}-01`;
  const [a, m] = inicio.split("-").map(Number);
  const ultimo = `${mes.slice(0, 7)}-${String(diasNoMes(a, m)).padStart(2, "0")}`;
  let d = somarDias(inicio, -diaDaSemana(inicio));
  const fim = somarDias(ultimo, 6 - diaDaSemana(ultimo));
  const semanas: { data: DataISO; doMes: boolean }[][] = [];
  while (d <= fim) {
    const semana = Array.from({ length: 7 }, (_, i) => {
      const x = somarDias(d, i);
      return { data: x, doMes: x.slice(0, 7) === inicio.slice(0, 7) };
    });
    semanas.push(semana);
    d = somarDias(d, 7);
  }
  return semanas;
}

/** Os 7 dias (domingo a sábado) da semana que contém a data. */
export function gradeSemana(dia: DataISO): DataISO[] {
  const domingo = somarDias(dia, -diaDaSemana(dia));
  return Array.from({ length: 7 }, (_, i) => somarDias(domingo, i));
}

export type Compromisso = {
  id: string;
  data_hora: string;
  duracao_min: number;
  status: string;
  imovel_id?: string | null;
  corretor_id?: string | null;
};
export type Bloqueio = { imovel_id: string; inicio: string; fim: string; motivo: string | null };

const sobrepoe = (a1: number, a2: number, b1: number, b2: number) => a1 < b2 && b1 < a2;

/**
 * Conflitos de um novo compromisso: outro compromisso no mesmo imóvel ou com
 * o mesmo corretor no mesmo horário, ou imóvel indisponível nesse período.
 */
export function conflitos(novo: Compromisso, existentes: Compromisso[], bloqueios: Bloqueio[] = []): string[] {
  const i1 = new Date(novo.data_hora).getTime();
  const i2 = i1 + novo.duracao_min * 60_000;
  const avisos: string[] = [];
  for (const e of existentes) {
    if (e.id === novo.id || e.status === "cancelada") continue;
    const e1 = new Date(e.data_hora).getTime();
    if (!sobrepoe(i1, i2, e1, e1 + e.duracao_min * 60_000)) continue;
    if (novo.imovel_id && e.imovel_id === novo.imovel_id) avisos.push(`Já existe um compromisso neste imóvel às ${horaLocal(e.data_hora)}.`);
    else if (novo.corretor_id && e.corretor_id === novo.corretor_id) avisos.push(`O corretor já tem compromisso às ${horaLocal(e.data_hora)}.`);
  }
  for (const b of bloqueios) {
    if (novo.imovel_id !== b.imovel_id) continue;
    if (sobrepoe(i1, i2, new Date(b.inicio).getTime(), new Date(b.fim).getTime()))
      avisos.push(`O imóvel está indisponível para visitas nesse período${b.motivo ? ` (${b.motivo})` : ""}.`);
  }
  return [...new Set(avisos)];
}

// Calendário externo -----------------------------------------------------------
export type EventoCalendario = {
  id: string;
  titulo: string;
  inicio: string;
  duracao_min: number;
  local?: string | null;
  descricao?: string | null;
  lembrete_min?: number | null;
  cancelado?: boolean;
};

const icsData = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const icsTexto = (s: string) => s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/([,;])/g, "\\$1");

/** Quebra linhas longas do .ics (máx. 75 caracteres, continuação com espaço). */
function dobrar(linha: string) {
  const partes: string[] = [];
  let resto = linha;
  while (resto.length > 74) {
    partes.push(resto.slice(0, 74));
    resto = ` ${resto.slice(74)}`;
  }
  partes.push(resto);
  return partes.join("\r\n");
}

/** Arquivo .ics (iCalendar) com alarme — o celular avisa sozinho antes do compromisso. */
export function gerarICS(eventos: EventoCalendario[], nome = "Agenda", agora = new Date().toISOString()): string {
  const linhas = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Novo Aluguel//Agenda//PT-BR", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", `X-WR-CALNAME:${icsTexto(nome)}`, "X-WR-TIMEZONE:America/Sao_Paulo"];
  for (const e of eventos) {
    linhas.push(
      "BEGIN:VEVENT",
      `UID:${e.id}@novo-aluguel`,
      `DTSTAMP:${icsData(agora)}`,
      `DTSTART:${icsData(e.inicio)}`,
      `DTEND:${icsData(somarMinutos(e.inicio, e.duracao_min))}`,
      `SUMMARY:${icsTexto(e.titulo)}`,
    );
    if (e.local) linhas.push(`LOCATION:${icsTexto(e.local)}`);
    if (e.descricao) linhas.push(`DESCRIPTION:${icsTexto(e.descricao)}`);
    linhas.push(`STATUS:${e.cancelado ? "CANCELLED" : "CONFIRMED"}`);
    if (e.lembrete_min && e.lembrete_min > 0)
      linhas.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${icsTexto(e.titulo)}`, `TRIGGER:-PT${Math.round(e.lembrete_min)}M`, "END:VALARM");
    linhas.push("END:VEVENT");
  }
  linhas.push("END:VCALENDAR");
  return linhas.map(dobrar).join("\r\n") + "\r\n";
}

/** Link "Adicionar ao Google Agenda" de um compromisso. */
export function linkGoogleAgenda(e: EventoCalendario): string {
  const p = new URLSearchParams({
    action: "TEMPLATE",
    text: e.titulo,
    dates: `${icsData(e.inicio)}/${icsData(somarMinutos(e.inicio, e.duracao_min))}`,
    ctz: "America/Sao_Paulo",
  });
  if (e.local) p.set("location", e.local);
  if (e.descricao) p.set("details", e.descricao);
  return `https://calendar.google.com/calendar/render?${p.toString()}`;
}

// Chaves ---------------------------------------------------------------------
export type MovChave = { retirada_em: string; previsao_devolucao: string | null; devolvida_em: string | null };

/** Situação da chave: disponível, retirada ou atrasada (passou da previsão de devolução). */
export function situacaoChave<T extends MovChave>(movs: T[], agoraIso: string): { situacao: "disponivel" | "retirada" | "atrasada"; aberta: T | null } {
  const aberta = movs.find((m) => !m.devolvida_em) ?? null;
  if (!aberta) return { situacao: "disponivel", aberta: null };
  if (aberta.previsao_devolucao && aberta.previsao_devolucao < agoraIso) return { situacao: "atrasada", aberta };
  return { situacao: "retirada", aberta };
}

/** Próximo código de chave livre (CH-001, CH-002…). */
export function sugerirCodigoChave(codigos: (string | null)[]): string {
  const usados = new Set(codigos.filter(Boolean).map((c) => String(c).toUpperCase()));
  const nums = [...usados].map((c) => /^CH-(\d+)$/.exec(c)?.[1]).filter(Boolean).map(Number);
  let n = (nums.length ? Math.max(...nums) : 0) + 1;
  while (usados.has(`CH-${String(n).padStart(3, "0")}`)) n++;
  return `CH-${String(n).padStart(3, "0")}`;
}
