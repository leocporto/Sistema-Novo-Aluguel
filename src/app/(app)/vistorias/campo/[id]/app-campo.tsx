"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { Camera, CheckCircle2, ChevronLeft, ChevronRight, CloudUpload, Gauge, LoaderCircle, Plus, RotateCcw, Trash2, Video, Wifi, WifiOff, X } from "lucide-react";
import { AbasSegmentadas } from "@/components/abas-segmentadas";
import { classeBotao } from "@/components/ui";
import {
  ROTULO_MEDIDOR,
  TIPOS_AMBIENTE,
  TIPOS_MEDIDOR,
  UNIDADE_MEDIDOR,
  aplicarFila,
  chaveOp,
  checklistDoAmbiente,
  descreverOp,
  estadoComDano,
  juntarOp,
  progressoVistoria,
  resumoFila,
  separarResultado,
  type AmbienteCampo,
  type MedidorCampo,
  type OpCampo,
  type OpRecusada,
} from "@/lib/dominio/vistorias";
import { descartarArquivosCampo, sincronizarCampo } from "../../actions";
import { caminhoMidia, carimboFoto, ehVideo, enviarMidiaVistoria, prepararFoto, validarMidia } from "../../arquivo-cliente";
import { apagarArquivo, gravarFila, gravarRecusadas, guardaFotosNoAparelho, guardarArquivo, lerArquivo, lerFila, lerRecusadas } from "../armazem";
import { guardarTelasNoAparelho, ligarModoOffline } from "../guardar-offline";

type Tela = { t: "inicio" } | { t: "ambiente"; id: string } | { t: "medidores" } | { t: "novo" };
type Alvo = { ambienteId: string | null; itemId: string | null; medidorId: string | null; rotulo: (string | null)[] };

const ESTADOS: [string, string][] = [
  ["novo", "Novo"],
  ["bom", "Bom"],
  ["regular", "Regular"],
  ["ruim", "Ruim"],
  ["danificado", "Danif."],
  ["nao_se_aplica", "N/A"],
];
const grande = "min-h-14! w-full! text-[15px]! rounded-[14px]!";
const campoTexto = "w-full rounded-[12px] border border-borda-forte bg-input px-3 py-2.5 text-[16px] text-texto outline-none focus:border-acento focus:ring-4 focus:ring-acento-bg";

const assinarOnline = (cb: () => void) => {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
};

