import type { Metadata } from "next";
import Link from "next/link";
import { Activity, CheckCircle2, Clock, KeyRound, TriangleAlert, XCircle } from "lucide-react";
import { Contador } from "@/components/abas-segmentadas";
import { BotaoAcao } from "@/components/botao-acao";
import { PilulasLink } from "@/components/pilulas-link";
import { Cabecalho, Cartao, Celula, Indicador, LinhaVazia, Selo, Tabela } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { agoraMs } from "@/lib/dominio/datas";
import { AbasIntegracoes } from "../abas";
import { entregarFilaAgora } from "../actions";
import { SELECT_ENTREGA, quando, resumoIntegracoes, type Entrega } from "../dados";
import { TabelaEntregas } from "../tabela-entregas";

export const metadata: Metadata = { title: "Monitoramento das integrações" };

const PERIODOS = { "1": "24 horas", "7": "7 dias", "30": "30 dias" } as const;
type Periodo = keyof typeof PERIODOS;

const contar = (r: { count: number | null }) => r.count ?? 0;

type Outra = { nome: string; href: string; ok: number; falhas: number; detalhe: string };

/**
 * Monitoramento: entregas de webhooks (com reprocessar), uso da API e os
 * registros que outras integrações já guardam (portais, Lead Ads, WhatsApp,
 * régua e baixa automática) — só leitura, sem mexer nesses módulos.
 */
