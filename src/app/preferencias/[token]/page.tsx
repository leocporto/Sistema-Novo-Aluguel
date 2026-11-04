import type { Metadata } from "next";
import { BotaoEnviar, Formulario } from "@/components/formulario";
import { clienteAnonimo } from "@/lib/supabase/anonimo";
import { salvarPreferenciasPublicas } from "./actions";

export const metadata: Metadata = { title: "Suas preferências de contato", robots: { index: false } };

type Canal = "whatsapp" | "email" | "sms" | "ofertas";
type Info = {
  imobiliaria: string;
  nome: string;
  tem_email: boolean;
  tem_telefone: boolean;
  /** Bloqueado pela equipe, por "SAIR" ou por outro cadastro: o link não libera. */
  travado?: Partial<Record<Canal, boolean>>;
} & Record<Canal, boolean>;

const caixa =
  "flex cursor-pointer items-center gap-3 rounded-[14px] border border-borda px-4 py-3 text-sm transition has-[:checked]:border-ok-bd has-[:checked]:bg-ok-bg";

/** Página pública de preferências e descadastro (link que vai em toda mensagem de oferta). */
export default async function PreferenciasPublicasPage({ params }: PageProps<"/preferencias/[token]">) {
  const { token } = await params;
  const valido = /^[0-9a-f-]{36}$/i.test(token);
  const { data } = valido ? await clienteAnonimo().rpc("info_preferencias", { p_token: token }) : { data: null };
  const info = data as Info | null;
  // Canal sem telefone/e-mail não aparece e não vai no formulário (não muda nada nele).
  const canais: [Canal, string][] = info
    ? (
        [
          ["whatsapp", "WhatsApp", info.tem_telefone],
          ["sms", "SMS", info.tem_telefone],
          ["email", "E-mail", info.tem_email],
          ["ofertas", "Ofertas e novidades de imóveis", true],
        ] as [Canal, string, boolean][]
      )
        .filter(([, , mostrar]) => mostrar)
        .map(([k, rotulo]) => [k, rotulo])
    : [];
  const travado = (k: Canal) => Boolean(info && !info[k] && info.travado?.[k]);

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
              <div className="space-y-2">
                {canais.map(([k, rotulo]) =>
                  travado(k) ? (
                    // Bloqueio pedido à imobiliária: aparece, mas não vai no formulário (o link não libera).
                    <div key={k} className={`${caixa} cursor-default opacity-70`}>
                      <input type="checkbox" disabled checked={false} readOnly className="size-4" aria-label={rotulo} />
                      <span>
                        <span className="block font-medium text-texto">{rotulo}</span>
                        <span className="block text-xs text-mudo">Bloqueado a seu pedido. Para voltar a receber, fale com a imobiliária.</span>
                      </span>
                    </div>
                  ) : (
                    <label key={k} className={caixa}>
                      <input type="hidden" name={k} value="" />
                      <input type="checkbox" name={k} defaultChecked={Boolean(info[k])} className="size-4 accent-[var(--ok)]" />
                      <span className="font-medium text-texto">{rotulo}</span>
                    </label>
                  ),
                )}
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
