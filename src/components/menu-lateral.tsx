"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowLeftRight,
  BarChart3,
  Bell,
  Building2,
  FileText,
  KeyRound,
  LayoutDashboard,
  Moon,
  Percent,
  Receipt,
  Settings,
  Sun,
  TrendingUp,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { useTema } from "@/lib/tema";

const GRUPOS: { titulo: string; itens: { href: string; rotulo: string; icone: LucideIcon }[] }[] = [
  { titulo: "", itens: [{ href: "/", rotulo: "Painel", icone: LayoutDashboard }] },
  {
    titulo: "Cadastros",
    itens: [
      { href: "/imoveis", rotulo: "Imóveis", icone: Building2 },
      { href: "/pessoas", rotulo: "Pessoas", icone: Users },
      { href: "/chaves", rotulo: "Chaves", icone: KeyRound },
    ],
  },
  {
    titulo: "Locação",
    itens: [
      { href: "/contratos", rotulo: "Contratos", icone: FileText },
      { href: "/faturas", rotulo: "Cobranças", icone: Receipt },
      { href: "/repasses", rotulo: "Repasses", icone: ArrowLeftRight },
      { href: "/reajustes", rotulo: "Reajustes", icone: TrendingUp },
      { href: "/regua", rotulo: "Régua de cobrança", icone: Bell },
    ],
  },
  {
    titulo: "Gestão",
    itens: [
      { href: "/financeiro", rotulo: "Financeiro", icone: Wallet },
      { href: "/relatorios", rotulo: "Relatórios e DIMOB", icone: BarChart3 },
      { href: "/indices", rotulo: "Índices econômicos", icone: Percent },
      { href: "/configuracoes", rotulo: "Configurações", icone: Settings },
    ],
  },
];

export function MenuLateral() {
  const caminho = usePathname();
  return (
    <nav className="flex flex-col gap-0.5">
      {GRUPOS.map((g) => (
        <div key={g.titulo || "inicio"}>
          {g.titulo && (
            <div className="px-2.5 pb-1.5 pt-3.5 font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-mudo">{g.titulo}</div>
          )}
          <ul className="flex flex-col gap-0.5">
            {g.itens.map((i) => {
              const ativo = i.href === "/" ? caminho === "/" : caminho.startsWith(i.href);
              const Icone = i.icone;
              return (
                <li key={i.href}>
                  <Link
                    href={i.href}
                    className={`flex min-h-9 items-center gap-3 rounded-xl px-[11px] py-[7px] text-[13.5px] font-medium transition-colors ${
                      ativo ? "bg-acento text-white" : "text-texto-2 hover:bg-card-hover hover:text-texto"
                    }`}
                  >
                    <Icone className={`size-[18px] shrink-0 ${ativo ? "text-white" : "text-mudo"}`} strokeWidth={1.9} />
                    {i.rotulo}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/** Botão sol/lua: troca entre claro (padrão) e escuro. */
export function BotaoTema({ className = "" }: { className?: string }) {
  const [tema, trocar] = useTema();
  return (
    <button
      type="button"
      onClick={trocar}
      title={tema === "claro" ? "Modo escuro" : "Modo claro"}
      aria-label={tema === "claro" ? "Ativar modo escuro" : "Ativar modo claro"}
      className={`flex size-10 items-center justify-center rounded-btn border border-borda bg-card text-texto-2 transition hover:border-borda-forte hover:text-texto ${className}`}
    >
      {tema === "claro" ? <Moon className="size-[17px]" /> : <Sun className="size-[17px]" />}
    </button>
  );
}
