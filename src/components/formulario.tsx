"use client";

import { useActionState, useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useFormStatus } from "react-dom";
import { Check, CircleAlert, LoaderCircle } from "lucide-react";
import type { EstadoAcao } from "@/lib/form";
import { classeBotao, type VarianteBotao } from "./ui";

type Acao = (estado: EstadoAcao, fd: FormData) => Promise<EstadoAcao>;

/** Evento que um componente filho dispara (com bubbles) para pedir um salvamento automático. */
export const EVENTO_SALVAR = "salvar-auto";

/**
 * Formulário ligado a uma Server Action.
 * - normal: envia pelo botão e mostra erro/sucesso no topo;
 * - `automatico`: salva sozinho a cada alteração (texto ~0,8 s depois de parar de
 *   digitar; caixas, seleções e opções na hora) e mostra "Salvando… / Salvo" num
 *   aviso flutuante. Sem botão de salvar.
 */
export function Formulario({
  acao,
  children,
  className = "space-y-5",
  automatico = false,
  salvarQuando,
  semAviso = false,
}: {
  acao: Acao;
  children: ReactNode;
  className?: string;
  automatico?: boolean;
  /** Só no automático: salva apenas quando ESTE campo muda (ex.: escolher a pessoa a vincular). */
  salvarQuando?: string;
  /** Só no automático: esconde a frase "salvas automaticamente" (formulário de linha de tabela; ponha a frase uma vez na tela). */
  semAviso?: boolean;
}) {
  if (automatico)
    return (
      <FormularioAuto acao={acao} className={className} salvarQuando={salvarQuando} semAviso={semAviso}>
        {children}
      </FormularioAuto>
    );
  return <FormularioBotao acao={acao} className={className}>{children}</FormularioBotao>;
}

function FormularioBotao({ acao, children, className }: { acao: Acao; children: ReactNode; className: string }) {
  const [estado, executar] = useActionState(acao, {});
  return (
    <form action={executar} className={className}>
      {estado.erro && (
        <div role="alert" className="rounded-[14px] border border-ruim-bd bg-ruim-bg px-4 py-3 text-sm text-ruim">
          {estado.erro}
        </div>
      )}
      {estado.ok && (
        <div role="status" className="rounded-[14px] border border-ok-bd bg-ok-bg px-4 py-3 text-sm text-ok">
          {estado.ok}
        </div>
      )}
      {children}
    </form>
  );
}

type Fase = "parado" | "salvando" | "salvo" | "erro";

