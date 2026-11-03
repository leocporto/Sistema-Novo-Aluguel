"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ImageIcon, Upload } from "lucide-react";
import { BotaoExcluir } from "@/components/botao-excluir";
import { classeBotao } from "@/components/ui";
import { clienteNavegador } from "@/lib/supabase/navegador";
import { registrarLogo, removerLogo } from "./actions";

const TIPOS = ["image/png", "image/jpeg", "image/webp"];

/** Envio do logo do site (bucket público "site", pasta da imobiliária). */
export function LogoSite({ organizacaoId, siteId, url }: { organizacaoId: string; siteId: string; url: string | null }) {
  const entrada = useRef<HTMLInputElement>(null);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const router = useRouter();

  const enviar = async (arquivo: File | undefined) => {
    if (!arquivo) return;
    setErro(null);
    if (!TIPOS.includes(arquivo.type)) return setErro("Envie uma imagem PNG, JPG ou WEBP.");
    if (arquivo.size > 5 * 1024 * 1024) return setErro("O logo passa de 5 MB.");
    setEnviando(true);
    try {
      const ext = arquivo.type === "image/png" ? "png" : arquivo.type === "image/webp" ? "webp" : "jpg";
      const caminho = `${organizacaoId}/logo-${Date.now()}.${ext}`;
      const { error } = await clienteNavegador().storage.from("site").upload(caminho, arquivo, { contentType: arquivo.type, upsert: false });
      if (error) throw new Error(`Não foi possível enviar o logo: ${error.message}`);
      const r = await registrarLogo(caminho);
      if (!r.ok) throw new Error(r.erro ?? "Não foi possível salvar o logo.");
      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível enviar o logo.");
    } finally {
      setEnviando(false);
      if (entrada.current) entrada.current.value = "";
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-4">
      <div className="grid h-20 w-40 place-items-center overflow-hidden rounded-[14px] border border-borda bg-elev text-mudo">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {url ? <img src={url} alt="Logo do site" className="max-h-full max-w-full object-contain p-2" /> : <ImageIcon className="size-6" />}
      </div>
      <div className="space-y-2">
        <input ref={entrada} type="file" accept={TIPOS.join(",")} className="hidden" onChange={(e) => void enviar(e.target.files?.[0])} aria-label="Escolher o logo" />
        <div className="flex items-center gap-2">
          <button type="button" className={classeBotao("secundario")} disabled={enviando} onClick={() => entrada.current?.click()}>
            <Upload className="size-4" /> {enviando ? "Enviando…" : url ? "Trocar logo" : "Enviar logo"}
          </button>
          {url && <BotaoExcluir acao={removerLogo} id={siteId} rotulo="Tirar o logo" confirmar="Tirar o logo do site?" />}
        </div>
        <p className="text-xs text-mudo">PNG, JPG ou WEBP até 5 MB. De preferência com fundo transparente.</p>
        {erro && <p className="text-xs text-ruim">{erro}</p>}
      </div>
    </div>
  );
}
