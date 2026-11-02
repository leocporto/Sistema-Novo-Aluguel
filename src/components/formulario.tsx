"use client";

import { useActionState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import type { EstadoAcao } from "@/lib/form";
import { classeBotao, type VarianteBotao } from "./ui";

type Acao = (estado: EstadoAcao, fd: FormData) => Promise<EstadoAcao>;

/** Formulário ligado a uma Server Action, exibindo erro/sucesso retornados. */
export function Formulario({
  acao,
  children,
  className = "space-y-5",
}: {
  acao: Acao;
  children: ReactNode;
  className?: string;
}) {
  const [estado, executar] = useActionState(acao, {});
  return (
    <form action={executar} className={className}>
      {estado.erro && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {estado.erro}
        </div>
      )}
      {estado.ok && (
        <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {estado.ok}
        </div>
      )}
      {children}
    </form>
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
