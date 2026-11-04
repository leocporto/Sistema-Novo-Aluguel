"use client";

import { useRef, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Camera, CheckCircle2, ImagePlus, LoaderCircle } from "lucide-react";
import { AreaTexto, Campo, Entrada, Selecao, classeBotao } from "@/components/ui";
import { CATEGORIAS_CHAMADO, DICA_URGENCIA, ROTULO_CATEGORIA, ROTULO_URGENCIA, URGENCIAS } from "@/lib/dominio/manutencao";
import { enviarMidiaChamado, tipoDaMidia } from "@/lib/supabase/manutencao";
import { abrirChamadoPortal, prepararEnvioPortal, registrarMidiaPortal } from "./actions";

type Contrato = { id: string; rotulo: string };

/** Sobe os arquivos para a pasta liberada pelo banco e registra cada um. Devolve as falhas. */
async function subirArquivos(token: string, envio: string, pasta: string, arquivos: File[], aoAvancar: (texto: string) => void): Promise<string[]> {
  const falhas: string[] = [];
  for (let i = 0; i < arquivos.length; i++) {
    aoAvancar(`Enviando ${i + 1} de ${arquivos.length}…`);
    try {
      const path = await enviarMidiaChamado(pasta, arquivos[i]);
      const r = await registrarMidiaPortal(token, { envio, path, nome: arquivos[i].name, tipo: tipoDaMidia(arquivos[i]) });
      if (!r.ok) falhas.push(r.erro ?? arquivos[i].name);
    } catch (e) {
      falhas.push(e instanceof Error ? e.message : arquivos[i].name);
    }
  }
  return falhas;
}

