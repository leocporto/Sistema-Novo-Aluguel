import { MenuLateral } from "@/components/menu-lateral";
import { obterContexto } from "@/lib/contexto";
import { sair } from "../login/actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { organizacao, usuario } = await obterContexto();
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="nao-imprimir border-b border-slate-200 bg-white md:sticky md:top-0 md:h-screen md:w-60 md:shrink-0 md:overflow-y-auto md:border-b-0 md:border-r">
        <div className="px-5 py-4">
          <div className="text-lg font-semibold text-emerald-700">Novo Aluguel</div>
          <div className="truncate text-xs text-slate-500">{organizacao.nome}</div>
        </div>
        <div className="px-2 pb-4">
          <MenuLateral />
        </div>
        <div className="border-t border-slate-100 px-5 py-3 text-xs text-slate-500">
          <div className="truncate">{usuario.email}</div>
          <form action={sair}>
            <button className="mt-1 text-emerald-700 hover:underline">Sair</button>
          </form>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-4 py-6 md:px-8">{children}</main>
    </div>
  );
}
