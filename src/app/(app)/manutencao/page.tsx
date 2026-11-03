import type { Metadata } from "next";
import Link from "next/link";
import { AlarmClock, CircleDollarSign, Hammer, ShieldQuestion, Wrench } from "lucide-react";
import { Contador } from "@/components/abas-segmentadas";
import { BotaoExcluir } from "@/components/botao-excluir";
import { FiltroAutomatico } from "@/components/filtro-automatico";
import { JanelaCadastro } from "@/components/janela-cadastro";
import { LinhaLink } from "@/components/linha-link";
import { PilulasLink } from "@/components/pilulas-link";
import { Cabecalho, Celula, Entrada, Indicador, LinhaVazia, Selecao, Selo, Tabela } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { agoraMs, fimDoMes, formatarDataBR, hojeISO, inicioDoMes } from "@/lib/dominio/datas";
import { formatarReais, paraCentavos, paraReais } from "@/lib/dominio/dinheiro";
import {
  COR_STATUS_CHAMADO,
  COR_URGENCIA,
  ROTULO_CATEGORIA_CURTO,
  ROTULO_STATUS_CHAMADO,
  ROTULO_URGENCIA,
  STATUS_EM_ANDAMENTO,
  situacaoPrazo,
  textoPrazo,
} from "@/lib/dominio/manutencao";
import { todas } from "../financeiro/dados";
import { AbasManutencao } from "./abas";
import { excluirChamado, criarChamado } from "./actions";
import { CamposNovoChamado, OpcoesCategoria } from "./campos";
import { SELECT_LISTA, opcoesChamado, type ChamadoLista } from "./dados";

export const metadata: Metadata = { title: "Manutenção" };

const FILTROS: Record<string, { rotulo: string; status: string[] | null }> = {
  "": { rotulo: "Em andamento", status: STATUS_EM_ANDAMENTO },
  aprovacao: { rotulo: "Aguardando aprovação", status: ["aguardando_aprovacao"] },
  agendados: { rotulo: "Agendados", status: ["agendado", "em_execucao"] },
  concluidos: { rotulo: "Concluídos", status: ["concluido", "avaliado"] },
  encerrados: { rotulo: "Recusados e cancelados", status: ["recusado", "cancelado"] },
  todos: { rotulo: "Todos", status: null },
};

