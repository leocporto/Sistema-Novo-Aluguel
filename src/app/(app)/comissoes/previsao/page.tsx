import type { Metadata } from "next";
import Link from "next/link";
import { CalendarRange, Clock, Handshake, TrendingUp } from "lucide-react";
import { Contador } from "@/components/abas-segmentadas";
import { NOMES_MES } from "@/components/navegador-mes";
import { PilulasLink } from "@/components/pilulas-link";
import { Cabecalho, Cartao, Indicador } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { hojeISO, somarMeses } from "@/lib/dominio/datas";
import { formatarReais, paraCentavos, paraReais } from "@/lib/dominio/dinheiro";
import { dataEsperada, escolherRegra, previsaoPorMes, valorComissao, type ItemPrevisao, type StatusComissao } from "@/lib/dominio/comissoes";
import { comissaoTotal, dividirComissao } from "@/lib/dominio/vendas";
import { AbasComissoes } from "../abas";
import { carregarBaseComissoes } from "../dados";

export const metadata: Metadata = { title: "Previsão de comissões" };

type VendaAberta = {
  id: string;
  numero: number;
  valor: number;
  comissao_pct: number;
  comissao_valor: number | null;
  escritura_data: string | null;
  venda_comissoes: { id: string; percentual: number; papel: string; pessoa_id: string | null }[];
};

