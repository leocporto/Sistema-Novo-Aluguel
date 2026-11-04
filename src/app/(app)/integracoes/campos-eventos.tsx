import { eventosDoModo } from "@/lib/dominio/integracoes";
import type { ModoUso } from "@/lib/modos";

/** Caixas dos eventos do webhook, agrupadas (no pessoal somem leads e propostas). */
export function CamposEventos({ modo, marcados = [] }: { modo: ModoUso; marcados?: string[] }) {
  const eventos = eventosDoModo(modo);
  const grupos = [...new Set(eventos.map((e) => e.grupo))];
  return (
    <fieldset className="space-y-3">
      <legend className="mb-1 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-mudo">Eventos que disparam o aviso</legend>
      <div className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
        {grupos.map((g) => (
          <div key={g} className="space-y-1.5">
            <div className="text-[12.5px] font-semibold text-texto">{g}</div>
            {eventos
              .filter((e) => e.grupo === g)
              .map((e) => (
                <label key={e.id} className="flex items-center gap-2 text-sm text-texto-2">
                  <input type="checkbox" name="eventos" value={e.id} defaultChecked={marcados.includes(e.id)} className="size-4" />
                  <span>
                    {e.rotulo} <span className="font-mono text-[11px] text-mudo">{e.id}</span>
                  </span>
                </label>
              ))}
          </div>
        ))}
      </div>
    </fieldset>
  );
}
