import type { Metadata } from "next";
import Link from "next/link";
import { BadgeDollarSign, CalendarClock, CircleCheck, Clock, Plus, RotateCcw, Sparkles } from "lucide-react";
import { Contador } from "@/components/abas-segmentadas";
import { FiltroAutomatico } from "@/components/filtro-automatico";
import { JanelaCadastro } from "@/components/janela-cadastro";
import { LinhaLink } from "@/components/linha-link";
import { PilulasLink } from "@/components/pilulas-link";
import { AreaTexto, Cabecalho, Campo, Celula, Entrada, Indicador, LinhaVazia, Selecao, Selo, Tabela } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { formatarDataBR, hojeISO } from "@/lib/dominio/datas";
import { formatarReais } from "@/lib/dominio/dinheiro";
import { COR_STATUS_COMISSAO, ROTULO_STATUS_COMISSAO, ROTULO_TIPO_COMISSAO, dataEsperada, totaisComissoes, valorEfetivo, type StatusComissao } from "@/lib/dominio/comissoes";
import { podeAprovarRepasse } from "@/lib/dominio/repasses";
import { AbasComissoes } from "./abas";
import { criarComissaoAvulsa, gerarComissoesAdministracao } from "./actions";
import { SELECT_COMISSAO, carregarAjustes, carregarBaseComissoes, type ComissaoLista } from "./dados";

export const metadata: Metadata = { title: "Comissões" };

const FILTROS: Record<string, string> = {
  abertas: "Em aberto",
  prevista: "Previstas",
  a_pagar: "A pagar",
  paga: "Pagas",
  estornada: "Estornadas",
  cancelada: "Canceladas",
  todas: "Todas",
};

