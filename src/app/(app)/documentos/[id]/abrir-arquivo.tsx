"use client";

import { useTransition } from "react";
import { ExternalLink } from "lucide-react";
import { classeBotao } from "@/components/ui";
import { linkArquivoDocumento } from "../actions";

/** Abre o arquivo do documento num link temporário (e registra na auditoria). */
export function AbrirArquivo({ id }: { id: string }) {
  const [rodando, iniciar] = useTransition();
  return (
    <button
      type="button"
      disabled={rodando}
      className={classeBotao("secundario")}
      onClick={() =>
        iniciar(async () => {
          const r = await linkArquivoDocumento(id);
          if (r.ok && r.url) window.open(r.url, "_blank");
          else window.alert(r.erro ?? "Não foi possível abrir.");
        })
      }
    >
      <ExternalLink className="size-4" /> Abrir arquivo
    </button>
  );
}
