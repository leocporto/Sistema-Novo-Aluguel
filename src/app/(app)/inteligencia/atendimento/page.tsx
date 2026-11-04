import type { Metadata } from "next";
import Link from "next/link";
import { LinhaLink } from "@/components/linha-link";
import { Aviso, Cabecalho, Cartao, Celula, Definicao, LinhaVazia, Selo, Tabela } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { NOMES_DIAS_SEMANA, ROTULO_CAMPO_QUALIFICACAO, dentroDoHorario, textoHorario } from "@/lib/dominio/ia";
import { AbasInteligencia } from "../abas";
import { AvisoIA } from "../componentes";
import { estadoIA, podeConfigurarIA, quando } from "../dados";
import { SugestaoAtendimento } from "./sugestao";

export const metadata: Metadata = { title: "Atendimento e qualificação" };

/**
 * Chatbot de qualificação e atendimento fora do horário (imobiliária), no modo
 * ASSISTIDO: respostas sugeridas para a equipe; a resposta automática fora do
 * horário fica pronta como ação e sai pelo botão (o sistema ainda não tem a
 * integração de envio pela API do WhatsApp — ponto para ligar depois).
 */
export default async function AtendimentoPage({ searchParams }: PageProps<"/inteligencia/atendimento">) {
  const sp = await searchParams;
  const { supabase, organizacao, papel } = await obterContexto();
  const ia = await estadoIA(supabase);
  const cfg = ia.config;
  const { data: conversas } = await supabase
    .from("mkt_conversas")
    .select("id, canal, contato, nome, status, nao_lidas, ultima_mensagem, ultima_em, lead_id, pessoa_id")
    .neq("status", "resolvida")
    .order("ultima_em", { ascending: false, nullsFirst: false })
    .limit(20);
  const lista = (conversas ?? []) as {
    id: string;
    canal: string;
    contato: string;
    nome: string | null;
    status: string;
    nao_lidas: number;
    ultima_mensagem: string | null;
    ultima_em: string | null;
    lead_id: string | null;
    pessoa_id: string | null;
  }[];
  let escolhida = lista.find((c) => c.id === sp.conversa) ?? null;
  if (!escolhida && typeof sp.conversa === "string" && /^[0-9a-f-]{36}$/i.test(sp.conversa)) {
    // Veio da ficha da conversa (Marketing → Conversas) e ela não está entre as 20 mais recentes.
    const { data: c } = await supabase
      .from("mkt_conversas")
      .select("id, canal, contato, nome, status, nao_lidas, ultima_mensagem, ultima_em, lead_id, pessoa_id")
      .eq("id", sp.conversa)
      .maybeSingle();
    escolhida = (c as (typeof lista)[number] | null) ?? null;
  }
  let ultimaEntrada: string | null = null;
  if (escolhida) {
    const { data: m } = await supabase.from("mkt_mensagens").select("texto").eq("conversa_id", escolhida.id).eq("direcao", "entrada").order("data", { ascending: false }).limit(1).maybeSingle();
    ultimaEntrada = (m?.texto as string | null) ?? null;
  }
  const agoraNoHorario = dentroDoHorario(new Date(), cfg);
  return (
    <>
      <Cabecalho
        titulo="Atendimento e qualificação"
        trilha="Assistente e automações"
        descricao="Respostas sugeridas para as conversas e para o formulário de leads, com as perguntas de qualificação (finalidade, região, valor, quartos, prazo). A equipe confere e manda: nada sai para o cliente sem passar por uma pessoa."
      />
      <AbasInteligencia modo={organizacao.modo} />
      <div className="space-y-5">
        <AvisoIA configurada={ia.configurada} ativa={cfg.ativa} podeConfigurar={podeConfigurarIA(papel)} />
        <Cartao
          titulo="Como está configurado"
          acoes={
            podeConfigurarIA(papel) ? (
              <Link href="/inteligencia/configuracoes" className="text-sm text-acento hover:underline">
                Mudar
              </Link>
            ) : undefined
          }
        >
          <Definicao
            itens={[
              ["Horário comercial", `${textoHorario(cfg)} · ${cfg.dias_uteis.map((d) => NOMES_DIAS_SEMANA[d]).join(", ") || "nenhum dia"}`],
              ["Agora", agoraNoHorario ? <Selo cor="verde">Dentro do horário</Selo> : <Selo cor="amarelo">Fora do horário</Selo>],
              ["Perguntas de qualificação", cfg.perguntas.filter((p) => p.ativa).map((p) => ROTULO_CAMPO_QUALIFICACAO[p.campo]).join(", ") || "nenhuma"],
              ["Resposta fora do horário", cfg.fora_horario_ativo ? "Ligada: vira uma ação pronta por conversa em “Ações para aprovar”" : "Desligada"],
              [
                "Aprovação de cada resposta",
                cfg.fora_horario_envio_auto ? <Selo cor="azul">Dispensada pelo administrador (texto fixo)</Selo> : "Sim (a equipe aprova cada resposta)",
              ],
              ["Envio", <Selo key="envio" cor="amarelo">Pelo botão “Abrir WhatsApp” (o sistema ainda não envia sozinho)</Selo>],
            ]}
          />
          <p className="mt-3 text-xs text-mudo">
            Dispensar a aprovação só vale para o texto fixo que o administrador aprovou (nunca para texto livre da IA). Mesmo assim, a mensagem sai pelo botão “Abrir WhatsApp”: o envio
            sozinho pela API oficial do WhatsApp depende de uma integração de envio que o sistema ainda não tem (fica para ligar depois).
          </p>
        </Cartao>
        <Cartao titulo={escolhida ? `Sugerir resposta — ${escolhida.nome ?? escolhida.contato}` : "Sugerir resposta para uma mensagem"}>
          {escolhida && (
            <p className="mb-3 text-xs text-mudo">
              Usando a última mensagem recebida nesta conversa.{" "}
              <Link href={`/inteligencia/resumo?fonte=conversa&id=${escolhida.id}`} className="text-acento hover:underline">
                Resumir a conversa
              </Link>{" "}
              ·{" "}
              <Link href={`/marketing/conversas/${escolhida.id}`} className="text-acento hover:underline">
                Abrir no Marketing
              </Link>
            </p>
          )}
          <SugestaoAtendimento
            key={escolhida?.id ?? "livre"}
            conversa={
              escolhida
                ? { id: escolhida.id, canal: escolhida.canal, contato: escolhida.contato, nome: escolhida.nome, ultimaEntrada, leadId: escolhida.lead_id, pessoaId: escolhida.pessoa_id }
                : null
            }
          />
        </Cartao>
        <div>
          <h2 className="mb-3 text-[17px] font-semibold tracking-[-0.01em] text-texto">Conversas em aberto</h2>
          {lista.length === 0 && <Aviso>Nenhuma conversa em aberto na caixa do WhatsApp (Marketing → Conversas).</Aviso>}
          {lista.length > 0 && (
            <Tabela colunas={["Contato", "Última mensagem", "Quando", "Não lidas"]}>
              {lista.length === 0 ? (
                <LinhaVazia colunas={4}>—</LinhaVazia>
              ) : (
                lista.map((c) => (
                  <LinhaLink key={c.id} href={`/inteligencia/atendimento?conversa=${c.id}`}>
                    <Celula className="font-semibold">{c.nome ?? c.contato}</Celula>
                    <Celula className="max-w-[360px] truncate text-texto-2">{c.ultima_mensagem ?? "—"}</Celula>
                    <Celula className="whitespace-nowrap text-texto-2">{quando(c.ultima_em)}</Celula>
                    <Celula>{c.nao_lidas ? <Selo cor="amarelo">{c.nao_lidas}</Selo> : "—"}</Celula>
                  </LinhaLink>
                ))
              )}
            </Tabela>
          )}
        </div>
      </div>
    </>
  );
}
