import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArrowRightLeft, ListTodo, Send, UserRoundCog } from "lucide-react";
import { Copiar } from "@/components/copiar";
import { JanelaCadastro } from "@/components/janela-cadastro";
import { AreaTexto, BotaoLink, Cabecalho, Campo, Cartao, Entrada, Selecao, Selo } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { agoraMs, formatarDataBR, formatarDataLocal, hojeISO } from "@/lib/dominio/datas";
import { ROTULO_INTENCAO, dentroDoHorario, faixaNota, intencaoPorRegra, notaLead, perguntasFaltando, proximoContato, respostaPorRegra } from "@/lib/dominio/ia";
import { ROTULO_STATUS_LEAD, type StatusLead } from "@/lib/tipos";
import { AbasInteligencia } from "../../abas";
import { sugerirAcao } from "../../actions";
import { AvisoIA } from "../../componentes";
import { estadoIA, podeConfigurarIA } from "../../dados";
import { SELECT_LEAD_IA, sinaisDosLeads, type LeadPrioridade } from "../dados";
import { AnaliseLeadIA } from "./analise-ia";

export const metadata: Metadata = { title: "Análise do lead" };

const CANAL = { whatsapp: "WhatsApp", ligacao: "Ligação", email: "E-mail" } as const;

/** Análise de um lead: nota, intenção, perguntas que faltam, próximo contato e sugestões que vão para aprovação. */
export default async function LeadIAPage({ params }: PageProps<"/inteligencia/prioridades/[id]">) {
  const { id } = await params;
  const { supabase, organizacao, papel } = await obterContexto();
  const { data } = await supabase.from("leads").select(SELECT_LEAD_IA).eq("id", id).maybeSingle();
  if (!data) notFound();
  const lead = data as unknown as LeadPrioridade;
  const hoje = hojeISO();
  const agora = agoraMs();
  const [ia, sinais, { data: ev }, { data: cors }] = await Promise.all([
    estadoIA(supabase),
    sinaisDosLeads(supabase, [id], agora),
    supabase.from("lead_eventos").select("tipo, descricao, data").eq("lead_id", id).order("data", { ascending: false }).limit(10),
    supabase.from("pessoas").select("id, nome").contains("papeis", ["corretor"]).order("nome").limit(300),
  ]);
  const corretores = ((cors ?? []) as { id: string; nome: string }[]).filter((c) => c.id !== lead.corretor_id);
  const s = sinais.get(id)!;
  const { nota, fatores } = notaLead(lead, s, agora, hoje);
  const proximo = proximoContato(lead, s, hoje);
  const eventos = (ev ?? []) as { tipo: string; descricao: string | null; data: string }[];
  const ultimaMensagem = eventos.find((e) => ["mensagem", "whatsapp", "entrada"].includes(e.tipo))?.descricao ?? lead.observacoes ?? "";
  const intencao = intencaoPorRegra(ultimaMensagem);
  const faltando = perguntasFaltando(lead, ia.config.perguntas);
  const fora = !dentroDoHorario(new Date(agora), ia.config) && ia.config.fora_horario_ativo;
  const resposta = respostaPorRegra({ nome: lead.nome, imobiliaria: organizacao.nome, intencao: intencao.intencao, faltando, foraDoHorario: fora, cfg: ia.config });
  const f = faixaNota(nota);
  const contato = lead.telefone ?? lead.email;

  return (
    <>
      <Cabecalho
        titulo={lead.nome}
        trilha="Prioridades"
        descricao={`${ROTULO_STATUS_LEAD[lead.status as StatusLead] ?? lead.status} · chegou em ${formatarDataLocal(lead.created_at)}. Tudo aqui é sugestão: mudar etapa, trocar o responsável ou mandar mensagem passa por “Ações para aprovar”.`}
        acoes={
          <>
            <BotaoLink href={`/comercial/leads/${id}`} variante="secundario">
              Abrir no Comercial
            </BotaoLink>
            <BotaoLink href={`/inteligencia/resumo?fonte=lead&id=${id}`} variante="secundario">
              Resumir histórico
            </BotaoLink>
          </>
        }
      />
      <AbasInteligencia modo={organizacao.modo} />
      <div className="space-y-5">
        <AvisoIA configurada={ia.configurada} ativa={ia.config.ativa} podeConfigurar={podeConfigurarIA(papel)} />
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <Cartao titulo={<span className="flex items-center gap-2">Nota por regra <Selo cor={f.cor}>{`${nota} · ${f.rotulo}`}</Selo></span>}>
            <ul className="space-y-1.5 text-sm">
              {fatores.map((x) => (
                <li key={x.rotulo} className="flex justify-between gap-3">
                  <span className="text-texto-2">{x.rotulo}</span>
                  <span className={`tabular-nums font-semibold ${x.pontos < 0 ? "text-ruim" : "text-texto"}`}>
                    {x.pontos > 0 ? "+" : ""}
                    {x.pontos}
                  </span>
                </li>
              ))}
            </ul>
          </Cartao>
          <Cartao titulo="Próximo contato e intenção">
            {proximo ? (
              <p className="text-sm text-texto">
                <strong>{proximo.quando <= hoje ? "Hoje" : formatarDataBR(proximo.quando)}</strong> por {CANAL[proximo.canal]} — {proximo.motivo}
              </p>
            ) : (
              <p className="text-sm text-mudo">Atendimento encerrado.</p>
            )}
            <p className="mt-3 text-sm text-texto">
              Intenção (pela última mensagem): <Selo cor="azul">{ROTULO_INTENCAO[intencao.intencao]}</Selo> <span className="text-xs text-mudo">confiança {intencao.confianca}</span>
            </p>
            <div className="mt-3 text-sm">
              <div className="text-xs font-semibold text-texto-2">Perguntas de qualificação que faltam</div>
              {faltando.length ? (
                <ul className="mt-1 list-disc pl-5 text-texto">
                  {faltando.map((p) => (
                    <li key={p.campo}>{p.texto}</li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-mudo">Nenhuma: o perfil está completo.</p>
              )}
            </div>
          </Cartao>
        </div>
        <Cartao titulo="Resposta sugerida (por regra)">
          <p className="whitespace-pre-line rounded-[12px] border border-borda bg-elev p-3 text-sm text-texto">{resposta}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Copiar texto={resposta} />
            {contato && (
              <JanelaCadastro
                rotuloBotao={
                  <>
                    <Send className="size-4" /> Enviar para aprovação
                  </>
                }
                titulo="Mensagem para o cliente (vai para aprovação)"
                acao={sugerirAcao}
                variante="secundario"
                tamanho="sm"
                rotuloSalvar="Enviar para aprovação"
              >
                <input type="hidden" name="tipo" value="mensagem_cliente" />
                <input type="hidden" name="origem" value="usuario" />
                <input type="hidden" name="titulo" value={`Mensagem para ${lead.nome}`} />
                <input type="hidden" name="canal" value={lead.telefone ? "whatsapp" : "email"} />
                <input type="hidden" name="destino" value={contato} />
                <input type="hidden" name="nome" value={lead.nome} />
                <input type="hidden" name="lead_id" value={id} />
                <Campo rotulo="Texto">
                  <AreaTexto name="texto" rows={5} required maxLength={4000} defaultValue={resposta} />
                </Campo>
              </JanelaCadastro>
            )}
            <JanelaCadastro
              rotuloBotao={
                <>
                  <ArrowRightLeft className="size-4" /> Sugerir mudança de etapa
                </>
              }
              titulo="Mudar etapa do lead (vai para aprovação)"
              acao={sugerirAcao}
              variante="secundario"
              tamanho="sm"
              rotuloSalvar="Enviar para aprovação"
            >
              <input type="hidden" name="tipo" value="mudar_etapa_lead" />
              <input type="hidden" name="origem" value="usuario" />
              <input type="hidden" name="lead_id" value={id} />
              <input type="hidden" name="titulo" value={`Mudar etapa de ${lead.nome}`} />
              <Campo rotulo="Nova etapa">
                <Selecao name="status" defaultValue={lead.status}>
                  {Object.entries(ROTULO_STATUS_LEAD).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </Selecao>
              </Campo>
              <Campo rotulo="Motivo" dica="Obrigatório para marcar como perdido.">
                <Entrada name="motivo" maxLength={300} />
              </Campo>
            </JanelaCadastro>
            <JanelaCadastro
              rotuloBotao={
                <>
                  <UserRoundCog className="size-4" /> Sugerir troca de responsável
                </>
              }
              titulo="Trocar o responsável do lead (vai para aprovação)"
              acao={sugerirAcao}
              variante="secundario"
              tamanho="sm"
              rotuloSalvar="Enviar para aprovação"
            >
              <input type="hidden" name="tipo" value="mudar_responsavel_lead" />
              <input type="hidden" name="origem" value="usuario" />
              <input type="hidden" name="lead_id" value={id} />
              <input type="hidden" name="titulo" value={`Trocar o responsável de ${lead.nome}`} />
              <Campo rotulo="Novo responsável" dica="Ao aprovar, a troca é feita pela mesma regra do Comercial (Transferir) e fica no histórico do lead.">
                <Selecao name="corretor_id" defaultValue="">
                  <option value="">— sem corretor —</option>
                  {corretores.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nome}
                    </option>
                  ))}
                </Selecao>
              </Campo>
              <Campo rotulo="Motivo">
                <Entrada name="motivo" maxLength={300} placeholder="Ex.: lead parado há 10 dias, corretor de férias" />
              </Campo>
            </JanelaCadastro>
            <JanelaCadastro
              rotuloBotao={
                <>
                  <ListTodo className="size-4" /> Sugerir tarefa
                </>
              }
              titulo="Criar tarefa (vai para aprovação)"
              acao={sugerirAcao}
              variante="secundario"
              tamanho="sm"
              rotuloSalvar="Enviar para aprovação"
            >
              <input type="hidden" name="tipo" value="criar_tarefa" />
              <input type="hidden" name="origem" value="usuario" />
              <input type="hidden" name="lead_id" value={id} />
              <input type="hidden" name="titulo" value={`Tarefa do lead ${lead.nome}`} />
              <Campo rotulo="Tarefa">
                <Entrada name="titulo_tarefa" required maxLength={200} defaultValue={proximo ? `${proximo.motivo} — ${lead.nome}` : `Falar com ${lead.nome}`} />
              </Campo>
              <Campo rotulo="Para quando">
                <Entrada name="vencimento" type="date" defaultValue={proximo?.quando ?? hoje} />
              </Campo>
              <Campo rotulo="Prioridade">
                <Selecao name="prioridade" defaultValue={nota >= 70 ? "alta" : "normal"}>
                  <option value="normal">Normal</option>
                  <option value="alta">Alta</option>
                </Selecao>
              </Campo>
            </JanelaCadastro>
          </div>
        </Cartao>
        {ia.disponivel && ia.config.recursos.includes("leads") && (
          <Cartao titulo="Análise com IA">
            <AnaliseLeadIA leadId={id} notaRegra={nota} contato={{ nome: lead.nome, telefone: lead.telefone, email: lead.email }} />
          </Cartao>
        )}
      </div>
    </>
  );
}
