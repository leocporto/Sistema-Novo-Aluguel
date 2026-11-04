import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Play } from "lucide-react";
import { BotaoAcao } from "@/components/botao-acao";
import { BotaoExcluir } from "@/components/botao-excluir";
import { Formulario } from "@/components/formulario";
import { Aviso, Cabecalho, Cartao, Definicao } from "@/components/ui";
import { RELATORIOS_PADRAO, ROTULO_FORMATO, ROTULO_PERIODO_AGENDADO, descreverAgenda, ehRelatorioPadrao, type Formato, type PeriodoAgendado } from "@/lib/dominio/bi";
import { formatarDataHora } from "@/lib/dominio/marketing";
import { AbasRelatorios } from "../../abas";
import { excluirAgendamento, rodarAgendamento, salvarAgendamento } from "../../actions";
import { SELECT_AGENDAMENTO, SELECT_EXECUCAO, contextoRelatorios, linksAssinados, nomesDosUsuarios, type Agendamento, type Execucao } from "../../dados";
import { CamposAgendamento } from "../campos";
import { TabelaExecucoes } from "../execucoes";

export const metadata: Metadata = { title: "Envio programado" };

export default async function AgendamentoPage({ params }: PageProps<"/relatorios/agendados/[id]">) {
  const { id } = await params;
  const { supabase, imob, bi, organizacao } = await contextoRelatorios();
  if (!bi.rodar) redirect("/relatorios");
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [{ data }, { data: execs }, { data: salvos }] = await Promise.all([
    supabase.from("relatorio_agendamentos").select(SELECT_AGENDAMENTO).eq("id", id).maybeSingle(),
    supabase.from("relatorio_execucoes").select(SELECT_EXECUCAO).eq("agendamento_id", id).order("data", { ascending: false }).limit(30),
    supabase.from("relatorios_salvos").select("id, nome").order("nome").limit(500),
  ]);
  const ag = data as unknown as Agendamento | null;
  if (!ag) notFound();
  const execucoes = (execs ?? []) as Execucao[];
  const [links, nomes] = await Promise.all([linksAssinados(supabase, execucoes), nomesDosUsuarios(supabase)]);
  // Envio de um relatório personalizado cujos dados o perfil de acesso não vê: só leitura (o banco também recusa).
  const oculto = !!ag.relatorio_id && !ag.relatorio;
  const editavel = bi.agendar && !oculto;
  const relatorio = ag.relatorio?.nome ?? (ehRelatorioPadrao(ag.padrao) ? RELATORIOS_PADRAO[ag.padrao].rotulo : oculto ? "Relatório personalizado (fora do seu perfil de acesso)" : "—");

  return (
    <>
      <Cabecalho
        titulo={ag.nome}
        trilha="Relatórios"
        descricao={`${relatorio} · ${descreverAgenda(ag)} · ${ag.ativo ? `próximo envio ${formatarDataHora(ag.proxima_em)}` : "pausado"}`}
        acoes={
          bi.agendar && (
            <>
              {editavel && (
                <BotaoAcao acao={rodarAgendamento} id={ag.id} variante="primario" confirmar="Gerar e enviar este relatório agora? (o próximo envio programado continua igual)">
                  <Play className="size-4" /> Rodar agora
                </BotaoAcao>
              )}
              <BotaoExcluir acao={excluirAgendamento} id={ag.id} variante="botao" confirmar={`Excluir o envio "${ag.nome}"? Os arquivos que ele gerou também são apagados; o histórico de envios fica.`} depois="/relatorios/agendados" />
            </>
          )
        }
      />
      <AbasRelatorios />
      {oculto && (
        <div className="mb-4">
          <Aviso tipo="alerta">Este envio usa um relatório personalizado com dados que o seu perfil de acesso não vê. Só quem pode ver esses dados consegue alterar ou rodar este envio.</Aviso>
        </div>
      )}
      <div className="mb-6">
        <Cartao titulo="Configuração">
          {editavel ? (
            <Formulario acao={salvarAgendamento} automatico>
              <input type="hidden" name="id" value={ag.id} />
              <CamposAgendamento ag={ag} salvos={(salvos ?? []) as { id: string; nome: string }[]} imob={imob} />
            </Formulario>
          ) : (
            <Definicao
              itens={[
                ["Relatório", relatorio],
                ["Período", ag.padrao ? ROTULO_PERIODO_AGENDADO[ag.periodo as PeriodoAgendado] : "conforme os filtros"],
                ["Quando", descreverAgenda(ag)],
                ["Formato", ROTULO_FORMATO[ag.formato as Formato] ?? ag.formato],
                ["Para quem", [...ag.emails, ...ag.whatsapps].join(", ") || "—"],
              ]}
            />
          )}
        </Cartao>
      </div>
      <Cartao titulo="Histórico deste envio">
        <TabelaExecucoes execucoes={execucoes} links={links} imobiliaria={organizacao.nome} nomes={nomes} podeApagar={bi.agendar} />
      </Cartao>
    </>
  );
}
