import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BotaoEnviar, Formulario } from "@/components/formulario";
import {
  AreaTexto,
  Aviso,
  Cabecalho,
  Campo,
  Cartao,
  Celula,
  Definicao,
  Entrada,
  Grade,
  LinhaVazia,
  Selecao,
  Selo,
  Tabela,
  classeBotao,
} from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { formatarCompetencia, formatarDataBR, hojeISO, inicioDoMes } from "@/lib/dominio/datas";
import { formatarReais, paraCentavos, paraReais } from "@/lib/dominio/dinheiro";
import { formatarDocumento } from "@/lib/dominio/documentos";
import { INDICES, NOME_INDICE, proximoReajuste } from "@/lib/dominio/reajuste";
import { calcularRescisao } from "@/lib/dominio/rescisao";
import { calcularReajusteDoContrato, carregarContrato } from "@/lib/servicos/locacao";
import { ROTULO_GARANTIA, ROTULO_PAPEL, ROTULO_REPASSE, type Fatura, type Pessoa, type Repasse } from "@/lib/tipos";
import {
  adicionarEncargo,
  adicionarParte,
  aplicarReajuste,
  atualizarContrato,
  encerrarContrato,
  gerarFaturaManual,
  removerEncargo,
  removerParte,
} from "../actions";

export const metadata: Metadata = { title: "Contrato" };

const corFatura = { aberta: "amarelo", paga: "verde", cancelada: "cinza" } as const;

