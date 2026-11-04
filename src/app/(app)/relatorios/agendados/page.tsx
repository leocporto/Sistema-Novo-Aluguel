import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Send } from "lucide-react";
import { JanelaCadastro } from "@/components/janela-cadastro";
import { LinhaLink } from "@/components/linha-link";
import { Aviso, Cabecalho, Cartao, Celula, LinhaVazia, Selo, Tabela } from "@/components/ui";
import { RELATORIOS_PADRAO, ROTULO_FORMATO, descreverAgenda, ehRelatorioPadrao, type Formato } from "@/lib/dominio/bi";
import { formatarDataHora } from "@/lib/dominio/marketing";
import { emailConfigurado } from "@/lib/servicos/email";
import { AbasRelatorios } from "../abas";
import { criarAgendamento } from "../actions";
import { SELECT_AGENDAMENTO, SELECT_EXECUCAO, contextoRelatorios, linksAssinados, nomesDosUsuarios, type Agendamento, type Execucao } from "../dados";
import { CamposAgendamento } from "./campos";
import { TabelaExecucoes } from "./execucoes";

export const metadata: Metadata = { title: "Envios programados de relatórios" };

export default async function AgendadosPage() {
  const { supabase, imob, bi, organizacao } = await contextoRelatorios();
  if (!bi.rodar) redirect("/relatorios");
  const [{ data: ags }, { data: execs }, { data: salvos }] = await Promise.all([
    supabase.from("relatorio_agendamentos").select(SELECT_AGENDAMENTO).order("nome"),
    supabase.from("relatorio_execucoes").select(SELECT_EXECUCAO).order("data", { ascending: false }).limit(30),
    supabase.from("relatorios_salvos").select("id, nome").order("nome").limit(500),
  ]);
  const agendamentos = (ags ?? []) as unknown as Agendamento[];
  const execucoes = (execs ?? []) as Execucao[];
  const [links, nomes] = await Promise.all([linksAssinados(supabase, execucoes), nomesDosUsuarios(supabase)]);
  const email = emailConfigurado();

  return (
    <>
      <Cabecalho
        titulo="Envios programados"
        trilha="Relatórios"
        descricao="Relatórios que saem sozinhos todo dia, semana ou mês, para e-mail ou WhatsApp, com o arquivo em CSV ou Excel."
        acoes={
          bi.agendar && (
            <JanelaCadastro rotuloBotao={<><Send className="size-4" /> Programar envio</>} titulo="Programar envio de relatório" acao={criarAgendamento} icone={<Send />} rotuloSalvar="Programar" larguraMax="max-w-2xl">
              <CamposAgendamento salvos={(salvos ?? []) as { id: string; nome: string }[]} imob={imob} />
            </JanelaCadastro>
          )
        }
      />
      <AbasRelatorios />
      <div className="mb-5 space-y-2">
        {email ? (
          <Aviso>Envio por e-mail ligado: o arquivo vai anexo para os e-mails cadastrados em cada envio. WhatsApp: o envio fica pronto e você manda pelo botão (mensagem já escrita).</Aviso>
        ) : (
          <Aviso tipo="alerta">
            Ainda sem provedor de e-mail: cada envio gera o arquivo e fica <strong>pronto para enviar</strong> — baixe, copie o link (vale por 7 dias) ou mande pelo WhatsApp com a mensagem pronta. Para o e-mail sair sozinho, peça para configurar a chave do
            Resend (RESEND_API_KEY e o remetente RELATORIOS_EMAIL_DE) na Vercel.
          </Aviso>
        )}
        <p className="text-xs text-mudo">
          Sem servidor de tarefas, os envios rodam enquanto o sistema está em uso: quando alguém da equipe (que não seja corretor) abre qualquer tela do sistema depois do horário marcado, os envios vencidos são gerados
          na hora, em segundo plano. Se ninguém abrir, o envio sai na próxima vez que alguém abrir — ou use “Rodar agora” na ficha do envio.
        </p>
      </div>

      <div className="mb-6">
        <Tabela colunas={["Envio", "Relatório", "Quando", "Próximo envio", "Para quem", "Situação"]}>
          {agendamentos.length === 0 && <LinhaVazia colunas={6}>{bi.agendar ? "Nenhum envio programado. Clique em “Programar envio”." : "Nenhum envio programado."}</LinhaVazia>}
          {agendamentos.map((a) => (
            <LinhaLink key={a.id} href={`/relatorios/agendados/${a.id}`}>
              <Celula>
                <span className="font-medium">{a.nome}</span>
                <span className="block text-xs text-mudo">{ROTULO_FORMATO[a.formato as Formato] ?? a.formato}</span>
              </Celula>
              <Celula>
                {a.relatorio?.nome ??
                  (ehRelatorioPadrao(a.padrao) ? RELATORIOS_PADRAO[a.padrao].rotulo : a.relatorio_id ? <span className="text-mudo">personalizado (fora do seu perfil de acesso)</span> : "—")}
              </Celula>
              <Celula>{descreverAgenda(a)}</Celula>
              <Celula>
                {a.ativo ? formatarDataHora(a.proxima_em) : "—"}
                {a.ultima_em && <span className="block text-xs text-mudo">último: {formatarDataHora(a.ultima_em)}</span>}
              </Celula>
              <Celula className="text-sm">
                {a.emails.length + a.whatsapps.length === 0 ? <span className="text-mudo">só gerar o arquivo</span> : [...a.emails, ...a.whatsapps].join(", ")}
              </Celula>
              <Celula>{a.ativo ? <Selo cor="verde">LIGADO</Selo> : <Selo>PAUSADO</Selo>}</Celula>
            </LinhaLink>
          ))}
        </Tabela>
      </div>

      <Cartao titulo="Últimos envios">
        <TabelaExecucoes execucoes={execucoes} links={links} imobiliaria={organizacao.nome} nomes={nomes} podeApagar={bi.agendar} />
      </Cartao>
    </>
  );
}
