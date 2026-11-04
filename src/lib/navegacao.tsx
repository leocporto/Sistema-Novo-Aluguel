"use client";

/**
 * Navegação fluida do app.
 * - `navegar(href, { aba, dir })` troca de tela numa transição: enquanto o servidor
 *   prepara a próxima tela, a atual continua na frente (o conteúdo esmaece de leve)
 *   em vez de piscar o esqueleto de carregamento.
 * - `aba: true` (SubAbas) avisa a casca que é só troca de aba: o cabeçalho e as abas
 *   ficam parados e só o conteúdo desliza para o lado da aba escolhida (`dir`).
 * Fora da casca (ex.: portal do cliente) cai num router.push comum.
 */
import { createContext, useContext, type ReactNode } from "react";
import { useRouter } from "next/navigation";

export type OpcoesNavegar = {
  /** Troca de aba entre telas irmãs: só o conteúdo desliza. */
  aba?: boolean;
  /** Lado de onde o conteúdo entra: 1 = da direita, -1 = da esquerda. */
  dir?: number;
  /** Rolar para o topo (padrão: sim, menos em troca de aba). */
  scroll?: boolean;
};

type Navegacao = { navegar: (href: string, opcoes?: OpcoesNavegar) => void; pendente: boolean };

const Contexto = createContext<Navegacao | null>(null);

export function ProvedorNavegacao({ valor, children }: { valor: Navegacao; children: ReactNode }) {
  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function useNavegacao(): Navegacao {
  const ctx = useContext(Contexto);
  const router = useRouter();
  if (ctx) return ctx;
  return {
    pendente: false,
    navegar: (href, opcoes) => router.push(href, { scroll: opcoes?.scroll ?? !opcoes?.aba }),
  };
}

/** Caminho sem ?busca e #âncora (para comparar com usePathname). */
export function soCaminho(href: string): string {
  return href.split(/[?#]/)[0] || "/";
}
