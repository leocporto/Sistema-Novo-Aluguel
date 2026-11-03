import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlarmClock, MessageCircle, ShieldAlert, TrendingUp } from "lucide-react";
import type { ReactNode } from "react";
import { BotaoExcluir } from "@/components/botao-excluir";
import { Formulario } from "@/components/formulario";
import { AreaTexto, Campo, Cartao, Definicao, Entrada, Grade, Selecao, classeBotao } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { diasEntre, formatarDataBR, hojeISO, somarDias } from "@/lib/dominio/datas";
import { formatarReais } from "@/lib/dominio/dinheiro";
import { ROTULO_TIPO_GARANTIA, situacaoGarantia } from "@/lib/dominio/garantias";
import { INDICES, NOME_INDICE, proximoReajuste } from "@/lib/dominio/reajuste";
import { carregarContrato } from "@/lib/servicos/locacao";
import { ROTULO_REPASSE } from "@/lib/tipos";
import { linkWhatsapp } from "@/lib/whatsapp";
import { atualizarContrato, excluirContrato } from "../actions";

export const metadata: Metadata = { title: "Contrato" };

export default async function ContratoResumo({ params }: PageProps<"/contratos/[id]">) {
  const { id } = await params;
  const { supabase, organizacao } = await obterContexto();
  const pessoal = organizacao.modo === "pessoal";
  const dados = await carregarContrato(supabase, id);
  if (!dados) notFound();
  const { contrato: c, partes } = dados;
  const hoje = hojeISO();
  const { data: garantias } = await supabase.from("contrato_garantias").select("tipo, valor, fim, status, pessoa:pessoas(nome)").eq("contrato_id", id);

  const locatarios = partes.filter((p) => p.papel === "locatario");
  const loc = locatarios[0]?.pessoa;
  const dataReajuste = proximoReajuste(c.data_base_reajuste, c.periodicidade_reajuste_meses);
  const fim = c.data_rescisao ?? c.data_fim;
  const diasParaFim = diasEntre(hoje, fim);
  const avisoFim = c.aviso_fim_dias ?? 60;
  const ativo = c.status === "ativo";
  type G = { tipo: string; valor: number | null; fim: string | null; status: string; pessoa: { nome: string } | null };
  const gs = (garantias ?? []) as unknown as G[];
  const ativas = gs.filter((g) => g.status === "ativa");

  const avisos: { icone: ReactNode; texto: string; acao?: ReactNode; tom: "ruim" | "alerta" | "info" }[] = [];
  if (ativo && diasParaFim <= avisoFim)
    avisos.push({
      icone: <AlarmClock />,
      texto: diasParaFim < 0 ? `O prazo do contrato venceu em ${formatarDataBR(fim)} (segue por prazo indeterminado).` : `O contrato vence em ${diasParaFim} dia(s), em ${formatarDataBR(fim)}.`,
      tom: diasParaFim < 0 ? "ruim" : "alerta",
      acao: (
        <span className="flex flex-wrap gap-2">
          {loc?.telefone && (
            <a
              href={linkWhatsapp(loc.telefone, `Olá ${loc.nome.split(" ")[0]}! O contrato de locação do imóvel vence em ${formatarDataBR(fim)}. Vamos conversar sobre a renovação?`)}
              target="_blank"
              rel="noreferrer"
              className={classeBotao("secundario", "sm")}
            >
              <MessageCircle className="size-3.5" /> Avisar locatário
            </a>
          )}
          <Link href={`/contratos/${id}/reajustes`} className={classeBotao("secundario", "sm")}>
            Renovar
          </Link>
        </span>
      ),
    });
  if (ativo && dataReajuste <= somarDias(hoje, 30))
    avisos.push({ icone: <TrendingUp />, texto: `Reajuste previsto para ${formatarDataBR(dataReajuste)}.`, tom: "info", acao: <Link href={`/contratos/${id}/reajustes`} className={classeBotao("secundario", "sm")}>Ver reajuste</Link> });
  for (const g of ativas) {
    const s = situacaoGarantia(g, hoje);
    if (s === "vencida" || s === "vencendo")
      avisos.push({
        icone: <ShieldAlert />,
        texto: `${ROTULO_TIPO_GARANTIA[g.tipo]} ${s === "vencida" ? "venceu" : "vence"} em ${formatarDataBR(g.fim)}.`,
        tom: s === "vencida" ? "ruim" : "alerta",
        acao: <Link href={`/contratos/${id}/partes`} className={classeBotao("secundario", "sm")}>Ver garantias</Link>,
      });
  }
  if (ativo && c.seguro_incendio_vencimento && c.seguro_incendio_vencimento <= somarDias(hoje, 30))
    avisos.push({ icone: <ShieldAlert />, texto: `Seguro incêndio ${c.seguro_incendio_vencimento < hoje ? "vencido" : "vencendo"} em ${formatarDataBR(c.seguro_incendio_vencimento)}.`, tom: "alerta" });
  const corTom = { ruim: "border-ruim-bd bg-ruim-bg text-ruim", alerta: "border-alerta-bd bg-alerta-bg text-alerta", info: "border-acento-bd bg-acento-bg text-acento-hot" };
  const v = (n: unknown) => (n === null || n === undefined ? "" : String(n));

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
      <div className="space-y-6">
        {avisos.length > 0 && (
          <div className="entrar-cascata space-y-2">
            {avisos.map((a, i) => (
              <div key={i} className={`flex flex-wrap items-center gap-3 rounded-[14px] border px-4 py-3 text-sm ${corTom[a.tom]}`}>
                <span className="[&>svg]:size-4">{a.icone}</span>
                <span className="min-w-0 flex-1 font-medium">{a.texto}</span>
                {a.acao}
              </div>
            ))}
          </div>
        )}
        <Cartao titulo="Resumo">
          <Definicao
            itens={[
              ["Locatário(s)", locatarios.map((p) => p.pessoa.nome).join(", ") || "—"],
              ["Aluguel atual", formatarReais(c.valor_aluguel)],
              ["Vigência", `${formatarDataBR(c.data_inicio)} a ${formatarDataBR(c.data_fim)} (${c.prazo_meses} meses)${c.renovacao_automatica ? " · renova sozinho" : ""}`],
              ["Vencimento", `Dia ${c.dia_vencimento} · mês ${c.modalidade}`],
              ["Reajuste", `${NOME_INDICE[c.indice_reajuste as keyof typeof NOME_INDICE] ?? c.indice_reajuste} a cada ${c.periodicidade_reajuste_meses} meses · próximo ${formatarDataBR(dataReajuste)}`],
              ...(Number(c.carencia_meses ?? 0) > 0
                ? ([["Carência", `${c.carencia_meses} mês(es) com ${Number(c.carencia_desconto_pct ?? 100)}% de desconto no aluguel`]] as [string, string][])
                : []),
              ...(Number(c.desconto_pontualidade_pct ?? 0) > 0 ? ([["Pontualidade", `${Number(c.desconto_pontualidade_pct)}% de desconto pagando até o vencimento`]] as [string, string][]) : []),
              ...(pessoal
                ? []
                : ([
                    ["Taxa de administração", `${Number(c.taxa_administracao_pct)}%`],
                    ["Intermediação", `${Number(c.taxa_intermediacao_pct)}% do 1º aluguel`],
                    ["Repasse", `${ROTULO_REPASSE[c.tipo_repasse]} · ${c.dias_repasse} dia(s)`],
                  ] as [string, string][])),
              ["Atraso", `Multa ${Number(c.multa_atraso_pct)}% + juros ${Number(c.juros_mes_pct)}% a.m.${c.carencia_dias ? ` · tolerância ${c.carencia_dias} dia(s)` : ""}`],
              ["Garantias", ativas.length ? ativas.map((g) => `${ROTULO_TIPO_GARANTIA[g.tipo]}${g.pessoa ? ` (${g.pessoa.nome})` : ""}${g.valor ? ` ${formatarReais(g.valor)}` : ""}`).join(" · ") : "—"],
              ["Seguro incêndio", c.seguro_incendio_apolice ? `${c.seguro_incendio_apolice} (vence ${formatarDataBR(c.seguro_incendio_vencimento)})` : "—"],
              ["Rescisão/entrega", formatarDataBR(c.data_rescisao)],
            ]}
          />
        </Cartao>

        <Cartao titulo="Condições do contrato">
          <Formulario acao={atualizarContrato} automatico>
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="_repassar" value="1" />
            <input type="hidden" name="_renovacao" value="1" />
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
              {!pessoal && (
                <>
                  <Campo rotulo="Taxa adm. (%)" dica="Pode ser 0%.">
                    <Entrada name="taxa_administracao_pct" defaultValue={v(c.taxa_administracao_pct)} />
                  </Campo>
                  <Campo rotulo="Tipo de repasse">
                    <Selecao name="tipo_repasse" defaultValue={c.tipo_repasse}>
                      {Object.entries(ROTULO_REPASSE).map(([k, r]) => (
                        <option key={k} value={k}>
                          {r}
                        </option>
                      ))}
                    </Selecao>
                  </Campo>
                  <Campo rotulo="Dias para repasse">
                    <Entrada type="number" min={0} name="dias_repasse" defaultValue={c.dias_repasse} />
                  </Campo>
                </>
              )}
              <Campo rotulo="Tolerância de atraso (dias)">
                <Entrada type="number" min={0} name="carencia_dias" defaultValue={c.carencia_dias} />
              </Campo>
              <Campo rotulo="Multa atraso (%)">
                <Entrada name="multa_atraso_pct" defaultValue={v(c.multa_atraso_pct)} />
              </Campo>
              <Campo rotulo="Juros (% a.m.)">
                <Entrada name="juros_mes_pct" defaultValue={v(c.juros_mes_pct)} />
              </Campo>
              <Campo rotulo="Multa rescisória (aluguéis)">
                <Entrada name="multa_rescisoria_alugueis" inputMode="decimal" defaultValue={v(c.multa_rescisoria_alugueis)} />
              </Campo>
              <Campo rotulo="Desconto pontualidade (%)" dica="Pagando até o vencimento">
                <Entrada name="desconto_pontualidade_pct" inputMode="decimal" defaultValue={v(c.desconto_pontualidade_pct ?? 0)} />
              </Campo>
              <Campo rotulo="Carência (meses)" dica="Meses iniciais com desconto">
                <Entrada type="number" min={0} max={60} name="carencia_meses" defaultValue={c.carencia_meses ?? 0} />
              </Campo>
              <Campo rotulo="Desconto na carência (%)" dica="100 = aluguel isento">
                <Entrada name="carencia_desconto_pct" inputMode="decimal" defaultValue={v(c.carencia_desconto_pct ?? 100)} />
              </Campo>
              <Campo rotulo="Avisar o fim com (dias)">
                <Entrada type="number" min={0} max={365} name="aviso_fim_dias" defaultValue={c.aviso_fim_dias ?? 60} />
              </Campo>
              <Campo rotulo="Apólice seguro incêndio">
                <Entrada name="seguro_incendio_apolice" defaultValue={c.seguro_incendio_apolice ?? ""} />
              </Campo>
              <Campo rotulo="Vencimento do seguro">
                <Entrada type="date" name="seguro_incendio_vencimento" defaultValue={c.seguro_incendio_vencimento ?? ""} />
              </Campo>
            </Grade>
            <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
              {!pessoal && (
                <label className="flex items-center gap-2">
                  <input type="checkbox" name="repassar_multa_juros" defaultChecked={c.repassar_multa_juros} />
                  Repassar multa e juros ao proprietário
                </label>
              )}
              {pessoal && c.repassar_multa_juros && <input type="hidden" name="repassar_multa_juros" value="on" />}
              <label className="flex items-center gap-2">
                <input type="checkbox" name="renovacao_automatica" defaultChecked={c.renovacao_automatica ?? false} />
                Renovação automática (segue por prazo indeterminado ao vencer)
              </label>
            </div>
            <Campo rotulo="Observações">
              <AreaTexto name="observacoes" defaultValue={c.observacoes ?? ""} />
            </Campo>
          </Formulario>
        </Cartao>
      </div>

      <div className="space-y-6">
        <Cartao titulo="Atalhos">
          <ul className="space-y-2 text-sm">
            <li>
              <Link href={`/contratos/${id}/cobrancas`} className="text-acento hover:underline">
                Gerar fatura, descontos e itens avulsos
              </Link>
            </li>
            <li>
              <Link href={`/contratos/${id}/partes`} className="text-acento hover:underline">
                Locatários, fiadores e garantias
              </Link>
            </li>
            <li>
              <Link href={`/contratos/${id}/reajustes`} className="text-acento hover:underline">
                Reajustar, renovar ou fazer aditivo
              </Link>
            </li>
            <li>
              <Link href={`/contratos/${id}/encerramento`} className="text-acento hover:underline">
                Desocupação, multa e acerto de saída
              </Link>
            </li>
            <li>
              <Link href={`/contratos/${id}/demonstrativos`} className="text-acento hover:underline">
                Recibos e demonstrativos
              </Link>
            </li>
            <li>
              <Link href={`/documentos?novo=1&contrato=${id}&imovel=${c.imovel_id}`} className="text-acento hover:underline">
                Gerar documento (aditivo, notificação…) para assinar
              </Link>
            </li>
            <li>
              <Link href={`/documentos?imovel=${c.imovel_id}`} className="text-acento hover:underline">
                Documentos deste imóvel
              </Link>
            </li>
          </ul>
        </Cartao>
        <BotaoExcluir
          acao={excluirContrato}
          id={id}
          variante="botao"
          rotulo="Excluir contrato"
          confirmar="Excluir este contrato lançado por engano? Faturas em aberto, partes e encargos saem junto. (Se já houve pagamento, o sistema não deixa — faça a desocupação.)"
          depois="/contratos"
        />
      </div>
    </div>
  );
}
