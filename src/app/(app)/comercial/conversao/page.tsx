import type { Metadata } from "next";
import { BarraProgresso } from "@/components/barra-progresso";
import { PilulasLink } from "@/components/pilulas-link";
import { Cabecalho, Cartao } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { FUNIS, ROTULO_FUNIL, conversaoPorEtapa, resumoPor, rotuloEtapa, textoHoras, type Funil, type LeadResumo } from "@/lib/dominio/crm";
import { somarDias, hojeISO } from "@/lib/dominio/datas";
import { ROTULO_ORIGEM_LEAD } from "@/lib/tipos";
import { AbasComercial } from "../campos";

export const metadata: Metadata = { title: "Conversão" };

const PERIODOS: Record<string, { rotulo: string; dias: number | null }> = {
  "30": { rotulo: "Últimos 30 dias", dias: 30 },
  "90": { rotulo: "Últimos 90 dias", dias: 90 },
  "365": { rotulo: "Últimos 12 meses", dias: 365 },
  tudo: { rotulo: "Desde o início", dias: null },
};

function TabelaResumo({ titulo, linhas, nome }: { titulo: string; linhas: ReturnType<typeof resumoPor>; nome: (k: string) => string }) {
  return (
    <Cartao titulo={titulo}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-0 text-sm">
          <thead>
            <tr className="text-left font-mono text-[10px] uppercase tracking-[0.12em] text-mudo">
              <th className="py-2 pr-2">Nome</th>
              <th className="px-2 py-2 text-right">Leads</th>
              <th className="px-2 py-2 text-right">Abertos</th>
              <th className="px-2 py-2 text-right">Fechados</th>
              <th className="px-2 py-2 text-right">Perdidos</th>
              <th className="px-2 py-2 text-right">Conversão</th>
              <th className="py-2 pl-2 text-right">1º atendimento</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-borda-suave">
            {linhas.map((l) => (
              <tr key={l.chave}>
                <td className="py-2 pr-2 font-medium text-texto">{nome(l.chave)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{l.total}</td>
                <td className="px-2 py-2 text-right tabular-nums">{l.abertos}</td>
                <td className="px-2 py-2 text-right tabular-nums text-ok">{l.ganhos}</td>
                <td className="px-2 py-2 text-right tabular-nums text-ruim">{l.perdidos}</td>
                <td className="px-2 py-2 text-right font-semibold tabular-nums">{l.conversao === null ? "—" : `${l.conversao}%`}</td>
                <td className="py-2 pl-2 text-right tabular-nums">{textoHoras(l.tempoMedioHoras)}</td>
              </tr>
            ))}
            {linhas.length === 0 && (
              <tr>
                <td colSpan={7} className="py-3 text-mudo">
                  Sem leads no período.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Cartao>
  );
}

export default async function ConversaoPage({ searchParams }: PageProps<"/comercial/conversao">) {
  const sp = await searchParams;
  const funil: Funil = (FUNIS as readonly string[]).includes(sp.funil as string) ? (sp.funil as Funil) : "locacao";
  const periodo = typeof sp.periodo === "string" && PERIODOS[sp.periodo] ? sp.periodo : "90";
  const { supabase } = await obterContexto();
  let q = supabase.from("leads").select("id, status, etapa_max, corretor_id, origem, funil, created_at, atendido_em, motivo_perda").eq("funil", funil).limit(10000);
  const dias = PERIODOS[periodo].dias;
  if (dias) q = q.gte("created_at", `${somarDias(hojeISO(), -dias)}T00:00:00-03:00`);
  const [{ data }, { data: corretores }] = await Promise.all([q, supabase.from("pessoas").select("id, nome").contains("papeis", ["corretor"])]);
  const leads = (data ?? []) as LeadResumo[];
  const etapas = conversaoPorEtapa(leads);
  const nomeCorretor = new Map((corretores ?? []).map((c) => [c.id as string, c.nome as string]));
  const motivos = Object.entries(
    leads.filter((l) => l.status === "perdido").reduce<Record<string, number>>((acc, l) => {
      const m = l.motivo_perda ?? "Sem motivo";
      acc[m] = (acc[m] ?? 0) + 1;
      return acc;
    }, {}),
  ).sort((a, b) => b[1] - a[1]);
  const perdidos = motivos.reduce((s, [, n]) => s + n, 0);
  const url = (f: string, p: string) => `/comercial/conversao?funil=${f}&periodo=${p}`;

  return (
    <>
      <Cabecalho titulo="Conversão" trilha="Comercial" descricao="Quantos leads avançam em cada etapa, por corretor e por origem, e por que os negócios são perdidos." />
      <AbasComercial />
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <PilulasLink rotulo="Funil" ativo={url(funil, periodo)} itens={FUNIS.map((x) => ({ href: url(x, periodo), rotulo: ROTULO_FUNIL[x] }))} />
        <PilulasLink rotulo="Período" ativo={url(funil, periodo)} itens={Object.entries(PERIODOS).map(([k, v]) => ({ href: url(funil, k), rotulo: v.rotulo }))} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <Cartao titulo={`Funil de ${ROTULO_FUNIL[funil].toLowerCase()} · ${leads.length} lead(s)`}>
          <ul className="space-y-4">
            {etapas.map((e, i) => (
              <li key={e.etapa}>
                <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2 text-sm">
                  <span className="font-medium text-texto">
                    {i + 1}. {rotuloEtapa(funil, e.etapa)}
                  </span>
                  <span className="tabular-nums text-texto-2">
                    <strong className="text-texto">{e.chegaram}</strong> lead(s) · {e.pctTotal}% do total
                    {i > 0 && <span className="text-mudo"> · {e.pctAnterior}% da etapa anterior</span>}
                  </span>
                </div>
                <BarraProgresso pct={e.pctTotal} atingida={e.etapa === "ganho"} />
              </li>
            ))}
          </ul>
        </Cartao>
        <Cartao titulo={`Motivos de perda (${perdidos})`}>
          <ul className="space-y-3">
            {motivos.map(([m, n]) => (
              <li key={m}>
                <div className="mb-1 flex justify-between gap-2 text-sm">
                  <span className="text-texto-2">{m}</span>
                  <span className="font-semibold tabular-nums text-texto">{n}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-elev">
                  <div className="h-full rounded-full bg-ruim" style={{ width: `${(n / perdidos) * 100}%` }} />
                </div>
              </li>
            ))}
            {motivos.length === 0 && <li className="text-sm text-mudo">Nenhum negócio perdido no período.</li>}
          </ul>
        </Cartao>
        <TabelaResumo titulo="Por corretor" linhas={resumoPor(leads, (l) => l.corretor_id)} nome={(k) => (k ? (nomeCorretor.get(k) ?? "Corretor removido") : "Sem corretor")} />
        <TabelaResumo titulo="Por origem" linhas={resumoPor(leads, (l) => l.origem)} nome={(k) => ROTULO_ORIGEM_LEAD[k] ?? k} />
      </div>
    </>
  );
}
