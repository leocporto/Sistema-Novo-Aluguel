"use client";

import { useEffect } from "react";
import { Aviso, BotaoLink, Cabecalho, classeBotao } from "@/components/ui";

/** Qualquer erro numa tela do sistema: mostra um aviso no lugar da tela preta. */
export default function ErroTela({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <>
      <Cabecalho titulo="Não deu para abrir esta tela" />
      <Aviso tipo="erro">
        Aconteceu um problema ao carregar esta tela. Tente de novo; se continuar, avise o suporte{error.digest ? ` e informe o código ${error.digest}` : ""}.
      </Aviso>
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" onClick={reset} className={classeBotao("primario")}>
          Tentar de novo
        </button>
        <BotaoLink href="/" variante="secundario">
          Voltar ao Painel
        </BotaoLink>
      </div>
    </>
  );
}
