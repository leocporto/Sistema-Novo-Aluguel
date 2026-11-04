import type { Metadata } from "next";
import { CheckCircle2, Lock, LockOpen, Plus, RotateCcw, Wallet } from "lucide-react";
import { Contador } from "@/components/abas-segmentadas";
import { BotaoAcao } from "@/components/botao-acao";
import { BotaoExcluir } from "@/components/botao-excluir";
import { Formulario } from "@/components/formulario";
import { JanelaCadastro } from "@/components/janela-cadastro";
import { NavegadorMes, lerMes } from "@/components/navegador-mes";
import { Aviso, Campo, Cartao, Celula, Entrada, Grade, Indicador, LinhaVazia, Selecao, Selo, Tabela } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { diaLocal } from "@/lib/dominio/agenda";
import { TIPOS_CONTA } from "@/lib/dominio/condominios";
import { fimDoMes, formatarCompetencia, formatarDataBR, hojeISO } from "@/lib/dominio/datas";
import { formatarReais, paraCentavos, paraReais } from "@/lib/dominio/dinheiro";
import { todas } from "../../../financeiro/dados";
import { criarConta, criarLancamento, excluirConta, excluirLancamento, fecharMes, pagarLancamento, reabrirLancamento, reabrirMes, salvarConta } from "../../actions";
import { contasDo, opcoesPessoas, saldosDo } from "../../dados";
import { CamposLancamento } from "../lancamento-campos";

export const metadata: Metadata = { title: "Financeiro do condomínio" };

type Lanc = {
  id: string;
  tipo: "receita" | "despesa" | "transferencia";
  categoria: string;
  descricao: string;
  valor: number;
  competencia: string;
  vencimento: string | null;
  pago_em: string | null;
  status: string;
  conta_id: string | null;
  conta_destino_id: string | null;
  cota_pagamento_id: string | null;
  aprovacao_texto: string | null;
  fornecedor: { nome: string } | null;
};

/**
 * Livro-caixa do condomínio (separado do financeiro da imobiliária): contas
 * (corrente, fundo de reserva, outros fundos), lançamentos do mês e fechamento
 * (trava o que foi pago no mês; reabrir só o administrador).
 */
