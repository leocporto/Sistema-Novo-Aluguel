"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, LoaderCircle, MessageCircle, X } from "lucide-react";
import { Aviso, classeBotao } from "@/components/ui";
import type { EstadoAcao } from "@/lib/form";
import { decidirAcao, marcarAcaoFeita } from "../actions";

const campo =
  "w-full min-h-[46px] rounded-btn border border-borda-forte bg-input px-3.5 py-2.5 text-[15px] text-texto outline-none transition placeholder:text-fraco focus:border-acento focus:ring-4 focus:ring-acento-bg";

/**
 * Aprovar ou recusar (com motivo). Aprovar pede confirmação mostrando o que
 * será feito e o valor — nada de caixinha disparando ação.
 */
export function Decidir({ id, resumo, valor }: { id: string; resumo: string; valor: string | null }) {
  const [estado, executar, pendente] = useActionState<EstadoAcao, FormData>(decidirAcao, {});
  const [recusando, setRecusando] = useState(false);
  return (
    <form action={executar} className="space-y-3">
      <input type="hidden" name="id" value={id} />
      {recusando && (
        <label className="flex flex-col gap-1.5">
          <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-mudo">Motivo da recusa</span>
          <textarea name="motivo" rows={2} required maxLength={500} className={campo} />
        </label>
      )}
      <div className="flex flex-wrap gap-2">
        {!recusando ? (
          <>
            <button
              type="submit"
              name="decisao"
              value="aprovar"
              disabled={pendente}
              className={classeBotao("primario")}
              onClick={(e) => {
                if (!window.confirm(`Aprovar: ${resumo}${valor ? ` — ${valor}` : ""}?\n\nSe a ação roda sozinha, ela é feita agora pela via normal do sistema.`)) e.preventDefault();
              }}
            >
              {pendente ? <LoaderCircle className="size-4 animate-spin" /> : <Check className="size-4" />} Aprovar
            </button>
            <button type="button" className={classeBotao("secundario")} onClick={() => setRecusando(true)}>
              <X className="size-4" /> Recusar
            </button>
          </>
        ) : (
          <>
            <button type="submit" name="decisao" value="recusar" disabled={pendente} className={classeBotao("perigo")}>
              {pendente ? <LoaderCircle className="size-4 animate-spin" /> : null} Confirmar recusa
            </button>
            <button type="button" className={classeBotao("fantasma")} onClick={() => setRecusando(false)}>
              Voltar
            </button>
          </>
        )}
      </div>
      {estado.erro && <Aviso tipo="erro">{estado.erro}</Aviso>}
      {estado.ok && <Aviso>{estado.ok}</Aviso>}
    </form>
  );
}

/** Mensagem aprovada: abre o WhatsApp/e-mail/SMS com o texto e registra o envio (envio assistido). */
export function EnviarMensagem({ id, link, rotulo }: { id: string; link: string | null; rotulo: string }) {
  const [rodando, iniciar] = useTransition();
  const router = useRouter();
  return (
    <button
      type="button"
      disabled={rodando}
      className={classeBotao("primario")}
      onClick={() => {
        if (link) window.open(link, "_blank", "noopener");
        iniciar(async () => {
          const r = await marcarAcaoFeita(id);
          if (!r.ok) window.alert(r.erro ?? "Não foi possível registrar.");
          router.refresh();
        });
      }}
    >
      {rodando ? <LoaderCircle className="size-4 animate-spin" /> : <MessageCircle className="size-4" />} {rotulo}
    </button>
  );
}
