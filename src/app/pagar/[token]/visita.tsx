"use client";

import { useEffect } from "react";
import { registrarVisita } from "./actions";

/** Marca "link aberto" depois que a página abriu de verdade no navegador (uma vez). */
export function RegistrarVisita({ token }: { token: string }) {
  useEffect(() => {
    const t = window.setTimeout(() => void registrarVisita(token), 1500);
    return () => window.clearTimeout(t);
  }, [token]);
  return null;
}
