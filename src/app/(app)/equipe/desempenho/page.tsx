import type { Metadata } from "next";
import Link from "next/link";
import { CalendarCheck, Clock, Download, Handshake, Inbox, KeyRound, Trophy } from "lucide-react";
import { Contador } from "@/components/abas-segmentadas";
import { BotaoImprimir } from "@/components/formulario";
import { PilulasLink } from "@/components/pilulas-link";
import { Cabecalho, Celula, Indicador, LinhaVazia, Tabela, classeBotao } from "@/components/ui";
import { formatarDataBR, hojeISO } from "@/lib/dominio/datas";
import { formatarReais } from "@/lib/dominio/dinheiro";
import { agruparProdutividade, formatarDuracao, periodoPorChave, somarProdutividade, taxaConversao, tempoMedioResposta, type Agrupamento } from "@/lib/dominio/equipe";
import { exigirVerRota } from "@/lib/permissoes";
import { AbasEquipe } from "../abas";
import { carregarEstrutura, carregarProdutividade, contextoEquipe } from "../dados";

export const metadata: Metadata = { title: "Desempenho da equipe" };

const PERIODOS = ["mes", "mes_passado", "90d", "ano"] as const;
const AGRUPAR: Record<Agrupamento, string> = { pessoa: "Por colaborador", equipe: "Por equipe", filial: "Por filial" };

export default async function DesempenhoPage({ searchParams }: PageProps<"/equipe/desempenho">) {
  await exigirVerRota("/equipe");
  const sp = await searchParams;
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const chave = (PERIODOS as readonly string[]).includes(s("periodo")) ? s("periodo") : "mes";
  const por = (s("por") in AGRUPAR ? s("por") : "pessoa") as Agrupamento;
  const hoje = hojeISO();
  const per = periodoPorChave(chave, hoje);
  const { supabase } = await contextoEquipe();
  const [linhas, estrutura] = await Promise.all([carregarProdutividade(supabase, per.inicio, per.fim), carregarEstrutura(supabase)]);
  const grupos = agruparProdutividade(linhas, por, {
    equipes: new Map(estrutura.equipes.map((e) => [e.id, e.nome])),
    filiais: new Map(estrutura.filiais.map((f) => [f.id, f.nome])),
  });
  const t = somarProdutividade(linhas);
  const url = (periodo: string, agrupar: string) => `/equipe/desempenho?periodo=${periodo}&por=${agrupar}`;

  return (
    <>
      <Cabecalho
        titulo="Desempenho da equipe"
        trilha="Equipe"
        descricao={`Produtividade de ${formatarDataBR(per.inicio)} a ${formatarDataBR(per.fim)}: leads, tempo até o primeiro atendimento, visitas, propostas, negócios fechados, tarefas e chamados resolvidos.`}
        acoes={
          <>
            <a href={`/equipe/desempenho/exportar?periodo=${chave}&por=${por}`} className={classeBotao("secundario")}>
              <Download className="size-4" /> Planilha (CSV)
            </a>
            <BotaoImprimir />
          </>
        }
      />
      <AbasEquipe />
      <div className="nao-imprimir mb-4 flex flex-wrap gap-3">
        <PilulasLink rotulo="Período" ativo={url(chave, por)} itens={PERIODOS.map((p) => ({ href: url(p, por), rotulo: periodoPorChave(p, hoje).rotulo }))} />
        <PilulasLink rotulo="Agrupar" ativo={url(chave, por)} itens={(Object.keys(AGRUPAR) as Agrupamento[]).map((a) => ({ href: url(chave, a), rotulo: AGRUPAR[a] }))} />
      </div>
      <div className="entrar-cascata mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Indicador rotulo="Leads atendidos" icone={<Inbox />} valor={<Contador valor={t.leads_atendidos} />} detalhe={`${t.leads_recebidos} recebidos`} />
        <Indicador rotulo="1º atendimento (média)" icone={<Clock />} valor={formatarDuracao(tempoMedioResposta(t))} />
        <Indicador rotulo="Visitas feitas" icone={<CalendarCheck />} valor={<Contador valor={t.visitas} />} />
        <Indicador rotulo="Propostas" icone={<Handshake />} valor={<Contador valor={t.propostas} />} detalhe={taxaConversao(t) === null ? "—" : `${taxaConversao(t)}% fecharam`} />
        <Indicador rotulo="Negócios fechados" icone={<KeyRound />} valor={<Contador valor={t.locacoes + t.vendas} />} detalhe={`${t.locacoes} locações · ${t.vendas} vendas`} tom={t.locacoes + t.vendas ? "sucesso" : "neutro"} />
      </div>
      <Tabela
        colunas={[
          por === "pessoa" ? "Colaborador" : por === "equipe" ? "Equipe" : "Filial",
          "Leads (atendidos/recebidos)",
          "1º atendimento",
          "Visitas",
          "Propostas (fechadas)",
          "Locações",
          "Vendas",
          "Captações",
          "Tarefas",
          "Chamados",
        ]}
      >
        {grupos.length === 0 && <LinhaVazia colunas={10}>Sem colaboradores para mostrar.</LinhaVazia>}
        {grupos.map((g, i) => (
          <tr key={g.chave || "sem"}>
            <Celula>
              <span className="flex items-center gap-2">
                {i === 0 && grupos.length > 1 && g.chave && <Trophy className="size-4 text-alerta" aria-label="Primeiro lugar" />}
                {por === "pessoa" ? (
                  <Link href={`/equipe/colaboradores/${g.chave}/desempenho?periodo=${chave}`} className="font-medium text-texto hover:underline">
                    {g.nome}
                  </Link>
                ) : (
                  <span className="font-medium text-texto">{g.nome}</span>
                )}
              </span>
              {por !== "pessoa" && <span className="block text-xs text-mudo">{g.pessoas} pessoa(s)</span>}
            </Celula>
            <Celula className="tabular-nums">
              {g.totais.leads_atendidos}/{g.totais.leads_recebidos}
            </Celula>
            <Celula className="tabular-nums">{formatarDuracao(tempoMedioResposta(g.totais))}</Celula>
            <Celula className="tabular-nums">{g.totais.visitas}</Celula>
            <Celula className="tabular-nums">
              {g.totais.propostas} ({g.totais.propostas_aceitas})
            </Celula>
            <Celula className="tabular-nums">{g.totais.locacoes}</Celula>
            <Celula className="tabular-nums">
              {g.totais.vendas}
              {g.totais.valor_vendas > 0 && <span className="block text-xs text-mudo">{formatarReais(g.totais.valor_vendas)}</span>}
            </Celula>
            <Celula className="tabular-nums">{g.totais.captacoes}</Celula>
            <Celula className="tabular-nums">{g.totais.tarefas}</Celula>
            <Celula className="tabular-nums">{g.totais.chamados}</Celula>
          </tr>
        ))}
      </Tabela>
      <p className="mt-3 text-xs text-mudo">
        Leads contam pela data em que chegaram ao corretor; 1º atendimento = tempo entre receber o lead e o primeiro contato registrado. Locações = propostas de locação
        aceitas; vendas = vendas concluídas. Tarefas somam as comerciais e as internas; chamados = manutenções concluídas pela pessoa.
      </p>
    </>
  );
}
