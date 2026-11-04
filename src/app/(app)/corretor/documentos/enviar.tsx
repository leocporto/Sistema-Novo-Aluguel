"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { FileUp, LoaderCircle } from "lucide-react";
import { Campo, Entrada, Selecao, classeBotao } from "@/components/ui";
import { clienteNavegador } from "@/lib/supabase/navegador";
import { registrarDocumentoCorretor } from "../actions";

const TIPOS = ["image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf"];
const MAX = 10 * 1024 * 1024;

/** Envia um documento para corretores/<org>/<corretor>/ (o banco só aceita a pasta do próprio corretor) e registra. */
export function EnviarDocumentoCorretor({ organizacaoId, corretorId, leads }: { organizacaoId: string; corretorId: string; leads: { id: string; nome: string }[] }) {
  const arquivo = useRef<HTMLInputElement>(null);
  const [enviando, setEnviando] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);
  const router = useRouter();

  const enviar = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const f = arquivo.current?.files?.[0];
    setMsg(null);
    if (!f) return setMsg({ ok: false, texto: "Escolha o arquivo." });
    if (!TIPOS.includes(f.type)) return setMsg({ ok: false, texto: "Envie imagem (JPG, PNG, WEBP, HEIC) ou PDF." });
    if (f.size > MAX) return setMsg({ ok: false, texto: "O arquivo passa de 10 MB." });
    setEnviando(true);
    try {
      const nome = f.name.normalize("NFD").replace(/[^\w.-]+/g, "_").slice(-80);
      const path = `${organizacaoId}/${corretorId}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${nome}`;
      const { error } = await clienteNavegador().storage.from("corretores").upload(path, f, { contentType: f.type, upsert: false });
      if (error) throw new Error(`Não foi possível enviar: ${error.message}`);
      const r = await registrarDocumentoCorretor({
        corretor_id: corretorId,
        titulo: String(fd.get("titulo") ?? "") || f.name,
        categoria: String(fd.get("categoria") ?? "outro"),
        lead_id: String(fd.get("lead_id") ?? "") || null,
        path,
        nome: f.name,
      });
      if (!r.ok) throw new Error(r.erro ?? "Não foi possível registrar.");
      form.reset();
      setMsg({ ok: true, texto: "Documento enviado." });
      router.refresh();
    } catch (x) {
      setMsg({ ok: false, texto: x instanceof Error ? x.message : "Não foi possível enviar." });
    } finally {
      setEnviando(false);
    }
  };

  return (
    <form onSubmit={enviar} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Campo rotulo="Nome do documento">
          <Entrada name="titulo" maxLength={160} placeholder="Ex.: RG do cliente, CRECI…" />
        </Campo>
        <Campo rotulo="Tipo">
          <Selecao name="categoria" defaultValue="cliente">
            <option value="cliente">Documento de cliente</option>
            <option value="imovel">Documento de imóvel</option>
            <option value="proposta">Proposta / ficha</option>
            <option value="pessoal">Meu documento</option>
            <option value="outro">Outro</option>
          </Selecao>
        </Campo>
        <Campo rotulo="Lead (opcional)">
          <Selecao name="lead_id" defaultValue="">
            <option value="">—</option>
            {leads.map((l) => (
              <option key={l.id} value={l.id}>
                {l.nome}
              </option>
            ))}
          </Selecao>
        </Campo>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <input ref={arquivo} type="file" accept={TIPOS.join(",")} aria-label="Arquivo" className="text-sm text-texto-2 file:mr-3 file:rounded-[9px] file:border file:border-borda file:bg-card file:px-3 file:py-1.5 file:text-texto" />
        <button type="submit" disabled={enviando} className={classeBotao("primario")}>
          {enviando ? <LoaderCircle className="size-4 animate-spin" /> : <FileUp className="size-4" />} Enviar
        </button>
      </div>
      {msg && <p className={`text-sm ${msg.ok ? "text-ok" : "text-ruim"}`}>{msg.texto}</p>}
    </form>
  );
}
