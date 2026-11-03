import type { Metadata } from "next";
import { Clock, Download, HandCoins, Percent, TrendingDown, Undo2 } from "lucide-react";
import { Contador } from "@/components/abas-segmentadas";
import { PilulasLink } from "@/components/pilulas-link";
import { BotaoLink, Cabecalho, Cartao, Celula, Indicador, LinhaVazia, Tabela } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { aging, FAIXAS_ATRASO } from "@/lib/dominio/cobrancas";
import { formatarDataBR, hojeISO } from "@/lib/dominio/datas";
import { formatarReais } from "@/lib/dominio/dinheiro";
import { AbasCobrancas } from "../abas";
import { reais } from "../dados";
import { AGRUPAR, PERIODOS, relatorioCobrancas } from "./dados";

export const metadata: Metadata = { title: "Relatórios de inadimplência" };

export default async function RelatoriosCobrancaPage({ searchParams }: PageProps<"/cobrancas/relatorios">) {
  const sp = await searchParams;
  const periodo = typeof sp.periodo === "string" && sp.periodo in PERIODOS ? sp.periodo : "mes";
  const agrupar = typeof sp.por === "string" && sp.por in AGRUPAR ? sp.por : "locatario";
  const { supabase } = await obterContexto();
  const hoje = hojeISO();
  const { de, ate, ind, vencidas, grupos, emAcordo } = await relatorioCobrancas(supabase, hoje, periodo, agrupar);
  const ag = aging(vencidas.map((c) => ({ dias: c.dias, valor: c.sit.saldo })));
  const url = (p: string, a: string) => `/cobrancas/relatorios?periodo=${p}&por=${a}`;
  const maiorFaixa = Math.max(1, ...ag.faixas.map((f) => f.valor));

  return (
    <>
      <Cabecalho
        titulo="Relatórios de inadimplência"
        trilha="Cobranças"
        descricao={`Quanto atrasou, quanto foi recuperado e como estão os acordos — de ${formatarDataBR(de)} a ${formatarDataBR(ate)}.`}
        acoes={
          <BotaoLink href={`/cobrancas/relatorios/exportar?por=${agrupar}`} variante="secundario" prefetch={false}>
            <Download className="size-4" /> Exportar (CSV)
          </BotaoLink>
        }
      />
      <AbasCobrancas />
      <PilulasLink className="mb-5" rotulo="Período" ativo={url(periodo, agrupar)} itens={Object.entries(PERIODOS).map(([k, r]) => ({ href: url(k, agrupar), rotulo: r }))} />

      <h2 className="mb-3 text-[15px] font-semibold text-texto">Recuperação de valores</h2>
      <div className="entrar-cascata mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Indicador rotulo="Venceram no período" icone={<Clock />} valor={<Contador valor={reais(ind.venceu)} formato="moeda" />} detalhe={`${formatarReais(reais(ind.pagoEmDia))} pagos em dia`} />
        <Indicador rotulo="Atrasaram" icone={<TrendingDown />} tom={ind.atrasou ? "alerta" : "sucesso"} valor={<Contador valor={reais(ind.atrasou)} formato="moeda" />} detalhe={ind.pctInadimplencia != null ? `${ind.pctInadimplencia}% ainda em aberto` : "—"} />
        <Indicador
          rotulo="Recuperado (do que atrasou)"
          icone={<Undo2 />}
          tom="sucesso"
          valor={<Contador valor={reais(ind.recuperado)} formato="moeda" />}
          detalhe={ind.pctRecuperado != null ? `${ind.pctRecuperado}% recuperado · prazo médio ${ind.prazoMedio ?? "—"} dias` : "nada atrasou"}
        />
        <Indicador rotulo="Recebido em atraso no período" icone={<HandCoins />} tom="sucesso" valor={<Contador valor={reais(ind.recebidoEmAtraso)} formato="moeda" />} detalhe={`multa e juros: ${formatarReais(reais(ind.encargosRecebidos))}`} />
      </div>

      <div className="entrar-cascata mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Indicador rotulo="Acordos feitos no período" icone={<HandCoins />} valor={<Contador valor={ind.acordos.criados} />} detalhe={`${ind.acordos.ativos} em andamento · ${formatarReais(reais(ind.acordos.valorAtivo))}`} href="/cobrancas/acordos" />
        <Indicador rotulo="Acordos cumpridos" icone={<HandCoins />} tom="sucesso" valor={<Contador valor={ind.acordos.cumpridos} />} detalhe="no período" />
        <Indicador rotulo="Acordos quebrados" icone={<HandCoins />} tom={ind.acordos.quebrados ? "perigo" : "neutro"} valor={<Contador valor={ind.acordos.quebrados} />} detalhe="no período" />
        <Indicador rotulo="Taxa de cumprimento" icone={<Percent />} valor={ind.acordos.taxaCumprimento != null ? <Contador valor={ind.acordos.taxaCumprimento} formato="pct" /> : "—"} detalhe="cumpridos ÷ (cumpridos + quebrados)" />
      </div>

      <div className="mb-6 grid gap-6 xl:grid-cols-[380px_1fr]">
        <Cartao titulo={`Em atraso hoje por faixa · ${formatarReais(reais(ag.total))}`}>
          <ul className="space-y-3">
            {ag.faixas.map((f) => (
              <li key={f.id}>
                <div className="flex justify-between text-sm">
                  <span className="text-texto-2">
                    {f.rotulo} ({f.quantidade})
                  </span>
                  <span className="tabular-nums">{formatarReais(reais(f.valor))}</span>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-elev">
                  <div className="h-full rounded-full bg-ruim" style={{ width: `${Math.round((f.valor / maiorFaixa) * 100)}%` }} />
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs text-mudo">
            Só o aluguel em aberto (sem multa e juros). Em acordo: {formatarReais(reais(emAcordo))}.
          </p>
        </Cartao>
        <Cartao titulo="Quem deve mais">
          <PilulasLink className="mb-4" rotulo="Agrupar" ativo={url(periodo, agrupar)} itens={Object.entries(AGRUPAR).map(([k, r]) => ({ href: url(periodo, k), rotulo: r }))} />
          <Tabela colunas={[AGRUPAR[agrupar].replace("Por ", ""), "Cobranças", ...FAIXAS_ATRASO.map((f) => f.rotulo), "Total", "Maior atraso"]}>
            {grupos.length === 0 && <LinhaVazia colunas={8}>Ninguém em atraso.</LinhaVazia>}
            {grupos.map((g) => (
              <tr key={g.chave}>
                <Celula className="font-medium">{g.rotulo}</Celula>
                <Celula>{g.quantidade}</Celula>
                {FAIXAS_ATRASO.map((f) => (
                  <Celula key={f.id} className="tabular-nums">
                    {g.faixas[f.id] ? formatarReais(reais(g.faixas[f.id])) : "—"}
                  </Celula>
                ))}
                <Celula className="font-semibold tabular-nums text-ruim">{formatarReais(reais(g.valor))}</Celula>
                <Celula>{g.maiorAtraso} dias</Celula>
              </tr>
            ))}
          </Tabela>
        </Cartao>
      </div>
    </>
  );
}
