"use client";

import { useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle } from "lucide-react";
import { classeBotao, type VarianteBotao } from "./ui";

type Resultado = { ok: boolean; erro?: string };

/**
 * Botão de um clique que chama uma Server Action `(id) => {ok, erro}`.
 * Pede confirmação se quiser, mostra o erro se der errado e pode navegar depois.
 */
export function BotaoAcao({
  acao,
  id,
  children,
  confirmar,
  variante = "secundario",
  tamanho = "md",
  depois,
}: {
  acao: (id: string) => Promise<Resultado>;
  id: string;
  children: ReactNode;
  confirmar?: string;
  variante?: VarianteBotao;
  tamanho?: "md" | "sm";
  depois?: string;
}) {
  const [rodando, iniciar] = useTransition();
  const router = useRouter();
  return (
    <button
      type="button"
      disabled={rodando}
      className={classeBotao(variante, tamanho)}
      onClick={(e) => {
        e.stopPropagation();
        if (confirmar && !window.confirm(confirmar)) return;
        iniciar(async () => {
          const r = await acao(id);
          if (!r.ok) window.alert(r.erro ?? "Não foi possível concluir.");
          else if (depois) router.push(depois);
        });
      }}
    >
      {rodando ? <LoaderCircle className="size-4 animate-spin" /> : null}
      {children}
    </button>
  );
}
