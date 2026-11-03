import type { Metadata } from "next";
import { LinhaLink } from "@/components/linha-link";
import { PilulasLink } from "@/components/pilulas-link";
import { Cabecalho, Celula, LinhaVazia, Tabela } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { hojeISO } from "@/lib/dominio/datas";
import { formatarReais } from "@/lib/dominio/dinheiro";
import { totaisComissoes, type StatusComissao } from "@/lib/dominio/comissoes";
import { AbasComissoes } from "../abas";
import { carregarBaseComissoes } from "../dados";

export const metadata: Metadata = { title: "Comissões por corretor" };

type C = { pessoa_id: string; status: StatusComissao; valor: number; vencimento: string | null; created_at: string; lancamento: { liquidado_em: string | null } | null };

/** Uma linha por corretor: previstas, a pagar, pagas e estornadas no ano. */
export default async function CorretoresPage({ searchParams }: PageProps<"/comissoes/corretores">) {
  const sp = await searchParams;
  const hoje = hojeISO();
  const ano = typeof sp.ano === "string" && /^\d{4}$/.test(sp.ano) ? sp.ano : hoje.slice(0, 4);
  const { supabase } = await obterContexto();
  const [{ data }, base] = await Promise.all([
    supabase
      .from("comissoes")
      .select("pessoa_id, status, valor, vencimento, created_at, lancamento:lancamentos!comissoes_lancamento_id_fkey(liquidado_em)")
      .or(`status.in.(prevista,a_pagar),created_at.gte.${Number(ano) - 1}-01-01`)
      .limit(20000),
    carregarBaseComissoes(supabase),
  ]);
  const lista = ((data ?? []) as unknown as C[]).filter((c) =>
    c.status === "prevista" || c.status === "a_pagar" ? true : (c.status === "paga" ? (c.lancamento?.liquidado_em ?? c.created_at) : c.created_at).slice(0, 4) === ano,
  );
  const nomeEquipe = new Map(base.equipes.map((e) => [e.id, e.nome]));
  const ids = new Set([...base.corretores.map((p) => p.id), ...lista.map((c) => c.pessoa_id)]);
  const nome = new Map(base.corretores.map((p) => [p.id, p.nome]));
  const faltam = [...ids].filter((id) => !nome.has(id));
  if (faltam.length) {
    const { data: extras } = await supabase.from("pessoas").select("id, nome").in("id", faltam);
    for (const p of extras ?? []) nome.set(p.id as string, p.nome as string);
  }
  const linhas = [...ids]
    .map((id) => ({ id, nome: nome.get(id) ?? "—", equipe: nomeEquipe.get(base.equipeDe.get(id) ?? "") ?? "", t: totaisComissoes(lista.filter((c) => c.pessoa_id === id), hoje) }))
    .sort((a, b) => b.t.pagas + b.t.aPagar + b.t.previstas - (a.t.pagas + a.t.aPagar + a.t.previstas) || a.nome.localeCompare(b.nome));
  const anos = [0, 1, 2].map((i) => String(Number(hoje.slice(0, 4)) - i));

  return (
    <>
      <Cabecalho titulo="Comissões por corretor" trilha="Comissões" descricao="Clique no corretor para ver o relatório individual (para imprimir ou mandar pelo WhatsApp)." />
      <AbasComissoes />
      <PilulasLink className="mb-5" rotulo="Ano" ativo={`/comissoes/corretores?ano=${ano}`} itens={anos.map((a) => ({ href: `/comissoes/corretores?ano=${a}`, rotulo: a }))} />
      <Tabela colunas={["Corretor", "Equipe", "Previstas", "A pagar", `Pagas em ${ano}`, `Estornadas em ${ano}`]}>
        {linhas.length === 0 && <LinhaVazia colunas={6}>Nenhum corretor ou parceiro cadastrado.</LinhaVazia>}
        {linhas.map((l) => (
          <LinhaLink key={l.id} href={`/comissoes/corretores/${l.id}?ano=${ano}`}>
            <Celula>
              <span className="font-medium text-texto">{l.nome}</span>
            </Celula>
            <Celula className="text-texto-2">{l.equipe || "—"}</Celula>
            <Celula className="tabular-nums">{formatarReais(l.t.previstas)}</Celula>
            <Celula className={`tabular-nums ${l.t.vencidas ? "text-ruim" : "text-alerta"}`}>{formatarReais(l.t.aPagar)}</Celula>
            <Celula className="tabular-nums text-ok">{formatarReais(l.t.pagas)}</Celula>
            <Celula className="tabular-nums">{formatarReais(l.t.estornadas)}</Celula>
          </LinhaLink>
        ))}
      </Tabela>
    </>
  );
}
