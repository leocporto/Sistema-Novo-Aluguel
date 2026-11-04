import type { Metadata } from "next";
import Link from "next/link";
import { Copy, Target } from "lucide-react";
import { BarraProgresso } from "@/components/barra-progresso";
import { BotaoAcao } from "@/components/botao-acao";
import { BotaoExcluir } from "@/components/botao-excluir";
import { Formulario } from "@/components/formulario";
import { JanelaCadastro } from "@/components/janela-cadastro";
import { NavegadorMes, lerMes } from "@/components/navegador-mes";
import { Cabecalho, Campo, Cartao, Entrada, Selecao } from "@/components/ui";
import { fimDoMes, hojeISO } from "@/lib/dominio/datas";
import { formatarReais } from "@/lib/dominio/dinheiro";
import {
  ALVOS_META,
  ROTULO_ALVO_META,
  ROTULO_META_EQUIPE,
  TIPOS_META_EQUIPE,
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
import { exigirVerRota } from "@/lib/permissoes";
import { AbasEquipe } from "../abas";
import { copiarMetasDoMesAnterior, criarMeta, excluirMeta, salvarMeta } from "../actions";
import { carregarColaboradores, carregarEstrutura, carregarMembros, carregarProdutividade, contextoEquipe, opcoesColaboradores } from "../dados";

export const metadata: Metadata = { title: "Metas da equipe" };

type Meta = { id: string; tipo: TipoMetaEquipe; alvo: AlvoMeta; pessoa_id: string | null; equipe_id: string | null; filial_id: string | null; valor: number };

export default async function MetasEquipePage({ searchParams }: PageProps<"/equipe/metas">) {
  await exigirVerRota("/equipe");
  const sp = await searchParams;
  const hoje = hojeISO();
  const mes = lerMes(sp.mes, hoje);
  const ini = `${mes}-01`;
  const fim = fimDoMes(ini) < hoje ? fimDoMes(ini) : hoje;
  const { supabase, pode } = await contextoEquipe();
  const podeEditar = pode("equipe", "editar");
  const membros = await carregarMembros(supabase);
  const [{ data }, estrutura, colaboradores, linhas, { data: geraisData }, realizadoGeral] = await Promise.all([
    supabase.from("equipe_metas").select("id, tipo, alvo, pessoa_id, equipe_id, filial_id, valor").eq("competencia", ini).order("created_at"),
    carregarEstrutura(supabase),
    carregarColaboradores(supabase, membros),
    ini <= hoje ? carregarProdutividade(supabase, ini, fim) : Promise.resolve([]),
    supabase.from("metas").select("tipo, valor").eq("competencia", ini),
    realizadoDoMes(supabase, mes),
  ]);
  // Metas gerais da imobiliária (Comercial → Metas), no mesmo lugar das individuais e coletivas.
  const gerais = ((geraisData ?? []) as { tipo: TipoMeta; valor: number }[])
    .filter((g) => (TIPOS_META as readonly string[]).includes(g.tipo) && Number(g.valor) > 0)
    .sort((a, b) => TIPOS_META.indexOf(a.tipo) - TIPOS_META.indexOf(b.tipo));
  const metas = (data ?? []) as Meta[];
  const nomes: Record<AlvoMeta, Map<string, string>> = {
    pessoa: new Map(colaboradores.map((c) => [c.id, c.nome])),
    equipe: new Map(estrutura.equipes.map((e) => [e.id, e.nome])),
    filial: new Map(estrutura.filiais.map((f) => [f.id, f.nome])),
  };
  const ritmo = ritmoDoMes(ini, hoje);
  const idDe = (m: Meta) => (m.pessoa_id ?? m.equipe_id ?? m.filial_id) as string;

  return (
    <>
      <Cabecalho
        titulo="Metas da equipe"
        trilha="Equipe"
        descricao={
          <>
            Metas individuais (por colaborador) e coletivas (por equipe ou filial), junto com as metas gerais da imobiliária (definidas em{" "}
            <Link href="/comercial/metas" className="text-acento hover:underline">
              Comercial → Metas
            </Link>
            ). O realizado é calculado sozinho.
          </>
        }
        acoes={
          podeEditar && (
            <>
              <BotaoAcao acao={copiarMetasDoMesAnterior} id={mes} confirmar="Copiar as metas do mês anterior para este mês? As que já existem aqui ficam como estão.">
                <Copy className="size-4" /> Copiar do mês anterior
              </BotaoAcao>
              <JanelaCadastro rotuloBotao={<><Target className="size-4" /> Nova meta</>} titulo="Nova meta" acao={criarMeta} icone={<Target />} rotuloSalvar="Criar">
                <input type="hidden" name="mes" value={mes} />
                <Campo rotulo="Tipo de meta">
                  <Selecao name="alvo" defaultValue="pessoa">
                    {ALVOS_META.map((a) => (
                      <option key={a} value={a}>
                        {ROTULO_ALVO_META[a]}
                      </option>
                    ))}
                  </Selecao>
                </Campo>
                <div className="grid gap-4 sm:grid-cols-3">
                  <Campo rotulo="Colaborador">
                    <Selecao name="pessoa_id" defaultValue="">
                      <option value="">—</option>
                      {opcoesColaboradores(colaboradores, hoje).map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.nome}
                        </option>
                      ))}
                    </Selecao>
                  </Campo>
                  <Campo rotulo="Equipe">
                    <Selecao name="equipe_id" defaultValue="">
                      <option value="">—</option>
                      {estrutura.equipes.map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.nome}
                        </option>
                      ))}
                    </Selecao>
                  </Campo>
                  <Campo rotulo="Filial">
                    <Selecao name="filial_id" defaultValue="">
                      <option value="">—</option>
                      {estrutura.filiais.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.nome}
                        </option>
                      ))}
                    </Selecao>
                  </Campo>
                </div>
                <p className="text-xs text-mudo">Preencha só o campo do tipo escolhido (colaborador, equipe ou filial).</p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Campo rotulo="O que medir">
                    <Selecao name="tipo" defaultValue="visitas">
                      {TIPOS_META_EQUIPE.map((t) => (
                        <option key={t} value={t}>
                          {ROTULO_META_EQUIPE[t]}
                        </option>
                      ))}
                    </Selecao>
                  </Campo>
                  <Campo rotulo="Meta do mês">
                    <Entrada name="valor" required inputMode="decimal" />
                  </Campo>
                </div>
              </JanelaCadastro>
            </>
          )
        }
      />
      <AbasEquipe />
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <NavegadorMes caminho="/equipe/metas" mes={mes} hoje={hoje} />
        <span className="text-sm text-mudo">{ini <= hoje ? `O mês está ${ritmo}% andado.` : "Mês que ainda não começou."}</span>
      </div>
      {gerais.length > 0 && (
        <Cartao
          titulo="Metas gerais da imobiliária"
          className="mb-6"
          acoes={
            <Link href={`/comercial/metas?mes=${mes}`} className="text-sm text-acento hover:underline">
              Mudar em Comercial → Metas
            </Link>
          }
        >
          <ul className="space-y-4">
            {gerais.map((g) => {
              const prog = progressoMeta(realizadoGeral[g.tipo], Number(g.valor));
              const fmt = (v: number) => (g.tipo === "faturamento" ? formatarReais(v) : String(v));
              return (
                <li key={g.tipo} className="grid items-center gap-3 md:grid-cols-[260px_140px_1fr_70px]">
                  <div>
                    <span className="font-medium text-texto">{ROTULO_META[g.tipo]}</span>
                    <div className="text-xs text-mudo">feito: {fmt(realizadoGeral[g.tipo])}</div>
                  </div>
                  <span className="text-sm text-texto-2">meta {fmt(Number(g.valor))}</span>
                  <BarraProgresso pct={prog?.pct ?? 0} atingida={Boolean(prog?.atingida)} />
                  <span className={`text-right text-sm font-semibold tabular-nums ${prog?.atingida ? "text-ok" : "text-texto-2"}`}>{prog?.pct ?? 0}%</span>
                </li>
              );
            })}
          </ul>
        </Cartao>
      )}
      {metas.length === 0 ? (
        <div className="rounded-card border border-borda bg-card px-5 py-10 text-center text-sm text-mudo">Nenhuma meta individual ou coletiva neste mês.</div>
      ) : (
        <div className="space-y-6">
          {ALVOS_META.map((alvo) => {
            const doAlvo = metas.filter((m) => m.alvo === alvo).sort((a, b) => (nomes[alvo].get(idDe(a)) ?? "").localeCompare(nomes[alvo].get(idDe(b)) ?? "", "pt-BR"));
            if (!doAlvo.length) return null;
            return (
              <Cartao key={alvo} titulo={alvo === "pessoa" ? "Individuais" : alvo === "equipe" ? "Por equipe" : "Por filial"}>
                <ul className="space-y-4">
                  {doAlvo.map((m) => {
                    const feito = realizadoMeta(m.tipo, somarProdutividade(linhasDoAlvo(linhas, alvo, idDe(m))));
                    const prog = progressoMeta(feito, Number(m.valor));
                    const fmt = (v: number) => (m.tipo === "valor_vendas" ? formatarReais(v) : String(v));
                    const atrasada = !prog?.atingida && (prog?.pct ?? 0) < ritmo;
                    return (
                      <li key={m.id} className="grid items-center gap-3 md:grid-cols-[260px_140px_1fr_70px_32px]">
                        <div>
                          {alvo === "pessoa" ? (
                            <Link href={`/equipe/colaboradores/${m.pessoa_id}/desempenho`} className="font-medium text-texto hover:underline">
                              {nomes.pessoa.get(idDe(m)) ?? "—"}
                            </Link>
                          ) : (
                            <span className="font-medium text-texto">{nomes[alvo].get(idDe(m)) ?? "—"}</span>
                          )}
                          <div className="text-xs text-mudo">
                            {ROTULO_META_EQUIPE[m.tipo]} · feito: {fmt(feito)}
                          </div>
                        </div>
                        {podeEditar ? (
                          <Formulario acao={salvarMeta} automatico semAviso className="">
                            <input type="hidden" name="id" value={m.id} />
                            <Entrada name="valor" required inputMode="decimal" defaultValue={String(Number(m.valor))} aria-label={`Meta de ${ROTULO_META_EQUIPE[m.tipo]}`} className="!min-h-10 !text-sm" />
                          </Formulario>
                        ) : (
                          <span className="text-sm text-texto-2">meta {fmt(Number(m.valor))}</span>
                        )}
                        <BarraProgresso pct={prog?.pct ?? 0} atingida={Boolean(prog?.atingida)} />
                        <span className={`text-right text-sm font-semibold tabular-nums ${prog?.atingida ? "text-ok" : atrasada ? "text-alerta" : "text-texto-2"}`}>{prog?.pct ?? 0}%</span>
                        {podeEditar ? <BotaoExcluir acao={excluirMeta} id={m.id} rotulo="Excluir meta" confirmar="Excluir esta meta?" /> : <span />}
                      </li>
                    );
                  })}
                </ul>
              </Cartao>
            );
          })}
          {podeEditar && <p className="text-right text-xs text-mudo">Mudanças nos números são salvas automaticamente.</p>}
        </div>
      )}
    </>
  );
}
