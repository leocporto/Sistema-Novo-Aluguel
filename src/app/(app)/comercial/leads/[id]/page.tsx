import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarPlus, Handshake, ListTodo, MessageCircle } from "lucide-react";
import { BotaoExcluir } from "@/components/botao-excluir";
import { Formulario } from "@/components/formulario";
import { JanelaCadastro } from "@/components/janela-cadastro";
import { Cabecalho, Campo, Cartao, Selecao, Selo, classeBotao } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { formatarDataBR, hojeISO } from "@/lib/dominio/datas";
import { formatarReais } from "@/lib/dominio/dinheiro";
import {
  ROTULO_STATUS_LEAD,
  ROTULO_STATUS_PROPOSTA,
  ROTULO_STATUS_VISITA,
  ROTULO_TIPO_PROPOSTA,
  type Lead,
} from "@/lib/tipos";
import { linkWhatsapp } from "@/lib/whatsapp";
import { atualizarLead, criarProposta, criarTarefa, criarVisita, excluirLead } from "../../actions";
import { AbasComercial, CamposLead, CamposProposta, CamposTarefa, CamposVisita } from "../../campos";
import { carregarOpcoes } from "../../dados";

export const metadata: Metadata = { title: "Lead" };

const fmtDataHora = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export default async function LeadPage({ params }: PageProps<"/comercial/leads/[id]">) {
  const { id } = await params;
  const { supabase, organizacao } = await obterContexto();
  const pessoal = organizacao.modo === "pessoal";
  const hoje = hojeISO();
  const [{ data }, opcoes, { data: visitas }, { data: propostas }, { data: tarefas }] = await Promise.all([
    supabase.from("leads").select("*").eq("id", id).maybeSingle(),
    carregarOpcoes(supabase),
    supabase.from("visitas").select("id, data_hora, status, imovel:imoveis(codigo)").eq("lead_id", id).order("data_hora", { ascending: false }),
    supabase.from("propostas").select("id, tipo, valor, status, created_at, imovel:imoveis(codigo)").eq("lead_id", id).order("created_at", { ascending: false }),
    supabase.from("tarefas").select("id, titulo, vencimento, concluida").eq("lead_id", id).order("vencimento"),
  ]);
  if (!data) notFound();
  const lead = data as Lead;
  const leads = opcoes.leads.some((l) => l.id === lead.id) ? opcoes.leads : [{ id: lead.id, nome: lead.nome }, ...opcoes.leads];
  type V = { id: string; data_hora: string; status: string; imovel: { codigo: string } | null };
  type P = { id: string; tipo: string; valor: number; status: string; created_at: string; imovel: { codigo: string } | null };
  type T = { id: string; titulo: string; vencimento: string | null; concluida: boolean };

  return (
    <>
      <Cabecalho
        titulo={lead.nome}
        trilha="Comercial"
        descricao={`Lead desde ${formatarDataBR(lead.created_at.slice(0, 10))} · ${ROTULO_STATUS_LEAD[lead.status]}`}
        acoes={
          <>
            <BotaoExcluir
              acao={excluirLead}
              id={lead.id}
              variante="botao"
              rotulo="Excluir"
              confirmar="Excluir este lead? Visitas e propostas continuam salvas."
              depois="/comercial"
            />
            {lead.telefone && (
              <a href={linkWhatsapp(lead.telefone, `Olá ${lead.nome.split(" ")[0]}! Tudo bem?`)} target="_blank" rel="noreferrer" className={classeBotao("secundario")}>
                <MessageCircle className="size-4" /> WhatsApp
              </a>
            )}
            <JanelaCadastro rotuloBotao={<><CalendarPlus className="size-4" /> Agendar visita</>} variante="secundario" titulo="Agendar visita" acao={criarVisita} rotuloSalvar="Agendar" icone={<CalendarPlus />}>
              <CamposVisita imoveis={opcoes.imoveis} leads={leads} corretores={opcoes.corretores} leadId={lead.id} imovelId={lead.imovel_id} hoje={hoje} />
            </JanelaCadastro>
            <JanelaCadastro rotuloBotao={<><Handshake className="size-4" /> Registrar proposta</>} titulo="Nova proposta" acao={criarProposta} rotuloSalvar="Registrar" icone={<Handshake />}>
              <CamposProposta
                imoveis={opcoes.imoveis}
                leads={leads}
                corretores={opcoes.corretores}
                leadId={lead.id}
                imovelId={lead.imovel_id}
                tipo={lead.interesse === "compra" ? "venda" : "locacao"}
                pessoal={pessoal}
              />
            </JanelaCadastro>
          </>
        }
      />
      <AbasComercial />
      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <Formulario acao={atualizarLead} automatico>
          <input type="hidden" name="id" value={lead.id} />
          <Cartao titulo="Dados do lead">
            <div className="space-y-4">
              <Campo rotulo="Etapa do funil">
                <Selecao name="status" defaultValue={lead.status}>
                  {Object.entries(ROTULO_STATUS_LEAD).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </Selecao>
              </Campo>
              <CamposLead imoveis={opcoes.imoveis} lead={lead} />
            </div>
          </Cartao>
        </Formulario>

        <div className="space-y-6">
          <Cartao titulo="Visitas">
            <ul className="space-y-2 text-sm">
              {((visitas ?? []) as unknown as V[]).map((v) => (
                <li key={v.id} className="flex items-center justify-between gap-2">
                  <span>
                    {fmtDataHora(v.data_hora)}
                    {v.imovel ? ` · ${v.imovel.codigo}` : ""}
                  </span>
                  <Selo cor={v.status === "realizada" ? "verde" : v.status === "cancelada" ? "cinza" : "azul"}>{ROTULO_STATUS_VISITA[v.status]}</Selo>
                </li>
              ))}
              {!visitas?.length && <li className="text-mudo">Nenhuma visita.</li>}
            </ul>
          </Cartao>
          <Cartao titulo="Propostas" acoes={<Link href="/comercial/propostas" className="text-xs text-acento">ver todas</Link>}>
            <ul className="space-y-2 text-sm">
              {((propostas ?? []) as unknown as P[]).map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2">
                  <span>
                    {ROTULO_TIPO_PROPOSTA[p.tipo]} · {formatarReais(p.valor)}
                    {p.imovel ? ` · ${p.imovel.codigo}` : ""}
                  </span>
                  <Selo cor={p.status === "aceita" ? "verde" : p.status === "em_negociacao" ? "amarelo" : "cinza"}>{ROTULO_STATUS_PROPOSTA[p.status]}</Selo>
                </li>
              ))}
              {!propostas?.length && <li className="text-mudo">Nenhuma proposta.</li>}
            </ul>
          </Cartao>
          <Cartao
            titulo="Tarefas"
            acoes={
              <JanelaCadastro rotuloBotao={<><ListTodo className="size-3.5" /> Nova</>} variante="fantasma" tamanho="sm" titulo="Nova tarefa" acao={criarTarefa} rotuloSalvar="Criar" icone={<ListTodo />}>
                <CamposTarefa leadId={lead.id} hoje={hoje} />
              </JanelaCadastro>
            }
          >
            <ul className="space-y-2 text-sm">
              {((tarefas ?? []) as T[]).map((t) => (
                <li key={t.id} className={`flex justify-between gap-2 ${t.concluida ? "text-mudo line-through" : ""}`}>
                  <span>{t.titulo}</span>
                  <span className={!t.concluida && t.vencimento && t.vencimento < hoje ? "text-ruim" : "text-mudo"}>{formatarDataBR(t.vencimento)}</span>
                </li>
              ))}
              {!tarefas?.length && <li className="text-mudo">Nenhuma tarefa.</li>}
            </ul>
          </Cartao>
          <BotaoExcluir
            acao={excluirLead}
            id={lead.id}
            variante="botao"
            rotulo="Excluir lead"
            confirmar="Excluir este lead? Visitas e propostas continuam salvas."
            depois="/comercial"
          />
        </div>
      </div>
    </>
  );
}
