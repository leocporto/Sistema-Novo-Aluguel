import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MessageSquarePlus } from "lucide-react";
import { BarraProgresso } from "@/components/barra-progresso";
import { BotaoExcluir } from "@/components/botao-excluir";
import { Formulario } from "@/components/formulario";
import { JanelaCadastro } from "@/components/janela-cadastro";
import { AreaTexto, Campo, Cartao, Entrada, Selecao } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { formatarDataBR, hojeISO } from "@/lib/dominio/datas";
import { formatarReais } from "@/lib/dominio/dinheiro";
import {
  ETAPAS_VENDA,
  MOTIVOS_CANCELAMENTO_VENDA,
  ROTULO_ETAPA_VENDA,
  ROTULO_FORMA_PAGAMENTO,
  TODAS_ETAPAS_VENDA,
  comissaoTotal,
  progressoChecklistVenda,
  resumoPagamentos,
} from "@/lib/dominio/vendas";
import { atualizarVenda, excluirEventoVenda, mudarEtapaVenda, registrarNotaVenda } from "../actions";
import { SELECT_VENDA, carregarOpcoesVenda, enderecoImovel, nomeComprador, type Venda } from "../dados";

export const metadata: Metadata = { title: "Venda" };

const quando = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });

export default async function VendaResumo({ params }: PageProps<"/vendas/[id]">) {
  const { id } = await params;
  const { supabase } = await obterContexto();
  const hoje = hojeISO();
  const [{ data }, opcoes, { data: eventos }, { data: pags }] = await Promise.all([
    supabase.from("vendas").select(SELECT_VENDA).eq("id", id).maybeSingle(),
    carregarOpcoesVenda(supabase),
    supabase.from("venda_eventos").select("id, tipo, descricao, data").eq("venda_id", id).order("data", { ascending: false }),
    supabase.from("venda_pagamentos").select("valor, vencimento, pago_em").eq("venda_id", id),
  ]);
  if (!data) notFound();
  const v = data as unknown as Venda;
  const ordem = (ETAPAS_VENDA as readonly string[]).indexOf(v.status === "proposta" || v.status === "reservado" ? "negociacao" : v.status);
  const docs = progressoChecklistVenda(v.checklist_docs);
  const pg = resumoPagamentos((pags ?? []).map((p) => ({ ...p, valor: Number(p.valor) })), Number(v.valor), hoje);
  const comissao = comissaoTotal(Number(v.valor), Number(v.comissao_pct), v.comissao_valor == null ? null : Number(v.comissao_valor));
  const vendedores = (v.imovel?.imovel_proprietarios ?? []).filter((p) => p.pessoa);
  const encerrada = v.status === "concluida" || v.status === "cancelada";
  const val = (n: unknown) => (n === null || n === undefined ? "" : String(n));

  return (
    <>
      <ol className="entrar-cascata mb-6 grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
        {ETAPAS_VENDA.map((e, i) => {
          const atual = i === ordem;
          const feito = v.status === "concluida" || (ordem >= 0 && i < ordem);
          return (
            <li
              key={e}
              className={`rounded-[12px] border px-3 py-2 text-[12.5px] font-medium ${atual ? "border-acento bg-acento-bg text-acento-hot" : feito ? "border-ok-bd bg-ok-bg text-ok" : "border-borda bg-card text-mudo"}`}
            >
              <span className="mr-1 font-mono text-[11px] opacity-70">{i + 1}</span>
              {ROTULO_ETAPA_VENDA[e]}
            </li>
          );
        })}
      </ol>
      {v.status === "cancelada" && (
        <div className="mb-6 rounded-[14px] border border-ruim-bd bg-ruim-bg px-4 py-3 text-sm text-ruim">Venda cancelada: {v.motivo_cancelamento ?? "—"}</div>
      )}

      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <div className="entrar-cascata grid gap-4 sm:grid-cols-3">
            <Cartao titulo="Pagamentos">
              <div className="text-[22px] font-semibold tabular-nums text-texto">{formatarReais(pg.pago)}</div>
              <div className="mb-2 text-xs text-mudo">pagos de {formatarReais(v.valor)}</div>
              <BarraProgresso pct={pg.pctPago} atingida={pg.pctPago >= 100} />
              {pg.atrasado > 0 && <p className="mt-2 text-xs font-semibold text-ruim">{formatarReais(pg.atrasado)} em atraso</p>}
              <Link href={`/vendas/${id}/pagamentos`} className="mt-2 block text-xs text-acento hover:underline">
                ver cronograma
              </Link>
            </Cartao>
            <Cartao titulo="Documentos">
              <div className="text-[22px] font-semibold tabular-nums text-texto">
                {docs.feitos}/{docs.total}
              </div>
              <div className="mb-2 text-xs text-mudo">itens do checklist</div>
              <BarraProgresso pct={docs.pct} atingida={docs.feitos === docs.total} />
              <Link href={`/vendas/${id}/documentos`} className="mt-2 block text-xs text-acento hover:underline">
                ver documentação
              </Link>
            </Cartao>
            <Cartao titulo="Comissão">
              <div className="text-[22px] font-semibold tabular-nums text-texto">{formatarReais(comissao)}</div>
              <div className="text-xs text-mudo">{v.comissao_valor == null ? `${String(v.comissao_pct).replace(".", ",")}% da venda` : "valor combinado"}</div>
              <Link href={`/vendas/${id}/comissoes`} className="mt-2 block text-xs text-acento hover:underline">
                ver divisão
              </Link>
            </Cartao>
          </div>

          <Cartao
            titulo={`Histórico da negociação (${eventos?.length ?? 0})`}
            acoes={
              <JanelaCadastro rotuloBotao={<><MessageSquarePlus className="size-3.5" /> Registrar</>} tamanho="sm" titulo="Registrar no histórico" acao={registrarNotaVenda} rotuloSalvar="Salvar" icone={<MessageSquarePlus />}>
                <input type="hidden" name="venda_id" value={id} />
                <Campo rotulo="Tipo">
                  <Selecao name="tipo" defaultValue="nota">
                    <option value="nota">Anotação</option>
                    <option value="ligacao">Ligação</option>
                    <option value="reuniao">Reunião</option>
                    <option value="negociacao">Negociação</option>
                    <option value="documento">Documento</option>
                    <option value="pos_venda">Pós-venda</option>
                  </Selecao>
                </Campo>
                <Campo rotulo="O que aconteceu">
                  <AreaTexto name="descricao" rows={4} required />
                </Campo>
              </JanelaCadastro>
            }
          >
            <ol className="max-h-[480px] space-y-3 overflow-y-auto pr-1">
              {(eventos ?? []).map((e) => (
                <li key={e.id} className="flex items-start justify-between gap-3 border-b border-borda-suave pb-2.5 last:border-0">
                  <div className="min-w-0">
                    <div className="text-sm text-texto">{e.descricao}</div>
                    <div className="text-xs capitalize text-mudo">{String(e.tipo).replace(/_/g, " ")}</div>
                  </div>
                  <span className="flex shrink-0 items-center gap-2 text-xs text-mudo">
                    {quando(e.data)}
                    <BotaoExcluir acao={excluirEventoVenda} id={e.id} rotulo="Excluir registro" confirmar="Excluir este registro?" />
                  </span>
                </li>
              ))}
              {!eventos?.length && <li className="text-sm text-mudo">Nada registrado ainda.</li>}
            </ol>
          </Cartao>

          <Formulario acao={atualizarVenda} automatico>
            <input type="hidden" name="id" value={id} />
            <Cartao titulo="Dados da venda">
              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-3">
                  <Campo rotulo="Valor da venda (R$)">
                    <Entrada name="valor" inputMode="decimal" defaultValue={val(v.valor)} disabled={v.status === "concluida"} />
                  </Campo>
                  <Campo rotulo="Pagamento">
                    <Selecao name="forma_pagamento" defaultValue={v.forma_pagamento}>
                      {Object.entries(ROTULO_FORMA_PAGAMENTO).map(([k, r]) => (
                        <option key={k} value={k}>
                          {r}
                        </option>
                      ))}
                    </Selecao>
                  </Campo>
                  <Campo rotulo="Reservado até">
                    <Entrada type="date" name="reserva_ate" defaultValue={v.reserva_ate ?? ""} />
                  </Campo>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Campo rotulo="Comprador (cadastrado em Pessoas)">
                    <Selecao name="comprador_id" defaultValue={v.comprador_id ?? ""}>
                      <option value="">— não cadastrado —</option>
                      {opcoes.pessoas.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.nome}
                        </option>
                      ))}
                    </Selecao>
                  </Campo>
                  <Campo rotulo="Corretor da venda">
                    <Selecao name="corretor_id" defaultValue={v.corretor_id ?? ""}>
                      <option value="">— nenhum —</option>
                      {opcoes.corretores.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.nome}
                        </option>
                      ))}
                    </Selecao>
                  </Campo>
                </div>
                {!v.comprador_id && (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Campo rotulo="Nome do comprador" dica="Cadastre em Pessoas para o contrato sair com CPF e endereço.">
                      <Entrada name="comprador_nome" defaultValue={v.comprador_nome ?? ""} />
                    </Campo>
                    <Campo rotulo="Telefone">
                      <Entrada name="comprador_telefone" defaultValue={v.comprador_telefone ?? ""} />
                    </Campo>
                  </div>
                )}
                <Campo rotulo="Observações">
                  <AreaTexto name="observacoes" rows={3} defaultValue={v.observacoes ?? ""} />
                </Campo>
              </div>
            </Cartao>
          </Formulario>
        </div>

        <div className="space-y-6">
          <Cartao titulo="Etapa">
            {encerrada ? (
              <p className="text-sm text-texto-2">
                {v.status === "concluida" ? `Concluída em ${formatarDataBR(v.concluida_em)}.` : "Cancelada."}
              </p>
            ) : (
              <Formulario acao={mudarEtapaVenda} automatico className="space-y-4">
                <input type="hidden" name="id" value={id} />
                <Campo rotulo="Etapa atual">
                  <Selecao name="status" defaultValue={v.status}>
                    {TODAS_ETAPAS_VENDA.filter((e) => e !== "concluida").map((e) => (
                      <option key={e} value={e}>
                        {ROTULO_ETAPA_VENDA[e]}
                      </option>
                    ))}
                  </Selecao>
                </Campo>
                <Campo rotulo="Motivo (se cancelar)">
                  <Selecao name="motivo" defaultValue={MOTIVOS_CANCELAMENTO_VENDA[0]}>
                    {MOTIVOS_CANCELAMENTO_VENDA.map((m) => (
                      <option key={m}>{m}</option>
                    ))}
                  </Selecao>
                </Campo>
                <p className="text-xs text-mudo">Para concluir, use o botão “Concluir venda” no topo.</p>
              </Formulario>
            )}
          </Cartao>

          <Cartao titulo="Partes">
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-xs text-mudo">Comprador</dt>
                <dd className="font-medium text-texto">
                  {v.comprador ? (
                    <Link href={`/pessoas/${v.comprador.id}`} className="hover:underline">
                      {v.comprador.nome}
                    </Link>
                  ) : (
                    nomeComprador(v)
                  )}
                  {v.lead && (
                    <Link href={`/comercial/leads/${v.lead.id}`} className="ml-2 text-xs text-acento hover:underline">
                      lead
                    </Link>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-mudo">Vendedor(es) — proprietários</dt>
                <dd>
                  {vendedores.map((p) => (
                    <Link key={p.pessoa!.id} href={`/pessoas/${p.pessoa!.id}`} className="block font-medium text-texto hover:underline">
                      {p.pessoa!.nome} <span className="font-normal text-mudo">({Number(p.percentual)}%)</span>
                    </Link>
                  ))}
                  {vendedores.length === 0 && <span className="text-alerta">Imóvel sem proprietário cadastrado.</span>}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-mudo">Imóvel</dt>
                <dd className="text-texto">
                  {v.imovel ? (
                    <Link href={`/imoveis/${v.imovel.id}`} className="font-medium text-acento hover:underline">
                      {v.imovel.codigo}
                    </Link>
                  ) : (
                    "—"
                  )}
                  <span className="block text-xs text-mudo">{enderecoImovel(v.imovel)}</span>
                </dd>
              </div>
            </dl>
          </Cartao>
        </div>
      </div>
    </>
  );
}
