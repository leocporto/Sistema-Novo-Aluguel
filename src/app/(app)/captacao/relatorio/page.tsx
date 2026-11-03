import type { Metadata } from "next";
import { BarraProgresso } from "@/components/barra-progresso";
import { PilulasLink } from "@/components/pilulas-link";
import { Cabecalho, Cartao } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { ORIGENS_CAPTACAO, ROTULO_ETAPA_CAPTACAO, funilCaptacao, resumoCaptacoes, type CaptacaoResumo } from "@/lib/dominio/captacao";
import { fimDoMes, hojeISO, inicioDoMes, somarDias, somarMeses } from "@/lib/dominio/datas";
import { NOMES_MES } from "@/components/navegador-mes";
import { AbasCaptacao } from "../campos";
import { carregarCorretores } from "../dados";

export const metadata: Metadata = { title: "Desempenho da captação" };

const PERIODOS: Record<string, { rotulo: string; dias: number | null }> = {
  "30": { rotulo: "Últimos 30 dias", dias: 30 },
  "90": { rotulo: "Últimos 90 dias", dias: 90 },
  "365": { rotulo: "Últimos 12 meses", dias: 365 },
  tudo: { rotulo: "Desde o início", dias: null },
};

function Tabela({ titulo, linhas, nome }: { titulo: string; linhas: ReturnType<typeof resumoCaptacoes>; nome: (k: string) => string }) {
  return (
    <Cartao titulo={titulo}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-0 text-sm">
          <thead>
            <tr className="text-left font-mono text-[10px] uppercase tracking-[0.12em] text-mudo">
              <th className="py-2 pr-2">Nome</th>
              <th className="px-2 py-2 text-right">Oportunidades</th>
              <th className="px-2 py-2 text-right">Em aberto</th>
              <th className="px-2 py-2 text-right">Captados</th>
              <th className="px-2 py-2 text-right">Exclusivos</th>
              <th className="px-2 py-2 text-right">Não captados</th>
              <th className="py-2 pl-2 text-right">Taxa</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-borda-suave">
            {linhas.map((l) => (
              <tr key={l.chave}>
                <td className="py-2 pr-2 font-medium text-texto">{nome(l.chave)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{l.total}</td>
                <td className="px-2 py-2 text-right tabular-nums">{l.abertos}</td>
                <td className="px-2 py-2 text-right tabular-nums text-ok">{l.captados}</td>
                <td className="px-2 py-2 text-right tabular-nums">{l.exclusivos}</td>
                <td className="px-2 py-2 text-right tabular-nums text-ruim">{l.naoCaptados}</td>
                <td className="py-2 pl-2 text-right font-semibold tabular-nums">{l.taxa === null ? "—" : `${l.taxa}%`}</td>
              </tr>
            ))}
            {linhas.length === 0 && (
              <tr>
                <td colSpan={7} className="py-3 text-mudo">
                  Nenhuma captação no período.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Cartao>
  );
}

export default async function RelatorioCaptacao({ searchParams }: PageProps<"/captacao/relatorio">) {
  const sp = await searchParams;
  const per = typeof sp.periodo === "string" && PERIODOS[sp.periodo] ? sp.periodo : "90";
  const { supabase } = await obterContexto();
  const hoje = hojeISO();
  const desde = PERIODOS[per].dias ? somarDias(hoje, -PERIODOS[per].dias!) : null;
  const ini6 = inicioDoMes(somarMeses(hoje, -5));

  let q = supabase.from("captacoes").select("status, etapa_max, corretor_id, origem, exclusivo, motivo_nao_captado");
  if (desde) q = q.gte("created_at", `${desde}T00:00:00-03:00`);
  const [{ data }, corretores, { data: imoveis }, { data: metas }] = await Promise.all([
    q,
    carregarCorretores(supabase),
    supabase.from("imoveis").select("captado_em").gte("captado_em", ini6),
    supabase.from("metas").select("competencia, valor").eq("tipo", "captacoes").gte("competencia", ini6),
  ]);
  const lista = (data ?? []) as CaptacaoResumo[];
  const nomeCorretor = new Map(corretores.map((c) => [c.id, c.nome]));
  const funil = funilCaptacao(lista);
  const motivos = new Map<string, number>();
  for (const c of lista) if (c.status === "nao_captado") motivos.set(c.motivo_nao_captado ?? "Sem motivo", (motivos.get(c.motivo_nao_captado ?? "Sem motivo") ?? 0) + 1);
  const totalNao = [...motivos.values()].reduce((a, b) => a + b, 0);

  const meses = Array.from({ length: 6 }, (_, i) => inicioDoMes(somarMeses(hoje, i - 5)));
  const porMes = meses.map((m) => {
    const fim = fimDoMes(m);
    const feitos = (imoveis ?? []).filter((i) => i.captado_em && i.captado_em >= m && i.captado_em <= fim).length;
    const meta = (metas ?? []).find((x) => x.competencia === m);
    return { mes: m, feitos, meta: meta ? Number(meta.valor) : null };
  });

  return (
    <>
      <Cabecalho titulo="Desempenho da captação" trilha="Captação" descricao="Captações por corretor e origem, onde as oportunidades param e as metas do mês." />
      <AbasCaptacao />
      <PilulasLink
        className="mb-5"
        rotulo="Período"
        ativo={per === "90" ? "/captacao/relatorio" : `/captacao/relatorio?periodo=${per}`}
        itens={Object.entries(PERIODOS).map(([k, p]) => ({ href: k === "90" ? "/captacao/relatorio" : `/captacao/relatorio?periodo=${k}`, rotulo: p.rotulo }))}
      />

      <div className="grid gap-6 xl:grid-cols-2">
        <Cartao titulo="Metas de captação (imóveis captados por mês)">
          <ul className="space-y-3 text-sm">
            {porMes.map((m) => {
              const [a, mm] = m.mes.split("-");
              return (
                <li key={m.mes}>
                  <div className="mb-1 flex justify-between">
                    <span className="capitalize text-texto">
                      {NOMES_MES[Number(mm) - 1]} {a}
                    </span>
                    <span className="tabular-nums text-texto-2">
                      {m.feitos}
                      {m.meta !== null ? ` de ${m.meta}` : " (sem meta)"}
                    </span>
                  </div>
                  <BarraProgresso pct={m.meta ? (m.feitos / m.meta) * 100 : 0} atingida={m.meta !== null && m.feitos >= m.meta} />
                </li>
              );
            })}
          </ul>
          <p className="mt-3 text-xs text-mudo">As metas são definidas em Comercial › Metas (“Imóveis captados”).</p>
        </Cartao>

        <Cartao titulo={`Funil da captação (${lista.length} oportunidades)`}>
          <ul className="space-y-3 text-sm">
            {funil.map((f) => (
              <li key={f.etapa}>
                <div className="mb-1 flex justify-between">
                  <span className="text-texto">{ROTULO_ETAPA_CAPTACAO[f.etapa]}</span>
                  <span className="tabular-nums text-texto-2">
                    {f.chegaram} · {f.pct}%
                  </span>
                </div>
                <BarraProgresso pct={f.pct} atingida={f.etapa === "captado"} />
              </li>
            ))}
          </ul>
        </Cartao>

        <Tabela titulo="Captações por corretor" linhas={resumoCaptacoes(lista, (c) => c.corretor_id ?? "")} nome={(k) => (k ? (nomeCorretor.get(k) ?? "Corretor removido") : "Sem corretor")} />
        <Tabela titulo="Captações por origem" linhas={resumoCaptacoes(lista, (c) => c.origem)} nome={(k) => ORIGENS_CAPTACAO[k] ?? k} />

        <Cartao titulo={`Por que não captamos (${totalNao})`}>
          <ul className="space-y-3 text-sm">
            {[...motivos.entries()]
              .sort((a, b) => b[1] - a[1])
              .map(([m, n]) => (
                <li key={m}>
                  <div className="mb-1 flex justify-between">
                    <span className="text-texto">{m}</span>
                    <span className="tabular-nums text-texto-2">{n}</span>
                  </div>
                  <BarraProgresso pct={(n / totalNao) * 100} atingida={false} />
                </li>
              ))}
            {totalNao === 0 && <li className="text-mudo">Nenhuma oportunidade perdida no período.</li>}
          </ul>
        </Cartao>
      </div>
    </>
  );
}
