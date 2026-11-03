import type { Metadata } from "next";
import { ArrowDownCircle, ArrowUpCircle, Landmark, Scale } from "lucide-react";
import { Contador } from "@/components/abas-segmentadas";
import { NOMES_MES } from "@/components/navegador-mes";
import { PilulasLink } from "@/components/pilulas-link";
import { Aviso, Cabecalho, Celula, Indicador, LinhaVazia, Tabela } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { formatarDataBR, hojeISO, inicioDoMes, somarDias, somarMeses } from "@/lib/dominio/datas";
import { formatarReais, paraCentavos, paraReais } from "@/lib/dominio/dinheiro";
import { fluxoDeCaixa, valorRealizado, type MovFluxo } from "@/lib/dominio/financeiro";
import { AbasFinanceiro } from "../abas";
import { opcoesFinanceiro, saldosDasContas, todas } from "../dados";

export const metadata: Metadata = { title: "Fluxo de caixa" };

const VISOES: Record<string, string> = { "30": "Próximos 30 dias", "90": "Próximos 90 dias", "12m": "Próximos 12 meses", ano: "Este ano" };

export default async function FluxoPage({ searchParams }: PageProps<"/financeiro/fluxo">) {
  const sp = await searchParams;
  const visao = typeof sp.visao === "string" && sp.visao in VISOES ? sp.visao : "30";
  const comTerceiros = sp.terceiros === "1";
  const { supabase, organizacao } = await obterContexto();
  const pessoal = organizacao.modo === "pessoal";
  const hoje = hojeISO();
  const [de, ate, agrupar] =
    visao === "30"
      ? [hoje, somarDias(hoje, 30), "dia" as const]
      : visao === "90"
        ? [hoje, somarDias(hoje, 90), "dia" as const]
        : visao === "12m"
          ? [inicioDoMes(hoje), somarDias(somarMeses(inicioDoMes(hoje), 12), -1), "mes" as const]
          : [`${hoje.slice(0, 4)}-01-01`, `${hoje.slice(0, 4)}-12-31`, "mes" as const];
  const incluiAlugueis = pessoal || comTerceiros;

  type L = { tipo: "receber" | "pagar"; valor: number; valor_pago: number | null; vencimento: string; liquidado_em: string | null; status: string; terceiros: boolean; fatura_id: string | null };
  type F = { valor_total: number; valor_pago: number | null; vencimento: string; pago_em: string | null; status: string };
  type R = { valor_liquido: number; previsto_para: string; pago_em: string | null; status: string };
  const [lanc, fat, rep, op] = await Promise.all([
    todas<L>(() =>
      supabase
        .from("lancamentos")
        .select("tipo, valor, valor_pago, vencimento, liquidado_em, status, terceiros, fatura_id")
        .neq("status", "cancelado")
        .or(`liquidado_em.gte.${de},and(status.eq.aberto,vencimento.lte.${ate})`)
        .order("id"),
    ),
    incluiAlugueis
      ? todas<F>(() => supabase.from("faturas").select("valor_total, valor_pago, vencimento, pago_em, status").neq("status", "cancelada").or(`pago_em.gte.${de},and(status.eq.aberta,vencimento.lte.${ate})`).order("id"))
      : Promise.resolve([] as F[]),
    !pessoal && comTerceiros
      ? todas<R>(() => supabase.from("repasses").select("valor_liquido, previsto_para, pago_em, status").neq("status", "cancelado").or(`pago_em.gte.${de},and(status.eq.pendente,previsto_para.lte.${ate})`).order("id"))
      : Promise.resolve([] as R[]),
    opcoesFinanceiro(supabase),
  ]);
  const contas = op.contas.filter((c) => c.ativa && (pessoal || comTerceiros || !c.terceiros));
  // Conta cadastrada depois do início do período: o saldo inicial dela já inclui o que
  // aconteceu antes, então o fluxo começa a contar o realizado a partir dali.
  const inicioReal = contas.reduce((m, c) => (c.saldo_inicial_em > m ? c.saldo_inicial_em : m), de);
  const previstoEm = (d: string) => (d < hoje ? hoje : d);
  const movs: MovFluxo[] = [];
  const realizado = (tipo: "receber" | "pagar", valor: number, data: string) => {
    if (data >= inicioReal) movs.push({ tipo, valor, data, realizado: true });
  };
  for (const l of lanc) {
    if (!pessoal && !comTerceiros && l.terceiros) continue;
    // Com os aluguéis no fluxo, o lançamento automático da baixa (aluguel no pessoal,
    // taxa na imobiliária) já está dentro da fatura: não conta de novo.
    if (incluiAlugueis && l.fatura_id) continue;
    if (l.status === "liquidado" && l.liquidado_em) realizado(l.tipo, valorRealizado(l), l.liquidado_em);
    else if (l.status === "aberto") movs.push({ tipo: l.tipo, valor: Number(l.valor), data: previstoEm(l.vencimento), realizado: false });
  }
  for (const f of fat) {
    if (f.status === "paga" && f.pago_em) realizado("receber", Number(f.valor_pago ?? f.valor_total), f.pago_em);
    else if (f.status === "aberta") movs.push({ tipo: "receber", valor: Number(f.valor_total), data: previstoEm(f.vencimento), realizado: false });
  }
  for (const r of rep) {
    if (r.status === "pago" && r.pago_em) realizado("pagar", Number(r.valor_liquido), r.pago_em);
    else if (r.status === "pendente") movs.push({ tipo: "pagar", valor: Number(r.valor_liquido), data: previstoEm(r.previsto_para), realizado: false });
  }
  const saldos = await saldosDasContas(supabase, contas, somarDias(inicioReal, -1));
  const saldoInicial = paraReais([...saldos.values()].reduce((a, v) => a + paraCentavos(v), 0));
  const periodos = fluxoDeCaixa(movs, saldoInicial, agrupar, de, ate);
  const soma = (k: "entradasRealizadas" | "saidasRealizadas" | "entradasPrevistas" | "saidasPrevistas") => paraReais(periodos.reduce((a, p) => a + paraCentavos(p[k]), 0));
  const saldoFinal = periodos.at(-1)?.saldoFinal ?? saldoInicial;
  const negativo = periodos.find((p) => p.saldoFinal < 0);
  const rotulo = (k: string) => (agrupar === "mes" ? `${NOMES_MES[Number(k.slice(5, 7)) - 1]} ${k.slice(0, 4)}` : formatarDataBR(k));
  const url = (v: string, t = comTerceiros) => `/financeiro/fluxo?visao=${v}${t ? "&terceiros=1" : ""}`;

  return (
    <>
      <Cabecalho
        titulo="Fluxo de caixa"
        trilha="Financeiro"
        descricao={
          pessoal
            ? "O que entrou, o que vai entrar e o que vai sair: aluguéis, despesas e lançamentos, com o saldo dia a dia."
            : "Entradas e saídas realizadas e previstas da imobiliária. Ligue “com terceiros” para ver também os aluguéis recebidos e os repasses."
        }
      />
      <AbasFinanceiro pessoal={pessoal} />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <PilulasLink rotulo="Período" ativo={url(visao)} itens={Object.entries(VISOES).map(([k, r]) => ({ href: url(k), rotulo: r }))} />
        {!pessoal && (
          <PilulasLink
            rotulo="Terceiros"
            ativo={url(visao)}
            itens={[
              { href: url(visao, false), rotulo: "Só da imobiliária" },
              { href: url(visao, true), rotulo: "Com terceiros" },
            ]}
          />
        )}
      </div>
      <div className="entrar-cascata mb-6 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Indicador rotulo="Saldo no início" icone={<Landmark />} valor={<Contador valor={saldoInicial} formato="moeda" />} detalhe={`contas cadastradas em ${formatarDataBR(inicioReal)}`} />
        <Indicador rotulo="Entradas" icone={<ArrowDownCircle />} valor={<Contador valor={soma("entradasRealizadas") + soma("entradasPrevistas")} formato="moeda" />} detalhe={`${formatarReais(soma("entradasPrevistas"))} ainda previstas`} tom="sucesso" />
        <Indicador rotulo="Saídas" icone={<ArrowUpCircle />} valor={<Contador valor={soma("saidasRealizadas") + soma("saidasPrevistas")} formato="moeda" />} detalhe={`${formatarReais(soma("saidasPrevistas"))} ainda previstas`} tom="perigo" />
        <Indicador rotulo="Saldo previsto no fim" icone={<Scale />} valor={<Contador valor={saldoFinal} formato="moeda" />} tom={saldoFinal < 0 ? "perigo" : "sucesso"} detalhe={formatarDataBR(ate)} />
      </div>
      {negativo && (
        <div className="mb-4">
          <Aviso tipo="alerta">
            O saldo fica negativo em {rotulo(negativo.chave)} ({formatarReais(negativo.saldoFinal)}). Vale antecipar recebimentos ou adiar pagamentos.
          </Aviso>
        </div>
      )}
      <Tabela colunas={[agrupar === "mes" ? "Mês" : "Dia", "Entrou", "Saiu", "Vai entrar", "Vai sair", "Saldo"]}>
        {periodos.map((p) => (
          <tr key={p.chave}>
            <Celula className="font-medium capitalize">{rotulo(p.chave)}</Celula>
            <Celula className="tabular-nums text-ok">{p.entradasRealizadas ? formatarReais(p.entradasRealizadas) : "—"}</Celula>
            <Celula className="tabular-nums">{p.saidasRealizadas ? formatarReais(p.saidasRealizadas) : "—"}</Celula>
            <Celula className="tabular-nums text-ok/80">{p.entradasPrevistas ? formatarReais(p.entradasPrevistas) : "—"}</Celula>
            <Celula className="tabular-nums text-texto-2">{p.saidasPrevistas ? formatarReais(p.saidasPrevistas) : "—"}</Celula>
            <Celula className={`font-semibold tabular-nums ${p.saldoFinal < 0 ? "text-ruim" : "text-texto"}`}>{formatarReais(p.saldoFinal)}</Celula>
          </tr>
        ))}
        {periodos.length === 0 && <LinhaVazia colunas={6}>Nenhum movimento no período.</LinhaVazia>}
      </Tabela>
      <p className="mt-3 text-xs text-mudo">Contas vencidas e não pagas aparecem como previstas para hoje.</p>
    </>
  );
}
