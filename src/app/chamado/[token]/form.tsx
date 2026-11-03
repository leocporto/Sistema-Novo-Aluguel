"use client";

import { useActionState, useRef, useState, type FormEvent } from "react";
import { CheckCircle2, ImagePlus } from "lucide-react";
import { CATEGORIAS_CHAMADO, DICA_URGENCIA, ROTULO_CATEGORIA, ROTULO_URGENCIA, URGENCIAS } from "@/lib/dominio/manutencao";
import { enviarMidiaChamado, tipoDaMidia } from "@/lib/supabase/manutencao";
import { abrirChamadoPublico, confirmarServicoPublico, registrarMidiaPublica } from "./actions";

const campo = "min-h-11 w-full rounded-[11px] border border-borda-forte bg-input px-3 text-[15px] text-texto outline-none focus:border-acento";
const rotulo = "font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-mudo";
const botao = "inline-flex h-11 items-center justify-center gap-2 rounded-[11px] px-5 text-[14px] font-semibold transition hover:-translate-y-px active:scale-[.98] disabled:opacity-50";

/** Formulário público de abertura de chamado (o locatário, sem login). */
export function FormChamado({ token, nomeInicial }: { token: string; nomeInicial: string }) {
  const arquivos = useRef<HTMLInputElement>(null);
  const [enviando, setEnviando] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [feito, setFeito] = useState<{ numero: number; falhas: string[]; garantia: boolean } | null>(null);
  const [qtd, setQtd] = useState(0);

  const enviar = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (enviando) return;
    const fd = new FormData(e.currentTarget);
    setErro(null);
    setEnviando("Abrindo o chamado…");
    const dados = Object.fromEntries(["nome", "telefone", "titulo", "categoria", "urgencia", "local", "descricao"].map((k) => [k, String(fd.get(k) ?? "")]));
    try {
      const r = await abrirChamadoPublico(token, dados);
      if (!r.ok) {
        setErro(r.erro);
        return;
      }
      const falhas: string[] = [];
      const lista = [...(arquivos.current?.files ?? [])].slice(0, 20);
      for (let i = 0; i < lista.length; i++) {
        setEnviando(`Enviando foto/vídeo ${i + 1} de ${lista.length}…`);
        try {
          const path = await enviarMidiaChamado(r.chamado.pasta, lista[i]);
          const m = await registrarMidiaPublica(token, { chamadoId: r.chamado.id, upload: r.chamado.upload_token, path, nome: lista[i].name, tipo: tipoDaMidia(lista[i]) });
          if (!m.ok) falhas.push(m.erro ?? lista[i].name);
        } catch (x) {
          falhas.push(x instanceof Error ? x.message : lista[i].name);
        }
      }
      setFeito({ numero: r.chamado.numero, falhas, garantia: r.chamado.garantia });
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
          <CheckCircle2 className="size-5" /> Chamado nº {feito.numero} aberto!
        </p>
        <p>A administração vai analisar e entrar em contato. Você acompanha o andamento nesta mesma página.</p>
        {feito.garantia && <p className="text-sm">Encontramos um serviço parecido ainda na garantia: ele foi ligado a este chamado.</p>}
        {feito.falhas.length > 0 && <p className="text-sm text-ruim">Alguns arquivos não foram enviados: {feito.falhas.join(" · ")}</p>}
        <button type="button" onClick={() => window.location.reload()} className={`${botao} border border-borda bg-card text-texto`}>
          Ver meus chamados
        </button>
      </div>
    );

  return (
    <form onSubmit={enviar} className="space-y-4">
      {erro && (
        <div role="alert" className="rounded-[12px] border border-ruim-bd bg-ruim-bg px-4 py-2.5 text-sm text-ruim">
          {erro}
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className={rotulo}>Seu nome</span>
          <input name="nome" required defaultValue={nomeInicial} className={campo} autoComplete="name" />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={rotulo}>WhatsApp para contato</span>
          <input name="telefone" inputMode="tel" className={campo} autoComplete="tel" />
        </label>
      </div>
      <label className="flex flex-col gap-1.5">
        <span className={rotulo}>Qual é o problema?</span>
        <input name="titulo" required maxLength={160} className={campo} placeholder="Ex.: vazamento embaixo da pia" />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className={rotulo}>Tipo</span>
          <select name="categoria" defaultValue="hidraulica" className={campo}>
            {CATEGORIAS_CHAMADO.map((c) => (
              <option key={c} value={c}>
                {ROTULO_CATEGORIA[c]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={rotulo}>Onde (cômodo)</span>
          <input name="local" className={campo} placeholder="Cozinha, banheiro…" />
        </label>
      </div>
      <fieldset className="space-y-2">
        <legend className={`${rotulo} mb-1.5`}>Urgência</legend>
        {URGENCIAS.map((u) => (
          <label key={u} className="flex cursor-pointer items-start gap-2.5 rounded-[11px] border border-borda px-3 py-2.5 text-sm has-[:checked]:border-acento has-[:checked]:bg-acento-bg">
            <input type="radio" name="urgencia" value={u} defaultChecked={u === "media"} className="mt-0.5 size-4 accent-[var(--accent)]" />
            <span>
              <b className="text-texto">{ROTULO_URGENCIA[u]}</b> <span className="text-texto-2">— {DICA_URGENCIA[u]}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <label className="flex flex-col gap-1.5">
        <span className={rotulo}>Conte mais</span>
        <textarea name="descricao" rows={4} className={`${campo} py-2`} placeholder="Desde quando acontece, se piora com chuva, melhores horários para o prestador ir…" />
      </label>
      <div className="flex flex-col gap-1.5">
        <span className={rotulo}>Fotos e vídeos (opcional)</span>
        <button type="button" onClick={() => arquivos.current?.click()} className="flex w-full flex-col items-center justify-center gap-1.5 rounded-[14px] border-2 border-dashed border-borda-forte px-4 py-6 text-sm text-texto-2 transition hover:border-acento hover:text-acento-hot">
          <ImagePlus className="size-6" />
          {qtd ? `${qtd} arquivo(s) escolhido(s) — toque para trocar` : "Toque para escolher fotos ou vídeos (foto até 10 MB, vídeo até 50 MB)"}
        </button>
        <input ref={arquivos} type="file" multiple accept="image/*,video/mp4,video/quicktime,video/webm" className="hidden" aria-label="Escolher fotos e vídeos" onChange={(e) => setQtd(e.target.files?.length ?? 0)} />
      </div>
      <button type="submit" disabled={Boolean(enviando)} className={`${botao} w-full border border-acento bg-acento text-white hover:bg-acento-hot sm:w-auto`}>
        {enviando ?? "Abrir chamado"}
      </button>
    </form>
  );
}

/** Botão "o serviço foi feito" de um chamado (o locatário confirma). */
export function ConfirmarServico({ token, chamado }: { token: string; chamado: string }) {
  const [estado, enviar, enviando] = useActionState(confirmarServicoPublico, {});
  const [aberto, setAberto] = useState(false);
  if (estado.ok) return <p className="text-sm font-medium text-ok">{estado.ok}</p>;
  if (!aberto)
    return (
      <button type="button" onClick={() => setAberto(true)} className={`${botao} h-9 border border-borda bg-card px-3 text-[13px] text-texto`}>
        <CheckCircle2 className="size-4" /> O serviço foi feito
      </button>
    );
  return (
    <form action={enviar} className="mt-2 space-y-2">
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="chamado" value={chamado} />
      {estado.erro && <p className="text-sm text-ruim">{estado.erro}</p>}
      <textarea name="comentario" rows={2} className={`${campo} py-2`} aria-label="Comentário sobre o serviço" placeholder="Como ficou? (opcional)" />
      <button disabled={enviando} className={`${botao} h-9 border border-acento bg-acento px-3 text-[13px] text-white`}>
        Confirmar
      </button>
    </form>
  );
}
