"use client";

import { useState, useTransition, type DragEvent } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { BadgeCheck, MessageCircle, Phone, ShieldCheck } from "lucide-react";
import { BotaoExcluir } from "@/components/botao-excluir";
import { classeBotao } from "@/components/ui";
import { MOTIVOS_NAO_CAPTADO, ORIGENS_CAPTACAO, ROTULO_ETAPA_CAPTACAO, TODAS_ETAPAS_CAPTACAO } from "@/lib/dominio/captacao";
import { formatarReais } from "@/lib/dominio/dinheiro";
import { linkWhatsapp } from "@/lib/whatsapp";
import { excluirCaptacao, moverCaptacao } from "./actions";

export type CartaoCaptacao = {
  id: string;
  numero: number;
  nome: string;
  telefone: string | null;
  status: string;
  origem: string;
  resumo: string;
  valor: number | null;
  corretor: string | null;
  docs: number;
  docsTotal: number;
  exclusivo: boolean;
  chegou: string;
};

const COR_ETAPA: Record<string, string> = {
  prospeccao: "bg-fraco",
  contato: "bg-acento",
  avaliacao: "bg-alerta",
  proposta: "bg-violeta",
  autorizacao: "bg-acento-hot",
  captado: "bg-ok",
  nao_captado: "bg-ruim",
};

/** Funil da captação em colunas: arraste o cartão para mudar de etapa. */
export function QuadroCaptacao({ itens }: { itens: CartaoCaptacao[] }) {
  const router = useRouter();
  const [lista, setLista] = useState(itens);
  const [arrastando, setArrastando] = useState<string | null>(null);
  const [sobre, setSobre] = useState<string | null>(null);
  const [perda, setPerda] = useState<{ id: string; nome: string } | null>(null);
  const [motivo, setMotivo] = useState(MOTIVOS_NAO_CAPTADO[0]);
  const [, iniciar] = useTransition();
  const [prev, setPrev] = useState(itens);
  if (itens !== prev) {
    setPrev(itens);
    setLista(itens);
  }

  const mover = (id: string, status: string, m?: string) => {
    const antes = lista;
    setLista((l) => l.map((x) => (x.id === id ? { ...x, status } : x)));
    iniciar(async () => {
      const r = await moverCaptacao(id, status, m ?? null);
      if (!r.ok) {
        setLista(antes);
        window.alert(r.erro ?? "Não foi possível mudar a etapa.");
      }
    });
  };

  const pedir = (id: string, status: string) => {
    const item = lista.find((l) => l.id === id);
    if (!item || item.status === status) return;
    if (item.status === "captado") return window.alert("Esta captação já virou imóvel.");
    if (status === "captado") return router.push(`/captacao/${id}?converter=1`);
    if (status === "nao_captado") {
      setMotivo(MOTIVOS_NAO_CAPTADO[0]);
      setPerda({ id, nome: item.nome });
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
      <div className="entrar-cascata grid auto-cols-[minmax(250px,1fr)] grid-flow-col gap-3 overflow-x-auto pb-3">
        {TODAS_ETAPAS_CAPTACAO.map((etapa) => {
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
                <h3 className="text-[14px] font-semibold text-texto">{ROTULO_ETAPA_CAPTACAO[etapa]}</h3>
                <span className="ml-auto rounded-full bg-card px-2 py-0.5 text-xs font-semibold text-texto-2">{daEtapa.length}</span>
              </header>
              <div className="flex flex-col gap-2">
                {daEtapa.map((l) => (
                  <article
                    key={l.id}
                    draggable={l.status !== "captado"}
                    onDragStart={(e) => {
                      setArrastando(l.id);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    onDragEnd={() => setArrastando(null)}
                    onClick={(e) => {
                      if ((e.target as HTMLElement).closest("a, button, select")) return;
                      router.push(`/captacao/${l.id}`);
                    }}
                    className={`cursor-grab rounded-[14px] border border-borda bg-card p-3 transition hover:border-borda-forte active:cursor-grabbing ${arrastando === l.id ? "opacity-50" : ""}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-semibold text-texto">{l.nome}</span>
                      <span className="shrink-0 font-mono text-[10.5px] text-mudo">#{l.numero}</span>
                    </div>
                    <div className="mt-0.5 truncate text-xs text-texto-2 first-letter:uppercase">{l.resumo || "imóvel ainda sem dados"}</div>
                    <div className="mt-1 text-xs text-mudo">
                      {ORIGENS_CAPTACAO[l.origem] ?? l.origem} · {l.chegou}
                      {l.corretor ? ` · ${l.corretor}` : " · sem corretor"}
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                      {l.valor ? <span className="font-semibold tabular-nums text-texto">{formatarReais(l.valor)}</span> : null}
                      <span className={`inline-flex items-center gap-1 ${l.docs === l.docsTotal ? "text-ok" : "text-mudo"}`}>
                        <BadgeCheck className="size-3.5" /> docs {l.docs}/{l.docsTotal}
                      </span>
                      {l.exclusivo && (
                        <span className="inline-flex items-center gap-1 text-violeta">
                          <ShieldCheck className="size-3.5" /> exclusivo
                        </span>
                      )}
                    </div>
                    <div className="mt-2.5 flex items-center gap-1.5">
                      <select
                        value={l.status}
                        disabled={l.status === "captado"}
                        onChange={(e) => pedir(l.id, e.target.value)}
                        aria-label={`Etapa de ${l.nome}`}
                        className="h-8 min-w-0 flex-1 rounded-[9px] border border-borda bg-input px-2 text-xs font-medium text-texto disabled:opacity-70"
                      >
                        {TODAS_ETAPAS_CAPTACAO.map((e) => (
                          <option key={e} value={e}>
                            {ROTULO_ETAPA_CAPTACAO[e]}
                          </option>
                        ))}
                      </select>
                      <BotaoExcluir acao={excluirCaptacao} id={l.id} rotulo={`Excluir ${l.nome}`} confirmar={`Excluir a captação de "${l.nome}"? (o imóvel, se já foi criado, continua)`} />
                      {l.telefone && (
                        <>
                          <a
                            href={linkWhatsapp(l.telefone, `Olá ${l.nome.split(" ")[0]}! Tudo bem?`)}
                            target="_blank"
                            rel="noreferrer"
                            title="WhatsApp"
                            className="grid size-8 place-items-center rounded-[9px] border border-ok-bd bg-ok-bg text-ok transition hover:-translate-y-px active:scale-90"
                          >
                            <MessageCircle className="size-4" />
                          </a>
                          <a href={`tel:${l.telefone}`} title="Ligar" className="grid size-8 place-items-center rounded-[9px] border border-borda text-texto-2 transition hover:-translate-y-px active:scale-90">
                            <Phone className="size-4" />
                          </a>
                        </>
                      )}
                    </div>
                  </article>
                ))}
                {daEtapa.length === 0 && <p className="px-1.5 py-3 text-xs text-fraco">{etapa === "captado" ? "Arraste aqui para converter em imóvel." : "Arraste um cartão para cá."}</p>}
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
              <h3 className="mb-1 text-[17px] font-semibold text-texto">Por que não captou o imóvel de {perda.nome}?</h3>
              <p className="mb-4 text-sm text-texto-2">Fica no histórico de não captados (dá para retomar depois).</p>
              <div className="space-y-2">
                {MOTIVOS_NAO_CAPTADO.map((m) => (
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
                    mover(perda.id, "nao_captado", motivo);
                    setPerda(null);
                  }}
                >
                  Marcar como não captado
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
