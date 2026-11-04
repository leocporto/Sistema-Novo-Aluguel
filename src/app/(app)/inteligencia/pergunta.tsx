"use client";

import { useActionState, useState } from "react";
import { Sparkles } from "lucide-react";
import { BotaoEnviar } from "@/components/formulario";
import { Aviso, classeBotao } from "@/components/ui";
import { perguntar, type EstadoPergunta } from "./actions";
import { SeloOrigem, TabelaConsulta } from "./componentes";

/** Assistente interno: pergunta em português → uma consulta segura → resposta com a fonte. */
export function Pergunta({ exemplos }: { exemplos: string[] }) {
  const [estado, executar] = useActionState<EstadoPergunta, FormData>(perguntar, {});
  const [texto, setTexto] = useState("");
  return (
    <div className="space-y-4">
      <form action={executar} className="space-y-3">
        <label className="flex flex-col gap-1.5">
          <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-mudo">Sua pergunta</span>
          <textarea
            name="pergunta"
            rows={2}
            maxLength={500}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="Ex.: quanto recebi de aluguel em outubro?"
            className="w-full min-h-[46px] rounded-btn border border-borda-forte bg-input px-3.5 py-2.5 text-[15px] text-texto outline-none transition placeholder:text-fraco focus:border-acento focus:ring-4 focus:ring-acento-bg"
          />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <BotaoEnviar>
            <Sparkles className="size-4" /> Perguntar
          </BotaoEnviar>
          {exemplos.map((e) => (
            <button key={e} type="button" className={classeBotao("fantasma", "sm")} onClick={() => setTexto(e)}>
              {e}
            </button>
          ))}
        </div>
      </form>
      {estado.erro && <Aviso tipo="erro">{estado.erro}</Aviso>}
      {estado.aviso && <Aviso tipo="alerta">{estado.aviso}</Aviso>}
      {estado.resultado && (
        <div className="space-y-3 rounded-card border border-borda bg-card p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-[15px] font-semibold text-texto">{estado.resultado.titulo}</h3>
            <SeloOrigem usouIA={!!estado.usouIA} />
          </div>
          {estado.entendi && <p className="text-xs text-mudo">Entendi: {estado.entendi}</p>}
          {estado.explicacao && <p className="text-[14px] leading-relaxed text-texto">{estado.explicacao}</p>}
          <TabelaConsulta r={estado.resultado} />
        </div>
      )}
    </div>
  );
}
