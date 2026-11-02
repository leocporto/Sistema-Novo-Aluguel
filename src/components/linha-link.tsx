"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";

/**
 * Linha de tabela inteira clicável: clicar em qualquer ponto abre `href`.
 * Cliques em links, botões e campos dentro da linha continuam funcionando
 * normalmente; Ctrl/⌘ ou botão do meio abre em nova aba.
 */
export function LinhaLink({ href, children, className = "" }: { href: string; children: ReactNode; className?: string }) {
  const router = useRouter();
  return (
    <tr
      role="link"
      tabIndex={0}
      onMouseEnter={() => router.prefetch(href)}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("a, button, input, select, textarea, label")) return;
        if (e.ctrlKey || e.metaKey) window.open(href, "_blank");
        else router.push(href);
      }}
      onAuxClick={(e) => {
        if (e.button === 1 && !(e.target as HTMLElement).closest("a")) window.open(href, "_blank");
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") router.push(href);
      }}
      className={`cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-acento ${className}`}
    >
      {children}
    </tr>
  );
}
