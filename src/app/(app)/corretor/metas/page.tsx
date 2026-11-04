import type { Metadata } from "next";
import { Contador } from "@/components/abas-segmentadas";
import { BarraProgresso } from "@/components/barra-progresso";
import { NavegadorMes, lerMes } from "@/components/navegador-mes";
import { Cartao } from "@/components/ui";
import { hojeISO } from "@/lib/dominio/datas";
import { formatarReais } from "@/lib/dominio/dinheiro";
import { progressoMeta } from "@/lib/dominio/painel";
import { ROTULO_META, TIPOS_META, type TipoMeta } from "@/lib/tipos";
import { contextoCorretor, portalCorretor, semVinculo } from "../dados";
import { AvisoSemVinculo, TopoCorretor } from "../topo";

export const metadata: Metadata = { title: "Minhas metas" };

type Metas = { mes: string; metas: Partial<Record<TipoMeta, number>>; meu: Record<TipoMeta, number>; equipe: Record<TipoMeta, number>; comissoes: number; corretores: number };

/** Mesma conta do Comercial → Metas, só com os negócios do corretor. */
const DICA: Record<TipoMeta, string> = {
  locacoes: "contratos que começaram no mês em imóveis seus ou com proposta sua",
  vendas: "imóveis vendidos no mês com você",
  captacoes: "imóveis captados no mês com você como corretor",
  leads: "leads que chegaram no mês para você",
  faturamento: "receitas recebidas no mês dos seus negócios",
};

/** Metas do mês da imobiliária e quanto o corretor fez de cada uma. */
export default async function MetasCorretorPage({ searchParams }: PageProps<"/corretor/metas">) {
  const sp = await searchParams;
  const ctx = await contextoCorretor(sp);
  const hoje = hojeISO();
  const mes = lerMes(sp.mes, hoje);
  const d = await portalCorretor<Metas>(ctx.supabase, "metas", ctx.escolhido, { mes });
  return (
    <>
      <TopoCorretor ctx={ctx} titulo="Metas" descricao="Metas do mês da imobiliária e a sua parte em cada uma. As metas são definidas no Comercial → Metas." />
      {semVinculo(d) ? (
        <AvisoSemVinculo ctx={ctx} />
      ) : (
        <>
          <div className="mb-5">
            <NavegadorMes caminho="/corretor/metas" mes={mes} hoje={hoje} extra={{ corretor: ctx.escolhido ?? undefined }} />
          </div>
          <Cartao titulo="Você no mês">
            <ul className="space-y-5">
              {TIPOS_META.map((t) => {
                const meta = d.metas[t];
                const feito = Number(d.meu[t] ?? 0);
                const equipe = Number(d.equipe?.[t] ?? 0);
                const prog = progressoMeta(feito, meta);
                const fmt = (v: number) => (t === "faturamento" ? formatarReais(v) : String(v));
                return (
                  <li key={t} className="grid items-center gap-3 md:grid-cols-[260px_1fr]">
                    <div>
                      <div className="font-medium text-texto">{ROTULO_META[t]}</div>
                      <div className="text-xs text-mudo">
                        você: {fmt(feito)} de {fmt(equipe)} da equipe · {DICA[t]}
                      </div>
                    </div>
                    {prog && meta != null ? (
                      <div className="flex items-center gap-3">
                        <BarraProgresso pct={prog.pct} atingida={prog.atingida} />
                        <span className="w-48 text-right text-sm tabular-nums text-texto-2">
                          {prog.pct}% da meta da equipe ({fmt(Number(meta))})
                        </span>
                      </div>
                    ) : (
                      <span className="text-xs text-fraco">Sem meta definida para este mês.</span>
                    )}
                  </li>
                );
              })}
            </ul>
            <p className="mt-4 text-xs text-mudo">
              {d.corretores > 1 ? `A meta é da imobiliária toda (${d.corretores} corretores); a barra mostra quanto dela veio de você. ` : ""}
              O total da equipe é a mesma conta do Comercial → Metas.
            </p>
          </Cartao>
          <Cartao titulo="Suas comissões no mês" className="mt-5">
            <p className="text-[22px] font-semibold tabular-nums text-texto">
              <Contador valor={Number(d.comissoes ?? 0)} formato="moeda" />
            </p>
            <p className="mt-1 text-xs text-mudo">Comissões liberadas ou pagas no mês. É o que você ganha — não entra na meta de faturamento, que é a receita da imobiliária.</p>
          </Cartao>
        </>
      )}
    </>
  );
}
