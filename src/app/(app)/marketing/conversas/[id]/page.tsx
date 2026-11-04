import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MessageCircle, Sparkles, UserCheck, UserPlus } from "lucide-react";
import { BotaoAcao } from "@/components/botao-acao";
import { BotaoExcluir } from "@/components/botao-excluir";
import { BotaoEnviar, Formulario } from "@/components/formulario";
import { AreaTexto, Campo, Cartao, classeBotao, Entrada, Selecao, Selo } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { formatarDataHora, ROTULO_STATUS_CONVERSA } from "@/lib/dominio/marketing";
import { linkWhatsapp } from "@/lib/whatsapp";
import { assumirConversa, atualizarConversa, criarLeadDaConversa, excluirConversa, excluirMensagem, registrarMensagem } from "../../actions";
import { SeloCanal } from "../../campos";
import { carregarMembros } from "../../dados";
import { Responder } from "./responder";

export const metadata: Metadata = { title: "Conversa" };

export default async function ConversaPage({ params }: PageProps<"/marketing/conversas/[id]">) {
  const { id } = await params;
  const { supabase, organizacao, usuario } = await obterContexto();
  const { data: c } = await supabase
    .from("mkt_conversas")
    .select("*, lead:leads(id, nome), pessoa:pessoas(id, nome)")
    .eq("id", id)
    .maybeSingle();
  if (!c) notFound();
  // Abriu a conversa: as mensagens novas contam como lidas.
  if (c.nao_lidas > 0) await supabase.from("mkt_conversas").update({ nao_lidas: 0 }).eq("id", id);
  const [{ data: mensagens }, membros, { data: modelos }, { data: leads }, { data: pessoas }] = await Promise.all([
    supabase.from("mkt_mensagens").select("id, direcao, texto, tipo, status, data, usuario_id").eq("conversa_id", id).order("data").limit(1000),
    carregarMembros(supabase),
    supabase.from("mkt_modelos").select("id, nome, corpo").eq("ativo", true).eq("canal", c.canal === "email" ? "email" : c.canal === "sms" ? "sms" : "whatsapp").order("nome"),
    supabase.from("leads").select("id, nome").not("status", "in", "(ganho,perdido)").order("nome").limit(2000),
    supabase.from("pessoas").select("id, nome").order("nome").limit(2000),
  ]);
  const nomes = new Map(membros.map((m) => [m.user_id, m.nome]));
  const titulo = c.nome ?? (c.canal === "email" ? c.contato : `+${c.contato}`);
  const lead = c.lead as { id: string; nome: string } | null;
  const pessoa = c.pessoa as { id: string; nome: string } | null;
  // O lead ligado pode estar fechado e a pessoa ligada pode estar fora das 2.000 primeiras:
  // ficam na lista, senão o salvamento automático trocaria o vínculo por "nenhum".
  const opcoesLead = lead && !(leads ?? []).some((l) => l.id === lead.id) ? [lead, ...(leads ?? [])] : (leads ?? []);
  const opcoesPessoa = pessoa && !(pessoas ?? []).some((p) => p.id === pessoa.id) ? [pessoa, ...(pessoas ?? [])] : (pessoas ?? []);
  const opcoesMembro = c.responsavel_id && !membros.some((m) => m.user_id === c.responsavel_id) ? [{ user_id: c.responsavel_id as string, nome: "Ex-membro da equipe" }, ...membros] : membros;

  return (
    <>
      <div className="mb-[clamp(14px,1.5vw,18px)] flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[13px] text-mudo">
            <span>Novo Aluguel</span>
            <span className="text-fraco">›</span>
            <Link href="/marketing/conversas" className="text-acento-hot hover:underline">
              Conversas
            </Link>
          </div>
          <h1 className="mt-1.5 text-[clamp(26px,2.8vw,36px)] font-semibold leading-[1.05] tracking-[-0.025em] text-texto">{titulo}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[13.5px] text-texto-2">
            <SeloCanal canal={c.canal} />
            <span>{c.canal === "email" ? c.contato : `+${c.contato}`}</span>
            <Selo cor={c.status === "aberta" ? "amarelo" : c.status === "aguardando" ? "azul" : "verde"}>{ROTULO_STATUS_CONVERSA[c.status] ?? c.status}</Selo>
            {lead && (
              <Link href={`/comercial/leads/${lead.id}`} className="text-acento hover:underline">
                lead: {lead.nome}
              </Link>
            )}
            {pessoa && (
              <Link href={`/pessoas/${pessoa.id}`} className="text-acento hover:underline">
                cadastro: {pessoa.nome}
              </Link>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {c.canal === "whatsapp" && (
            <a href={linkWhatsapp(c.contato)} target="_blank" rel="noreferrer" className={classeBotao("secundario")}>
              <MessageCircle className="size-4" /> Abrir no WhatsApp
            </a>
          )}
          {/* Assistente e automações (etapa 22): resposta sugerida (qualificação) e resumo da conversa. */}
          <Link href={`/inteligencia/atendimento?conversa=${id}`} className={classeBotao("secundario")}>
            <Sparkles className="size-4" /> Resposta sugerida
          </Link>
          {c.responsavel_id !== usuario.id && (
            <BotaoAcao acao={assumirConversa} id={id}>
              <UserCheck className="size-4" /> Assumir
            </BotaoAcao>
          )}
          {!lead && !pessoa && (
            <BotaoAcao acao={criarLeadDaConversa} id={id} confirmar="Criar um lead com este contato? As próximas mensagens entram no histórico dele.">
              <UserPlus className="size-4" /> Criar lead
            </BotaoAcao>
          )}
          <BotaoExcluir acao={excluirConversa} id={id} variante="botao" confirmar="Excluir a conversa e as mensagens dela?" depois="/marketing/conversas" />
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <Cartao titulo="Mensagens">
            <ol className="space-y-3">
              {(mensagens ?? []).map((m) => (
                <li key={m.id} className={`flex ${m.direcao === "saida" ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`group max-w-[78%] rounded-[16px] border px-4 py-2.5 ${m.direcao === "saida" ? "border-acento-bd bg-acento-bg" : "border-borda bg-elev"}`}
                  >
                    {m.texto ? <p className="whitespace-pre-wrap break-words text-[14px] text-texto">{m.texto}</p> : <p className="text-sm italic text-mudo">[{m.tipo}]</p>}
                    <div className="mt-1 flex items-center justify-end gap-2 text-[11px] text-mudo">
                      {m.direcao === "saida" && m.usuario_id && <span>{nomes.get(m.usuario_id) ?? ""}</span>}
                      <span>{formatarDataHora(m.data)}</span>
                      {m.direcao === "saida" && <span>· {m.status}</span>}
                      <BotaoExcluir acao={excluirMensagem} id={m.id} variante="texto" rotulo="Excluir" confirmar="Excluir esta mensagem da conversa?" />
                    </div>
                  </div>
                </li>
              ))}
              {!(mensagens ?? []).length && <li className="text-sm text-mudo">Nenhuma mensagem ainda.</li>}
            </ol>
          </Cartao>
          <Cartao titulo="Responder">
            <Responder
              conversaId={id}
              canal={c.canal}
              contato={c.contato}
              nome={c.nome ?? lead?.nome ?? pessoa?.nome ?? null}
              imobiliaria={organizacao.nome}
              modelos={(modelos ?? []) as { id: string; nome: string; corpo: string }[]}
            />
          </Cartao>
          <Cartao titulo="Registrar mensagem que chegou por fora">
            <Formulario acao={registrarMensagem} className="space-y-3">
              <input type="hidden" name="conversa_id" value={id} />
              <input type="hidden" name="direcao" value="entrada" />
              <AreaTexto name="texto" rows={2} required aria-label="Mensagem recebida" placeholder="Cole aqui o que o cliente mandou (ligação, e-mail, WhatsApp do celular…)" />
              <div className="flex justify-end">
                <BotaoEnviar variante="secundario">Registrar mensagem recebida</BotaoEnviar>
              </div>
            </Formulario>
          </Cartao>
        </div>

        <Formulario acao={atualizarConversa} automatico>
          <input type="hidden" name="id" value={id} />
          <Cartao titulo="Atendimento">
            <div className="space-y-4">
              <Campo rotulo="Situação">
                <Selecao name="status" defaultValue={c.status}>
                  {Object.entries(ROTULO_STATUS_CONVERSA).map(([k, r]) => (
                    <option key={k} value={k}>
                      {r}
                    </option>
                  ))}
                </Selecao>
              </Campo>
              <Campo rotulo="Responsável">
                <Selecao name="responsavel_id" defaultValue={c.responsavel_id ?? ""}>
                  <option value="">— ninguém —</option>
                  {opcoesMembro.map((m) => (
                    <option key={m.user_id} value={m.user_id}>
                      {m.nome}
                    </option>
                  ))}
                </Selecao>
              </Campo>
              <Campo rotulo="Nome do contato">
                <Entrada name="nome" defaultValue={c.nome ?? ""} />
              </Campo>
              <Campo rotulo="Lead (histórico no CRM)">
                <Selecao name="lead_id" defaultValue={c.lead_id ?? ""}>
                  <option value="">— nenhum —</option>
                  {opcoesLead.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.nome}
                    </option>
                  ))}
                </Selecao>
              </Campo>
              <Campo rotulo="Pessoa cadastrada">
                <Selecao name="pessoa_id" defaultValue={c.pessoa_id ?? ""}>
                  <option value="">— nenhuma —</option>
                  {opcoesPessoa.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nome}
                    </option>
                  ))}
                </Selecao>
              </Campo>
            </div>
          </Cartao>
        </Formulario>
      </div>
    </>
  );
}
