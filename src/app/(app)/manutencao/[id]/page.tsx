import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Check, Circle } from "lucide-react";
import { Formulario } from "@/components/formulario";
import { AreaTexto, Aviso, Campo, Cartao, Definicao, Entrada, Selecao } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { diaLocal } from "@/lib/dominio/agenda";
import { agoraMs, formatarDataBR } from "@/lib/dominio/datas";
import { formatarReais } from "@/lib/dominio/dinheiro";
import {
  ETAPAS_CHAMADO,
  ROTULO_STATUS_CHAMADO,
  planoFinanceiro,
  podeDecidirChamado,
  responsaveisDoModo,
  rotuloResponsavel,
  situacaoPrazo,
  sugerirResponsabilidade,
  textoGarantia,
  textoPrazo,
} from "@/lib/dominio/manutencao";
import { atualizarChamado } from "../actions";
import { OpcoesCategoria, OpcoesUrgencia, rotuloContrato } from "../campos";
import { carregarChamado, contratosAtivos, midiasDoChamado } from "../dados";
import { MidiasChamado } from "./midias";

export const metadata: Metadata = { title: "Chamado de manutenção" };

const ABERTO_POR: Record<string, string> = { locatario: "Locatário", proprietario: "Proprietário", equipe: "Equipe", outro: "Outro" };

