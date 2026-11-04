import type { Metadata } from "next";
import { AlarmClock, Download, Landmark, Plus, ShieldCheck, TrendingDown, TrendingUp } from "lucide-react";
import { Contador } from "@/components/abas-segmentadas";
import { BotaoExcluir } from "@/components/botao-excluir";
import { FiltroAutomatico } from "@/components/filtro-automatico";
import { JanelaCadastro } from "@/components/janela-cadastro";
import { LinhaLink } from "@/components/linha-link";
import { NavegadorMes, lerMes } from "@/components/navegador-mes";
import { PilulasLink } from "@/components/pilulas-link";
import { AreaTexto, BotaoLink, Cabecalho, classeBotao, Campo, Celula, Entrada, Indicador, LinhaVazia, Selecao, Selo, Tabela } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { fimDoMes, formatarDataBR, hojeISO } from "@/lib/dominio/datas";
import { formatarReais, paraCentavos, paraReais } from "@/lib/dominio/dinheiro";
import { FORMAS_PAGAMENTO, ROTULO_SITUACAO, situacaoLancamento, valorRealizado } from "@/lib/dominio/financeiro";
import { AbasFinanceiro } from "./abas";
import { criarLancamento, excluirLancamento } from "./actions";
import { CampoJaPago, CamposRepeticao } from "./campos";
import { opcoesFinanceiro, saldosDasContas, todas, type Lancamento } from "./dados";

export const metadata: Metadata = { title: "Financeiro" };

const FILTROS: Record<string, string> = {
  "": "Todos",
  pagar: "A pagar",
  receber: "A receber",
  vencidos: "Vencidos",
  baixados: "Baixados",
  aprovar: "A aprovar",
  cancelados: "Cancelados",
};

const COR_SITUACAO = { aberto: "azul", vencido: "vermelho", liquidado: "verde", cancelado: "cinza", aguardando_aprovacao: "amarelo" } as const;

