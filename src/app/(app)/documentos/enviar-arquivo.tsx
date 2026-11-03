"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import { classeBotao } from "@/components/ui";
import { ROTULO_TIPO_DOCUMENTO } from "@/lib/dominio/modelos";
import { enviarArquivoDocumento } from "@/lib/supabase/navegador";
import { registrarArquivoDocumento } from "./actions";

type Op = { id: string; rotulo: string };

const campo = "min-h-10 w-full rounded-btn border border-borda-forte bg-input px-3 text-sm text-texto";
const rot = "mb-1.5 block font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-mudo";

/** Envia um arquivo pronto (PDF, foto, Word) para a central, ligado a imóvel/cliente/contrato. */
export function EnviarArquivo({ organizacaoId, imoveis, pessoas, contratos, tipos }: { organizacaoId: string; imoveis: Op[]; pessoas: Op[]; contratos: Op[]; tipos: string[] }) {
  const [aberto, setAberto] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const router = useRouter();

  const enviar = async (fd: FormData) => {
    const arquivos = fd.getAll("arquivo").filter((f): f is File => f instanceof File && f.size > 0);
    if (!arquivos.length) return setErro("Escolha o arquivo.");
    setErro(null);
    setEnviando(true);
    const falhas: string[] = [];
    for (const a of arquivos) {
      try {
        const path = await enviarArquivoDocumento(organizacaoId, a);
        const r = await registrarArquivoDocumento({
          path,
          nome: a.name,
          titulo: arquivos.length > 1 ? a.name : String(fd.get("titulo") || a.name),
          tipo: String(fd.get("tipo") || "outro"),
          imovelId: String(fd.get("imovel_id") || "") || null,
          pessoaId: String(fd.get("pessoa_id") || "") || null,
          contratoId: String(fd.get("contrato_id") || "") || null,
          validade: String(fd.get("validade") || "") || null,
        });
        if (!r.ok) falhas.push(r.erro ?? a.name);
      } catch (e) {
        falhas.push(e instanceof Error ? e.message : a.name);
      }
    }
    setEnviando(false);
    if (falhas.length) return setErro(falhas.join(" · "));
    setAberto(false);
    router.refresh();
  };

  return (
    <>
      <button type="button" className={classeBotao("secundario")} onClick={() => setAberto(true)}>
        <Upload className="size-4" /> Enviar arquivo
      </button>
      {aberto &&
        createPortal(
          <div className="janela-fundo fixed inset-0 z-[100] flex items-center justify-center bg-[rgba(10,14,20,.45)] p-4 backdrop-blur-[6px]" onMouseDown={(e) => e.target === e.currentTarget && setAberto(false)}>
            <form
              ref={form}
              action={enviar}
              role="dialog"
              aria-modal="true"
              className="janela w-full max-w-xl space-y-4 rounded-card border border-borda bg-card p-6 shadow-[0_24px_60px_-20px_rgba(0,0,0,.45)]"
            >
              <h3 className="text-[17px] font-semibold text-texto">Enviar arquivo</h3>
              {erro && <div className="rounded-[14px] border border-ruim-bd bg-ruim-bg px-4 py-2.5 text-sm text-ruim">{erro}</div>}
              <label className="block">
                <span className={rot}>Arquivo(s)</span>
                <input type="file" name="arquivo" multiple required accept="application/pdf,image/*,.doc,.docx" className="block w-full text-sm text-texto-2" />
              </label>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className={rot}>Título</span>
                  <input name="titulo" className={campo} placeholder="Matrícula atualizada, RG do locatário…" />
                </label>
                <label className="block">
                  <span className={rot}>Tipo</span>
                  <select name="tipo" defaultValue="outro" className={campo}>
                    {tipos.map((t) => (
                      <option key={t} value={t}>
                        {ROTULO_TIPO_DOCUMENTO[t]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className={rot}>Imóvel</span>
                  <select name="imovel_id" defaultValue="" className={campo}>
                    <option value="">— nenhum —</option>
                    {imoveis.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.rotulo}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className={rot}>Pessoa (cliente)</span>
                  <select name="pessoa_id" defaultValue="" className={campo}>
                    <option value="">— nenhuma —</option>
                    {pessoas.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.rotulo}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className={rot}>Contrato</span>
                  <select name="contrato_id" defaultValue="" className={campo}>
                    <option value="">— nenhum —</option>
                    {contratos.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.rotulo}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className={rot}>Vence em (opcional)</span>
                  <input type="date" name="validade" className={campo} />
                </label>
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" className={classeBotao("secundario")} onClick={() => setAberto(false)}>
                  Cancelar
                </button>
                <button type="submit" disabled={enviando} className={classeBotao("primario")}>
                  {enviando ? "Enviando…" : "Enviar"}
                </button>
              </div>
            </form>
          </div>,
          document.body,
        )}
    </>
  );
}
