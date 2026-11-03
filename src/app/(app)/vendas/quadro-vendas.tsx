"use client";

import { useState, useTransition, type DragEvent } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Landmark, MessageCircle } from "lucide-react";
import { BotaoExcluir } from "@/components/botao-excluir";
import { classeBotao } from "@/components/ui";
import { COLUNAS_VENDA, MOTIVOS_CANCELAMENTO_VENDA, ROTULO_ETAPA_VENDA, ROTULO_FINANCIAMENTO, TODAS_ETAPAS_VENDA, colunaDaVenda } from "@/lib/dominio/vendas";
import { formatarReais } from "@/lib/dominio/dinheiro";
import { linkWhatsapp } from "@/lib/whatsapp";
import { excluirVenda, moverVenda } from "./actions";

export type CartaoVenda = {
  id: string;
  numero: number;
  imovel: string;
  comprador: string;
  telefone: string | null;
  status: string;
  valor: number;
  corretor: string | null;
  financiamento: string | null;
  docs: string;
  pagoPct: number;
  desde: string;
};

const COR: Record<string, string> = {
  negociacao: "bg-acento",
  aprovado: "bg-violeta",
  documentacao: "bg-alerta",
  financiamento: "bg-acento-hot",
  escritura: "bg-alerta",
  registro: "bg-acento",
  concluida: "bg-ok",
  cancelada: "bg-fraco",
};

