import type { Metadata } from "next";
import Link from "next/link";
import { BarraProgresso } from "@/components/barra-progresso";
import { NavegadorMes, lerMes } from "@/components/navegador-mes";
import { Aviso, Cabecalho, Cartao, Celula, LinhaVazia, Tabela } from "@/components/ui";
import { fimDoMes, hojeISO } from "@/lib/dominio/datas";
import { formatarReais } from "@/lib/dominio/dinheiro";
import {
  ROTULO_ALVO_META,
  ROTULO_META_EQUIPE,
  linhasDoAlvo,
  realizadoMeta,
  ritmoDoMes,
  somarProdutividade,
  type AlvoMeta,
  type TipoMetaEquipe,
} from "@/lib/dominio/equipe";
import { progressoMeta } from "@/lib/dominio/painel";
import { realizadoDoMes } from "@/lib/servicos/indicadores";
import { ROTULO_META, TIPOS_META, type TipoMeta } from "@/lib/tipos";
import { todas } from "../../financeiro/dados";
import { AbasRelatorios } from "../abas";
import { ComoCalculamos } from "../componentes";
import { carregarEquipe, contextoRelatorios } from "../dados";

export const metadata: Metadata = { title: "Relatórios · Metas" };

type MetaEquipe = { id: string; tipo: TipoMetaEquipe; alvo: AlvoMeta; pessoa_id: string | null; equipe_id: string | null; filial_id: string | null; valor: number };

function Progresso({ realizado, meta, ritmo, dinheiro }: { realizado: number; meta: number; ritmo: number; dinheiro: boolean }) {
  const prog = progressoMeta(realizado, meta);
  const fmt = (v: number) => (dinheiro ? formatarReais(v) : v.toLocaleString("pt-BR"));
  return (
    <div className="flex min-w-56 items-center gap-3">
      {prog && <BarraProgresso pct={prog.pct} atingida={prog.atingida} />}
      <span className={`w-28 shrink-0 text-right text-sm tabular-nums ${prog?.atingida ? "font-semibold text-ok" : prog && prog.pct < ritmo ? "text-alerta" : "text-texto-2"}`}>
        {fmt(realizado)} / {fmt(meta)}
      </span>
    </div>
  );
}

