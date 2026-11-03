"use client";

import { CheckCheck } from "lucide-react";
import { EVENTO_SALVAR } from "@/components/formulario";
import { classeBotao } from "@/components/ui";

/**
 * Marca "Bom" nos itens ainda sem estado do checklist do ambiente e salva
 * pelo salvamento automático do próprio formulário. Fica dentro do
 * formulário de propósito: a tela e o que vai para o sistema mostram sempre
 * a mesma coisa (nada é desfeito na próxima edição).
 */
export function MarcarNaoAvaliadosBom({ ambiente }: { ambiente: string }) {
  return (
    <button
      type="button"
      className={classeBotao("secundario")}
      onClick={(e) => {
        const form = e.currentTarget.closest("form");
        if (!form) return;
        const vazios = [...form.querySelectorAll<HTMLSelectElement>('select[name^="estado:"]')].filter((s) => !s.value);
        if (!vazios.length) {
          window.alert("Todos os itens deste ambiente já foram avaliados.");
          return;
        }
        if (!window.confirm(`Marcar como "Bom" ${vazios.length === 1 ? "o item ainda não avaliado" : `os ${vazios.length} itens ainda não avaliados`} de ${ambiente}?`)) return;
        for (const s of vazios) s.value = "bom";
        form.dispatchEvent(new CustomEvent(EVENTO_SALVAR, { bubbles: true, detail: 0 }));
      }}
    >
      <CheckCheck className="size-4" /> Não avaliados = Bom
    </button>
  );
}
