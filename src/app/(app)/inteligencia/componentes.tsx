import Link from "next/link";
import { Aviso, Selo } from "@/components/ui";
import { formatarDataBR } from "@/lib/dominio/datas";
import { formatarReais } from "@/lib/dominio/dinheiro";
import type { ResultadoConsulta } from "@/lib/dominio/ia";

/** Aviso do estado da IA (sem chave / desligada). As versões por regra continuam funcionando. */
export function AvisoIA({ configurada, ativa, podeConfigurar }: { configurada: boolean; ativa: boolean; podeConfigurar: boolean }) {
  if (!configurada)
    return (
      <Aviso tipo="alerta">
        <strong>IA não configurada (peça ao administrador para cadastrar a chave).</strong> Tudo o que funciona por regra continua aqui: prioridades, documentos pendentes, preço por
        comparáveis, riscos, inconsistências, automações e as respostas e descrições prontas.
      </Aviso>
    );
  if (!ativa)
    return (
      <Aviso tipo="alerta">
        A IA está desligada nesta conta: as telas usam só as regras.{" "}
        {podeConfigurar ? (
          <Link href="/inteligencia/configuracoes" className="font-semibold text-acento hover:underline">
            Ligar em Configurações da IA
          </Link>
        ) : (
          "Peça ao administrador para ligar em Configurações da IA."
        )}
      </Aviso>
    );
  return null;
}

/** Selo "feito com IA" × "feito por regra". */
export function SeloOrigem({ usouIA }: { usouIA: boolean }) {
  return usouIA ? <Selo cor="azul">Feito com IA — confira antes de usar</Selo> : <Selo cor="cinza">Feito por regra (sem IA)</Selo>;
}

function celula(v: unknown, tipo: string | undefined) {
  if (v === null || v === undefined || v === "") return "—";
  if (tipo === "moeda") return formatarReais(Number(v));
  if (tipo === "data") return formatarDataBR(String(v));
  if (tipo === "inteiro") return Number(v).toLocaleString("pt-BR");
  return String(v);
}

/** Tabela do resultado de uma consulta do assistente (resumo + linhas + fonte). */
export function TabelaConsulta({ r }: { r: ResultadoConsulta }) {
  return (
    <div className="space-y-3">
      {r.resumo.length > 0 && (
        <div className="flex flex-wrap gap-3">
          {r.resumo.map((i) => (
            <div key={i.rotulo} className="rounded-[14px] border border-borda bg-elev px-4 py-3">
              <div className="text-xs text-mudo">{i.rotulo}</div>
              <div className="text-[20px] font-semibold tabular-nums text-texto">{i.tipo === "moeda" ? formatarReais(i.valor) : i.valor.toLocaleString("pt-BR")}</div>
            </div>
          ))}
        </div>
      )}
      {r.linhas.length > 0 && (
        <div className="overflow-x-auto rounded-[14px] border border-borda">
          <table className="min-w-full border-collapse text-sm">
            <thead>
              <tr>
                {r.colunas.map((c) => (
                  <th key={c} className="whitespace-nowrap border-b border-borda bg-elev px-3 py-2 text-left font-mono text-[10.5px] font-semibold uppercase tracking-[0.12em] text-mudo">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {r.linhas.slice(0, 100).map((l, i) => (
                <tr key={i}>
                  {l.map((v, j) => (
                    <td key={j} className={`border-b border-borda-suave px-3 py-2 text-texto ${r.tipos[j] === "moeda" || r.tipos[j] === "inteiro" ? "text-right tabular-nums" : ""}`}>
                      {celula(v, r.tipos[j])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-mudo">De onde veio: {r.fonte}</p>
    </div>
  );
}
