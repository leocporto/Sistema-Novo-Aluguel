import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MinusCircle, Plus, Receipt } from "lucide-react";
import { BotaoExcluir } from "@/components/botao-excluir";
import { BotaoEnviar, Formulario } from "@/components/formulario";
import { JanelaCadastro } from "@/components/janela-cadastro";
import { LinhaLink } from "@/components/linha-link";
import { Campo, Cartao, Celula, Entrada, LinhaVazia, Selecao, Selo, Tabela } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { formatarCompetencia, formatarDataBR, hojeISO, inicioDoMes } from "@/lib/dominio/datas";
import { formatarReais } from "@/lib/dominio/dinheiro";
import { carregarContrato } from "@/lib/servicos/locacao";
import type { Fatura, Repasse } from "@/lib/tipos";
import { adicionarEncargo, gerarFaturaManual, removerEncargo } from "../../actions";
import { adicionarDesconto, adicionarItemFatura, descontarNoRepasse, excluirDesconto, removerItemFatura } from "../../locacao-actions";

export const metadata: Metadata = { title: "Cobranças do contrato" };

const corFatura = { aberta: "amarelo", paga: "verde", cancelada: "cinza" } as const;

export default async function CobrancasContrato({ params }: PageProps<"/contratos/[id]/cobrancas">) {
  const { id } = await params;
  const { supabase, organizacao } = await obterContexto();
  const pessoal = organizacao.modo === "pessoal";
  const dados = await carregarContrato(supabase, id);
  if (!dados) notFound();
  const { encargos } = dados;
  const hoje = hojeISO();
  const [{ data: faturasRaw }, { data: descontos }, { data: repassesRaw }, { data: avulsos }] = await Promise.all([
    supabase.from("faturas").select("*").eq("contrato_id", id).order("competencia", { ascending: false }),
    supabase.from("contrato_descontos").select("*").eq("contrato_id", id).order("inicio"),
    pessoal ? Promise.resolve({ data: [] }) : supabase.from("repasses").select("*, pessoa:pessoas(nome)").eq("contrato_id", id).order("competencia", { ascending: false }),
    supabase.from("fatura_itens").select("id, descricao, tipo, valor, fatura:faturas!inner(id, numero, competencia, status, contrato_id)").eq("fatura.contrato_id", id).eq("fatura.status", "aberta").in("tipo", ["desconto", "outro"]),
  ]);
  const faturas = (faturasRaw ?? []) as Fatura[];
  const abertas = faturas.filter((f) => f.status === "aberta");
  const repasses = (repassesRaw ?? []) as (Repasse & { pessoa: { nome: string }; outros_descontos: number; observacoes: string | null })[];
  const pendentes = repasses.filter((r) => r.status === "pendente");
  type Av = { id: string; descricao: string; tipo: string; valor: number; fatura: { numero: number; competencia: string } };
  const pagas = faturas.filter((f) => f.status === "paga");
  const totalPago = pagas.reduce((s, f) => s + Number(f.valor_pago ?? f.valor_total), 0);

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
      <div className="space-y-6">
        <Cartao
          titulo={`Histórico de cobranças (${faturas.length})`}
          acoes={
            <Formulario acao={gerarFaturaManual} className="flex items-center gap-2">
              <input type="hidden" name="contrato_id" value={id} />
              <Entrada type="month" name="competencia" defaultValue={inicioDoMes(hoje).slice(0, 7)} className="w-40" />
              <BotaoEnviar variante="secundario">Gerar fatura</BotaoEnviar>
            </Formulario>
          }
        >
          <p className="mb-3 text-sm text-texto-2">
            {pagas.length} paga(s), total {formatarReais(totalPago)} · {abertas.length} em aberto
          </p>
          <Tabela colunas={["Nº", "Competência", "Vencimento", "Valor", "Situação", "Pago em", ""]}>
            {faturas.length === 0 && <LinhaVazia colunas={7}>Nenhuma fatura gerada.</LinhaVazia>}
            {faturas.map((f) => (
              <LinhaLink href={`/faturas/${f.id}`} key={f.id}>
                <Celula>
                  <Link href={`/faturas/${f.id}`} className="text-acento hover:underline">
                    #{f.numero}
                  </Link>
                </Celula>
                <Celula>{formatarCompetencia(f.competencia)}</Celula>
                <Celula>{formatarDataBR(f.vencimento)}</Celula>
                <Celula>{formatarReais(f.valor_pago ?? f.valor_total)}</Celula>
                <Celula>
                  <Selo cor={f.status === "aberta" && f.vencimento < hoje ? "vermelho" : corFatura[f.status as keyof typeof corFatura]}>
                    {f.status === "aberta" && f.vencimento < hoje ? "em atraso" : f.status}
                  </Selo>
                </Celula>
                <Celula>{formatarDataBR(f.pago_em)}</Celula>
                <Celula>
                  {f.status === "paga" && (
                    <Link href={`/faturas/${f.id}/recibo`} className="inline-flex items-center gap-1 text-xs text-acento hover:underline">
                      <Receipt className="size-3.5" /> recibo
                    </Link>
                  )}
                </Celula>
              </LinhaLink>
            ))}
          </Tabela>
        </Cartao>

        <Cartao
          titulo="Lançamentos avulsos nas faturas em aberto"
          acoes={
            abertas.length > 0 && (
              <JanelaCadastro rotuloBotao={<><Plus className="size-3.5" /> Lançar</>} tamanho="sm" titulo="Lançar na fatura" acao={adicionarItemFatura} rotuloSalvar="Lançar">
                <input type="hidden" name="contrato_id" value={id} />
                <Campo rotulo="Fatura">
                  <Selecao name="fatura_id" required defaultValue={abertas[0]?.id}>
                    {abertas.map((f) => (
                      <option key={f.id} value={f.id}>
                        #{f.numero} · {formatarCompetencia(f.competencia)} · {formatarReais(f.valor_total)}
                      </option>
                    ))}
                  </Selecao>
                </Campo>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Campo rotulo="O que é">
                    <Selecao name="natureza" defaultValue="cobranca">
                      <option value="cobranca">Cobrar do locatário (reembolso, rateio de despesa)</option>
                      <option value="desconto">Desconto para o locatário</option>
                    </Selecao>
                  </Campo>
                  <Campo rotulo="Valor (R$)">
                    <Entrada name="valor" inputMode="decimal" required />
                  </Campo>
                </div>
                <Campo rotulo="Descrição">
                  <Entrada name="descricao" required placeholder="Conserto do chuveiro (rateio 50%), multa do condomínio…" />
                </Campo>
                {!pessoal && (
                  <Campo rotulo="Para quem vai o valor">
                    <Selecao name="destino" defaultValue="proprietario">
                      <option value="proprietario">Proprietário (entra no repasse)</option>
                      <option value="imobiliaria">Imobiliária</option>
                      <option value="terceiro">Terceiro (condomínio, prestador…)</option>
                    </Selecao>
                  </Campo>
                )}
              </JanelaCadastro>
            )
          }
        >
          <ul className="space-y-2 text-sm">
            {((avulsos ?? []) as unknown as Av[]).map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-2">
                <span>
                  {a.descricao} <span className="text-xs text-mudo">· fatura #{a.fatura.numero} ({formatarCompetencia(a.fatura.competencia)})</span>
                </span>
                <span className="flex items-center gap-2 tabular-nums">
                  <span className={Number(a.valor) < 0 ? "text-ok" : "text-texto"}>{formatarReais(a.valor)}</span>
                  <BotaoExcluir acao={removerItemFatura} id={a.id} rotulo="Tirar da fatura" confirmar="Tirar este lançamento da fatura?" />
                </span>
              </li>
            ))}
            {!avulsos?.length && <li className="text-mudo">{abertas.length ? "Nenhum lançamento avulso." : "Não há fatura em aberto para lançar."}</li>}
          </ul>
        </Cartao>

        {!pessoal && (
          <Cartao
            titulo="Repasses ao proprietário"
            acoes={
              pendentes.length > 0 && (
                <JanelaCadastro rotuloBotao={<><MinusCircle className="size-3.5" /> Descontar despesa</>} variante="secundario" tamanho="sm" titulo="Descontar no repasse" acao={descontarNoRepasse} rotuloSalvar="Descontar">
                  <input type="hidden" name="contrato_id" value={id} />
                  <p className="text-sm text-texto-2">Use quando a imobiliária pagou uma despesa do imóvel (conserto, IPTU atrasado…) que é do proprietário.</p>
                  <Campo rotulo="Repasse pendente">
                    <Selecao name="repasse_id" required>
                      {pendentes.map((r) => (
                        <option key={r.id} value={r.id}>
                          {formatarCompetencia(r.competencia)} · {r.pessoa.nome} · {formatarReais(r.valor_liquido)}
                        </option>
                      ))}
                    </Selecao>
                  </Campo>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Campo rotulo="Valor (R$)">
                      <Entrada name="valor" inputMode="decimal" required />
                    </Campo>
                    <Campo rotulo="Motivo">
                      <Entrada name="motivo" required placeholder="Troca do aquecedor" />
                    </Campo>
                  </div>
                </JanelaCadastro>
              )
            }
          >
            <Tabela colunas={["Competência", "Proprietário", "Bruto", "Taxas", "Impostos", "Descontos", "Líquido", "Situação"]}>
              {repasses.length === 0 && <LinhaVazia colunas={8}>Nenhum repasse.</LinhaVazia>}
              {repasses.map((r) => (
                <tr key={r.id}>
                  <Celula>{formatarCompetencia(r.competencia)}</Celula>
                  <Celula>{r.pessoa.nome}</Celula>
                  <Celula>{formatarReais(r.valor_bruto)}</Celula>
                  <Celula>{formatarReais(Number(r.taxa_administracao) + Number(r.taxa_intermediacao))}</Celula>
                  <Celula>{formatarReais(Number(r.irrf) + Number(r.imposto ?? 0))}</Celula>
                  <Celula>
                    {formatarReais(r.outros_descontos ?? 0)}
                    {r.observacoes && <span className="block text-xs text-mudo">{r.observacoes}</span>}
                  </Celula>
                  <Celula className="font-medium">{formatarReais(r.valor_liquido)}</Celula>
                  <Celula>
                    <Selo cor={r.status === "pago" ? "verde" : r.status === "pendente" ? "amarelo" : "cinza"}>{r.status}</Selo>
                  </Celula>
                </tr>
              ))}
            </Tabela>
          </Cartao>
        )}
      </div>

      <div className="space-y-6">
        <Cartao
          titulo="Descontos temporários"
          acoes={
            <JanelaCadastro rotuloBotao={<><Plus className="size-3.5" /> Incluir</>} variante="fantasma" tamanho="sm" titulo="Desconto temporário" acao={adicionarDesconto} rotuloSalvar="Incluir">
              <input type="hidden" name="contrato_id" value={id} />
              <div className="grid gap-4 sm:grid-cols-2">
                <Campo rotulo="Tipo">
                  <Selecao name="tipo" defaultValue="valor">
                    <option value="valor">Valor fixo (R$)</option>
                    <option value="pct">Percentual do aluguel (%)</option>
                  </Selecao>
                </Campo>
                <Campo rotulo="Quanto">
                  <Entrada name="valor" inputMode="decimal" required />
                </Campo>
                <Campo rotulo="A partir de">
                  <Entrada type="month" name="inicio" required defaultValue={inicioDoMes(hoje).slice(0, 7)} />
                </Campo>
                <Campo rotulo="Até (vazio = sem fim)">
                  <Entrada type="month" name="fim" />
                </Campo>
              </div>
              <Campo rotulo="Motivo">
                <Entrada name="motivo" placeholder="Obra no prédio, negociação…" />
              </Campo>
            </JanelaCadastro>
          }
        >
          <ul className="space-y-2 text-sm">
            {(descontos ?? []).map((d) => (
              <li key={d.id} className="flex items-start justify-between gap-2">
                <span>
                  <strong>{d.tipo === "pct" ? `${Number(d.valor)}%` : formatarReais(d.valor)}</strong> {d.motivo ? `· ${d.motivo}` : ""}
                  <span className="block text-xs text-mudo">
                    de {formatarCompetencia(d.inicio)} {d.fim ? `até ${formatarCompetencia(d.fim)}` : "sem fim"}
                  </span>
                </span>
                <BotaoExcluir acao={excluirDesconto} id={d.id} rotulo="Excluir desconto" confirmar="Excluir este desconto? As faturas já geradas não mudam." />
              </li>
            ))}
            {!descontos?.length && <li className="text-mudo">Nenhum desconto. A carência e o desconto de pontualidade ficam em Resumo.</li>}
          </ul>
        </Cartao>

        <Cartao titulo="Encargos mensais (condomínio, IPTU…)">
          <ul className="mb-4 space-y-2 text-sm">
            {encargos.map((e) => (
              <li key={e.id} className="flex items-start justify-between gap-2">
                <div>
                  {e.descricao} · <strong>{formatarReais(e.valor)}</strong>
                  <div className="text-xs text-mudo">
                    {!pessoal && `destino: ${e.destino}`}
                    {e.inicio && ` · de ${formatarCompetencia(e.inicio)}`}
                    {e.fim && ` até ${formatarCompetencia(e.fim)}`}
                  </div>
                </div>
                <form action={removerEncargo}>
                  <input type="hidden" name="contrato_id" value={id} />
                  <input type="hidden" name="id" value={e.id} />
                  <BotaoEnviar variante="fantasma" confirmar="Remover este encargo das próximas faturas?">
                    Remover
                  </BotaoEnviar>
                </form>
              </li>
            ))}
            {encargos.length === 0 && <li className="text-mudo">Nenhum encargo.</li>}
          </ul>
          <Formulario acao={adicionarEncargo} className="space-y-3 border-t border-borda-suave pt-4">
            <input type="hidden" name="contrato_id" value={id} />
            <Campo rotulo="Descrição">
              <Entrada name="descricao" required placeholder="IPTU 2027, taxa de lixo…" />
            </Campo>
            <div className="grid grid-cols-2 gap-2">
              <Campo rotulo="Valor (R$)">
                <Entrada name="valor" required inputMode="decimal" />
              </Campo>
              {pessoal ? (
                <input type="hidden" name="destino" value="proprietario" />
              ) : (
                <Campo rotulo="Destino">
                  <Selecao name="destino" defaultValue="proprietario">
                    <option value="proprietario">Proprietário</option>
                    <option value="terceiro">Terceiro</option>
                    <option value="imobiliaria">Imobiliária</option>
                  </Selecao>
                </Campo>
              )}
              <Campo rotulo="A partir de">
                <Entrada type="month" name="inicio" />
              </Campo>
              <Campo rotulo="Até">
                <Entrada type="month" name="fim" />
              </Campo>
            </div>
            <input type="hidden" name="tipo" value="outro" />
            <BotaoEnviar variante="secundario">Adicionar encargo</BotaoEnviar>
          </Formulario>
        </Cartao>
      </div>
    </div>
  );
}
