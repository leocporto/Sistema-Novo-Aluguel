"use client";

import { useActionState } from "react";
import { ScanText } from "lucide-react";
import { BotaoEnviar } from "@/components/formulario";
import { Aviso } from "@/components/ui";
import { CAMPOS_DOC, TIPOS_DOC_EXTRACAO } from "@/lib/dominio/ia";
import type { EstadoAcao } from "@/lib/form";
import { aplicarDocumento, lerDocumento, type EstadoExtracao } from "../actions";

const campo =
  "w-full min-h-[46px] rounded-btn border border-borda-forte bg-input px-3.5 py-2.5 text-[15px] text-texto outline-none transition placeholder:text-fraco focus:border-acento focus:ring-4 focus:ring-acento-bg";
const rotulo = "font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-mudo";

type Arquivo = { id: string; nome: string; categoria: string | null };

/** Lê o documento com IA e mostra uma PRÉVIA; só grava no cadastro os campos que a pessoa marcar. */
export function Extrator({ arquivos, iaDisponivel }: { arquivos: Arquivo[]; iaDisponivel: boolean }) {
  const [estado, ler] = useActionState<EstadoExtracao, FormData>(lerDocumento, {});
  const [aplicado, aplicar] = useActionState<EstadoAcao, FormData>(aplicarDocumento, {});
  return (
    <div className="space-y-5">
      <form action={ler} className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <label className="flex flex-col gap-1.5 md:col-span-2">
          <span className={rotulo}>Arquivo</span>
          <select name="arquivo_id" required className={campo}>
            {arquivos.map((a) => (
              <option key={a.id} value={a.id}>
                {a.categoria ? `${a.categoria} — ` : ""}
                {a.nome}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={rotulo}>Tipo do documento</span>
          <select name="tipo" required className={campo}>
            {Object.entries(TIPOS_DOC_EXTRACAO).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <div className="md:col-span-3">
          <BotaoEnviar>
            <ScanText className="size-4" /> {iaDisponivel ? "Ler documento" : "Ler documento (precisa da IA)"}
          </BotaoEnviar>
        </div>
      </form>
      {estado.erro && <Aviso tipo="erro">{estado.erro}</Aviso>}
      {estado.campos && estado.tipo && estado.pessoaId && (
        <form action={aplicar} className="space-y-3 rounded-card border border-borda bg-card p-5">
          <input type="hidden" name="pessoa_id" value={estado.pessoaId} />
          <input type="hidden" name="tipo" value={estado.tipo} />
          <h3 className="text-[15px] font-semibold text-texto">Prévia — confira com o documento antes de gravar</h3>
          {estado.legivel === false && <Aviso tipo="alerta">A IA achou o documento pouco legível. Confira campo a campo.</Aviso>}
          {estado.avisos && estado.avisos.length > 0 && (
            <Aviso tipo="alerta">
              <ul className="list-disc pl-5">
                {estado.avisos.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </Aviso>
          )}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {CAMPOS_DOC[estado.tipo].map((c) => (
              <div key={c.campo} className="flex flex-col gap-1.5">
                <span className={rotulo}>{c.rotulo}</span>
                <input name={`v_${c.campo}`} defaultValue={estado.campos?.[c.campo] === null ? "" : String(estado.campos?.[c.campo] ?? "")} aria-label={c.rotulo} className={campo} />
                {c.pessoa ? (
                  <label className="flex items-center gap-2 text-xs text-texto-2">
                    <input type="checkbox" name="aplicar" value={c.campo} defaultChecked={estado.campos?.[c.campo] !== null} className="size-4 accent-[var(--accent)]" /> Gravar no cadastro
                  </label>
                ) : (
                  <span className="text-xs text-mudo">Só para conferência (não vai para o cadastro).</span>
                )}
              </div>
            ))}
          </div>
          {aplicado.erro && <Aviso tipo="erro">{aplicado.erro}</Aviso>}
          {aplicado.ok && <Aviso>{aplicado.ok}</Aviso>}
          <BotaoEnviar confirmar="Gravar no cadastro da pessoa os campos marcados?">Gravar campos marcados</BotaoEnviar>
        </form>
      )}
    </div>
  );
}
