"use client";

import { useRef, useTransition } from "react";
import { Eye, Paperclip } from "lucide-react";
import { classeBotao } from "@/components/ui";
import { TAMANHO_MAX_COMPROVANTE, TIPOS_COMPROVANTE, clienteNavegador } from "@/lib/supabase/navegador";
import { linkComprovanteRepasse, salvarComprovanteRepasse } from "../actions";

/** Anexa (bucket privado "comprovantes", pasta <org>/repasses/<id>/) e abre o comprovante do repasse. */
export function ComprovanteRepasse({ repasseId, organizacaoId, temArquivo }: { repasseId: string; organizacaoId: string; temArquivo: boolean }) {
  const arquivo = useRef<HTMLInputElement>(null);
  const [rodando, iniciar] = useTransition();

  const enviar = (f: File | undefined) => {
    if (!f) return;
    iniciar(async () => {
      try {
        if (!TIPOS_COMPROVANTE.includes(f.type)) throw new Error("Envie uma imagem (JPG, PNG) ou PDF.");
        if (f.size > TAMANHO_MAX_COMPROVANTE) throw new Error("O arquivo passa de 10 MB.");
        const nome = f.name.normalize("NFD").replace(/[^\w.-]+/g, "_").slice(-80);
        const caminho = `${organizacaoId}/repasses/${repasseId}/${Date.now()}-${nome}`;
        const { error } = await clienteNavegador().storage.from("comprovantes").upload(caminho, f, { contentType: f.type, upsert: false });
        if (error) throw new Error(`Não foi possível enviar o comprovante: ${error.message}`);
        const r = await salvarComprovanteRepasse(repasseId, caminho);
        if (!r.ok) throw new Error(r.erro);
      } catch (e) {
        window.alert(e instanceof Error ? e.message : "Não foi possível enviar.");
      } finally {
        if (arquivo.current) arquivo.current.value = "";
      }
    });
  };

  const abrir = () =>
    iniciar(async () => {
      const r = await linkComprovanteRepasse(repasseId);
      if (r.ok && r.url) window.open(r.url, "_blank");
      else window.alert(r.erro ?? "Não foi possível abrir.");
    });

  return (
    <div className="flex flex-wrap gap-2">
      <input ref={arquivo} type="file" accept={TIPOS_COMPROVANTE.join(",")} className="hidden" aria-label="Arquivo do comprovante" onChange={(e) => enviar(e.target.files?.[0])} />
      <button type="button" disabled={rodando} className={classeBotao("secundario", "sm")} onClick={() => arquivo.current?.click()}>
        <Paperclip className="size-3.5" /> {rodando ? "Enviando…" : temArquivo ? "Trocar comprovante" : "Anexar comprovante"}
      </button>
      {temArquivo && (
        <button type="button" disabled={rodando} className={classeBotao("secundario", "sm")} onClick={abrir}>
          <Eye className="size-3.5" /> Ver comprovante
        </button>
      )}
    </div>
  );
}
