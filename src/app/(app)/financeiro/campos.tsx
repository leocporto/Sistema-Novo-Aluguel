"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import { Campo, Entrada, Selecao, classeBotao } from "@/components/ui";
import { lerExtrato } from "@/lib/dominio/financeiro";
import { importarItensExtrato } from "./actions";

/** "Repetir": não repete / todo mês / parcelado — e quantas vezes. */
export function CamposRepeticao() {
  const [rep, setRep] = useState("nao");
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Campo rotulo="Repetir">
        <Selecao name="repeticao" value={rep} onChange={(e) => setRep(e.target.value)}>
          <option value="nao">Não repete</option>
          <option value="mensal">Todo mês (mesmo valor)</option>
          <option value="parcelado">Parcelado (divide o total)</option>
        </Selecao>
      </Campo>
      {rep !== "nao" && (
        <Campo rotulo={rep === "mensal" ? "Por quantos meses" : "Em quantas parcelas"}>
          <Entrada name="vezes" type="number" min={2} max={120} defaultValue={rep === "mensal" ? 12 : 3} />
        </Campo>
      )}
    </div>
  );
}

/** "Já foi pago/recebido" + a data do pagamento (padrão hoje, nunca no futuro). */
export function CampoJaPago({ hoje }: { hoje: string }) {
  const [pago, setPago] = useState(false);
  return (
    <div className="flex flex-wrap items-end gap-4">
      <label className="flex items-center gap-2 text-sm text-texto-2">
        <input type="checkbox" name="ja_pago" checked={pago} onChange={(e) => setPago(e.target.checked)} /> Já foi pago/recebido (dá baixa na 1ª)
      </label>
      {pago && (
        <Campo rotulo="Pago em" className="w-44">
          <Entrada type="date" name="pago_em" defaultValue={hoje} max={hoje} />
        </Campo>
      )}
    </div>
  );
}

const LOTE = 500;
const TAMANHO_MAX = 15 * 1024 * 1024;

/**
 * Importa o extrato do banco (OFX ou CSV). O arquivo é lido aqui no navegador
 * e só as linhas vão para o servidor, em lotes (não há limite de 1 MB).
 */
export function ImportarExtrato({ contaId }: { contaId: string }) {
  const [msg, setMsg] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);
  const [enviando, setEnviando] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const escolher = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > TAMANHO_MAX) {
      setMsg({ tipo: "erro", texto: "Arquivo grande demais (máx. 15 MB). Exporte um período menor." });
      return;
    }
    setEnviando(true);
    setMsg(null);
    try {
      const buf = await f.arrayBuffer();
      let texto = new TextDecoder("utf-8").decode(buf);
      if (texto.includes("�")) texto = new TextDecoder("windows-1252").decode(buf);
      const itens = lerExtrato(texto);
      if (!itens.length) {
        setMsg({ tipo: "erro", texto: "Não achei movimentos no arquivo. Use o extrato em OFX (recomendado) ou CSV com data, descrição e valor." });
        return;
      }
      let novos = 0;
      let repetidos = 0;
      for (let i = 0; i < itens.length; i += LOTE) {
        const r = await importarItensExtrato(contaId, itens.slice(i, i + LOTE));
        if (!r.ok) {
          setMsg({ tipo: "erro", texto: `${novos ? `${novos} movimento(s) importado(s) antes do erro. ` : ""}${r.erro ?? "Não deu para importar."}` });
          router.refresh();
          return;
        }
        novos += r.novos ?? 0;
        repetidos += r.repetidos ?? 0;
      }
      setMsg({ tipo: "ok", texto: `${novos} movimento(s) novo(s)${repetidos ? ` · ${repetidos} já estavam aqui` : ""}.` });
      router.refresh();
    } catch (e) {
      setMsg({ tipo: "erro", texto: e instanceof Error ? e.message : "Erro ao ler o arquivo." });
    } finally {
      setEnviando(false);
      if (input.current) input.current.value = "";
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-3">
      <input
        ref={input}
        type="file"
        aria-label="Arquivo do extrato (OFX ou CSV)"
        accept=".ofx,.csv,.txt,text/csv,application/x-ofx"
        className="hidden"
        onChange={(e) => escolher(e.target.files?.[0])}
      />
      <button type="button" className={classeBotao("primario")} disabled={enviando} onClick={() => input.current?.click()}>
        <Upload className="size-4" /> {enviando ? "Importando…" : "Importar extrato (OFX ou CSV)"}
      </button>
      {msg && (
        <span role="status" className={`text-sm ${msg.tipo === "ok" ? "text-ok" : "text-ruim"}`}>
          {msg.texto}
        </span>
      )}
    </div>
  );
}
