import type { Metadata } from "next";
import { CheckCircle2, ClipboardList, Hammer, PencilLine, Plus, StopCircle } from "lucide-react";
import { BarraProgresso } from "@/components/barra-progresso";
import { BotaoAcao } from "@/components/botao-acao";
import { BotaoExcluir } from "@/components/botao-excluir";
import { JanelaCadastro } from "@/components/janela-cadastro";
import { PilulasLink } from "@/components/pilulas-link";
import { Campo, Cartao, Celula, Entrada, Grade, LinhaVazia, Selecao, Selo, Tabela } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { CATEGORIAS_DESPESA, CATEGORIAS_RECEITA, CRITERIOS_RATEIO, TIPOS_RATEIO, baseDoOrcamento, parcelaDoRateio, previstoRealizado } from "@/lib/dominio/condominios";
import { formatarCompetencia, hojeISO } from "@/lib/dominio/datas";
import { formatarReais, paraCentavos, paraReais } from "@/lib/dominio/dinheiro";
import { adicionarItemOrcamento, criarOrcamento, criarRateio, encerrarRateio, excluirItemOrcamento, excluirOrcamento, excluirRateio, statusOrcamento } from "../../actions";
import { contasDo } from "../../dados";

export const metadata: Metadata = { title: "Orçamento do condomínio" };

