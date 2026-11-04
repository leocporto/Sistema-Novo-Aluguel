import type { ReactNode } from "react";
import { FileSpreadsheet, Info, Printer, Sheet } from "lucide-react";
import { Contador } from "@/components/abas-segmentadas";
import { Celula, Indicador, LinhaVazia, Tabela, classeBotao } from "@/components/ui";
import { DICA_XLS, celulaTela, formatarDias, formatarPct, formatarVariacao, tomVariacao, type TabelaRelatorio } from "@/lib/dominio/bi";
import type { Indicador as Kpi } from "./indicadores";

/** Variação ao lado do KPI: verde quando melhora, vermelho quando piora (no sentido do indicador). */
export function Variacao({ valor, pontos = false, sentido }: { valor: number | null; pontos?: boolean; sentido: Kpi["sentido"] }) {
  if (valor === null) return <span className="text-mudo">sem base para comparar</span>;
  const tom = tomVariacao(valor, sentido);
  const cor = tom === "sucesso" ? "text-ok" : tom === "perigo" ? "text-ruim" : "text-texto-2";
  const seta = valor > 0 ? "▲" : valor < 0 ? "▼" : "•";
  const txt = pontos ? `${valor > 0 ? "+" : valor < 0 ? "−" : ""}${Math.abs(valor).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} p.p.` : formatarVariacao(valor);
  return (
    <span className={`font-semibold ${cor}`}>
      {seta} {txt}
    </span>
  );
}

function ValorKpi({ k }: { k: Kpi }) {
  if (k.valor === null) return <span className="text-mudo">—</span>;
  if (k.tipo === "dinheiro") return <Contador valor={k.valor} formato="moeda" />;
  if (k.tipo === "pct") return <Contador valor={k.valor} formato="pct" />;
  if (k.tipo === "dias")
    return (
      <>
        <Contador valor={k.valor} /> <span className="text-[17px] font-medium text-texto-2">{k.valor === 1 ? "dia" : "dias"}</span>
      </>
    );
  return <Contador valor={k.valor} />;
}

const fmtAnterior = (k: Kpi) =>
  k.anterior === null
    ? "—"
    : k.tipo === "dinheiro"
      ? k.anterior.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
      : k.tipo === "pct"
        ? formatarPct(k.anterior)
        : k.tipo === "dias"
          ? formatarDias(k.anterior)
          : k.anterior.toLocaleString("pt-BR");

/** KPI dos relatórios: valor, variação contra o período anterior e a explicação da conta (ao passar o mouse). */
export function KpiBi({ k, icone, href }: { k: Kpi; icone: ReactNode; href?: string }) {
  const ruim = k.chave === "inadimplencia" && (k.valor ?? 0) > 0;
  return (
    <div title={k.explicacao}>
      <Indicador
        rotulo={k.rotulo}
        icone={icone}
        href={href}
        tom={ruim ? "perigo" : "neutro"}
        valor={<ValorKpi k={k} />}
        detalhe={
          <span className="flex flex-col gap-0.5">
            <span>
              <Variacao valor={k.variacao} pontos={k.tipo === "pct"} sentido={k.sentido} /> <span className="text-fraco">antes: {fmtAnterior(k)}</span>
            </span>
            {k.detalhe && <span>{k.detalhe}</span>}
          </span>
        }
      />
    </div>
  );
}

/** Botões de exportação (CSV, Excel e impressão/PDF) de um relatório. */
export function BotoesExportar({ consulta, rotulo = "este relatório" }: { consulta: string; rotulo?: string }) {
  return (
    <>
      <a href={`/relatorios/exportar?${consulta}&formato=csv`} className={classeBotao("secundario")} title={`Baixar ${rotulo} em CSV (abre no Excel)`}>
        <Sheet className="size-4" /> CSV
      </a>
      <a href={`/relatorios/exportar?${consulta}&formato=xls`} className={classeBotao("secundario")} title={`Baixar ${rotulo} em Excel. ${DICA_XLS}`}>
        <FileSpreadsheet className="size-4" /> Excel
      </a>
      <a href={`/relatorios/imprimir?${consulta}`} className={classeBotao("secundario")} title={`Imprimir ou salvar ${rotulo} em PDF`}>
        <Printer className="size-4" /> PDF
      </a>
    </>
  );
}

/** Tabela de relatório (tela e impressão). */
export function TabelaRelatorioView({ t, vazio = "Nada para mostrar no período." }: { t: TabelaRelatorio; vazio?: string }) {
  const alinha = (tipo: string) => (tipo === "texto" || tipo === "data" ? "" : "text-right tabular-nums");
  return (
    <Tabela colunas={t.colunas.map((c) => c.rotulo)}>
      {t.linhas.length === 0 && <LinhaVazia colunas={t.colunas.length}>{vazio}</LinhaVazia>}
      {t.linhas.map((l, i) => (
        <tr key={i}>
          {t.colunas.map((c, j) => (
            <Celula key={j} className={alinha(c.tipo)}>
              {celulaTela(l[j], c.tipo)}
            </Celula>
          ))}
        </tr>
      ))}
      {t.totais && t.linhas.length > 0 && (
        <tr>
          {t.colunas.map((c, j) => (
            <Celula key={j} className={`font-semibold ${alinha(c.tipo)}`}>
              {t.totais?.[j] === null || t.totais?.[j] === undefined ? "" : celulaTela(t.totais[j], c.tipo)}
            </Celula>
          ))}
        </tr>
      )}
    </Tabela>
  );
}

/** "Como calculamos": as contas de cada indicador, sempre visíveis no fim da tela. */
export function ComoCalculamos({ itens }: { itens: [string, ReactNode][] }) {
  return (
    <details className="nao-imprimir mt-6 rounded-card border border-borda bg-card px-5 py-4 text-sm" open>
      <summary className="flex cursor-pointer items-center gap-2 font-semibold text-texto">
        <Info className="size-4 text-acento-hot" /> Como calculamos
      </summary>
      <dl className="mt-3 grid gap-x-6 gap-y-2.5 md:grid-cols-2">
        {itens.map(([k, v]) => (
          <div key={k}>
            <dt className="font-medium text-texto">{k}</dt>
            <dd className="text-texto-2">{v}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