export default async function MonitoramentoPage({ searchParams }: PageProps<"/integracoes/monitoramento">) {
  const sp = await searchParams;
  const periodo: Periodo = typeof sp.p === "string" && sp.p in PERIODOS ? (sp.p as Periodo) : "7";
  const { supabase, organizacao, papel } = await obterContexto();
  const admin = papel === "admin";
  const pessoal = organizacao.modo === "pessoal";
  const desde = new Date(agoraMs() - Number(periodo) * 86_400_000).toISOString();

  const [resumo, { data: falhasBrutas }, { data: hooks }, { data: chaves }] = await Promise.all([
    resumoIntegracoes(supabase, desde),
    supabase.from("webhook_entregas").select(SELECT_ENTREGA).in("status", ["falhou", "desistiu"]).gte("criado_em", desde).order("criado_em", { ascending: false }).limit(50),
    supabase.from("webhook_assinaturas").select("id, nome"),
    supabase.from("api_chaves").select("id, nome"),
  ]);
  const nomes = new Map(((hooks ?? []) as { id: string; nome: string }[]).map((h) => [h.id, h.nome]));
  const nomesChave = new Map(((chaves ?? []) as { id: string; nome: string }[]).map((c) => [c.id, c.nome]));
  const falhas = (falhasBrutas ?? []) as Entrega[];

  // Outras integrações (cada consulta só conta; RLS de cada módulo vale).
  const outras: Outra[] = [];
  const [regFalhou, regEnviado, baixas] = await Promise.all([
    supabase.from("regua_envios").select("id", { count: "exact", head: true }).eq("status", "falhou").gte("enviado_em", desde),
    supabase.from("regua_envios").select("id", { count: "exact", head: true }).eq("status", "enviado").gte("enviado_em", desde),
    supabase.from("fatura_pagamentos").select("id", { count: "exact", head: true }).in("origem", ["extrato", "arquivo", "automatica"]).gte("created_at", desde),
  ]);
  outras.push({ nome: "Régua de cobrança (envio automático)", href: "/cobrancas/fila", ok: contar(regEnviado), falhas: contar(regFalhou), detalhe: "avisos enviados × que falharam" });
  outras.push({ nome: "Baixa automática (extrato/arquivo)", href: "/cobrancas/baixa", ok: contar(baixas), falhas: 0, detalhe: "recebimentos baixados pelo extrato ou arquivo" });
  if (!pessoal) {
    const [portalFalha, leadAdsOk, leadAdsErro, msgFalhou, msgOk, filaFalhou] = await Promise.all([
      supabase.from("portal_imoveis").select("id", { count: "exact", head: true }).eq("ultimo_status", "falha"),
      supabase.from("mkt_lead_ads").select("id", { count: "exact", head: true }).eq("status", "recebido").gte("recebido_em", desde),
      supabase.from("mkt_lead_ads").select("id", { count: "exact", head: true }).in("status", ["erro", "sem_dados"]).gte("recebido_em", desde),
      supabase.from("mkt_mensagens").select("id", { count: "exact", head: true }).eq("status", "falhou").gte("data", desde),
      supabase.from("mkt_mensagens").select("id", { count: "exact", head: true }).eq("direcao", "entrada").gte("data", desde),
      supabase.from("mkt_envios").select("id", { count: "exact", head: true }).eq("status", "falhou").gte("created_at", desde),
    ]);
    const { data: sinc } = await supabase.from("portal_sincronizacoes").select("portal, gerado_em, total_enviados, total_falhas").order("gerado_em", { ascending: false }).limit(30);
    const ultimas = new Map<string, { gerado_em: string; total_enviados: number; total_falhas: number }>();
    for (const s of (sinc ?? []) as { portal: string; gerado_em: string; total_enviados: number; total_falhas: number }[]) if (!ultimas.has(s.portal)) ultimas.set(s.portal, s);
    const leitura = [...ultimas.entries()].map(([p, s]) => `${p.toUpperCase()} leu em ${quando(s.gerado_em)} (${s.total_enviados} enviados)`).join(" · ");
    outras.push({ nome: "Portais (ZAP, Viva Real, OLX)", href: "/site/portais", ok: [...ultimas.values()].reduce((a, s) => a + s.total_enviados, 0), falhas: contar(portalFalha), detalhe: leitura || "o feed ainda não foi lido pelos portais" });
    outras.push({ nome: "Lead Ads (Meta e Google)", href: "/marketing/configuracoes", ok: contar(leadAdsOk), falhas: contar(leadAdsErro), detalhe: "leads recebidos × com erro ou sem dados" });
    outras.push({ nome: "WhatsApp Business", href: "/marketing/conversas", ok: contar(msgOk), falhas: contar(msgFalhou), detalhe: "mensagens recebidas × envios que falharam" });
    outras.push({ nome: "Fila de envios do Marketing", href: "/marketing/fila", ok: 0, falhas: contar(filaFalhou), detalhe: "envios marcados como falhou" });
  }

  const e = resumo.entregas;
  return (
    <>
      <Cabecalho
        titulo="Monitoramento"
        trilha="Integrações"
        descricao="Tudo o que entra e sai do sistema por integração: avisos (webhooks), uso da API e os registros das outras integrações."
        acoes={
          admin && resumo.fila > 0 ? (
            <BotaoAcao acao={entregarFilaAgora} id="fila">
              Enviar fila agora ({resumo.fila})
            </BotaoAcao>
          ) : undefined
        }
      />
      <AbasIntegracoes />
      <PilulasLink
        className="mb-5"
        rotulo="Período"
        ativo={`/integracoes/monitoramento?p=${periodo}`}
        itens={(Object.keys(PERIODOS) as Periodo[]).map((p) => ({ href: `/integracoes/monitoramento?p=${p}`, rotulo: PERIODOS[p] }))}
      />
      <div className="entrar-cascata mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Indicador rotulo="Webhooks entregues" valor={<Contador valor={e.entregue ?? 0} />} icone={<CheckCircle2 />} tom="sucesso" />
        <Indicador rotulo="Na fila / tentando de novo" valor={<Contador valor={resumo.fila} />} icone={<Clock />} tom={resumo.fila ? "alerta" : "neutro"} detalhe={`${e.falhou ?? 0} com falha, vão tentar de novo`} />
        <Indicador rotulo="Desistiu (6 tentativas)" valor={<Contador valor={e.desistiu ?? 0} />} icone={<XCircle />} tom={e.desistiu ? "perigo" : "neutro"} />
        <Indicador
          rotulo="Chamadas à API"
          valor={<Contador valor={resumo.api_total} />}
          icone={<Activity />}
          detalhe={`${resumo.api_erros} com erro (${Object.entries(resumo.api_por_status).filter(([s]) => Number(s) >= 400).map(([s, n]) => `${n}× ${s}`).join(", ") || "nenhum"})`}
          tom={resumo.api_erros ? "alerta" : "neutro"}
        />
      </div>

      <h2 className="mb-3 text-[17px] font-semibold text-texto">Webhooks com falha</h2>
      <div className="mb-8">
        <TabelaEntregas entregas={falhas} nomes={nomes} admin={admin} vazio="Nenhuma falha no período." />
      </div>

      <div className="mb-8 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Cartao titulo="Uso da API por chave">
          <Tabela colunas={["Chave", "Chamadas", "Com erro", "Última"]}>
            {resumo.api_por_chave.length === 0 ? (
              <LinhaVazia colunas={4}>
                <KeyRound className="mx-auto mb-2 size-5" />
                Nenhuma chamada no período.
              </LinhaVazia>
            ) : (
              resumo.api_por_chave.map((c) => (
                <tr key={c.chave_id ?? c.prefixo ?? "x"}>
                  <Celula>
                    <div className="font-semibold">{(c.chave_id && nomesChave.get(c.chave_id)) ?? "Chave excluída"}</div>
                    <div className="font-mono text-[11px] text-mudo">{c.prefixo}</div>
                  </Celula>
                  <Celula className="tabular-nums">{c.total}</Celula>
                  <Celula className={`tabular-nums ${c.erros ? "text-ruim" : ""}`}>{c.erros}</Celula>
                  <Celula className="whitespace-nowrap text-texto-2">{quando(c.ultimo)}</Celula>
                </tr>
              ))
            )}
          </Tabela>
        </Cartao>
        <Cartao titulo="Uso da API por recurso">
          {Object.keys(resumo.api_por_recurso).length === 0 ? (
            <p className="text-sm text-mudo">Nenhuma chamada no período.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {Object.entries(resumo.api_por_recurso)
                .sort((a, b) => b[1] - a[1])
                .map(([r, n]) => (
                  <li key={r} className="flex justify-between gap-3 border-b border-borda-suave pb-2 last:border-0">
                    <span className="font-mono text-texto-2">/api/v1/{r}</span>
                    <span className="tabular-nums text-texto">{n}</span>
                  </li>
                ))}
            </ul>
          )}
        </Cartao>
      </div>

      <h2 className="mb-3 text-[17px] font-semibold text-texto">Outras integrações</h2>
      <Tabela colunas={["Integração", "Ok", "Falhas", "Detalhe", ""]}>
        {outras.map((o) => (
          <tr key={o.nome}>
            <Celula className="font-semibold">{o.nome}</Celula>
            <Celula className="tabular-nums">{o.ok}</Celula>
            <Celula>{o.falhas ? <Selo cor="vermelho">{o.falhas}</Selo> : <Selo cor="verde">0</Selo>}</Celula>
            <Celula className="text-[12.5px] text-texto-2">{o.detalhe}</Celula>
            <Celula>
              <Link href={o.href} className="inline-flex items-center gap-1 text-sm text-acento hover:underline">
                {o.falhas ? <TriangleAlert className="size-3.5" /> : null} Abrir
              </Link>
            </Celula>
          </tr>
        ))}
      </Tabela>
      <p className="mt-3 text-xs text-mudo">O reprocessamento das outras integrações é feito na tela de cada uma (as falhas de portal, por exemplo, se resolvem corrigindo o anúncio).</p>
    </>
  );
}
