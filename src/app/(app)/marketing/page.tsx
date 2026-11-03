import type { Metadata } from "next";
import Link from "next/link";
import { Inbox, Megaphone, Send, Smile, Target } from "lucide-react";
import { Contador } from "@/components/abas-segmentadas";
import { Aviso, BotaoLink, Cabecalho, Cartao, Indicador, Selo } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { agoraMs, hojeISO, inicioDoMes } from "@/lib/dominio/datas";
import { calcularNps, formatarDataHora, ROTULO_TIPO_CAMPANHA, type TipoCampanha } from "@/lib/dominio/marketing";
import { processarAutomacoes } from "./automacao";
import { AbasMarketing } from "./campos";
import { todas, urlBase } from "./dados";

export const metadata: Metadata = { title: "Marketing" };

export default async function MarketingPage() {
  const { supabase, organizacao } = await obterContexto();
  const agora = agoraMs();
  const agoraIso = new Date(agora).toISOString();
  const ini = inicioDoMes(hojeISO());
  // Automação com problema não pode derrubar a tela (o botão "Rodar agora" mostra o erro).
  const auto = await processarAutomacoes(supabase, { base: await urlBase(), imobiliaria: organizacao.nome }).catch(() => ({ envios: 0, tarefas: 0, eventos: 0 }));

  const [abertas, paraEnviar, enviados, notas, leadsMes, leadsRastreados, agendadas, conversas] = await Promise.all([
    supabase.from("mkt_conversas").select("id", { count: "exact", head: true }).eq("status", "aberta"),
    supabase.from("mkt_envios").select("id", { count: "exact", head: true }).eq("status", "pendente").lte("agendado_para", agoraIso),
    supabase.from("mkt_envios").select("id", { count: "exact", head: true }).eq("status", "enviado").gte("enviado_em", new Date(agora - 30 * 86_400_000).toISOString()),
    todas<{ id: string; nota: number }>(() =>
      supabase.from("mkt_pesquisas").select("id, nota").not("nota", "is", null).gte("respondida_em", new Date(agora - 365 * 86_400_000).toISOString()).order("id"),
    ),
    supabase.from("leads").select("id", { count: "exact", head: true }).gte("created_at", ini),
    supabase.from("leads").select("id", { count: "exact", head: true }).gte("created_at", ini).or("utm_source.not.is.null,landing_id.not.is.null,gclid.not.is.null,fbclid.not.is.null"),
    supabase.from("mkt_campanhas").select("id, nome, tipo, agendada_para").eq("status", "fila").gt("agendada_para", agoraIso).order("agendada_para").limit(5),
    supabase.from("mkt_conversas").select("id, nome, contato, ultima_mensagem, ultima_em, nao_lidas").eq("status", "aberta").order("ultima_em", { ascending: false }).limit(6),
  ]);
  const nps = calcularNps(notas.map((n) => n.nota));

  return (
    <>
      <Cabecalho
        titulo="Marketing e comunicação"
        trilha="Marketing"
        descricao="Campanhas segmentadas, fila de envio por WhatsApp e e-mail, caixa de entrada compartilhada, automações, landing pages, origem dos leads, pesquisas de satisfação e descadastro (LGPD)."
        acoes={
          <>
            <BotaoLink href="/marketing/fila" variante="secundario">
              <Send className="size-4" /> Fila de envio
            </BotaoLink>
            <BotaoLink href="/marketing/campanhas?novo=1">
              <Megaphone className="size-4" /> Nova campanha
            </BotaoLink>
          </>
        }
      />
      <AbasMarketing />

      {(auto.envios > 0 || auto.tarefas > 0) && (
        <div className="mb-4">
          <Aviso>
            As automações acabaram de rodar: {auto.envios} mensagem(ns) entraram na <Link href="/marketing/fila" className="font-semibold text-acento hover:underline">fila de envio</Link>
            {auto.tarefas ? ` e ${auto.tarefas} tarefa(s) foram criadas no Comercial` : ""}.
          </Aviso>
        </div>
      )}

      <div className="entrar-cascata mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Indicador rotulo="Conversas esperando resposta" icone={<Inbox />} valor={<Contador valor={abertas.count ?? 0} />} tom={abertas.count ? "alerta" : "sucesso"} href="/marketing/conversas" />
        <Indicador rotulo="Para enviar agora" icone={<Send />} valor={<Contador valor={paraEnviar.count ?? 0} />} detalhe="na fila de envio" href="/marketing/fila" tom={paraEnviar.count ? "alerta" : "neutro"} />
        <Indicador rotulo="Enviadas (30 dias)" icone={<Megaphone />} valor={<Contador valor={enviados.count ?? 0} />} detalhe="WhatsApp, e-mail e SMS" href="/marketing/fila?situacao=enviado" />
        <Indicador
          rotulo="NPS (12 meses)"
          icone={<Smile />}
          valor={nps.nps === null ? "—" : <Contador valor={nps.nps} />}
          detalhe={nps.respostas ? `${nps.respostas} resposta(s) · média ${String(nps.media).replace(".", ",")}` : "nenhuma resposta ainda"}
          tom={nps.nps === null ? "neutro" : nps.nps >= 50 ? "sucesso" : nps.nps < 0 ? "perigo" : "alerta"}
          href="/marketing/pesquisas"
        />
        <Indicador
          rotulo="Leads do mês com origem rastreada"
          icone={<Target />}
          valor={<Contador valor={leadsRastreados.count ?? 0} />}
          detalhe={`de ${leadsMes.count ?? 0} lead(s) no mês (UTM, landing, gclid, fbclid)`}
          href="/marketing/origem"
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Cartao titulo="Conversas esperando resposta" acoes={<BotaoLink href="/marketing/conversas" variante="fantasma">Ver todas</BotaoLink>}>
          {(conversas.data ?? []).length === 0 ? (
            <p className="text-sm text-mudo">Nenhuma conversa esperando. As mensagens do WhatsApp Business caem aqui quando o webhook estiver ligado (aba Integrações).</p>
          ) : (
            <ul className="divide-y divide-borda-suave">
              {(conversas.data ?? []).map((c) => (
                <li key={c.id} className="py-2.5">
                  <Link href={`/marketing/conversas/${c.id}`} className="flex items-center justify-between gap-3">
                    <span className="min-w-0">
                      <span className="font-semibold text-acento hover:underline">{c.nome ?? `+${c.contato}`}</span>
                      <span className="block truncate text-xs text-mudo">{c.ultima_mensagem ?? "—"}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2 text-xs text-mudo">
                      {c.nao_lidas > 0 && <Selo cor="vermelho">{c.nao_lidas}</Selo>}
                      {formatarDataHora(c.ultima_em)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Cartao>
        <Cartao titulo="Campanhas agendadas" acoes={<BotaoLink href="/marketing/campanhas" variante="fantasma">Campanhas</BotaoLink>}>
          {(agendadas.data ?? []).length === 0 ? (
            <p className="text-sm text-mudo">Nenhuma campanha agendada. Crie uma campanha, escolha o público e a data/hora: a fila fica pronta e as mensagens aparecem para enviar na hora marcada.</p>
          ) : (
            <ul className="divide-y divide-borda-suave">
              {(agendadas.data ?? []).map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 py-2.5">
                  <Link href={`/marketing/campanhas/${c.id}`} className="min-w-0 font-semibold text-acento hover:underline">
                    {c.nome}
                    <span className="block text-xs font-normal text-mudo">{ROTULO_TIPO_CAMPANHA[c.tipo as TipoCampanha] ?? c.tipo}</span>
                  </Link>
                  <Selo cor="amarelo">{formatarDataHora(c.agendada_para)}</Selo>
                </li>
              ))}
            </ul>
          )}
        </Cartao>
      </div>

      <div className="mt-6">
        <Aviso>
          <b>O que já funciona sem contratar nada:</b> fila com WhatsApp (wa.me), e-mail (mailto) e SMS abrindo com a mensagem pronta, exportação em CSV para
          ferramentas de e-mail, landing pages com UTM, pixel da Meta e tag do Google, links de pesquisa e de descadastro, conversões offline em CSV.{" "}
          <b>Fica pronto para ligar quando houver credencial:</b> envio automático pela API oficial do WhatsApp Business, e-mail transacional, SMS, busca dos dados do
          Meta Lead Ads e envio de conversões pela API — veja a aba Integrações.
        </Aviso>
      </div>
    </>
  );
}
