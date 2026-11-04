"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import { Campo, Entrada, Grade, Selecao, classeBotao } from "@/components/ui";
import { TIPOS_DOCUMENTO_COND } from "@/lib/dominio/condominios";
import { clienteNavegador } from "@/lib/supabase/navegador";
import { registrarArquivoContrato } from "./actions";
import { registrarDocumento, registrarFotoOcorrencia } from "./actions-gestao";

const FOTOS = ["image/jpeg", "image/png", "image/webp", "image/heic"];
const DOCUMENTOS = [
  ...FOTOS,
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
];
const MAX = 25 * 1024 * 1024;

const nomeSeguro = (n: string) => n.normalize("NFD").replace(/[^\w.-]+/g, "_").slice(-80);

/** Sobe para o bucket privado "condominios" (a pasta da organização: só a equipe grava e lê). */
async function subir(pasta: string, arquivo: File, tipos: string[]): Promise<string> {
  if (!tipos.includes(arquivo.type)) throw new Error(`"${arquivo.name}": tipo de arquivo não aceito.`);
  if (arquivo.size > MAX) throw new Error(`"${arquivo.name}" passa de 25 MB.`);
  const caminho = `${pasta}/${Date.now()}-${nomeSeguro(arquivo.name)}`;
  const { error } = await clienteNavegador().storage.from("condominios").upload(caminho, arquivo, { contentType: arquivo.type, upsert: false });
  if (error) throw new Error(`Não foi possível enviar "${arquivo.name}": ${error.message}`);
  return caminho;
}

/** Fotos da ocorrência enviadas pela equipe. */
export function EnviarFotosOcorrencia({ organizacaoId, condominioId, ocorrenciaId }: { organizacaoId: string; condominioId: string; ocorrenciaId: string }) {
  const entrada = useRef<HTMLInputElement>(null);
  const [enviando, setEnviando] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const router = useRouter();
  const enviar = async (lista: FileList) => {
    setErro(null);
    const fs = [...lista];
    for (let i = 0; i < fs.length; i++) {
      setEnviando(`Enviando ${i + 1} de ${fs.length}…`);
      try {
        const path = await subir(`${organizacaoId}/${condominioId}/ocorrencias/${ocorrenciaId}`, fs[i], FOTOS);
        const r = await registrarFotoOcorrencia({ ocorrenciaId, path });
        if (!r.ok) throw new Error(r.erro);
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Erro ao enviar.");
      }
    }
    setEnviando(null);
    if (entrada.current) entrada.current.value = "";
    router.refresh();
  };
  return (
    <div className="space-y-2">
      <button type="button" className={classeBotao("secundario")} disabled={Boolean(enviando)} onClick={() => entrada.current?.click()}>
        <Upload className="size-4" /> {enviando ?? "Enviar fotos"}
      </button>
      <input ref={entrada} type="file" multiple accept="image/*" className="hidden" aria-label="Escolher fotos" onChange={(e) => e.target.files && void enviar(e.target.files)} />
      {erro && <p className="text-sm text-ruim">{erro}</p>}
    </div>
  );
}

/** Envio de documento condominial (convenção, regimento, ata, seguro, AVCB…) com validade. */
export function EnviarDocumento({ organizacaoId, condominioId }: { organizacaoId: string; condominioId: string }) {
  const entrada = useRef<HTMLInputElement>(null);
  const [titulo, setTitulo] = useState("");
  const [tipo, setTipo] = useState("convencao");
  const [validade, setValidade] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const router = useRouter();
  const enviar = async (arquivo: File) => {
    setErro(null);
    setEnviando(true);
    try {
      const path = await subir(`${organizacaoId}/${condominioId}/documentos`, arquivo, DOCUMENTOS);
      const r = await registrarDocumento({ condominioId, path, nome: arquivo.name, titulo: titulo.trim() || TIPOS_DOCUMENTO_COND[tipo as keyof typeof TIPOS_DOCUMENTO_COND], tipo, validade: validade || null });
      if (!r.ok) throw new Error(r.erro);
      setTitulo("");
      setValidade("");
      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao enviar.");
    } finally {
      setEnviando(false);
      if (entrada.current) entrada.current.value = "";
    }
  };
  return (
    <div className="space-y-3">
      <Grade colunas={3}>
        <Campo rotulo="Tipo">
          <Selecao value={tipo} onChange={(e) => setTipo(e.target.value)}>
            {Object.entries(TIPOS_DOCUMENTO_COND).map(([k, r]) => (
              <option key={k} value={k}>
                {r}
              </option>
            ))}
          </Selecao>
        </Campo>
        <Campo rotulo="Nome (opcional)">
          <Entrada value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Ex.: Convenção registrada em 2019" />
        </Campo>
        <Campo rotulo="Validade (seguro, AVCB…)">
          <Entrada type="date" value={validade} onChange={(e) => setValidade(e.target.value)} />
        </Campo>
      </Grade>
      <button type="button" className={classeBotao("primario")} disabled={enviando} onClick={() => entrada.current?.click()}>
        <Upload className="size-4" /> {enviando ? "Enviando…" : "Escolher arquivo e enviar"}
      </button>
      <input ref={entrada} type="file" accept=".pdf,image/*,.doc,.docx,.xls,.xlsx" className="hidden" aria-label="Escolher documento" onChange={(e) => e.target.files?.[0] && void enviar(e.target.files[0])} />
      {erro && <p className="text-sm text-ruim">{erro}</p>}
    </div>
  );
}

/** Arquivo do contrato com o fornecedor (PDF, foto, Word, Excel), na pasta do contrato. Trocar apaga o anterior. */
export function EnviarArquivoContrato({ organizacaoId, condominioId, contratoId, temArquivo }: { organizacaoId: string; condominioId: string; contratoId: string; temArquivo: boolean }) {
  const entrada = useRef<HTMLInputElement>(null);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const router = useRouter();
  const enviar = async (arquivo: File) => {
    setErro(null);
    setEnviando(true);
    try {
      const path = await subir(`${organizacaoId}/${condominioId}/contratos/${contratoId}`, arquivo, DOCUMENTOS);
      const r = await registrarArquivoContrato({ contratoId, path });
      if (!r.ok) throw new Error(r.erro);
      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao enviar.");
    } finally {
      setEnviando(false);
      if (entrada.current) entrada.current.value = "";
    }
  };
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button type="button" className={classeBotao("secundario", "sm")} disabled={enviando} onClick={() => entrada.current?.click()}>
        <Upload className="size-3.5" /> {enviando ? "Enviando…" : temArquivo ? "Trocar arquivo" : "Enviar o contrato"}
      </button>
      <input ref={entrada} type="file" accept=".pdf,image/*,.doc,.docx,.xls,.xlsx" className="hidden" aria-label="Escolher o arquivo do contrato" onChange={(e) => e.target.files?.[0] && void enviar(e.target.files[0])} />
      {erro && <span className="text-sm text-ruim">{erro}</span>}
    </span>
  );
}
