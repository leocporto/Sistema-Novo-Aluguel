"use client";

import { useEffect } from "react";
import { marcarConversaLida } from "../../actions";

/** Ao abrir a conversa, marca como lidas as mensagens recebidas deste colega. */
export function MarcarLidas({ de }: { de: string }) {
  useEffect(() => {
    void marcarConversaLida(de);
  }, [de]);
  return null;
}
