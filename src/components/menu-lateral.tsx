"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const GRUPOS: { titulo: string; itens: { href: string; rotulo: string }[] }[] = [
  { titulo: "", itens: [{ href: "/", rotulo: "Painel" }] },
  {
    titulo: "Cadastros",
    itens: [
      { href: "/imoveis", rotulo: "Imóveis" },
      { href: "/pessoas", rotulo: "Pessoas" },
      { href: "/chaves", rotulo: "Chaves" },
    ],
  },
  {
    titulo: "Locação",
    itens: [
      { href: "/contratos", rotulo: "Contratos" },
      { href: "/faturas", rotulo: "Cobranças" },
      { href: "/repasses", rotulo: "Repasses" },
      { href: "/reajustes", rotulo: "Reajustes" },
      { href: "/regua", rotulo: "Régua de cobrança" },
    ],
  },
  {
    titulo: "Gestão",
    itens: [
      { href: "/financeiro", rotulo: "Financeiro" },
      { href: "/relatorios", rotulo: "Relatórios e DIMOB" },
      { href: "/indices", rotulo: "Índices econômicos" },
      { href: "/configuracoes", rotulo: "Configurações" },
    ],
  },
];

export function MenuLateral() {
  const caminho = usePathname();
  return (
    <nav className="flex flex-col gap-5 text-sm">
      {GRUPOS.map((g) => (
        <div key={g.titulo || "inicio"}>
          {g.titulo && (
            <div className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{g.titulo}</div>
          )}
          <ul className="flex flex-col gap-0.5">
            {g.itens.map((i) => {
              const ativo = i.href === "/" ? caminho === "/" : caminho.startsWith(i.href);
              return (
                <li key={i.href}>
                  <Link
                    href={i.href}
                    className={`block rounded-lg px-3 py-1.5 ${
                      ativo ? "bg-emerald-50 font-medium text-emerald-700" : "text-slate-600 hover:bg-slate-100"
                    }`}
                  >
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
