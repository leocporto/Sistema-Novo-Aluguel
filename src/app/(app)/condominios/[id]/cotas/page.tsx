import type { Metadata } from "next";
import Link from "next/link";
import { Ban, Droplets, FilePlus2, HandCoins, Printer, Receipt } from "lucide-react";
import { Contador } from "@/components/abas-segmentadas";
import { BotaoExcluir } from "@/components/botao-excluir";
import { JanelaCadastro } from "@/components/janela-cadastro";
import { NavegadorMes, lerMes } from "@/components/navegador-mes";
import { Aviso, BotaoLink, Campo, Cartao, Celula, Entrada, Grade, Indicador, LinhaVazia, Selecao, Selo, Tabela } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { diaLocal } from "@/lib/dominio/agenda";
import { COR_STATUS_COTA, STATUS_COTA, TIPOS_CONSUMO, TIPOS_COTA, baseDoOrcamento, calcularCotas, nomeUnidade, resumoCotasMes, situacaoCota, type CotaCalculada } from "@/lib/dominio/condominios";
import { diaNoMes, formatarCompetencia, formatarDataBR, hojeISO } from "@/lib/dominio/datas";
import { formatarReais, paraCentavos, paraReais } from "@/lib/dominio/dinheiro";
import { todas } from "../../../financeiro/dados";
import { cancelarCota, cotaAvulsa, excluirConsumo, gerarCotas, receberCota, registrarConsumo } from "../../actions";
import { carregarCondominio, contasDo, unidadesDo } from "../../dados";
import { CamposReceber } from "../receber-campos";

export const metadata: Metadata = { title: "Cotas do condomínio" };

type Cota = { id: string; numero: number; unidade_id: string; tipo: string; competencia: string; vencimento: string; valor: number; valor_abatido: number; status: string; juridico: boolean };
type Pag = { cota_id: string; data: string; valor: number; principal: number; multa: number; juros: number; desconto: number };

/**
 * Cotas do mês: prévia da divisão (mesma conta do banco), gerar, receber
 * (parcial, com multa e juros), 2ª via com Pix, cancelar, cobrança avulsa e
 * consumo individual (água/gás).
 */
