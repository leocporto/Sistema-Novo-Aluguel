"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2, X } from "lucide-react";
import { classeBotao } from "./ui";

export type ResultadoExclusao = { ok: boolean; erro?: string };

/**
 * Lixeira padrão do sistema: pede confirmação, chama a ação do servidor e
 * mostra o motivo quando não dá para excluir (ex.: registro em uso).
 */
export function BotaoExcluir({
  acao,
  id,
  confirmar,
  rotulo = "Excluir",
  variante = "icone",
  depois,
}: {
  acao: (id: string) => Promise<ResultadoExclusao>;
  id: string;
  confirmar: string;
  rotulo?: string;
  variante?: "icone" | "texto" | "botao";
  /** Para onde ir depois de excluir (ex.: voltar da ficha para a lista). */
  depois?: string;
}) {
  const [rodando, iniciar] = useTransition();
  const router = useRouter();
  const clicar = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!window.confirm(confirmar)) return;
    iniciar(async () => {
      const r = await acao(id);
      if (!r.ok) window.alert(r.erro ?? "Não foi possível excluir.");
      else if (depois) router.push(depois);
    });
  };
  if (variante === "botao")
    return (
      <button type="button" onClick={clicar} disabled={rodando} className={classeBotao("fantasma")}>
        <Trash2 className="size-4" /> {rodando ? "Excluindo…" : rotulo}
      </button>
    );
  if (variante === "texto")
    return (
      <button type="button" onClick={clicar} disabled={rodando} className="text-xs text-mudo hover:text-ruim hover:underline disabled:opacity-50">
        {rodando ? "excluindo…" : rotulo.toLowerCase()}
      </button>
    );
  return (
    <button
      type="button"
      onClick={clicar}
      disabled={rodando}
      title={rotulo}
      aria-label={rotulo}
      className="grid size-8 shrink-0 place-items-center rounded-[9px] border border-borda bg-card text-texto-2 transition hover:border-ruim-bd hover:bg-ruim-bg hover:text-ruim disabled:opacity-50"
    >
      <X className="size-4" />
    </button>
  );
}
