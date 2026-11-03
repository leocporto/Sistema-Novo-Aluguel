import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Ban, RotateCcw } from "lucide-react";
import { BotaoAcao } from "@/components/botao-acao";
import { BotaoExcluir } from "@/components/botao-excluir";
import { BotaoImprimir, Formulario } from "@/components/formulario";
import { Campo, Cartao, Entrada, Selo } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { formatarCompetencia, formatarDataBR } from "@/lib/dominio/datas";
import { formatarReais } from "@/lib/dominio/dinheiro";
import { atualizarNota, cancelarNota, excluirNota } from "../../actions";

export const metadata: Metadata = { title: "Nota fiscal" };

const ROTULO: Record<string, string> = { a_emitir: "A emitir", emitida: "Emitida", cancelada: "Cancelada" };

export default async function NotaPage({ params }: PageProps<"/financeiro/notas/[id]">) {
  const { id } = await params;
  const { supabase, organizacao } = await obterContexto();
  const { data: n } = await supabase.from("notas_fiscais").select("*").eq("id", id).maybeSingle();
  if (!n) notFound();
  const liquido = Number(n.valor_servicos) - Number(n.retencoes);
  const editavel = n.status !== "cancelada";

  return (
    <>
      <div className="nao-imprimir mb-[clamp(14px,1.5vw,18px)] flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[13px] text-mudo">
            <span>Novo Aluguel</span>
            <span className="text-fraco">›</span>
            <Link href="/financeiro/notas" className="text-acento-hot hover:underline">
              Notas fiscais
            </Link>
          </div>
          <h1 className="mt-1.5 text-[clamp(26px,2.8vw,36px)] font-semibold leading-[1.05] tracking-[-0.025em] text-texto">{n.tomador_nome}</h1>
          <div className="mt-2 flex items-center gap-2 text-[13.5px] text-texto-2">
            <Selo cor={n.status === "emitida" ? "verde" : n.status === "cancelada" ? "cinza" : "amarelo"}>{ROTULO[n.status]}</Selo>
            <span className="font-semibold tabular-nums text-texto">{formatarReais(n.valor_servicos)}</span>
            <span className="capitalize">{formatarCompetencia(n.competencia)}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <BotaoImprimir />
          <BotaoAcao acao={cancelarNota} id={n.id} confirmar={n.status === "cancelada" ? "Reabrir esta nota?" : "Marcar esta nota como cancelada?"}>
            {n.status === "cancelada" ? (
              <>
                <RotateCcw className="size-4" /> Reabrir
              </>
            ) : (
              <>
                <Ban className="size-4" /> Cancelar
              </>
            )}
          </BotaoAcao>
          <BotaoExcluir acao={excluirNota} id={n.id} variante="botao" rotulo="Excluir" confirmar="Excluir esta nota?" depois="/financeiro/notas" />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <Cartao titulo="Espelho da nota">
          <div className="space-y-4 text-sm">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-mudo">Prestador</div>
                <div className="mt-1 font-medium text-texto">{organizacao.nome}</div>
                <div className="text-texto-2">{[organizacao.documento && `CNPJ ${organizacao.documento}`, organizacao.creci && `CRECI ${organizacao.creci}`].filter(Boolean).join(" · ")}</div>
              </div>
              <div>
                <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-mudo">Tomador</div>
                <div className="mt-1 font-medium text-texto">{n.tomador_nome}</div>
                <div className="text-texto-2">{n.tomador_documento ?? "—"}</div>
              </div>
            </div>
            <div>
              <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-mudo">Discriminação do serviço</div>
              <p className="mt-1 whitespace-pre-wrap text-texto">{n.descricao}</p>
            </div>
            <table className="w-full text-sm">
              <tbody className="divide-y divide-borda-suave">
                <tr>
                  <td className="py-1.5 text-texto-2">Valor dos serviços</td>
                  <td className="py-1.5 text-right tabular-nums">{formatarReais(n.valor_servicos)}</td>
                </tr>
                <tr>
                  <td className="py-1.5 text-texto-2">ISS ({Number(n.aliquota_iss).toLocaleString("pt-BR")}%)</td>
                  <td className="py-1.5 text-right tabular-nums">{formatarReais(n.valor_iss)}</td>
                </tr>
                <tr>
                  <td className="py-1.5 text-texto-2">Retenções</td>
                  <td className="py-1.5 text-right tabular-nums">{formatarReais(n.retencoes)}</td>
                </tr>
                <tr>
                  <td className="py-1.5 font-semibold text-texto">Valor líquido</td>
                  <td className="py-1.5 text-right font-semibold tabular-nums">{formatarReais(liquido)}</td>
                </tr>
              </tbody>
            </table>
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-mudo">Número</div>
                <div className="mt-1 text-texto">{n.numero ?? "—"}</div>
              </div>
              <div>
                <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-mudo">Emissão</div>
                <div className="mt-1 text-texto">{formatarDataBR(n.emitida_em)}</div>
              </div>
              <div>
                <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-mudo">Código de verificação</div>
                <div className="mt-1 text-texto">{n.codigo_verificacao ?? "—"}</div>
              </div>
            </div>
            {n.link && (
              <a href={n.link} target="_blank" rel="noreferrer" className="nao-imprimir text-acento hover:underline">
                Abrir a nota no site da prefeitura
              </a>
            )}
          </div>
        </Cartao>
        <div className="nao-imprimir">
          <Cartao titulo={editavel ? "Dados (salva sozinho)" : "Nota cancelada"}>
            {editavel ? (
              <Formulario acao={atualizarNota} automatico className="space-y-3">
                <input type="hidden" name="id" value={n.id} />
                <div className="grid grid-cols-2 gap-3">
                  <Campo rotulo="Número da NFS-e">
                    <Entrada name="numero" defaultValue={n.numero ?? ""} />
                  </Campo>
                  <Campo rotulo="Emitida em">
                    <Entrada type="date" name="emitida_em" defaultValue={n.emitida_em ?? ""} />
                  </Campo>
                </div>
                <Campo rotulo="Código de verificação">
                  <Entrada name="codigo_verificacao" defaultValue={n.codigo_verificacao ?? ""} />
                </Campo>
                <Campo rotulo="Link da nota">
                  <Entrada name="link" defaultValue={n.link ?? ""} placeholder="https://…" />
                </Campo>
                <Campo rotulo="Tomador">
                  <Entrada name="tomador_nome" defaultValue={n.tomador_nome} />
                </Campo>
                <Campo rotulo="CPF/CNPJ do tomador">
                  <Entrada name="tomador_documento" defaultValue={n.tomador_documento ?? ""} />
                </Campo>
                <Campo rotulo="Descrição do serviço">
                  <Entrada name="descricao" defaultValue={n.descricao} />
                </Campo>
                <div className="grid grid-cols-3 gap-3">
                  <Campo rotulo="Valor">
                    <Entrada name="valor_servicos" inputMode="decimal" defaultValue={String(n.valor_servicos).replace(".", ",")} />
                  </Campo>
                  <Campo rotulo="ISS %">
                    <Entrada name="aliquota_iss" inputMode="decimal" defaultValue={String(n.aliquota_iss).replace(".", ",")} />
                  </Campo>
                  <Campo rotulo="Retenções">
                    <Entrada name="retencoes" inputMode="decimal" defaultValue={String(n.retencoes).replace(".", ",")} />
                  </Campo>
                </div>
                <p className="text-xs text-mudo">Ao preencher o número, a nota passa para &quot;Emitida&quot;.</p>
              </Formulario>
            ) : (
              <p className="text-sm text-mudo">Reabra a nota para editar.</p>
            )}
          </Cartao>
        </div>
      </div>
    </>
  );
}
