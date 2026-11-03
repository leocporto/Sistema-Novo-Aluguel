import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Mail, ShieldPlus } from "lucide-react";
import { BotaoExcluir } from "@/components/botao-excluir";
import { Copiar } from "@/components/copiar";
import { Formulario } from "@/components/formulario";
import { JanelaCadastro } from "@/components/janela-cadastro";
import { AreaTexto, Campo, Cartao, Entrada, Selecao, Selo, classeBotao } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import {
  COR_STATUS_GARANTIA_PROPOSTA,
  ROTULO_STATUS_FIADOR,
  ROTULO_STATUS_GARANTIA_PROPOSTA,
  STATUS_GARANTIA_PROPOSTA,
  TIPOS_GARANTIA_PROPOSTA,
  custoMensal,
  mensagemGarantidora,
} from "@/lib/dominio/analise";
import { diasEntre, formatarDataBR, hojeISO } from "@/lib/dominio/datas";
import { formatarDocumento } from "@/lib/dominio/documentos";
import { ROTULO_TIPO_GARANTIA } from "@/lib/dominio/garantias";
import { adicionarGarantia, atualizarGarantia, excluirGarantia } from "../../actions";
import { carregarAnalise } from "../../dados";

export const metadata: Metadata = { title: "Garantias propostas" };

