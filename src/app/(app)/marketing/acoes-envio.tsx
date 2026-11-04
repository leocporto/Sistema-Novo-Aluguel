"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, LoaderCircle, Mail, MessageCircle, MessageSquareText, RotateCcw } from "lucide-react";
import { BotaoExcluir } from "@/components/botao-excluir";
import { classeBotao } from "@/components/ui";
import { linkEmail, linkSms } from "@/lib/dominio/marketing";
import { linkWhatsapp } from "@/lib/whatsapp";
import { excluirEnvio, marcarEnviado, voltarParaFila } from "./actions";

export type EnvioTela = {
  id: string;
  canal: "whatsapp" | "email" | "sms";
  telefone: string | null;
  email: string | null;
  assunto: string | null;
  mensagem: string;
  status: string;
  nome: string | null;
  /** Calculado no servidor (podeVoltarParaFila): enviado só nos primeiros minutos. */
  podeVoltar: boolean;
};

/**
 * Envio assistido (sem integração oficial): abre o WhatsApp/e-mail/SMS com a
 * mensagem pronta e já marca como enviado; dá para desfazer.
 */
export function AcoesEnvio({ envio }: { envio: EnvioTela }) {
  const [rodando, iniciar] = useTransition();
  const router = useRouter();
  const rodar = (fn: (id: string) => Promise<{ ok: boolean; erro?: string }>) =>
    iniciar(async () => {
      const r = await fn(envio.id);
      if (!r.ok) window.alert(r.erro ?? "Não foi possível concluir.");
      router.refresh();
    });

  const link =
    envio.canal === "whatsapp" && envio.telefone
      ? linkWhatsapp(envio.telefone, envio.mensagem)
      : envio.canal === "sms" && envio.telefone
        ? linkSms(envio.telefone, envio.mensagem)
        : envio.canal === "email" && envio.email
          ? linkEmail(envio.email, envio.assunto, envio.mensagem)
          : null;
  const Icone = envio.canal === "email" ? Mail : envio.canal === "sms" ? MessageSquareText : MessageCircle;
  const podeEnviar = envio.status === "pendente" || envio.status === "falhou";

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {rodando && <LoaderCircle className="size-4 animate-spin text-mudo" />}
      {podeEnviar && link && (
        <button
          type="button"
          disabled={rodando}
          className={classeBotao("primario", "sm")}
          title="Confere o descadastro, marca como enviado e abre com a mensagem pronta"
          onClick={() => {
            // WhatsApp abre em outra aba: a aba é aberta já no clique (senão o navegador bloqueia)
            // e só recebe o endereço depois que o banco confirmar que pode enviar.
            const aba = envio.canal === "whatsapp" ? window.open("about:blank", "_blank") : null;
            iniciar(async () => {
              const r = await marcarEnviado(envio.id);
              if (!r.ok) {
                aba?.close();
                window.alert(r.erro ?? "Não foi possível concluir.");
              } else if (aba) aba.location.href = link;
              else window.location.href = link;
              router.refresh();
            });
          }}
        >
          <Icone className="size-3.5" /> Abrir e enviar
        </button>
      )}
      {podeEnviar && (
        <button type="button" disabled={rodando} className={classeBotao("secundario", "sm")} onClick={() => rodar(marcarEnviado)}>
          <Check className="size-3.5" /> Marcar enviado
        </button>
      )}
      {envio.podeVoltar && (
        <button
          type="button"
          disabled={rodando}
          className={classeBotao("fantasma", "sm")}
          title={
            envio.status === "bloqueado"
              ? "Só volta se o bloqueio já foi retirado (o banco confere)"
              : envio.status === "enviado"
                ? "Desfaz o envio (só nos primeiros minutos): sai do histórico do contato"
                : undefined
          }
          onClick={() => rodar(voltarParaFila)}
        >
          <RotateCcw className="size-3.5" /> Voltar para a fila
        </button>
      )}
      <BotaoExcluir acao={excluirEnvio} id={envio.id} rotulo="Excluir da fila" confirmar={`Tirar a mensagem para ${envio.nome ?? "este contato"} da fila?`} />
    </div>
  );
}
