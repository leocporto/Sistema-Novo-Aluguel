import type { Metadata } from "next";
import { Download, Scale, TrendingDown, TrendingUp } from "lucide-react";
import { Contador } from "@/components/abas-segmentadas";
import { FiltroAutomatico } from "@/components/filtro-automatico";
import { NOMES_MES } from "@/components/navegador-mes";
import { BotaoLink, Cabecalho, Cartao, Celula, Entrada, Indicador, LinhaVazia, Tabela } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { fimDoMes, hojeISO } from "@/lib/dominio/datas";
import { formatarReais } from "@/lib/dominio/dinheiro";
import { montarDRE } from "@/lib/dominio/financeiro";
import { AbasFinanceiro } from "../abas";
import { linhasRealizadas } from "./dados";

export const metadata: Metadata = { title: "DRE" };

export default async function DrePage({ searchParams }: PageProps<"/financeiro/dre">) {
  const sp = await searchParams;
  const hoje = hojeISO();
  const mesOk = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}$/.test(v);
  const deM = mesOk(sp.de) ? String(sp.de) : `${hoje.slice(0, 4)}-01`;
  const ateM = mesOk(sp.ate) ? String(sp.ate) : hoje.slice(0, 7);
  const de = `${deM}-01`;
  const ate = fimDoMes(`${ateM}-01`);
  const { supabase, organizacao } = await obterContexto();
  const pessoal = organizacao.modo === "pessoal";
  const linhas = await linhasRealizadas(supabase, pessoal, de, ate);
  const dre = montarDRE(linhas);
  const meses = [...new Set(linhas.map((l) => l.data.slice(0, 7)))].sort();
  const porMes = meses.map((m) => {
    const d = montarDRE(linhas.filter((l) => l.data.startsWith(m)));
    const entradas = linhas.filter((l) => l.data.startsWith(m) && l.tipo === "receber" && l.grupo_dre !== "nao_dre").reduce((a, l) => a + l.valor, 0);
    return { m, receita: d.receitaBruta, entradas, resultado: d.resultado };
  });
  const despesas = dre.linhas.filter((l) => l.sinal < 0).reduce((a, l) => a + l.total, 0);
  const receitas = dre.linhas.filter((l) => l.sinal > 0).reduce((a, l) => a + l.total, 0);

  return (
    <>
      <Cabecalho
        titulo="DRE"
        trilha="Financeiro"
        descricao={
          pessoal
            ? "Resultado dos seus imóveis no período (pelo que foi recebido e pago): aluguéis menos despesas e impostos."
            : "Demonstração do resultado da imobiliária no período, pelo regime de caixa (o que foi recebido e pago). Valores de terceiros ficam de fora."
        }
        acoes={
          <BotaoLink href={`/financeiro/exportar?tipo=dre&de=${de}&ate=${ate}`} variante="secundario" prefetch={false}>
            <Download className="size-4" /> Exportar (CSV)
          </BotaoLink>
        }
      />
      <AbasFinanceiro pessoal={pessoal} />
      <FiltroAutomatico className="mb-5 flex flex-wrap items-center gap-2">
        <span className="text-sm text-texto-2">De</span>
        <Entrada type="month" name="de" aria-label="Mês inicial" defaultValue={deM} className="w-44" />
        <span className="text-sm text-texto-2">até</span>
        <Entrada type="month" name="ate" aria-label="Mês final" defaultValue={ateM} className="w-44" />
      </FiltroAutomatico>
      <div className="entrar-cascata mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Indicador rotulo="Receitas" icone={<TrendingUp />} valor={<Contador valor={receitas} formato="moeda" />} tom="sucesso" />
        <Indicador rotulo="Despesas, custos e impostos" icone={<TrendingDown />} valor={<Contador valor={despesas} formato="moeda" />} tom="perigo" />
        <Indicador
          rotulo="Resultado"
          icone={<Scale />}
          valor={<Contador valor={dre.resultado} formato="moeda" />}
          tom={dre.resultado >= 0 ? "sucesso" : "perigo"}
          detalhe={dre.receitaBruta > 0 ? `margem de ${Math.round((dre.resultado / dre.receitaBruta) * 100)}% sobre a receita` : undefined}
        />
      </div>
      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <Cartao titulo="Demonstração do resultado">
          {dre.linhas.length === 0 && <p className="text-sm text-mudo">Nada recebido ou pago no período.</p>}
          <div className="space-y-5">
            {dre.linhas.map((g) => (
              <div key={g.grupo}>
                <div className="flex items-baseline justify-between border-b border-borda pb-1.5">
                  <span className="font-semibold text-texto">
                    {g.sinal < 0 ? "(−) " : "(+) "}
                    {g.rotulo}
                  </span>
                  <span className={`font-semibold tabular-nums ${g.sinal < 0 ? "text-ruim" : "text-ok"}`}>{formatarReais(g.total)}</span>
                </div>
                <ul className="mt-1.5 space-y-1 text-sm">
                  {g.contas.map((c) => (
                    <li key={c.plano_id ?? c.nome} className="flex justify-between gap-3 text-texto-2">
                      <span>{c.nome}</span>
                      <span className="tabular-nums">{formatarReais(c.total)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            {dre.linhas.length > 0 && (
              <div className="flex items-baseline justify-between border-t-2 border-borda-forte pt-2">
                <span className="text-[15px] font-semibold text-texto">(=) Resultado do período</span>
                <span className={`text-[17px] font-semibold tabular-nums ${dre.resultado >= 0 ? "text-ok" : "text-ruim"}`}>{formatarReais(dre.resultado)}</span>
              </div>
            )}
          </div>
          <p className="mt-5 text-xs text-mudo">
            Lançamentos sem plano de contas entram como receita operacional ou despesa operacional. Classifique-os para a DRE ficar precisa.
          </p>
        </Cartao>
        <div>
          <Tabela colunas={["Mês", "Entradas", "Resultado"]}>
            {porMes.map((p) => (
              <tr key={p.m}>
                <Celula className="capitalize">
                  {NOMES_MES[Number(p.m.slice(5, 7)) - 1]} {p.m.slice(0, 4)}
                </Celula>
                <Celula className="tabular-nums">{formatarReais(p.entradas)}</Celula>
                <Celula className={`font-semibold tabular-nums ${p.resultado >= 0 ? "text-ok" : "text-ruim"}`}>{formatarReais(p.resultado)}</Celula>
              </tr>
            ))}
            {porMes.length === 0 && <LinhaVazia colunas={3}>Sem movimento.</LinhaVazia>}
          </Tabela>
        </div>
      </div>
    </>
  );
}
