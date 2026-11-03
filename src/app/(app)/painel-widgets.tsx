"use client";

import { useMemo, useState, useTransition, type DragEvent, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, Eye, EyeOff, GripVertical, RotateCcw, SlidersHorizontal } from "lucide-react";
import { classeBotao } from "@/components/ui";
import { aplicarPreferencia } from "@/lib/dominio/painel";
import { salvarPreferenciaPainel, type PreferenciaPainel } from "./painel-actions";

export type Quadro = {
  id: string;
  titulo: string;
  /** 1 = indicador; 2 = cartão médio; 4 = linha inteira. */
  largura: 1 | 2 | 4;
  conteudo: ReactNode;
};

const SPAN = { 1: "", 2: "sm:col-span-2", 4: "sm:col-span-2 xl:col-span-4" } as const;

/** Grade do Painel: cada usuário mostra/esconde e arrasta os quadros (salvo na conta). */
export function PainelWidgets({ quadros, preferencia }: { quadros: Quadro[]; preferencia: PreferenciaPainel | null }) {
  const padrao = useMemo(() => quadros.map((q) => q.id), [quadros]);
  const porId = useMemo(() => new Map(quadros.map((q) => [q.id, q])), [quadros]);
  const inicial = aplicarPreferencia(padrao, preferencia);
  const [ordem, setOrdem] = useState<string[]>([...inicial.visiveis, ...inicial.ocultos]);
  const [ocultos, setOcultos] = useState<Set<string>>(new Set(inicial.ocultos));
  const [editando, setEditando] = useState(false);
  const [arrastando, setArrastando] = useState<string | null>(null);
  const [salvando, iniciar] = useTransition();
  const [erro, setErro] = useState<string | null>(null);

  // Quadros que deixaram de existir (ex.: troca de modo) saem; novos entram na posição padrão.
  const ids = aplicarPreferencia(padrao, { ordem, ocultos: [...ocultos] });
  const lista = editando ? [...ids.visiveis, ...ids.ocultos] : ids.visiveis;

  const mover = (id: string, para: number) => {
    setOrdem((o) => {
      const base = aplicarPreferencia(padrao, { ordem: o, ocultos: [] }).visiveis;
      const sem = base.filter((x) => x !== id);
      sem.splice(Math.max(0, Math.min(para, sem.length)), 0, id);
      return sem;
    });
  };
  const deslocar = (id: string, passo: number) => {
    const atual = lista.indexOf(id);
    const alvo = lista[atual + passo];
    if (!alvo) return;
    const base = aplicarPreferencia(padrao, { ordem, ocultos: [] }).visiveis;
    mover(id, base.indexOf(alvo));
  };
  const alternar = (id: string) =>
    setOcultos((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const salvar = (pref: PreferenciaPainel | null) => {
    setErro(null);
    iniciar(async () => {
      const r = await salvarPreferenciaPainel(pref);
      if (!r.ok) setErro(r.erro ?? "Não foi possível salvar.");
      else setEditando(false);
    });
  };

  const aoSoltar = (e: DragEvent, alvo: string) => {
    e.preventDefault();
    if (!arrastando || arrastando === alvo) return;
    const base = aplicarPreferencia(padrao, { ordem, ocultos: [] }).visiveis;
    mover(arrastando, base.indexOf(alvo));
  };

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-end gap-2">
        {editando ? (
          <>
            <span className="mr-auto text-sm text-texto-2">
              Arraste os quadros pela alça <GripVertical className="inline size-4" /> para mudar a ordem e use o olho para mostrar ou esconder.
            </span>
            {erro && <span className="text-sm text-ruim">{erro}</span>}
            <button
              type="button"
              className={classeBotao("fantasma")}
              onClick={() => {
                setOrdem(padrao);
                setOcultos(new Set());
                salvar(null);
              }}
            >
              <RotateCcw className="size-4" /> Restaurar padrão
            </button>
            <button type="button" className={classeBotao("primario")} disabled={salvando} onClick={() => salvar({ ordem: lista, ocultos: [...ocultos] })}>
              {salvando ? "Salvando…" : "Concluir"}
            </button>
          </>
        ) : (
          <button type="button" className={classeBotao("secundario")} onClick={() => setEditando(true)}>
            <SlidersHorizontal className="size-4" /> Personalizar painel
          </button>
        )}
      </div>

      <div className="entrar-cascata grid grid-flow-row-dense grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {lista.map((id) => {
          const q = porId.get(id);
          if (!q) return null;
          const escondido = ocultos.has(id);
          return (
            <div
              key={id}
              className={`relative ${SPAN[q.largura]} ${editando ? "rounded-card outline-2 outline-offset-2 outline-dashed outline-borda-forte" : ""} ${escondido ? "opacity-40" : ""} ${arrastando === id ? "opacity-60" : ""}`}
              draggable={editando}
              onDragStart={(e) => {
                setArrastando(id);
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragEnd={() => setArrastando(null)}
              onDragOver={(e) => editando && e.preventDefault()}
              onDrop={(e) => aoSoltar(e, id)}
            >
              {editando && (
                <div className="absolute right-2 top-2 z-10 flex items-center gap-1 rounded-[10px] border border-borda bg-card p-1 shadow-lg">
                  <span className="grid size-7 cursor-grab place-items-center text-mudo" title="Arrastar">
                    <GripVertical className="size-4" />
                  </span>
                  <button type="button" onClick={() => deslocar(id, -1)} className="grid size-7 place-items-center rounded-md text-mudo hover:bg-card-hover hover:text-texto" aria-label={`Mover ${q.titulo} para trás`}>
                    <ArrowLeft className="size-4" />
                  </button>
                  <button type="button" onClick={() => deslocar(id, 1)} className="grid size-7 place-items-center rounded-md text-mudo hover:bg-card-hover hover:text-texto" aria-label={`Mover ${q.titulo} para frente`}>
                    <ArrowRight className="size-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => alternar(id)}
                    className={`grid size-7 place-items-center rounded-md hover:bg-card-hover ${escondido ? "text-mudo" : "text-acento"}`}
                    aria-label={escondido ? `Mostrar ${q.titulo}` : `Esconder ${q.titulo}`}
                    title={escondido ? "Mostrar" : "Esconder"}
                  >
                    {escondido ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              )}
              <div className={`h-full ${editando ? "pointer-events-none select-none" : ""}`}>{q.conteudo}</div>
            </div>
          );
        })}
      </div>
      {!editando && ids.ocultos.length > 0 && (
        <p className="mt-4 text-center text-xs text-mudo">
          {ids.ocultos.length} quadro(s) escondido(s).{" "}
          <button type="button" className="text-acento hover:underline" onClick={() => setEditando(true)}>
            Personalizar
          </button>
        </p>
      )}
    </>
  );
}
