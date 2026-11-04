import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeftRight, BadgePercent, CalendarClock, CheckCircle2, ShieldCheck } from "lucide-react";
import { Contador } from "@/components/abas-segmentadas";
import { FiltroAutomatico } from "@/components/filtro-automatico";
import { BotaoEnviar, Formulario } from "@/components/formulario";
import { LinhaLink } from "@/components/linha-link";
import { PilulasLink } from "@/components/pilulas-link";
import { BotaoLink, Cabecalho, Campo, Cartao, Celula, Entrada, Indicador, LinhaVazia, Selecao, Selo, Tabela } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { formatarCompetencia, formatarDataBR, hojeISO, inicioDoMes, somarMeses } from "@/lib/dominio/datas";
import { formatarReais, paraCentavos, paraReais } from "@/lib/dominio/dinheiro";
import {
  COR_SITUACAO_REPASSE,
  FORMAS_REPASSE,
  ROTULO_SITUACAO_REPASSE,
  dataDoPagamento,
  podeAprovarRepasse,
  repasseAtrasado,
  situacaoRepasse,
  type SituacaoRepasse,
} from "@/lib/dominio/repasses";
import { AbasRepasses } from "./abas";
import { acaoEmLote, salvarConfigRepasses } from "./actions";
import type { RepasseCompleto } from "./dados";

export const metadata: Metadata = { title: "Repasses" };

type Linha = Pick<
  RepasseCompleto,
  | "id"
  | "status"
  | "competencia"
  | "valor_bruto"
  | "taxa_administracao"
  | "taxa_intermediacao"
  | "irrf"
  | "imposto"
  | "outros_descontos"
  | "valor_liquido"
  | "previsto_para"
  | "programado_para"
  | "aprovado_em"
  | "pago_em"
  | "pessoa_id"
> & { pessoa: { id: string; nome: string; pix_chave: string | null }; contrato: { id: string; numero: number; imovel: { codigo: string } } };

const FILTROS: Record<string, string> = {
  pendentes: "Pendentes",
  aprovar: "A aprovar",
  agendados: "Agendados",
  liberados: "Liberados para pagar",
  pagos: "Pagos",
  cancelados: "Cancelados",
  todos: "Todos",
};
const SITUACAO_DO_FILTRO: Record<string, SituacaoRepasse> = { aprovar: "a_aprovar", agendados: "agendado", liberados: "a_pagar" };

