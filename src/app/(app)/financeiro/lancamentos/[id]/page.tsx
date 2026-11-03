import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Ban, CheckCircle2, RotateCcw, ShieldCheck, Undo2 } from "lucide-react";
import { BotaoAcao } from "@/components/botao-acao";
import { BotaoExcluir } from "@/components/botao-excluir";
import { BotaoEnviar, Formulario } from "@/components/formulario";
import { AreaTexto, Aviso, Campo, Cartao, Definicao, Entrada, Selecao, Selo } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { formatarDataBR, hojeISO } from "@/lib/dominio/datas";
import { formatarReais } from "@/lib/dominio/dinheiro";
import { FORMAS_PAGAMENTO, ROTULO_ACAO_HISTORICO, ROTULO_CAMPO_HISTORICO, ROTULO_SITUACAO, situacaoLancamento } from "@/lib/dominio/financeiro";
import {
  aprovarLancamento,
  atualizarLancamento,
  baixarLancamento,
  cancelarLancamento,
  estornarLancamento,
  excluirLancamento,
  excluirProximosDaSerie,
  reabrirLancamento,
} from "../../actions";
import { opcoesFinanceiro, type Lancamento } from "../../dados";

export const metadata: Metadata = { title: "Lançamento" };

const COR = { aberto: "azul", vencido: "vermelho", liquidado: "verde", cancelado: "cinza", aguardando_aprovacao: "amarelo" } as const;

function valorHistorico(campo: string, v: unknown, nomes: Map<string, string>): string {
  if (v === null || v === undefined || v === "") return "—";
  if (["valor", "valor_pago", "juros", "desconto"].includes(campo)) return formatarReais(Number(v));
  if (["vencimento", "liquidado_em"].includes(campo)) return formatarDataBR(String(v));
  if (campo === "aprovado_em") return "aprovado";
  if (typeof v === "string" && nomes.has(v)) return nomes.get(v)!;
  return String(v);
}

