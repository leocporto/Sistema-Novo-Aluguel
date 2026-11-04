import type { Metadata } from "next";
import { CalendarClock, Hourglass, ShieldCheck, UserCheck, UserPlus } from "lucide-react";
import { Contador } from "@/components/abas-segmentadas";
import { BotaoExcluir } from "@/components/botao-excluir";
import { FiltroAutomatico } from "@/components/filtro-automatico";
import { JanelaCadastro } from "@/components/janela-cadastro";
import { LinhaLink } from "@/components/linha-link";
import { PilulasLink } from "@/components/pilulas-link";
import { Cabecalho, Celula, Entrada, Indicador, LinhaVazia, Selo, Tabela } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import {
  COR_SEMAFORO,
  COR_STATUS_ANALISE,
  COR_STATUS_GARANTIA_PROPOSTA,
  GARANTIA_AGUARDANDO,
  GARANTIA_APROVADA,
  ROTULO_STATUS_ANALISE,
  ROTULO_STATUS_GARANTIA_PROPOSTA,
  aprovacaoVencida,
  comprometimentoPct,
  foraDaRegra,
  progressoDocumentos,
  rendaComprovada,
  semaforoComprometimento,
  situacaoDocumento,
} from "@/lib/dominio/analise";
import { formatarDataBR, hojeISO, inicioDoMes, somarDias } from "@/lib/dominio/datas";
import { formatarReais } from "@/lib/dominio/dinheiro";
import { normalizar } from "@/lib/dominio/imoveis";
import { AbasAnalise } from "./abas";
import { criarAnalise, excluirAnalise } from "./actions";
import { CamposNovaAnalise } from "./campos";
import { carregarConfig, carregarOpcoes, type Analise } from "./dados";

export const metadata: Metadata = { title: "Análise cadastral" };

const FILTROS: Record<string, string> = {
  "": "Em análise",
  aguardando: "Aguardando garantidora",
  aprovadas: "Aprovadas",
  reprovadas: "Reprovadas",
  contratadas: "Viraram contrato",
  desistencias: "Desistências",
  todas: "Todas",
};

type Linha = Analise & {
  analise_rendas: { valor_comprovado: number | null; fiador_id: string | null }[];
  analise_documentos: { status: string; obrigatorio: boolean }[];
  analise_garantias: { status: string; tipo: string }[];
  analise_fiadores: { id: string; status: string }[];
  analise_consultas: { consultado_em: string; created_at: string; score: number | null; restricoes: boolean; fiador_id: string | null }[];
};

