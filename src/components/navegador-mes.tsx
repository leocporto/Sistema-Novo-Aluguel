import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { classeBotao } from "./ui";
import { somarMeses } from "@/lib/dominio/datas";

export const NOMES_MES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

/** Lê `?mes=AAAA-MM` (ou o mês atual). */
export function lerMes(valor: string | string[] | undefined, hoje: string): string {
  return typeof valor === "string" && /^\d{4}-\d{2}$/.test(valor) ? valor : hoje.slice(0, 7);
}

/** ‹ novembro de 2026 › — navegação por mês, mantendo os outros filtros da URL. */
export function NavegadorMes({
  caminho,
  mes,
  hoje,
  extra = {},
}: {
  caminho: string;
  mes: string;
  hoje: string;
  extra?: Record<string, string | undefined>;
}) {
  const [ano, m] = mes.split("-").map(Number);
  const anterior = somarMeses(`${mes}-01`, -1).slice(0, 7);
  const proximo = somarMeses(`${mes}-01`, 1).slice(0, 7);
  const url = (alvo?: string) => {
    const q = new URLSearchParams();
    if (alvo) q.set("mes", alvo);
    for (const [k, v] of Object.entries(extra)) if (v) q.set(k, v);
    const s = q.toString();
    return s ? `${caminho}?${s}` : caminho;
  };
  return (
    <div className="flex items-center gap-2">
      <Link href={url(anterior)} className={classeBotao("secundario")} aria-label="Mês anterior">
        <ChevronLeft className="size-4" />
      </Link>
      <div className="min-w-44 text-center text-[17px] font-semibold capitalize text-texto">
        {NOMES_MES[m - 1]} de {ano}
      </div>
      <Link href={url(proximo)} className={classeBotao("secundario")} aria-label="Próximo mês">
        <ChevronRight className="size-4" />
      </Link>
      {mes !== hoje.slice(0, 7) && (
        <Link href={url()} className={classeBotao("fantasma", "sm")}>
          Voltar para este mês
        </Link>
      )}
    </div>
  );
}
