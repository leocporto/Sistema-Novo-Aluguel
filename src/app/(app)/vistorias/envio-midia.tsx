"use client";

import { useRef, useState, type DragEvent } from "react";
import { Upload } from "lucide-react";
import { registrarMidia } from "./actions";
import { caminhoMidia, carimboFoto, ehVideo, enviarMidiaVistoria, prepararFoto, validarMidia } from "./arquivo-cliente";

export type AmbienteEnvio = { id: string; nome: string; itens: { id: string; nome: string }[] };

const campo = "min-h-10 w-full rounded-btn border border-borda-forte bg-input px-3 text-sm text-texto";

/**
 * Envio de fotos e vídeos da vistoria, com ambiente, item e legenda.
 * Fotos saem reduzidas e com data/hora e ambiente gravados na imagem.
 */
export function EnvioMidia({
  organizacaoId,
  vistoriaId,
  ambientes,
  ambienteFixo,
  medidorId,
  rotulo = "Clique ou arraste fotos e vídeos",
}: {
  organizacaoId: string;
  vistoriaId: string;
  ambientes: AmbienteEnvio[];
  ambienteFixo?: string;
  medidorId?: string;
  rotulo?: string;
}) {
  const entrada = useRef<HTMLInputElement>(null);
  const [ambiente, setAmbiente] = useState(ambienteFixo ?? "");
  const [item, setItem] = useState("");
  const [legenda, setLegenda] = useState("");
  const [enviando, setEnviando] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [sobre, setSobre] = useState(false);
  const amb = ambientes.find((a) => a.id === ambiente);

  const enviar = async (lista: FileList | File[]) => {
    const fs = [...lista];
    if (!fs.length) return;
    setErro(null);
    const falhas: string[] = [];
    for (let i = 0; i < fs.length; i++) {
      setEnviando(`Enviando ${i + 1} de ${fs.length}…`);
      const f = fs[i];
      const invalido = validarMidia(f);
      if (invalido) {
        falhas.push(invalido);
        continue;
      }
      try {
        const nomeItem = amb?.itens.find((x) => x.id === item)?.nome;
        // A data e a hora da foto (não a do envio) vão na imagem e no registro do laudo.
        const quando = f.lastModified ? new Date(f.lastModified) : new Date();
        const p = await prepararFoto(f, carimboFoto([amb?.nome, nomeItem], quando));
        const id = crypto.randomUUID();
        const path = await enviarMidiaVistoria(caminhoMidia(organizacaoId, vistoriaId, id, p.nome), p.blob, p.mime);
        const r = await registrarMidia({
          id,
          vistoriaId,
          path,
          tipo: ehVideo(p.mime) ? "video" : "foto",
          nome: f.name,
          ambienteId: ambiente || null,
          itemId: item || null,
          medidorId: medidorId ?? null,
          legenda: legenda || null,
          tiradaEm: quando.toISOString(),
        });
        if (!r.ok) falhas.push(r.erro ?? f.name);
      } catch (e) {
        falhas.push(e instanceof Error ? e.message : f.name);
      }
    }
    setEnviando(null);
    setLegenda("");
    if (falhas.length) setErro(falhas.join(" · "));
    if (entrada.current) entrada.current.value = "";
  };

  return (
    <div className="space-y-3">
      {!medidorId && (
        <div className="grid gap-3 sm:grid-cols-3">
          {!ambienteFixo && (
            <select aria-label="Ambiente da foto" value={ambiente} onChange={(e) => {
                setAmbiente(e.target.value);
                setItem("");
              }} className={campo}>
              <option value="">Ambiente: geral</option>
              {ambientes.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.nome}
                </option>
              ))}
            </select>
          )}
          <select aria-label="Item da foto" value={item} onChange={(e) => setItem(e.target.value)} className={campo} disabled={!amb}>
            <option value="">Item: todo o ambiente</option>
            {amb?.itens.map((i) => (
              <option key={i.id} value={i.id}>
                {i.nome}
              </option>
            ))}
          </select>
          <input aria-label="Legenda" value={legenda} onChange={(e) => setLegenda(e.target.value)} placeholder="Legenda (ex.: mancha no teto)" className={campo} />
        </div>
      )}
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
        className={`flex w-full flex-col items-center justify-center gap-2 rounded-card border-2 border-dashed px-4 py-6 text-sm transition ${sobre ? "border-acento bg-acento-bg text-acento-hot" : "border-borda-forte text-texto-2 hover:border-acento hover:text-acento-hot"}`}
      >
        <Upload className="size-5" />
        {enviando ?? (
          <>
            <span className="font-semibold">{rotulo}</span>
            <span className="text-xs text-mudo">Fotos (JPG, PNG, HEIC) e vídeos (MP4, MOV) até 50 MB</span>
          </>
        )}
      </button>
      <input ref={entrada} type="file" multiple accept="image/*,video/*" className="hidden" onChange={(e) => e.target.files && void enviar(e.target.files)} />
      {erro && <div className="rounded-[14px] border border-ruim-bd bg-ruim-bg px-4 py-2.5 text-sm text-ruim">{erro}</div>}
    </div>
  );
}
