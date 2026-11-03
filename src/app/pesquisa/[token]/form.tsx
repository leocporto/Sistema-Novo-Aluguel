"use client";

import { useActionState, useState } from "react";
import { AbasSegmentadas } from "@/components/abas-segmentadas";
import { BotaoEnviar } from "@/components/formulario";
import { AreaTexto, Campo } from "@/components/ui";
import type { EstadoAcao } from "@/lib/form";
import { responderPesquisa } from "./actions";

/** Nota de 0 a 10 (pílula de escolha única) e comentário opcional. */
export function FormPesquisa({ token }: { token: string }) {
  const [estado, executar] = useActionState<EstadoAcao, FormData>(responderPesquisa, {});
  const [nota, setNota] = useState<string | null>(null);
  if (estado.ok)
    return (
      <div role="status" className="rounded-[14px] border border-ok-bd bg-ok-bg px-4 py-5 text-center text-[15px] font-medium text-ok">
        {estado.ok}
      </div>
    );
  return (
    <form action={executar} className="space-y-5">
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="nota" value={nota ?? ""} />
      <div>
        <div className="overflow-x-auto">
          <AbasSegmentadas
            variante="seg"
            valor={nota}
            aoMudar={setNota}
            rotuloAcessivel="Nota de 0 a 10"
            itens={Array.from({ length: 11 }, (_, i) => ({ id: String(i), rotulo: String(i), titulo: `Nota ${i}` }))}
          />
        </div>
        <div className="mt-1 flex justify-between text-[11px] text-mudo">
          <span>Nada provável</span>
          <span>Muito provável</span>
        </div>
      </div>
      <Campo rotulo="Quer contar o motivo? (opcional)">
        <AreaTexto name="comentario" rows={3} />
      </Campo>
      {estado.erro && (
        <div role="alert" className="rounded-[14px] border border-ruim-bd bg-ruim-bg px-4 py-3 text-sm text-ruim">
          {estado.erro}
        </div>
      )}
      <BotaoEnviar>Enviar resposta</BotaoEnviar>
    </form>
  );
}
