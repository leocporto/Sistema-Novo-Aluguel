import type { Metadata } from "next";
import Link from "next/link";
import { Plus, Send } from "lucide-react";
import { BotaoAcao } from "@/components/botao-acao";
import { LinhaLink } from "@/components/linha-link";
import { Aviso, Cabecalho, Campo, Celula, Entrada, LinhaVazia, Selo, Tabela } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { agoraMs } from "@/lib/dominio/datas";
import { ROTULO_EVENTO } from "@/lib/dominio/integracoes";
import { AbasIntegracoes } from "../abas";
import { criarWebhook, entregarFilaAgora } from "../actions";
import { CamposEventos } from "../campos-eventos";
import { quando, resumoIntegracoes, type Webhook } from "../dados";
import { JanelaSegredo } from "../janela-segredo";

export const metadata: Metadata = { title: "Webhooks" };

/** Webhooks: o sistema avisa um endereço externo quando algo acontece (fila com novas tentativas e assinatura HMAC). */
export default async function WebhooksPage() {
  const { supabase, organizacao, papel } = await obterContexto();
  const admin = papel === "admin";
  const desde = new Date(agoraMs() - 7 * 86_400_000).toISOString();
  const [{ data }, resumo] = await Promise.all([
    supabase.from("webhook_assinaturas").select("id, nome, url, eventos, ativo, pausada_em, pausada_motivo, falhas_seguidas, ultima_entrega_em, ultimo_status, created_at").order("created_at"),
    resumoIntegracoes(supabase, desde),
  ]);
  const lista = (data ?? []) as Webhook[];
  const porWebhook = new Map(resumo.por_webhook.map((w) => [w.assinatura_id, w]));

  return (
    <>
      <Cabecalho
        titulo="Webhooks"
        trilha="Integrações"
        descricao="Quando um lead chega, um contrato é criado, uma cobrança é paga ou um chamado é aberto, o sistema manda um aviso (POST em JSON, assinado) para o endereço que você cadastrar — por exemplo, um fluxo do n8n."
        acoes={
          admin ? (
            <>
              {resumo.fila > 0 && (
                <BotaoAcao acao={entregarFilaAgora} id="fila">
                  <Send className="size-4" /> Enviar fila agora ({resumo.fila})
                </BotaoAcao>
              )}
              <JanelaSegredo
                rotuloBotao={
                  <>
                    <Plus className="size-4" /> Novo webhook
                  </>
                }
                titulo="Novo webhook"
                acao={criarWebhook}
                larguraMax="max-w-2xl"
                explicacao={
                  <>
                    <strong>Este é o segredo de assinatura.</strong> Guarde no sistema que recebe os avisos para conferir o cabeçalho <code className="font-mono">X-NovoAluguel-Assinatura</code>.
                    Ele não aparece de novo (dá para trocar depois).
                  </>
                }
              >
                <Campo rotulo="Nome">
                  <Entrada name="nome" required maxLength={80} placeholder="Ex.: n8n — leads para o WhatsApp" />
                </Campo>
                <Campo rotulo="Endereço (URL)" dica="Precisa começar com https:// e ser um endereço público.">
                  <Entrada name="url" type="url" required placeholder="https://seu-n8n.com/webhook/…" />
                </Campo>
                <CamposEventos modo={organizacao.modo} />
              </JanelaSegredo>
            </>
          ) : undefined
        }
      />
      <AbasIntegracoes />
      <div className="mb-5">
        <Aviso>
          As entregas saem sozinhas, em segundo plano, enquanto um administrador ou gestor usa o sistema (ou na hora, pelo botão “Enviar fila agora”). Se o destino falhar, o
          sistema tenta de novo em 5 min, 15 min, 45 min… até 6 vezes; depois de 50 falhas seguidas o webhook é pausado. Como conferir a assinatura:{" "}
          <Link href="/integracoes/api#webhooks" className="text-acento hover:underline">
            documentação
          </Link>
          .
        </Aviso>
      </div>
      <Tabela colunas={["Nome", "Endereço", "Eventos", "Situação", "Última entrega", "7 dias"]}>
        {lista.length === 0 ? (
          <LinhaVazia colunas={6}>Nenhum webhook cadastrado.</LinhaVazia>
        ) : (
          lista.map((w) => {
            const r = porWebhook.get(w.id);
            return (
              <LinhaLink key={w.id} href={`/integracoes/webhooks/${w.id}`}>
                <Celula className="font-semibold">{w.nome}</Celula>
                <Celula className="max-w-[280px] truncate font-mono text-[12.5px] text-texto-2">{w.url}</Celula>
                <Celula className="text-[12.5px] text-texto-2">
                  {w.eventos.length <= 2 ? w.eventos.map((e) => ROTULO_EVENTO[e] ?? e).join(", ") : `${w.eventos.length} eventos`}
                </Celula>
                <Celula>
                  {w.ativo ? (
                    <Selo cor={w.falhas_seguidas > 0 ? "amarelo" : "verde"}>{w.falhas_seguidas > 0 ? `${w.falhas_seguidas} falha(s) seguidas` : "Ligado"}</Selo>
                  ) : (
                    <Selo cor="cinza">Pausado</Selo>
                  )}
                </Celula>
                <Celula className="whitespace-nowrap text-texto-2">
                  {quando(w.ultima_entrega_em)}
                  {w.ultimo_status ? <span className="ml-1 font-mono text-[11px] text-mudo">HTTP {w.ultimo_status}</span> : null}
                </Celula>
                <Celula className="whitespace-nowrap text-[12.5px] text-texto-2">
                  {r ? `${r.entregues} entregue(s) · ${r.falhas + r.desistiu} falha(s) · ${r.fila} na fila` : "—"}
                </Celula>
              </LinhaLink>
            );
          })
        )}
      </Tabela>
    </>
  );
}
