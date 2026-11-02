/** Helpers para ler campos de FormData em Server Actions. */

export function texto(fd: FormData, campo: string): string | null {
  const v = fd.get(campo);
  if (v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

export function textoObrigatorio(fd: FormData, campo: string, rotulo = campo): string {
  const v = texto(fd, campo);
  if (!v) throw new ErroValidacao(`Informe ${rotulo}.`);
  return v;
}

/** Aceita "1.234,56", "1234,56" e "1234.56". */
export function numero(fd: FormData, campo: string): number | null {
  const v = texto(fd, campo);
  if (v === null) return null;
  const normal = v.includes(",") ? v.replace(/\./g, "").replace(",", ".") : v;
  const n = Number(normal);
  if (!Number.isFinite(n)) throw new ErroValidacao(`Valor inválido em ${campo}.`);
  return n;
}

export function inteiro(fd: FormData, campo: string): number | null {
  const n = numero(fd, campo);
  return n === null ? null : Math.trunc(n);
}

export function booleano(fd: FormData, campo: string): boolean {
  const v = fd.get(campo);
  return v === "on" || v === "true" || v === "1";
}

export function lista(fd: FormData, campo: string): string[] {
  return fd
    .getAll(campo)
    .map((v) => String(v).trim())
    .filter(Boolean);
}

export class ErroValidacao extends Error {}

export interface EstadoAcao {
  erro?: string;
  ok?: string;
}

/** Converte exceções em mensagem amigável para useActionState. */
export function mensagemErro(e: unknown): string {
  if (e instanceof ErroValidacao) return e.message;
  if (e && typeof e === "object" && "message" in e) {
    const msg = String((e as { message: string }).message);
    if (msg.includes("duplicate key")) return "Já existe um registro com esses dados.";
    if (msg.includes("violates foreign key")) return "Registro em uso por outro cadastro.";
    return msg;
  }
  return "Erro inesperado.";
}

/** Lança erro do Supabase, se houver. */
export function verificar<T>(r: { data: T; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message);
  return r.data;
}