export default async function MetasRelatorioPage({ searchParams }: PageProps<"/relatorios/metas">) {
  const sp = await searchParams;
  const hoje = hojeISO();
  const mes = lerMes(sp.mes, hoje);
  const ini = `${mes}-01`;
  const fim = fimDoMes(ini) < hoje ? fimDoMes(ini) : hoje;
  const { supabase, imob, corretor } = await contextoRelatorios();
  const ritmo = ritmoDoMes(ini, hoje);

  const [{ data: geraisData }, realizado, receitas, { data: metasEqData }, linhas, nomes] = await Promise.all([
    corretor ? Promise.resolve({ data: [] }) : supabase.from("metas").select("tipo, valor").eq("competencia", ini),
    corretor ? Promise.resolve(null) : realizadoDoMes(supabase, mes),
    corretor
      ? Promise.resolve([] as { valor: number }[])
      : todas<{ valor: number }>(() =>
          supabase.from("lancamentos").select("valor").eq("tipo", "receber").eq("status", "liquidado").gte("liquidado_em", ini).lte("liquidado_em", fimDoMes(ini)).order("id"),
        ).catch(() => [] as { valor: number }[]),
    imob ? supabase.from("equipe_metas").select("id, tipo, alvo, pessoa_id, equipe_id, filial_id, valor").eq("competencia", ini).order("created_at") : Promise.resolve({ data: [] }),
    imob && ini <= hoje ? carregarEquipe(supabase, ini, fim) : Promise.resolve([]),
    imob
      ? Promise.all([supabase.from("pessoas").select("id, nome").or("colaborador.eq.true,papeis.cs.{corretor}").limit(2000), supabase.from("equipes").select("id, nome"), supabase.from("filiais").select("id, nome")])
      : Promise.resolve(null),
  ]);
  const real: Record<TipoMeta, number> | null = realizado ? { ...realizado, faturamento: receitas.reduce((s, r) => s + Number(r.valor), 0) } : null;
  const gerais = ((geraisData ?? []) as { tipo: TipoMeta; valor: number }[])
    .filter((g) => (TIPOS_META as readonly string[]).includes(g.tipo) && Number(g.valor) > 0 && !(!imob && g.tipo === "vendas"))
    .sort((a, b) => TIPOS_META.indexOf(a.tipo) - TIPOS_META.indexOf(b.tipo));
  const minhas = corretor ? new Set(linhas.map((l) => l.pessoa_id)) : null;
  const metasEq = ((metasEqData ?? []) as MetaEquipe[]).filter((m) => !minhas || (m.alvo === "pessoa" && m.pessoa_id && minhas.has(m.pessoa_id)));
  const mapa = (rows: { data: unknown } | undefined) => new Map(((rows?.data ?? []) as { id: string; nome: string }[]).map((r) => [r.id, r.nome]));
  const nomeAlvo = (m: MetaEquipe) => {
    if (!nomes) return "—";
    const [p, e, f] = nomes;
    if (m.alvo === "pessoa") return mapa(p).get(m.pessoa_id ?? "") ?? "Colaborador";
    if (m.alvo === "equipe") return mapa(e).get(m.equipe_id ?? "") ?? "Equipe";
    return mapa(f).get(m.filial_id ?? "") ?? "Filial";
  };

  return (
    <>
      <Cabecalho
        titulo="Acompanhamento de metas"
        trilha="Relatórios"
        descricao={
          imob ? (
            <>
              Metas do mês e quanto já foi realizado.{" "}
              {!corretor && (
                <>
                  Para definir as metas, use{" "}
                  <Link href="/equipe/metas" className="text-acento hover:underline">
                    Equipe → Metas
                  </Link>{" "}
                  ou{" "}
                  <Link href="/comercial/metas" className="text-acento hover:underline">
                    Comercial → Metas
                  </Link>
                  .
                </>
              )}
            </>
          ) : (
            "Metas do mês e quanto já foi realizado."
          )
        }
      />
      <AbasRelatorios />
      <div className="nao-imprimir mb-5">
        <NavegadorMes caminho="/relatorios/metas" mes={mes} hoje={hoje} />
      </div>
      {ritmo > 0 && ritmo < 100 && <p className="mb-4 text-sm text-texto-2">Já passou {ritmo}% do mês: meta abaixo desse ritmo aparece em amarelo.</p>}

      {!corretor && (
        <div className="mb-6">
          <Cartao titulo={imob ? "Metas gerais da imobiliária" : "Metas do mês"}>
            {gerais.length === 0 || !real ? (
              <Aviso>Nenhuma meta definida para este mês.</Aviso>
            ) : (
              <ul className="space-y-4">
                {gerais.map((g) => (
                  <li key={g.tipo} className="grid items-center gap-3 md:grid-cols-[240px_1fr]">
                    <span className="font-medium text-texto">{ROTULO_META[g.tipo]}</span>
                    <Progresso realizado={real[g.tipo]} meta={Number(g.valor)} ritmo={ritmo} dinheiro={g.tipo === "faturamento"} />
                  </li>
                ))}
              </ul>
            )}
          </Cartao>
        </div>
      )}

      {imob && (
        <Cartao titulo={corretor ? "Minhas metas" : "Metas individuais e coletivas"}>
          <Tabela colunas={["Meta", "De quem", "Tipo", "Realizado / meta"]}>
            {metasEq.length === 0 && <LinhaVazia colunas={4}>Nenhuma meta individual ou coletiva neste mês.</LinhaVazia>}
            {metasEq.map((m) => {
              const t = somarProdutividade(linhasDoAlvo(linhas, m.alvo, (m.pessoa_id ?? m.equipe_id ?? m.filial_id) as string));
              return (
                <tr key={m.id}>
                  <Celula className="font-medium">{ROTULO_META_EQUIPE[m.tipo]}</Celula>
                  <Celula>{nomeAlvo(m)}</Celula>
                  <Celula className="text-sm text-texto-2">{ROTULO_ALVO_META[m.alvo]}</Celula>
                  <Celula>
                    <Progresso realizado={realizadoMeta(m.tipo, t)} meta={Number(m.valor)} ritmo={ritmo} dinheiro={m.tipo === "valor_vendas"} />
                  </Celula>
                </tr>
              );
            })}
          </Tabela>
        </Cartao>
      )}

      <ComoCalculamos
        itens={[
          ["Realizado", "Calculado sozinho a partir do que foi registrado no mês (mesma conta do Painel e da Equipe)."],
          ["Faturamento", "Lançamentos a receber pagos no mês (Financeiro)."],
          ["Ritmo", "Comparação com a parte do mês que já passou: em amarelo, a meta está abaixo do ritmo."],
          ...(imob ? ([["Metas da equipe", "Individuais (por colaborador) e coletivas (por equipe ou filial), com os números do desempenho da equipe."]] as [string, string][]) : []),
        ]}
      />
    </>
  );
}