export default async function ManutencaoPage({ searchParams }: PageProps<"/manutencao">) {
  const sp = await searchParams;
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const filtro = s("filtro") in FILTROS ? s("filtro") : "";
  const f = { busca: s("busca"), imovel: s("imovel"), categoria: s("categoria"), urgencia: s("urgencia") };
  const { supabase, organizacao, papel } = await obterContexto();
  const pessoal = organizacao.modo === "pessoal";
  const hoje = hojeISO();
  const agora = new Date(agoraMs()).toISOString();
  const ini = inicioDoMes(hoje);

  let q = supabase.from("chamados").select(SELECT_LISTA).order("created_at", { ascending: false }).limit(500);
  const st = FILTROS[filtro].status;
  if (st) q = q.in("status", st);
  if (f.imovel) q = q.eq("imovel_id", f.imovel);
  if (f.categoria) q = q.eq("categoria", f.categoria);
  if (f.urgencia) q = q.eq("urgencia", f.urgencia);
  if (f.busca) {
    const b = f.busca.replace(/[%,()]/g, " ").trim();
    const n = Number(b.replace("#", ""));
    q = Number.isInteger(n) && n > 0 ? q.eq("numero", n) : q.or(`titulo.ilike.%${b}%,descricao.ilike.%${b}%,solicitante_nome.ilike.%${b}%`);
  }

  const [{ data }, opcoes, andamento, concluidosMes] = await Promise.all([
    q,
    opcoesChamado(supabase, hoje),
    todas<{ status: string; prazo_atendimento: string | null }>(() => supabase.from("chamados").select("status, prazo_atendimento").in("status", STATUS_EM_ANDAMENTO).order("id")),
    todas<{ valor_final: number | null }>(() => supabase.from("chamados").select("valor_final").in("status", ["concluido", "avaliado"]).gte("concluido_em", ini).lte("concluido_em", fimDoMes(hoje)).order("id")),
  ]);
  const lista = (data ?? []) as unknown as ChamadoLista[];
  const atrasados = andamento.filter((c) => situacaoPrazo(c, agora).situacao === "atrasado").length;
  const aguardando = andamento.filter((c) => c.status === "aguardando_aprovacao").length;
  const agendados = andamento.filter((c) => ["agendado", "em_execucao"].includes(c.status)).length;
  const gastoMes = paraReais(concluidosMes.reduce((a, c) => a + paraCentavos(c.valor_final), 0));
  const url = (k: string) => {
    const p = new URLSearchParams(Object.entries({ ...f, filtro: k }).filter(([, v]) => v) as [string, string][]);
    const qs = p.toString();
    return qs ? `/manutencao?${qs}` : "/manutencao";
  };

  return (
    <>
      <Cabecalho
        titulo="Manutenção"
        descricao="Chamados dos imóveis: abertura (inclusive pelo locatário, por link), orçamentos, aprovação, agenda, ordem de serviço, conclusão, garantia e avaliação dos prestadores."
        acoes={
          <JanelaCadastro
            rotuloBotao={
              <>
                <Wrench className="size-4" /> Novo chamado
              </>
            }
            titulo="Abrir chamado de manutenção"
            acao={criarChamado}
            icone={<Wrench />}
            larguraMax="max-w-2xl"
            rotuloSalvar="Abrir chamado"
            abertaInicial={s("novo") === "1"}
          >
            <CamposNovoChamado
              opcoes={opcoes}
              pessoal={pessoal}
              padrao={{ imovelId: s("imovel") || undefined, contratoId: s("contrato") || undefined, origemId: s("origem") || undefined, categoria: s("categoria") || undefined, prestadorId: s("prestador") || undefined, titulo: s("titulo") || undefined }}
            />
          </JanelaCadastro>
        }
      />
      <AbasManutencao />

      <div className="entrar-cascata mb-6 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Indicador rotulo="Em andamento" icone={<Hammer />} valor={<Contador valor={andamento.length} />} detalhe="abertos, em análise, aprovados e agendados" href={url("")} />
        <Indicador
          rotulo="Atrasados no atendimento"
          icone={<AlarmClock />}
          valor={<Contador valor={atrasados} />}
          detalhe="passaram do prazo da urgência sem serviço agendado"
          tom={atrasados ? "perigo" : "sucesso"}
          href={url("")}
        />
        {pessoal ? (
          <Indicador rotulo="Agendados" icone={<ShieldQuestion />} valor={<Contador valor={agendados} />} detalhe="serviço marcado ou em execução" href={url("agendados")} />
        ) : (
          <Indicador
            rotulo="Aguardando aprovação"
            icone={<ShieldQuestion />}
            valor={<Contador valor={aguardando} />}
            detalhe="orçamento esperando o proprietário"
            tom={aguardando ? "alerta" : "neutro"}
            href={url("aprovacao")}
          />
        )}
        <Indicador rotulo="Gasto no mês" icone={<CircleDollarSign />} valor={<Contador valor={gastoMes} formato="moeda" />} detalhe={`${concluidosMes.length} serviço(s) concluído(s)`} href={url("concluidos")} />
      </div>

      <PilulasLink
        className="mb-4"
        rotulo="Situação dos chamados"
        ativo={url(filtro)}
        itens={Object.entries(FILTROS)
          .filter(([k]) => !(pessoal && k === "aprovacao"))
          .map(([k, v]) => ({ href: url(k), rotulo: v.rotulo }))}
      />
      <FiltroAutomatico className="mb-4 flex flex-wrap gap-2">
        {filtro && <input type="hidden" name="filtro" value={filtro} />}
        <Entrada name="busca" aria-label="Buscar chamados" defaultValue={f.busca} placeholder="Buscar nº, título, quem pediu…" className="max-w-72" />
        <Selecao name="imovel" aria-label="Filtrar por imóvel" defaultValue={f.imovel} className="w-48">
          <option value="">Todos os imóveis</option>
          {opcoes.imoveis.map((i) => (
            <option key={i.id} value={i.id}>
              {i.codigo}
            </option>
          ))}
        </Selecao>
        <Selecao name="categoria" aria-label="Filtrar por tipo de problema" defaultValue={f.categoria} className="w-52">
          <option value="">Todos os tipos</option>
          <OpcoesCategoria />
        </Selecao>
        <Selecao name="urgencia" aria-label="Filtrar por urgência" defaultValue={f.urgencia} className="w-40">
          <option value="">Toda urgência</option>
          {Object.entries(ROTULO_URGENCIA).map(([k, r]) => (
            <option key={k} value={k}>
              {r}
            </option>
          ))}
        </Selecao>
      </FiltroAutomatico>

      <Tabela colunas={["Nº", "Chamado", "Imóvel", "Urgência", "Situação", "Prestador", "Aberto em", ""]}>
        {lista.map((c) => {
          const prazo = situacaoPrazo(c, agora);
          return (
            <LinhaLink key={c.id} href={`/manutencao/${c.id}`}>
              <Celula className="tabular-nums text-mudo">#{c.numero}</Celula>
              <Celula>
                <Link href={`/manutencao/${c.id}`} className="font-medium text-texto hover:underline">
                  {c.titulo}
                </Link>
                <span className="block text-xs text-mudo">
                  {ROTULO_CATEGORIA_CURTO[c.categoria] ?? c.categoria}
                  {c.origem === "link" ? " · aberto pelo locatário" : ""}
                  {c.valor_final != null ? ` · ${formatarReais(c.valor_final)}` : c.valor_aprovado != null ? ` · orçado ${formatarReais(c.valor_aprovado)}` : ""}
                </span>
              </Celula>
              <Celula>
                <span className="text-sm text-texto-2">{c.imovel?.codigo ?? "—"}</span>
              </Celula>
              <Celula>
                <Selo cor={COR_URGENCIA[c.urgencia as keyof typeof COR_URGENCIA] ?? "cinza"}>{ROTULO_URGENCIA[c.urgencia] ?? c.urgencia}</Selo>
                {prazo.situacao !== "atendido" && <span className={`mt-1 block text-[11px] ${prazo.situacao === "atrasado" ? "font-semibold text-ruim" : "text-mudo"}`}>{textoPrazo(prazo.horas)}</span>}
              </Celula>
              <Celula>
                <Selo cor={COR_STATUS_CHAMADO[c.status as keyof typeof COR_STATUS_CHAMADO] ?? "cinza"}>{ROTULO_STATUS_CHAMADO[c.status] ?? c.status}</Selo>
              </Celula>
              <Celula>
                <span className="text-sm text-texto-2">{c.prestador?.nome ?? "—"}</span>
              </Celula>
              <Celula className="text-sm text-texto-2">{formatarDataBR(c.created_at.slice(0, 10))}</Celula>
              <Celula>
                {papel !== "corretor" && <BotaoExcluir acao={excluirChamado} id={c.id} rotulo="Excluir chamado" confirmar={`Excluir o chamado #${c.numero} (${c.titulo})? Fotos, orçamentos e lançamentos ainda em aberto no financeiro saem junto.`} />}
              </Celula>
            </LinhaLink>
          );
        })}
        {lista.length === 0 && <LinhaVazia colunas={8}>Nenhum chamado aqui.</LinhaVazia>}
      </Tabela>
      {lista.length >= 500 && <p className="mt-3 text-sm text-alerta">Mostrando os 500 mais recentes. Use os filtros para achar os outros.</p>}
    </>
  );
}
