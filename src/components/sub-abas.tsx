"use client";

import { usePathname, useRouter } from "next/navigation";
import { AbasSegmentadas } from "./abas-segmentadas";

/** Abas de navegação entre telas irmãs (pílula deslizante). */
export function SubAbas({ itens, rotulo }: { itens: { href: string; rotulo: string }[]; rotulo: string }) {
  const caminho = usePathname();
  const router = useRouter();
  const ativo = [...itens].sort((a, b) => b.href.length - a.href.length).find((i) => caminho === i.href || caminho.startsWith(`${i.href}/`))?.href;
  return (
    <div className="mb-5 overflow-x-auto">
      <AbasSegmentadas
        variante="seg"
        valor={ativo}
        aoMudar={(id) => router.push(id)}
        aoPassar={(id) => router.prefetch(id)}
        rotuloAcessivel={rotulo}
        itens={itens.map((i) => ({ id: i.href, rotulo: i.rotulo }))}
      />
    </div>
  );
}
