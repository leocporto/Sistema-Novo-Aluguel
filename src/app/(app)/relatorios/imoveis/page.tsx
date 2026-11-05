import type { Metadata } from "next";
import type { ReactNode } from "react";
import { DoorOpen, FileSignature, House, KeyRound, Timer } from "lucide-react";
import { LinhaLink } from "@/components/linha-link";
import { Cabecalho, Cartao, Celula, LinhaVazia, Selo, Tabela } from "@/components/ui";
import { lerPeriodo, queryPeriodo, taxaOcupacao, tempoParaAlugar, tempoParaVender, vacanciaMedia, type ResumoOcupacao } from "@/lib/dominio/bi";
import { formatarDataBR, hojeISO } from "@/lib/dominio/datas";
import { formatarReais } from "@/lib/dominio/dinheiro";
import { AbasRelatorios } from "../abas";
import { BotoesExportar, ComoCalculamos, KpiBi } from "../componentes";
import { carregarOcupacao, carregarProcura, carregarSemVisitas, carregarVagos, contextoRelatorios } from "../dados";
import { montarIndicador, type Indicador } from "../indicadores";
import { PeriodoImpresso, SeletorPeriodo } from "../periodo";

export const metadata: Metadata = { title: "Relatórios · Imóveis" };

export default async function ImoveisRelatorioPage({ searchParams }: PageProps<"/relatorios/imoveis">) {
  const sp = await searchParams;
  const hoje = hojeISO();
  const periodo = lerPeriodo(sp, hoje);
  const { supabase, imob } = await contextoRelatorios();
  const [a, b, vagos, semVisita, procura] = await Promise.all([
    carregarOcupacao(supabase, periodo.inicio, periodo.fim),
    carregarOcupacao(supabase, periodo.anterior.inicio, periodo.anterior.fim),
    carregarVagos(supabase, 30),
    carregarSemVisitas(supabase, periodo.inicio, periodo.fim, 30),
    imob ? carregarProcura(supabase, periodo.inicio, periodo.fim, 15) : Promise.resolve(null),
  ]);
  const q = queryPeriodo(periodo);

  const k = (chave: string, rotulo: string, tipo: Indicador["tipo"], f: (o: ResumoOcupacao) => number | null, explicacao: string, sentido: Indicador["sentido"] = "maior_melhor", detalhe?: string) =>
    montarIndicador(chave, rotulo, tipo, f(a), f(b), explicacao, sentido, detalhe);
  const kpis: [Indicador, ReactNode][] = [
    [k("ocupacao", "Taxa de ocupação", "pct", taxaOcupacao, "Dias com contrato ÷ dias disponíveis dos imóveis de locação no período (até hoje).", "maior_melhor", `${a.alugados_hoje} alugados e ${a.vagos_hoje} vagos hoje (${a.imoveis} imóveis de locação)`), <House key="i" />],
    [k("vacancia", "Vacância média", "dias", vacanciaMedia, "Dias entre o fim de um contrato e o início do próximo; vago hoje conta até hoje.", "menor_melhor", `${a.vacancia_qtd} caso(s), ${a.vacancia_abertas} ainda vago(s)`), <DoorOpen key="i" />],
    [k("tempo_alugar", "Tempo médio para alugar", "dias", tempoParaAlugar, "Da entrada como disponível (fim do contrato anterior ou captação) até o início do contrato.", "menor_melhor", `${a.alugar_qtd} contrato(s) no período`), <KeyRound key="i" />],
    [k("contratos_novos", "Contratos novos", "inteiro", (o) => o.contratos_novos, "Contratos de locação que começaram no período.", "maior_melhor", `${a.contratos_encerrados} encerrado(s) no período · ${a.contratos_ativos} ativos`), <FileSignature key="i" />],
  ];
  if (imob) kpis.push([k("tempo_vender", "Tempo médio para vender", "dias", tempoParaVender, "Da captação ou do primeiro anúncio até a venda concluída no período.", "menor_melhor", `${a.vender_qtd} venda(s) no período`), <Timer key="i" />]);

  return (
    <>
      <Cabecalho
        titulo="Relatórios de imóveis"
        trilha="Relatórios"
        descricao={imob ? "Ocupação, vacância, tempo para alugar e vender, imóveis mais procurados e os que não recebem visitas." : "Ocupação, vacância, tempo para alugar e imóveis sem visitas."}
        acoes={<BotoesExportar consulta={`r=imoveis_vagos&${q}`} rotulo="a lista de imóveis vagos" />}
      />
      <AbasRelatorios />
      <SeletorPeriodo caminho="/relatorios/imoveis" periodo={periodo} hoje={hoje} />
      <PeriodoImpresso periodo={periodo} />

      <div className="entrar-cascata mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {kpis.map(([kpi, icone]) => (
          <KpiBi key={kpi.chave} k={kpi} icone={icone} />
        ))}
      </div>

      <div className="mb-6 grid gap-6 xl:grid-cols-2">
        <Cartao titulo={`Vagos agora — ${vagos.total}`}>
          <Tabela colunas={["Imóvel", "Aluguel", "Vago desde", "Dias"]} direita={[1, 3]}>
            {vagos.lista.length === 0 && <LinhaVazia colunas={4}>Nenhum imóvel de locação vago hoje.</LinhaVazia>}
            {vagos.lista.map((v) => (
              <LinhaLink key={v.imovel_id} href={`/imoveis/${v.imovel_id}`}>
                <Celula>
                  <span className="font-medium">{v.codigo}</span>
                  <span className="block text-xs text-mudo">{[v.titulo, v.bairro].filter(Boolean).join(" · ") || "—"}</span>
                  {v.proximo_inicio && <Selo cor="verde">alugado a partir de {formatarDataBR(v.proximo_inicio)}</Selo>}
                </Celula>
                <Celula className="text-right tabular-nums">{v.valor_aluguel ? formatarReais(v.valor_aluguel) : "—"}</Celula>
                <Celula>
                  {formatarDataBR(v.vago_desde)}
                  <span className="block text-xs text-mudo">{v.ja_alugado ? "fim do último contrato" : "desde a captação"}</span>
                </Celula>
                <Celula className={`text-right tabular-nums ${v.dias > 60 ? "text-ruim" : v.dias > 30 ? "text-alerta" : ""}`}>{v.dias}</Celula>
              </LinhaLink>
            ))}
          </Tabela>
        </Cartao>

        <Cartao
          titulo={`Sem visitas no período — ${semVisita.total}`}
          acoes={
            <div className="nao-imprimir flex flex-wrap gap-2">
              <BotoesExportar consulta={`r=imoveis_sem_visitas&${q}`} rotulo="os imóveis sem visitas" />
            </div>
          }
        >
          <Tabela colunas={["Imóvel", "Finalidade", "Captado em", "Última visita"]}>
            {semVisita.lista.length === 0 && <LinhaVazia colunas={4}>Todos os imóveis disponíveis tiveram visita no período.</LinhaVazia>}
            {semVisita.lista.map((v) => (
              <LinhaLink key={v.imovel_id} href={`/imoveis/${v.imovel_id}`}>
                <Celula>
                  <span className="font-medium">{v.codigo}</span>
                  <span className="block text-xs text-mudo">{[v.titulo, v.bairro].filter(Boolean).join(" · ") || "—"}</span>
                </Celula>
                <Celula>{v.finalidades}</Celula>
                <Celula>{formatarDataBR(v.captado_em)}</Celula>
                <Celula>{v.ultima_visita ? formatarDataBR(v.ultima_visita) : <span className="text-mudo">nunca</span>}</Celula>
              </LinhaLink>
            ))}
          </Tabela>
        </Cartao>
      </div>

      {procura && (
        <Cartao
          titulo="Imóveis com maior procura"
          acoes={
            <div className="nao-imprimir flex flex-wrap gap-2">
              <BotoesExportar consulta={`r=imoveis_procura&${q}`} rotulo="os imóveis mais procurados" />
            </div>
          }
        >
          <Tabela colunas={["Imóvel", "Leads", "Visitas", "Propostas", "Contatos pelo site", "Total"]} direita="resto">
            {procura.lista.length === 0 && <LinhaVazia colunas={6}>Nenhuma procura registrada no período.</LinhaVazia>}
            {procura.lista.map((v, i) => (
              <LinhaLink key={v.imovel_id} href={`/imoveis/${v.imovel_id}`}>
                <Celula>
                  <span className="font-medium">
                    {i + 1}º · {v.codigo}
                  </span>
                  <span className="block text-xs text-mudo">{v.titulo ?? v.status}</span>
                </Celula>
                <Celula className="text-right tabular-nums">{v.leads}</Celula>
                <Celula className="text-right tabular-nums">{v.visitas}</Celula>
                <Celula className="text-right tabular-nums">{v.propostas}</Celula>
                <Celula className="text-right tabular-nums">{v.contatos_site}</Celula>
                <Celula className="text-right font-semibold tabular-nums">{v.pontos}</Celula>
              </LinhaLink>
            ))}
          </Tabela>
        </Cartao>
      )}

      <ComoCalculamos
        itens={[
          ["Imóveis de locação", "Imóveis com finalidade locação que não estão inativos nem vendidos. Ocupado = coberto por um contrato (ativo, encerrado ou rescindido)."],
          ["Taxa de ocupação", "Dias com contrato ÷ dias disponíveis no período. Cada imóvel conta a partir da entrada no sistema (captação ou primeiro contrato) e nunca depois de hoje."],
          ["Vacância", "Dias entre o fim de um contrato e o início do próximo, nos imóveis que voltaram a ser alugados no período. Contratos emendados (renovação) não contam. Imóvel vago hoje entra com os dias até hoje."],
          ["Tempo para alugar", "Do dia em que o imóvel ficou disponível (dia seguinte ao fim do contrato anterior ou a captação) até o início do contrato novo."],
          ...(imob
            ? ([
                ["Tempo para vender", "Da captação ou do primeiro anúncio do imóvel (o que veio antes) até a venda concluída no período."],
                ["Maior procura", "Leads ligados ao imóvel + visitas (não canceladas) + propostas + contatos pelo site no período."],
              ] as [string, string][])
            : []),
          ["Sem visitas", "Imóveis disponíveis que não tiveram nenhuma visita (agendada ou feita, sem contar as canceladas) no período."],
        ]}
      />
    </>
  );
}
