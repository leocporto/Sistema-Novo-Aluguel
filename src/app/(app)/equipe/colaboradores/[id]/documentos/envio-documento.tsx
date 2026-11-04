"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileText, Upload } from "lucide-react";
import { classeBotao } from "@/components/ui";
import { TIPOS_DOCUMENTO_PROFISSIONAL } from "@/lib/dominio/equipe";
import { linkDocumento, registrarDocumento } from "../../../actions";
import { enviarDocumentoEquipe } from "../../../envio";

/** Abre o arquivo do documento (link temporário de 5 minutos). */
export function AbrirDocumento({ id, nome }: { id: string; nome: string }) {
  const [, iniciar] = useTransition();
  return (
    <button
      type="button"
      onClick={() =>
        iniciar(async () => {
          const r = await linkDocumento(id);
          if (r.ok && r.url) window.open(r.url, "_blank");
          else window.alert(r.erro ?? "Não foi possível abrir.");
        })
      }
      className="inline-flex max-w-full items-center gap-1.5 truncate text-left text-xs text-acento hover:underline"
    >
      <FileText className="size-3.5 shrink-0" />
      <span className="truncate">{nome}</span>
    </button>
  );
}

const rotulo = "font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-mudo";
const campo = "min-h-10 w-full rounded-btn border border-borda-forte bg-input px-3 text-sm text-texto";

/** Novo documento profissional: tipo, número, emissão, validade e arquivo (opcional). */
export function NovoDocumento({ pessoaId, pasta }: { pessoaId: string; pasta: string }) {
  const entrada = useRef<HTMLInputElement>(null);
  const [tipo, setTipo] = useState(TIPOS_DOCUMENTO_PROFISSIONAL[0]);
  const [numero, setNumero] = useState("");
  const [emissao, setEmissao] = useState("");
  const [validade, setValidade] = useState("");
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const router = useRouter();

  const salvar = async () => {
    setErro(null);
    setEnviando(true);
    try {
      const path = arquivo ? await enviarDocumentoEquipe(pasta, arquivo) : null;
      const r = await registrarDocumento({ pessoaId, tipo, numero: numero || null, emissao: emissao || null, validade: validade || null, path, nome: arquivo?.name ?? null });
      if (!r.ok) throw new Error(r.erro ?? "Não foi possível salvar.");
      setNumero("");
      setEmissao("");
      setValidade("");
      setArquivo(null);
      if (entrada.current) entrada.current.value = "";
      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível salvar.");
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-4">
        <label className="flex flex-col gap-1.5 sm:col-span-2">
          <span className={rotulo}>Documento</span>
          <select value={tipo} onChange={(e) => setTipo(e.target.value)} className={campo}>
            {TIPOS_DOCUMENTO_PROFISSIONAL.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={rotulo}>Número</span>
          <input value={numero} onChange={(e) => setNumero(e.target.value)} className={campo} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={rotulo}>Emissão</span>
          <input type="date" value={emissao} onChange={(e) => setEmissao(e.target.value)} className={campo} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={rotulo}>Validade</span>
          <input type="date" value={validade} onChange={(e) => setValidade(e.target.value)} className={campo} />
        </label>
        <div className="flex flex-col gap-1.5 sm:col-span-3">
          <span className={rotulo}>Arquivo (foto ou PDF, até 10 MB)</span>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={classeBotao("secundario")} onClick={() => entrada.current?.click()}>
              <Upload className="size-4" /> {arquivo ? "Trocar arquivo" : "Escolher arquivo"}
            </button>
            <span className="truncate text-sm text-texto-2">{arquivo?.name ?? "nenhum arquivo"}</span>
          </div>
          <input ref={entrada} type="file" accept="image/*,application/pdf" className="hidden" aria-label="Arquivo do documento" onChange={(e) => setArquivo(e.target.files?.[0] ?? null)} />
        </div>
      </div>
      {erro && <div className="rounded-[14px] border border-ruim-bd bg-ruim-bg px-4 py-2.5 text-sm text-ruim">{erro}</div>}
      <div className="flex justify-end">
        <button type="button" className={classeBotao("primario")} disabled={enviando} onClick={() => void salvar()}>
          {enviando ? "Salvando…" : "Adicionar documento"}
        </button>
      </div>
    </div>
  );
}
