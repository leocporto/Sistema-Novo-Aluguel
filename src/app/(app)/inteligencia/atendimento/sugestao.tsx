"use client";

import { useActionState, useState } from "react";
import { MessageSquareReply, Send } from "lucide-react";
import { BotaoEnviar } from "@/components/formulario";
import { Copiar } from "@/components/copiar";
import { Aviso, Selo } from "@/components/ui";
import { ROTULO_INTENCAO } from "@/lib/dominio/ia";
import type { EstadoAcao } from "@/lib/form";
import { sugerirAcao, sugerirResposta, type EstadoAtendimento } from "../actions";
import { SeloOrigem } from "../componentes";

const campo =
  "w-full min-h-[46px] rounded-btn border border-borda-forte bg-input px-3.5 py-2.5 text-[15px] text-texto outline-none transition placeholder:text-fraco focus:border-acento focus:ring-4 focus:ring-acento-bg";
const rotulo = "font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-mudo";

/**
 * Chatbot de qualificação ASSISTIDO: sugere a resposta (IA ou regra); a equipe
 * edita e manda para aprovação. Nada é enviado ao cliente daqui.
 */
export function SugestaoAtendimento({
  conversa,
}: {
  conversa?: { id: string; canal: string; contato: string; nome: string | null; ultimaEntrada: string | null; leadId: string | null; pessoaId: string | null } | null;
}) {
  const [estado, executar] = useActionState<EstadoAtendimento, FormData>(sugerirResposta, {});
  const [enviado, enviar] = useActionState<EstadoAcao, FormData>(sugerirAcao, {});
  const [resposta, setResposta] = useState("");
  const [base, setBase] = useState<EstadoAtendimento | null>(null);
  if (estado !== base) {
    setBase(estado);
    setResposta(estado.resposta ?? "");
  }
  return (
    <div className="space-y-4">
      <form action={executar} className="space-y-3">
        {conversa && <input type="hidden" name="conversa_id" value={conversa.id} />}
        <label className="flex flex-col gap-1.5">
          <span className={rotulo}>Mensagem do cliente</span>
          <textarea name="mensagem" rows={3} required maxLength={2000} defaultValue={conversa?.ultimaEntrada ?? ""} placeholder="Ex.: Oi, vocês têm apartamento para alugar perto do centro?" className={campo} />
        </label>
        <BotaoEnviar>
          <MessageSquareReply className="size-4" /> Sugerir resposta
        </BotaoEnviar>
      </form>
      {estado.erro && <Aviso tipo="erro">{estado.erro}</Aviso>}
      {estado.aviso && <Aviso tipo="alerta">{estado.aviso}</Aviso>}
      {estado.resposta && (
        <div className="space-y-3 rounded-card border border-borda bg-card p-5">
          <div className="flex flex-wrap items-center gap-2">
            <SeloOrigem usouIA={!!estado.usouIA} />
            {estado.intencao && <Selo cor="azul">{ROTULO_INTENCAO[estado.intencao]}</Selo>}
            {estado.foraDoHorario && <Selo cor="amarelo">Fora do horário comercial</Selo>}
          </div>
          <label className="flex flex-col gap-1.5">
            <span className={rotulo}>Resposta sugerida (edite antes de usar)</span>
            <textarea rows={4} value={resposta} onChange={(e) => setResposta(e.target.value)} className={campo} aria-label="Resposta sugerida" />
          </label>
          {estado.perguntas && estado.perguntas.length > 0 && <p className="text-xs text-mudo">Perguntas de qualificação na resposta: {estado.perguntas.join(" · ")}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <Copiar texto={resposta} rotulo="Copiar resposta" />
            {conversa && (
              <form action={enviar} className="contents">
                <input type="hidden" name="tipo" value="mensagem_cliente" />
                <input type="hidden" name="origem" value={estado.usouIA ? "ia" : "usuario"} />
                <input type="hidden" name="titulo" value={`Resposta para ${conversa.nome ?? conversa.contato}`} />
                <input type="hidden" name="canal" value={conversa.canal === "email" || conversa.canal === "sms" ? conversa.canal : "whatsapp"} />
                <input type="hidden" name="destino" value={conversa.contato} />
                <input type="hidden" name="nome" value={conversa.nome ?? ""} />
                <input type="hidden" name="conversa_id" value={conversa.id} />
                {conversa.leadId && <input type="hidden" name="lead_id" value={conversa.leadId} />}
                {conversa.pessoaId && <input type="hidden" name="pessoa_id" value={conversa.pessoaId} />}
                <input type="hidden" name="texto" value={resposta} />
                <BotaoEnviar variante="secundario">
                  <Send className="size-4" /> Enviar para aprovação
                </BotaoEnviar>
              </form>
            )}
          </div>
          {enviado.erro && <Aviso tipo="erro">{enviado.erro}</Aviso>}
          {enviado.ok && <Aviso>{enviado.ok}</Aviso>}
        </div>
      )}
    </div>
  );
}
