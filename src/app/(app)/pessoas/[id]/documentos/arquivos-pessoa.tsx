"use client";

import { useRef, useState, useTransition, type DragEvent } from "react";
import { FileText, Upload } from "lucide-react";
import { BotaoExcluir } from "@/components/botao-excluir";
import { enviarArquivoPessoa } from "@/lib/supabase/navegador";
import { excluirArquivoPessoa, linkArquivoPessoa, registrarArquivoPessoa } from "../../actions";

export type ArquivoPessoa = { id: string; nome: string | null; categoria: string; criado: string };

/** Envio de documentos da pessoa por categoria + lista para abrir e excluir. */
export function ArquivosPessoa({
  organizacaoId,
  pessoaId,
  arquivos,
  categorias,
  sugerida,
}: {
  organizacaoId: string;
  pessoaId: string;
  arquivos: ArquivoPessoa[];
  categorias: string[];
  sugerida?: string;
}) {
  const entrada = useRef<HTMLInputElement>(null);
  const [categoria, setCategoria] = useState(sugerida ?? categorias[0]);
  const [enviando, setEnviando] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [sobre, setSobre] = useState(false);
  const [, iniciar] = useTransition();

  const enviar = async (lista: FileList | File[]) => {
    const fs = [...lista];
    if (!fs.length) return;
    setErro(null);
    const falhas: string[] = [];
    for (let i = 0; i < fs.length; i++) {
      setEnviando(`Enviando ${i + 1} de ${fs.length}…`);
      try {
        const path = await enviarArquivoPessoa(organizacaoId, pessoaId, fs[i]);
        const r = await registrarArquivoPessoa({ pessoaId, path, nome: fs[i].name, categoria });
        if (!r.ok) falhas.push(r.erro ?? fs[i].name);
      } catch (e) {
        falhas.push(e instanceof Error ? e.message : fs[i].name);
      }
    }
    setEnviando(null);
    if (falhas.length) setErro(falhas.join(" · "));
    if (entrada.current) entrada.current.value = "";
  };

  const abrir = (id: string) =>
    iniciar(async () => {
      const r = await linkArquivoPessoa(id);
      if (r.ok && r.url) window.open(r.url, "_blank");
      else setErro(r.erro ?? "Não foi possível abrir.");
    });

  return (
    <div className="space-y-4">
      <label className="flex max-w-sm flex-col gap-1.5">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-mudo">Tipo de documento</span>
        <select value={categoria} onChange={(e) => setCategoria(e.target.value)} className="min-h-10 rounded-btn border border-borda-forte bg-input px-3 text-sm text-texto">
          {categorias.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </label>
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
        className={`flex w-full flex-col items-center justify-center gap-2 rounded-card border-2 border-dashed px-4 py-8 text-sm transition ${sobre ? "border-acento bg-acento-bg text-acento-hot" : "border-borda-forte text-texto-2 hover:border-acento hover:text-acento-hot"}`}
      >
        <Upload className="size-6" />
        {enviando ?? (
          <>
            <span className="font-semibold">Clique ou arraste o arquivo de “{categoria}”</span>
            <span className="text-xs text-mudo">Imagem (JPG, PNG) ou PDF até 10 MB</span>
          </>
        )}
      </button>
      <input ref={entrada} type="file" multiple accept="image/*,application/pdf" className="hidden" onChange={(e) => e.target.files && void enviar(e.target.files)} />
      {erro && <div className="rounded-[14px] border border-ruim-bd bg-ruim-bg px-4 py-2.5 text-sm text-ruim">{erro}</div>}
      {arquivos.length === 0 ? (
        <p className="text-sm text-mudo">Nenhum documento enviado.</p>
      ) : (
        <ul className="divide-y divide-borda-suave overflow-hidden rounded-card border border-borda bg-card">
          {arquivos.map((a) => (
            <li key={a.id} className="flex items-center gap-3 px-4 py-3">
              <FileText className="size-5 shrink-0 text-mudo" />
              <button type="button" onClick={() => abrir(a.id)} className="min-w-0 flex-1 text-left">
                <div className="truncate font-medium text-texto hover:underline">{a.nome ?? "arquivo"}</div>
                <div className="text-xs text-mudo">
                  {a.categoria} · enviado em {a.criado}
                </div>
              </button>
              <BotaoExcluir acao={excluirArquivoPessoa} id={a.id} rotulo="Excluir documento" confirmar={`Excluir "${a.nome ?? "documento"}"?`} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
