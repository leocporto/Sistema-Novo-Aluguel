"use client";

import { useActionState } from "react";
import { Sparkles } from "lucide-react";
import { BotaoEnviar } from "@/components/formulario";
import { Copiar } from "@/components/copiar";
import { Aviso, Selo } from "@/components/ui";
import type { EstadoAcao } from "@/lib/form";
import { resumir, salvarResumo, type EstadoResumo, type FonteResumo } from "../actions";
import { SeloOrigem } from "../componentes";

const COR_SENTIMENTO = { positivo: "verde", neutro: "cinza", negativo: "vermelho" } as const;

/** Botão "Resumir" (IA ou regra) e, se quiser, guardar o resumo como anotação. */
export function Resumir({ fonte, id }: { fonte: FonteResumo; id: string }) {
  const [estado, executar] = useActionState<EstadoResumo, FormData>(resumir, {});
  const [salvo, salvar] = useActionState<EstadoAcao, FormData>(salvarResumo, {});
  const r = estado.resultado;
  const textoCompleto = r
    ? [r.resumo, r.pontos.length ? `Pontos: ${r.pontos.join("; ")}` : "", r.pendencias.length ? `Pendências: ${r.pendencias.join("; ")}` : "", r.proximo_passo ? `Próximo passo: ${r.proximo_passo}` : ""]
        .filter(Boolean)
        .join("\n")
    : "";
  return (
    <div className="space-y-4">
      <form action={executar}>
        <input type="hidden" name="fonte" value={fonte} />
        <input type="hidden" name="id" value={id} />
        <BotaoEnviar>
          <Sparkles className="size-4" /> Resumir
        </BotaoEnviar>
      </form>
      {estado.erro && <Aviso tipo="erro">{estado.erro}</Aviso>}
      {estado.aviso && <Aviso tipo="alerta">{estado.aviso}</Aviso>}
      {r && (
        <div className="space-y-3 rounded-card border border-borda bg-card p-5">
          <div className="flex flex-wrap items-center gap-2">
            <SeloOrigem usouIA={!!estado.usouIA} />
            {typeof estado.total === "number" && <span className="text-xs text-mudo">{estado.total} registro(s) lidos</span>}
            {r.sentimento && <Selo cor={COR_SENTIMENTO[r.sentimento]}>Clima: {r.sentimento}</Selo>}
          </div>
          <p className="text-[14px] leading-relaxed text-texto">{r.resumo}</p>
          {r.pontos.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-texto-2">Pontos importantes</div>
              <ul className="mt-1 list-disc pl-5 text-sm text-texto">
                {r.pontos.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            </div>
          )}
          {r.pendencias.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-texto-2">Pendências</div>
              <ul className="mt-1 list-disc pl-5 text-sm text-texto">
                {r.pendencias.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            </div>
          )}
          {r.proximo_passo && (
            <p className="text-sm text-texto">
              <strong>Próximo passo:</strong> {r.proximo_passo}
            </p>
          )}
          <form action={salvar} className="flex flex-wrap items-center gap-2 pt-1">
            <input type="hidden" name="fonte" value={fonte} />
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="texto" value={textoCompleto} />
            <BotaoEnviar variante="secundario">Guardar como anotação</BotaoEnviar>
            <Copiar texto={textoCompleto} />
          </form>
          {salvo.erro && <Aviso tipo="erro">{salvo.erro}</Aviso>}
          {salvo.ok && <Aviso>{salvo.ok}</Aviso>}
        </div>
      )}
    </div>
  );
}
