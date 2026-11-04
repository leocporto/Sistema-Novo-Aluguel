import type { Metadata } from "next";
import Link from "next/link";
import { Trophy } from "lucide-react";
import { PilulasLink } from "@/components/pilulas-link";
import { Aviso, Cabecalho, Cartao, Celula, LinhaVazia, Tabela } from "@/components/ui";
import { formatarPct, lerPeriodo, queryPeriodo, taxa } from "@/lib/dominio/bi";
import { hojeISO } from "@/lib/dominio/datas";
import { formatarReais } from "@/lib/dominio/dinheiro";
import { agruparProdutividade, formatarDuracao, tempoMedioResposta, type Agrupamento } from "@/lib/dominio/equipe";
import { AbasRelatorios } from "../abas";
import { BotoesExportar, ComoCalculamos } from "../componentes";
import { carregarEquipe, carregarFiliais, contextoRelatorios } from "../dados";
import { PeriodoImpresso, SeletorPeriodo } from "../periodo";

export const metadata: Metadata = { title: "Relatórios · Equipe" };

const AGRUPAR: Record<Agrupamento, string> = { pessoa: "Por corretor", equipe: "Por equipe", filial: "Por filial" };

export default async function EquipeRelatorioPage({ searchParams }: PageProps<"/relatorios/equipe">) {
  const sp = await searchParams;
  const hoje = hojeISO();
  const periodo = lerPeriodo(sp, hoje);
  const { supabase, corretor } = await contextoRelatorios();
  const por: Agrupamento = !corretor && (sp.por === "equipe" || sp.por === "filial") ? sp.por : "pessoa";
  const [linhas, filiais, { data: equipes }, { data: listaFiliais }] = await Promise.all([
    carregarEquipe(supabase, periodo.inicio, periodo.fim),
    corretor ? Promise.resolve([]) : carregarFiliais(supabase, periodo.inicio, periodo.fim),
    supabase.from("equipes").select("id, nome"),
    supabase.from("filiais").select("id, nome"),
  ]);
  const grupos = agruparProdutividade(linhas, por, {
    equipes: new Map((equipes ?? []).map((e) => [e.id as string, e.nome as string])),
    filiais: new Map((listaFiliais ?? []).map((f) => [f.id as string, f.nome as string])),
  });
  const comissoes = new Map<string, number>();
  for (const l of linhas) {
    const chave = por === "pessoa" ? l.pessoa_id : por === "equipe" ? (l.equipe_id ?? "") : (l.filial_id ?? "");
    comissoes.set(chave, (comissoes.get(chave) ?? 0) + l.comissoes);
  }
  const q = queryPeriodo(periodo);
  const url = (agrupar: string) => `/relatorios/equipe?${queryPeriodo(periodo, { por: agrupar })}`;

  return (
    <>
      <Cabecalho
        titulo="Desempenho da equipe"
        trilha="Relatórios"
        descricao="Desempenho individual dos corretores e de cada filial no período: leads, atendimento, visitas, propostas, negócios e comissões."
        acoes={
          <>
            <BotoesExportar consulta={`r=equipe&por=${por}&${q}`} rotulo="o desempenho" />
            {!corretor && <BotoesExportar consulta={`r=filiais&${q}`} rotulo="as filiais" />}
          </>
        }
      />
      <AbasRelatorios />
      {corretor && (
        <div className="mb-4">
          <Aviso>Você está vendo só o seu desempenho.</Aviso>
        </div>
      )}
      <SeletorPeriodo caminho="/relatorios/equipe" periodo={periodo} hoje={hoje} extra={{ por: por === "pessoa" ? undefined : por }} />
      <PeriodoImpresso periodo={periodo} />
      {!corretor && (
        <PilulasLink className="nao-imprimir mb-4" rotulo="Agrupar" ativo={url(por)} itens={(Object.keys(AGRUPAR) as Agrupamento[]).map((a) => ({ href: url(a), rotulo: AGRUPAR[a] }))} />
      )}

      <div className="mb-6">
        <Tabela colunas={[AGRUPAR[por].replace("Por ", "").replace(/^./, (c) => c.toUpperCase()), "Leads (atend./receb.)", "1º atendimento", "Visitas", "Propostas", "Conversão", "Locações", "Vendas", "Captações", "Comissões"]}>
          {grupos.length === 0 && <LinhaVazia colunas={10}>Sem corretores ou colaboradores para mostrar.</LinhaVazia>}
          {grupos.map((g, i) => (
            <tr key={g.chave || "sem"}>
              <Celula>
                <span className="flex items-center gap-2 font-medium">
                  {i === 0 && grupos.length > 1 && g.chave && <Trophy className="size-4 text-alerta" aria-label="Primeiro lugar" />}
                  {por === "pessoa" && !corretor ? (
                    <Link href={`/equipe/colaboradores/${g.chave}/desempenho`} className="hover:underline">
                      {g.nome}
                    </Link>
                  ) : (
                    g.nome
                  )}
                </span>
                {por !== "pessoa" && <span className="block text-xs text-mudo">{g.pessoas} pessoa(s)</span>}
              </Celula>
              <Celula className="tabular-nums">
                {g.totais.leads_atendidos}/{g.totais.leads_recebidos}
              </Celula>
              <Celula className="tabular-nums">{formatarDuracao(tempoMedioResposta(g.totais))}</Celula>
              <Celula className="text-right tabular-nums">{g.totais.visitas}</Celula>
              <Celula className="text-right tabular-nums">
                {g.totais.propostas} <span className="text-xs text-mudo">({g.totais.propostas_aceitas} aceitas)</span>
              </Celula>
              <Celula className="text-right tabular-nums">{formatarPct(taxa(g.totais.propostas_aceitas, g.totais.propostas))}</Celula>
              <Celula className="text-right tabular-nums">{g.totais.locacoes}</Celula>
              <Celula className="text-right tabular-nums">
                {g.totais.vendas}
                {g.totais.valor_vendas > 0 && <span className="block text-xs text-mudo">{formatarReais(g.totais.valor_vendas)}</span>}
              </Celula>
              <Celula className="text-right tabular-nums">{g.totais.captacoes}</Celula>
              <Celula className="text-right tabular-nums">{formatarReais(comissoes.get(g.chave) ?? 0)}</Celula>
            </tr>
          ))}
        </Tabela>
      </div>

      {!corretor && (
        <Cartao titulo="Desempenho por filial">
          <Tabela colunas={["Filial", "Imóveis", "Contratos ativos", "Aluguel da carteira", "Administração", "Intermediação", "Leads", "Vendas", "Comissão de vendas"]}>
            {filiais.length === 0 && <LinhaVazia colunas={9}>Nenhuma filial cadastrada (Equipe → Equipes e filiais).</LinhaVazia>}
            {filiais.map((f) => (
              <tr key={f.filial_id ?? "sem"}>
                <Celula className="font-medium">{f.nome}</Celula>
                <Celula className="text-right tabular-nums">{f.imoveis}</Celula>
                <Celula className="text-right tabular-nums">{f.contratos_ativos}</Celula>
                <Celula className="text-right tabular-nums">{formatarReais(f.carteira_aluguel)}</Celula>
                <Celula className="text-right tabular-nums">{formatarReais(f.receita_administracao)}</Celula>
                <Celula className="text-right tabular-nums">{formatarReais(f.receita_intermediacao)}</Celula>
                <Celula className="text-right tabular-nums">{f.leads}</Celula>
                <Celula className="text-right tabular-nums">
                  {f.vendas}
                  {f.valor_vendas > 0 && <span className="block text-xs text-mudo">{formatarReais(f.valor_vendas)}</span>}
                </Celula>
                <Celula className="text-right tabular-nums">{formatarReais(f.comissao_vendas)}</Celula>
              </tr>
            ))}
          </Tabela>
        </Cartao>
      )}

      <ComoCalculamos
        itens={[
          ["Leads", "Leads que chegaram ao corretor no período (pela data em que foram atribuídos) e quantos ele atendeu."],
          ["1º atendimento", "Tempo médio entre receber o lead e o primeiro contato registrado."],
          ["Conversão", "Propostas aceitas ÷ propostas feitas no período."],
          ["Locações e vendas", "Locações = propostas de locação aceitas; vendas = vendas concluídas no período."],
          ["Comissões", "Comissões geradas para a pessoa no período (sem as canceladas e estornadas)."],
          ["Filiais", "Imóveis e contratos pela filial cadastrada neles; taxas pela filial do contrato; vendas pela filial do imóvel (ou do corretor)."],
        ]}
      />
    </>
  );
}
