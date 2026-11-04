"use client";

import { usePathname, useRouter } from "next/navigation";
import { AbasSegmentadas } from "@/components/abas-segmentadas";

const ITENS = [
  { href: "/corretor", rotulo: "Resumo" },
  { href: "/corretor/imoveis", rotulo: "Carteira" },
  { href: "/corretor/leads", rotulo: "Clientes e leads" },
  { href: "/corretor/visitas", rotulo: "Visitas e propostas" },
  { href: "/corretor/metas", rotulo: "Metas" },
  { href: "/corretor/comissoes", rotulo: "Comissões" },
  { href: "/corretor/documentos", rotulo: "Documentação" },
];

/**
 * Abas do portal do corretor (pílula deslizante, como as SubAbas), mantendo o
 * corretor escolhido pelo gestor (?corretor=) ao trocar de aba.
 */
export function AbasCorretor({ sufixo, gestao }: { sufixo: string; gestao: boolean }) {
  const caminho = usePathname();
  const router = useRouter();
  const itens = gestao ? [...ITENS, { href: "/corretor/equipe", rotulo: "Usuários e corretores" }] : ITENS;
  const ativo = [...itens].sort((a, b) => b.href.length - a.href.length).find((i) => caminho === i.href || caminho.startsWith(`${i.href}/`))?.href;
  return (
    <div className="mb-5 overflow-x-auto">
      <AbasSegmentadas
        variante="seg"
        valor={ativo}
        aoMudar={(id) => router.push(`${id}${sufixo}`)}
        aoPassar={(id) => router.prefetch(`${id}${sufixo}`)}
        rotuloAcessivel="Portal do corretor"
        itens={itens.map((i) => ({ id: i.href, rotulo: i.rotulo }))}
      />
    </div>
  );
}
