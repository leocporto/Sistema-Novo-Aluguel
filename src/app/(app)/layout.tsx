import { Home, LogOut } from "lucide-react";
import { BotaoTema, MenuLateral } from "@/components/menu-lateral";
import { obterContexto } from "@/lib/contexto";
import { sair } from "../login/actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { organizacao, usuario } = await obterContexto();
  const inicial = (usuario.email ?? "?").slice(0, 1).toUpperCase();
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="nao-imprimir flex flex-col border-b border-borda bg-sidebar px-3 pb-3 pt-3.5 md:sticky md:top-0 md:h-screen md:w-[248px] md:shrink-0 md:border-b-0 md:border-r">
        <div className="mb-1.5 flex items-center gap-3 border-b border-borda-suave px-2 pb-3.5 pt-2">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-btn bg-[linear-gradient(150deg,#4c8dff,#2563eb)] text-white shadow-[0_6px_16px_-4px_var(--accent-glow)]">
            <Home className="size-5" strokeWidth={2} />
          </span>
          <div className="min-w-0 leading-tight">
            <div className="text-[14px] font-extrabold uppercase tracking-[0.13em] text-texto">Novo Aluguel</div>
            <div className="truncate text-[10.5px] font-medium text-mudo">{organizacao.nome}</div>
          </div>
        </div>
        <div className="-mx-1 flex-1 overflow-y-auto px-1 [scrollbar-width:none]">
          <MenuLateral />
        </div>
        <div className="mt-1 flex items-center gap-2.5 border-t border-borda-suave px-1 pt-2.5">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-acento-bg text-[13px] font-semibold text-acento-hot">
            {inicial}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12.5px] font-medium text-texto">{usuario.email}</div>
            <form action={sair}>
              <button className="flex items-center gap-1 text-[11.5px] text-mudo hover:text-acento">
                <LogOut className="size-3" /> Sair
              </button>
            </form>
          </div>
          <BotaoTema />
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-4 py-6 md:px-8 md:py-7">{children}</main>
    </div>
  );
}
