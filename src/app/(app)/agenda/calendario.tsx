import Link from "next/link";
import { Selo } from "@/components/ui";
import { ROTULO_TIPO_COMPROMISSO, diaLocal, horaLocal } from "@/lib/dominio/agenda";
import { COR_TIPO, clienteDo, tituloDo, type CompromissoTela } from "./dados";

export const SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

export function Chip({ v, compacto = false }: { v: CompromissoTela; compacto?: boolean }) {
  const cancel = v.status === "cancelada";
  return (
    <Link
      href={`/agenda/${v.id}`}
      title={tituloDo(v)}
      className={`block truncate rounded-[8px] border px-1.5 py-0.5 text-[11.5px] font-medium transition hover:-translate-y-px ${COR_TIPO[v.tipo] ?? COR_TIPO.outro} ${cancel ? "line-through opacity-50" : ""}`}
    >
      <span className="tabular-nums">{horaLocal(v.data_hora)}</span>
      {!compacto && <> {tituloDo(v)}</>}
    </Link>
  );
}

export function Linha({ v, hoje }: { v: CompromissoTela; hoje: string }) {
  const c = clienteDo(v);
  const semRetorno = v.tipo === "visita" && v.status !== "cancelada" && diaLocal(v.data_hora) < hoje && !v.feedback_interesse;
  return (
    <Link href={`/agenda/${v.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 transition hover:bg-elev">
      <div className="w-24 shrink-0">
        <div className="text-[17px] font-semibold tabular-nums text-texto">{horaLocal(v.data_hora)}</div>
        <div className="text-xs text-mudo">{v.duracao_min} min</div>
      </div>
      <div className="min-w-0 flex-1">
        <div className={`truncate font-medium text-texto ${v.status === "cancelada" ? "line-through opacity-60" : ""}`}>{tituloDo(v)}</div>
        <div className="truncate text-xs text-texto-2">
          {[ROTULO_TIPO_COMPROMISSO[v.tipo], c?.nome, v.imovel?.codigo, v.corretor ? `com ${v.corretor.nome}` : null, v.modalidade === "virtual" ? "virtual" : null].filter(Boolean).join(" · ")}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {v.status === "agendada" && (v.cliente_confirmado_em ? <Selo cor="verde">confirmada</Selo> : <Selo cor="amarelo">a confirmar</Selo>)}
        {v.status === "realizada" && <Selo cor="verde">realizada</Selo>}
        {v.status === "cancelada" && <Selo>cancelada</Selo>}
        {semRetorno && <Selo cor="vermelho">sem retorno</Selo>}
      </div>
    </Link>
  );
}

/** Calendário do mês: até 3 compromissos por dia e "+N mais". */
export function CalendarioMes({
  grade,
  porDia,
  hoje,
  urlDia,
}: {
  grade: { data: string; doMes: boolean }[][];
  porDia: Map<string, CompromissoTela[]>;
  hoje: string;
  urlDia: (d: string) => string;
}) {
  return (

        <div className="entrar overflow-x-auto rounded-card border border-borda bg-card">
          <div className="grid min-w-[760px] grid-cols-7 border-b border-borda">
            {SEMANA.map((d) => (
              <div key={d} className="px-2 py-2 text-center font-mono text-[10px] uppercase tracking-[0.12em] text-mudo">
                {d}
              </div>
            ))}
          </div>
          <div className="grid min-w-[760px] grid-cols-7">
            {grade.flat().map(({ data: d, doMes }) => {
              const itens = porDia.get(d) ?? [];
              return (
                <div key={d} className={`min-h-28 border-b border-r border-borda-suave p-1.5 ${doMes ? "" : "bg-app/60"}`}>
                  <Link
                    href={urlDia(d)}
                    className={`mb-1 inline-grid size-7 place-items-center rounded-full text-[13px] font-semibold transition hover:bg-elev ${d === hoje ? "bg-acento text-white hover:bg-acento-hot" : doMes ? "text-texto" : "text-fraco"}`}
                  >
                    {Number(d.slice(8))}
                  </Link>
                  <div className="space-y-1">
                    {itens.slice(0, 3).map((v) => (
                      <Chip key={v.id} v={v} />
                    ))}
                    {itens.length > 3 && (
                      <Link href={urlDia(d)} className="block px-1 text-[11px] font-medium text-acento hover:underline">
                        +{itens.length - 3} mais
                      </Link>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      
  );
}
