import type { Metadata } from "next";
import { Formulario } from "@/components/formulario";
import { BarraProgresso } from "@/components/barra-progresso";
import { NavegadorMes, lerMes } from "@/components/navegador-mes";
import { Cabecalho, Cartao, Entrada } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { hojeISO } from "@/lib/dominio/datas";
import { formatarReais } from "@/lib/dominio/dinheiro";
import { progressoMeta } from "@/lib/dominio/painel";
import { realizadoDoMes } from "@/lib/servicos/indicadores";
import { ROTULO_META, TIPOS_META, type TipoMeta } from "@/lib/tipos";
import { salvarMetas } from "../actions";
import { AbasComercial } from "../campos";

export const metadata: Metadata = { title: "Metas" };

export default async function MetasPage({ searchParams }: PageProps<"/comercial/metas">) {
  const sp = await searchParams;
  const hoje = hojeISO();
  const mes = lerMes(sp.mes, hoje);
  const { supabase, organizacao } = await obterContexto();
  const pessoal = organizacao.modo === "pessoal";
  const tipos = TIPOS_META.filter((t) => !(pessoal && t === "vendas"));
  const [{ data }, realizado] = await Promise.all([
    supabase.from("metas").select("tipo, valor").eq("competencia", `${mes}-01`),
    realizadoDoMes(supabase, mes),
  ]);
  const metas = Object.fromEntries((data ?? []).map((m) => [m.tipo, Number(m.valor)])) as Partial<Record<TipoMeta, number>>;
  const fmt = (t: TipoMeta, v: number) => (t === "faturamento" ? formatarReais(v) : String(v));

  return (
    <>
      <Cabecalho titulo="Metas" trilha="Comercial" descricao="Defina as metas do mês. O realizado é calculado sozinho e aparece no Painel." />
      <AbasComercial />
      <div className="mb-5">
        <NavegadorMes caminho="/comercial/metas" mes={mes} hoje={hoje} />
      </div>
      <Formulario key={mes} acao={salvarMetas} automatico>
        <input type="hidden" name="mes" value={mes} />
        <Cartao titulo="Metas do mês">
          <ul className="space-y-5">
            {tipos.map((t) => {
              const prog = progressoMeta(realizado[t], metas[t]);
              return (
                <li key={t} className="grid items-center gap-3 md:grid-cols-[220px_160px_1fr]">
                  <div>
                    <div className="font-medium text-texto">{ROTULO_META[t]}</div>
                    <div className="text-xs text-mudo">realizado: {fmt(t, realizado[t])}</div>
                  </div>
                  <Entrada
                    name={t}
                    inputMode="decimal"
                    placeholder="sem meta"
                    aria-label={`Meta de ${ROTULO_META[t]}`}
                    defaultValue={metas[t] === undefined ? "" : String(metas[t])}
                  />
                  {prog ? (
                    <div className="flex items-center gap-3">
                      <BarraProgresso pct={prog.pct} atingida={prog.atingida} />
                      <span className={`w-16 text-right text-sm font-semibold tabular-nums ${prog.atingida ? "text-ok" : "text-texto-2"}`}>{prog.pct}%</span>
                    </div>
                  ) : (
                    <span className="text-xs text-fraco">Digite um número para acompanhar.</span>
                  )}
                </li>
              );
            })}
          </ul>
        </Cartao>
      </Formulario>
    </>
  );
}