/** Quanto a imobiliária vai pagar de comissão nos próximos meses, e para quem. */
export default async function PrevisaoComissoesPage({ searchParams }: PageProps<"/comissoes/previsao">) {
  const sp = await searchParams;
  const meses = sp.meses === "3" ? 3 : sp.meses === "12" ? 12 : 6;
  const hoje = hojeISO();
  const { supabase } = await obterContexto();
  const [{ data: abertas }, { data: vendas }, { data: contratos }, base] = await Promise.all([
    supabase.from("comissoes").select("pessoa_id, status, valor, vencimento, previsao, created_at").in("status", ["prevista", "a_pagar"]).limit(10000),
    supabase
      .from("vendas")
      .select("id, numero, valor, comissao_pct, comissao_valor, escritura_data, venda_comissoes(id, percentual, papel, pessoa_id)")
      .not("status", "in", "(concluida,cancelada)")
      .limit(2000),
    supabase.from("contratos").select("valor_aluguel, taxa_administracao_pct, imovel:imoveis(corretor_id)").eq("status", "ativo").limit(5000),
    carregarBaseComissoes(supabase),
  ]);
  const nome = new Map(base.corretores.map((p) => [p.id, p.nome]));
  const itens: (ItemPrevisao & { pessoa: string })[] = [];

  for (const c of (abertas ?? []) as { pessoa_id: string; status: StatusComissao; valor: number; vencimento: string | null; previsao: string | null; created_at: string }[]) {
    itens.push({ pessoa: c.pessoa_id, valor: Number(c.valor), data: dataEsperada(c), origem: c.status === "a_pagar" ? "a_pagar" : "prevista" });
  }
  // Vendas em andamento: a parte de cada pessoa da divisão, se a venda for concluída.
  for (const v of (vendas ?? []) as unknown as VendaAberta[]) {
    const partes = v.venda_comissoes.filter((c) => c.papel !== "imobiliaria" && c.pessoa_id).sort((a, b) => a.id.localeCompare(b.id));
    try {
      const d = dividirComissao(comissaoTotal(Number(v.valor), Number(v.comissao_pct), v.comissao_valor == null ? null : Number(v.comissao_valor)), partes.map((p) => ({ percentual: Number(p.percentual) })));
      partes.forEach((p, i) => itens.push({ pessoa: p.pessoa_id!, valor: d.porPessoa[i], data: v.escritura_data, origem: "venda_aberta" }));
    } catch {
      /* divisão acima de 100%: fica fora até ser corrigida na venda */
    }
  }
  // Administração: estimativa mensal pelos contratos ativos (a partir do mês que vem).
  for (const c of (contratos ?? []) as unknown as { valor_aluguel: number; taxa_administracao_pct: number; imovel: { corretor_id: string | null } | null }[]) {
    const corretor = c.imovel?.corretor_id;
    if (!corretor) continue;
    const regra = escolherRegra(base.regras, "administracao", corretor, base.equipeDe.get(corretor) ?? null);
    if (!regra) continue;
    const mensal = valorComissao(valorComissao(Number(c.valor_aluguel), Number(c.taxa_administracao_pct)), regra.percentual);
    for (let i = 1; i < meses; i++) itens.push({ pessoa: corretor, valor: mensal, data: somarMeses(`${hoje.slice(0, 7)}-01`, i), origem: "administracao" });
  }

  const p = previsaoPorMes(itens, hoje, meses);
  const porPessoa = new Map<string, number>();
  const limite = somarMeses(`${hoje.slice(0, 7)}-01`, meses);
  for (const it of itens) if (!it.data || it.data < limite) porPessoa.set(it.pessoa, (porPessoa.get(it.pessoa) ?? 0) + paraCentavos(it.valor));
  const ranking = [...porPessoa.entries()].sort((a, b) => b[1] - a[1]);
  const soma = (k: "aPagar" | "previstas" | "vendasAbertas" | "administracao") => paraReais(p.meses.reduce((t, m) => t + paraCentavos(m[k]), 0));
  const rotuloMes = (m: string) => `${NOMES_MES[Number(m.slice(5)) - 1]} ${m.slice(0, 4)}`;

  return (
    <>
      <Cabecalho
        titulo="Previsão de comissões"
        trilha="Comissões"
        descricao="O que deve sair do caixa em comissões: as já a pagar (pelo vencimento), as previstas (aguardando recebimento), as vendas em andamento (se forem concluídas) e uma estimativa das de administração pelos contratos ativos."
      />
      <AbasComissoes />
      <PilulasLink
        className="mb-5"
        rotulo="Horizonte"
        ativo={`/comissoes/previsao?meses=${meses}`}
        itens={[3, 6, 12].map((n) => ({ href: `/comissoes/previsao?meses=${n}`, rotulo: `${n} meses` }))}
      />
      <div className="entrar-cascata mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Indicador rotulo="A pagar" icone={<CalendarRange />} valor={<Contador valor={soma("aPagar")} formato="moeda" />} tom="alerta" detalhe="já no Financeiro" />
        <Indicador rotulo="Previstas" icone={<Clock />} valor={<Contador valor={soma("previstas")} formato="moeda" />} detalhe="esperando a imobiliária receber" />
        <Indicador rotulo="Vendas em andamento" icone={<Handshake />} valor={<Contador valor={soma("vendasAbertas") + p.semData} formato="moeda" />} detalhe="se as vendas forem concluídas" />
        <Indicador rotulo="Administração (estimada)" icone={<TrendingUp />} valor={<Contador valor={soma("administracao")} formato="moeda" />} detalhe="contratos ativos × regra" />
      </div>
      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <Cartao titulo="Mês a mês">
          <div className="overflow-x-auto">
            <table className="w-full min-w-0 text-sm">
              <thead>
                <tr className="text-left font-mono text-[10px] uppercase tracking-[0.12em] text-mudo">
                  <th className="py-2 pr-2">Mês</th>
                  <th className="px-2 py-2 text-right">A pagar</th>
                  <th className="px-2 py-2 text-right">Previstas</th>
                  <th className="px-2 py-2 text-right">Vendas</th>
                  <th className="px-2 py-2 text-right">Administração</th>
                  <th className="py-2 pl-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-borda-suave">
                {p.meses.map((m) => (
                  <tr key={m.mes}>
                    <td className="py-2 pr-2 capitalize">{rotuloMes(m.mes)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{formatarReais(m.aPagar)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{formatarReais(m.previstas)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{formatarReais(m.vendasAbertas)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{formatarReais(m.administracao)}</td>
                    <td className="py-2 pl-2 text-right font-semibold tabular-nums">{formatarReais(m.total)}</td>
                  </tr>
                ))}
                {p.semData > 0 && (
                  <tr>
                    <td className="py-2 pr-2 text-texto-2">Sem data (vendas sem escritura marcada)</td>
                    <td colSpan={4} />
                    <td className="py-2 pl-2 text-right font-semibold tabular-nums">{formatarReais(p.semData)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-mudo">O que está atrasado entra no mês atual. A data das vendas é a da escritura, quando marcada.</p>
        </Cartao>
        <Cartao titulo="Por corretor">
          <ul className="divide-y divide-borda-suave text-sm">
            {ranking.map(([id, v]) => (
              <li key={id} className="flex items-center justify-between gap-3 py-2">
                <Link href={`/comissoes/corretores/${id}`} className="font-medium text-texto hover:underline">
                  {nome.get(id) ?? "—"}
                </Link>
                <span className="tabular-nums">{formatarReais(paraReais(v))}</span>
              </li>
            ))}
            {ranking.length === 0 && <li className="py-2 text-mudo">Nenhuma comissão prevista.</li>}
          </ul>
        </Cartao>
      </div>
    </>
  );
}
