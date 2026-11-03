"use client";

import { useRef, useState, useTransition, type DragEvent } from "react";
import { ArrowLeft, ArrowRight, FileText, Star, Trash2, Upload } from "lucide-react";
import { TIPOS_ARQUIVO_IMOVEL, enviarArquivoImovel } from "@/lib/supabase/navegador";
import { definirCapa, excluirArquivo, linkArquivo, moverArquivo, registrarArquivo } from "../actions";

export type ArquivoImovel = { id: string; nome: string | null; url: string | null; capa: boolean; categoria: string | null; ehPdf: boolean };

/** Área de envio (clique ou arraste vários arquivos) + grade com capa, ordem e exclusão. */
export function GaleriaImovel({
  organizacaoId,
  imovelId,
  tipo,
  arquivos,
  categorias,
  vazio,
}: {
  organizacaoId: string;
  imovelId: string;
  tipo: "foto" | "planta" | "documento" | "autorizacao";
  arquivos: ArquivoImovel[];
  /** Para documentos: escolhe a categoria antes de enviar. */
  categorias?: string[];
  vazio: string;
}) {
  const entrada = useRef<HTMLInputElement>(null);
  const [categoria, setCategoria] = useState(categorias?.[0] ?? "");
  const [enviando, setEnviando] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [sobre, setSobre] = useState(false);
  const [, iniciar] = useTransition();
  const ehGrade = tipo === "foto" || tipo === "planta";

  const enviar = async (lista: FileList | File[]) => {
    const arquivosEnviar = [...lista];
    if (!arquivosEnviar.length) return;
    setErro(null);
    const falhas: string[] = [];
    for (let i = 0; i < arquivosEnviar.length; i++) {
      const f = arquivosEnviar[i];
      setEnviando(`Enviando ${i + 1} de ${arquivosEnviar.length}…`);
      try {
        const path = await enviarArquivoImovel(organizacaoId, imovelId, f);
        const r = await registrarArquivo({ imovelId, tipo, path, nome: f.name, categoria: categorias ? categoria : null });
        if (!r.ok) falhas.push(r.erro ?? f.name);
      } catch (e) {
        falhas.push(e instanceof Error ? e.message : f.name);
      }
    }
    setEnviando(null);
    if (falhas.length) setErro(falhas.join(" · "));
    if (entrada.current) entrada.current.value = "";
  };

  const aoSoltar = (e: DragEvent) => {
    e.preventDefault();
    setSobre(false);
    void enviar(e.dataTransfer.files);
  };

  const rodar = (fn: () => Promise<{ ok: boolean; erro?: string }>) =>
    iniciar(async () => {
      const r = await fn();
      if (!r.ok) setErro(r.erro ?? "Não foi possível concluir.");
    });

  const abrir = (id: string) =>
    iniciar(async () => {
      const r = await linkArquivo(id);
      if (r.ok && r.url) window.open(r.url, "_blank");
      else setErro(r.erro ?? "Não foi possível abrir.");
    });

  const aceita = tipo === "foto" ? "image/*" : TIPOS_ARQUIVO_IMOVEL.join(",");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        {categorias && (
          <label className="flex flex-col gap-1.5">
            <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-mudo">Tipo de documento</span>
            <select
              value={categoria}
              onChange={(e) => setCategoria(e.target.value)}
              className="min-h-10 rounded-btn border border-borda-forte bg-input px-3 text-sm text-texto"
            >
              {categorias.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
        )}
      </div>
      <button
        type="button"
        onClick={() => entrada.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setSobre(true);
        }}
        onDragLeave={() => setSobre(false)}
        onDrop={aoSoltar}
        disabled={Boolean(enviando)}
        className={`flex w-full flex-col items-center justify-center gap-2 rounded-card border-2 border-dashed px-4 py-8 text-sm transition ${sobre ? "border-acento bg-acento-bg text-acento-hot" : "border-borda-forte text-texto-2 hover:border-acento hover:text-acento-hot"}`}
      >
        <Upload className="size-6" />
        {enviando ?? (
          <>
            <span className="font-semibold">Clique ou arraste os arquivos aqui</span>
            <span className="text-xs text-mudo">{tipo === "foto" ? "Várias fotos de uma vez (JPG, PNG, WEBP) até 25 MB cada" : "Imagem ou PDF até 25 MB"}</span>
          </>
        )}
      </button>
      <input ref={entrada} type="file" multiple accept={aceita} className="hidden" onChange={(e) => e.target.files && void enviar(e.target.files)} />
      {erro && <div className="rounded-[14px] border border-ruim-bd bg-ruim-bg px-4 py-2.5 text-sm text-ruim">{erro}</div>}

      {arquivos.length === 0 ? (
        <p className="text-sm text-mudo">{vazio}</p>
      ) : ehGrade ? (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
          {arquivos.map((a, i) => (
            <li key={a.id} className={`group relative overflow-hidden rounded-[14px] border bg-elev ${a.capa ? "border-acento ring-2 ring-acento-bg" : "border-borda"}`}>
              <button type="button" onClick={() => abrir(a.id)} className="block aspect-[4/3] w-full">
                {a.url && !a.ehPdf ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={a.url} alt={a.nome ?? ""} className="size-full object-cover" loading="lazy" />
                ) : (
                  <span className="grid size-full place-items-center text-mudo">
                    <FileText className="size-8" />
                  </span>
                )}
              </button>
              {a.capa && <span className="absolute left-2 top-2 rounded-full bg-acento px-2 py-0.5 text-[11px] font-semibold text-white">Capa</span>}
              <div className="flex items-center justify-between gap-1 border-t border-borda bg-card px-1.5 py-1">
                <div className="flex">
                  <button type="button" disabled={i === 0} onClick={() => rodar(() => moverArquivo(a.id, -1))} className="grid size-7 place-items-center rounded-md text-mudo hover:bg-card-hover disabled:opacity-30" aria-label="Mover para trás">
                    <ArrowLeft className="size-4" />
                  </button>
                  <button type="button" disabled={i === arquivos.length - 1} onClick={() => rodar(() => moverArquivo(a.id, 1))} className="grid size-7 place-items-center rounded-md text-mudo hover:bg-card-hover disabled:opacity-30" aria-label="Mover para frente">
                    <ArrowRight className="size-4" />
                  </button>
                </div>
                <div className="flex">
                  {tipo === "foto" && !a.capa && (
                    <button type="button" onClick={() => rodar(() => definirCapa(a.id))} className="grid size-7 place-items-center rounded-md text-mudo hover:bg-card-hover hover:text-acento" title="Usar como capa" aria-label="Usar como capa">
                      <Star className="size-4" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => window.confirm("Excluir este arquivo?") && rodar(() => excluirArquivo(a.id))}
                    className="grid size-7 place-items-center rounded-md text-mudo hover:bg-ruim-bg hover:text-ruim"
                    aria-label="Excluir"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="divide-y divide-borda-suave overflow-hidden rounded-card border border-borda bg-card">
          {arquivos.map((a) => (
            <li key={a.id} className="flex items-center gap-3 px-4 py-3">
              <FileText className="size-5 shrink-0 text-mudo" />
              <button type="button" onClick={() => abrir(a.id)} className="min-w-0 flex-1 text-left">
                <div className="truncate font-medium text-texto hover:underline">{a.nome ?? "arquivo"}</div>
                {a.categoria && <div className="text-xs text-mudo">{a.categoria}</div>}
              </button>
              <button
                type="button"
                onClick={() => window.confirm("Excluir este documento?") && rodar(() => excluirArquivo(a.id))}
                className="grid size-8 place-items-center rounded-[9px] text-mudo hover:bg-ruim-bg hover:text-ruim"
                aria-label="Excluir documento"
              >
                <Trash2 className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
