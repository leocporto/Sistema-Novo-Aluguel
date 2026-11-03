"use client";

import { useState, useTransition } from "react";
import { Plus, RotateCcw } from "lucide-react";
import { classeBotao } from "@/components/ui";
import { associarImovelLead, reativarLead } from "./actions";

/** Traz o lead de volta ao funil. */
export function BotaoReativar({ id, telefone, nome, rotulo = "Reativar" }: { id: string; telefone?: string | null; nome?: string; rotulo?: string }) {
  const [rodando, iniciar] = useTransition();
  return (
    <button
      type="button"
      disabled={rodando}
      className={classeBotao("secundario", "sm")}
      onClick={() =>
        iniciar(async () => {
          const r = await reativarLead(id);
          if (!r.ok) window.alert(r.erro ?? "Não foi possível reativar.");
          else if (telefone) {
            const d = telefone.replace(/\D/g, "");
            const msg = `Olá ${(nome ?? "").split(" ")[0]}! Tudo bem? Aqui é da imobiliária. Você ainda está procurando imóvel? Chegaram opções novas que podem te interessar.`;
            window.open(`https://wa.me/${d.length <= 11 ? `55${d}` : d}?text=${encodeURIComponent(msg)}`, "_blank");
          }
        })
      }
    >
      <RotateCcw className="size-3.5" /> {rodando ? "Reativando…" : rotulo}
    </button>
  );
}

/** Escolher um imóvel e associar ao lead. */
export function AdicionarImovelLead({ leadId, opcoes }: { leadId: string; opcoes: { id: string; rotulo: string }[] }) {
  const [escolha, setEscolha] = useState("");
  const [rodando, iniciar] = useTransition();
  return (
    <div className="flex gap-2">
      <select
        value={escolha}
        onChange={(e) => setEscolha(e.target.value)}
        className="min-h-[34px] min-w-0 flex-1 rounded-[9px] border border-borda-forte bg-input px-2 text-[13px] text-texto"
        aria-label="Imóvel para associar"
      >
        <option value="">Associar outro imóvel…</option>
        {opcoes.map((o) => (
          <option key={o.id} value={o.id}>
            {o.rotulo}
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={!escolha || rodando}
        className={classeBotao("secundario", "sm")}
        onClick={() =>
          iniciar(async () => {
            const r = await associarImovelLead(leadId, escolha);
            if (!r.ok) window.alert(r.erro);
            else setEscolha("");
          })
        }
      >
        <Plus className="size-3.5" /> Associar
      </button>
    </div>
  );
}

/** Botão "+" de uma sugestão de imóvel compatível. */
export function AssociarSugestao({ leadId, imovelId }: { leadId: string; imovelId: string }) {
  const [rodando, iniciar] = useTransition();
  return (
    <button
      type="button"
      disabled={rodando}
      title="Associar ao lead"
      className="grid size-8 shrink-0 place-items-center rounded-[9px] border border-acento-bd bg-acento-bg text-acento-hot disabled:opacity-50"
      onClick={() =>
        iniciar(async () => {
          const r = await associarImovelLead(leadId, imovelId);
          if (!r.ok) window.alert(r.erro);
        })
      }
    >
      <Plus className="size-4" />
    </button>
  );
}
