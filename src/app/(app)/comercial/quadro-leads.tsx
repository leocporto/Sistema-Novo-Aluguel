"use client";

import { useState, useTransition, type DragEvent } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { AlarmClock, Building2, MessageCircle, Phone } from "lucide-react";
import { BotaoExcluir } from "@/components/botao-excluir";
import { classeBotao } from "@/components/ui";
import { MOTIVOS_PERDA, ROTULO_PRIORIDADE, TODAS_ETAPAS, rotuloEtapa } from "@/lib/dominio/crm";
import { formatarReais } from "@/lib/dominio/dinheiro";
import { ROTULO_ORIGEM_LEAD } from "@/lib/tipos";
import { linkWhatsapp } from "@/lib/whatsapp";
import { excluirLead, moverLead } from "./actions";

export type CartaoLead = {
  id: string;
  nome: string;
  telefone: string | null;
  status: string;
  origem: string;
  prioridade: string;
  etiquetas: string[];
  orcamento_max: number | null;
  corretor: string | null;
  imoveis: number;
  proximo_contato: string | null;
  /** Horas desde a chegada, para os "Novos" ainda sem atendimento. */
  horasEsperando: number | null;
  chegou: string;
};

const COR_ETAPA: Record<string, string> = {
  novo: "bg-acento",
  em_atendimento: "bg-alerta",
  visita: "bg-violeta",
  proposta: "bg-acento-hot",
  ganho: "bg-ok",
  perdido: "bg-fraco",
};
const COR_PRIORIDADE: Record<string, string> = {
  quente: "border-ruim-bd bg-ruim-bg text-ruim",
  morno: "border-alerta-bd bg-alerta-bg text-alerta",
  frio: "border-acento-bd bg-acento-bg text-acento-hot",
};