export default async function ChamadoResumo({ params }: PageProps<"/manutencao/[id]">) {
  const { id } = await params;
  const { supabase, organizacao, papel } = await obterContexto();
  const modo = organizacao.modo;
  const pessoal = modo === "pessoal";
  const c = await carregarChamado(supabase, id);
  if (!c) notFound();
  const [midias, contratos, { data: origem }] = await Promise.all([
    midiasDoChamado(supabase, id),
    contratosAtivos(supabase),
    c.chamado_origem_id ? supabase.from("chamados").select("id, numero, titulo, garantia_ate").eq("id", c.chamado_origem_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const doImovel = contratos.filter((x) => x.imovel_id === c.imovel_id || x.id === c.contrato_id);
  const sugestao = sugerirResponsabilidade(c.categoria);
  const valorRef = c.valor_final ?? c.valor_aprovado;
  let plano: ReturnType<typeof planoFinanceiro> | null = null;
  let erroPlano: string | null = null;
  if (valorRef != null && Number(valorRef) > 0) {
    try {
      plano = planoFinanceiro({
        modo,
        valor: Number(valorRef),
        responsabilidade: c.responsabilidade || sugestao.responsavel,
        partes: { locatario: Number(c.pct_locatario), proprietario: Number(c.pct_proprietario), imobiliaria: Number(c.pct_imobiliaria) },
        pagoDireto: c.pago_direto,
        titulo: c.titulo,
      });
    } catch (e) {
      erroPlano = e instanceof Error ? e.message : String(e);
    }
  }
  const etapas = ETAPAS_CHAMADO.filter((e) => !(e === "aguardando_aprovacao" && (pessoal || c.aprovacao_status === "nao_precisa")));
  const atual = etapas.indexOf(c.status as (typeof etapas)[number]);
  const encerrado = ["recusado", "cancelado"].includes(c.status);
  const prazo = situacaoPrazo(c, new Date(agoraMs()).toISOString());
  const concluido = ["concluido", "avaliado"].includes(c.status);
  // Quem paga é decisão de admin, gestor ou financeiro (corretor só vê).
  const decide = podeDecidirChamado(papel);
  const travado = concluido || !decide;
  // Depois do orçamento escolhido, quem paga não volta para "A definir".
  const podeADefinir = !c.orcamento_id || !c.responsabilidade;

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
      <div className="space-y-6">
        <Cartao titulo="Dados do chamado">
          <Formulario acao={atualizarChamado} automatico className="space-y-4">
            <input type="hidden" name="id" value={id} />
            <Campo rotulo="O que aconteceu">
              <Entrada name="titulo" required defaultValue={c.titulo} />
            </Campo>
            <div className="grid gap-4 sm:grid-cols-2">
              <Campo rotulo="Tipo de problema">
                <Selecao name="categoria" defaultValue={c.categoria}>
                  <OpcoesCategoria />
                </Selecao>
              </Campo>
              <Campo rotulo="Urgência">
                <Selecao name="urgencia" defaultValue={c.urgencia}>
                  <OpcoesUrgencia />
                </Selecao>
              </Campo>
              <Campo rotulo="Onde (cômodo)">
                <Entrada name="local" defaultValue={c.local ?? ""} />
              </Campo>
              <Campo rotulo="Contrato">
                <Selecao name="contrato_id" defaultValue={c.contrato_id ?? ""}>
                  <option value="">— sem contrato —</option>
                  {doImovel.map((x) => (
                    <option key={x.id} value={x.id}>
                      {rotuloContrato(x)}
                    </option>
                  ))}
                  {c.contrato && !doImovel.some((x) => x.id === c.contrato_id) && <option value={c.contrato.id}>#{c.contrato.numero} (encerrado)</option>}
                </Selecao>
              </Campo>
              <Campo rotulo="Quem pediu">
                <Selecao name="aberto_por" defaultValue={c.aberto_por}>
                  <option value="locatario">Locatário</option>
                  {(!pessoal || c.aberto_por === "proprietario") && <option value="proprietario">Proprietário</option>}
                  <option value="equipe">{pessoal ? "Eu mesmo" : "Equipe"}</option>
                  <option value="outro">Outro</option>
                </Selecao>
              </Campo>
              <Campo rotulo="Nome de quem pediu">
                <Entrada name="solicitante_nome" defaultValue={c.solicitante_nome ?? c.solicitante?.nome ?? ""} />
              </Campo>
              <Campo rotulo="Telefone / WhatsApp">
                <Entrada name="solicitante_telefone" inputMode="tel" defaultValue={c.solicitante_telefone ?? ""} placeholder={c.solicitante?.telefone ?? ""} />
              </Campo>
            </div>
            <Campo rotulo="Detalhes">
              <AreaTexto name="descricao" rows={4} defaultValue={c.descricao ?? ""} />
            </Campo>
          </Formulario>
        </Cartao>

        <Cartao titulo="Quem paga o conserto">
          <div className="mb-4">
            <Aviso>
              <b>Sugestão pela categoria: {rotuloResponsavel(sugestao.responsavel, modo)}.</b> {sugestao.motivo}
            </Aviso>
          </div>
          <Formulario acao={atualizarChamado} automatico className="space-y-4">
            <input type="hidden" name="id" value={id} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Campo rotulo="Responsável pela conta">
                <Selecao name="responsabilidade" defaultValue={c.responsabilidade ?? ""} disabled={travado}>
                  {podeADefinir && <option value="">A definir (usa a sugestão)</option>}
                  {responsaveisDoModo(modo).map((r) => (
                    <option key={r} value={r}>
                      {rotuloResponsavel(r, modo)}
                    </option>
                  ))}
                </Selecao>
              </Campo>
              <Campo rotulo="Quem paga o prestador" dica="Se o responsável paga direto, nada é lançado no Financeiro.">
                <Selecao name="pagamento" defaultValue={c.pago_direto ? "direto" : "nos"} disabled={travado}>
                  <option value="nos">{pessoal ? "Eu pago o prestador" : "Nós pagamos o prestador"}</option>
                  <option value="direto">O responsável paga direto ao prestador</option>
                </Selecao>
              </Campo>
            </div>
            <fieldset className="grid gap-4 sm:grid-cols-3" disabled={travado}>
              <legend className="mb-2 text-xs text-mudo">Só para “Dividido”: quanto cada um paga (soma 100%).</legend>
              <Campo rotulo="Locatário (%)">
                <Entrada name="pct_locatario" inputMode="decimal" defaultValue={c.responsabilidade === "dividido" ? String(Number(c.pct_locatario)).replace(".", ",") : ""} />
              </Campo>
              <Campo rotulo={pessoal ? "Proprietário — eu (%)" : "Proprietário (%)"}>
                <Entrada name="pct_proprietario" inputMode="decimal" defaultValue={c.responsabilidade === "dividido" ? String(Number(c.pct_proprietario)).replace(".", ",") : ""} />
              </Campo>
              {pessoal ? (
                <input type="hidden" name="pct_imobiliaria" value="" />
              ) : (
                <Campo rotulo="Imobiliária (%)">
                  <Entrada name="pct_imobiliaria" inputMode="decimal" defaultValue={c.responsabilidade === "dividido" ? String(Number(c.pct_imobiliaria)).replace(".", ",") : ""} />
                </Campo>
              )}
            </fieldset>
          </Formulario>
          {concluido && <p className="mt-3 text-xs text-mudo">Já lançado no financeiro. Para mudar quem paga, desfaça a conclusão (aba Agenda e conclusão).</p>}
          {!concluido && !decide && <p className="mt-3 text-xs text-mudo">Quem define quem paga é um administrador, gestor ou o financeiro.</p>}
          {!pessoal && !concluido && ["aprovado", "agendado", "em_execucao", "aguardando_aprovacao"].includes(c.status) && (
            <p className="mt-3 text-xs text-mudo">Se a parte do proprietário aumentar, o serviço volta a esperar a aprovação dele; se zerar enquanto ele não respondeu, segue sem ele.</p>
          )}
          <div className="mt-5 border-t border-borda-suave pt-4">
            <div className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-mudo">O que vai para o Financeiro ao concluir</div>
            {erroPlano ? (
              <Aviso tipo="alerta">{erroPlano}</Aviso>
            ) : !plano ? (
              <p className="text-sm text-mudo">Escolha um orçamento (aba Orçamentos) para ver os lançamentos.</p>
            ) : (
              <ul className="space-y-1.5 text-sm text-texto-2">
                {plano.pagar.map((l, i) => (
                  <li key={i}>
                    Conta a pagar ao prestador: <b className="text-texto">{formatarReais(l.valor)}</b>
                    {l.descontarRepasse ? " — descontada do próximo repasse ao proprietário" : ""}
                  </li>
                ))}
                {plano.cobrarLocatario > 0 && (
                  <li>
                    Cobrar do locatário: <b className="text-texto">{formatarReais(plano.cobrarLocatario)}</b> (conta a receber ou na próxima fatura)
                  </li>
                )}
                {plano.pagar.length === 0 && plano.cobrarLocatario === 0 && <li>Nada: o responsável paga direto ao prestador.</li>}
                <li className="text-xs text-mudo">Os lançamentos nascem em aberto; o pagamento é feito no Financeiro (com aprovação, se passar do limite).</li>
              </ul>
            )}
          </div>
        </Cartao>

        <Cartao titulo={`Fotos e vídeos (${midias.length})`}>
          <MidiasChamado organizacaoId={organizacao.id} chamadoId={id} midias={midias} />
        </Cartao>
      </div>

      <div className="space-y-6">
        <Cartao titulo="Andamento">
          {encerrado ? (
            <Aviso tipo="alerta">
              <b>{ROTULO_STATUS_CHAMADO[c.status]}.</b> {c.motivo ?? ""}
            </Aviso>
          ) : (
            <ol className="space-y-2.5">
              {etapas.map((e, i) => {
                const feito = atual >= 0 && i < atual;
                const agora = i === atual;
                return (
                  <li key={e} className={`flex items-center gap-2.5 text-sm ${agora ? "font-semibold text-texto" : feito ? "text-texto-2" : "text-fraco"}`}>
                    <span className={`grid size-6 shrink-0 place-items-center rounded-full border ${agora ? "border-acento bg-acento text-white" : feito ? "border-ok-bd bg-ok-bg text-ok" : "border-borda"}`}>
                      {feito ? <Check className="size-3.5" /> : <Circle className="size-2.5" />}
                    </span>
                    {ROTULO_STATUS_CHAMADO[e]}
                  </li>
                );
              })}
            </ol>
          )}
        </Cartao>
        <Cartao titulo="Resumo">
          <dl className="grid grid-cols-1 gap-y-3 text-sm">
            {(
              [
                ["Aberto em", `${formatarDataBR(diaLocal(c.created_at))}${c.origem === "link" ? " · pelo link do locatário" : ""}`],
                ["Quem pediu", [ABERTO_POR[c.aberto_por], c.solicitante_nome ?? c.solicitante?.nome].filter(Boolean).join(" · ")],
                ["Prazo para atender", prazo.situacao === "atendido" ? "atendido" : `${formatarDataBR(c.prazo_atendimento ? diaLocal(c.prazo_atendimento) : null)} (${textoPrazo(prazo.horas)})`],
                ["Prestador", c.prestador ? <Link key="p" href={`/pessoas/${c.prestador.id}`} className="text-acento hover:underline">{c.prestador.nome}</Link> : "—"],
                [
                  !pessoal && c.aprovacao_status === "recusado" && ["aberto", "em_analise"].includes(c.status) ? "Valor orçado (recusado pelo proprietário)" : "Valor aprovado",
                  c.valor_aprovado != null ? formatarReais(c.valor_aprovado) : "—",
                ],
                ["Quem paga", rotuloResponsavel(c.responsabilidade, modo)],
                ["Garantia do serviço", concluido ? textoGarantia(c.concluido_em, c.garantia_ate) : c.garantia_dias ? `${c.garantia_dias} dias (conta da conclusão)` : "—"],
                ...(origem
                  ? ([
                      [
                        "Retorno na garantia de",
                        <Link key="o" href={`/manutencao/${origem.id}`} className="text-acento hover:underline">
                          #{origem.numero} · {origem.titulo}
                        </Link>,
                      ],
                    ] as [string, React.ReactNode][])
                  : []),
              ] as [string, React.ReactNode][]
            ).map(([k, v]) => (
              <div key={k}>
                <dt className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-mudo">{k}</dt>
                <dd className="mt-0.5 text-texto">{v || "—"}</dd>
              </div>
            ))}
          </dl>
        </Cartao>
        {c.locatario_confirmou_em && (
          <Cartao titulo="Locatário confirmou o serviço">
            <Definicao itens={[["Em", formatarDataBR(diaLocal(c.locatario_confirmou_em))], ["Comentário", c.locatario_comentario ?? "—"]]} />
          </Cartao>
        )}
      </div>
    </div>
  );
}
