"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import { Minus, Plus, X } from "lucide-react";
import { enquadrar, projetar, tilesVisiveis, TAMANHO_TILE } from "@/lib/dominio/site";

export type PinoMapa = { codigo: string; lat: number; lon: number; titulo: string; preco: string; href: string; foto: string | null; resumo: string };

/** Endereço dos quadradinhos do mapa (OpenStreetMap; troque aqui por um provedor contratado se o tráfego crescer). */
const TILE = (z: number, x: number, y: number) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
const ZOOM_MIN = 3;
const ZOOM_MAX = 18;

type Vista = { zoom: number; x: number; y: number };

/**
 * Mapa com vários imóveis (marcadores com o preço). Arrastar move o mapa;
 * + e − mudam o zoom; tocar no marcador abre o resumo do imóvel. Sem chave
 * de API: usa os mapas abertos do OpenStreetMap.
 */
export function MapaSite({ pinos, altura = 460 }: { pinos: PinoMapa[]; altura?: number }) {
  const caixa = useRef<HTMLDivElement>(null);
  const arrasto = useRef<{ px: number; py: number; x: number; y: number; moveu: boolean } | null>(null);
  const [largura, setLargura] = useState(0);
  const [vista, setVista] = useState<Vista | null>(null);
  const [aberto, setAberto] = useState<string | null>(null);
  const [arrastando, setArrastando] = useState(false);

  // Mede a largura e enquadra todos os imóveis na primeira vez.
  useEffect(() => {
    const el = caixa.current;
    if (!el) return;
    const obs = new ResizeObserver(([e]) => {
      const w = Math.round(e.contentRect.width);
      setLargura(w);
      setVista((v) => v ?? enquadrar(pinos, w, altura));
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, [pinos, altura]);

  const zoom = (passo: number) =>
    setVista((v) => {
      if (!v) return v;
      const z = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, v.zoom + passo));
      const f = 2 ** (z - v.zoom);
      return { zoom: z, x: v.x * f, y: v.y * f };
    });

  const inicio = (e: PointerEvent<HTMLDivElement>) => {
    if (!vista || (e.target as HTMLElement).closest("button, a")) return;
    arrasto.current = { px: e.clientX, py: e.clientY, x: vista.x, y: vista.y, moveu: false };
    setArrastando(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const mover = (e: PointerEvent<HTMLDivElement>) => {
    const a = arrasto.current;
    if (!a) return;
    const dx = e.clientX - a.px;
    const dy = e.clientY - a.py;
    if (Math.abs(dx) + Math.abs(dy) > 3) a.moveu = true;
    setVista((v) => (v ? { ...v, x: a.x - dx, y: a.y - dy } : v));
  };
  const fim = () => {
    if (arrasto.current && !arrasto.current.moveu) setAberto(null);
    arrasto.current = null;
    setArrastando(false);
  };

  const sel = pinos.find((p) => p.codigo === aberto);
  const tiles = vista && largura ? tilesVisiveis(vista.x, vista.y, vista.zoom, largura, altura) : [];
  const z = vista?.zoom ?? 0;
  const posicao = (lat: number, lon: number) => {
    if (!vista) return null;
    const p = projetar(lat, lon, vista.zoom);
    return { left: p.x - (vista.x - largura / 2), top: p.y - (vista.y - altura / 2) };
  };
  const botaoZoom = "grid size-9 place-items-center rounded-[10px] border border-borda bg-card text-texto shadow-sm transition hover:-translate-y-px active:scale-90";

  return (
    <div
      ref={caixa}
      className="relative touch-none select-none overflow-hidden rounded-card border border-borda bg-elev"
      style={{ height: altura, cursor: arrastando ? "grabbing" : "grab" }}
      onPointerDown={inicio}
      onPointerMove={mover}
      onPointerUp={fim}
      onPointerCancel={fim}
      onDoubleClick={() => zoom(1)}
      role="application"
      aria-label="Mapa dos imóveis"
    >
      {tiles.map((t) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={t.chave}
          src={TILE(z, t.x, t.y)}
          alt=""
          draggable={false}
          className="pointer-events-none absolute max-w-none"
          style={{ left: t.esquerda, top: t.topo, width: TAMANHO_TILE, height: TAMANHO_TILE }}
        />
      ))}
      {vista &&
        pinos.map((p) => {
          const pos = posicao(p.lat, p.lon);
          if (!pos || pos.left < -60 || pos.left > largura + 60 || pos.top < -30 || pos.top > altura + 30) return null;
          const ativo = p.codigo === aberto;
          return (
            <button
              key={p.codigo}
              type="button"
              onClick={() => setAberto(ativo ? null : p.codigo)}
              className={`absolute -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-full border px-2.5 py-1 text-[12px] font-bold shadow-md transition hover:z-20 hover:scale-105 ${
                ativo ? "z-20 border-acento bg-acento text-white" : "z-10 border-borda bg-card text-texto"
              }`}
              style={{ left: pos.left, top: pos.top }}
              aria-label={`${p.titulo} — ${p.preco}`}
            >
              {p.preco}
            </button>
          );
        })}
      {sel && (
        <div className="absolute bottom-3 left-3 right-3 z-30 flex max-w-md gap-3 rounded-[14px] border border-borda bg-card p-2.5 shadow-lg sm:right-auto">
          {sel.foto ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={sel.foto} alt="" className="size-20 shrink-0 rounded-[10px] object-cover" />
          ) : (
            <div className="size-20 shrink-0 rounded-[10px] bg-elev" />
          )}
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-semibold text-acento">{sel.preco}</div>
            <div className="truncate text-sm font-medium text-texto">{sel.titulo}</div>
            <div className="truncate text-xs text-mudo">{sel.resumo}</div>
            <Link href={sel.href} className="mt-1 inline-block text-sm font-semibold text-acento hover:underline">
              Ver imóvel →
            </Link>
          </div>
          <button type="button" onClick={() => setAberto(null)} className="self-start text-mudo hover:text-texto" aria-label="Fechar">
            <X className="size-4" />
          </button>
        </div>
      )}
      <div className="absolute right-3 top-3 z-30 flex flex-col gap-1.5">
        <button type="button" className={botaoZoom} onClick={() => zoom(1)} aria-label="Aproximar">
          <Plus className="size-4" />
        </button>
        <button type="button" className={botaoZoom} onClick={() => zoom(-1)} aria-label="Afastar">
          <Minus className="size-4" />
        </button>
      </div>
      <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" className="absolute bottom-0 right-0 z-30 bg-card/85 px-1.5 text-[10px] text-texto-2">
        © OpenStreetMap
      </a>
    </div>
  );
}
