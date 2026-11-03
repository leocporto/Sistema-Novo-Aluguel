import type { Metadata } from "next";
import { BotaoEnviar, Formulario } from "@/components/formulario";
import { clienteAnonimo } from "@/lib/supabase/anonimo";
import { salvarPreferenciasPublicas } from "./actions";

export const metadata: Metadata = { title: "Suas preferências de contato", robots: { index: false } };

type Info = { imobiliaria: string; nome: string; tem_email: boolean; tem_telefone: boolean; whatsapp: boolean; email: boolean; sms: boolean; ofertas: boolean };

const caixa =
  "flex cursor-pointer items-center gap-3 rounded-[14px] border border-borda px-4 py-3 text-sm transition has-[:checked]:border-ok-bd has-[:checked]:bg-ok-bg";

/** Página pública de preferências e descadastro (link que vai em toda mensagem de oferta). */
export default async function PreferenciasPublicasPage({ params }: PageProps<"/preferencias/[token]">) {
  const { token } = await params;
  const valido = /^[0-9a-f-]{36}$/i.test(token);
  const { data } = valido ? await clienteAnonimo().rpc("info_preferencias", { p_token: token }) : { data: null };
  const info = data as Info | null;
  const canais: [keyof Info, string, boolean][] = info
    ? [
        ["whatsapp", "WhatsApp", info.tem_telefone],
        ["sms", "SMS", info.tem_telefone],
        ["email", "E-mail", info.tem_email],
        ["ofertas", "Ofertas e novidades de imóveis", true],
      ]
    : [];

  return (
    <main className="flex min-h-screen items-center justify-center bg-app px-4 py-10">
      <div className="w-full max-w-md rounded-card border border-borda bg-card p-6 shadow-[0_24px_60px_-30px_rgba(0,0,0,.35)]">
        {!info ? (
          <p className="text-center text-sm text-texto-2">Este link não é válido.</p>
        ) : (
          <>
            <div className="text-sm font-medium text-acento">{info.imobiliaria}</div>
            <h1 className="mt-1 text-[22px] font-semibold tracking-[-0.02em] text-texto">Olá, {info.nome.split(" ")[0]}! Como prefere receber nossas mensagens?</h1>
            <p className="mb-5 mt-1 text-sm text-texto-2">Desmarque o que não quiser. Mensagens sobre o seu contrato ou atendimento continuam pelos canais marcados.</p>
            <Formulario acao={salvarPreferenciasPublicas} className="space-y-4">
              <input type="hidden" name="token" value={token} />
              {/* Canal sem telefone/e-mail não aparece, mas mantém a escolha atual. */}
              {canais
                .filter(([, , mostrar]) => !mostrar)
                .map(([k]) => (
                  <input key={k} type="hidden" name={k} value={info[k] ? "on" : ""} />
                ))}
              <div className="space-y-2">
                {canais
                  .filter(([, , mostrar]) => mostrar)
                  .map(([k, rotulo]) => (
                    <label key={k} className={caixa}>
                      <input type="hidden" name={k} value="" />
                      <input type="checkbox" name={k} defaultChecked={Boolean(info[k])} className="size-4 accent-[var(--ok)]" />
                      <span className="font-medium text-texto">{rotulo}</span>
                    </label>
                  ))}
              </div>
              <div className="flex flex-wrap gap-2">
                <BotaoEnviar>Salvar preferências</BotaoEnviar>
                <BotaoEnviar variante="fantasma" name="nada" value="1" confirmar="Não receber mais nenhuma mensagem nossa?">
                  Não quero receber mais nada
                </BotaoEnviar>
              </div>
              <p className="text-[11px] text-mudo">Sua escolha fica registrada com data e hora, conforme a Lei Geral de Proteção de Dados (LGPD).</p>
            </Formulario>
          </>
        )}
      </div>
    </main>
  );
}
