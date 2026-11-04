"use client";

import { useActionState } from "react";
import { Sparkles } from "lucide-react";
import { BotaoEnviar } from "@/components/formulario";
import { Aviso } from "@/components/ui";
import { explicarPrecoComIA, type EstadoPreco } from "../actions";

/** A IA só redige a explicação: os números (mediana, faixa) vêm do banco. */
export function ExplicarPrecoIA({ imovelId, finalidade }: { imovelId: string; finalidade: string }) {
  const [estado, executar] = useActionState<EstadoPreco, FormData>(explicarPrecoComIA, {});
  return (
    <div className="space-y-3">
      <form action={executar}>
        <input type="hidden" name="imovel_id" value={imovelId} />
        <input type="hidden" name="finalidade" value={finalidade} />
        <BotaoEnviar variante="secundario">
          <Sparkles className="size-4" /> Explicar com IA
        </BotaoEnviar>
      </form>
      {estado.erro && <Aviso tipo="erro">{estado.erro}</Aviso>}
      {estado.explicacao && (
        <div className="rounded-[14px] border border-acento-bd bg-acento-bg p-4 text-sm leading-relaxed text-texto">
          {estado.usouIA && <div className="mb-1 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-acento-hot">Texto da IA (números do sistema)</div>}
          {estado.explicacao}
        </div>
      )}
    </div>
  );
}
