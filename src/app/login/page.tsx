import type { Metadata } from "next";
import { BotaoEnviar, Formulario } from "@/components/formulario";
import { Campo, Entrada } from "@/components/ui";
import { entrar } from "./actions";

export const metadata: Metadata = { title: "Entrar" };

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mb-6 text-center">
          <div className="text-2xl font-semibold text-emerald-700">Novo Aluguel</div>
          <p className="mt-1 text-sm text-slate-500">Gestão de locação de imóveis</p>
        </div>
        <Formulario acao={entrar}>
          <Campo rotulo="E-mail">
            <Entrada name="email" type="email" required autoComplete="email" />
          </Campo>
          <Campo rotulo="Senha">
            <Entrada name="senha" type="password" required minLength={6} autoComplete="current-password" />
          </Campo>
          <div className="flex flex-col gap-2">
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
