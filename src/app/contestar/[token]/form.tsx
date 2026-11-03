"use client";

import { useRef, useState } from "react";
import { Camera, X } from "lucide-react";
import { classeBotao } from "@/components/ui";
import { clienteNavegador } from "@/lib/supabase/navegador";
import { enviarContestacao } from "./actions";

type ItemPublico = { id: string; nome: string; ambiente: string };

const campo = "min-h-11 w-full rounded-[11px] border border-borda-forte bg-input px-3 py-2 text-[15px] text-texto outline-none focus:border-acento focus:ring-4 focus:ring-acento-bg";

/** Formulário da contestação (nome, o que não concorda, itens e fotos). */
export function FormContestacao({ token, organizacaoId, itens }: { token: string; organizacaoId: string; itens: ItemPublico[] }) {
  const [nome, setNome] = useState("");
  const [contato, setContato] = useState("");
  const [texto, setTexto] = useState("");
  const [marcados, setMarcados] = useState<Record<string, string>>({});
  const [fotos, setFotos] = useState<{ path: string; nome: string }[]>([]);
  const [enviando, setEnviando] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const entrada = useRef<HTMLInputElement>(null);

  const subirFotos = async (lista: FileList | null) => {
    if (!lista?.length) return;
    setErro(null);
    const novas: { path: string; nome: string }[] = [];
    const arquivos = [...lista].slice(0, Math.max(0, 20 - fotos.length));
    for (let i = 0; i < arquivos.length; i++) {
      const f = arquivos[i];
      setEnviando(`Enviando foto ${i + 1} de ${arquivos.length}…`);
      if (!f.type.startsWith("image/") || f.size > 15 * 1024 * 1024) {
        setErro(`"${f.name}": envie uma foto de até 15 MB.`);
        continue;
      }
      const nomeArq = f.name.normalize("NFD").replace(/[^\w.-]+/g, "_").slice(-60);
      const path = `${organizacaoId}/contestacoes/${token}/${crypto.randomUUID()}-${nomeArq}`;
      const { error } = await clienteNavegador().storage.from("vistorias").upload(path, f, { contentType: f.type, upsert: false });
      if (error) setErro(`Não foi possível enviar "${f.name}". Tente de novo.`);
      else novas.push({ path, nome: f.name });
    }
    setFotos((x) => [...x, ...novas]);
    setEnviando(null);
    if (entrada.current) entrada.current.value = "";
  };

  const enviar = async () => {
    setErro(null);
    setEnviando("Enviando a contestação…");
    try {
      const r = await enviarContestacao(token, {
        nome,
        contato,
        texto,
        itens: Object.entries(marcados).map(([item_id, t]) => ({ item_id, texto: t })),
        fotos: fotos.map((f) => f.path),
      });
      if (!r.ok) setErro(r.erro ?? "Não foi possível enviar.");
      else setOk(true);
    } catch {
      setErro("Não foi possível enviar. Verifique a internet e tente de novo.");
    } finally {
      setEnviando(null);
    }
  };

  if (ok)
    return (
      <div className="rounded-[14px] border border-ok-bd bg-ok-bg px-4 py-4 text-[15px] font-medium text-ok">
        Contestação enviada. Quem fez a vistoria vai analisar e responder. Você pode voltar a este link para ver a resposta.
      </div>
    );

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void enviar();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <input value={nome} onChange={(e) => setNome(e.target.value)} required className={campo} placeholder="Seu nome completo" autoComplete="name" aria-label="Seu nome completo" />
        <input value={contato} onChange={(e) => setContato(e.target.value)} className={campo} placeholder="Telefone ou e-mail para resposta" aria-label="Telefone ou e-mail" />
      </div>
      <textarea value={texto} onChange={(e) => setTexto(e.target.value)} required rows={5} className={campo} placeholder="Explique com o que você não concorda e por quê." aria-label="O que você contesta" />

      {itens.length > 0 && (
        <details className="rounded-[14px] border border-borda p-3">
          <summary className="cursor-pointer text-sm font-semibold text-texto">Marcar os itens que você contesta (opcional)</summary>
          <ul className="mt-3 max-h-80 space-y-2 overflow-y-auto pr-1">
            {itens.map((i) => {
              const marcado = i.id in marcados;
              return (
                <li key={i.id} className="text-sm">
                  <label className="flex items-center gap-2 text-texto-2">
                    <input
                      type="checkbox"
                      checked={marcado}
                      onChange={(e) =>
                        setMarcados((m) => {
                          const n = { ...m };
                          if (e.target.checked) n[i.id] = "";
                          else delete n[i.id];
                          return n;
                        })
                      }
                    />
                    {i.ambiente} · {i.nome}
                  </label>
                  {marcado && (
                    <input
                      value={marcados[i.id]}
                      onChange={(e) => setMarcados((m) => ({ ...m, [i.id]: e.target.value }))}
                      className={`${campo} mt-1`}
                      placeholder="O que está diferente?"
                      aria-label={`Comentário sobre ${i.nome}`}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </details>
      )}

      <div>
        <button type="button" onClick={() => entrada.current?.click()} disabled={Boolean(enviando) || fotos.length >= 20} className={classeBotao("secundario")}>
          <Camera className="size-4" /> Anexar fotos ({fotos.length}/20)
        </button>
        <input ref={entrada} type="file" accept="image/*" multiple className="hidden" onChange={(e) => void subirFotos(e.target.files)} />
        {fotos.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-2">
            {fotos.map((f) => (
              <li key={f.path} className="flex items-center gap-1 rounded-full border border-borda px-3 py-1 text-xs text-texto-2">
                {f.nome}
                <button type="button" aria-label={`Tirar ${f.nome}`} onClick={() => setFotos((x) => x.filter((y) => y.path !== f.path))} className="text-ruim">
                  <X className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {erro && <div className="rounded-[12px] border border-ruim-bd bg-ruim-bg px-4 py-2.5 text-sm text-ruim">{erro}</div>}
      <button disabled={Boolean(enviando)} className={classeBotao("primario")}>
        {enviando ?? "Enviar contestação"}
      </button>
    </form>
  );
}