/** Funil em colunas: arraste o cartão para mudar de etapa (perdido pede o motivo). */
export function QuadroLeads({ funil, leads, hoje }: { funil: string; leads: CartaoLead[]; hoje: string }) {
  const router = useRouter();
  const [lista, setLista] = useState(leads);
  const [arrastando, setArrastando] = useState<string | null>(null);
  const [sobre, setSobre] = useState<string | null>(null);
  const [perda, setPerda] = useState<{ id: string; nome: string } | null>(null);
  const [motivo, setMotivo] = useState(MOTIVOS_PERDA[0]);
  const [, iniciar] = useTransition();
  const [prevLeads, setPrevLeads] = useState(leads);
  if (leads !== prevLeads) {
    setPrevLeads(leads);
    setLista(leads);
  }

  const mover = (id: string, status: string, motivoPerda?: string) => {
    const antes = lista;
    setLista((l) => l.map((x) => (x.id === id ? { ...x, status } : x)));
    iniciar(async () => {
      const r = await moverLead(id, status, motivoPerda ?? null);
      if (!r.ok) {
        setLista(antes);
        window.alert(r.erro ?? "Não foi possível mudar a etapa.");
      }
    });
  };

  const pedir = (id: string, status: string) => {
    const lead = lista.find((l) => l.id === id);
    if (!lead || lead.status === status) return;
    if (status === "perdido") {
      setMotivo(MOTIVOS_PERDA[0]);
      setPerda({ id, nome: lead.nome });
    } else mover(id, status);
  };

  const soltar = (e: DragEvent, etapa: string) => {
    e.preventDefault();
    setSobre(null);
    if (arrastando) pedir(arrastando, etapa);
    setArrastando(null);
  };

  return (
    <>
      <div className="entrar-cascata grid auto-cols-[minmax(260px,1fr)] grid-flow-col gap-3 overflow-x-auto pb-3">
        {TODAS_ETAPAS.map((etapa) => {
          const daEtapa = lista.filter((l) => l.status === etapa);
          return (
            <section
              key={etapa}
              onDragOver={(e) => {
                e.preventDefault();
                setSobre(etapa);
              }}
              onDragLeave={() => setSobre((s) => (s === etapa ? null : s))}
              onDrop={(e) => soltar(e, etapa)}
              className={`flex min-h-48 flex-col rounded-card border p-2.5 transition ${sobre === etapa ? "border-acento bg-acento-bg" : "border-borda bg-app"}`}
            >
              <header className="mb-2 flex items-center gap-2 px-1.5 pt-1">
                <span className={`size-2.5 rounded-full ${COR_ETAPA[etapa]}`} />
                <h3 className="text-[14px] font-semibold text-texto">{rotuloEtapa(funil, etapa)}</h3>
                <span className="ml-auto rounded-full bg-card px-2 py-0.5 text-xs font-semibold text-texto-2">{daEtapa.length}</span>
              </header>
              <div className="flex flex-col gap-2">
                {daEtapa.map((l) => {
                  const followVencido = l.proximo_contato && l.proximo_contato <= hoje && l.status !== "ganho" && l.status !== "perdido";
                  const esperando = l.status === "novo" && l.horasEsperando !== null && l.horasEsperando >= 1;
                  return (
                    <article
                      key={l.id}
                      draggable
                      onDragStart={(e) => {
                        setArrastando(l.id);
                        e.dataTransfer.effectAllowed = "move";
                      }}
                      onDragEnd={() => setArrastando(null)}
                      onClick={(e) => {
                        if ((e.target as HTMLElement).closest("a, button, select")) return;
                        router.push(`/comercial/leads/${l.id}`);
                      }}
                      className={`cursor-grab rounded-[14px] border bg-card p-3 transition hover:border-borda-forte active:cursor-grabbing ${arrastando === l.id ? "opacity-50" : ""} ${esperando ? "border-ruim-bd" : "border-borda"}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-semibold text-texto">{l.nome}</span>
                        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10.5px] font-semibold ${COR_PRIORIDADE[l.prioridade] ?? COR_PRIORIDADE.morno}`}>
                          {ROTULO_PRIORIDADE[l.prioridade] ?? l.prioridade}
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-texto-2">
                        {ROTULO_ORIGEM_LEAD[l.origem] ?? l.origem} · {l.chegou}
                        {l.corretor ? ` · ${l.corretor}` : " · sem corretor"}
                      </div>
                      {(l.orcamento_max || l.imoveis > 0) && (
                        <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-mudo">
                          {l.orcamento_max ? <span>até {formatarReais(l.orcamento_max)}</span> : null}
                          {l.imoveis > 0 && (
                            <span className="inline-flex items-center gap-1">
                              <Building2 className="size-3" /> {l.imoveis} imóvel(is)
                            </span>
                          )}
                        </div>
                      )}
                      {l.etiquetas.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {l.etiquetas.map((t) => (
                            <span key={t} className="rounded-full bg-elev px-2 py-0.5 text-[10.5px] font-medium text-texto-2">
                              #{t}
                            </span>
                          ))}
                        </div>
                      )}
                      {esperando && <div className="mt-1.5 text-[11.5px] font-semibold text-ruim">Esperando atendimento há {Math.round(l.horasEsperando!)} h</div>}
                      {followVencido && (
                        <div className="mt-1.5 inline-flex items-center gap-1 text-[11.5px] font-semibold text-alerta">
                          <AlarmClock className="size-3.5" /> retornar {l.proximo_contato === hoje ? "hoje" : "(atrasado)"}
                        </div>
                      )}
                      <div className="mt-2.5 flex items-center gap-1.5">
                        <select
                          value={l.status}
                          onChange={(e) => pedir(l.id, e.target.value)}
                          aria-label={`Etapa de ${l.nome}`}
                          className="h-8 min-w-0 flex-1 rounded-[9px] border border-borda bg-input px-2 text-xs font-medium text-texto"
                        >
                          {TODAS_ETAPAS.map((e) => (
                            <option key={e} value={e}>
                              {rotuloEtapa(funil, e)}
                            </option>
                          ))}
                        </select>
                        <BotaoExcluir acao={excluirLead} id={l.id} rotulo={`Excluir ${l.nome}`} confirmar={`Excluir o lead "${l.nome}"?`} />
                        {l.telefone && (
                          <>
                            <a
                              href={linkWhatsapp(l.telefone, `Olá ${l.nome.split(" ")[0]}! Tudo bem?`)}
                              target="_blank"
                              rel="noreferrer"
                              title="WhatsApp"
                              className="grid size-8 place-items-center rounded-[9px] border border-ok-bd bg-ok-bg text-ok"
                            >
                              <MessageCircle className="size-4" />
                            </a>
                            <a href={`tel:${l.telefone}`} title="Ligar" className="grid size-8 place-items-center rounded-[9px] border border-borda text-texto-2">
                              <Phone className="size-4" />
                            </a>
                          </>
                        )}
                      </div>
                    </article>
                  );
                })}
                {daEtapa.length === 0 && <p className="px-1.5 py-3 text-xs text-fraco">Arraste um cartão para cá.</p>}
              </div>
            </section>
          );
        })}
      </div>

      {perda &&
        createPortal(
          <div
            className="janela-fundo fixed inset-0 z-[100] flex items-center justify-center bg-[rgba(10,14,20,.45)] p-4 backdrop-blur-[6px]"
            onMouseDown={(e) => e.target === e.currentTarget && setPerda(null)}
          >
            <div role="dialog" aria-modal="true" className="janela w-full max-w-md rounded-card border border-borda bg-card p-6 shadow-[0_24px_60px_-20px_rgba(0,0,0,.45)]">
              <h3 className="mb-1 text-[17px] font-semibold text-texto">Por que perdeu {perda.nome}?</h3>
              <p className="mb-4 text-sm text-texto-2">O motivo entra no relatório de conversão.</p>
              <div className="space-y-2">
                {MOTIVOS_PERDA.map((m) => (
                  <label key={m} className="flex cursor-pointer items-center gap-2 rounded-[10px] border border-borda px-3 py-2 text-sm has-[:checked]:border-acento has-[:checked]:bg-acento-bg">
                    <input type="radio" name="motivo" checked={motivo === m} onChange={() => setMotivo(m)} /> {m}
                  </label>
                ))}
              </div>
              <div className="mt-5 flex justify-end gap-2">
                <button type="button" className={classeBotao("secundario")} onClick={() => setPerda(null)}>
                  Cancelar
                </button>
                <button
                  type="button"
                  className={classeBotao("perigo")}
                  onClick={() => {
                    mover(perda.id, "perdido", motivo);
                    setPerda(null);
                  }}
                >
                  Marcar como perdido
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
