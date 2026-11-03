"use client";

import { useActionState, useEffect, useRef } from "react";
import { BotaoEnviar } from "@/components/formulario";
import { AreaTexto, Campo, Entrada } from "@/components/ui";
import type { EstadoAcao } from "@/lib/form";
import type { Utm } from "@/lib/dominio/marketing";
import { enviarLeadLanding } from "./actions";

type JanelaComRastreio = Window & { fbq?: (...a: unknown[]) => void; gtag?: (...a: unknown[]) => void };

/** Formulário da landing page; ao dar certo, avisa o pixel da Meta e a tag do Google (se configurados). */
export function FormularioLanding({ slug, utm, chamada, placeholder, conversaoGoogle }: { slug: string; utm: Utm; chamada: string; placeholder: string; conversaoGoogle: string | null }) {
  const [estado, executar] = useActionState<EstadoAcao, FormData>(enviarLeadLanding, {});
  const avisado = useRef(false);
  useEffect(() => {
    if (!estado.ok || avisado.current) return;
    avisado.current = true;
    const w = window as JanelaComRastreio;
    w.fbq?.("track", "Lead");
    w.gtag?.("event", "generate_lead");
    if (conversaoGoogle) w.gtag?.("event", "conversion", { send_to: conversaoGoogle });
  }, [estado.ok, conversaoGoogle]);

  if (estado.ok)
    return (
      <div role="status" className="rounded-[14px] border border-ok-bd bg-ok-bg px-4 py-5 text-center text-[15px] font-medium text-ok">
        {estado.ok}
      </div>
    );
  return (
    <form action={executar} className="space-y-4">
      <input type="hidden" name="slug" value={slug} />
      {Object.entries(utm).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <input type="text" name="site_url" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden="true" />
      {estado.erro && (
        <div role="alert" className="rounded-[14px] border border-ruim-bd bg-ruim-bg px-4 py-3 text-sm text-ruim">
          {estado.erro}
        </div>
      )}
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
      <Campo rotulo="Mensagem (opcional)">
        <AreaTexto name="mensagem" rows={3} placeholder={placeholder} />
      </Campo>
      <BotaoEnviar>{chamada}</BotaoEnviar>
      <p className="text-[11px] text-mudo">Ao enviar, você autoriza o contato sobre imóveis. Você pode sair da lista quando quiser.</p>
    </form>
  );
}
