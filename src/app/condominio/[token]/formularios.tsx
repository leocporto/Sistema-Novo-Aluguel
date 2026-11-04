"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, ImagePlus } from "lucide-react";
import { AreaTexto, Campo, Entrada, Selecao, classeBotao } from "@/components/ui";
import { TIPOS_OCORRENCIA } from "@/lib/dominio/condominios";
import { clienteNavegador } from "@/lib/supabase/navegador";
import { abrirOcorrenciaPortal, registrarFotoPortal } from "./actions";

const FOTOS = ["image/jpeg", "image/png", "image/webp", "image/heic"];
const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic" };

/** Morador abre uma ocorrência pelo portal (com até 6 fotos, na pasta liberada pelo banco por 2 horas). */
export function FormOcorrenciaPortal({ token, unidades }: { token: string; unidades: { id: string; nome: string }[] }) {
  const arquivos = useRef<HTMLInputElement>(null);
  const [enviando, setEnviando] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [feito, setFeito] = useState<{ numero: number; falhas: string[] } | null>(null);
  const [qtd, setQtd] = useState(0);
  const router = useRouter();

  const enviar = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (enviando) return;
    const fd = new FormData(e.currentTarget);
    setErro(null);
    setEnviando("Enviando…");
    try {
      const r = await abrirOcorrenciaPortal(token, {
        unidade_id: String(fd.get("unidade_id") ?? ""),
        tipo: String(fd.get("tipo") ?? "outro"),
        titulo: String(fd.get("titulo") ?? ""),
        descricao: String(fd.get("descricao") ?? ""),
      });
      if (!r.ok) {
        setErro(r.erro);
        return;
      }
      const falhas: string[] = [];
      const lista = [...(arquivos.current?.files ?? [])].slice(0, 6);
      for (let i = 0; i < lista.length; i++) {
        const f = lista[i];
        setEnviando(`Enviando foto ${i + 1} de ${lista.length}…`);
        if (!FOTOS.includes(f.type) || f.size > 10 * 1024 * 1024) {
          falhas.push(`${f.name} (só fotos até 10 MB)`);
          continue;
        }
        const path = `${r.ocorrencia.pasta}/${Date.now()}-${i}.${EXT[f.type]}`;
        const { error } = await clienteNavegador().storage.from("condominios").upload(path, f, { contentType: f.type, upsert: false });
        if (error) {
          falhas.push(f.name);
          continue;
        }
        const reg = await registrarFotoPortal(token, r.ocorrencia.envio, path);
        if (!reg.ok) falhas.push(reg.erro ?? f.name);
      }
      setFeito({ numero: r.ocorrencia.numero, falhas });
      router.refresh();
    } catch {
      setErro("Não foi possível enviar. Verifique a internet e tente de novo.");
    } finally {
      setEnviando(null);
    }
  };

  if (feito)
    return (
      <div className="space-y-3 rounded-[14px] border border-ok-bd bg-ok-bg px-4 py-4 text-[15px] text-texto">
        <p className="flex items-center gap-2 font-semibold text-ok">
          <CheckCircle2 className="size-5" /> Ocorrência nº {feito.numero} registrada!
        </p>
        <p>A administradora vai responder por aqui.</p>
        {feito.falhas.length > 0 && <p className="text-sm text-ruim">Algumas fotos não foram enviadas: {feito.falhas.join(" · ")}</p>}
        <button type="button" onClick={() => setFeito(null)} className={classeBotao("secundario")}>
          Registrar outra
        </button>
      </div>
    );

  return (
    <form onSubmit={enviar} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo rotulo="Assunto">
          <Selecao name="tipo" defaultValue="manutencao">
            {Object.entries(TIPOS_OCORRENCIA).map(([k, r]) => (
              <option key={k} value={k}>
                {r}
              </option>
            ))}
          </Selecao>
        </Campo>
        <Campo rotulo="Unidade">
          <Selecao name="unidade_id" defaultValue={unidades[0]?.id ?? ""}>
            <option value="">Área comum</option>
            {unidades.map((u) => (
              <option key={u.id} value={u.id}>
                {u.nome}
              </option>
            ))}
          </Selecao>
        </Campo>
      </div>
      <Campo rotulo="Resumo">
        <Entrada name="titulo" required maxLength={160} placeholder="Ex.: Lâmpada queimada no corredor do 2º andar" />
      </Campo>
      <Campo rotulo="Detalhes">
        <AreaTexto name="descricao" rows={4} maxLength={4000} />
      </Campo>
      <div>
        <button type="button" className={classeBotao("secundario")} onClick={() => arquivos.current?.click()}>
          <ImagePlus className="size-4" /> {qtd ? `${qtd} foto(s) escolhida(s)` : "Anexar fotos (opcional)"}
        </button>
        <input ref={arquivos} type="file" accept="image/*" multiple className="hidden" aria-label="Escolher fotos" onChange={(e) => setQtd(Math.min(6, e.target.files?.length ?? 0))} />
      </div>
      {erro && <div className="rounded-[14px] border border-ruim-bd bg-ruim-bg px-4 py-2.5 text-sm text-ruim">{erro}</div>}
      <button type="submit" disabled={Boolean(enviando)} className={classeBotao("primario")}>
        {enviando ?? "Enviar"}
      </button>
    </form>
  );
}
