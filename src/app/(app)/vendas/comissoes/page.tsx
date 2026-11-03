import type { Metadata } from "next";
import Link from "next/link";
import { BadgeDollarSign, CircleCheck, Clock } from "lucide-react";
import { Contador } from "@/components/abas-segmentadas";
import { PilulasLink } from "@/components/pilulas-link";
import { BotaoLink, Cabecalho, Cartao, Indicador } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { formatarReais } from "@/lib/dominio/dinheiro";
import { comissaoTotal, dividirComissao } from "@/lib/dominio/vendas";
import { AbasVendas } from "../campos";

export const metadata: Metadata = { title: "Comissões de venda" };

type L = { chave: string; nome: string; previstas: number; aPagar: number; pagas: number; vendas: number };

/** Comissões por corretor/parceiro: previstas (vendas abertas), a pagar e pagas. */
export default async function ComissoesVendas({ searchParams }: PageProps<"/vendas/comissoes">) {
  const sp = await searchParams;
  const ano = typeof sp.ano === "string" && /^\d{4}$/.test(sp.ano) ? sp.ano : new Date().getFullYear().toString();
  const { supabase } = await obterContexto();
  const [{ data: vendas }, { data: lancs }, { data: aguardando }] = await Promise.all([
    supabase
      .from("vendas")
      .select("id, valor, comissao_pct, comissao_valor, status, created_at, venda_comissoes(id, percentual, papel, pessoa:pessoas(id, nome))")
      .not("status", "in", "(cancelada,concluida)"),
    supabase
      .from("lancamentos")
      .select("tipo, valor, status, vencimento, categoria, pessoa:pessoas(id, nome)")
      .not("venda_id", "is", null)
      .gte("vencimento", `${ano}-01-01`)
      .lte("vencimento", `${ano}-12-31`),
    // Venda concluída com regra "só depois de receber": a parte do corretor fica prevista (sem conta a pagar ainda).
    supabase.from("comissoes").select("valor, pessoa:pessoas(id, nome)").not("venda_id", "is", null).eq("status", "prevista"),
  ]);
  const mapa = new Map<string, L>();
  const linha = (id: string, nome: string) => {
    if (!mapa.has(id)) mapa.set(id, { chave: id, nome, previstas: 0, aPagar: 0, pagas: 0, vendas: 0 });
    return mapa.get(id)!;
  };
  type V = { valor: number; comissao_pct: number; comissao_valor: number | null; venda_comissoes: { id: string; percentual: number; papel: string; pessoa: { id: string; nome: string } | null }[] };
  let imobPrevista = 0;
  for (const v of (vendas ?? []) as unknown as V[]) {
    const total = comissaoTotal(Number(v.valor), Number(v.comissao_pct), v.comissao_valor == null ? null : Number(v.comissao_valor));
    // Mesma ordem e arredondamento do banco ao concluir (concluir_venda).
    const pessoas = v.venda_comissoes.filter((c) => c.papel !== "imobiliaria" && c.pessoa).sort((a, b) => a.id.localeCompare(b.id));
    try {
      const d = dividirComissao(total, pessoas.map((c) => ({ percentual: Number(c.percentual) })));
      pessoas.forEach((c, i) => {
        const l = linha(c.pessoa!.id, c.pessoa!.nome);
        l.previstas += d.porPessoa[i];
        l.vendas += 1;
      });
      imobPrevista += d.imobiliaria;
    } catch {
      /* divisão inválida: ignora no total */
    }
  }
  for (const c of (aguardando ?? []) as unknown as { valor: number; pessoa: { id: string; nome: string } | null }[]) {
    if (c.pessoa) linha(c.pessoa.id, c.pessoa.nome).previstas += Number(c.valor);
  }
  type Lc = { tipo: string; valor: number; status: string; categoria: string | null; pessoa: { id: string; nome: string } | null };
  let receber = 0;
  let recebido = 0;
  for (const l of (lancs ?? []) as unknown as Lc[]) {
    if (l.tipo === "receber") {
      if (l.categoria !== "Comissões de venda") continue; // devoluções de comissão estornada ficam fora
      if (l.status === "liquidado") recebido += Number(l.valor);
      else if (l.status === "aberto") receber += Number(l.valor);
      continue;
    }
    if (!l.pessoa) continue;
    const x = linha(l.pessoa.id, l.pessoa.nome);
    if (l.status === "liquidado") x.pagas += Number(l.valor);
    else if (l.status === "aberto") x.aPagar += Number(l.valor);
  }
  const linhas = [...mapa.values()].sort((a, b) => b.pagas + b.aPagar + b.previstas - (a.pagas + a.aPagar + a.previstas));
  const anos = [0, 1, 2].map((i) => String(new Date().getFullYear() - i));

  return (
    <>
      <Cabecalho
        titulo="Comissões de venda"
        trilha="Vendas"
        descricao="Quanto cada corretor e parceiro tem previsto (vendas em andamento ou aguardando a imobiliária receber), a pagar e já pago, e o que a imobiliária recebe dos vendedores. Regras, ajustes, estornos e relatório por corretor ficam em Comissões."
        acoes={
          <BotaoLink href="/comissoes" variante="secundario">
            Abrir Comissões
          </BotaoLink>
        }
      />
      <AbasVendas />
      <PilulasLink className="mb-5" rotulo="Ano" ativo={`/vendas/comissoes?ano=${ano}`} itens={anos.map((a) => ({ href: `/vendas/comissoes?ano=${a}`, rotulo: a }))} />
      <div className="entrar-cascata mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Indicador rotulo="Previstas" icone={<Clock />} valor={<Contador valor={imobPrevista + linhas.reduce((s, l) => s + l.previstas, 0)} formato="moeda" />} detalhe={`vendas em andamento e aguardando recebimento · imobiliária: ${formatarReais(imobPrevista)}`} />
        <Indicador rotulo="A receber dos vendedores" icone={<BadgeDollarSign />} valor={<Contador valor={receber} formato="moeda" />} detalhe="vendas concluídas" href="/financeiro" />
        <Indicador rotulo="Recebidas no ano" icone={<CircleCheck />} valor={<Contador valor={recebido} formato="moeda" />} tom="sucesso" detalhe={ano} />
      </div>
      <Cartao titulo="Por corretor e parceiro">
        <div className="overflow-x-auto">
          <table className="w-full min-w-0 text-sm">
            <thead>
              <tr className="text-left font-mono text-[10px] uppercase tracking-[0.12em] text-mudo">
                <th className="py-2 pr-2">Nome</th>
                <th className="px-2 py-2 text-right">Vendas em andamento</th>
                <th className="px-2 py-2 text-right">Previstas</th>
                <th className="px-2 py-2 text-right">A pagar</th>
                <th className="py-2 pl-2 text-right">Pagas</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-borda-suave">
              {linhas.map((l) => (
                <tr key={l.chave}>
                  <td className="py-2 pr-2 font-medium text-texto">
                    <Link href={`/pessoas/${l.chave}`} className="hover:underline">
                      {l.nome}
                    </Link>
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">{l.vendas}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{formatarReais(l.previstas)}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-alerta">{formatarReais(l.aPagar)}</td>
                  <td className="py-2 pl-2 text-right tabular-nums text-ok">{formatarReais(l.pagas)}</td>
                </tr>
              ))}
              {linhas.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-3 text-mudo">
                    Nenhuma comissão de venda ainda.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Cartao>
    </>
  );
}
