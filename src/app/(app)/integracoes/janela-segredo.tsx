"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { KeyRound, TriangleAlert } from "lucide-react";
import { Copiar } from "@/components/copiar";
import { classeBotao, type VarianteBotao } from "@/components/ui";
import type { EstadoAcao } from "@/lib/form";

export type EstadoSegredo = EstadoAcao & { segredo?: string };

/**
 * Janela de cadastro que, ao salvar, mostra UMA vez o segredo gerado (chave de
 * API, segredo do webhook) com o botão de copiar. Depois de fechar, não há
 * como ver de novo: o banco guarda só o hash (chave) ou não deixa ler (webhook).
 */
export function JanelaSegredo({
  rotuloBotao,
  titulo,
  acao,
  children,
  variante = "primario",
  tamanho = "md",
  rotuloSalvar = "Criar",
  larguraMax = "max-w-lg",
  explicacao,
}: {
  rotuloBotao: ReactNode;
  titulo: string;
  acao: (estado: EstadoSegredo, fd: FormData) => Promise<EstadoSegredo>;
  children?: ReactNode;
  variante?: VarianteBotao;
  tamanho?: "md" | "sm";
  rotuloSalvar?: string;
  larguraMax?: string;
  explicacao: ReactNode;
}) {
  const [aberta, setAberta] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [segredo, setSegredo] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const caixa = useRef<HTMLDivElement>(null);

  const fechar = () => {
    setAberta(false);
    setErro(null);
    setSegredo(null);
  };

  useEffect(() => {
    if (!aberta) return;
    const t = setTimeout(() => caixa.current?.querySelector<HTMLElement>("input:not([type=hidden]),select,textarea,button[type=submit]")?.focus(), 60);
    const esc = (e: KeyboardEvent) => {
      // Com o segredo na tela, só fecha pelo botão (para não perder sem copiar).
      if (e.key === "Escape" && !segredo) setAberta(false);
    };
    window.addEventListener("keydown", esc);
    return () => {
      clearTimeout(t);
      window.removeEventListener("keydown", esc);
    };
  }, [aberta, segredo]);

  const enviar = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (salvando) return;
    setSalvando(true);
    setErro(null);
    try {
      const r = await acao({}, new FormData(e.currentTarget));
      if (r.erro) setErro(r.erro);
      else if (r.segredo) setSegredo(r.segredo);
      else fechar();
    } catch {
      setErro("Não foi possível salvar. Verifique a internet e tente de novo.");
    } finally {
      setSalvando(false);
    }
  };

  return (
    <>
      <button type="button" className={classeBotao(variante, tamanho)} onClick={() => setAberta(true)}>
        {rotuloBotao}
      </button>
      {aberta &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="janela-fundo fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-[rgba(10,14,20,.45)] p-4 backdrop-blur-[6px] sm:items-center"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget && !segredo) fechar();
            }}
          >
            <div
              ref={caixa}
              role="dialog"
              aria-modal="true"
              aria-label={titulo}
              className={`janela my-6 w-full ${larguraMax} rounded-card border border-borda bg-card p-6 shadow-[0_24px_60px_-20px_rgba(0,0,0,.45)]`}
            >
              <div className="mb-5 flex items-center gap-3">
                <span className="flex size-9 items-center justify-center rounded-[10px] border border-acento-bd bg-acento-bg text-acento-hot [&>svg]:size-4">
                  <KeyRound />
                </span>
                <h3 className="text-[17px] font-semibold tracking-[-0.01em] text-texto">{titulo}</h3>
              </div>
              {segredo ? (
                <div className="space-y-4">
                  <div className="flex gap-2 rounded-[14px] border border-alerta-bd bg-alerta-bg px-4 py-3 text-sm text-texto">
                    <TriangleAlert className="mt-0.5 size-4 shrink-0 text-alerta" />
                    <div>{explicacao}</div>
                  </div>
                  <div className="break-all rounded-[11px] border border-borda-forte bg-input px-3.5 py-3 font-mono text-[13px] text-texto">{segredo}</div>
                  <div className="flex flex-wrap justify-end gap-2">
                    <Copiar texto={segredo} rotulo="Copiar" />
                    <button type="button" className={classeBotao("primario")} onClick={fechar}>
                      Já guardei
                    </button>
                  </div>
                </div>
              ) : (
                <form onSubmit={enviar} className="space-y-4">
                  {children}
                  {erro && (
                    <div role="alert" className="rounded-[14px] border border-ruim-bd bg-ruim-bg px-4 py-2.5 text-sm text-ruim">
                      {erro}
                    </div>
                  )}
                  <div className="flex justify-end gap-2 pt-2">
                    <button type="button" className={classeBotao("secundario")} onClick={fechar}>
                      Cancelar
                    </button>
                    <button type="submit" className={classeBotao("primario")} disabled={salvando}>
                      {salvando ? "Salvando…" : rotuloSalvar}
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
