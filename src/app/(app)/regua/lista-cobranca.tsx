"use client";

import { useState, useTransition } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { Check, MessageCircle } from "lucide-react";
import { atualizarTelefone } from "@/app/(app)/pessoas/actions";
import { classeBotao } from "@/components/ui";
import { marcarAvisoEnviado } from "./actions";

export interface ItemCobranca {
  faturaId: string;
  contratoId: string;
  inquilinoId: string | null;
  inquilino: string;
  telefone: string | null;
  imovel: string;
  competencia: string;
  vencimento: string;
  /** > 0 em atraso; <= 0 vence em |dias| dias. */
  dias: number;
  valor: string;
  valorAtualizado: string | null;
  ultimoAviso: string | null;
  regraId: string | null;
  mensagem: string;
}

function linkWhatsapp(telefone: string, mensagem: string) {
  const d = telefone.replace(/\D/g, "");
  return `https://wa.me/${d.length <= 11 ? `55${d}` : d}?text=${encodeURIComponent(mensagem)}`;
}

function textoDias(dias: number) {
  if (dias > 0) return `${dias} ${dias === 1 ? "dia" : "dias"} de atraso`;
  if (dias === 0) return "vence hoje";
  return `vence em ${-dias} ${dias === -1 ? "dia" : "dias"}`;
}