/** Funil da venda: arraste o cartão. Concluir gera as comissões; cancelar pede o motivo. */
export function QuadroVendas({ itens }: { itens: CartaoVenda[] }) {
  const router = useRouter();
  const [lista, setLista] = useState(itens);
  const [arrastando, setArrastando] = useState<string | null>(null);
  const [sobre, setSobre] = useState<string | null>(null);
  const [cancelar, setCancelar] = useState<{ id: string; nome: string } | null>(null);
  const [motivo, setMotivo] = useState(MOTIVOS_CANCELAMENTO_VENDA[0]);
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
      const r = await moverVenda(id, status, m ?? null);
      if (!r.ok) {
        setLista(antes);
        window.alert(r.erro ?? "Não foi possível mudar a etapa.");
      }
    });
  };

  const pedir = (id: string, status: string) => {
    const v = lista.find((x) => x.id === id);
    if (!v || colunaDaVenda(v.status) === status) return;
    if (v.status === "concluida") return window.alert("Venda concluída não muda de etapa.");
    if (status === "cancelada") {
      setMotivo(MOTIVOS_CANCELAMENTO_VENDA[0]);
      setCancelar({ id, nome: v.comprador });
    } else if (status === "concluida") {
      if (window.confirm(`Concluir a venda de ${v.imovel}? O imóvel vira "vendido", a comissão da imobiliária entra no financeiro como "a receber" e a parte de cada corretor vira conta a pagar (ou fica prevista até a imobiliária receber, se a regra mandar).`)) mover(id, status);
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
        {COLUNAS_VENDA.map((etapa) => {
          const daEtapa = lista.filter((v) => colunaDaVenda(v.status) === etapa);
          const soma = daEtapa.reduce((s, v) => s + v.valor, 0);
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
              <header className="mb-2 px-1.5 pt-1">
                <div className="flex items-center gap-2">
                  <span className={`size-2.5 rounded-full ${COR[etapa]}`} />
                  <h3 className="text-[14px] font-semibold text-texto">{ROTULO_ETAPA_VENDA[etapa]}</h3>
                  <span className="ml-auto rounded-full bg-card px-2 py-0.5 text-xs font-semibold text-texto-2">{daEtapa.length}</span>
                </div>
                {soma > 0 && <div className="mt-0.5 pl-4.5 text-xs tabular-nums text-mudo">{formatarReais(soma)}</div>}
              </header>
              <div className="flex flex-col gap-2">
                {daEtapa.map((v) => (
                  <article
                    key={v.id}
                    draggable={v.status !== "concluida"}
                    onDragStart={(e) => {
                      setArrastando(v.id);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    onDragEnd={() => setArrastando(null)}
                    onClick={(e) => {
                      if ((e.target as HTMLElement).closest("a, button, select")) return;
                      router.push(`/vendas/${v.id}`);
                    }}
                    className={`cursor-grab rounded-[14px] border border-borda bg-card p-3 transition hover:border-borda-forte active:cursor-grabbing ${arrastando === v.id ? "opacity-50" : ""}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-semibold text-texto">{v.imovel}</span>
                      <span className="shrink-0 font-mono text-[10.5px] text-mudo">#{v.numero}</span>
                    </div>
                    <div className="mt-0.5 truncate text-xs text-texto-2">{v.comprador}</div>
                    <div className="mt-1 text-xs text-mudo">
                      {v.corretor ?? "sem corretor"} · {v.desde}
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                      <span className="font-semibold tabular-nums text-texto">{formatarReais(v.valor)}</span>
                      <span className="text-mudo">docs {v.docs}</span>
                      {v.pagoPct > 0 && <span className="text-ok">{v.pagoPct}% pago</span>}
                    </div>
                    {v.financiamento && (
                      <div className="mt-1 inline-flex items-center gap-1 text-xs text-texto-2">
                        <Landmark className="size-3.5" /> {ROTULO_FINANCIAMENTO[v.financiamento]}
                      </div>
                    )}
                    <div className="mt-2.5 flex items-center gap-1.5">
                      <select
                        value={v.status === "proposta" || v.status === "reservado" ? "negociacao" : v.status}
                        disabled={v.status === "concluida"}
                        onChange={(e) => pedir(v.id, e.target.value)}
                        aria-label={`Etapa da venda ${v.numero}`}
                        className="h-8 min-w-0 flex-1 rounded-[9px] border border-borda bg-input px-2 text-xs font-medium text-texto disabled:opacity-70"
                      >
                        {TODAS_ETAPAS_VENDA.filter((e) => e !== "proposta" && e !== "reservado").map((e) => (
                          <option key={e} value={e}>
                            {ROTULO_ETAPA_VENDA[e]}
                          </option>
                        ))}
                      </select>
                      <BotaoExcluir acao={excluirVenda} id={v.id} rotulo={`Excluir venda ${v.numero}`} confirmar="Excluir esta venda? Comissões ainda não pagas saem junto." />
                      {v.telefone && (
                        <a
                          href={linkWhatsapp(v.telefone, `Olá ${v.comprador.split(" ")[0]}! Tudo bem?`)}
                          target="_blank"
                          rel="noreferrer"
                          title="WhatsApp"
                          className="grid size-8 place-items-center rounded-[9px] border border-ok-bd bg-ok-bg text-ok transition hover:-translate-y-px active:scale-90"
                        >
                          <MessageCircle className="size-4" />
                        </a>
                      )}
                    </div>
                  </article>
                ))}
                {daEtapa.length === 0 && <p className="px-1.5 py-3 text-xs text-fraco">Arraste um cartão para cá.</p>}
              </div>
            </section>
          );
        })}
      </div>

      {cancelar &&
        createPortal(
          <div
            className="janela-fundo fixed inset-0 z-[100] flex items-center justify-center bg-[rgba(10,14,20,.45)] p-4 backdrop-blur-[6px]"
            onMouseDown={(e) => e.target === e.currentTarget && setCancelar(null)}
          >
            <div role="dialog" aria-modal="true" className="janela w-full max-w-md rounded-card border border-borda bg-card p-6 shadow-[0_24px_60px_-20px_rgba(0,0,0,.45)]">
              <h3 className="mb-1 text-[17px] font-semibold text-texto">Por que a venda para {cancelar.nome} foi cancelada?</h3>
              <p className="mb-4 text-sm text-texto-2">O imóvel volta a ficar disponível.</p>
              <div className="space-y-2">
                {MOTIVOS_CANCELAMENTO_VENDA.map((m) => (
                  <label key={m} className="flex cursor-pointer items-center gap-2 rounded-[10px] border border-borda px-3 py-2 text-sm has-[:checked]:border-acento has-[:checked]:bg-acento-bg">
                    <input type="radio" name="motivo" checked={motivo === m} onChange={() => setMotivo(m)} /> {m}
                  </label>
                ))}
              </div>
              <div className="mt-5 flex justify-end gap-2">
                <button type="button" className={classeBotao("secundario")} onClick={() => setCancelar(null)}>
                  Voltar
                </button>
                <button
                  type="button"
                  className={classeBotao("perigo")}
                  onClick={() => {
                    mover(cancelar.id, "cancelada", motivo);
                    setCancelar(null);
                  }}
                >
                  Cancelar venda
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