export default async function LancamentoPage({ params }: PageProps<"/financeiro/lancamentos/[id]">) {
  const { id } = await params;
  const { supabase, organizacao, papel } = await obterContexto();
  const pessoal = organizacao.modo === "pessoal";
  const hoje = hojeISO();
  const [{ data }, op, { data: hist }, { data: imoveis }] = await Promise.all([
    supabase.from("lancamentos").select("*").eq("id", id).maybeSingle(),
    opcoesFinanceiro(supabase),
    supabase.from("lancamento_historico").select("*").eq("lancamento_id", id).order("data", { ascending: false }),
    supabase.from("imoveis").select("id, codigo").order("codigo").limit(2000),
  ]);
  if (!data) notFound();
  const l = data as Lancamento;
  const { data: serie } = l.serie_id
    ? await supabase.from("lancamentos").select("id, descricao, vencimento, valor, status").eq("serie_id", l.serie_id).order("vencimento")
    : { data: null };
  const sit = situacaoLancamento(l, hoje);
  const aberto = l.status === "aberto";
  const bloqueadoAprovacao = l.requer_aprovacao && !l.aprovado_em;
  const gestor = papel === "admin" || papel === "gestor";
  const nomes = new Map<string, string>([
    ...op.contas.map((c) => [c.id, c.nome] as [string, string]),
    ...op.planos.map((p) => [p.id, `${p.codigo} · ${p.nome}`] as [string, string]),
    ...op.pessoas.map((p) => [p.id, p.nome] as [string, string]),
  ]);
  const origem = l.fatura_id
    ? { href: `/faturas/${l.fatura_id}`, rotulo: "pagamento de aluguel" }
    : l.venda_id
      ? { href: `/vendas/${l.venda_id}`, rotulo: "venda" }
      : l.contrato_id
        ? { href: `/contratos/${l.contrato_id}`, rotulo: "contrato" }
        : null;

  return (
    <>
      <div className="mb-[clamp(14px,1.5vw,18px)] flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[13px] text-mudo">
            <span>Novo Aluguel</span>
            <span className="text-fraco">›</span>
            <Link href="/financeiro" className="text-acento-hot hover:underline">
              Financeiro
            </Link>
            <span className="text-fraco">›</span>
            <span>{l.tipo === "receber" ? "A receber" : "A pagar"}</span>
          </div>
          <h1 className="mt-1.5 text-[clamp(26px,2.8vw,36px)] font-semibold leading-[1.05] tracking-[-0.025em] text-texto">{l.descricao}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[13.5px] text-texto-2">
            <Selo cor={COR[sit]}>{ROTULO_SITUACAO[sit]}</Selo>
            <span className={`font-semibold tabular-nums ${l.tipo === "receber" ? "text-ok" : "text-texto"}`}>{formatarReais(l.valor)}</span>
            <span>vence {formatarDataBR(l.vencimento)}</span>
            {origem && (
              <Link href={origem.href} className="text-acento hover:underline">
                veio de {origem.rotulo}
              </Link>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {bloqueadoAprovacao && aberto && gestor && (
            <BotaoAcao acao={aprovarLancamento} id={l.id} variante="primario" confirmar={`Aprovar o pagamento de ${formatarReais(l.valor)}?`}>
              <ShieldCheck className="size-4" /> Aprovar pagamento
            </BotaoAcao>
          )}
          {l.status === "liquidado" && !l.fatura_id && (
            <BotaoAcao acao={estornarLancamento} id={l.id} confirmar="Estornar a baixa? O lançamento volta a ficar em aberto.">
              <Undo2 className="size-4" /> Estornar baixa
            </BotaoAcao>
          )}
          {l.status === "cancelado" && (
            <BotaoAcao acao={reabrirLancamento} id={l.id}>
              <RotateCcw className="size-4" /> Reabrir
            </BotaoAcao>
          )}
          {l.serie_id && aberto && (
            <BotaoAcao acao={excluirProximosDaSerie} id={l.id} variante="perigo" confirmar="Excluir este e os próximos lançamentos em aberto desta série?" depois="/financeiro">
              Excluir este e os próximos
            </BotaoAcao>
          )}
          <BotaoExcluir acao={excluirLancamento} id={l.id} variante="botao" rotulo="Excluir" confirmar={`Excluir "${l.descricao}"?`} depois="/financeiro" />
        </div>
      </div>

      {bloqueadoAprovacao && aberto && (
        <div className="mb-5">
          <Aviso tipo="alerta">
            Este pagamento passa do limite de aprovação. {gestor ? "Aprove para liberar a baixa." : "Peça para um administrador ou gestor aprovar."}
          </Aviso>
        </div>
      )}
      {l.status === "cancelado" && (
        <div className="mb-5">
          <Aviso tipo="info">Cancelado. Motivo: {l.cancelado_motivo ?? "—"}</Aviso>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <Cartao titulo="Dados do lançamento">
            {l.status === "liquidado" ? (
              <>
                <Definicao
                  itens={[
                    ["Tipo", l.tipo === "receber" ? "A receber (receita)" : "A pagar (despesa)"],
                    ["Valor original", formatarReais(l.valor)],
                    ["Vencimento", formatarDataBR(l.vencimento)],
                    ["Pessoa", l.pessoa_id ? nomes.get(l.pessoa_id) : null],
                    ["Plano de contas", l.plano_id ? nomes.get(l.plano_id) : (l.categoria ?? null)],
                    ["Nº do documento", l.documento_numero],
                  ]}
                />
                <p className="mt-4 text-xs text-mudo">Para mudar valor ou datas de um lançamento baixado, estorne a baixa primeiro.</p>
              </>
            ) : null}
            <Formulario acao={atualizarLancamento} automatico className={`grid gap-4 sm:grid-cols-2 ${l.status === "liquidado" ? "mt-5 border-t border-borda pt-5" : ""}`}>
              <input type="hidden" name="id" value={l.id} />
              {l.status !== "liquidado" && (
                <>
                  <Campo rotulo="Descrição" className="sm:col-span-2">
                    <Entrada name="descricao" defaultValue={l.descricao} />
                  </Campo>
                  <Campo rotulo="Valor (R$)">
                    <Entrada name="valor" inputMode="decimal" defaultValue={String(l.valor).replace(".", ",")} />
                  </Campo>
                  <Campo rotulo="Vencimento">
                    <Entrada type="date" name="vencimento" defaultValue={l.vencimento} />
                  </Campo>
                </>
              )}
              <Campo rotulo="Plano de contas">
                <Selecao name="plano_id" defaultValue={l.plano_id ?? ""}>
                  <option value="">— sem classificação —</option>
                  {op.planos.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.codigo} · {p.nome}
                    </option>
                  ))}
                </Selecao>
              </Campo>
              <Campo rotulo="Centro de custo">
                <Selecao name="centro_custo_id" defaultValue={l.centro_custo_id ?? ""}>
                  <option value="">—</option>
                  {op.centros.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nome}
                    </option>
                  ))}
                </Selecao>
              </Campo>
              <Campo rotulo="Conta">
                <Selecao name="conta_id" defaultValue={l.conta_id ?? ""}>
                  <option value="">—</option>
                  {op.contas.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nome}
                    </option>
                  ))}
                </Selecao>
              </Campo>
              <Campo rotulo="Pessoa">
                <Selecao name="pessoa_id" defaultValue={l.pessoa_id ?? ""}>
                  <option value="">—</option>
                  {op.pessoas.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nome}
                    </option>
                  ))}
                </Selecao>
              </Campo>
              <Campo rotulo="Imóvel">
                <Selecao name="imovel_id" defaultValue={l.imovel_id ?? ""}>
                  <option value="">—</option>
                  {(imoveis ?? []).map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.codigo}
                    </option>
                  ))}
                </Selecao>
              </Campo>
              <Campo rotulo="Categoria (texto livre)">
                <Entrada name="categoria" defaultValue={l.categoria ?? ""} />
              </Campo>
              <Campo rotulo="Forma de pagamento">
                <Selecao name="forma" defaultValue={l.forma ?? ""}>
                  <option value="">—</option>
                  {Object.entries(FORMAS_PAGAMENTO).map(([k, r]) => (
                    <option key={k} value={k}>
                      {r}
                    </option>
                  ))}
                </Selecao>
              </Campo>
              <Campo rotulo="Nº do documento / nota">
                <Entrada name="documento_numero" defaultValue={l.documento_numero ?? ""} />
              </Campo>
              <Campo rotulo="Observações" className="sm:col-span-2">
                <AreaTexto name="observacoes" rows={2} defaultValue={l.observacoes ?? ""} />
              </Campo>
              {!pessoal && (
                <label className="flex items-center gap-2 text-sm text-texto-2 sm:col-span-2">
                  <input type="hidden" name="terceiros" value="" />
                  <input type="checkbox" name="terceiros" defaultChecked={l.terceiros} /> Dinheiro de terceiros (fica fora do resultado/DRE)
                </label>
              )}
            </Formulario>
          </Cartao>

          {serie && serie.length > 1 && (
            <Cartao titulo={`Série (${serie.length} lançamentos)`}>
              <ul className="divide-y divide-borda-suave text-sm">
                {serie.map((x) => (
                  <li key={x.id} className="flex items-center justify-between gap-3 py-2">
                    <Link href={`/financeiro/lancamentos/${x.id}`} className={x.id === l.id ? "font-semibold text-texto" : "text-acento hover:underline"}>
                      {formatarDataBR(x.vencimento)} · {x.descricao}
                    </Link>
                    <span className="flex items-center gap-2 tabular-nums">
                      {formatarReais(x.valor)}
                      <Selo cor={x.status === "liquidado" ? "verde" : x.status === "cancelado" ? "cinza" : "azul"}>{x.status === "liquidado" ? "baixado" : x.status}</Selo>
                    </span>
                  </li>
                ))}
              </ul>
            </Cartao>
          )}

          <Cartao titulo="Histórico de alterações">
            {!hist?.length && <p className="text-sm text-mudo">Sem registros.</p>}
            <ul className="space-y-3 text-sm">
              {(hist ?? []).map((h) => {
                const antes = (h.antes ?? {}) as Record<string, unknown>;
                const depois = (h.depois ?? {}) as Record<string, unknown>;
                const campos = h.acao === "criado" || h.acao === "excluido" ? [] : Object.keys(depois);
                return (
                  <li key={h.id} className="border-l-2 border-borda pl-3">
                    <div className="font-medium text-texto">
                      {ROTULO_ACAO_HISTORICO[h.acao] ?? h.acao} <span className="font-normal text-mudo">· {new Date(h.data).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</span>
                    </div>
                    {campos.length > 0 && (
                      <ul className="mt-1 text-xs text-texto-2">
                        {campos.map((c) => (
                          <li key={c}>
                            {ROTULO_CAMPO_HISTORICO[c] ?? c}: {valorHistorico(c, antes[c], nomes)} → {valorHistorico(c, depois[c], nomes)}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          </Cartao>
        </div>

        <div className="space-y-6">
          {aberto && (
            <Cartao titulo={l.tipo === "receber" ? "Registrar recebimento" : "Registrar pagamento"}>
              <Formulario acao={baixarLancamento} className="space-y-3">
                <input type="hidden" name="id" value={l.id} />
                <Campo rotulo="Data">
                  <Entrada type="date" name="liquidado_em" defaultValue={hoje} />
                </Campo>
                <div className="grid grid-cols-2 gap-3">
                  <Campo rotulo="Juros / multa (R$)">
                    <Entrada name="juros" inputMode="decimal" placeholder="0,00" />
                  </Campo>
                  <Campo rotulo="Desconto (R$)">
                    <Entrada name="desconto" inputMode="decimal" placeholder="0,00" />
                  </Campo>
                </div>
                <Campo rotulo="Valor pago (R$)" dica="Se ficar vazio: valor + juros − desconto.">
                  <Entrada name="valor_pago" inputMode="decimal" placeholder={String(l.valor).replace(".", ",")} />
                </Campo>
                <Campo rotulo="Conta">
                  <Selecao name="conta_id" defaultValue={l.conta_id ?? ""}>
                    <option value="">— sem conta —</option>
                    {op.contas.filter((c) => c.ativa).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nome}
                      </option>
                    ))}
                  </Selecao>
                </Campo>
                <Campo rotulo="Forma">
                  <Selecao name="forma" defaultValue={l.forma ?? ""}>
                    <option value="">—</option>
                    {Object.entries(FORMAS_PAGAMENTO).map(([k, r]) => (
                      <option key={k} value={k}>
                        {r}
                      </option>
                    ))}
                  </Selecao>
                </Campo>
                <BotaoEnviar>
                  <CheckCircle2 className="size-4" /> Dar baixa
                </BotaoEnviar>
              </Formulario>
            </Cartao>
          )}
          {l.status === "liquidado" && (
            <Cartao titulo="Baixa">
              <Definicao
                itens={[
                  ["Data", formatarDataBR(l.liquidado_em)],
                  ["Valor pago", formatarReais(l.valor_pago ?? l.valor)],
                  ["Juros / multa", formatarReais(l.juros)],
                  ["Desconto", formatarReais(l.desconto)],
                  ["Conta", l.conta_id ? nomes.get(l.conta_id) : null],
                  ["Forma", l.forma ? FORMAS_PAGAMENTO[l.forma] : null],
                  ["Conciliado", l.conciliado_em ? "sim, com o extrato" : "não"],
                ]}
              />
            </Cartao>
          )}
          {aberto && (
            <Cartao titulo="Cancelar">
              <Formulario acao={cancelarLancamento} className="space-y-3">
                <input type="hidden" name="id" value={l.id} />
                <Campo rotulo="Motivo">
                  <Entrada name="motivo" required placeholder="Ex.: cobrança indevida, acordo…" />
                </Campo>
                <BotaoEnviar variante="secundario">
                  <Ban className="size-4" /> Cancelar lançamento
                </BotaoEnviar>
              </Formulario>
              <p className="mt-2 text-xs text-mudo">Cancelado fica no histórico (não some), mas sai dos totais.</p>
            </Cartao>
          )}
        </div>
      </div>
    </>
  );
}
