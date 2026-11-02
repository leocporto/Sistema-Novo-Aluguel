"use client";

/**
 * <AbasSegmentadas>: grupo de seleção única com a pílula elástica ativa (azul,
 * conteúdo branco, recortada por clip-path) e uma pílula de hover neutra, com a
 * mesma física. Variantes: "nav" (barra do topo), "lateral" (menu) e "seg".
 * <Contador>: número que conta até o valor.
 * Visual em globals.css (.abas / .v-<variante>).
 */
import { useEffect, useLayoutEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { moverPilula, remedirPilula, type EstadoPilula } from "@/lib/movimento/pilula";
import { useContagem } from "@/lib/movimento/useContagem";
import { formatarReais } from "@/lib/dominio/dinheiro";

const useLayoutIso = typeof window !== "undefined" ? useLayoutEffect : useEffect;

export type ItemAba = {
  id: string;
  rotulo: ReactNode;
  titulo?: string;
  className?: string;
  /** Linha que não é aba (ex.: título de grupo do menu). */
  ehRotulo?: boolean;
};

type Variante = "nav" | "lateral" | "seg";
const RAIO: Record<Variante, number> = { nav: 12, lateral: 13, seg: 10 };

export function AbasSegmentadas({
  itens,
  valor,
  aoMudar,
  variante = "seg",
  className = "",
  rotuloAcessivel,
  aoPassar,
}: {
  itens: ItemAba[];
  valor: string | null | undefined;
  aoMudar: (id: string) => void;
  variante?: Variante;
  className?: string;
  rotuloAcessivel?: string;
  /** Chamado ao passar o mouse/foco numa aba (ex.: pré-carregar a rota). */
  aoPassar?: (id: string) => void;
}) {
  const caixa = useRef<HTMLDivElement>(null);
  const camada = useRef<HTMLDivElement>(null);
  const hover = useRef<HTMLDivElement>(null);
  const ativa = useRef<EstadoPilula>({});
  const estHover = useRef<EstadoPilula>({});
  const idxHover = useRef(-1);
  const idxAnterior = useRef<number | null>(null);
  const raio = RAIO[variante];

  const abas = itens.filter((i) => !i.ehRotulo);
  const idx = valor == null ? -1 : abas.findIndex((a) => a.id === valor);
  const chave = itens.map((i) => (i.ehRotulo ? "#" : "") + i.id).join("|");
  const idxRef = useRef(idx);
  useEffect(() => {
    idxRef.current = idx;
  }, [idx]);

  // Troca de aba: anima. Primeira vez (ou lista mudou com a mesma aba): só mede.
  useLayoutIso(() => {
    const animar = idxAnterior.current !== null && idxAnterior.current !== idx;
    moverPilula(caixa.current, camada.current, idx, ativa.current, animar, raio);
    idxAnterior.current = idx;
  }, [idx, chave, raio]);

  // Remede sem animar quando o tamanho muda (janela, menu abrindo, fonte).
  useEffect(() => {
    const el = caixa.current;
    if (!el) return;
    const estAtiva = ativa.current;
    const estHov = estHover.current;
    const remede = () => {
      remedirPilula(caixa.current, camada.current, idxRef.current, estAtiva, raio);
      if (idxHover.current >= 0) remedirPilula(caixa.current, hover.current, idxHover.current, estHov, raio);
    };
    let ro: ResizeObserver | null = null;
    try {
      ro = new ResizeObserver(remede);
      ro.observe(el);
    } catch {
      /* navegador antigo */
    }
    document.fonts?.ready?.then(remede).catch(() => {});
    window.addEventListener("resize", remede);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", remede);
      cancelAnimationFrame(estAtiva.raf ?? 0);
      cancelAnimationFrame(estHov.raf ?? 0);
    };
  }, [raio]);

  const entrarHover = (i: number, id: string) => {
    const h = hover.current;
    if (!h) return;
    moverPilula(caixa.current, h, i, estHover.current, idxHover.current >= 0, raio);
    h.style.opacity = "1";
    idxHover.current = i;
    aoPassar?.(id);
  };
  const sairHover = () => {
    if (hover.current) hover.current.style.opacity = "0";
    idxHover.current = -1;
  };

  let k = -1;
  return (
    <div ref={caixa} className={`abas v-${variante} ${className}`} onMouseLeave={sairHover} role="group" aria-label={rotuloAcessivel}>
      <div ref={hover} className="abas-hover" aria-hidden="true" />
      {itens.map((it) => {
        if (it.ehRotulo)
          return (
            <div key={"r" + it.id} className={it.className}>
              {it.rotulo}
            </div>
          );
        const i = ++k;
        return (
          <button
            key={it.id}
            type="button"
            data-aba="1"
            className={`abas-btn ${it.className ?? ""}${i === idx ? " on" : ""}`}
            title={it.titulo}
            aria-pressed={i === idx}
            aria-label={typeof it.rotulo === "string" ? undefined : it.titulo}
            onClick={() => aoMudar(it.id)}
            onMouseEnter={() => entrarHover(i, it.id)}
            onFocus={() => entrarHover(i, it.id)}
            onBlur={sairHover}
          >
            {it.rotulo}
          </button>
        );
      })}
      <div ref={camada} className={`abas-camada v-${variante} ${className}`} aria-hidden="true" style={{ clipPath: "inset(50% 50% 50% 50%)" }}>
        {itens.map((it) =>
          it.ehRotulo ? (
            <div key={"r" + it.id} className={it.className} style={{ visibility: "hidden" }}>
              {it.rotulo}
            </div>
          ) : (
            <span key={it.id} className={`abas-btn ${it.className ?? ""}`}>
              {it.rotulo}
            </span>
          ),
        )}
      </div>
    </div>
  );
}

export type FormatoContador = "moeda" | "inteiro" | "pct";

/** Número que conta até o valor (KPIs). */
export function Contador({ valor, formato = "inteiro", style }: { valor: number; formato?: FormatoContador; style?: CSSProperties }) {
  const v = useContagem(Number(valor) || 0);
  const texto =
    formato === "moeda" ? formatarReais(v) : formato === "pct" ? `${Math.round(v)}%` : Math.round(v).toLocaleString("pt-BR");
  return <span style={{ fontVariantNumeric: "tabular-nums", ...style }}>{texto}</span>;
}