export default async function ComissoesPage({ searchParams }: PageProps<"/comissoes">) {
  const sp = await searchParams;
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const filtro = s("f") in FILTROS ? s("f") : "abertas";
  const corretor = s("corretor");
  const tipo = s("tipo") in ROTULO_TIPO_COMISSAO ? s("tipo") : "";
  const hoje = hojeISO();
  const ano = hoje.slice(0, 4);
  const { supabase, papel } = await obterContexto();
  const pode = podeAprovarRepasse(papel);

  let q = supabase.from("comissoes").select(SELECT_COMISSAO).order("created_at", { ascending: false }).limit(1000);
  if (filtro === "abertas") q = q.in("status", ["prevista", "a_pagar"]);
  else if (filtro !== "todas") q = q.eq("status", filtro);
  if (corretor) q = q.eq("pessoa_id", corretor);
  if (tipo) q = q.eq("tipo", tipo);
  const [{ data }, { data: resumo }, base, { data: imoveis }, ajustes] = await Promise.all([
    q,
    supabase
      .from("comissoes")
      .select("status, valor, vencimento, previsao, created_at, lancamento:lancamentos!comissoes_lancamento_id_fkey(liquidado_em)")
      .or(`status.in.(prevista,a_pagar),created_at.gte.${Number(ano) - 1}-01-01`)
      .limit(10000),
    carregarBaseComissoes(supabase),
    supabase.from("imoveis").select("id, codigo").order("codigo").limit(3000),
    carregarAjustes(supabase),
  ]);
  const lista = (data ?? []) as unknown as ComissaoLista[];
  // Pagas: pela data do pagamento no Financeiro; estornadas: pela data da comissão.
  const doAno = ((resumo ?? []) as unknown as { status: StatusComissao; valor: number; vencimento: string | null; created_at: string; lancamento: { liquidado_em: string | null } | null }[]).filter(
    (c) =>
      c.status === "prevista" ||
      c.status === "a_pagar" ||
      (c.status === "paga" ? (c.lancamento?.liquidado_em ?? c.created_at).slice(0, 4) === ano : c.created_at.slice(0, 4) === ano),
  );
  const t = totaisComissoes(doAno, hoje);
  const url = (f: string) => {
    const p = new URLSearchParams(Object.entries({ f, corretor, tipo }).filter(([, v]) => v) as [string, string][]);
    return `/comissoes?${p}`;
  };

  return (
    <>
      <Cabecalho
        titulo="Comissões"
        descricao="Comissões de venda, locação, angariação e administração dos corretores. As que dependem de recebimento ficam previstas até a imobiliária receber; depois viram conta a pagar no Financeiro."
        acoes={
          pode && (
            <>
              <JanelaCadastro rotuloBotao={<><Sparkles className="size-4" /> Gerar de administração</>} variante="secundario" titulo="Comissões de administração do mês" acao={gerarComissoesAdministracao} icone={<Sparkles />} rotuloSalvar="Gerar">
                <p className="text-sm text-texto-2">
                  Para cada repasse do mês, o corretor responsável pelo imóvel recebe o % da regra “Administração” sobre a taxa de administração retida, e já vira conta a pagar (a
                  taxa foi recebida na baixa do aluguel). Não repete o que já foi gerado (uma por contrato, mês e proprietário). Se o repasse for cancelado ou a baixa desfeita, a
                  comissão ainda não paga é cancelada junto.
                </p>
                <Campo rotulo="Mês (competência)">
                  <Entrada type="month" name="mes" defaultValue={hoje.slice(0, 7)} required />
                </Campo>
                {!base.regras.some((r) => r.tipo === "administracao" && r.ativa) && (
                  <p className="text-xs text-alerta">
                    Nenhuma regra de administração ativa. Crie em{" "}
                    <Link href="/comissoes/regras" className="underline">
                      Regras e equipes
                    </Link>
                    .
                  </p>
                )}
              </JanelaCadastro>
              <JanelaCadastro rotuloBotao={<><Plus className="size-4" /> Comissão avulsa</>} titulo="Comissão avulsa" acao={criarComissaoAvulsa} icone={<BadgeDollarSign />} rotuloSalvar="Lançar">
                <Campo rotulo="Corretor ou parceiro">
                  <Selecao name="pessoa_id" required defaultValue={corretor}>
                    <option value="">Selecione…</option>
                    {base.corretores.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.nome}
                      </option>
                    ))}
                  </Selecao>
                </Campo>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Campo rotulo="Tipo">
                    <Selecao name="tipo" defaultValue="outro">
                      {Object.entries(ROTULO_TIPO_COMISSAO).map(([k, r]) => (
                        <option key={k} value={k}>
                          {r}
                        </option>
                      ))}
                    </Selecao>
                  </Campo>
                  <Campo rotulo="Valor (R$)">
                    <Entrada name="valor" required inputMode="decimal" />
                  </Campo>
                </div>
                <Campo rotulo="Descrição">
                  <Entrada name="descricao" required placeholder="Bônus da meta de outubro" />
                </Campo>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Campo rotulo="Imóvel (opcional)">
                    <Selecao name="imovel_id" defaultValue="">
                      <option value="">—</option>
                      {(imoveis ?? []).map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.codigo}
                        </option>
                      ))}
                    </Selecao>
                  </Campo>
                  <Campo rotulo="Pagar em (dias)">
                    <Entrada name="dias_pagamento" inputMode="numeric" defaultValue="30" />
                  </Campo>
                </div>
                <label className="flex items-center gap-2 text-sm text-texto">
                  <input type="hidden" name="prevista" value="" />
                  <input type="checkbox" name="prevista" /> Deixar prevista (só vira conta a pagar quando você clicar em “Liberar para pagar” na ficha)
                </label>
                <Campo rotulo="Motivo / observação">
                  <AreaTexto name="motivo" rows={2} />
                </Campo>
              </JanelaCadastro>
            </>
          )
        }
      />
      <AbasComissoes />
      <div className="entrar-cascata mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Indicador rotulo="Previstas" icone={<Clock />} valor={<Contador valor={t.previstas} formato="moeda" />} detalhe="aguardando a imobiliária receber" href={url("prevista")} />
        <Indicador rotulo="A pagar" icone={<CalendarClock />} valor={<Contador valor={t.aPagar} formato="moeda" />} detalhe={t.vencidas ? `${formatarReais(t.vencidas)} vencidas` : "no Financeiro"} tom={t.vencidas ? "perigo" : t.aPagar ? "alerta" : "neutro"} href={url("a_pagar")} />
        <Indicador rotulo={`Pagas em ${ano}`} icone={<CircleCheck />} valor={<Contador valor={t.pagas} formato="moeda" />} tom="sucesso" href={url("paga")} />
        <Indicador rotulo={`Estornadas em ${ano}`} icone={<RotateCcw />} valor={<Contador valor={t.estornadas} formato="moeda" />} href={url("estornada")} />
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <PilulasLink rotulo="Situação das comissões" ativo={url(filtro)} itens={Object.entries(FILTROS).map(([k, r]) => ({ href: url(k), rotulo: r }))} />
        <FiltroAutomatico className="filtros-linha">
          <input type="hidden" name="f" value={filtro} />
          <Selecao name="corretor" defaultValue={corretor} className="max-w-xs" aria-label="Corretor">
            <option value="">Todos os corretores</option>
            {base.corretores.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nome}
              </option>
            ))}
          </Selecao>
          <Selecao name="tipo" defaultValue={tipo} className="max-w-56" aria-label="Tipo de comissão">
            <option value="">Todos os tipos</option>
            {Object.entries(ROTULO_TIPO_COMISSAO).map(([k, r]) => (
              <option key={k} value={k}>
                {r}
              </option>
            ))}
          </Selecao>
        </FiltroAutomatico>
      </div>
      <Tabela colunas={["Data", "Corretor", "Tipo", "Origem", "Base e %", "Valor", "Paga em / previsão", "Situação"]}>
        {lista.length === 0 && <LinhaVazia colunas={8}>Nenhuma comissão nesta lista.</LinhaVazia>}
        {lista.map((c) => {
          const data = dataEsperada(c);
          return (
            <LinhaLink key={c.id} href={`/comissoes/${c.id}`}>
              <Celula>{formatarDataBR(c.created_at.slice(0, 10))}</Celula>
              <Celula>
                <span className="font-medium text-texto">{c.pessoa?.nome ?? "—"}</span>
                {c.papel && c.papel !== "corretor" && <span className="block text-xs text-mudo">{c.papel}</span>}
              </Celula>
              <Celula>{ROTULO_TIPO_COMISSAO[c.tipo]}</Celula>
              <Celula>
                <span className="text-texto">{c.descricao}</span>
                {c.venda && (
                  <Link href={`/vendas/${c.venda.id}/comissoes`} className="block text-xs text-acento hover:underline">
                    venda #{c.venda.numero}
                  </Link>
                )}
              </Celula>
              <Celula className="text-xs text-texto-2">
                {c.base !== null ? formatarReais(c.base) : "—"}
                {c.percentual !== null ? ` × ${String(Number(c.percentual)).replace(".", ",")}%` : ""}
              </Celula>
              <Celula className="font-semibold tabular-nums">
                {ajustes.has(c.id) ? (
                  <>
                    {formatarReais(valorEfetivo(c, ajustes.get(c.id)))}
                    <span className="block text-xs font-normal text-mudo">pago {formatarReais(c.valor)}, com ajustes</span>
                  </>
                ) : (
                  <>
                    {formatarReais(c.valor)}
                    {Number(c.valor) !== Number(c.valor_original) && <span className="block text-xs font-normal text-mudo">era {formatarReais(c.valor_original)}</span>}
                  </>
                )}
              </Celula>
              <Celula className={c.status === "a_pagar" && data && data < hoje ? "font-medium text-ruim" : ""}>
                {c.status === "paga" ? "paga" : data ? formatarDataBR(data) : "—"}
              </Celula>
              <Celula>
                <Selo cor={COR_STATUS_COMISSAO[c.status]}>{ROTULO_STATUS_COMISSAO[c.status]}</Selo>
                {c.condicionada && c.status === "prevista" && <span className="mt-1 block text-xs text-mudo">espera o recebimento</span>}
              </Celula>
            </LinhaLink>
          );
        })}
      </Tabela>
    </>
  );
}
