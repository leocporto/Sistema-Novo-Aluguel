"use client";

import { useRef, useState, type DragEvent } from "react";
import { Film, Upload } from "lucide-react";
import { AbasSegmentadas } from "@/components/abas-segmentadas";
import { BotaoExcluir } from "@/components/botao-excluir";
import { enviarMidiaChamado, tipoDaMidia } from "@/lib/supabase/manutencao";
import { excluirMidia, registrarMidia } from "../actions";

export type Midia = { id: string; nome: string | null; tipo: string; momento: string; enviadoPor: string; url: string | null; criado: string };

const MOMENTOS: Record<string, string> = { antes: "Antes (o problema)", depois: "Depois (serviço pronto)", orcamento: "Orçamento / nota" };

/** Envio de fotos e vídeos do chamado + galeria (antes, depois, orçamento). */
export function MidiasChamado({ organizacaoId, chamadoId, midias, momentoInicial = "antes" }: { organizacaoId: string; chamadoId: string; midias: Midia[]; momentoInicial?: string }) {
  const entrada = useRef<HTMLInputElement>(null);
  const [momento, setMomento] = useState(momentoInicial);
  const [enviando, setEnviando] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [sobre, setSobre] = useState(false);

  const enviar = async (lista: FileList | File[]) => {
    const fs = [...lista];
    if (!fs.length) return;
    setErro(null);
    const falhas: string[] = [];
    for (let i = 0; i < fs.length; i++) {
      setEnviando(`Enviando ${i + 1} de ${fs.length}…`);
      try {
        const path = await enviarMidiaChamado(`${organizacaoId}/${chamadoId}`, fs[i]);
        const r = await registrarMidia({ chamadoId, path, nome: fs[i].name, tipo: tipoDaMidia(fs[i]), momento });
        if (!r.ok) falhas.push(r.erro ?? fs[i].name);
      } catch (e) {
        falhas.push(e instanceof Error ? e.message : fs[i].name);
      }
    }
    setEnviando(null);
    if (falhas.length) setErro(falhas.join(" · "));
    if (entrada.current) entrada.current.value = "";
  };

  const grupos = Object.keys(MOMENTOS)
    .map((m) => ({ m, itens: midias.filter((x) => x.momento === m) }))
    .filter((g) => g.itens.length);

  return (
    <div className="space-y-4">
      <AbasSegmentadas variante="seg" valor={momento} aoMudar={setMomento} rotuloAcessivel="Momento das fotos" itens={Object.entries(MOMENTOS).map(([id, rotulo]) => ({ id, rotulo }))} />
      <button
        type="button"
        onClick={() => entrada.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setSobre(true);
        }}
        onDragLeave={() => setSobre(false)}
        onDrop={(e: DragEvent) => {
          e.preventDefault();
          setSobre(false);
          void enviar(e.dataTransfer.files);
        }}
        disabled={Boolean(enviando)}
        className={`flex w-full flex-col items-center justify-center gap-2 rounded-card border-2 border-dashed px-4 py-7 text-sm transition ${sobre ? "border-acento bg-acento-bg text-acento-hot" : "border-borda-forte text-texto-2 hover:border-acento hover:text-acento-hot"}`}
      >
        <Upload className="size-6" />
        {enviando ?? (
          <>
            <span className="font-semibold">Clique ou arraste fotos e vídeos ({MOMENTOS[momento].toLowerCase()})</span>
            <span className="text-xs text-mudo">Foto até 10 MB · vídeo (MP4, MOV) até 50 MB</span>
          </>
        )}
      </button>
      <input ref={entrada} type="file" multiple accept="image/*,video/mp4,video/quicktime,video/webm" className="hidden" aria-label="Escolher fotos e vídeos" onChange={(e) => e.target.files && void enviar(e.target.files)} />
      {erro && <div className="rounded-[14px] border border-ruim-bd bg-ruim-bg px-4 py-2.5 text-sm text-ruim">{erro}</div>}
      {grupos.length === 0 ? (
        <p className="text-sm text-mudo">Nenhuma foto ou vídeo ainda.</p>
      ) : (
        grupos.map((g) => (
          <div key={g.m}>
            <div className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-mudo">
              {MOMENTOS[g.m]} ({g.itens.length})
            </div>
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {g.itens.map((a) => (
                <li key={a.id} className="group relative overflow-hidden rounded-[14px] border border-borda bg-elev">
                  <a href={a.url ?? "#"} target="_blank" rel="noreferrer" className="block aspect-[4/3]" title={a.nome ?? ""}>
                    {a.tipo === "video" ? (
                      <span className="flex size-full flex-col items-center justify-center gap-1 text-mudo">
                        <Film className="size-7" />
                        <span className="px-2 text-center text-xs">abrir vídeo</span>
                      </span>
                    ) : a.url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={a.url} alt={a.nome ?? "foto do chamado"} className="size-full object-cover" loading="lazy" />
                    ) : (
                      <span className="flex size-full items-center justify-center text-xs text-mudo">sem prévia</span>
                    )}
                  </a>
                  <div className="flex items-center justify-between gap-2 px-2.5 py-2 text-[11px] text-mudo">
                    <span className="truncate">
                      {a.enviadoPor === "locatario" ? "pelo locatário · " : ""}
                      {a.criado}
                    </span>
                    <BotaoExcluir acao={excluirMidia} id={a.id} rotulo="Excluir arquivo" confirmar={`Excluir "${a.nome ?? "arquivo"}"?`} />
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </div>
  );
}
