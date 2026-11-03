"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import { classeBotao } from "@/components/ui";
import { importarExtrato } from "./actions";

const campo = "min-h-10 w-full rounded-btn border border-borda-forte bg-input px-3 text-sm text-texto";
const rot = "mb-1.5 block font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-mudo";

/** "Repetir": não repete / todo mês / parcelado — e quantas vezes. */
export function CamposRepeticao() {
  const [rep, setRep] = useState("nao");
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <label className="block">
        <span className={rot}>Repetir</span>
        <select name="repeticao" value={rep} onChange={(e) => setRep(e.target.value)} className={campo}>
          <option value="nao">Não repete</option>
          <option value="mensal">Todo mês (mesmo valor)</option>
          <option value="parcelado">Parcelado (divide o total)</option>
        </select>
      </label>
      {rep !== "nao" && (
        <label className="block">
          <span className={rot}>{rep === "mensal" ? "Por quantos meses" : "Em quantas parcelas"}</span>
          <input name="vezes" type="number" min={2} max={120} defaultValue={rep === "mensal" ? 12 : 3} className={campo} />
        </label>
      )}
    </div>
  );
}

/** Importa o extrato do banco (OFX ou CSV) direto do arquivo, sem guardar o arquivo. */
export function ImportarExtrato({ contaId }: { contaId: string }) {
  const [msg, setMsg] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);
  const [enviando, setEnviando] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const escolher = async (f: File | undefined) => {
    if (!f) return;
    setEnviando(true);
    setMsg(null);
    try {
      const buf = await f.arrayBuffer();
      let texto = new TextDecoder("utf-8").decode(buf);
      if (texto.includes("�")) texto = new TextDecoder("windows-1252").decode(buf);
      const r = await importarExtrato(contaId, texto);
      if (!r.ok) setMsg({ tipo: "erro", texto: r.erro ?? "Não deu para importar." });
      else {
        setMsg({ tipo: "ok", texto: `${r.novos} movimento(s) novo(s)${r.repetidos ? ` · ${r.repetidos} já estavam aqui` : ""}.` });
        router.refresh();
      }
    } catch (e) {
      setMsg({ tipo: "erro", texto: e instanceof Error ? e.message : "Erro ao ler o arquivo." });
    } finally {
      setEnviando(false);
      if (input.current) input.current.value = "";
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-3">
      <input ref={input} type="file" accept=".ofx,.csv,.txt,text/csv,application/x-ofx" className="hidden" onChange={(e) => escolher(e.target.files?.[0])} />
      <button type="button" className={classeBotao("primario")} disabled={enviando} onClick={() => input.current?.click()}>
        <Upload className="size-4" /> {enviando ? "Importando…" : "Importar extrato (OFX ou CSV)"}
      </button>
      {msg && <span className={`text-sm ${msg.tipo === "ok" ? "text-ok" : "text-ruim"}`}>{msg.texto}</span>}
    </div>
  );
}
