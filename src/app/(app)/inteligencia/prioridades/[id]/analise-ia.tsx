"use client";

import { useActionState } from "react";
import { Send, Sparkles } from "lucide-react";
import { BotaoEnviar } from "@/components/formulario";
import { Copiar } from "@/components/copiar";
import { Aviso, Selo } from "@/components/ui";
import { ROTULO_INTENCAO } from "@/lib/dominio/ia";
import type { EstadoAcao } from "@/lib/form";
import { analisarLeadComIA, sugerirAcao, type EstadoAnaliseLead } from "../../actions";

const CANAL = { whatsapp: "WhatsApp", ligacao: "Ligação", email: "E-mail" } as const;

/** Análise do lead com IA (intenção, ajuste da nota, próximo contato e resposta) — só sugere. */
export function AnaliseLeadIA({ leadId, notaRegra, contato }: { leadId: string; notaRegra: number; contato: { nome: string; telefone: string | null; email: string | null } }) {
  const [estado, executar] = useActionState<EstadoAnaliseLead, FormData>(analisarLeadComIA, {});
  const [enviado, enviar] = useActionState<EstadoAcao, FormData>(sugerirAcao, {});
  const a = estado.analise;
  const canal = contato.telefone ? "whatsapp" : "email";
  return (
    <div className="space-y-3">
      <form action={executar}>
        <input type="hidden" name="lead_id" value={leadId} />
        <BotaoEnviar variante="secundario">
          <Sparkles className="size-4" /> Analisar com IA
        </BotaoEnviar>
      </form>
      {estado.erro && <Aviso tipo="erro">{estado.erro}</Aviso>}
      {a && (
        <div className="space-y-3 rounded-[14px] border border-acento-bd bg-acento-bg p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Selo cor="azul">Feito com IA — confira antes de usar</Selo>
            <Selo cor="cinza">{ROTULO_INTENCAO[a.intencao]}</Selo>
            <Selo cor={a.nota_ajuste > 0 ? "verde" : a.nota_ajuste < 0 ? "vermelho" : "cinza"}>
              Nota: {notaRegra} → {Math.max(0, Math.min(100, notaRegra + a.nota_ajuste))}
            </Selo>
          </div>
          {a.explicacao && <p className="text-sm text-texto">{a.explicacao}</p>}
          {a.proximo_contato && (
            <p className="text-sm text-texto">
              <strong>Próximo contato:</strong> {a.proximo_contato.em_dias === 0 ? "hoje" : `em ${a.proximo_contato.em_dias} dia(s)`} por {CANAL[a.proximo_contato.canal]} — {a.proximo_contato.motivo}
            </p>
          )}
          {a.resposta_sugerida && (
            <div className="space-y-2">
              <div className="text-xs font-semibold text-texto-2">Mensagem sugerida</div>
              <p className="whitespace-pre-line rounded-[12px] border border-borda bg-card p-3 text-sm text-texto">{a.resposta_sugerida}</p>
              <div className="flex flex-wrap gap-2">
                <Copiar texto={a.resposta_sugerida} />
                {(contato.telefone || contato.email) && (
                  <form action={enviar} className="contents">
                    <input type="hidden" name="tipo" value="mensagem_cliente" />
                    <input type="hidden" name="origem" value="ia" />
                    <input type="hidden" name="titulo" value={`Mensagem para ${contato.nome}`} />
                    <input type="hidden" name="canal" value={canal} />
                    <input type="hidden" name="destino" value={(contato.telefone ?? contato.email) || ""} />
                    <input type="hidden" name="nome" value={contato.nome} />
                    <input type="hidden" name="lead_id" value={leadId} />
                    <input type="hidden" name="texto" value={a.resposta_sugerida} />
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
      )}
    </div>
  );
}
