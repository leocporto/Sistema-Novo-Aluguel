import { formatarReais } from "@/lib/dominio/dinheiro";

const ABREV = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

function curto(v: number) {
  if (v >= 1_000_000) return `${(v / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi`;
  if (v >= 1_000) return `${(v / 1_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`;
  return v.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
}

/**
 * Barras dos últimos meses (azul) com o mesmo mês do ano anterior por trás
 * (cinza). Passe o mouse numa barra para ver os valores.
 */
export function GraficoComparativo({ meses, atual, anterior }: { meses: string[]; atual: number[]; anterior: number[] }) {
  const max = Math.max(1, ...atual, ...anterior);
  const passo = 100 / meses.length;
  const marcas = [0, 0.5, 1].map((f) => f * max);
  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-4 text-xs text-texto-2">
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-acento" /> Este período
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-borda-forte" /> Ano anterior
        </span>
      </div>
      <div className="relative h-52 pl-12">
        {marcas.map((m) => (
          <div key={m} className="absolute left-0 right-0 border-t border-dashed border-borda-suave" style={{ bottom: `${(m / max) * 100}%` }}>
            <span className="absolute -top-2 left-0 w-10 text-right text-[10px] tabular-nums text-fraco">{curto(m)}</span>
          </div>
        ))}
        <div className="mv-bars relative flex h-full items-end">
          {meses.map((mes, i) => {
            const [ano, m] = mes.split("-");
            return (
              <div
                key={mes}
                className="group relative flex h-full flex-col justify-end px-[3px]"
                style={{ width: `${passo}%` }}
                title={`${ABREV[Number(m) - 1]}/${ano}: ${formatarReais(atual[i])}\n${ABREV[Number(m) - 1]}/${Number(ano) - 1}: ${formatarReais(anterior[i])}`}
              >
                <div className="relative flex h-full items-end justify-center gap-[2px]">
                  <div className="w-[38%] max-w-4 rounded-t-[4px] bg-borda-forte" style={{ height: `${(anterior[i] / max) * 100}%` }} />
                  <div
                    className="mv-col w-[46%] max-w-5 rounded-t-[5px] bg-acento transition group-hover:bg-acento-hot"
                    style={{ height: `${(atual[i] / max) * 100}%`, ["--i" as string]: i }}
                  />
                </div>
                <span className="absolute -bottom-5 left-0 right-0 text-center text-[10.5px] capitalize text-mudo">{ABREV[Number(m) - 1]}</span>
              </div>
            );
          })}
        </div>
      </div>
      <div className="h-5" />
    </div>
  );
}