export default async function GarantiasAnalise({ params }: PageProps<"/analise/[id]/garantias">) {
  const { id } = await params;
  const { supabase, organizacao } = await obterContexto();
  const c = await carregarAnalise(supabase, id);
  if (!c) notFound();
  const { analise: a, garantias, fiadores } = c;
  const hoje = hojeISO();
  const v = (n: unknown) => (n === null || n === undefined ? "" : String(n));
  const status = STATUS_GARANTIA_PROPOSTA.filter((s) => s !== "contratada");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-texto-2">
          Garantias propostas para esta locação e o andamento na garantidora (seguradora, capitalizadora ou banco). Ao virar contrato, as aprovadas vão sozinhas para a
          ficha do contrato, onde ficam o vencimento e a renovação.
        </p>
        <JanelaCadastro rotuloBotao={<><ShieldPlus className="size-4" /> Propor garantia</>} titulo="Propor garantia" acao={adicionarGarantia} rotuloSalvar="Incluir" larguraMax="max-w-2xl" icone={<ShieldPlus />}>
          <input type="hidden" name="analise_id" value={id} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo rotulo="Tipo">
              <Selecao name="tipo" defaultValue="seguro_fianca">
                {TIPOS_GARANTIA_PROPOSTA.map((t) => (
                  <option key={t} value={t}>
                    {ROTULO_TIPO_GARANTIA[t]}
                  </option>
                ))}
              </Selecao>
            </Campo>
            <Campo rotulo="Fiador (se for fiança)">
              <Selecao name="fiador_id" defaultValue="">
                <option value="">—</option>
                {fiadores.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.pessoa?.nome}
                  </option>
                ))}
              </Selecao>
            </Campo>
            <Campo rotulo="Garantidora (seguradora, banco…)">
              <Entrada name="garantidora" />
            </Campo>
            <Campo rotulo="Nº da proposta">
              <Entrada name="proposta_numero" />
            </Campo>
            <Campo rotulo="Valor / cobertura (R$)" dica="Seguro: cobertura. Caução e título: valor depositado.">
              <Entrada name="valor" inputMode="decimal" />
            </Campo>
            <Campo rotulo="Custo / prêmio (R$)">
              <Entrada name="premio" inputMode="decimal" />
            </Campo>
            <Campo rotulo="Parcelas do prêmio">
              <Entrada name="parcelas" type="number" min={1} max={120} />
            </Campo>
            <Campo rotulo="Situação">
              <Selecao name="status" defaultValue="proposta">
                {status.map((s) => (
                  <option key={s} value={s}>
                    {ROTULO_STATUS_GARANTIA_PROPOSTA[s]}
                  </option>
                ))}
              </Selecao>
            </Campo>
            <Campo rotulo="Vigência — início">
              <Entrada type="date" name="vigencia_inicio" />
            </Campo>
            <Campo rotulo="Vigência — fim">
              <Entrada type="date" name="vigencia_fim" />
            </Campo>
          </div>
          <Campo rotulo="Conta do depósito (caução)">
            <Entrada name="conta" placeholder="Banco, agência, conta poupança…" />
          </Campo>
          <Campo rotulo="Observações">
            <AreaTexto name="observacoes" rows={2} />
          </Campo>
        </JanelaCadastro>
      </div>

      {fiadores.length > 0 && (
        <Cartao titulo="Fiança">
          <ul className="space-y-1.5 text-sm">
            {fiadores.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center gap-2">
                <Selo cor={f.status === "aprovado" ? "verde" : f.status === "reprovado" ? "vermelho" : "cinza"}>{ROTULO_STATUS_FIADOR[f.status]}</Selo>
                <span className="text-texto">{f.pessoa?.nome}</span>
              </li>
            ))}
          </ul>
          <Link href={`/analise/${id}/fiadores`} className="mt-2 block text-xs text-acento hover:underline">
            analisar fiadores
          </Link>
        </Cartao>
      )}

      {garantias.length === 0 && (
        <Cartao>
          <p className="text-sm text-mudo">Nenhuma garantia proposta. Inclua seguro-fiança, caução, título de capitalização ou carta-fiança.</p>
        </Cartao>
      )}

      {garantias.map((g) => {
        const msg = mensagemGarantidora({
          garantidora: g.garantidora,
          tipo: g.tipo,
          candidato: a.candidato?.nome ?? "",
          documento: a.candidato?.documento ? formatarDocumento(a.candidato.documento) : null,
          imovel: a.imovel?.codigo,
          aluguel: custoMensal(a.valor_aluguel, a.valor_encargos),
          proposta: g.proposta_numero,
          solicitadaEm: g.solicitada_em,
          organizacao: organizacao.nome,
        });
        const esperando = (g.status === "solicitada" || g.status === "em_analise") && g.solicitada_em ? diasEntre(g.solicitada_em, hoje) : null;
        const travada = g.status === "contratada";
        return (
          <Cartao
            key={g.id}
            titulo={
              <span className="flex flex-wrap items-center gap-2">
                {ROTULO_TIPO_GARANTIA[g.tipo] ?? g.tipo}
                {g.garantidora && <span className="font-normal text-texto-2">· {g.garantidora}</span>}
                <Selo cor={COR_STATUS_GARANTIA_PROPOSTA[g.status]}>{ROTULO_STATUS_GARANTIA_PROPOSTA[g.status]}</Selo>
                {esperando !== null && <span className="text-xs font-normal text-alerta">esperando há {esperando} dia(s)</span>}
              </span>
            }
            acoes={<BotaoExcluir acao={excluirGarantia} id={g.id} rotulo="Excluir garantia" confirmar="Excluir esta garantia proposta?" />}
          >
            {travada && (
              <p className="mb-4 text-sm text-texto-2">
                Levada ao contrato{a.contrato ? (
                  <>
                    {" "}
                    <Link href={`/contratos/${a.contrato.id}/partes`} className="text-acento hover:underline">
                      #{a.contrato.numero}
                    </Link>
                  </>
                ) : null}
                . Vencimento e renovação passam a ser controlados por lá e em Vencimentos e renovações.
              </p>
            )}
            <Formulario acao={atualizarGarantia} automatico>
              <input type="hidden" name="id" value={g.id} />
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Campo rotulo="Situação">
                  <Selecao name="status" defaultValue={g.status} disabled={travada}>
                    {(travada ? STATUS_GARANTIA_PROPOSTA : status).map((s) => (
                      <option key={s} value={s}>
                        {ROTULO_STATUS_GARANTIA_PROPOSTA[s]}
                      </option>
                    ))}
                  </Selecao>
                </Campo>
                <Campo rotulo="Garantidora">
                  <Entrada name="garantidora" defaultValue={g.garantidora ?? ""} />
                </Campo>
                <Campo rotulo="Nº da proposta">
                  <Entrada name="proposta_numero" defaultValue={g.proposta_numero ?? ""} />
                </Campo>
                <Campo rotulo="Nº da apólice / título">
                  <Entrada name="apolice_numero" defaultValue={g.apolice_numero ?? ""} />
                </Campo>
                <Campo rotulo="Valor / cobertura (R$)">
                  <Entrada name="valor" inputMode="decimal" defaultValue={v(g.valor)} />
                </Campo>
                <Campo rotulo="Custo / prêmio (R$)">
                  <Entrada name="premio" inputMode="decimal" defaultValue={v(g.premio)} />
                </Campo>
                <Campo rotulo="Parcelas">
                  <Entrada name="parcelas" type="number" min={1} max={120} defaultValue={v(g.parcelas)} />
                </Campo>
                <Campo rotulo="Fiador">
                  <Selecao name="fiador_id" defaultValue={g.fiador_id ?? ""}>
                    <option value="">—</option>
                    {fiadores.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.pessoa?.nome}
                      </option>
                    ))}
                  </Selecao>
                </Campo>
                <Campo rotulo="Vigência — início">
                  <Entrada type="date" name="vigencia_inicio" defaultValue={g.vigencia_inicio ?? ""} />
                </Campo>
                <Campo rotulo="Vigência — fim">
                  <Entrada type="date" name="vigencia_fim" defaultValue={g.vigencia_fim ?? ""} />
                </Campo>
                <Campo rotulo="Solicitada em">
                  <Entrada type="date" name="solicitada_em" defaultValue={g.solicitada_em ?? ""} />
                </Campo>
                <Campo rotulo="Resposta em">
                  <Entrada type="date" name="respondida_em" defaultValue={g.respondida_em ?? ""} />
                </Campo>
                <Campo rotulo="Conta do depósito (caução)" className="sm:col-span-2">
                  <Entrada name="conta" defaultValue={g.conta ?? ""} />
                </Campo>
                <Campo rotulo="Resposta / condições da garantidora" className="sm:col-span-2">
                  <Entrada name="resposta" defaultValue={g.resposta ?? ""} />
                </Campo>
                <Campo rotulo="Observações" className="sm:col-span-2 lg:col-span-4">
                  <AreaTexto name="observacoes" rows={2} defaultValue={g.observacoes ?? ""} />
                </Campo>
              </div>
            </Formulario>
            {!travada && g.tipo !== "fiador" && g.tipo !== "caucao" && (
              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-borda-suave pt-3">
                <span className="text-xs text-mudo">Cobrar resposta da garantidora:</span>
                <Copiar texto={msg} rotulo="Copiar mensagem" />
                <a
                  href={`mailto:?subject=${encodeURIComponent(`Proposta ${g.proposta_numero ?? ""} — ${a.candidato?.nome ?? ""}`)}&body=${encodeURIComponent(msg)}`}
                  className={classeBotao("secundario", "sm")}
                >
                  <Mail className="size-3.5" /> E-mail
                </a>
                {g.respondida_em && <span className="text-xs text-mudo">respondeu em {formatarDataBR(g.respondida_em)}</span>}
              </div>
            )}
          </Cartao>
        );
      })}
      <p className="text-xs text-mudo">
        Envio automático de propostas para seguradoras (API) fica pronto para ligar quando houver contrato com a garantidora. Por enquanto, envie pelo portal dela e
        acompanhe aqui.
      </p>
    </div>
  );
}
