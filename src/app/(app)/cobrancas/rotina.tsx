"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { agendarAvisosDoDia } from "./actions";

/**
 * Envio automático ligado: ao abrir a tela, grava os avisos do dia na fila de
 * saída (uma vez por visita) e atualiza a tela se algo entrou nela.
 */
export function RotinaEnvioAutomatico() {
  const router = useRouter();
  const rodou = useRef(false);
  useEffect(() => {
    if (rodou.current) return;
    rodou.current = true;
    void agendarAvisosDoDia().then((r) => {
      if (r.agendados > 0) router.refresh();
    });
  }, [router]);
  return null;
}