export default async function ContratoPage({ params, searchParams }: PageProps<"/contratos/[id]">) {
  const { id } = await params;
  const sp = await searchParams;
  const { supabase } = await obterContexto();
  const dados = await carregarContrato(supabase, id);
  if (!dados) notFound();
  const { contrato: c, imovel, partes, encargos } = dados;

  const [{ data: faturasRaw }, { data: repassesRaw }, { data: reajustes }, { data: pessoas }] = await Promise.all([
    supabase.from("faturas").select("*").eq("contrato_id", id).order("competencia", { ascending: false }),
    supabase.from("repasses").select("*, pessoa:pessoas(nome)").eq("contrato_id", id).order("competencia", { ascending: false }),
    supabase.from("contrato_reajustes").select("*").eq("contrato_id", id).order("data_reajuste", { ascending: false }),
    supabase.from("pessoas").select("id, nome").order("nome"),
  ]);
  const faturas = (faturasRaw ?? []) as Fatura[];
  const repasses = (repassesRaw ?? []) as (Repasse & { pessoa: { nome: string } })[];
  const hoje = hojeISO();
  const abertas = faturas.filter((f) => f.status === "aberta");
  const emAtraso = abertas.filter((f) => f.vencimento < hoje);

  // Reajuste: próxima data e prévia com índices cadastrados
  const dataReajuste = proximoReajuste(c.data_base_reajuste, c.periodicidade_reajuste_meses);
  const previa = await calcularReajusteDoContrato(supabase, c, dataReajuste);

  // Rescisão: simulação via parâmetros da URL
  const entrega = typeof sp.entrega === "string" ? sp.entrega : "";
  const ultimaPaga = faturas.find((f) => f.status === "paga");
  const pagoAtePadrao = ultimaPaga?.periodo_fim ?? c.data_inicio;
  const rescisao = entrega
    ? calcularRescisao({
        valorAluguel: paraCentavos(c.valor_aluguel),
        dataInicio: c.data_inicio,
        prazoMeses: c.prazo_meses,
        dataEntrega: entrega,
        pagoAte: typeof sp.pagoAte === "string" && sp.pagoAte ? sp.pagoAte : pagoAtePadrao,
        multaAlugueis: Number(c.multa_rescisoria_alugueis),
        isentarMulta: sp.isentar === "on",
        avisoPrevioCumprido: sp.aviso !== "nao",
        debitosPendentes: abertas.reduce((s, f) => s + paraCentavos(f.valor_total), 0),
        caucao: c.garantia_tipo === "caucao" ? paraCentavos(c.garantia_valor) : 0,
      })
    : null;

  return (
    <>
      <Cabecalho
        titulo={`Contrato #${c.numero}${c.codigo ? ` · ${c.codigo}` : ""}`}
        descricao={
          <>
            <Link href={`/imoveis/${imovel.id}`} className="text-acento hover:underline">
              {imovel.codigo}
            </Link>{" "}
            — {[imovel.logradouro, imovel.numero, imovel.complemento, imovel.bairro, imovel.cidade].filter(Boolean).join(", ")}
          </>
        }
        acoes={
          <>
            <Selo cor={c.status === "ativo" ? "verde" : "cinza"}>{c.status}</Selo>
            <Link href={`/contratos/${id}/documento`} className={classeBotao("secundario")}>
              Gerar contrato (documento)
            </Link>
          </>
        }
      />

      {emAtraso.length > 0 && (
        <div className="mb-6">
          <Aviso tipo="erro">
            {emAtraso.length} fatura(s) em atraso, total {formatarReais(emAtraso.reduce((s, f) => s + Number(f.valor_total), 0))}.
          </Aviso>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <Cartao titulo="Resumo">
            <Definicao
              itens={[
                ["Aluguel atual", formatarReais(c.valor_aluguel)],
                ["Vigência", `${formatarDataBR(c.data_inicio)} a ${formatarDataBR(c.data_fim)} (${c.prazo_meses} meses)`],
                ["Vencimento", `Dia ${c.dia_vencimento} · mês ${c.modalidade}`],
                ["Reajuste", `${NOME_INDICE[c.indice_reajuste as keyof typeof NOME_INDICE] ?? c.indice_reajuste} a cada ${c.periodicidade_reajuste_meses} meses`],
                ["Próximo reajuste", formatarDataBR(dataReajuste)],
                ["Taxa de administração", `${Number(c.taxa_administracao_pct)}%`],
                ["Intermediação", `${Number(c.taxa_intermediacao_pct)}% do 1º aluguel`],
                ["Repasse", `${ROTULO_REPASSE[c.tipo_repasse]} · ${c.dias_repasse} dia(s)`],
                ["Atraso", `Multa ${Number(c.multa_atraso_pct)}% + juros ${Number(c.juros_mes_pct)}% a.m.`],
                ["Garantia", `${ROTULO_GARANTIA[c.garantia_tipo]}${c.garantia_valor ? ` · ${formatarReais(c.garantia_valor)}` : ""}`],
                ["Seguro incêndio", c.seguro_incendio_apolice ? `${c.seguro_incendio_apolice} (vence ${formatarDataBR(c.seguro_incendio_vencimento)})` : "—"],
                ["Rescisão/entrega", formatarDataBR(c.data_rescisao)],
              ]}
            />
          </Cartao>

          <Cartao
            titulo="Cobranças (faturas)"
            acoes={
              <Formulario acao={gerarFaturaManual} className="flex items-center gap-2">
                <input type="hidden" name="contrato_id" value={id} />
                <Entrada type="month" name="competencia" defaultValue={inicioDoMes(hoje).slice(0, 7)} className="w-40" />
                <BotaoEnviar variante="secundario">Gerar fatura</BotaoEnviar>
              </Formulario>
            }
          >
            <Tabela colunas={["Nº", "Competência", "Vencimento", "Valor", "Situação", "Pago em"]}>
              {faturas.length === 0 && <LinhaVazia colunas={6}>Nenhuma fatura gerada.</LinhaVazia>}
              {faturas.map((f) => (
                <tr key={f.id}>
                  <Celula>
                    <Link href={`/faturas/${f.id}`} className="text-acento hover:underline">
                      #{f.numero}
                    </Link>
                  </Celula>
                  <Celula>{formatarCompetencia(f.competencia)}</Celula>
                  <Celula>{formatarDataBR(f.vencimento)}</Celula>
                  <Celula>{formatarReais(f.valor_pago ?? f.valor_total)}</Celula>
                  <Celula>
                    <Selo cor={f.status === "aberta" && f.vencimento < hoje ? "vermelho" : corFatura[f.status]}>
                      {f.status === "aberta" && f.vencimento < hoje ? "em atraso" : f.status}
                    </Selo>
                  </Celula>
                  <Celula>{formatarDataBR(f.pago_em)}</Celula>
                </tr>
              ))}
            </Tabela>
          </Cartao>

          <Cartao titulo="Repasses ao proprietário">
            <Tabela colunas={["Competência", "Proprietário", "Bruto", "Taxas", "IRRF", "Líquido", "Previsto", "Situação"]}>
              {repasses.length === 0 && <LinhaVazia colunas={8}>Nenhum repasse.</LinhaVazia>}
              {repasses.map((r) => (
                <tr key={r.id}>
                  <Celula>{formatarCompetencia(r.competencia)}</Celula>
                  <Celula>{r.pessoa.nome}</Celula>
                  <Celula>{formatarReais(r.valor_bruto)}</Celula>
                  <Celula>{formatarReais(Number(r.taxa_administracao) + Number(r.taxa_intermediacao))}</Celula>
                  <Celula>{formatarReais(r.irrf)}</Celula>
                  <Celula className="font-medium">{formatarReais(r.valor_liquido)}</Celula>
                  <Celula>{formatarDataBR(r.previsto_para)}</Celula>
                  <Celula>
                    <Selo cor={r.status === "pago" ? "verde" : r.status === "pendente" ? "amarelo" : "cinza"}>{r.status}</Selo>
                  </Celula>
                </tr>
              ))}
            </Tabela>
          </Cartao>

          <Cartao titulo="Editar condições">
            <Formulario acao={atualizarContrato}>
              <input type="hidden" name="id" value={id} />
              <Grade colunas={4}>
                <Campo rotulo="Código interno">
                  <Entrada name="codigo" defaultValue={c.codigo ?? ""} />
                </Campo>
                <Campo rotulo="Dia do vencimento">
                  <Entrada type="number" min={1} max={31} name="dia_vencimento" defaultValue={c.dia_vencimento} />
                </Campo>
                <Campo rotulo="Modalidade">
                  <Selecao name="modalidade" defaultValue={c.modalidade}>
                    <option value="vencido">Mês vencido</option>
                    <option value="antecipado">Mês antecipado</option>
                  </Selecao>
                </Campo>
                <Campo rotulo="Índice">
                  <Selecao name="indice_reajuste" defaultValue={c.indice_reajuste}>
                    {INDICES.map((i) => (
                      <option key={i} value={i}>
                        {NOME_INDICE[i]}
                      </option>
                    ))}
                  </Selecao>
                </Campo>
                <Campo rotulo="Taxa adm. (%)">
                  <Entrada name="taxa_administracao_pct" defaultValue={String(c.taxa_administracao_pct)} />
                </Campo>
                <Campo rotulo="Tipo de repasse">
                  <Selecao name="tipo_repasse" defaultValue={c.tipo_repasse}>
                    {Object.entries(ROTULO_REPASSE).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </Selecao>
                </Campo>
                <Campo rotulo="Dias para repasse">
                  <Entrada type="number" min={0} name="dias_repasse" defaultValue={c.dias_repasse} />
                </Campo>
                <Campo rotulo="Carência (dias)">
                  <Entrada type="number" min={0} name="carencia_dias" defaultValue={c.carencia_dias} />
                </Campo>
                <Campo rotulo="Multa atraso (%)">
                  <Entrada name="multa_atraso_pct" defaultValue={String(c.multa_atraso_pct)} />
                </Campo>
                <Campo rotulo="Juros (% a.m.)">
                  <Entrada name="juros_mes_pct" defaultValue={String(c.juros_mes_pct)} />
                </Campo>
                <Campo rotulo="Garantia">
                  <Selecao name="garantia_tipo" defaultValue={c.garantia_tipo}>
                    {Object.entries(ROTULO_GARANTIA).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </Selecao>
                </Campo>
                <Campo rotulo="Valor garantia (R$)">
                  <Entrada name="garantia_valor" defaultValue={c.garantia_valor ? String(c.garantia_valor) : ""} />
                </Campo>
                <Campo rotulo="Detalhes da garantia" className="md:col-span-2">
                  <Entrada name="garantia_detalhes" defaultValue={c.garantia_detalhes ?? ""} />
                </Campo>
                <Campo rotulo="Apólice seguro incêndio">
                  <Entrada name="seguro_incendio_apolice" defaultValue={c.seguro_incendio_apolice ?? ""} />
                </Campo>
                <Campo rotulo="Vencimento seguro">
                  <Entrada type="date" name="seguro_incendio_vencimento" defaultValue={c.seguro_incendio_vencimento ?? ""} />
                </Campo>
              </Grade>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="repassar_multa_juros" defaultChecked={c.repassar_multa_juros} />
                Repassar multa e juros ao proprietário
              </label>
              <Campo rotulo="Observações">
                <AreaTexto name="observacoes" defaultValue={c.observacoes ?? ""} />
              </Campo>
              <div className="flex justify-end">
                <BotaoEnviar>Salvar alterações</BotaoEnviar>
              </div>
            </Formulario>
          </Cartao>
        </div>

        <div className="space-y-6">
          <Cartao titulo="Partes">
            <ul className="mb-4 space-y-2 text-sm">
              {partes.map((p) => (
                <li key={`${p.pessoa_id}-${p.papel}`} className="flex items-start justify-between gap-2">
                  <div>
                    <Link href={`/pessoas/${p.pessoa_id}`} className="font-medium text-acento hover:underline">
                      {p.pessoa.nome}
                    </Link>
                    <div className="text-xs text-mudo">
                      {ROTULO_PAPEL[p.papel]}
                      {p.papel === "proprietario" && ` · ${Number(p.percentual)}%`} · {formatarDocumento(p.pessoa.documento)}
                    </div>
                  </div>
                  <form action={removerParte}>
                    <input type="hidden" name="contrato_id" value={id} />
                    <input type="hidden" name="pessoa_id" value={p.pessoa_id} />
                    <input type="hidden" name="papel" value={p.papel} />
                    <button className="text-xs text-ruim hover:underline">remover</button>
                  </form>
                </li>
              ))}
            </ul>
            <Formulario acao={adicionarParte} className="space-y-3">
              <input type="hidden" name="contrato_id" value={id} />
              <Campo rotulo="Pessoa">
                <Selecao name="pessoa_id" required defaultValue="">
                  <option value="" disabled>
                    Selecione…
                  </option>
                  {((pessoas ?? []) as Pick<Pessoa, "id" | "nome">[]).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nome}
                    </option>
                  ))}
                </Selecao>
              </Campo>
              <div className="grid grid-cols-2 gap-2">
                <Campo rotulo="Papel">
                  <Selecao name="papel" defaultValue="fiador">
                    <option value="locatario">Locatário</option>
                    <option value="fiador">Fiador</option>
                    <option value="proprietario">Proprietário</option>
                  </Selecao>
                </Campo>
                <Campo rotulo="% (proprietário)">
                  <Entrada name="percentual" inputMode="decimal" />
                </Campo>
              </div>
              <BotaoEnviar variante="secundario">Adicionar</BotaoEnviar>
            </Formulario>
          </Cartao>

          <Cartao titulo="Encargos mensais">
            <ul className="mb-4 space-y-2 text-sm">
              {encargos.map((e) => (
                <li key={e.id} className="flex items-start justify-between gap-2">
                  <div>
                    {e.descricao} · <strong>{formatarReais(e.valor)}</strong>
                    <div className="text-xs text-mudo">
                      destino: {e.destino}
                      {e.inicio && ` · de ${formatarCompetencia(e.inicio)}`}
                      {e.fim && ` até ${formatarCompetencia(e.fim)}`}
                    </div>
                  </div>
                  <form action={removerEncargo}>
                    <input type="hidden" name="contrato_id" value={id} />
                    <input type="hidden" name="id" value={e.id} />
                    <button className="text-xs text-ruim hover:underline">remover</button>
                  </form>
                </li>
              ))}
              {encargos.length === 0 && <li className="text-mudo">Nenhum encargo.</li>}
            </ul>
            <Formulario acao={adicionarEncargo} className="space-y-3">
              <input type="hidden" name="contrato_id" value={id} />
              <Campo rotulo="Descrição">
                <Entrada name="descricao" required placeholder="IPTU 2027, taxa de lixo…" />
              </Campo>
              <div className="grid grid-cols-2 gap-2">
                <Campo rotulo="Valor (R$)">
                  <Entrada name="valor" required inputMode="decimal" />
                </Campo>
                <Campo rotulo="Destino">
                  <Selecao name="destino" defaultValue="proprietario">
                    <option value="proprietario">Proprietário</option>
                    <option value="terceiro">Terceiro</option>
                    <option value="imobiliaria">Imobiliária</option>
                  </Selecao>
                </Campo>
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

          <Cartao titulo="Reajuste">
            <p className="text-sm text-texto-2">
              Próximo aniversário: <strong>{formatarDataBR(dataReajuste)}</strong>
            </p>
            {previa.mesesFaltantes.length > 0 ? (
              <p className="mt-2 text-xs text-alerta">
                Faltam índices de {previa.mesesFaltantes.length} mês(es) do {c.indice_reajuste}.{" "}
                <Link href="/indices" className="underline">
                  Cadastrar índices
                </Link>
              </p>
            ) : (
              <p className="mt-2 text-sm">
                Acumulado: <strong>{previa.percentualAcumulado.toFixed(4)}%</strong> → novo aluguel{" "}
                <strong>{formatarReais(paraReais(previa.valorNovo))}</strong>
              </p>
            )}
            <Formulario acao={aplicarReajuste} className="mt-3 space-y-3">
              <input type="hidden" name="contrato_id" value={id} />
              <Campo rotulo="Data do reajuste">
                <Entrada type="date" name="data_reajuste" defaultValue={dataReajuste} />
              </Campo>
              <Campo rotulo="Percentual manual (opcional)" dica="Use para acordos ou índice negociado.">
                <Entrada name="percentual_manual" inputMode="decimal" />
              </Campo>
              <BotaoEnviar variante="secundario" confirmar="Aplicar o reajuste ao contrato?">
                Aplicar reajuste
              </BotaoEnviar>
            </Formulario>
            {(reajustes ?? []).length > 0 && (
              <ul className="mt-4 space-y-1 border-t border-borda-suave pt-3 text-xs text-texto-2">
                {(reajustes ?? []).map((r) => (
                  <li key={r.id}>
                    {formatarDataBR(r.data_reajuste)} · {r.indice} {Number(r.percentual).toFixed(2)}% ·{" "}
                    {formatarReais(r.valor_anterior)} → {formatarReais(r.valor_novo)}
                  </li>
                ))}
              </ul>
            )}
          </Cartao>

          <Cartao titulo="Rescisão / entrega das chaves">
            <form className="space-y-3">
              <Campo rotulo="Data de entrega das chaves">
                <Entrada type="date" name="entrega" defaultValue={entrega} required />
              </Campo>
              <Campo rotulo="Aluguel pago até" dica="Padrão: fim do período da última fatura paga.">
                <Entrada type="date" name="pagoAte" defaultValue={typeof sp.pagoAte === "string" ? sp.pagoAte : pagoAtePadrao} />
              </Campo>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="isentar" defaultChecked={sp.isentar === "on"} /> Isentar multa
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="aviso" value="nao" defaultChecked={sp.aviso === "nao"} /> Sem aviso prévio (prazo indeterminado)
              </label>
              <button className={classeBotao("secundario")}>Calcular</button>
            </form>
            {rescisao && (
              <div className="mt-4 space-y-1 border-t border-borda-suave pt-3 text-sm">
                <div className="flex justify-between">
                  <span>Saldo de aluguel ({rescisao.diasSaldo} dias)</span>
                  <span>{formatarReais(paraReais(rescisao.saldoAluguel))}</span>
                </div>
                <div className="flex justify-between">
                  <span>Multa</span>
                  <span>{formatarReais(paraReais(rescisao.multa))}</span>
                </div>
                <div className="text-xs text-mudo">{rescisao.multaFundamento}</div>
                <div className="flex justify-between">
                  <span>Faturas em aberto</span>
                  <span>{formatarReais(paraReais(rescisao.debitosPendentes))}</span>
                </div>
                {rescisao.caucao > 0 && (
                  <div className="flex justify-between">
                    <span>(−) Caução</span>
                    <span>{formatarReais(paraReais(rescisao.caucao))}</span>
                  </div>
                )}
                <div className="flex justify-between border-t border-borda-suave pt-1 font-semibold">
                  <span>{rescisao.totalDevido >= 0 ? "Total a cobrar" : "A devolver ao locatário"}</span>
                  <span>{formatarReais(Math.abs(paraReais(rescisao.totalDevido)))}</span>
                </div>
                {c.status === "ativo" && (
                  <Formulario acao={encerrarContrato} className="pt-3">
                    <input type="hidden" name="contrato_id" value={id} />
                    <input type="hidden" name="data_entrega" value={entrega} />
                    <input type="hidden" name="tipo" value="rescindido" />
                    <BotaoEnviar variante="perigo" confirmar="Encerrar o contrato nesta data?">
                      Encerrar contrato em {formatarDataBR(entrega)}
                    </BotaoEnviar>
                  </Formulario>
                )}
              </div>
            )}
          </Cartao>
        </div>
      </div>
    </>
  );
}