export default async function FinanceiroPage({ searchParams }: PageProps<"/financeiro">) {
  const sp = await searchParams;
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const hoje = hojeISO();
  const mes = lerMes(sp.mes, hoje);
  const filtro = s("filtro") in FILTROS ? s("filtro") : "";
  const f = { busca: s("busca"), conta: s("conta"), plano: s("plano"), centro: s("centro") };
  const { supabase, organizacao } = await obterContexto();
  const pessoal = organizacao.modo === "pessoal";
  const de = `${mes}-01`;
  const ate = fimDoMes(de);

  // Vencidos e "a aprovar" mostram tudo, de qualquer mês.
  const todosOsMeses = filtro === "vencidos" || filtro === "aprovar";
  let q = supabase.from("lancamentos").select("*, pessoa:pessoas!lancamentos_pessoa_id_fkey(nome), plano:plano_contas(codigo, nome), conta:contas_financeiras(nome)").order("vencimento").limit(1000);
  if (!todosOsMeses) q = q.gte("vencimento", de).lte("vencimento", ate);
  if (filtro === "pagar" || filtro === "receber") q = q.eq("tipo", filtro).neq("status", "cancelado");
  if (filtro === "vencidos") q = q.eq("status", "aberto").lt("vencimento", hoje);
  if (filtro === "baixados") q = q.eq("status", "liquidado");
  if (filtro === "aprovar") q = q.eq("status", "aberto").eq("requer_aprovacao", true).is("aprovado_em", null);
  if (filtro === "cancelados") q = q.eq("status", "cancelado");
  if (filtro === "") q = q.neq("status", "cancelado");
  if (f.conta) q = q.eq("conta_id", f.conta);
  if (f.plano) q = q.eq("plano_id", f.plano);
  if (f.centro) q = q.eq("centro_custo_id", f.centro);
  if (f.busca) {
    const b = f.busca.replace(/[%,()]/g, " ").trim();
    q = q.or(`descricao.ilike.%${b}%,categoria.ilike.%${b}%,documento_numero.ilike.%${b}%`);
  }

  const [{ data }, op, doMes, { count: vencidos }, { count: aAprovar }, { data: imoveis }] = await Promise.all([
    q,
    opcoesFinanceiro(supabase),
    todas<{ tipo: string; valor: number; valor_pago: number | null; status: string }>(() =>
      supabase.from("lancamentos").select("tipo, valor, valor_pago, status").gte("vencimento", de).lte("vencimento", ate).neq("status", "cancelado").order("id"),
    ),
    supabase.from("lancamentos").select("id", { count: "exact", head: true }).eq("status", "aberto").lt("vencimento", hoje),
    supabase.from("lancamentos").select("id", { count: "exact", head: true }).eq("status", "aberto").eq("requer_aprovacao", true).is("aprovado_em", null),
    supabase.from("imoveis").select("id, codigo").order("codigo").limit(2000),
  ]);
  const lista = (data ?? []) as unknown as (Lancamento & { pessoa: { nome: string } | null; plano: { codigo: string; nome: string } | null; conta: { nome: string } | null })[];
  const saldos = await saldosDasContas(supabase, op.contas.filter((c) => c.ativa));
  const saldoTotal = paraReais([...saldos.values()].reduce((a, v) => a + paraCentavos(v), 0));
  const soma = (tipo: string) => paraReais(doMes.filter((l) => l.tipo === tipo).reduce((a, l) => a + paraCentavos(l.status === "liquidado" ? valorRealizado(l) : l.valor), 0));
  const extra = { filtro: filtro || undefined, ...f };
  const url = (k: string) => {
    const p = new URLSearchParams(Object.entries({ mes, ...f, filtro: k }).filter(([, v]) => v) as [string, string][]);
    return `/financeiro?${p}`;
  };
  const exportar = `/financeiro/exportar?de=${de}&ate=${ate}`;
  const totalLista = lista.reduce((a, l) => a + (l.tipo === "receber" ? 1 : -1) * paraCentavos(l.status === "liquidado" ? valorRealizado(l) : l.valor), 0);

  return (
    <>
      <Cabecalho
        titulo="Financeiro"
        descricao={
          pessoal
            ? "Contas a pagar e a receber dos seus imóveis, contas bancárias, fluxo de caixa, conciliação com o extrato e resultado."
            : "Contas a pagar e a receber da imobiliária, contas bancárias (inclusive de terceiros), fluxo de caixa, conciliação, DRE e notas fiscais."
        }
        acoes={
          <>
            <a href={exportar} className={classeBotao("secundario")}>
              <Download className="size-4" /> Exportar (CSV)
            </a>
            <JanelaCadastro rotuloBotao={<><Plus className="size-4" /> Novo lançamento</>} titulo="Novo lançamento" acao={criarLancamento} larguraMax="max-w-2xl" abertaInicial={s("novo") === "1"}>
              <div className="grid gap-4 sm:grid-cols-2">
                <Campo rotulo="Tipo">
                  <Selecao name="tipo" defaultValue={s("tipo") === "receber" ? "receber" : "pagar"}>
                    <option value="pagar">Conta a pagar (despesa)</option>
                    <option value="receber">Conta a receber (receita)</option>
                  </Selecao>
                </Campo>
                <Campo rotulo="Valor (R$)">
                  <Entrada name="valor" required inputMode="decimal" placeholder="0,00" />
                </Campo>
              </div>
              <Campo rotulo="Descrição">
                <Entrada name="descricao" required placeholder={pessoal ? "IPTU, condomínio, conserto…" : "Aluguel da sala, internet, comissão…"} />
              </Campo>
              <div className="grid gap-4 sm:grid-cols-2">
                <Campo rotulo="Vencimento">
                  <Entrada type="date" name="vencimento" required defaultValue={hoje} />
                </Campo>
                <Campo rotulo="Plano de contas" dica={op.planos.length ? undefined : "Instale o plano padrão na aba Plano de contas."}>
                  <Selecao name="plano_id" defaultValue="">
                    <option value="">— sem classificação —</option>
                    {op.planos.filter((p) => p.ativo).map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.codigo} · {p.nome}
                      </option>
                    ))}
                  </Selecao>
                </Campo>
                <Campo rotulo="Conta (onde entra/sai o dinheiro)">
                  <Selecao name="conta_id" defaultValue="">
                    <option value="">— definir na baixa —</option>
                    {op.contas.filter((c) => c.ativa).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nome}
                      </option>
                    ))}
                  </Selecao>
                </Campo>
                <Campo rotulo="Centro de custo">
                  <Selecao name="centro_custo_id" defaultValue="">
                    <option value="">—</option>
                    {op.centros.filter((c) => c.ativo).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nome}
                      </option>
                    ))}
                  </Selecao>
                </Campo>
                <Campo rotulo="Pessoa (fornecedor ou cliente)">
                  <Selecao name="pessoa_id" defaultValue="">
                    <option value="">—</option>
                    {op.pessoas.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.nome}
                      </option>
                    ))}
                  </Selecao>
                </Campo>
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
                <Campo rotulo="Forma de pagamento">
                  <Selecao name="forma" defaultValue="">
                    <option value="">—</option>
                    {Object.entries(FORMAS_PAGAMENTO).map(([k, r]) => (
                      <option key={k} value={k}>
                        {r}
                      </option>
                    ))}
                  </Selecao>
                </Campo>
                <Campo rotulo="Nº do documento / nota">
                  <Entrada name="documento_numero" />
                </Campo>
              </div>
              <CamposRepeticao />
              <Campo rotulo="Observações">
                <AreaTexto name="observacoes" rows={2} />
              </Campo>
              <CampoJaPago hoje={hoje} />
              <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-texto-2">
                {!pessoal && (
                  <label className="flex items-center gap-2">
                    <input type="checkbox" name="terceiros" /> Dinheiro de terceiros (não entra no resultado)
                  </label>
                )}
              </div>
            </JanelaCadastro>
          </>
        }
      />
      <AbasFinanceiro pessoal={pessoal} />

      <div className="entrar-cascata mb-6 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Indicador rotulo="A receber no mês" icone={<TrendingUp />} valor={<Contador valor={soma("receber")} formato="moeda" />} tom="sucesso" href={url("receber")} />
        <Indicador rotulo="A pagar no mês" icone={<TrendingDown />} valor={<Contador valor={soma("pagar")} formato="moeda" />} tom="perigo" href={url("pagar")} />
        <Indicador
          rotulo="Vencidos em aberto"
          icone={<AlarmClock />}
          valor={<Contador valor={vencidos ?? 0} />}
          detalhe={aAprovar ? `${aAprovar} aguardando aprovação` : "de todos os meses"}
          tom={vencidos ? "perigo" : "sucesso"}
          href={url(aAprovar && !vencidos ? "aprovar" : "vencidos")}
        />
        <Indicador rotulo="Saldo nas contas" icone={<Landmark />} valor={<Contador valor={saldoTotal} formato="moeda" />} detalhe={op.contas.length ? `${op.contas.filter((c) => c.ativa).length} conta(s)` : "cadastre suas contas"} href="/financeiro/contas" tom={saldoTotal < 0 ? "perigo" : "neutro"} />
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        {todosOsMeses ? <span className="text-sm text-texto-2">Mostrando de todos os meses.</span> : <NavegadorMes caminho="/financeiro" mes={mes} hoje={hoje} extra={extra} />}
        {!!aAprovar && (
          <BotaoLink href={url("aprovar")} variante="secundario">
            <ShieldCheck className="size-4" /> {aAprovar} pagamento(s) para aprovar
          </BotaoLink>
        )}
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <PilulasLink rotulo="Situação" ativo={url(filtro)} itens={Object.entries(FILTROS).map(([k, r]) => ({ href: url(k), rotulo: r }))} />
        <FiltroAutomatico className="filtros-linha">
          <input type="hidden" name="mes" value={mes} />
          {filtro && <input type="hidden" name="filtro" value={filtro} />}
          <Entrada name="busca" aria-label="Buscar lançamentos" defaultValue={f.busca} placeholder="Buscar descrição, categoria, nº…" className="max-w-72" />
          <Selecao name="conta" aria-label="Filtrar por conta" defaultValue={f.conta} className="w-48">
            <option value="">Todas as contas</option>
            {op.contas.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </Selecao>
          <Selecao name="plano" aria-label="Filtrar por plano de contas" defaultValue={f.plano} className="w-56">
            <option value="">Todo o plano de contas</option>
            {op.planos.map((p) => (
              <option key={p.id} value={p.id}>
                {p.codigo} · {p.nome}
              </option>
            ))}
          </Selecao>
          {op.centros.length > 0 && (
            <Selecao name="centro" aria-label="Filtrar por centro de custo" defaultValue={f.centro} className="w-44">
              <option value="">Todos os centros</option>
              {op.centros.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </Selecao>
          )}
        </FiltroAutomatico>
      </div>

      <Tabela colunas={["Vencimento", "Descrição", "Classificação", "Conta", "Valor", "Situação", ""]}>
        {lista.map((l) => {
          const sit = situacaoLancamento(l, hoje);
          const v = l.status === "liquidado" ? valorRealizado(l) : l.valor;
          return (
            <LinhaLink key={l.id} href={`/financeiro/lancamentos/${l.id}`}>
              <Celula>{formatarDataBR(l.vencimento)}</Celula>
              <Celula>
                <span className="font-medium text-texto">{l.descricao}</span>
                <span className="block text-xs text-mudo">
                  {[l.pessoa?.nome, l.parcela && l.parcelas && !l.descricao.includes(`${l.parcela}/${l.parcelas}`) ? `${l.parcela} de ${l.parcelas}` : null, l.terceiros ? "terceiros" : null, l.adiantamento ? "adiantamento" : null]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </Celula>
              <Celula>
                <span className="text-xs text-texto-2">{l.plano ? `${l.plano.codigo} · ${l.plano.nome}` : (l.categoria ?? "—")}</span>
              </Celula>
              <Celula>
                <span className="text-xs text-texto-2">{l.conta?.nome ?? "—"}</span>
              </Celula>
              <Celula className={`font-medium tabular-nums ${l.tipo === "receber" ? "text-ok" : "text-texto"}`}>
                {l.tipo === "receber" ? "+" : "−"} {formatarReais(v)}
              </Celula>
              <Celula>
                <Selo cor={COR_SITUACAO[sit]}>{sit === "liquidado" ? `baixado ${formatarDataBR(l.liquidado_em)}` : ROTULO_SITUACAO[sit]}</Selo>
              </Celula>
              <Celula>
                <BotaoExcluir acao={excluirLancamento} id={l.id} rotulo="Excluir lançamento" confirmar={`Excluir "${l.descricao}"?`} />
              </Celula>
            </LinhaLink>
          );
        })}
        {lista.length === 0 && <LinhaVazia colunas={7}>Nenhum lançamento aqui.</LinhaVazia>}
      </Tabela>
      {lista.length >= 1000 && <p className="mt-3 text-sm text-alerta">Mostrando os primeiros 1.000 lançamentos. Use os filtros ou exporte o CSV para ver todos.</p>}
      {lista.length > 0 && (
        <p className="mt-3 text-right text-sm text-texto-2">
          {lista.length} lançamento(s) · saldo da lista: <b className={totalLista >= 0 ? "text-ok" : "text-ruim"}>{formatarReais(paraReais(totalLista))}</b>
        </p>
      )}
    </>
  );
}