export default async function RepassesPage({ searchParams }: PageProps<"/repasses">) {
  const sp = await searchParams;
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const filtro = s("f") in FILTROS ? s("f") : "pendentes";
  const pessoa = s("pessoa");
  const mes = /^\d{4}-\d{2}$/.test(s("mes")) ? s("mes") : "";
  const { supabase, organizacao, papel } = await obterContexto();
  const pode = podeAprovarRepasse(papel);
  const hoje = hojeISO();
  const inicioMes = inicioDoMes(hoje);

  let q = supabase
    .from("repasses")
    .select(
      "id, status, competencia, valor_bruto, taxa_administracao, taxa_intermediacao, irrf, imposto, outros_descontos, valor_liquido, previsto_para, programado_para, aprovado_em, pago_em, pessoa_id, pessoa:pessoas(id, nome, pix_chave), contrato:contratos(id, numero, imovel:imoveis(codigo))",
    )
    .limit(1000);
  if (filtro === "pagos") q = q.eq("status", "pago").order("pago_em", { ascending: false });
  else if (filtro === "cancelados") q = q.eq("status", "cancelado").order("competencia", { ascending: false });
  else if (filtro === "todos") q = q.order("competencia", { ascending: false });
  else q = q.eq("status", "pendente").order("pagar_em");
  if (pessoa) q = q.eq("pessoa_id", pessoa);
  if (mes) q = q.gte("competencia", `${mes}-01`).lt("competencia", somarMeses(`${mes}-01`, 1));

  const [{ data }, { data: pend }, { data: pagosMes }, { data: donos }, { data: contas }, { data: org }] = await Promise.all([
    q,
    supabase.from("repasses").select("valor_liquido, previsto_para, programado_para, aprovado_em, status").eq("status", "pendente").limit(5000),
    supabase.from("repasses").select("valor_liquido").eq("status", "pago").gte("pago_em", inicioMes).limit(5000),
    supabase.from("pessoas").select("id, nome").contains("papeis", ["proprietario"]).order("nome"),
    supabase.from("contas_financeiras").select("id, nome").eq("ativa", true).order("nome"),
    supabase.from("organizacoes").select("repasse_exige_aprovacao").eq("id", organizacao.id).maybeSingle(),
  ]);
  let repasses = (data ?? []) as unknown as Linha[];
  if (SITUACAO_DO_FILTRO[filtro]) repasses = repasses.filter((r) => situacaoRepasse(r, hoje) === SITUACAO_DO_FILTRO[filtro]);
  if (filtro === "pendentes") repasses.sort((a, b) => dataDoPagamento(a).localeCompare(dataDoPagamento(b)));

  const pendentes = (pend ?? []) as { valor_liquido: number; previsto_para: string; programado_para: string | null; aprovado_em: string | null; status: string }[];
  const soma = (l: { valor_liquido: number }[]) => paraReais(l.reduce((t, r) => t + paraCentavos(r.valor_liquido), 0));
  const aAprovar = pendentes.filter((r) => situacaoRepasse(r, hoje) === "a_aprovar");
  const agendados = pendentes.filter((r) => situacaoRepasse(r, hoje) === "agendado");
  const liberados = pendentes.filter((r) => situacaoRepasse(r, hoje) === "a_pagar");
  const atrasados = pendentes.filter((r) => repasseAtrasado(r, hoje));
  const temPendente = repasses.some((r) => r.status === "pendente");

  const url = (f: string) => {
    const p = new URLSearchParams(Object.entries({ f, pessoa, mes }).filter(([, v]) => v) as [string, string][]);
    return `/repasses?${p}`;
  };

  return (
    <>
      <Cabecalho
        titulo="Repasses aos proprietários"
        descricao="O repasse nasce na baixa do aluguel (aluguel − taxas − impostos). Aqui você aprova, agenda, desconta as despesas autorizadas, paga por Pix ou transferência e guarda o comprovante."
        acoes={
          <BotaoLink href="/comissoes" variante="secundario">
            <BadgePercent className="size-4" /> Comissões dos corretores
          </BotaoLink>
        }
      />
      <AbasRepasses />
      <div className="entrar-cascata mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Indicador rotulo="A aprovar" icone={<ShieldCheck />} valor={<Contador valor={soma(aAprovar)} formato="moeda" />} detalhe={`${aAprovar.length} repasse(s)`} tom={aAprovar.length ? "alerta" : "neutro"} href={url("aprovar")} />
        <Indicador rotulo="Agendados" icone={<CalendarClock />} valor={<Contador valor={soma(agendados)} formato="moeda" />} detalhe={`${agendados.length} repasse(s)`} href={url("agendados")} />
        <Indicador
          rotulo="Liberados para pagar"
          icone={<ArrowLeftRight />}
          valor={<Contador valor={soma(liberados)} formato="moeda" />}
          detalhe={atrasados.length ? `${atrasados.length} atrasado(s)` : `${liberados.length} repasse(s)`}
          tom={atrasados.length ? "perigo" : liberados.length ? "alerta" : "neutro"}
          href={url("liberados")}
        />
        <Indicador rotulo="Pagos neste mês" icone={<CheckCircle2 />} valor={<Contador valor={soma(pagosMes ?? [])} formato="moeda" />} detalhe={`${(pagosMes ?? []).length} repasse(s)`} tom="sucesso" href={url("pagos")} />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <PilulasLink rotulo="Situação dos repasses" ativo={url(filtro)} itens={Object.entries(FILTROS).map(([k, r]) => ({ href: url(k), rotulo: r }))} />
        <FiltroAutomatico className="flex flex-wrap gap-2">
          <input type="hidden" name="f" value={filtro} />
          <Selecao name="pessoa" defaultValue={pessoa} className="max-w-xs" aria-label="Proprietário">
            <option value="">Todos os proprietários</option>
            {(donos ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.nome}
              </option>
            ))}
          </Selecao>
          <Entrada type="month" name="mes" defaultValue={mes} className="w-44" aria-label="Competência" />
        </FiltroAutomatico>
      </div>

      <Formulario acao={acaoEmLote} className="space-y-4">
        <Tabela colunas={[pode ? "Marcar" : "", "Pagar em", "Proprietário", "Contrato", "Competência", "Bruto", "Taxas", "Impostos", "Descontos", "Líquido", "Situação"]}>
          {repasses.length === 0 && <LinhaVazia colunas={11}>Nenhum repasse nesta lista.</LinhaVazia>}
          {repasses.map((r) => {
            const sit = situacaoRepasse(r, hoje);
            const atrasado = repasseAtrasado(r, hoje);
            return (
              <LinhaLink href={`/repasses/${r.id}`} key={r.id}>
                <Celula>{pode && r.status === "pendente" && <input type="checkbox" name="ids" value={r.id} aria-label={`Marcar repasse de ${r.pessoa.nome}`} />}</Celula>
                <Celula className={atrasado ? "font-medium text-ruim" : ""}>{r.status === "pago" ? formatarDataBR(r.pago_em) : formatarDataBR(dataDoPagamento(r))}</Celula>
                <Celula>
                  <span className="font-medium text-texto">{r.pessoa.nome}</span>
                  {!r.pessoa.pix_chave && r.status === "pendente" && <span className="block text-xs text-mudo">sem chave Pix</span>}
                </Celula>
                <Celula>
                  <Link href={`/contratos/${r.contrato.id}`} className="hover:underline">
                    #{r.contrato.numero} · {r.contrato.imovel.codigo}
                  </Link>
                </Celula>
                <Celula>{formatarCompetencia(r.competencia)}</Celula>
                <Celula className="tabular-nums">{formatarReais(r.valor_bruto)}</Celula>
                <Celula className="tabular-nums">{formatarReais(Number(r.taxa_administracao) + Number(r.taxa_intermediacao))}</Celula>
                <Celula className="tabular-nums">{formatarReais(Number(r.irrf) + Number(r.imposto ?? 0))}</Celula>
                <Celula className="tabular-nums">{Number(r.outros_descontos) ? formatarReais(r.outros_descontos) : "—"}</Celula>
                <Celula className="font-semibold tabular-nums">{formatarReais(r.valor_liquido)}</Celula>
                <Celula>
                  <Selo cor={COR_SITUACAO_REPASSE[sit]}>{ROTULO_SITUACAO_REPASSE[sit]}</Selo>
                  {atrasado && <div className="mt-1 text-xs font-medium text-ruim">atrasado</div>}
                </Celula>
              </LinhaLink>
            );
          })}
        </Tabela>
        {pode && temPendente && (
          <div className="rounded-card border border-borda bg-card p-4">
            <p className="mb-3 text-sm text-texto-2">
              Com os marcados: <b>aprovar</b> (desconta as despesas autorizadas de cada imóvel e agenda a data) ou <b>marcar como pagos</b> (o que ainda não foi aprovado é
              aprovado junto, com o mesmo desconto das despesas{org?.repasse_exige_aprovacao ? " — mas aqui a aprovação é exigida antes, então só os aprovados são pagos" : ""}).
            </p>
            <div className="flex flex-wrap items-end gap-3">
              <Campo rotulo="Agendar para (aprovar)">
                <Entrada type="date" name="programado_para" defaultValue={hoje} />
              </Campo>
              <BotaoEnviar name="acao" value="aprovar" variante="secundario">
                Aprovar marcados
              </BotaoEnviar>
              <Campo rotulo="Pago em">
                <Entrada type="date" name="pago_em" defaultValue={hoje} />
              </Campo>
              <Campo rotulo="Forma">
                <Selecao name="forma_pagamento" defaultValue="pix">
                  {Object.entries(FORMAS_REPASSE).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </Selecao>
              </Campo>
              <Campo rotulo="Saiu da conta">
                <Selecao name="conta_id" defaultValue="">
                  <option value="">—</option>
                  {(contas ?? []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nome}
                    </option>
                  ))}
                </Selecao>
              </Campo>
              <Campo rotulo="Comprovante / ID">
                <Entrada name="comprovante" />
              </Campo>
              <BotaoEnviar name="acao" value="pagar">
                Marcar como pagos
              </BotaoEnviar>
            </div>
          </div>
        )}
      </Formulario>

      {(papel === "admin" || papel === "gestor") && (
        <Cartao titulo="Regras dos repasses" className="mt-6">
          <Formulario acao={salvarConfigRepasses} automatico className="space-y-2">
            <label className="flex items-start gap-2 text-sm text-texto">
              <input type="hidden" name="repasse_exige_aprovacao" value="" />
              <input type="checkbox" name="repasse_exige_aprovacao" defaultChecked={!!org?.repasse_exige_aprovacao} className="mt-1" />
              <span>
                Exigir aprovação antes de pagar
                <span className="block text-xs text-mudo">
                  Ligado: ninguém marca um repasse como pago (nem pela conciliação do extrato) sem antes ele ser aprovado por administrador, gestor ou financeiro. Desligado: pagar já
                  aprova junto e desconta as despesas autorizadas do imóvel (na conciliação do extrato, se houver despesa a descontar, o sistema pede para aprovar o repasse antes).
                </span>
              </span>
            </label>
          </Formulario>
        </Cartao>
      )}
    </>
  );
}
