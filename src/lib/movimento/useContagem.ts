"use client";

import { useEffect, useRef, useState } from "react";
import { prefereMenosMovimento } from "./pilula";

const curva = (p: number) => 1 - Math.pow(1 - p, 3);

/**
 * Número que conta até o alvo: 0,85s na primeira vez, 0,55s nas mudanças.
 * O último quadro é sempre o valor exato; com menos movimento, aparece pronto.
 */
export function useContagem(alvo: number): number {
  const destino = Number.isFinite(alvo) ? alvo : 0;
  const [valor, setValor] = useState(0);
  const atual = useRef(0);
  const primeira = useRef(true);
  const raf = useRef(0);

  useEffect(() => {
    cancelAnimationFrame(raf.current);
    const duracao = primeira.current ? 850 : 550;
    primeira.current = false;
    const de = atual.current;
    const t0 = performance.now();
    const pular = de === destino || prefereMenosMovimento();
    const passo = (agora: number) => {
      const p = pular ? 1 : Math.min(1, (agora - t0) / duracao);
      const v = p >= 1 ? destino : de + (destino - de) * curva(p);
      atual.current = v;
      setValor(v);
      if (p < 1) raf.current = requestAnimationFrame(passo);
    };
    raf.current = requestAnimationFrame(passo);
    return () => cancelAnimationFrame(raf.current);
  }, [destino]);

  return valor;
}