const lerNumero = (s: string): number | null => {
  const t = s.trim();
  if (!t) return null;
  const n = Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/**
 * App de campo: um ambiente por vez, botões grandes e câmera do celular.
 * Toda alteração vai primeiro para a fila do aparelho (IndexedDB) e sobe
 * sozinha quando há internet — dá para fazer a vistoria inteira sem sinal.
 * A tela fica guardada no celular (service worker) e abre sem internet.
 * O que o sistema recusar (ex.: vistoria concluída por outra pessoa, item
 * excluído no computador) sai da fila e aparece numa lista para tentar de
 * novo ou descartar — nada trava o resto do envio.
 */
export function AppCampo({
  vistoriaId,
  organizacaoId,
  titulo,
  subtitulo,
  statusInicial,
  ambientes,
  medidores,
  fotos,
}: {
  vistoriaId: string;
  organizacaoId: string;
  titulo: string;
  subtitulo: string;
  statusInicial: string;
  ambientes: AmbienteCampo[];
  medidores: MedidorCampo[];
  /** Fotos já no sistema por ambiente/medidor. */
  fotos: Record<string, number>;
}) {
  const [base, setBase] = useState({ ambientes, medidores, status: statusInicial });
  const [fila, setFila] = useState<OpCampo[]>([]);
  const filaRef = useRef<OpCampo[]>([]);
  const [recusadas, setRecusadas] = useState<OpRecusada[]>([]);
  const recusadasRef = useRef<OpRecusada[]>([]);
  const [offline, setOffline] = useState<boolean | null>(null);
  const [carregou, setCarregou] = useState(false);
  const [sync, setSync] = useState<"parado" | "enviando" | "erro">("parado");
  const [erro, setErro] = useState<string | null>(null);
  const [tela, setTela] = useState<Tela>({ t: "inicio" });
  const [obsAberta, setObsAberta] = useState<Record<string, boolean>>({});
  const [contagem, setContagem] = useState<Record<string, number>>(fotos);
  const [novoTipo, setNovoTipo] = useState("quarto");
  const [novoNome, setNovoNome] = useState("");
  const rodando = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const inputFoto = useRef<HTMLInputElement>(null);
  const inputVideo = useRef<HTMLInputElement>(null);
  const alvo = useRef<Alvo>({ ambienteId: null, itemId: null, medidorId: null, rotulo: [] });
  const online = useSyncExternalStore(
    assinarOnline,
    () => navigator.onLine,
    () => true,
  );

  const dados = useMemo(() => aplicarFila(base.ambientes, base.medidores, fila), [base, fila]);
  const dadosRef = useRef(dados);
  useEffect(() => {
    dadosRef.current = dados;
  }, [dados]);
  const status = dados.status ?? base.status;
  const concluida = !["rascunho", "em_andamento"].includes(status);

  const mudarRecusadas = useCallback(
    (lista: OpRecusada[]) => {
      recusadasRef.current = lista;
      setRecusadas(lista);
      void gravarRecusadas(vistoriaId, lista);
    },
    [vistoriaId],
  );

  const sincronizar = useCallback(async () => {
    if (rodando.current || !navigator.onLine) return;
    const enviar = filaRef.current;
    if (!enviar.length) return;
    rodando.current = true;
    setSync("enviando");
    setErro(null);
    try {
      const prontas: OpCampo[] = [];
      const perdidas = new Set<string>();
      // Arquivo que o armazenamento recusou (com internet): vai para a lista, sem travar o resto.
      const naoSubiram: OpRecusada[] = [];
      for (const o of enviar) {
        if (o.op === "foto" && !o.path) {
          const a = await lerArquivo(o.id);
          if (!a) {
            perdidas.add(o.id);
            continue;
          }
          let path: string;
          try {
            path = await enviarMidiaVistoria(caminhoMidia(organizacaoId, vistoriaId, o.id, o.nome), a.blob, a.mime);
          } catch (e) {
            if (!navigator.onLine) throw e; // caiu a internet: tenta tudo de novo depois
            const d = dadosRef.current;
            naoSubiram.push({ op: o, tipo: "erro", motivo: e instanceof Error ? e.message : "Não foi possível enviar o arquivo.", descricao: descreverOp(o, d.ambientes, d.medidores) });
            continue;
          }
          const comCaminho: OpCampo = { ...o, path };
          prontas.push(comCaminho);
          // Guarda o caminho: se a internet cair agora, não sobe o arquivo de novo.
          filaRef.current = filaRef.current.map((x) => (x.op === "foto" && x.id === o.id ? comCaminho : x));
          await gravarFila(vistoriaId, filaRef.current);
        } else prontas.push(o);
      }
      const r = await sincronizarCampo(vistoriaId, prontas);
      if (!r.ok) throw new Error(r.erro ?? "Não foi possível sincronizar.");
      // Cada alteração é tratada sozinha: as aceitas saem da fila, as recusadas vão para a lista.
      const { resto, aceitas, recusadas: novas } = separarResultado(filaRef.current, prontas, r.recusas ?? []);
      const fora = new Set([...perdidas, ...naoSubiram.map((x) => (x.op.op === "foto" ? x.op.id : ""))]);
      const fica = resto.filter((o) => !(o.op === "foto" && fora.has(o.id)));
      filaRef.current = fica;
      setFila(fica);
      await gravarFila(vistoriaId, fica);
      setBase((b) => {
        const n = aplicarFila(b.ambientes, b.medidores, aceitas);
        return { ambientes: n.ambientes, medidores: n.medidores, status: r.status ?? n.status ?? b.status };
      });
      if (novas.length || naoSubiram.length) {
        const d = dadosRef.current;
        const lista = [...novas.map((n) => ({ ...n, descricao: descreverOp(n.op, d.ambientes, d.medidores) })), ...naoSubiram];
        const chaves = new Set(lista.map((n) => chaveOp(n.op)));
        mudarRecusadas([...recusadasRef.current.filter((x) => !chaves.has(chaveOp(x.op))), ...lista]);
      }
      // O arquivo já subiu (aceito ou não): a cópia do aparelho não é mais necessária.
      for (const o of prontas) if (o.op === "foto") void apagarArquivo(o.id);
      setSync("parado");
      const avisos = [...(r.avisos ?? []), perdidas.size ? `${perdidas.size} foto(s) se perderam no aparelho e não foram enviadas.` : null].filter(Boolean);
      if (avisos.length) setErro(avisos.join(" "));
      // Tudo enviado: a cópia da tela guardada para uso sem internet passa a ter os dados novos.
      if (!fica.length) void guardarTelasNoAparelho();
    } catch (e) {
      setSync("erro");
      setErro(navigator.onLine ? (e instanceof Error ? e.message : "Não foi possível sincronizar.") : "Sem internet: tudo fica guardado no aparelho e sobe quando a internet voltar.");
    } finally {
      rodando.current = false;
    }
  }, [organizacaoId, vistoriaId, mudarRecusadas]);

  const sincronizarRef = useRef(sincronizar);
  useEffect(() => {
    sincronizarRef.current = sincronizar;
  }, [sincronizar]);

  const agendar = useCallback((ms: number) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void sincronizarRef.current(), ms);
  }, []);

  // Abre a fila guardada no aparelho (alterações de antes que ainda não subiram) e o que foi recusado.
  useEffect(() => {
    let vivo = true;
    void Promise.all([lerFila(vistoriaId), lerRecusadas(vistoriaId)]).then(([f, rec]) => {
      if (!vivo) return;
      filaRef.current = f;
      setFila(f);
      recusadasRef.current = rec;
      setRecusadas(rec);
      setCarregou(true);
      if (f.length) void sincronizarRef.current();
    });
    // Guarda esta tela no celular para abrir mesmo sem internet.
    void ligarModoOffline().then((ok) => vivo && setOffline(ok));
    const t = setInterval(() => {
      if (filaRef.current.length) void sincronizarRef.current();
    }, 30_000);
    return () => {
      vivo = false;
      clearInterval(t);
      clearTimeout(timer.current);
    };
  }, [vistoriaId]);

  // Internet voltou: envia o que estiver guardado.
  useEffect(() => {
    if (online && carregou) agendar(500);
  }, [online, carregou, agendar]);

  /** Põe de volta na fila o que foi recusado (ex.: depois de reabrir a vistoria no computador). */
  const tentarDeNovo = () => {
    let f = filaRef.current;
    for (const x of recusadasRef.current) if (!f.some((o) => chaveOp(o) === chaveOp(x.op))) f = [...f, x.op];
    filaRef.current = f;
    setFila(f);
    void gravarFila(vistoriaId, f);
    mudarRecusadas([]);
    agendar(0);
  };

  /** Desiste do que foi recusado (fotos que já subiram são apagadas do sistema). */
  const descartar = async (lista: OpRecusada[]) => {
    const chaves = new Set(lista.map((x) => chaveOp(x.op)));
    mudarRecusadas(recusadasRef.current.filter((x) => !chaves.has(chaveOp(x.op))));
    const caminhos: string[] = [];
    for (const x of lista)
      if (x.op.op === "foto") {
        void apagarArquivo(x.op.id);
        if (x.op.path) caminhos.push(x.op.path);
      }
    if (caminhos.length) await descartarArquivosCampo(vistoriaId, caminhos).catch(() => undefined);
  };

  const alterar = (op: OpCampo, espera = 1200) => {
    const nova = juntarOp(filaRef.current, op);
    filaRef.current = nova;
    setFila(nova);
    void gravarFila(vistoriaId, nova);
    agendar(espera);
  };

  const fotografar = (a: Alvo, video = false) => {
    alvo.current = a;
    (video ? inputVideo : inputFoto).current?.click();
  };

  const aoEscolher = async (arquivos: FileList | null) => {
    if (!arquivos?.length) return;
    const a = alvo.current;
    setErro(null);
    for (const f of [...arquivos]) {
      const invalido = validarMidia(f);
      if (invalido) {
        setErro(invalido);
        continue;
      }
      // A mesma data e hora vão na imagem e no registro (laudo).
      const quando = f.lastModified ? new Date(f.lastModified) : new Date();
      const p = await prepararFoto(f, carimboFoto(a.rotulo, quando));
      const id = crypto.randomUUID();
      await guardarArquivo(id, { blob: p.blob, mime: p.mime, nome: p.nome });
      alterar(
        {
          op: "foto",
          id,
          ambienteId: a.ambienteId,
          itemId: a.itemId,
          medidorId: a.medidorId,
          tipo: ehVideo(p.mime) ? "video" : "foto",
          legenda: null,
          nome: p.nome,
          mime: p.mime,
          tiradaEm: quando.toISOString(),
        },
        500,
      );
      const chave = a.medidorId ? `m:${a.medidorId}` : (a.ambienteId ?? "geral");
      setContagem((c) => ({ ...c, [chave]: (c[chave] ?? 0) + 1, ...(a.itemId ? { [`i:${a.itemId}`]: (c[`i:${a.itemId}`] ?? 0) + 1 } : {}) }));
    }
    if (inputFoto.current) inputFoto.current.value = "";
    if (inputVideo.current) inputVideo.current.value = "";
  };

  const pendentes = fila.length;
  const barraEnvio = (
    <div
      className={`flex items-center justify-between gap-3 rounded-[14px] border px-4 py-3 text-sm ${!online ? "border-alerta-bd bg-alerta-bg" : sync === "erro" ? "border-ruim-bd bg-ruim-bg" : "border-borda bg-card"}`}
      role="status"
    >
      <span className="flex min-w-0 items-center gap-2">
        {sync === "enviando" ? <LoaderCircle className="size-4 shrink-0 animate-spin" /> : online ? <Wifi className="size-4 shrink-0 text-ok" /> : <WifiOff className="size-4 shrink-0 text-alerta" />}
        <span className="min-w-0">
          {sync === "enviando"
            ? "Enviando…"
            : pendentes
              ? `${online ? "Para enviar" : "Sem internet — guardado no aparelho"}: ${resumoFila(fila)}`
              : recusadas.length
                ? "Enviado, mas com alterações não aceitas (veja abaixo)"
                : online
                  ? "Tudo salvo no sistema"
                  : "Sem internet (o que fizer fica no aparelho)"}
          {erro && <span className="block text-xs text-ruim">{erro}</span>}
        </span>
      </span>
      {pendentes > 0 && online && sync !== "enviando" && (
        <button type="button" onClick={() => void sincronizar()} className={classeBotao("secundario", "sm")}>
          <CloudUpload className="size-3.5" /> Enviar
        </button>
      )}
    </div>
  );

  const barra = (
    <>
      {barraEnvio}
      {recusadas.length > 0 && (
        <div className="space-y-3 rounded-[14px] border border-ruim-bd bg-ruim-bg px-4 py-3 text-sm" role="alert">
          <p className="font-semibold text-ruim">{recusadas.length === 1 ? "1 alteração não foi aceita pelo sistema" : `${recusadas.length} alterações não foram aceitas pelo sistema`}</p>
          <ul className="space-y-2">
            {recusadas.map((x) => (
              <li key={chaveOp(x.op)} className="flex items-start justify-between gap-2 border-t border-ruim-bd pt-2 first:border-0 first:pt-0">
                <span className="min-w-0">
                  <span className="block font-medium text-texto">{x.descricao}</span>
                  <span className="block text-xs text-texto-2">{x.motivo}</span>
                </span>
                <button type="button" aria-label={`Descartar: ${x.descricao}`} title="Descartar" onClick={() => void descartar([x])} className={classeBotao("fantasma", "sm")}>
                  <X className="size-4 text-ruim" />
                </button>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={tentarDeNovo} disabled={!online || sync === "enviando"} className={classeBotao("secundario", "sm")}>
              <RotateCcw className="size-3.5" /> Tentar de novo
            </button>
            <button
              type="button"
              onClick={() => {
                if (window.confirm("Descartar todas as alterações não aceitas? Elas não vão para o sistema (fotos incluídas).")) void descartar(recusadasRef.current);
              }}
              className={classeBotao("fantasma", "sm")}
            >
              <Trash2 className="size-3.5 text-ruim" /> Descartar todas
            </button>
          </div>
        </div>
      )}
    </>
  );

  const inputs = (
    <>
      <input ref={inputFoto} type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={(e) => void aoEscolher(e.target.files)} />
      <input ref={inputVideo} type="file" accept="video/*" capture="environment" className="hidden" onChange={(e) => void aoEscolher(e.target.files)} />
    </>
  );

  if (!carregou) return <p className="py-10 text-center text-sm text-mudo">Abrindo a vistoria no aparelho…</p>;

  // Um ambiente por vez ---------------------------------------------------------
  const idx = tela.t === "ambiente" ? dados.ambientes.findIndex((x) => x.id === tela.id) : -1;
  if (idx >= 0) {
    const a = dados.ambientes[idx];
    const p = progressoVistoria(a.itens);
    const anterior = dados.ambientes[idx - 1];
    const proximo = dados.ambientes[idx + 1];
    return (
      <div className="mx-auto max-w-xl space-y-4 pb-24">
        {inputs}
        <div className="flex items-center justify-between gap-2">
          <button type="button" onClick={() => setTela({ t: "inicio" })} className={classeBotao("fantasma")}>
            <ChevronLeft className="size-4" /> Ambientes
          </button>
          <span className="font-mono text-xs text-mudo">
            {idx + 1} de {dados.ambientes.length}
          </span>
        </div>
        <div>
          <h1 className="text-[26px] font-semibold leading-tight text-texto">{a.nome}</h1>
          <p className="text-sm text-texto-2">
            {p.avaliados} de {p.total} itens · {contagem[a.id] ?? 0} foto(s)
          </p>
        </div>
        {barra}
        {!concluida && (
          <div className="grid grid-cols-2 gap-3">
            <button type="button" onClick={() => fotografar({ ambienteId: a.id, itemId: null, medidorId: null, rotulo: [a.nome] })} className={`${classeBotao("primario")} ${grande}`}>
              <Camera className="size-5" /> Foto
            </button>
            <button type="button" onClick={() => fotografar({ ambienteId: a.id, itemId: null, medidorId: null, rotulo: [a.nome] }, true)} className={`${classeBotao("secundario")} ${grande}`}>
              <Video className="size-5" /> Vídeo
            </button>
          </div>
        )}
        <ul className="space-y-3">
          {a.itens.map((i) => {
            const mostrarObs = obsAberta[i.id] || Boolean(i.observacao) || estadoComDano(i.estado);
            return (
              <li key={i.id} className={`rounded-card border bg-card p-4 ${estadoComDano(i.estado) ? "border-ruim-bd" : i.estado ? "border-ok-bd" : "border-borda"}`}>
                <div className="mb-3 flex items-center justify-between gap-2">
                  <span className="text-[16px] font-semibold text-texto">{i.nome}</span>
                  {!concluida && (
                    <button
                      type="button"
                      aria-label={`Foto de ${i.nome}`}
                      onClick={() => fotografar({ ambienteId: a.id, itemId: i.id, medidorId: null, rotulo: [a.nome, i.nome] })}
                      className={classeBotao("secundario", "sm")}
                    >
                      <Camera className="size-4" /> {contagem[`i:${i.id}`] ?? ""}
                    </button>
                  )}
                </div>
                <div className="overflow-x-auto">
                  <AbasSegmentadas
                    variante="seg"
                    className="w-full! [&>.abas-btn]:min-h-11! [&>.abas-btn]:flex-1 [&>.abas-btn]:px-1.5!"
                    rotuloAcessivel={`Estado de ${i.nome}`}
                    valor={i.estado}
                    aoMudar={(estado) => !concluida && alterar({ op: "item", id: i.id, ambienteId: a.id, estado, observacao: i.observacao }, 800)}
                    itens={ESTADOS.map(([id, rotulo]) => ({ id, rotulo }))}
                  />
                </div>
                {mostrarObs ? (
                  <textarea
                    aria-label={`Observação: ${i.nome}`}
                    value={i.observacao ?? ""}
                    disabled={concluida}
                    onChange={(e) => alterar({ op: "item", id: i.id, ambienteId: a.id, estado: i.estado, observacao: e.target.value }, 2500)}
                    placeholder="O que você viu? (ex.: risco perto da janela)"
                    rows={2}
                    className={`${campoTexto} mt-3`}
                  />
                ) : (
                  !concluida && (
                    <button type="button" onClick={() => setObsAberta((o) => ({ ...o, [i.id]: true }))} className={`${classeBotao("fantasma", "sm")} mt-2`}>
                      <Plus className="size-3.5" /> observação
                    </button>
                  )
                )}
              </li>
            );
          })}
        </ul>
        <label className="block">
          <span className="mb-1.5 block font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-mudo">Observações do ambiente</span>
          <textarea value={a.observacoes ?? ""} disabled={concluida} onChange={(e) => alterar({ op: "ambiente_obs", id: a.id, observacoes: e.target.value }, 2500)} rows={3} className={campoTexto} />
        </label>
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-borda bg-card/95 p-3 backdrop-blur">
          <div className="mx-auto grid max-w-xl grid-cols-2 gap-3">
            <button
              type="button"
              disabled={!anterior}
              onClick={() => {
                if (!anterior) return;
                window.scrollTo(0, 0);
                setTela({ t: "ambiente", id: anterior.id });
              }}
              className={`${classeBotao("secundario")} ${grande}`}
            >
              <ChevronLeft className="size-5" /> {anterior?.nome ?? "—"}
            </button>
            <button
              type="button"
              onClick={() => {
                window.scrollTo(0, 0);
                setTela(proximo ? { t: "ambiente", id: proximo.id } : { t: "inicio" });
              }}
              className={`${classeBotao("primario")} ${grande}`}
            >
              {proximo ? proximo.nome : "Terminei"} <ChevronRight className="size-5" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Medidores --------------------------------------------------------------------
  if (tela.t === "medidores")
    return (
      <div className="mx-auto max-w-xl space-y-4 pb-10">
        {inputs}
        <button type="button" onClick={() => setTela({ t: "inicio" })} className={classeBotao("fantasma")}>
          <ChevronLeft className="size-4" /> Ambientes
        </button>
        <h1 className="text-[26px] font-semibold text-texto">Medidores</h1>
        {barra}
        {dados.medidores.map((m) => (
          <div key={m.id} className="space-y-3 rounded-card border border-borda bg-card p-4">
            <div className="flex items-center justify-between">
              <span className="text-[16px] font-semibold text-texto">{ROTULO_MEDIDOR[m.tipo]}</span>
              {!concluida && (
                <button
                  type="button"
                  aria-label={`Foto do medidor de ${ROTULO_MEDIDOR[m.tipo].toLowerCase()}`}
                  onClick={() => fotografar({ ambienteId: null, itemId: null, medidorId: m.id, rotulo: [`Medidor de ${ROTULO_MEDIDOR[m.tipo].toLowerCase()}`] })}
                  className={classeBotao("secundario", "sm")}
                >
                  <Camera className="size-4" /> {contagem[`m:${m.id}`] ?? ""}
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <input
                aria-label="Número do medidor"
                placeholder="Nº do medidor"
                disabled={concluida}
                defaultValue={m.numero ?? ""}
                onChange={(e) => alterar({ op: "medidor", id: m.id, tipo: m.tipo, numero: e.target.value.trim() || null, leitura: m.leitura }, 2500)}
                className={campoTexto}
              />
              <input
                aria-label={`Leitura em ${UNIDADE_MEDIDOR[m.tipo]}`}
                placeholder={`Leitura (${UNIDADE_MEDIDOR[m.tipo]})`}
                inputMode="decimal"
                disabled={concluida}
                defaultValue={m.leitura === null ? "" : String(m.leitura).replace(".", ",")}
                onChange={(e) => alterar({ op: "medidor", id: m.id, tipo: m.tipo, numero: m.numero, leitura: lerNumero(e.target.value) }, 2500)}
                className={campoTexto}
              />
            </div>
          </div>
        ))}
        {dados.medidores.length === 0 && <p className="text-sm text-mudo">Nenhum medidor registrado.</p>}
        {!concluida && (
          <div className="grid grid-cols-3 gap-2">
            {TIPOS_MEDIDOR.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => alterar({ op: "medidor", id: crypto.randomUUID(), tipo: t, numero: null, leitura: null }, 1500)}
                className={`${classeBotao("secundario")} ${grande}`}
              >
                <Plus className="size-4" /> {t === "energia" ? "Luz" : ROTULO_MEDIDOR[t]}
              </button>
            ))}
          </div>
        )}
      </div>
    );

  // Novo ambiente -------------------------------------------------------------------
  if (tela.t === "novo")
    return (
      <div className="mx-auto max-w-xl space-y-4">
        <button type="button" onClick={() => setTela({ t: "inicio" })} className={classeBotao("fantasma")}>
          <ChevronLeft className="size-4" /> Ambientes
        </button>
        <h1 className="text-[26px] font-semibold text-texto">Novo ambiente</h1>
        <label className="block">
          <span className="mb-1.5 block font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-mudo">Tipo</span>
          <select value={novoTipo} onChange={(e) => setNovoTipo(e.target.value)} className={`${campoTexto} min-h-14`}>
            {Object.entries(TIPOS_AMBIENTE).map(([k, t]) => (
              <option key={k} value={k}>
                {t.rotulo}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1.5 block font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-mudo">Nome (opcional)</span>
          <input value={novoNome} onChange={(e) => setNovoNome(e.target.value)} placeholder={TIPOS_AMBIENTE[novoTipo].rotulo} className={`${campoTexto} min-h-14`} />
        </label>
        <button
          type="button"
          onClick={() => {
            const id = crypto.randomUUID();
            alterar(
              { op: "ambiente", id, nome: novoNome.trim() || TIPOS_AMBIENTE[novoTipo].rotulo, tipo: novoTipo, itens: checklistDoAmbiente(novoTipo).map((nome) => ({ id: crypto.randomUUID(), nome })) },
              800,
            );
            setNovoNome("");
            setTela({ t: "ambiente", id });
          }}
          className={`${classeBotao("primario")} ${grande}`}
        >
          <Plus className="size-5" /> Criar com o checklist padrão
        </button>
      </div>
    );

  // Início: lista de ambientes -------------------------------------------------------
  const geral = progressoVistoria(dados.ambientes.flatMap((a) => a.itens));
  return (
    <div className="mx-auto max-w-xl space-y-4 pb-10">
      {inputs}
      <div>
        <Link href={`/vistorias/${vistoriaId}`} className="text-sm text-acento hover:underline">
          ‹ ficha completa
        </Link>
        <h1 className="mt-1 text-[26px] font-semibold leading-tight text-texto">{titulo}</h1>
        <p className="text-sm text-texto-2">{subtitulo}</p>
        <p className="mt-1 text-sm text-texto-2">
          {geral.avaliados} de {geral.total} itens avaliados{geral.danos ? ` · ${geral.danos} com dano` : ""}
        </p>
      </div>
      {barra}
      {!guardaFotosNoAparelho() && <p className="text-xs text-alerta">Este navegador não guarda fotos sem internet: envie antes de fechar a tela.</p>}
      {concluida && (
        <div className="rounded-[14px] border border-ok-bd bg-ok-bg px-4 py-3 text-sm text-ok">
          Vistoria concluída. Confira tudo e gere o laudo para assinatura na{" "}
          <Link href={`/vistorias/${vistoriaId}/assinaturas`} className="font-semibold underline">
            ficha da vistoria
          </Link>
          .
        </div>
      )}
      <ul className="space-y-2">
        {dados.ambientes.map((a) => {
          const p = progressoVistoria(a.itens);
          return (
            <li key={a.id}>
              <button type="button" onClick={() => setTela({ t: "ambiente", id: a.id })} className={`${classeBotao("secundario")} ${grande} justify-between!`}>
                <span className="flex items-center gap-2">
                  {p.total > 0 && p.faltam === 0 ? <CheckCircle2 className="size-5 text-ok" /> : <span className="size-5 rounded-full border-2 border-borda-forte" />}
                  {a.nome}
                </span>
                <span className="font-mono text-xs text-mudo">
                  {p.avaliados}/{p.total}
                  {p.danos ? ` · ${p.danos} dano` : ""}
                </span>
              </button>
            </li>
          );
        })}
        {!dados.ambientes.length && <li className="text-sm text-mudo">Nenhum ambiente. Crie o primeiro abaixo.</li>}
      </ul>
      <div className="grid grid-cols-2 gap-3">
        <button type="button" onClick={() => setTela({ t: "medidores" })} className={`${classeBotao("secundario")} ${grande}`}>
          <Gauge className="size-5" /> Medidores ({dados.medidores.length})
        </button>
        {!concluida && (
          <button type="button" onClick={() => setTela({ t: "novo" })} className={`${classeBotao("secundario")} ${grande}`}>
            <Plus className="size-5" /> Ambiente
          </button>
        )}
        {!concluida && (
          <button type="button" onClick={() => fotografar({ ambienteId: null, itemId: null, medidorId: null, rotulo: ["Geral"] })} className={`${classeBotao("secundario")} ${grande}`}>
            <Camera className="size-5" /> Foto geral
          </button>
        )}
      </div>
      {!concluida && (
        <button
          type="button"
          onClick={() => {
            if (window.confirm(geral.faltam ? `Ainda faltam ${geral.faltam} item(ns) sem avaliação. Concluir mesmo assim?` : "Concluir a vistoria? Depois dá para gerar o laudo para assinatura."))
              alterar({ op: "status", status: "concluida" }, 300);
          }}
          className={`${classeBotao("primario")} ${grande}`}
        >
          <CheckCircle2 className="size-5" /> Concluir vistoria
        </button>
      )}
      <details className="rounded-[14px] border border-borda bg-card px-4 py-3 text-sm text-texto-2">
        <summary className="cursor-pointer font-semibold text-texto">Funciona sem internet?</summary>
        <p className="mt-2">
          Sim. Abra esta vistoria uma vez com internet antes de ir ao imóvel: a tela fica guardada no celular e abre (e recarrega) mesmo sem sinal. O checklist, as observações, os medidores, as fotos
          e os vídeos ficam guardados neste aparelho e sobem sozinhos quando a internet voltar (aparece “Tudo salvo no sistema”). Se fechar a tela, nada se perde: abra de novo e o envio continua.
        </p>
        <p className="mt-2">
          Se o sistema recusar alguma coisa (por exemplo, a vistoria foi concluída por outra pessoa ou um item foi excluído no computador), ela aparece numa lista vermelha: dá para tentar de novo
          (depois de reabrir a vistoria) ou descartar. O resto é enviado normalmente.
        </p>
        <p className="mt-2">Sem internet não dá para abrir as outras telas do sistema, nem gerar o laudo ou mandar para assinatura — isso fica para depois, na ficha.</p>
        {offline === false && <p className="mt-2 text-alerta">Este navegador não deixou guardar a tela: ela funciona sem internet só enquanto ficar aberta (não recarregue).</p>}
      </details>
    </div>
  );
}