/** Lista de quem deve (ou vai vencer) com um botão para cobrar no WhatsApp. */
export function ListaCobranca({ itens, tipo }: { itens: ItemCobranca[]; tipo: "atraso" | "vencendo" }) {
  const [cobrados, setCobrados] = useState<Set<string>>(new Set());
  const [telefones, setTelefones] = useState<Record<string, string>>({});
  const [erros, setErros] = useState<Record<string, string>>({});
  const [, iniciar] = useTransition();
  // Janela de edição: mensagem pronta para revisar antes de abrir o WhatsApp.
  const [editando, setEditando] = useState<ItemCobranca | null>(null);
  const [textoJanela, setTextoJanela] = useState("");
  const [telJanela, setTelJanela] = useState("");
  const [erroJanela, setErroJanela] = useState("");

  const abrirJanela = (it: ItemCobranca) => {
    setEditando(it);
    setTextoJanela(it.mensagem);
    setTelJanela(telefones[it.faturaId] ?? it.telefone ?? "");
    setErroJanela("");
  };

  if (itens.length === 0) {
    return (
      <div className="flex items-center gap-3 rounded-[14px] border border-ok-bd bg-ok-bg px-5 py-4 text-sm text-texto">
        <Check className="size-5 text-ok" />
        {tipo === "atraso" ? "Ninguém devendo. Todos os aluguéis estão em dia." : "Nenhum aluguel vencendo nos próximos dias."}
      </div>
    );
  }

  const cobrar = (it: ItemCobranca, tel: string, mensagem: string) => {
    const dig = tel.replace(/\D/g, "");
    if (dig.length < 10 || dig.length > 13) {
      setErroJanela("Digite o celular com DDD, ex.: (51) 98123-4567.");
      return;
    }
    if (!mensagem.trim()) {
      setErroJanela("Escreva a mensagem.");
      return;
    }
    window.open(linkWhatsapp(tel, mensagem), "_blank", "noopener");
    setEditando(null);
    setTelefones((t) => ({ ...t, [it.faturaId]: tel }));
    setCobrados((s) => new Set(s).add(it.faturaId));
    setErros((e) => ({ ...e, [it.faturaId]: "" }));
    iniciar(async () => {
      if (it.inquilinoId && (it.telefone ?? "").replace(/\D/g, "") !== dig) await atualizarTelefone(it.inquilinoId, tel);
      if (it.regraId) await marcarAvisoEnviado({ regraId: it.regraId, faturaId: it.faturaId, destinatario: dig });
    });
  };

  return (
    <ul className="divide-y divide-borda-suave">
      {itens.map((it) => {
        const feito = cobrados.has(it.faturaId);
        const semTelefone = !it.telefone;
        return (
          <li key={it.faturaId} className="flex flex-wrap items-center gap-x-6 gap-y-3 py-4 first:pt-0 last:pb-0">
            <div className="min-w-[220px] flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[15px] font-semibold text-texto">{it.inquilino}</span>
                <span
                  className={`rounded-full border px-2.5 py-0.5 font-mono text-[10.5px] font-bold tracking-[0.04em] ${
                    it.dias > 0
                      ? "border-ruim-bd bg-ruim-bg text-ruim"
                      : it.dias === 0
                        ? "border-alerta-bd bg-alerta-bg text-alerta"
                        : "border-acento-bd bg-acento-bg text-acento-hot"
                  }`}
                >
                  {textoDias(it.dias)}
                </span>
              </div>
              <div className="mt-0.5 text-[13px] text-texto-2">
                {it.imovel} · aluguel {it.competencia} · venc. {it.vencimento}
              </div>
              <div className="mt-0.5 text-xs text-mudo">
                {it.ultimoAviso ? `Último aviso: ${it.ultimoAviso}` : "Ainda não avisado"} ·{" "}
                <Link href={`/faturas/${it.faturaId}`} className="hover:text-acento hover:underline">
                  ver cobrança
                </Link>
              </div>
            </div>

            <div className="text-right">
              <div className={`text-[17px] font-semibold tabular-nums ${it.dias > 0 ? "text-ruim" : "text-texto"}`}>
                {it.valorAtualizado ?? it.valor}
              </div>
              {it.valorAtualizado && <div className="text-xs text-mudo">original {it.valor} + multa e juros</div>}
            </div>

            <div className="flex min-w-[230px] flex-col items-end gap-1.5">
              {semTelefone && !feito && <span className="text-xs text-alerta">Sem celular no cadastro</span>}
              {feito ? (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-ok-bd bg-ok-bg px-3 py-1.5 text-xs font-semibold text-ok">
                  <Check className="size-3.5" /> Mensagem aberta no WhatsApp
                </span>
              ) : (
                <button type="button" onClick={() => abrirJanela(it)} className={classeBotao(it.dias > 0 ? "primario" : "secundario", "sm")}>
                  <MessageCircle className="size-4" /> {it.dias > 0 ? "Cobrar no WhatsApp" : "Lembrar no WhatsApp"}
                </button>
              )}
              {erros[it.faturaId] && <span className="text-xs text-ruim">{erros[it.faturaId]}</span>}
            </div>
          </li>
        );
      })}
      {editando &&
        createPortal(
          <div
            className="janela-fundo fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-[rgba(10,14,20,.45)] p-4 backdrop-blur-[6px]"
            onClick={(e) => {
              if (e.target === e.currentTarget) setEditando(null);
            }}
          >
            <div role="dialog" aria-modal="true" className="janela w-full max-w-lg rounded-card border border-borda bg-card p-6 shadow-[0_24px_60px_-20px_rgba(0,0,0,.45)]">
              <div className="mb-5 flex items-center gap-3">
                <span className="flex size-9 items-center justify-center rounded-[10px] border border-ok-bd bg-ok-bg text-ok">
                  <MessageCircle className="size-4" />
                </span>
                <div>
                  <h3 className="text-[17px] font-semibold tracking-[-0.01em] text-texto">
                    {editando.dias > 0 ? "Cobrar" : "Lembrar"} {editando.inquilino.split(" ")[0]}
                  </h3>
                  <p className="text-xs text-mudo">
                    {editando.imovel} · {textoDias(editando.dias)} · {editando.valorAtualizado ?? editando.valor}
                  </p>
                </div>
              </div>
              <div className="space-y-4">
                <label className="flex flex-col gap-1.5">
                  <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-mudo">Celular (WhatsApp)</span>
                  <input
                    value={telJanela}
                    onChange={(e) => setTelJanela(e.target.value)}
                    inputMode="tel"
                    placeholder="(51) 98123-4567"
                    className="min-h-[46px] w-full rounded-btn border border-borda-forte bg-input px-3.5 text-[15px] text-texto outline-none focus:border-acento focus:ring-4 focus:ring-acento-bg"
                  />
                  {!editando.telefone && <span className="text-xs text-mudo">O número digitado fica salvo no cadastro do inquilino.</span>}
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-mudo">Mensagem (pode editar)</span>
                  <textarea
                    rows={6}
                    autoFocus
                    value={textoJanela}
                    onChange={(e) => setTextoJanela(e.target.value)}
                    className="w-full resize-y rounded-btn border border-borda-forte bg-input px-3.5 py-2.5 text-[15px] leading-relaxed text-texto outline-none focus:border-acento focus:ring-4 focus:ring-acento-bg"
                  />
                </label>
                {erroJanela && <div className="rounded-[14px] border border-ruim-bd bg-ruim-bg px-4 py-2.5 text-sm text-ruim">{erroJanela}</div>}
              </div>
              <div className="mt-6 flex justify-end gap-2">
                <button type="button" className={classeBotao("secundario")} onClick={() => setEditando(null)}>
                  Cancelar
                </button>
                <button type="button" className={classeBotao("primario")} onClick={() => cobrar(editando, telJanela, textoJanela)}>
                  <MessageCircle className="size-4" /> Enviar no WhatsApp
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </ul>
  );
}