function FormularioAuto({
  acao,
  children,
  className,
  salvarQuando,
  semAviso,
}: {
  acao: Acao;
  children: ReactNode;
  className: string;
  salvarQuando?: string;
  semAviso?: boolean;
}) {
  const ref = useRef<HTMLFormElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const rodando = useRef(false);
  const deNovo = useRef(false);
  const foto = useRef<{ fd: FormData; valido: boolean } | null>(null);
  const [fase, setFase] = useState<Fase>("parado");
  const [erro, setErro] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const montado = useRef(true);

  const tirarFoto = () => {
    const f = ref.current;
    if (f) foto.current = { fd: new FormData(f), valido: f.checkValidity() };
  };

  const salvar = useCallback(async () => {
    clearTimeout(timer.current);
    timer.current = undefined;
    if (rodando.current) {
      deNovo.current = true;
      return;
    }
    rodando.current = true;
    try {
      // Repete enquanto chegarem mudanças durante o salvamento.
      do {
        deNovo.current = false;
        tirarFoto();
        const atual = foto.current;
        if (!atual) return;
        if (!atual.valido) {
          if (montado.current) {
            setFase("erro");
            setErro("Preencha os campos obrigatórios para salvar.");
          }
          return;
        }
        if (montado.current) setFase("salvando");
        try {
          const r = await acao({}, atual.fd);
          if (montado.current) {
            setErro(r.erro ?? null);
            setOkMsg(r.ok ?? null);
            setFase(r.erro ? "erro" : "salvo");
          }
        } catch {
          if (montado.current) {
            setErro("Não foi possível salvar. Verifique a internet e tente de novo.");
            setFase("erro");
          }
        }
      } while (deNovo.current);
    } finally {
      rodando.current = false;
    }
  }, [acao]);

  const agendar = useCallback(
    (espera: number) => {
      tirarFoto();
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void salvar(), espera);
    },
    [salvar],
  );

  // Filhos controlados (ex.: régua) pedem o salvamento por evento.
  useEffect(() => {
    const f = ref.current;
    if (!f) return;
    const ouvir = (e: Event) => agendar(Number((e as CustomEvent).detail ?? 800));
    f.addEventListener(EVENTO_SALVAR, ouvir);
    return () => f.removeEventListener(EVENTO_SALVAR, ouvir);
  }, [agendar]);

  // Saiu da tela com alteração pendente: salva com a última foto do formulário.
  useEffect(() => {
    montado.current = true;
    const antesDeSair = (e: BeforeUnloadEvent) => {
      if (timer.current || rodando.current) {
        if (timer.current) void salvar();
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", antesDeSair);
    return () => {
      window.removeEventListener("beforeunload", antesDeSair);
      montado.current = false;
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = undefined;
        const ultimo = foto.current;
        if (ultimo?.valido) void acao({}, ultimo.fd);
      }
    };
  }, [acao, salvar]);

  // "Salvo" some sozinho depois de um tempo.
  useEffect(() => {
    if (fase !== "salvo") return;
    const t = setTimeout(() => setFase("parado"), (okMsg?.length ?? 0) > 40 ? 6000 : 2200);
    return () => clearTimeout(t);
  }, [fase, okMsg]);

  const aoMudar = (e: FormEvent<HTMLFormElement>) => {
    const alvo = e.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
    if (!alvo?.name) return;
    if (salvarQuando && alvo.name !== salvarQuando) return;
    const tipo = alvo.type;
    const naHora = alvo.tagName === "SELECT" || tipo === "checkbox" || tipo === "radio" || tipo === "date" || tipo === "month";
    agendar(naHora ? 0 : 800);
  };

  return (
    <form
      ref={ref}
      className={className}
      onChange={aoMudar}
      onBlur={() => {
        if (timer.current) void salvar();
      }}
      onSubmit={(e) => {
        e.preventDefault();
        void salvar();
      }}
      noValidate
    >
      {children}
      {!salvarQuando && !semAviso && (
        <p className="flex items-center justify-end gap-1.5 text-xs text-mudo">
          <Check className="size-3.5" /> As alterações são salvas automaticamente.
        </p>
      )}
      <AvisoSalvamento fase={fase} erro={erro} ok={okMsg} />
    </form>
  );
}

function AvisoSalvamento({ fase, erro, ok }: { fase: Fase; erro: string | null; ok: string | null }) {
  if (fase === "parado" || typeof document === "undefined") return null;
  const estilo =
    fase === "erro"
      ? "border-ruim-bd bg-ruim-bg text-ruim"
      : fase === "salvo"
        ? "border-ok-bd bg-ok-bg text-ok"
        : "border-borda-forte bg-card text-texto-2";
  return createPortal(
    <div
      role={fase === "erro" ? "alert" : "status"}
      className={`fixed bottom-5 right-5 z-50 flex max-w-sm items-center gap-2 rounded-[14px] border px-4 py-2.5 text-sm font-medium shadow-lg ${estilo}`}
    >
      {fase === "salvando" && <LoaderCircle className="size-4 animate-spin" />}
      {fase === "salvo" && <Check className="size-4" />}
      {fase === "erro" && <CircleAlert className="size-4 shrink-0" />}
      {fase === "salvando" ? "Salvando…" : fase === "salvo" ? (ok ?? "Salvo") : erro}
    </div>,
    document.body,
  );
}

export function BotaoEnviar({
  children,
  variante = "primario",
  confirmar,
  name,
  value,
}: {
  children: ReactNode;
  variante?: VarianteBotao;
  confirmar?: string;
  name?: string;
  value?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      name={name}
      value={value}
      disabled={pending}
      className={classeBotao(variante)}
      onClick={(e) => {
        if (confirmar && !window.confirm(confirmar)) e.preventDefault();
      }}
    >
      {pending ? "Aguarde…" : children}
    </button>
  );
}

export function BotaoImprimir() {
  return (
    <button type="button" onClick={() => window.print()} className={classeBotao("secundario")}>
      Imprimir
    </button>
  );
}
