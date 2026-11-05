import type { Metadata } from "next";
import { ArrowLeftRight, Building2, HandCoins, TrendingDown, TriangleAlert } from "lucide-react";
import { Contador } from "@/components/abas-segmentadas";
import { PilulasLink } from "@/components/pilulas-link";
import { Cabecalho, Cartao, Celula, Indicador, LinhaVazia, Tabela } from "@/components/ui";
import { entradasPrevistas, rotuloMesCurto, saldoPrevisto, somarPrevisao } from "@/lib/dominio/bi";
import { formatarDataBR, hojeISO } from "@/lib/dominio/datas";
import { formatarReais } from "@/lib/dominio/dinheiro";
import { AbasRelatorios } from "../abas";
import { BotoesExportar, ComoCalculamos } from "../componentes";
import { carregarPrevisao, contextoRelatorios } from "../dados";

export const metadata: Metadata = { title: "Relatórios · Previsão" };

const HORIZONTES = [3, 6, 12] as const;

export default async function PrevisaoPage({ searchParams }: PageProps<"/relatorios/previsao">) {
  const sp = await searchParams;
  const hoje = hojeISO();
  const meses = HORIZONTES.find((h) => String(h) === sp.meses) ?? 6;
  const { supabase, imob, pessoal } = await contextoRelatorios();
  const linhas = await carregarPrevisao(supabase, meses);
  const atraso = linhas.find((l) => l.atrasado);
  const futuro = linhas.filter((l) => !l.atrasado);
  const t = somarPrevisao(futuro);
  const url = (m: number) => `/relatorios/previsao?meses=${m}`;
  const cols = ["Mês", "Cobranças em aberto", "Aluguéis previstos", "Outras receitas", "Despesas", ...(imob ? ["Repasses agendados", "Repasses estimados", "Taxa de administração"] : []), "Saldo previsto"];

  return (
    <>
      <Cabecalho
        titulo="Previsão de receitas e repasses"
        trilha="Relatórios"
        descricao={`O que deve entrar${imob ? " e ser repassado aos proprietários" : ""} nos próximos meses, a partir dos contratos ativos, das cobranças em aberto, dos reajustes previstos${imob ? " e dos repasses agendados" : ""}.`}
        acoes={<BotoesExportar consulta={`r=previsao&meses=${meses}`} rotulo="a previsão" />}
      />
      <AbasRelatorios />
      <PilulasLink className="nao-imprimir mb-5" rotulo="Horizonte" ativo={url(meses)} itens={HORIZONTES.map((h) => ({ href: url(h), rotulo: `Próximos ${h} meses` }))} />
      <p className="mb-4 hidden text-sm text-texto-2 print:block">
        Próximos {meses} meses a partir de {formatarDataBR(hoje)}
      </p>

      <div className="entrar-cascata mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Indicador rotulo="Entradas previstas" icone={<HandCoins />} valor={<Contador valor={entradasPrevistas(t)} formato="moeda" />} detalhe={`aluguéis + outras receitas em ${meses} meses`} />
        {imob && (
          <Indicador
            rotulo="Repasses previstos"
            icone={<ArrowLeftRight />}
            valor={<Contador valor={t.repasses_agendados + t.repasses_estimados} formato="moeda" />}
            detalhe={`${formatarReais(t.repasses_agendados)} já agendados`}
          />
        )}
        {imob && <Indicador rotulo="Taxa de administração prevista" icone={<Building2 />} valor={<Contador valor={t.taxa_adm_prevista} formato="moeda" />} detalhe="receita recorrente estimada" />}
        <Indicador rotulo="Despesas previstas" icone={<TrendingDown />} valor={<Contador valor={t.despesas} formato="moeda" />} detalhe="contas a pagar em aberto" />
        <Indicador
          rotulo="Em atraso hoje"
          icone={<TriangleAlert />}
          tom={(atraso?.faturas_em_aberto ?? 0) > 0 ? "perigo" : "neutro"}
          valor={<Contador valor={atraso?.faturas_em_aberto ?? 0} formato="moeda" />}
          detalhe="cobranças que já venceram e não foram pagas"
        />
      </div>

      <Cartao titulo="Mês a mês">
        <Tabela colunas={cols} direita="resto">
          {linhas.length === 0 && <LinhaVazia colunas={cols.length}>Sem contratos ativos nem contas em aberto.</LinhaVazia>}
          {linhas.map((l) => (
            <tr key={`${l.atrasado}-${l.mes}`} className={l.atrasado ? "[&>td]:bg-ruim-bg" : ""}>
              <Celula className="font-medium">
                {l.atrasado ? "Em atraso" : rotuloMesCurto(l.mes)}
                {!l.atrasado && l.contratos > 0 && <span className="block text-xs text-mudo">{l.contratos} contrato(s) previstos</span>}
              </Celula>
              <Celula className="text-right tabular-nums">{formatarReais(l.faturas_em_aberto)}</Celula>
              <Celula className="text-right tabular-nums">
                {formatarReais(l.alugueis_previstos)}
                {l.reajuste_previsto > 0 && <span className="block text-xs text-mudo">+{formatarReais(l.reajuste_previsto)} de reajuste</span>}
              </Celula>
              <Celula className="text-right tabular-nums">{formatarReais(l.outras_receitas)}</Celula>
              <Celula className="text-right tabular-nums">{formatarReais(l.despesas)}</Celula>
              {imob && (
                <>
                  <Celula className="text-right tabular-nums">{formatarReais(l.repasses_agendados)}</Celula>
                  <Celula className="text-right tabular-nums">{formatarReais(l.repasses_estimados)}</Celula>
                  <Celula className="text-right tabular-nums">{formatarReais(l.taxa_adm_prevista)}</Celula>
                </>
              )}
              <Celula className={`text-right font-semibold tabular-nums ${saldoPrevisto(l, pessoal) < 0 ? "text-ruim" : ""}`}>{formatarReais(saldoPrevisto(l, pessoal))}</Celula>
            </tr>
          ))}
        </Tabela>
      </Cartao>

      <ComoCalculamos
        itens={[
          ["Cobranças em aberto", "Saldo das cobranças de aluguel já geradas que vencem no mês (inclui as em acordo)."],
          ["Aluguéis previstos", "Contratos ativos cuja cobrança do mês ainda não foi gerada, até o fim do contrato (ou sem fim, se renova sozinho). Valor cheio do aluguel, sem descontos e encargos."],
          ["Reajuste previsto", "Quando o aniversário do reajuste cai antes do mês, o aluguel sobe pela variação do índice do contrato nos últimos 12 meses cadastrados em Índices. Sem índice cadastrado, sem reajuste."],
          ["Outras receitas e despesas", `Lançamentos do Financeiro em aberto, pelo vencimento${imob ? " (só os do escritório: sem os de terceiros e sem os descontados no repasse, que são do proprietário)" : ""}.`],
          ...(imob
            ? ([
                ["Repasses agendados", "Repasses já gerados e ainda não pagos, pela data em que devem ser pagos."],
                ["Repasses estimados", "O que ainda vai virar repasse (cobranças em aberto + aluguéis previstos) menos a taxa de administração do contrato. Não desconta IRRF nem despesas."],
                ["Saldo previsto", "Taxa de administração prevista + outras receitas − despesas (o aluguel é do proprietário)."],
              ] as [string, string][])
            : ([["Saldo previsto", "Cobranças em aberto + aluguéis previstos + outras receitas − despesas."]] as [string, string][])),
          ["Em atraso", "O que já venceu e não foi pago até hoje (não entra nos meses seguintes)."],
        ]}
      />
    </>
  );
}
