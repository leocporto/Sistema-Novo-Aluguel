"use client";

import { useRef, useState, useTransition, type DragEvent } from "react";
import { useRouter } from "next/navigation";
import { FileText, Upload } from "lucide-react";
import { BotaoExcluir } from "@/components/botao-excluir";
import { excluirArquivo, linkArquivo, registrarArquivo } from "../../actions";
import { enviarArquivoAnalise } from "../../envio";

/** Botão que abre um arquivo da análise (link temporário de 5 minutos). */
export function AbrirArquivo({ id, nome, ficha }: { id: string; nome: string; ficha?: boolean }) {
  const [, iniciar] = useTransition();
  return (
    <button
      type="button"
      onClick={() =>
        iniciar(async () => {
          const r = await linkArquivo(id);
          if (r.ok && r.url) window.open(r.url, "_blank");
          else window.alert(r.erro ?? "Não foi possível abrir.");
        })
      }
      className="inline-flex max-w-full items-center gap-1.5 truncate text-left text-xs text-acento hover:underline"
    >
      <FileText className="size-3.5 shrink-0" />
      <span className="truncate">{nome}</span>
      {ficha && <span className="shrink-0 text-mudo">(pelo candidato)</span>}
    </button>
  );
}

export type ArquivoSolto = { id: string; nome: string; criado: string; ficha: boolean };

/** Envio de documentos (escolhe o item do checklist) + arquivos sem item. */
export function EnvioDocumentos({
  pasta,
  analiseId,
  itens,
  soltos,
}: {
  pasta: string;
  analiseId: string;
  itens: { id: string; rotulo: string }[];
  soltos: ArquivoSolto[];
}) {
  const entrada = useRef<HTMLInputElement>(null);
  const [item, setItem] = useState("");
  const [enviando, setEnviando] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [sobre, setSobre] = useState(false);
  const router = useRouter();

  const enviar = async (lista: FileList | File[]) => {
    const fs = [...lista];
    if (!fs.length) return;
    setErro(null);
    const falhas: string[] = [];
    for (let i = 0; i < fs.length; i++) {
      setEnviando(`Enviando ${i + 1} de ${fs.length}…`);
      try {
        const path = await enviarArquivoAnalise(pasta, fs[i]);
        const r = await registrarArquivo({ analiseId, path, nome: fs[i].name, documentoId: item || null });
        if (!r.ok) falhas.push(r.erro ?? fs[i].name);
      } catch (e) {
        falhas.push(e instanceof Error ? e.message : fs[i].name);
      }
    }
    setEnviando(null);
    if (falhas.length) setErro(falhas.join(" · "));
    if (entrada.current) entrada.current.value = "";
    router.refresh();
  };

  return (
    <div className="space-y-4">
      <label className="flex flex-col gap-1.5">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-mudo">Qual documento é</span>
        <select value={item} onChange={(e) => setItem(e.target.value)} className="min-h-10 rounded-btn border border-borda-forte bg-input px-3 text-sm text-texto">
          <option value="">— outro / sem item do checklist —</option>
          {itens.map((i) => (
            <option key={i.id} value={i.id}>
              {i.rotulo}
            </option>
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
        className={`flex w-full flex-col items-center justify-center gap-2 rounded-card border-2 border-dashed px-4 py-7 text-sm transition ${sobre ? "border-acento bg-acento-bg text-acento-hot" : "border-borda-forte text-texto-2 hover:border-acento hover:text-acento-hot"}`}
      >
        <Upload className="size-6" />
        {enviando ?? (
          <>
            <span className="font-semibold">Clique ou arraste os arquivos</span>
            <span className="text-xs text-mudo">Foto (JPG, PNG) ou PDF até 10 MB</span>
          </>
        )}
      </button>
      <input ref={entrada} type="file" multiple accept="image/*,application/pdf" className="hidden" onChange={(e) => e.target.files && void enviar(e.target.files)} />
      {erro && <div className="rounded-[14px] border border-ruim-bd bg-ruim-bg px-4 py-2.5 text-sm text-ruim">{erro}</div>}
      {soltos.length > 0 && (
        <div>
          <div className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-mudo">Arquivos sem item do checklist</div>
          <ul className="divide-y divide-borda-suave overflow-hidden rounded-card border border-borda bg-card">
            {soltos.map((a) => (
              <li key={a.id} className="flex items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <AbrirArquivo id={a.id} nome={a.nome} ficha={a.ficha} />
                  <div className="text-xs text-mudo">{a.criado}</div>
                </div>
                <BotaoExcluir acao={excluirArquivo} id={a.id} rotulo="Excluir arquivo" confirmar={`Excluir "${a.nome}"?`} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
