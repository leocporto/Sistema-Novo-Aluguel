import type { Metadata } from "next";
import { Formulario, BotaoEnviar } from "@/components/formulario";
import { AreaTexto, Campo, Entrada, Selecao } from "@/components/ui";
import { lerUtm } from "@/lib/dominio/marketing";
import { clienteAnonimo } from "@/lib/supabase/anonimo";
import { enviarLeadPublico } from "./actions";

export const metadata: Metadata = { title: "Fale com a imobiliária", robots: { index: false } };

/** Formulário público de captação (link para site, Instagram, Facebook, WhatsApp…). */
export default async function CaptacaoPublicaPage({ params, searchParams }: PageProps<"/l/[token]">) {
  const { token } = await params;
  const sp = await searchParams;
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const valido = /^[0-9a-f-]{36}$/i.test(token);
  const { data: nome } = valido ? await clienteAnonimo().rpc("info_captacao", { p_token: token }) : { data: null };

  return (
    <main className="flex min-h-screen items-center justify-center bg-app px-4 py-10">
      <div className="w-full max-w-md rounded-card border border-borda bg-card p-6 shadow-[0_24px_60px_-30px_rgba(0,0,0,.35)]">
        {!nome ? (
          <p className="text-center text-sm text-texto-2">Este link não está mais ativo.</p>
        ) : (
          <>
            <h1 className="text-[24px] font-semibold tracking-[-0.02em] text-texto">{nome as string}</h1>
            <p className="mb-5 mt-1 text-sm text-texto-2">Deixe seus dados que um corretor entra em contato.</p>
            <Formulario acao={enviarLeadPublico} className="space-y-4">
              <input type="hidden" name="token" value={token} />
              <input type="hidden" name="origem" value={s("origem") || "site"} />
              {s("imovel") && <input type="hidden" name="imovel" value={s("imovel")} />}
              {Object.entries(lerUtm(sp)).map(([k, v]) => (
                <input key={k} type="hidden" name={k} value={v} />
              ))}
              <input type="text" name="site_url" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden="true" />
              <Campo rotulo="Seu nome">
                <Entrada name="nome" required autoComplete="name" />
              </Campo>
              <div className="grid gap-4 sm:grid-cols-2">
                <Campo rotulo="WhatsApp / telefone">
                  <Entrada name="telefone" inputMode="tel" autoComplete="tel" placeholder="(11) 99999-9999" />
                </Campo>
                <Campo rotulo="E-mail">
                  <Entrada name="email" type="email" autoComplete="email" />
                </Campo>
              </div>
              <Campo rotulo="Você quer">
                <Selecao name="funil" defaultValue={s("funil") || "locacao"}>
                  <option value="locacao">Alugar um imóvel</option>
                  <option value="venda">Comprar um imóvel</option>
                  <option value="captacao">Anunciar meu imóvel</option>
                </Selecao>
              </Campo>
              <Campo rotulo="Mensagem (opcional)">
                <AreaTexto name="mensagem" rows={3} placeholder={s("imovel") ? `Tenho interesse no imóvel ${s("imovel")}` : "Bairro, quartos, faixa de valor…"} />
              </Campo>
              <BotaoEnviar>Enviar</BotaoEnviar>
              <p className="text-[11px] text-mudo">Ao enviar, você autoriza o contato da imobiliária sobre imóveis.</p>
            </Formulario>
          </>
        )}
      </div>
    </main>
  );
}