const ABREV = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** Orçamento anual (valor mensal por categoria) → base da cota; previsto × realizado; rateios extras (obra, fundo, chamada de capital). */
export default async function OrcamentoPage({ params, searchParams }: PageProps<"/condominios/[id]/orcamento">) {
  const { id } = await params;
  const sp = await searchParams;
  const hoje = hojeISO();
  const anoAtual = Number(hoje.slice(0, 4));
  const ano = typeof sp.ano === "string" && /^\d{4}$/.test(sp.ano) ? Number(sp.ano) : anoAtual;
  const { supabase } = await obterContexto();
  const [{ data: orcs }, { data: pr }, { data: rateios }, contas, { data: assembleias }] = await Promise.all([
    supabase.from("cond_orcamentos").select("id, ano, descricao, status, aprovado_em, itens:cond_orcamento_itens(id, categoria, tipo, valor_mensal, observacao)").eq("condominio_id", id).eq("ano", ano).order("created_at"),
    supabase.rpc("cond_previsto_realizado", { p_condominio: id, p_ano: ano }),
    supabase.from("cond_rateios").select("id, descricao, tipo, valor_total, parcelas, primeira_competencia, criterio, ativo").eq("condominio_id", id).order("created_at", { ascending: false }),
    contasDo(supabase, id),
    supabase.from("cond_assembleias").select("id, titulo").eq("condominio_id", id).in("status", ["em_andamento", "encerrada"]).order("data", { ascending: false }).limit(30),
  ]);
  type Item = { id: string; categoria: string; tipo: string; valor_mensal: number; observacao: string | null };
  const lista = (orcs ?? []) as { id: string; ano: number; descricao: string | null; status: string; aprovado_em: string | null; itens: Item[] }[];
  const dados = (pr ?? { previsto: [], realizado: [] }) as { previsto: { categoria: string; tipo: string; mensal: number }[]; realizado: { categoria: string; tipo: string; mes: number; valor: number }[] };
  const ateMes = ano < anoAtual ? 12 : ano > anoAtual ? 1 : Number(hoje.slice(5, 7));
  const linhas = previstoRealizado(dados.previsto, dados.realizado, ateMes);
  const base = `/condominios/${id}/orcamento`;
  const compAtual = `${hoje.slice(0, 7)}-01`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PilulasLink
          rotulo="Ano do orçamento"
          ativo={ano === anoAtual ? base : `${base}?ano=${ano}`}
          itens={[anoAtual - 1, anoAtual, anoAtual + 1].map((a) => ({ href: a === anoAtual ? base : `${base}?ano=${a}`, rotulo: String(a) }))}
        />
        <JanelaCadastro rotuloBotao={<><Plus className="size-4" /> Novo orçamento</>} titulo="Novo orçamento anual" acao={criarOrcamento} icone={<ClipboardList />}>
          <input type="hidden" name="condominio_id" value={id} />
          <Grade colunas={2}>
            <Campo rotulo="Ano">
              <Entrada name="ano" type="number" defaultValue={ano} />
            </Campo>
            <Campo rotulo="Descrição">
              <Entrada name="descricao" placeholder="Ex.: Proposta da AGO" />
            </Campo>
          </Grade>
          <label className="flex items-center gap-2 text-sm text-texto-2">
            <input type="hidden" name="copiar" value="off" />
            <input type="checkbox" name="copiar" defaultChecked className="size-4 accent-[var(--accent)]" /> Copiar os itens do orçamento aprovado do ano anterior
          </label>
        </JanelaCadastro>
      </div>

      {lista.length === 0 && <Cartao><p className="text-sm text-mudo">Nenhum orçamento para {ano}. Sem orçamento aprovado, a cota é gerada informando o total do mês.</p></Cartao>}

      {lista.map((o) => {
        const total = baseDoOrcamento(o.itens);
        const aprovado = o.status === "aprovado";
        return (
          <Cartao
            key={o.id}
            titulo={
              <span className="flex items-center gap-2">
                Orçamento {o.ano}
                {o.descricao ? ` — ${o.descricao}` : ""}
                <Selo cor={aprovado ? "verde" : "cinza"}>{aprovado ? "aprovado" : "rascunho"}</Selo>
              </span>
            }
            acoes={
              <span className="flex gap-2">
                {aprovado ? (
                  <BotaoAcao acao={statusOrcamento} id={`${o.id}|rascunho`} tamanho="sm" confirmar="Voltar para rascunho? A cota do próximo mês vai precisar do valor informado à mão até aprovar de novo.">
                    <PencilLine className="size-3.5" /> Voltar para rascunho
                  </BotaoAcao>
                ) : (
                  <>
                    <BotaoAcao acao={statusOrcamento} id={`${o.id}|aprovado`} tamanho="sm" variante="primario" confirmar={`Aprovar o orçamento de ${o.ano}? A cota passa a ser calculada com ${formatarReais(paraReais(total))} por mês.`}>
                      <CheckCircle2 className="size-3.5" /> Aprovar
                    </BotaoAcao>
                    <BotaoExcluir acao={excluirOrcamento} id={o.id} rotulo="Excluir orçamento" confirmar="Excluir este rascunho de orçamento?" />
                  </>
                )}
              </span>
            }
          >
            <Tabela colunas={["Categoria", "Tipo", "Por mês", "No ano", ""]}>
              {o.itens
                .sort((a, b) => a.tipo.localeCompare(b.tipo) || Number(b.valor_mensal) - Number(a.valor_mensal))
                .map((i) => (
                  <tr key={i.id}>
                    <Celula>
                      {i.categoria}
                      {i.observacao && <span className="block text-xs text-mudo">{i.observacao}</span>}
                    </Celula>
                    <Celula>
                      <Selo cor={i.tipo === "despesa" ? "cinza" : "verde"}>{i.tipo === "despesa" ? "despesa" : "outra receita"}</Selo>
                    </Celula>
                    <Celula className="tabular-nums">{formatarReais(i.valor_mensal)}</Celula>
                    <Celula className="tabular-nums text-texto-2">{formatarReais(paraReais(paraCentavos(i.valor_mensal) * 12))}</Celula>
                    <Celula>{!aprovado && <BotaoExcluir acao={excluirItemOrcamento} id={i.id} rotulo="Excluir item" confirmar={`Tirar ${i.categoria} do orçamento?`} />}</Celula>
                  </tr>
                ))}
              {o.itens.length === 0 && <LinhaVazia colunas={5}>Sem itens ainda.</LinhaVazia>}
              <tr>
                <Celula className="font-semibold">Base da cota (despesas − outras receitas)</Celula>
                <Celula />
                <Celula className="font-semibold tabular-nums">{formatarReais(paraReais(total))}</Celula>
                <Celula className="font-semibold tabular-nums">{formatarReais(paraReais(total * 12))}</Celula>
                <Celula />
              </tr>
            </Tabela>
            {!aprovado && (
              <div className="mt-4">
                <JanelaCadastro rotuloBotao={<><Plus className="size-4" /> Item</>} variante="secundario" titulo="Item do orçamento" acao={adicionarItemOrcamento}>
                  <input type="hidden" name="condominio_id" value={id} />
                  <input type="hidden" name="orcamento_id" value={o.id} />
                  <Grade colunas={2}>
                    <Campo rotulo="Categoria">
                      <Entrada name="categoria" required list="categorias-orc" />
                    </Campo>
                    <Campo rotulo="Tipo">
                      <Selecao name="tipo" defaultValue="despesa">
                        <option value="despesa">Despesa</option>
                        <option value="receita">Outra receita (abate da cota)</option>
                      </Selecao>
                    </Campo>
                    <Campo rotulo="Valor por mês (R$)">
                      <Entrada name="valor_mensal" required inputMode="decimal" />
                    </Campo>
                    <Campo rotulo="Observação">
                      <Entrada name="observacao" />
                    </Campo>
                  </Grade>
                  <datalist id="categorias-orc">
                    {[...CATEGORIAS_DESPESA, ...CATEGORIAS_RECEITA].map((c) => (
                      <option key={c} value={c} />
                    ))}
                  </datalist>
                </JanelaCadastro>
              </div>
            )}
          </Cartao>
        );
      })}

      <Cartao titulo={`Previsto × realizado em ${ano} (até ${ABREV[ateMes - 1]})`}>
        {linhas.length === 0 ? (
          <p className="text-sm text-mudo">Sem orçamento aprovado nem lançamentos pagos em {ano}.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-[900px] border-collapse text-sm">
              <thead>
                <tr className="font-mono text-[10px] uppercase tracking-[0.12em] text-mudo">
                  <th className="px-2 py-2 text-left">Categoria</th>
                  {ABREV.map((m) => (
                    <th key={m} className="px-2 py-2 text-right">
                      {m}
                    </th>
                  ))}
                  <th className="px-2 py-2 text-right">Previsto</th>
                  <th className="px-2 py-2 text-right">Realizado</th>
                  <th className="px-2 py-2 text-left">Uso</th>
                </tr>
              </thead>
              <tbody>
                {linhas.map((l) => (
                  <tr key={`${l.tipo}|${l.categoria}`} className="border-t border-borda-suave">
                    <td className="px-2 py-2 text-texto">
                      {l.categoria}
                      {l.tipo === "receita" && <span className="ml-1 text-xs text-ok">receita</span>}
                    </td>
                    {l.meses.map((v, i) => (
                      <td key={i} className="px-2 py-2 text-right tabular-nums text-texto-2">
                        {v ? paraReais(v).toLocaleString("pt-BR", { maximumFractionDigits: 0 }) : ""}
                      </td>
                    ))}
                    <td className="px-2 py-2 text-right tabular-nums">{formatarReais(paraReais(l.previstoAte))}</td>
                    <td className={`px-2 py-2 text-right tabular-nums font-medium ${l.tipo === "despesa" && l.diferenca > 0 ? "text-ruim" : "text-texto"}`}>{formatarReais(paraReais(l.realizadoAte))}</td>
                    <td className="w-40 px-2 py-2">
                      {l.pct != null ? (
                        <div className="space-y-1">
                          <BarraProgresso pct={l.pct} atingida={l.tipo === "receita" ? l.pct >= 100 : l.pct <= 100} />
                          <span className="text-[11px] text-mudo">{l.pct.toLocaleString("pt-BR")}%</span>
                        </div>
                      ) : (
                        <span className="text-xs text-alerta">fora do orçamento</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Cartao>

      <Cartao
        titulo="Rateios extras (obra, fundo de reserva, chamada de capital)"
        acoes={
          <JanelaCadastro rotuloBotao={<><Hammer className="size-4" /> Novo rateio</>} variante="secundario" tamanho="sm" titulo="Rateio extra" acao={criarRateio} icone={<Hammer />}>
            <input type="hidden" name="condominio_id" value={id} />
            <Campo rotulo="Descrição">
              <Entrada name="descricao" required placeholder="Ex.: Pintura da fachada" />
            </Campo>
            <Grade colunas={2}>
              <Campo rotulo="Tipo">
                <Selecao name="tipo" defaultValue="obra">
                  {Object.entries(TIPOS_RATEIO).map(([k, r]) => (
                    <option key={k} value={k}>
                      {r}
                    </option>
                  ))}
                </Selecao>
              </Campo>
              <Campo rotulo="Como dividir">
                <Selecao name="criterio" defaultValue="fracao">
                  {Object.entries(CRITERIOS_RATEIO).map(([k, r]) => (
                    <option key={k} value={k}>
                      {r}
                    </option>
                  ))}
                </Selecao>
              </Campo>
              <Campo rotulo="Valor total (R$)">
                <Entrada name="valor_total" required inputMode="decimal" />
              </Campo>
              <Campo rotulo="Parcelas (meses)">
                <Entrada name="parcelas" type="number" min={1} max={120} defaultValue={1} />
              </Campo>
              <Campo rotulo="Primeira cota">
                <Entrada name="primeira" type="month" defaultValue={hoje.slice(0, 7)} />
              </Campo>
              <Campo rotulo="Vai para a conta">
                <Selecao name="conta_id" defaultValue="">
                  <option value="">Automático (fundo de reserva vai para o fundo)</option>
                  {contas.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nome}
                    </option>
                  ))}
                </Selecao>
              </Campo>
              <Campo rotulo="Aprovado na assembleia">
                <Selecao name="assembleia_id" defaultValue="">
                  <option value="">—</option>
                  {(assembleias ?? []).map((a) => (
                    <option key={a.id as string} value={a.id as string}>
                      {a.titulo as string}
                    </option>
                  ))}
                </Selecao>
              </Campo>
            </Grade>
          </JanelaCadastro>
        }
      >
        {(rateios ?? []).length === 0 ? (
          <p className="text-sm text-mudo">Nenhum rateio extra.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {(rateios ?? []).map((r) => {
              const p = parcelaDoRateio(
                { id: r.id as string, descricao: r.descricao as string, valorTotal: paraCentavos(r.valor_total as number), parcelas: r.parcelas as number, primeiraCompetencia: r.primeira_competencia as string, criterio: r.criterio as "fracao" },
                compAtual,
              );
              return (
                <li key={r.id as string} className={`flex flex-wrap items-center justify-between gap-2 rounded-[12px] border border-borda bg-elev px-3 py-2 ${r.ativo ? "" : "opacity-60"}`}>
                  <span>
                    <b className="text-texto">{r.descricao as string}</b> · {TIPOS_RATEIO[r.tipo as keyof typeof TIPOS_RATEIO]} · {formatarReais(r.valor_total as number)} em {r.parcelas as number}x desde{" "}
                    {formatarCompetencia(r.primeira_competencia as string)} · {CRITERIOS_RATEIO[r.criterio as keyof typeof CRITERIOS_RATEIO].toLowerCase()}
                    {r.ativo && p && <span className="ml-1 text-acento">(este mês: parcela {p.k}, {formatarReais(paraReais(p.valor))})</span>}
                    {!r.ativo && <Selo cor="cinza">encerrado</Selo>}
                  </span>
                  <span className="flex gap-2">
                    {Boolean(r.ativo) && (
                      <BotaoAcao acao={encerrarRateio} id={r.id as string} tamanho="sm" confirmar="Encerrar este rateio? Ele para de entrar nas próximas cotas.">
                        <StopCircle className="size-3.5" /> Encerrar
                      </BotaoAcao>
                    )}
                    <BotaoExcluir acao={excluirRateio} id={r.id as string} rotulo="Excluir rateio" confirmar="Excluir este rateio? Só dá se ainda não entrou em nenhuma cota." />
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Cartao>
    </div>
  );
}
