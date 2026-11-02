"use client";

import Form from "next/form";
import { usePathname } from "next/navigation";
import { useEffect, useRef, type FormEvent, type ReactNode } from "react";

const ATRASO_TEXTO_MS = 400;
const ENVIO_IMEDIATO = new Set(["select-one", "select-multiple", "checkbox", "radio", "date", "month"]);

/**
 * Barra de filtros que aplica sozinha: seletores e datas atualizam a lista
 * na hora; campos de busca atualizam após uma pausa curta na digitação.
 */
export function FiltroAutomatico({
  children,
  action,
  className = "mb-4 flex flex-wrap gap-2",
}: {
  children: ReactNode;
  action?: string;
  className?: string;
}) {
  const caminho = usePathname();
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (temporizador.current) clearTimeout(temporizador.current);
  }, []);

  function aoMudar(e: FormEvent<HTMLFormElement>) {
    const form = e.currentTarget;
    const campo = e.target as HTMLInputElement | HTMLSelectElement;
    if (temporizador.current) clearTimeout(temporizador.current);
    if (ENVIO_IMEDIATO.has(campo.type)) {
      form.requestSubmit();
    } else {
      temporizador.current = setTimeout(() => form.requestSubmit(), ATRASO_TEXTO_MS);
    }
  }

  return (
    <Form action={action ?? caminho} className={`barra-filtros ${className}`} onChange={aoMudar}>
      {children}
    </Form>
  );
}