export default async function AnalisePage({ searchParams }: PageProps<"/analise">) {
  const sp = await searchParams;
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const filtro = s("filtro") in FILTROS ? s("filtro") : "";
  const busca = s("busca");
  const { supabase, organizacao } = await obterContexto();
  const pessoal = organizacao.modo === "pessoal";
  const hoje = hojeISO();

  let q = supabase
    .from("analises")
    .select(
      "*, candidato:pessoas!analises_candidato_id_fkey(id, nome, tipo_pessoa, documento, telefone), imovel:imoveis(id, codigo, logradouro, numero), analise_rendas(valor_comprovado, fiador_id), analise_documentos(status, obrigatorio), analise_garantias(status, tipo), analise_fiadores(id, status), analise_consultas(consultado_em, created_at, score, restricoes, fiador_id)",
    )
    .order("created_at", { ascending: false })
    .limit(500);
  if (filtro === "" || filtro === "aguardando") q = q.eq("status", "em_analise");
  if (filtro === "aprovadas") q = q.in("status", ["aprovada", "aprovada_condicoes"]);
  if (filtro === "reprovadas") q = q.eq("status", "reprovada");
  if (filtro === "contratadas") q = q.eq("status", "contratada");
  if (filtro === "desistencias") q = q.eq("status", "desistencia");

  const [{ data }, cfg, opcoes, { count: emAnalise }, { data: aguardando }, { count: aprovadasMes }, { count: vencendo }] = await Promise.all([
    q,
    carregarConfig(supabase, organizacao.id),
    carregarOpcoes(supabase),
    supabase.from("analises").select("id", { count: "exact", head: true }).eq("status", "em_analise"),
    supabase.from("analise_garantias").select("analise_id, analise:analises!inner(status)").in("status", [...GARANTIA_AGUARDANDO]).eq("analise.status", "em_analise").limit(1000),
    supabase.from("analises").select("id", { count: "exact", head: true }).in("decisao", ["aprovado", "aprovado_condicoes"]).gte("decidido_em", `${inicioDoMes(hoje)}T00:00:00-03:00`),
    supabase
      .from("contrato_garantias")
      .select("id, contrato:contratos!inner(status)", { count: "exact", head: true })
      .eq("status", "ativa")
      .eq("contrato.status", "ativo")
      .lte("fim", somarDias(hoje, 30)),
  ]);
  const aguardandoIds = new Set((aguardando ?? []).map((g) => g.analise_id as string));
  let lista = (data ?? []) as unknown as Linha[];
  if (filtro === "aguardando") lista = lista.filter((a) => aguardandoIds.has(a.id));
  if (busca) {
    const b = normalizar(busca);
    lista = lista.filter((a) => normalizar([a.candidato?.nome, a.candidato?.documento, a.imovel?.codigo, a.imovel?.logradouro, String(a.numero)].join(" ")).includes(b));
  }
  const url = (k: string) => {
    const p = new URLSearchParams(Object.entries({ filtro: k, busca }).filter(([, v]) => v) as [string, string][]);
    const t = p.toString();
    return t ? `/analise?${t}` : "/analise";
  };

  return (
    <>
      <Cabecalho
        titulo="Análise cadastral"
        descricao={
          pessoal
            ? "Analise quem quer alugar seu imóvel: documentos, renda, crédito, fiador e garantia — e registre sua decisão."
            : "Candidatos a locatário: documentos, comprovação de renda, consulta de crédito, fiadores, garantias e a decisão com justificativa."
        }
        acoes={
          <JanelaCadastro rotuloBotao={<><UserPlus className="size-4" /> Novo candidato</>} titulo="Nova análise cadastral" acao={criarAnalise} icone={<UserPlus />} larguraMax="max-w-2xl" abertaInicial={s("novo") === "1"}>
            <CamposNovaAnalise pessoas={opcoes.pessoas} imoveis={opcoes.imoveis} corretores={opcoes.corretores} pessoal={pessoal} padrao={{ imovelId: s("imovel") || undefined, pessoaId: s("pessoa") || undefined }} />
          </JanelaCadastro>
        }
      />
      <AbasAnalise />

      <div className="entrar-cascata mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Indicador rotulo="Em análise" icone={<UserCheck />} valor={<Contador valor={emAnalise ?? 0} />} detalhe="candidatos sem decisão" href="/analise" />
        <Indicador
          rotulo="Aguardando garantidora"
          icone={<Hourglass />}
          valor={<Contador valor={aguardandoIds.size} />}
          detalhe="seguro, título ou carta em análise"
          tom={aguardandoIds.size ? "alerta" : "neutro"}
          href="/analise/garantidoras"
        />
        <Indicador rotulo="Aprovados no mês" icone={<ShieldCheck />} valor={<Contador valor={aprovadasMes ?? 0} />} tom="sucesso" href={url("aprovadas")} />
        <Indicador
          rotulo="Garantias vencendo"
          icone={<CalendarClock />}
          valor={<Contador valor={vencendo ?? 0} />}
          detalhe="vencidas ou em até 30 dias (contratos ativos)"
          tom={vencendo ? "perigo" : "neutro"}
          href="/analise/garantias"
        />
      </div>

      <PilulasLink className="mb-4" rotulo="Situação" ativo={url(filtro)} itens={Object.entries(FILTROS).map(([k, r]) => ({ href: url(k), rotulo: r }))} />
      <FiltroAutomatico className="mb-4 flex flex-wrap gap-2">
        {filtro && <input type="hidden" name="filtro" value={filtro} />}
        <Entrada name="busca" aria-label="Buscar candidato" defaultValue={busca} placeholder="Buscar nome, CPF, imóvel, nº…" className="max-w-80" />
      </FiltroAutomatico>

      <Tabela colunas={["Nº", "Candidato", "Imóvel", "Aluguel + encargos", "Renda", "Documentos", "Garantia", "Situação", ""]}>
        {lista.map((a) => {
          const renda = rendaComprovada(a.analise_rendas);
          const pct = comprometimentoPct(a.valor_aluguel, a.valor_encargos, renda);
          const sem = semaforoComprometimento(pct, cfg);
          const docs = progressoDocumentos(a.analise_documentos);
          // Fiança conta pelo fiador aprovado (igual à regra do banco).
          const aprovada = a.analise_garantias.find((g) => g.tipo !== "fiador" && (GARANTIA_APROVADA as readonly string[]).includes(g.status));
          const garantia = aprovada ?? a.analise_garantias.find((g) => g.status !== "cancelada" && g.status !== "recusada") ?? a.analise_garantias[0];
          const fiadorOk = a.analise_fiadores.some((f) => f.status === "aprovado");
          const doc = situacaoDocumento(a.candidato?.documento);
          const pend =
            a.status === "em_analise"
              ? foraDaRegra(
                  {
                    aluguel: a.valor_aluguel,
                    encargos: a.valor_encargos,
                    documentoCandidato: a.candidato?.documento,
                    rendas: a.analise_rendas,
                    consultas: a.analise_consultas,
                    documentos: a.analise_documentos,
                    garantias: a.analise_garantias,
                    fiadores: a.analise_fiadores.map((f) => ({ ...f, nome: "fiador" })),
                  },
                  cfg,
                ).length
              : 0;
          return (
            <LinhaLink key={a.id} href={`/analise/${a.id}`}>
              <Celula className="font-mono text-xs text-mudo">#{a.numero}</Celula>
              <Celula>
                <span className="font-medium text-texto">{a.candidato?.nome ?? "—"}</span>
                <span className="mt-0.5 flex items-center gap-1.5 text-xs text-mudo">
                  {a.candidato?.tipo_pessoa ?? "PF"}
                  {doc === "invalido" && <Selo cor="vermelho">doc. inválido</Selo>}
                  {doc === "ausente" && <Selo cor="amarelo">sem CPF/CNPJ</Selo>}
                </span>
              </Celula>
              <Celula>
                <span className="text-sm text-texto-2">{a.imovel?.codigo ?? "—"}</span>
              </Celula>
              <Celula className="tabular-nums">{formatarReais(Number(a.valor_aluguel) + Number(a.valor_encargos))}</Celula>
              <Celula>
                <Selo cor={COR_SEMAFORO[sem]}>{pct === null ? "sem comprovação" : `${String(pct).replace(".", ",")}% da renda`}</Selo>
              </Celula>
              <Celula>
                <span className={`text-sm tabular-nums ${docs.obrigatoriosPendentes ? "text-alerta" : "text-ok"}`}>
                  {docs.validados}/{docs.total}
                </span>
                {docs.recebidos > 0 && <span className="block text-xs text-acento">{docs.recebidos} para conferir</span>}
              </Celula>
              <Celula>
                {garantia ? (
                  <Selo cor={COR_STATUS_GARANTIA_PROPOSTA[garantia.status]}>{ROTULO_STATUS_GARANTIA_PROPOSTA[garantia.status]}</Selo>
                ) : fiadorOk ? (
                  <Selo cor="verde">Fiador aprovado</Selo>
                ) : (
                  <span className="text-xs text-mudo">—</span>
                )}
              </Celula>
              <Celula>
                <Selo cor={COR_STATUS_ANALISE[a.status]}>{ROTULO_STATUS_ANALISE[a.status]}</Selo>
                {a.excecao && <span className="mt-1 block text-xs text-alerta">exceção</span>}
                {pend > 0 && <span className="mt-1 block text-xs text-mudo">{pend} fora da regra</span>}
                {aprovacaoVencida(a, hoje) && <span className="mt-1 block text-xs text-ruim">aprovação venceu em {formatarDataBR(a.validade_ate)}</span>}
              </Celula>
              <Celula>
                <BotaoExcluir acao={excluirAnalise} id={a.id} rotulo="Excluir análise" confirmar={`Excluir a análise de ${a.candidato?.nome ?? "candidato"}? Os documentos enviados também saem. A auditoria continua guardada.`} />
              </Celula>
            </LinhaLink>
          );
        })}
        {lista.length === 0 && <LinhaVazia colunas={9}>Nenhum candidato aqui.</LinhaVazia>}
      </Tabela>
      {lista.length >= 500 && <p className="mt-3 text-sm text-alerta">Mostrando as 500 análises mais recentes. Use a busca para achar as outras.</p>}
    </>
  );
}
