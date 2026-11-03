import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FilePlus2, Printer, RefreshCw } from "lucide-react";
import { BotaoAcao } from "@/components/botao-acao";
import { BotaoExcluir } from "@/components/botao-excluir";
import { BotaoEnviar, Formulario } from "@/components/formulario";
import { JanelaCadastro } from "@/components/janela-cadastro";
import { AreaTexto, Campo, Cartao, Entrada, Selecao, Selo } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { formatarDataBR, hojeISO, somarDias, somarMeses } from "@/lib/dominio/datas";
import { formatarReais, paraReais } from "@/lib/dominio/dinheiro";
import { proximoReajuste } from "@/lib/dominio/reajuste";
import { calcularReajusteDoContrato, carregarContrato } from "@/lib/servicos/locacao";
import { aplicarReajuste } from "../../actions";
import { aplicarAditivo, criarAditivo, excluirAditivo, renovarContrato } from "../../locacao-actions";
import { ROTULO_ADITIVO } from "../rotulos";

export const metadata: Metadata = { title: "Reajustes e aditivos" };


type A = { id: string; numero: number; tipo: string; descricao: string; data: string; valor_anterior: number | null; valor_novo: number | null; data_fim_anterior: string | null; data_fim_nova: string | null; aplicado_em: string | null };