export default async function CotasPage({ params, searchParams }: PageProps<"/condominios/[id]/cotas">) {
  const { id } = await params;
  const sp = await searchParams;
  const { supabase } = await obterContexto();
  const hoje = hojeISO();
  const mes = lerMes(sp.mes, hoje);
  const comp = `${mes}-01`;
  const c = (await carregarCondominio(supabase, id))!;
  const [unidades, contas, { data: orc }, { data: rateios }, { data: consumos }, { data: reservas }, cotas] = await Promise.all([
    unidadesDo(supabase, id),
    contasDo(supabase, id),
    supabase.from("cond_orcamentos").select("id, itens:cond_orcamento_itens(tipo, valor_mensal)").eq("condominio_id", id).eq("ano", Number(mes.slice(0, 4))).eq("status", "aprovado").maybeSingle(),
    supabase.from("cond_rateios").select("id, descricao, tipo, valor_total, parcelas, primeira_competencia, criterio, ativo").eq("condominio_id", id).eq("ativo", true),
    supabase.from("cond_consumos").select("id, unidade_id, tipo, valor, leitura_anterior, leitura_atual, cota_item_id").eq("condominio_id", id).eq("competencia", comp),
    supabase.from("cond_reservas").select("id, unidade_id, inicio, taxa, area:cond_areas(nome)").eq("condominio_id", id).eq("status", "confirmada").is("cota_item_id", null).gt("taxa", 0).lt("inicio", `${comp}T03:00:00Z`),
    todas<Cota>(() => supabase.from("cond_cotas").select("id, numero, unidade_id, tipo, competencia, vencimento, valor, valor_abatido, status, juridico").eq("condominio_id", id).eq("competencia", comp).neq("status", "cancelada").order("id")),
  ]);
  // Pagamentos (não desfeitos) das cotas do mês: filtro pela competência da cota no banco (sem lista enorme de ids na URL).
  const pags = cotas.length
    ? await todas<Pag>(() =>
        supabase
          .from("cond_cota_pagamentos")
          .select("id, cota_id, data, valor, principal, multa, juros, desconto, cota:cond_cotas!inner(competencia)")
          .eq("condominio_id", id)
          .eq("cota.competencia", comp)
          .is("estornado_em", null)
          .order("id"),
      )
    : [];
  const nomeU = new Map(unidades.map((u) => [u.id, nomeUnidade(u)]));
  const base = baseDoOrcamento(((orc?.itens as { tipo: string; valor_mensal: number }[]) ?? []));
  const jaTem = new Set(cotas.filter((q) => q.tipo === "ordinaria").map((q) => q.unidade_id));

  // Prévia (mesma conta do banco).
  let previa: CotaCalculada[] = [];
  let erroPrevia: string | null = null;
  try {
    if (base > 0 && unidades.length)
      previa = calcularCotas({
        competencia: comp,
        unidades: unidades.map((u) => ({ id: u.id, fracao: u.fracao_ideal, area: u.area_privativa })),
        criterio: c.criterio_rateio,
        base,
        fundoReservaPct: Number(c.fundo_reserva_pct),
        rateios: (rateios ?? []).map((r) => ({
          id: r.id as string,
          descricao: r.descricao as string,
          valorTotal: paraCentavos(r.valor_total as number),
          parcelas: r.parcelas as number,
          primeiraCompetencia: r.primeira_competencia as string,
          criterio: r.criterio as "fracao" | "igual" | "area",
        })),
        consumos: (consumos ?? []).filter((k) => !k.cota_item_id).map((k) => ({ id: k.id as string, unidadeId: k.unidade_id as string, tipo: k.tipo as string, valor: paraCentavos(k.valor as number) })),
        reservas: (reservas ?? []).map((r) => ({ id: r.id as string, unidadeId: r.unidade_id as string, area: (r.area as unknown as { nome: string } | null)?.nome ?? "Área", data: diaLocal(r.inicio as string), valor: paraCentavos(r.taxa as number) })),
      });
  } catch (e) {
    erroPrevia = e instanceof Error ? e.message : "Não foi possível calcular.";
  }
  const novas = previa.filter((p) => !jaTem.has(p.unidadeId));
  const totalNovas = paraReais(novas.reduce((a, p) => a + p.total, 0));

  const pagosDe = (q: Cota) =>
    pags.filter((p) => p.cota_id === q.id).map((p) => ({ data: p.data, valor: paraCentavos(p.valor), principal: paraCentavos(p.principal), multa: paraCentavos(p.multa), juros: paraCentavos(p.juros), desconto: paraCentavos(p.desconto) }));
  const sit = (q: Cota) => situacaoCota({ valor: paraCentavos(q.valor), vencimento: q.vencimento }, pagosDe(q), { multaPct: Number(c.multa_pct), jurosMesPct: Number(c.juros_mes_pct) }, hoje);
  // Emitido = em aberto + pagas (a renegociada virou parcelas de acordo); recebido = dinheiro que entrou; em aberto = saldo das abertas.
  const resumo = resumoCotasMes(
    cotas.map((q) => ({ id: q.id, status: q.status, valor: paraCentavos(q.valor), abatido: paraCentavos(q.valor_abatido) })),
    pags.map((p) => ({ cotaId: p.cota_id, valor: paraCentavos(p.valor), principal: paraCentavos(p.principal), multa: paraCentavos(p.multa), juros: paraCentavos(p.juros), desconto: paraCentavos(p.desconto) })),
  );
  const detalheRecebido = [
    `${resumo.pagas} paga(s)`,
    resumo.encargos > 0 ? `com ${formatarReais(paraReais(resumo.encargos))} de multa e juros` : null,
    resumo.desconto > 0 ? `desconto dado: ${formatarReais(paraReais(resumo.desconto))}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const ordenadas = [...cotas].sort((a, b) => (nomeU.get(a.unidade_id) ?? "").localeCompare(nomeU.get(b.unidade_id) ?? "", "pt-BR", { numeric: true }) || a.numero - b.numero);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <NavegadorMes caminho={`/condominios/${id}/cotas`} mes={mes} hoje={hoje} />
        <div className="flex flex-wrap gap-2">
          <JanelaCadastro rotuloBotao={<><Droplets className="size-4" /> Consumo</>} variante="secundario" titulo={`Consumo individual de ${formatarCompetencia(comp)}`} acao={registrarConsumo} icone={<Droplets />}>
            <input type="hidden" name="condominio_id" value={id} />
            <input type="hidden" name="mes" value={mes} />
            <Grade colunas={2}>
              <Campo rotulo="Unidade">
                <Selecao name="unidade_id" required defaultValue="">
                  <option value="" disabled>
                    Escolha…
                  </option>
                  {unidades.map((u) => (
                    <option key={u.id} value={u.id}>
                      {nomeUnidade(u)}
                    </option>
                  ))}
                </Selecao>
              </Campo>
              <Campo rotulo="Tipo">
                <Selecao name="tipo" defaultValue="agua">
                  {Object.entries(TIPOS_CONSUMO).map(([k, r]) => (
                    <option key={k} value={k}>
                      {r}
                    </option>
                  ))}
                </Selecao>
              </Campo>
              <Campo rotulo="Leitura anterior">
                <Entrada name="leitura_anterior" inputMode="decimal" />
              </Campo>
              <Campo rotulo="Leitura atual">
                <Entrada name="leitura_atual" inputMode="decimal" />
              </Campo>
              <Campo rotulo="Preço por m³ / unidade (R$)">
                <Entrada name="tarifa" inputMode="decimal" />
              </Campo>
              <Campo rotulo="Ou o valor direto (R$)">
                <Entrada name="valor" inputMode="decimal" />
              </Campo>
            </Grade>
          </JanelaCadastro>
          <JanelaCadastro rotuloBotao={<><FilePlus2 className="size-4" /> Cobrança avulsa</>} variante="secundario" titulo="Cobrança avulsa para uma unidade" acao={cotaAvulsa} icone={<FilePlus2 />}>
            <input type="hidden" name="condominio_id" value={id} />
            <Campo rotulo="Unidade">
              <Selecao name="unidade_id" required defaultValue="">
                <option value="" disabled>
                  Escolha…
                </option>
                {unidades.map((u) => (
                  <option key={u.id} value={u.id}>
                    {nomeUnidade(u)}
                  </option>
                ))}
              </Selecao>
            </Campo>
            <Campo rotulo="Descrição">
              <Entrada name="descricao" required placeholder="Ex.: Multa por infração ao regimento" />
            </Campo>
            <Grade colunas={2}>
              <Campo rotulo="Valor (R$)">
                <Entrada name="valor" required inputMode="decimal" />
              </Campo>
              <Campo rotulo="Vencimento">
                <Entrada name="vencimento" type="date" required defaultValue={diaNoMes(comp, c.dia_vencimento)} />
              </Campo>
            </Grade>
          </JanelaCadastro>
          <JanelaCadastro rotuloBotao={<><Receipt className="size-4" /> Gerar cotas</>} titulo={`Gerar as cotas de ${formatarCompetencia(comp)}`} acao={gerarCotas} icone={<Receipt />} rotuloSalvar="Gerar">
            <input type="hidden" name="condominio_id" value={id} />
            <input type="hidden" name="mes" value={mes} />
            <p className="text-sm text-texto-2">
              Vencimento dia {c.dia_vencimento}. Divisão {c.criterio_rateio === "fracao" ? "pela fração ideal" : c.criterio_rateio === "area" ? "pela área privativa" : "igual entre as unidades"}
              {Number(c.fundo_reserva_pct) > 0 ? `, mais ${c.fundo_reserva_pct}% de fundo de reserva` : ""}, rateios extras do mês, consumo individual e taxas de reserva.
            </p>
            <Campo rotulo="Total das despesas do mês (R$)" dica={base > 0 ? "Vem do orçamento aprovado do ano. Mude só se precisar." : "Sem orçamento aprovado para o ano: informe o total."}>
              <Entrada name="valor_base" inputMode="decimal" defaultValue={base > 0 ? paraReais(base).toFixed(2).replace(".", ",") : ""} required={base <= 0} />
            </Campo>
            {base > 0 && (
              <p className="text-sm text-texto-2">
                {novas.length} cota(s) nova(s), {formatarReais(totalNovas)} no total{jaTem.size ? ` (${jaTem.size} unidade(s) já têm cota do mês e ficam como estão)` : ""}.
              </p>
            )}
          </JanelaCadastro>
        </div>
      </div>

      {erroPrevia && <Aviso tipo="alerta">{erroPrevia} Complete o cadastro em Unidades antes de gerar.</Aviso>}

      <div className="entrar-cascata grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Indicador
          rotulo="Emitido no mês"
          icone={<Receipt />}
          valor={<Contador valor={paraReais(resumo.emitido)} formato="moeda" />}
          detalhe={`${resumo.emitidas} cobrança(s)${resumo.renegociadas ? ` · fora ${resumo.renegociadas} em acordo` : ""}`}
        />
        <Indicador rotulo="Recebido" icone={<HandCoins />} tom="sucesso" valor={<Contador valor={paraReais(resumo.recebido)} formato="moeda" />} detalhe={detalheRecebido} />
        <Indicador
          rotulo="Em aberto"
          icone={<Receipt />}
          tom={resumo.abertas ? "alerta" : "neutro"}
          valor={<Contador valor={paraReais(resumo.emAberto)} formato="moeda" />}
          detalhe={`${resumo.abertas} cota(s)${resumo.renegociadas ? ` · ${formatarReais(paraReais(resumo.valorRenegociado))} em acordo` : ""}`}
        />
        <Indicador rotulo="Base do orçamento" icone={<Receipt />} valor={<Contador valor={paraReais(base)} formato="moeda" />} detalhe={base > 0 ? "por mês, orçamento aprovado" : "sem orçamento aprovado"} />
      </div>

      {(consumos ?? []).length > 0 && (
        <Cartao titulo={`Consumo individual de ${formatarCompetencia(comp)}`}>
          <div className="flex flex-wrap gap-2">
            {(consumos ?? []).map((k) => (
              <span key={k.id as string} className="inline-flex items-center gap-2 rounded-full border border-borda bg-elev py-1 pl-3 pr-1 text-sm">
                {nomeU.get(k.unidade_id as string)} · {TIPOS_CONSUMO[k.tipo as keyof typeof TIPOS_CONSUMO]} {formatarReais(k.valor as number)}
                {k.cota_item_id ? <Selo cor="verde">na cota</Selo> : <BotaoExcluir acao={excluirConsumo} id={k.id as string} rotulo="Excluir consumo" confirmar="Excluir este consumo?" />}
              </span>
            ))}
          </div>
        </Cartao>
      )}

      <Tabela colunas={["Nº", "Unidade", "Tipo", "Vencimento", "Valor", "Situação", ""]}>
        {ordenadas.map((q) => {
          const s = sit(q);
          return (
            <tr key={q.id}>
              <Celula className="tabular-nums text-mudo">{q.numero}</Celula>
              <Celula className="font-medium">{nomeU.get(q.unidade_id) ?? "—"}</Celula>
              <Celula className="text-sm text-texto-2">{TIPOS_COTA[q.tipo as keyof typeof TIPOS_COTA] ?? q.tipo}</Celula>
              <Celula className="text-sm">
                {formatarDataBR(q.vencimento)}
                {q.status === "aberta" && s.diasAtraso > 0 && <span className="block text-xs font-semibold text-ruim">{s.diasAtraso} dia(s) de atraso</span>}
              </Celula>
              <Celula className="tabular-nums">
                {formatarReais(q.valor)}
                {q.status === "aberta" && Number(q.valor_abatido) > 0 && <span className="block text-xs text-mudo">falta {formatarReais(paraReais(s.saldo))}</span>}
              </Celula>
              <Celula>
                <span className="flex flex-wrap gap-1">
                  <Selo cor={COR_STATUS_COTA[q.status] ?? "cinza"}>{STATUS_COTA[q.status as keyof typeof STATUS_COTA] ?? q.status}</Selo>
                  {q.juridico && <Selo cor="vermelho">jurídico</Selo>}
                </span>
              </Celula>
              <Celula>
                <span className="flex justify-end gap-2">
                  {q.status === "aberta" && (
                    <JanelaCadastro rotuloBotao="Receber" tamanho="sm" titulo={`Receber cota nº ${q.numero} — ${nomeU.get(q.unidade_id)}`} acao={receberCota} icone={<HandCoins />} rotuloSalvar="Registrar recebimento">
                      <CamposReceber condominioId={id} cotaId={q.id} saldo={paraReais(s.saldo)} multa={paraReais(s.multa)} juros={paraReais(s.juros)} hoje={hoje} contas={contas} />
                    </JanelaCadastro>
                  )}
                  <BotaoLink href={`/condominios/${id}/cotas/${q.id}`} variante="secundario">
                    <Printer className="size-4" />
                  </BotaoLink>
                  {q.status === "aberta" && q.tipo !== "acordo" && Number(q.valor_abatido) === 0 && (
                    <JanelaCadastro rotuloBotao={<Ban className="size-4" />} variante="fantasma" tamanho="sm" titulo={`Cancelar a cota nº ${q.numero}`} acao={cancelarCota} icone={<Ban />} rotuloSalvar="Cancelar cota">
                      <input type="hidden" name="condominio_id" value={id} />
                      <input type="hidden" name="cota_id" value={q.id} />
                      <p className="text-sm text-texto-2">
                        {formatarReais(q.valor)} de {nomeU.get(q.unidade_id)}. Consumos e taxas de reserva voltam a ficar para cobrar na próxima geração.
                      </p>
                      <Campo rotulo="Motivo">
                        <Entrada name="motivo" required placeholder="Ex.: gerada com o valor errado" />
                      </Campo>
                    </JanelaCadastro>
                  )}
                </span>
              </Celula>
            </tr>
          );
        })}
        {ordenadas.length === 0 && <LinhaVazia colunas={7}>Nenhuma cota em {formatarCompetencia(comp)}. Use “Gerar cotas”.</LinhaVazia>}
      </Tabela>
      <p className="text-xs text-mudo">
        Boleto registrado depende do contrato com o banco (fica pronto para ligar em Integrações). Até lá, a 2ª via (<Link href={`/condominios/${id}/portal`} className="text-acento hover:underline">e o portal do condômino</Link>) traz o Pix copia e cola.
      </p>
    </div>
  );
}
