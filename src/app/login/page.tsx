import type { Metadata } from "next";
import { Home } from "lucide-react";
import { BotaoEnviar, Formulario } from "@/components/formulario";
import { BotaoTema } from "@/components/menu-lateral";
import { Campo, Entrada } from "@/components/ui";
import { entrar } from "./actions";

export const metadata: Metadata = { title: "Entrar" };

export default function LoginPage() {
  return (
    <main className="relative flex min-h-screen items-center justify-center px-4">
      <BotaoTema className="absolute right-4 top-4" />
      <div className="entrar w-full max-w-sm rounded-card border border-borda bg-card p-8 shadow-card">
        <div className="mb-7 flex flex-col items-center gap-3 text-center">
          <span className="flex size-12 items-center justify-center rounded-[13px] bg-[linear-gradient(150deg,#4c8dff,#2563eb)] text-white shadow-[0_6px_16px_-4px_var(--accent-glow)]">
            <Home className="size-6" />
          </span>
          <div>
            <div className="text-[15px] font-extrabold uppercase tracking-[0.13em] text-texto">Novo Aluguel</div>
            <p className="mt-1 text-[13px] text-mudo">Gestão de locação de imóveis</p>
          </div>
        </div>
        <Formulario acao={entrar} className="space-y-4">
          <Campo rotulo="E-mail">
            <Entrada name="email" type="email" required autoComplete="email" />
          </Campo>
          <Campo rotulo="Senha">
            <Entrada name="senha" type="password" required minLength={6} autoComplete="current-password" />
          </Campo>
          <div className="flex flex-col gap-2 pt-1">
            <BotaoEnviar name="modo" value="entrar">
              Entrar
            </BotaoEnviar>
            <BotaoEnviar name="modo" value="cadastrar" variante="secundario">
              Criar conta
            </BotaoEnviar>
          </div>
        </Formulario>
      </div>
    </main>
  );
}
