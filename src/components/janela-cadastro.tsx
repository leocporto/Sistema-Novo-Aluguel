"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import type { EstadoAcao } from "@/lib/form";
import { classeBotao, type VarianteBotao } from "./ui";

type Acao = (estado: EstadoAcao, fd: FormData) => Promise<EstadoAcao>;

/**
 * Botão que abre uma janela (fundo desfocado) com um formulário de cadastro.
 * Os campos vêm como children (podem ser renderizados no servidor). Ao salvar
 * sem erro, a janela fecha e a tela é atualizada pela própria action.
 * `abertaInicial` abre já ao carregar (ex.: link "Agendar visita" de um lead);
 * ao fechar, os parâmetros da URL que abriram a janela são limpos.
 */
export function JanelaCadastro({
  rotuloBotao,
  titulo,
  acao,
  children,
  icone,
  variante = "primario",
  tamanho = "md",
  rotuloSalvar = "Cadastrar",
  abertaInicial = false,
  larguraMax = "max-w-lg",
  botaoClasse,
}: {
  rotuloBotao: ReactNode;
  titulo: string;
  acao: Acao;
  children: ReactNode;
  icone?: ReactNode;
  variante?: VarianteBotao;
  tamanho?: "md" | "sm";
  rotuloSalvar?: string;
  abertaInicial?: boolean;
  larguraMax?: string;
  botaoClasse?: string;
}) {
  const [aberta, setAberta] = useState(abertaInicial);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const caixa = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const caminho = usePathname();

  const fechar = () => {
    setAberta(false);
    setErro(null);
    if (abertaInicial) router.replace(caminho, { scroll: false });
  };

  useEffect(() => {
    if (!aberta) return;
    const t = setTimeout(() => caixa.current?.querySelector<HTMLElement>("input:not([type=hidden]),select,textarea")?.focus(), 60);
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAberta(false);
    };
    window.addEventListener("keydown", esc);
    return () => {
      clearTimeout(t);
      window.removeEventListener("keydown", esc);
    };
  }, [aberta]);

  const enviar = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (salvando) return;
    setSalvando(true);
    setErro(null);
    try {
      const r = await acao({}, new FormData(e.currentTarget));
      if (r.erro) setErro(r.erro);
      else fechar();
    } catch {
      setErro("Não foi possível salvar. Verifique a internet e tente de novo.");
    } finally {
      setSalvando(false);
    }
  };

  return (
    <>
      <button type="button" className={botaoClasse ?? classeBotao(variante, tamanho)} onClick={() => setAberta(true)}>
        {rotuloBotao}
      </button>
      {aberta &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="janela-fundo fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-[rgba(10,14,20,.45)] p-4 backdrop-blur-[6px] sm:items-center"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) fechar();
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
                  {icone ?? <Plus />}
                </span>
                <h3 className="text-[17px] font-semibold tracking-[-0.01em] text-texto">{titulo}</h3>
              </div>
              <form onSubmit={enviar} className="space-y-4">
                {children}
                {erro && <div role="alert" className="rounded-[14px] border border-ruim-bd bg-ruim-bg px-4 py-2.5 text-sm text-ruim">{erro}</div>}
                <div className="flex justify-end gap-2 pt-2">
                  <button type="button" className={classeBotao("secundario")} onClick={fechar}>
                    Cancelar
                  </button>
                  <button type="submit" className={classeBotao("primario")} disabled={salvando}>
                    {salvando ? "Salvando…" : rotuloSalvar}
                  </button>
                </div>
              </form>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