export default async function ReajustesContrato({ params }: PageProps<"/contratos/[id]/reajustes">) {
  const { id } = await params;
  const { supabase } = await obterContexto();
  const dados = await carregarContrato(supabase, id);
  if (!dados) notFound();
  const { contrato: c } = dados;
  const [{ data: reajustes }, { data: ads }] = await Promise.all([
    supabase.from("contrato_reajustes").select("*").eq("contrato_id", id).order("data_reajuste", { ascending: false }),
    supabase.from("contrato_aditivos").select("*").eq("contrato_id", id).order("numero", { ascending: false }),
  ]);
  const dataReajuste = proximoReajuste(c.data_base_reajuste, c.periodicidade_reajuste_meses);
  const previa = await calcularReajusteDoContrato(supabase, c, dataReajuste);
  const aditivos = (ads ?? []) as A[];
  const fimRenovado = somarDias(somarMeses(somarDias(c.data_fim, 1), 12), -1);

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <div className="space-y-6">
        <Cartao titulo="Reajuste anual">
          <p className="text-sm text-texto-2">
            Próximo aniversário: <strong>{formatarDataBR(dataReajuste)}</strong> · aluguel atual <strong>{formatarReais(c.valor_aluguel)}</strong>
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
              Acumulado: <strong>{previa.percentualAcumulado.toFixed(4)}%</strong> → novo aluguel <strong>{formatarReais(paraReais(previa.valorNovo))}</strong>
            </p>
          )}
          <Formulario acao={aplicarReajuste} className="mt-3 space-y-3">
            <input type="hidden" name="contrato_id" value={id} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Campo rotulo="Data do reajuste">
                <Entrada type="date" name="data_reajuste" defaultValue={dataReajuste} />
              </Campo>
              <Campo rotulo="Percentual negociado (opcional)" dica="Acordo diferente do índice">
                <Entrada name="percentual_manual" inputMode="decimal" />
              </Campo>
            </div>
            <BotaoEnviar variante="secundario" confirmar="Aplicar o reajuste ao contrato?">
              Aplicar reajuste
            </BotaoEnviar>
          </Formulario>
          {(reajustes ?? []).length > 0 && (
            <ul className="mt-4 space-y-1 border-t border-borda-suave pt-3 text-xs text-texto-2">
              {(reajustes ?? []).map((r) => (
                <li key={r.id}>
                  {formatarDataBR(r.data_reajuste)} · {r.indice === "ADITIVO" ? "aditivo" : r.indice} {Number(r.percentual).toFixed(2)}% · {formatarReais(r.valor_anterior)} → {formatarReais(r.valor_novo)}
                </li>
              ))}
            </ul>
          )}
        </Cartao>

        <Cartao titulo="Renovação">
          <p className="mb-3 text-sm text-texto-2">
            Vigência atual até <strong>{formatarDataBR(c.data_fim)}</strong>. A renovação vira um aditivo (fica registrada e pode ser impressa).
          </p>
          <JanelaCadastro rotuloBotao={<><RefreshCw className="size-4" /> Renovar contrato</>} titulo="Renovar contrato" acao={renovarContrato} rotuloSalvar="Renovar" icone={<RefreshCw />}>
            <input type="hidden" name="contrato_id" value={id} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Campo rotulo="Por mais quantos meses">
                <Entrada type="number" name="meses" min={1} max={120} defaultValue={12} required />
              </Campo>
              <Campo rotulo="Novo aluguel (opcional)">
                <Entrada name="valor_novo" inputMode="decimal" placeholder={String(c.valor_aluguel)} />
              </Campo>
            </div>
            <p className="text-xs text-mudo">Com 12 meses, o contrato passa a ir até {formatarDataBR(fimRenovado)}.</p>
          </JanelaCadastro>
        </Cartao>
      </div>

      <Cartao
        titulo={`Aditivos (${aditivos.length})`}
        acoes={
          <JanelaCadastro rotuloBotao={<><FilePlus2 className="size-3.5" /> Novo aditivo</>} tamanho="sm" titulo="Novo aditivo" acao={criarAditivo} rotuloSalvar="Registrar" larguraMax="max-w-2xl">
            <input type="hidden" name="contrato_id" value={id} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Campo rotulo="Tipo">
                <Selecao name="tipo" defaultValue="valor">
                  {Object.entries(ROTULO_ADITIVO).map(([k, r]) => (
                    <option key={k} value={k}>
                      {r}
                    </option>
                  ))}
                </Selecao>
              </Campo>
              <Campo rotulo="Data">
                <Entrada type="date" name="data" defaultValue={hojeISO()} />
              </Campo>
              <Campo rotulo="Novo aluguel (se mudar)">
                <Entrada name="valor_novo" inputMode="decimal" />
              </Campo>
              <Campo rotulo="Nova data de fim (se mudar)">
                <Entrada type="date" name="data_fim_nova" />
              </Campo>
            </div>
            <Campo rotulo="O que muda (texto do aditivo)">
              <AreaTexto name="descricao" rows={4} required placeholder="Ex.: As partes acordam a redução do aluguel para R$ 1.800,00 a partir de 01/12/2026, em razão de…" />
            </Campo>
            <label className="flex items-center gap-2 text-sm text-texto-2">
              <input type="checkbox" name="aplicar" defaultChecked /> Já aplicar o novo valor/prazo no contrato
            </label>
          </JanelaCadastro>
        }
      >
        <ul className="space-y-3">
          {aditivos.map((a) => (
            <li key={a.id} className="rounded-[14px] border border-borda p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-texto">
                      {a.numero}º aditivo · {ROTULO_ADITIVO[a.tipo]}
                    </span>
                    {a.aplicado_em ? <Selo cor="verde">aplicado</Selo> : a.valor_novo !== null || a.data_fim_nova ? <Selo cor="amarelo">não aplicado</Selo> : null}
                  </div>
                  <div className="mt-0.5 text-xs text-mudo">
                    {formatarDataBR(a.data)}
                    {a.valor_novo !== null && ` · aluguel ${a.valor_anterior !== null ? `${formatarReais(a.valor_anterior)} → ` : ""}${formatarReais(a.valor_novo)}`}
                    {a.data_fim_nova && ` · fim ${a.data_fim_anterior ? `${formatarDataBR(a.data_fim_anterior)} → ` : ""}${formatarDataBR(a.data_fim_nova)}`}
                  </div>
                  <p className="mt-1 whitespace-pre-line text-sm text-texto-2">{a.descricao}</p>
                </div>
                <div className="flex items-center gap-2">
                  {!a.aplicado_em && (a.valor_novo !== null || a.data_fim_nova) && (
                    <BotaoAcao acao={aplicarAditivo} id={a.id} tamanho="sm" confirmar="Aplicar este aditivo no contrato (novo valor e/ou prazo)?">
                      Aplicar
                    </BotaoAcao>
                  )}
                  <Link href={`/contratos/${id}/aditivos/${a.id}`} className="inline-flex items-center gap-1 text-xs text-acento hover:underline">
                    <Printer className="size-3.5" /> imprimir
                  </Link>
                  <BotaoExcluir
                    acao={excluirAditivo}
                    id={a.id}
                    rotulo="Excluir aditivo"
                    confirmar={a.aplicado_em ? "Excluir o registro deste aditivo? O contrato NÃO volta ao valor/prazo anterior." : "Excluir este aditivo?"}
                  />
                </div>
              </div>
            </li>
          ))}
          {aditivos.length === 0 && <li className="text-sm text-mudo">Nenhum aditivo.</li>}
        </ul>
      </Cartao>
    </div>
  );
}