export default async function FinanceiroCondominio({ params, searchParams }: PageProps<"/condominios/[id]/financeiro">) {
  const { id } = await params;
  const sp = await searchParams;
  const { supabase, papel } = await obterContexto();
  const hoje = hojeISO();
  const mes = lerMes(sp.mes, hoje);
  const ini = `${mes}-01`;
  const fim = fimDoMes(ini);
  const [contas, saldos, pessoas, { data: assembleias }, lancs, { data: fech }] = await Promise.all([
    contasDo(supabase, id),
    saldosDo(supabase, id),
    opcoesPessoas(supabase),
    supabase.from("cond_assembleias").select("id, titulo, data").eq("condominio_id", id).in("status", ["em_andamento", "encerrada"]).order("data", { ascending: false }).limit(30),
    todas<Lanc>(() =>
      supabase
        .from("cond_lancamentos")
        .select("id, tipo, categoria, descricao, valor, competencia, vencimento, pago_em, status, conta_id, conta_destino_id, cota_pagamento_id, aprovacao_texto, fornecedor:pessoas(nome)")
        .eq("condominio_id", id)
        .or(`competencia.eq.${ini},and(pago_em.gte.${ini},pago_em.lte.${fim})`)
        .order("id"),
    ),
    supabase.from("cond_fechamentos").select("status, fechado_em, reaberto_em, motivo_reabertura").eq("condominio_id", id).eq("competencia", ini).maybeSingle(),
  ]);
  const nomeConta = new Map(contas.map((c) => [c.id, c.nome]));
  const fechado = fech?.status === "fechado";
  const pagos = lancs.filter((l) => l.status === "pago" && l.pago_em && l.pago_em >= ini && l.pago_em <= fim);
  const soma = (t: string) => paraReais(pagos.filter((l) => l.tipo === t).reduce((a, l) => a + paraCentavos(l.valor), 0));
  const aPagar = paraReais(lancs.filter((l) => l.status === "aberto" && l.tipo === "despesa").reduce((a, l) => a + paraCentavos(l.valor), 0));
  const ordenados = [...lancs].sort((a, b) => (b.pago_em ?? b.vencimento ?? "").localeCompare(a.pago_em ?? a.vencimento ?? ""));
  const opcoesAss = (assembleias ?? []).map((a) => ({ id: a.id as string, nome: `${a.titulo as string} (${formatarDataBR(diaLocal(String(a.data)))})` }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <NavegadorMes caminho={`/condominios/${id}/financeiro`} mes={mes} hoje={hoje} />
        <div className="flex flex-wrap gap-2">
          {fechado ? (
            <>
              <Selo cor="verde">
                <Lock className="size-3" /> mês fechado
              </Selo>
              {papel === "admin" && (
                <JanelaCadastro rotuloBotao={<><LockOpen className="size-4" /> Reabrir mês</>} variante="secundario" titulo={`Reabrir ${formatarCompetencia(ini)}`} acao={reabrirMes} icone={<LockOpen />} rotuloSalvar="Reabrir">
                  <input type="hidden" name="condominio_id" value={id} />
                  <input type="hidden" name="mes" value={mes} />
                  <Campo rotulo="Motivo (fica registrado)">
                    <Entrada name="motivo" required placeholder="Ex.: faltou lançar a nota da limpeza" />
                  </Campo>
                </JanelaCadastro>
              )}
            </>
          ) : (
            <BotaoAcao acao={fecharMes} id={`${id}|${mes}`} confirmar={`Fechar ${formatarCompetencia(ini)}? O balancete fica guardado e os lançamentos pagos no mês não podem mais mudar (só o administrador reabre).`}>
              <Lock className="size-4" /> Fechar mês
            </BotaoAcao>
          )}
          <JanelaCadastro rotuloBotao={<><Plus className="size-4" /> Lançamento</>} titulo="Novo lançamento do condomínio" acao={criarLancamento} icone={<Wallet />} larguraMax="max-w-2xl" rotuloSalvar="Lançar">
            <CamposLancamento condominioId={id} contas={contas} fornecedores={pessoas} assembleias={opcoesAss} hoje={hoje} />
          </JanelaCadastro>
        </div>
      </div>

      {fech?.status === "reaberto" && (
        <Aviso tipo="alerta">
          Este mês foi fechado e reaberto{fech.motivo_reabertura ? `: ${fech.motivo_reabertura}` : ""}. Feche de novo quando terminar os ajustes.
        </Aviso>
      )}

      <div className="entrar-cascata grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Indicador rotulo="Entrou no mês" icone={<CheckCircle2 />} tom="sucesso" valor={<Contador valor={soma("receita")} formato="moeda" />} detalhe="receitas pagas" />
        <Indicador rotulo="Saiu no mês" icone={<Wallet />} valor={<Contador valor={soma("despesa")} formato="moeda" />} detalhe="despesas pagas" />
        <Indicador rotulo="Resultado" icone={<Wallet />} tom={soma("receita") - soma("despesa") < 0 ? "perigo" : "neutro"} valor={<Contador valor={soma("receita") - soma("despesa")} formato="moeda" />} detalhe="entradas − saídas" />
        <Indicador rotulo="A pagar" icone={<Wallet />} tom={aPagar ? "alerta" : "neutro"} valor={<Contador valor={aPagar} formato="moeda" />} detalhe="despesas do mês em aberto" />
      </div>

      <Cartao
        titulo="Contas do condomínio"
        acoes={
          <JanelaCadastro rotuloBotao={<><Plus className="size-4" /> Conta</>} variante="secundario" tamanho="sm" titulo="Nova conta ou fundo" acao={criarConta}>
            <input type="hidden" name="condominio_id" value={id} />
            <Grade colunas={2}>
              <Campo rotulo="Nome">
                <Entrada name="nome" required placeholder="Ex.: Fundo de obras" />
              </Campo>
              <Campo rotulo="Tipo">
                <Selecao name="tipo" defaultValue="fundo">
                  {Object.entries(TIPOS_CONTA).map(([k, r]) => (
                    <option key={k} value={k}>
                      {r}
                    </option>
                  ))}
                </Selecao>
              </Campo>
              <Campo rotulo="Saldo inicial (R$)">
                <Entrada name="saldo_inicial" inputMode="decimal" defaultValue="0" />
              </Campo>
              <Campo rotulo="Banco / agência / conta">
                <Entrada name="banco" placeholder="Opcional" />
              </Campo>
            </Grade>
          </JanelaCadastro>
        }
      >
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {contas.map((c) => {
            const s = saldos.find((x) => x.id === c.id)?.saldo ?? 0;
            return (
              <Formulario key={c.id} acao={salvarConta} automatico semAviso className="space-y-2 rounded-[14px] border border-borda bg-elev p-4">
                <input type="hidden" name="id" value={c.id} />
                <input type="hidden" name="condominio_id" value={id} />
                <div className="flex items-center justify-between gap-2">
                  <Selo cor={c.tipo === "corrente" ? "azul" : "verde"}>{TIPOS_CONTA[c.tipo as keyof typeof TIPOS_CONTA] ?? c.tipo}</Selo>
                  <BotaoExcluir acao={excluirConta} id={c.id} rotulo="Excluir conta" confirmar={`Excluir a conta ${c.nome}? Só dá se ela não tiver lançamentos.`} />
                </div>
                <Entrada name="nome" defaultValue={c.nome} aria-label="Nome da conta" />
                <div className={`text-[24px] font-semibold tabular-nums ${s < 0 ? "text-ruim" : "text-texto"}`}>{formatarReais(s)}</div>
                <div className="flex items-center gap-2 text-xs text-mudo">
                  <span>Saldo inicial</span>
                  <Entrada name="saldo_inicial" inputMode="decimal" defaultValue={String(c.saldo_inicial)} aria-label="Saldo inicial" className="!min-h-[34px] max-w-32 !py-1 text-sm" />
                  <label className="ml-auto flex items-center gap-1">
                    <input type="hidden" name="ativa" value="off" />
                    <input type="checkbox" name="ativa" defaultChecked={c.ativa} className="size-4 accent-[var(--accent)]" /> ativa
                  </label>
                </div>
              </Formulario>
            );
          })}
        </div>
      </Cartao>

      <Tabela colunas={["Data", "Lançamento", "Categoria", "Conta", "Valor", "Situação", ""]}>
        {ordenados.map((l) => {
          const sinal = l.tipo === "receita" ? "text-ok" : l.tipo === "despesa" ? "text-texto" : "text-texto-2";
          return (
            <tr key={l.id}>
              <Celula className="whitespace-nowrap text-sm text-texto-2">{formatarDataBR(l.pago_em ?? l.vencimento)}</Celula>
              <Celula>
                <span className="text-texto">{l.descricao}</span>
                <span className="block text-xs text-mudo">
                  {l.fornecedor?.nome ?? ""}
                  {l.aprovacao_texto ? ` · aprovado: ${l.aprovacao_texto}` : ""}
                </span>
              </Celula>
              <Celula className="text-sm text-texto-2">{l.categoria}</Celula>
              <Celula className="text-sm text-texto-2">
                {nomeConta.get(l.conta_id ?? "") ?? "—"}
                {l.conta_destino_id ? ` → ${nomeConta.get(l.conta_destino_id)}` : ""}
              </Celula>
              <Celula className={`whitespace-nowrap tabular-nums font-medium ${sinal}`}>
                {l.tipo === "despesa" ? "− " : l.tipo === "receita" ? "+ " : ""}
                {formatarReais(l.valor)}
              </Celula>
              <Celula>
                {l.cota_pagamento_id ? <Selo cor="azul">recebimento de cota</Selo> : <Selo cor={l.status === "pago" ? "verde" : l.status === "cancelado" ? "cinza" : "amarelo"}>{l.status === "pago" ? "pago" : l.status === "cancelado" ? "cancelado" : "em aberto"}</Selo>}
              </Celula>
              <Celula>
                {!l.cota_pagamento_id && (
                  <span className="flex justify-end gap-2">
                    {l.status === "aberto" && (
                      <BotaoAcao acao={pagarLancamento} id={l.id} tamanho="sm" variante="primario" confirmar={`Marcar como pago hoje: ${l.descricao} — ${formatarReais(l.valor)}?`}>
                        Pagar
                      </BotaoAcao>
                    )}
                    {l.status === "pago" && !fechado && (
                      <BotaoAcao acao={reabrirLancamento} id={l.id} tamanho="sm" confirmar={`Voltar para "em aberto": ${l.descricao} — ${formatarReais(l.valor)}?`}>
                        <RotateCcw className="size-3.5" />
                      </BotaoAcao>
                    )}
                    <BotaoExcluir acao={excluirLancamento} id={l.id} rotulo="Excluir lançamento" confirmar={`Excluir ${l.descricao} (${formatarReais(l.valor)})?`} />
                  </span>
                )}
              </Celula>
            </tr>
          );
        })}
        {ordenados.length === 0 && <LinhaVazia colunas={7}>Nada lançado em {formatarCompetencia(ini)}.</LinhaVazia>}
      </Tabela>
    </div>
  );
}
