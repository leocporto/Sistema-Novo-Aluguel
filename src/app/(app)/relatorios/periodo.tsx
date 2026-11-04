import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { FiltroAutomatico } from "@/components/filtro-automatico";
import { PilulasLink } from "@/components/pilulas-link";
import { Entrada, classeBotao } from "@/components/ui";
import { ROTULO_TIPO_PERIODO, TIPOS_PERIODO, lerPeriodo, refVizinha, type Periodo } from "@/lib/dominio/bi";
import { somarDias } from "@/lib/dominio/datas";

/**
 * Escolha do período dos relatórios: mês, trimestre, ano ou intervalo
 * (pílulas que mudam a URL) + ‹ › para andar, ou as duas datas do intervalo.
 * `extra` mantém os outros filtros da tela na URL.
 */
export function SeletorPeriodo({
  caminho,
  periodo,
  hoje,
  extra = {},
  comparar = true,
}: {
  caminho: string;
  periodo: Periodo;
  hoje: string;
  extra?: Record<string, string | undefined>;
  comparar?: boolean;
}) {
  const url = (q: string) => `${caminho}?${q}`;
  const extras = Object.entries(extra).filter((e): e is [string, string] => Boolean(e[1]));
  const comExtra = (q: URLSearchParams) => {
    for (const [k, v] of extras) q.set(k, v);
    return q.toString();
  };
  const hrefTipo = (t: (typeof TIPOS_PERIODO)[number]) =>
    url(comExtra(new URLSearchParams(t === "int" ? { p: "int", de: periodo.tipo === "int" ? periodo.inicio : somarDias(hoje, -29), ate: periodo.tipo === "int" ? periodo.fim : hoje } : { p: t })));
  const atual = lerPeriodo({ p: periodo.tipo }, hoje);
  const anterior = refVizinha(periodo, -1);
  const proximo = refVizinha(periodo, 1);
  const hrefRef = (ref: string) => url(comExtra(new URLSearchParams({ p: periodo.tipo, ref })));
  return (
    <div className="nao-imprimir mb-5 flex flex-wrap items-center gap-3">
      <PilulasLink rotulo="Tipo de período" ativo={hrefTipo(periodo.tipo)} itens={TIPOS_PERIODO.map((t) => ({ href: hrefTipo(t), rotulo: ROTULO_TIPO_PERIODO[t] }))} />
      {periodo.tipo === "int" ? (
        <FiltroAutomatico action={caminho} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="p" value="int" />
          {extras.map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v} />
          ))}
          <Entrada type="date" name="de" defaultValue={periodo.inicio} aria-label="Data inicial" className="max-w-44" />
          <span className="text-sm text-mudo">a</span>
          <Entrada type="date" name="ate" defaultValue={periodo.fim} aria-label="Data final" className="max-w-44" />
        </FiltroAutomatico>
      ) : (
        <div className="flex items-center gap-2">
          {anterior && (
            <Link href={hrefRef(anterior)} className={classeBotao("secundario")} aria-label="Período anterior" scroll={false}>
              <ChevronLeft className="size-4" />
            </Link>
          )}
          <div className="min-w-44 text-center text-[17px] font-semibold capitalize text-texto">{periodo.rotulo}</div>
          {proximo && (
            <Link href={hrefRef(proximo)} className={classeBotao("secundario")} aria-label="Próximo período" scroll={false}>
              <ChevronRight className="size-4" />
            </Link>
          )}
          {periodo.ref !== atual.ref && (
            <Link href={hrefRef(atual.ref)} className={classeBotao("fantasma", "sm")} scroll={false}>
              Voltar para o atual
            </Link>
          )}
        </div>
      )}
      {comparar && <span className="text-xs text-mudo">Comparando com {periodo.anterior.rotulo}</span>}
    </div>
  );
}

/** Texto do período para a impressão (o seletor some no papel). */
export function PeriodoImpresso({ periodo }: { periodo: Periodo }) {
  return <p className="hidden text-sm text-texto-2 print:block">Período: {periodo.rotulo}</p>;
}
