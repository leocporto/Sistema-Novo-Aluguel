import type { Metadata } from "next";
import { Download, Scale, TrendingDown, TrendingUp } from "lucide-react";
import { Contador } from "@/components/abas-segmentadas";
import { FiltroAutomatico } from "@/components/filtro-automatico";
import { NOMES_MES } from "@/components/navegador-mes";
import { Cabecalho, classeBotao, Cartao, Celula, Entrada, Indicador, LinhaVazia, Tabela } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { fimDoMes, hojeISO, somarDias } from "@/lib/dominio/datas";
import { formatarReais, paraCentavos, paraReais } from "@/lib/dominio/dinheiro";
import { montarDRE, saldoConta, valorRealizado } from "@/lib/dominio/financeiro";
import { movimentosDasContas, opcoesFinanceiro } from "../dados";
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
  // Indicadores pelo tipo de cada lançamento (não pelo sinal do grupo): despesa em "Outros" continua despesa.
  const noResultado = linhas.filter((l) => (l.grupo_dre ?? "") !== "nao_dre");
  const receitas = paraReais(noResultado.filter((l) => l.tipo === "receber").reduce((a, l) => a + paraCentavos(l.valor), 0));
  const despesas = paraReais(noResultado.filter((l) => l.tipo === "pagar").reduce((a, l) => a + paraCentavos(l.valor), 0));
  // Balancete das contas: saldo antes do período, entradas, saídas e saldo no fim.
  const [op, { movs, transferencias }] = await Promise.all([opcoesFinanceiro(supabase), movimentosDasContas(supabase)]);
  const balancete = op.contas
    .filter((c) => c.ativa || movs.some((m) => m.conta_id === c.id))
    .map((c) => {
      const conta = { ...c, saldo_inicial: Number(c.saldo_inicial) };
      const inicio = saldoConta(conta, movs, transferencias, somarDias(de, -1));
      const fim = saldoConta(conta, movs, transferencias, ate);
      const dentro = (d: string | null) => !!d && d >= de && d <= ate && d >= c.saldo_inicial_em;
      let ent = 0;
      let sai = 0;
      for (const m of movs) {
        if (m.conta_id !== c.id || !dentro(m.liquidado_em)) continue;
        if (m.tipo === "receber") ent += paraCentavos(valorRealizado(m));
        else sai += paraCentavos(valorRealizado(m));
      }
      for (const t of transferencias) {
        if (!dentro(t.data)) continue;
        if (t.destino_id === c.id) ent += paraCentavos(t.valor);
        if (t.origem_id === c.id) sai += paraCentavos(t.valor);
      }
      return { id: c.id, nome: c.nome, terceiros: c.terceiros, inicio, entradas: paraReais(ent), saidas: paraReais(sai), fim };
    });

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
          <a href={`/financeiro/exportar?tipo=dre&de=${de}&ate=${ate}`} className={classeBotao("secundario")}>
            <Download className="size-4" /> Exportar (CSV)
          </a>
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
      <div className="mt-6">
        <h3 className="mb-2 text-[15px] font-semibold text-texto">Balancete das contas no período</h3>
        <Tabela colunas={["Conta", "Saldo antes", "Entradas", "Saídas", "Saldo no fim"]}>
          {balancete.map((b) => (
            <tr key={b.id}>
              <Celula className="font-medium">
                {b.nome}
                {b.terceiros && <span className="ml-2 text-xs text-alerta">terceiros</span>}
              </Celula>
              <Celula className="tabular-nums">{formatarReais(b.inicio)}</Celula>
              <Celula className="tabular-nums text-ok">{formatarReais(b.entradas)}</Celula>
              <Celula className="tabular-nums">{formatarReais(b.saidas)}</Celula>
              <Celula className={`font-semibold tabular-nums ${b.fim < 0 ? "text-ruim" : ""}`}>{formatarReais(b.fim)}</Celula>
            </tr>
          ))}
          {balancete.length === 0 && <LinhaVazia colunas={5}>Cadastre suas contas em “Contas e conciliação” para ver o balancete.</LinhaVazia>}
        </Tabela>
        <p className="mt-2 text-xs text-mudo">Entram só os movimentos ligados a uma conta (baixas com conta, aluguéis e repasses conciliados, transferências).</p>
      </div>
    </>
  );
}
