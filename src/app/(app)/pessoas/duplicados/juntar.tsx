"use client";

import { useState, useTransition } from "react";
import { Merge } from "lucide-react";
import { classeBotao } from "@/components/ui";
import { juntarPessoas } from "../actions";

/** Escolhe qual cadastro fica e junta os outros nele. */
export function JuntarGrupo({ itens }: { itens: { id: string; nome: string; detalhe: string }[] }) {
  const [manter, setManter] = useState(itens[0].id);
  const [rodando, iniciar] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      <ul className="space-y-2">
        {itens.map((i) => (
          <li key={i.id}>
            <label className="flex cursor-pointer items-start gap-3 rounded-[12px] border border-borda px-3 py-2 text-sm has-[:checked]:border-acento has-[:checked]:bg-acento-bg">
              <input type="radio" name={`manter-${itens[0].id}`} checked={manter === i.id} onChange={() => setManter(i.id)} className="mt-1" />
              <span className="min-w-0">
                <a href={`/pessoas/${i.id}`} target="_blank" rel="noreferrer" className="font-semibold text-acento hover:underline">
                  {i.nome}
                </a>
                <span className="block truncate text-xs text-mudo">{i.detalhe}</span>
              </span>
              {manter === i.id && <span className="ml-auto text-xs font-semibold text-acento-hot">fica</span>}
            </label>
          </li>
        ))}
      </ul>
      {msg && <p className="text-sm text-ruim">{msg}</p>}
      <button
        type="button"
        disabled={rodando}
        className={classeBotao("primario", "sm")}
        onClick={() => {
          const nomeManter = itens.find((i) => i.id === manter)?.nome;
          if (!window.confirm(`Juntar tudo em "${nomeManter}"? Os outros cadastros serão apagados e os contratos, imóveis, documentos e históricos passam para ele.`)) return;
          setMsg(null);
          iniciar(async () => {
            for (const i of itens) {
              if (i.id === manter) continue;
              const r = await juntarPessoas(manter, i.id);
              if (!r.ok) {
                setMsg(r.erro ?? "Não foi possível juntar.");
                return;
              }
            }
          });
        }}
      >
        <Merge className="size-3.5" /> {rodando ? "Juntando…" : "Juntar no marcado"}
      </button>
    </div>
  );
}
