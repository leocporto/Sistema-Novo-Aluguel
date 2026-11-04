import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { KeyRound, Pause, Play, Send } from "lucide-react";
import { BotaoAcao } from "@/components/botao-acao";
import { BotaoExcluir } from "@/components/botao-excluir";
import { Formulario } from "@/components/formulario";
import { PilulasLink } from "@/components/pilulas-link";
import { Aviso, Cabecalho, Campo, Cartao, Definicao, Entrada, Selo } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { ROTULO_STATUS_ENTREGA, type StatusEntrega } from "@/lib/dominio/integracoes";
import { AbasIntegracoes } from "../../abas";
import { excluirWebhook, pausarWebhook, reativarWebhook, salvarWebhook, testarWebhook, trocarSegredoWebhook } from "../../actions";
import { CamposEventos } from "../../campos-eventos";
import { SELECT_ENTREGA, quando, type Entrega, type Webhook } from "../../dados";
import { JanelaSegredo } from "../../janela-segredo";
import { TabelaEntregas } from "../../tabela-entregas";

export const metadata: Metadata = { title: "Webhook" };

const FILTROS: (StatusEntrega | "")[] = ["", "pendente", "entregue", "falhou", "desistiu"];

export default async function WebhookPage({ params, searchParams }: PageProps<"/integracoes/webhooks/[id]">) {
  const { id } = await params;
  const sp = await searchParams;
  const status = typeof sp.status === "string" && (FILTROS as string[]).includes(sp.status) ? (sp.status as StatusEntrega) : "";
  const { supabase, organizacao, papel } = await obterContexto();
  const admin = papel === "admin";
  const { data } = await supabase
    .from("webhook_assinaturas")
    .select("id, nome, url, eventos, ativo, pausada_em, pausada_motivo, falhas_seguidas, ultima_entrega_em, ultimo_status, created_at")
    .eq("id", id)
    .maybeSingle();
  if (!data) notFound();
  const w = data as Webhook;
  let q = supabase.from("webhook_entregas").select(SELECT_ENTREGA).eq("assinatura_id", id).order("criado_em", { ascending: false }).limit(100);
  if (status) q = q.eq("status", status);
  const { data: ent } = await q;
  const entregas = (ent ?? []) as Entrega[];
  const base = `/integracoes/webhooks/${id}`;

  return (
    <>
      <Cabecalho
        titulo={w.nome}
        trilha="Integrações › Webhooks"
        descricao={<span className="font-mono text-[12.5px]">{w.url}</span>}
        acoes={
          admin ? (
            <>
              {w.ativo ? (
                <>
                  <BotaoAcao acao={testarWebhook} id={w.id}>
                    <Send className="size-4" /> Enviar teste
                  </BotaoAcao>
                  <BotaoAcao acao={pausarWebhook} id={w.id} confirmar="Pausar este webhook? Os eventos deixam de ser enviados até reativar.">
                    <Pause className="size-4" /> Pausar
                  </BotaoAcao>
                </>
              ) : (
                <BotaoAcao acao={reativarWebhook} id={w.id} variante="primario">
                  <Play className="size-4" /> Reativar
                </BotaoAcao>
              )}
              <JanelaSegredo
                rotuloBotao={
                  <>
                    <KeyRound className="size-4" /> Trocar segredo
                  </>
                }
                variante="secundario"
                titulo="Trocar segredo de assinatura"
                acao={trocarSegredoWebhook}
                rotuloSalvar="Trocar agora"
                explicacao={
                  <>
                    <strong>Novo segredo.</strong> A partir de agora as entregas são assinadas com ele: atualize o sistema que recebe. Ele não aparece de novo.
                  </>
                }
              >
                <input type="hidden" name="id" value={w.id} />
                <p className="text-sm text-texto-2">O segredo antigo para de valer na hora. Continuar?</p>
              </JanelaSegredo>
            </>
          ) : undefined
        }
      />
      <AbasIntegracoes />
      {!w.ativo && (
        <div className="mb-5">
          <Aviso tipo="alerta">
            Pausado {w.pausada_em ? `desde ${quando(w.pausada_em)}` : ""}. {w.pausada_motivo ?? ""} Eventos novos não entram na fila enquanto estiver pausado.
          </Aviso>
        </div>
      )}
      <div className="mb-6 grid grid-cols-1 gap-5 lg:grid-cols-[1.4fr_1fr]">
        <Cartao titulo="Dados do webhook">
          <Formulario acao={salvarWebhook} automatico>
            <fieldset disabled={!admin} className="space-y-4">
              <input type="hidden" name="id" value={w.id} />
              <Campo rotulo="Nome">
                <Entrada name="nome" defaultValue={w.nome} required maxLength={80} />
              </Campo>
              <Campo rotulo="Endereço (URL)">
                <Entrada name="url" type="url" defaultValue={w.url} required />
              </Campo>
              <CamposEventos modo={organizacao.modo} marcados={w.eventos} />
            </fieldset>
          </Formulario>
        </Cartao>
        <Cartao titulo="Situação">
          <Definicao
            itens={[
              ["Situação", w.ativo ? <Selo cor="verde">Ligado</Selo> : <Selo cor="cinza">Pausado</Selo>],
              ["Falhas seguidas", String(w.falhas_seguidas)],
              ["Última entrega", quando(w.ultima_entrega_em)],
              ["Última resposta", w.ultimo_status ? `HTTP ${w.ultimo_status}` : "—"],
              ["Criado em", quando(w.created_at)],
            ]}
          />
          {admin && (
            <div className="mt-6">
              <BotaoExcluir
                acao={excluirWebhook}
                id={w.id}
                variante="botao"
                rotulo="Excluir webhook"
                confirmar="Excluir este webhook e o histórico de entregas dele?"
                depois="/integracoes/webhooks"
              />
            </div>
          )}
        </Cartao>
      </div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[17px] font-semibold text-texto">Entregas</h2>
        <PilulasLink
          rotulo="Situação das entregas"
          ativo={status ? `${base}?status=${status}` : base}
          itens={FILTROS.map((f) => ({ href: f ? `${base}?status=${f}` : base, rotulo: f ? ROTULO_STATUS_ENTREGA[f] : "Todas" }))}
        />
      </div>
      <TabelaEntregas entregas={entregas} admin={admin} />
    </>
  );
}