/** Locatário pede conserto pelo portal (com fotos e vídeos). */
export function FormChamadoPortal({ token, contratos, telefone }: { token: string; contratos: Contrato[]; telefone: string | null }) {
  const arquivos = useRef<HTMLInputElement>(null);
  const [enviando, setEnviando] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [feito, setFeito] = useState<{ numero: number; falhas: string[]; garantia: boolean } | null>(null);
  const [qtd, setQtd] = useState(0);
  const router = useRouter();

  const enviar = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (enviando) return;
    const fd = new FormData(e.currentTarget);
    setErro(null);
    setEnviando("Abrindo o chamado…");
    try {
      const dados = Object.fromEntries(["contrato_id", "telefone", "titulo", "categoria", "urgencia", "local", "descricao"].map((k) => [k, String(fd.get(k) ?? "")]));
      const r = await abrirChamadoPortal(token, dados);
      if (!r.ok) {
        setErro(r.erro);
        return;
      }
      const lista = [...(arquivos.current?.files ?? [])].slice(0, 20);
      const falhas = await subirArquivos(token, r.chamado.envio, r.chamado.pasta, lista, setEnviando);
      setFeito({ numero: r.chamado.numero, falhas, garantia: r.chamado.garantia });
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
          <CheckCircle2 className="size-5" /> Chamado nº {feito.numero} aberto!
        </p>
        <p>A equipe vai analisar e entrar em contato. Acompanhe o andamento na lista abaixo.</p>
        {feito.garantia && <p className="text-sm">Encontramos um serviço parecido ainda na garantia: ele foi ligado a este chamado.</p>}
        {feito.falhas.length > 0 && <p className="text-sm text-ruim">Alguns arquivos não foram enviados: {feito.falhas.join(" · ")}</p>}
        <button type="button" onClick={() => setFeito(null)} className={classeBotao("secundario")}>
          Pedir outro conserto
        </button>
      </div>
    );

  if (contratos.length === 0) return <p className="text-sm text-texto-2">Você não tem contrato ativo para pedir conserto. Fale com a gente.</p>;

  return (
    <form onSubmit={enviar} className="space-y-4">
      {erro && (
        <div role="alert" className="rounded-[14px] border border-ruim-bd bg-ruim-bg px-4 py-3 text-sm text-ruim">
          {erro}
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo rotulo="Imóvel / contrato">
          <Selecao name="contrato_id" defaultValue={contratos[0]?.id} required>
            {contratos.map((c) => (
              <option key={c.id} value={c.id}>
                {c.rotulo}
              </option>
            ))}
          </Selecao>
        </Campo>
        <Campo rotulo="WhatsApp para contato">
          <Entrada name="telefone" inputMode="tel" defaultValue={telefone ?? ""} autoComplete="tel" />
        </Campo>
      </div>
      <Campo rotulo="Qual é o problema?">
        <Entrada name="titulo" required maxLength={160} placeholder="Ex.: vazamento embaixo da pia" />
      </Campo>
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo rotulo="Tipo">
          <Selecao name="categoria" defaultValue="hidraulica">
            {CATEGORIAS_CHAMADO.map((c) => (
              <option key={c} value={c}>
                {ROTULO_CATEGORIA[c]}
              </option>
            ))}
          </Selecao>
        </Campo>
        <Campo rotulo="Onde (cômodo)">
          <Entrada name="local" placeholder="Cozinha, banheiro…" />
        </Campo>
      </div>
      <fieldset className="space-y-2">
        <legend className="mb-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-mudo">Urgência</legend>
        {URGENCIAS.map((u) => (
          <label key={u} className="flex cursor-pointer items-start gap-2.5 rounded-[11px] border border-borda px-3 py-2.5 text-sm has-[:checked]:border-acento has-[:checked]:bg-acento-bg">
            <input type="radio" name="urgencia" value={u} defaultChecked={u === "media"} className="mt-0.5 size-4 accent-[var(--accent)]" />
            <span>
              <b className="text-texto">{ROTULO_URGENCIA[u]}</b> <span className="text-texto-2">— {DICA_URGENCIA[u]}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <Campo rotulo="Conte mais">
        <AreaTexto name="descricao" rows={4} placeholder="Desde quando acontece, melhores horários para o prestador ir…" />
      </Campo>
      <div className="flex flex-col gap-1.5">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-mudo">Fotos e vídeos (opcional)</span>
        <button
          type="button"
          onClick={() => arquivos.current?.click()}
          className="flex w-full flex-col items-center justify-center gap-1.5 rounded-[14px] border-2 border-dashed border-borda-forte px-4 py-6 text-sm text-texto-2 transition hover:border-acento hover:text-acento-hot"
        >
          <ImagePlus className="size-6" />
          {qtd ? `${qtd} arquivo(s) escolhido(s) — toque para trocar` : "Toque para escolher fotos ou vídeos (foto até 10 MB, vídeo até 50 MB)"}
        </button>
        <input ref={arquivos} type="file" multiple accept="image/*,video/mp4,video/quicktime,video/webm" className="hidden" aria-label="Escolher fotos e vídeos" onChange={(e) => setQtd(e.target.files?.length ?? 0)} />
      </div>
      <button type="submit" disabled={Boolean(enviando)} className={classeBotao("primario")}>
        {enviando ? <LoaderCircle className="size-4 animate-spin" /> : null}
        {enviando ?? "Pedir conserto"}
      </button>
    </form>
  );
}

/**
 * Enviar fotos/vídeos de um chamado pelo portal: o banco libera uma pasta por
 * 2 horas (só gravar, nunca ler) e registra cada arquivo.
 */
export function EnviarFotos({ token, chamadoId, rotulo = "Enviar fotos" }: { token: string; chamadoId: string; rotulo?: string }) {
  const entrada = useRef<HTMLInputElement>(null);
  const [estado, setEstado] = useState<string | null>(null);
  const [resultado, setResultado] = useState<{ ok: number; falhas: string[] } | null>(null);
  const [rodando, iniciar] = useTransition();
  const router = useRouter();

  const enviar = (lista: File[]) =>
    iniciar(async () => {
      setResultado(null);
      setEstado("Liberando o envio…");
      const p = await prepararEnvioPortal(token, chamadoId);
      if (!p.ok) {
        setEstado(null);
        setResultado({ ok: 0, falhas: [p.erro] });
        return;
      }
      const falhas = await subirArquivos(token, p.envio, p.pasta, lista.slice(0, 20), setEstado);
      setEstado(null);
      setResultado({ ok: Math.min(lista.length, 20) - falhas.length, falhas });
      router.refresh();
    });

  return (
    <div className="space-y-2">
      <button type="button" disabled={rodando} onClick={() => entrada.current?.click()} className={classeBotao("secundario")}>
        {rodando ? <LoaderCircle className="size-4 animate-spin" /> : <Camera className="size-4" />} {estado ?? rotulo}
      </button>
      <input
        ref={entrada}
        type="file"
        multiple
        accept="image/*,video/mp4,video/quicktime,video/webm"
        className="hidden"
        aria-label="Escolher fotos e vídeos"
        onChange={(e) => {
          const lista = [...(e.target.files ?? [])];
          e.target.value = "";
          if (lista.length) enviar(lista);
        }}
      />
      {resultado && (
        <p className={`text-sm ${resultado.falhas.length ? "text-ruim" : "text-ok"}`}>
          {resultado.ok > 0 ? `${resultado.ok} arquivo(s) enviado(s). ` : ""}
          {resultado.falhas.length ? `Não enviados: ${resultado.falhas.join(" · ")}` : ""}
        </p>
      )}
    </div>
  );
}
