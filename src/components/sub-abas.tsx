"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AbasSegmentadas } from "./abas-segmentadas";
import { useNavegacao } from "@/lib/navegacao";

function abaDoCaminho(itens: { href: string }[], caminho: string): string | undefined {
  return [...itens].sort((a, b) => b.href.length - a.href.length).find((i) => caminho === i.href || caminho.startsWith(`${i.href}/`))?.href;
}

/**
 * Abas de navegação entre telas irmãs (pílula deslizante).
 * A pílula anda na hora do clique; o cabeçalho fica parado e só o conteúdo
 * desliza para o lado da aba escolhida (ver src/lib/navegacao.tsx).
 */
export function SubAbas({ itens, rotulo }: { itens: { href: string; rotulo: string }[]; rotulo: string }) {
  const caminho = usePathname();
  const router = useRouter();
  const { navegar } = useNavegacao();
  const ativo = abaDoCaminho(itens, caminho);
  const [selecionado, setSelecionado] = useState(ativo);
  const [anterior, setAnterior] = useState(ativo);
  if (ativo !== anterior) {
    setAnterior(ativo);
    setSelecionado(ativo);
  }
  return (
    <div className="subabas mb-5 overflow-x-auto">
      <AbasSegmentadas
        variante="seg"
        valor={selecionado}
        aoMudar={(id) => {
          if (id === selecionado) return;
          const de = itens.findIndex((i) => i.href === selecionado);
          const para = itens.findIndex((i) => i.href === id);
          setSelecionado(id);
          navegar(id, { aba: true, dir: de < 0 ? 0 : Math.sign(para - de) });
        }}
        aoPassar={(id) => router.prefetch(id)}
        rotuloAcessivel={rotulo}
        itens={itens.map((i) => ({ id: i.href, rotulo: i.rotulo }))}
      />
    </div>
  );
}
