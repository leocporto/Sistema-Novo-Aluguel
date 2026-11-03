"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { AbasSegmentadas } from "./abas-segmentadas";

/**
 * Grupo de escolha única que muda a URL (funil, período, filtro…), com a
 * pílula deslizante padrão do sistema. Use no lugar de links soltos.
 */
export function PilulasLink({
  itens,
  ativo,
  rotulo,
  className = "",
}: {
  itens: { href: string; rotulo: ReactNode; titulo?: string }[];
  /** href do item selecionado */
  ativo: string;
  rotulo: string;
  className?: string;
}) {
  const router = useRouter();
  // A pílula anda na hora do clique; depois acompanha a URL.
  const [selecionado, setSelecionado] = useState(ativo);
  const [anterior, setAnterior] = useState(ativo);
  if (ativo !== anterior) {
    setAnterior(ativo);
    setSelecionado(ativo);
  }
  return (
    <div className={`overflow-x-auto ${className}`}>
      <AbasSegmentadas
        variante="seg"
        valor={selecionado}
        aoMudar={(href) => {
          setSelecionado(href);
          router.push(href, { scroll: false });
        }}
        aoPassar={(href) => router.prefetch(href)}
        rotuloAcessivel={rotulo}
        itens={itens.map((i) => ({ id: i.href, rotulo: i.rotulo, titulo: i.titulo }))}
      />
    </div>
  );
}
