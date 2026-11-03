import type { Metadata } from "next";
import Link from "next/link";
import { HandCoins, Plus, Receipt } from "lucide-react";
import { Contador } from "@/components/abas-segmentadas";
import { BotaoAcao } from "@/components/botao-acao";
import { BotaoExcluir } from "@/components/botao-excluir";
import { JanelaCadastro } from "@/components/janela-cadastro";
import { LinhaLink } from "@/components/linha-link";
import { PilulasLink } from "@/components/pilulas-link";
import { AreaTexto, Cabecalho, Campo, Celula, Entrada, Indicador, LinhaVazia, Selecao, Selo, Tabela } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { formatarCompetencia, formatarDataBR, hojeISO, inicioDoMes } from "@/lib/dominio/datas";
import { formatarReais, paraCentavos, paraReais } from "@/lib/dominio/dinheiro";
import { podeAprovarRepasse, situacaoDespesa } from "@/lib/dominio/repasses";
import { AbasRepasses } from "../abas";
import { criarDespesaAutorizada, excluirDespesaAutorizada, naoDescontarDespesa } from "../actions";
import type { DespesaAutorizada } from "../dados";
import { CamposImovelDono, type ImovelComDonos } from "./campos";

export const metadata: Metadata = { title: "Despesas a descontar" };

type Linha = DespesaAutorizada & { imovel: { id: string; codigo: string } | null; dono: { nome: string } | null; prestador: { nome: string } | null };
type Desc = { lancamento_id: string; valor: number; created_at: string; repasse: { id: string; competencia: string; pessoa: { nome: string } | null } | null };

const FILTROS: Record<string, string> = { abertas: "A descontar", descontadas: "Descontadas", todas: "Todas" };

/** Despesas do imóvel pagas pela imobiliária em nome do proprietário, descontadas na aprovação do próximo repasse. */
export default async function DespesasADescontarPage({ searchParams }: PageProps<"/repasses/despesas">) {
  const sp = await searchParams;
  const filtro = typeof sp.f === "string" && sp.f in FILTROS ? sp.f : "abertas";
  const { supabase, papel } = await obterContexto();
  const hoje = hojeISO();
  const [{ data }, { data: imoveis }, { data: cadDonos }, { data: partesDonos }, { data: pessoas }, { data: contas }] = await Promise.all([
    supabase
      .from("lancamentos")
      .select("id, descricao, valor, vencimento, status, liquidado_em, imovel_id, descontar_de_id, repasse_id, pessoa_id, observacoes, created_at, imovel:imoveis(id, codigo), dono:pessoas!lancamentos_descontar_de_id_fkey(nome), prestador:pessoas!lancamentos_pessoa_id_fkey(nome)")
      .eq("descontar_repasse", true)
      .order("vencimento", { ascending: false })
      .limit(1000),
    supabase.from("imoveis").select("id, codigo, logradouro, numero").neq("status", "inativo").order("codigo").limit(3000),
    // Donos de cada imóvel: os do cadastro do imóvel e os proprietários dos contratos dele.
    supabase.from("imovel_proprietarios").select("imovel_id, pessoa_id, pessoa:pessoas(nome)").limit(10000),
    supabase.from("contrato_partes").select("pessoa_id, pessoa:pessoas(nome), contrato:contratos!inner(imovel_id)").eq("papel", "proprietario").limit(10000),
    supabase.from("pessoas").select("id, nome").order("nome").limit(3000),
    supabase.from("contas_financeiras").select("id, nome").eq("ativa", true).order("nome"),
  ]);
  const todas = (data ?? []) as unknown as Linha[];
  const ids = todas.map((d) => d.id);
  const { data: feitos } = ids.length
    ? await supabase.from("repasse_descontos").select("lancamento_id, valor, created_at, repasse:repasses(id, competencia, pessoa:pessoas(nome))").in("lancamento_id", ids)
    : { data: [] };
  const porDespesa = new Map<string, Desc[]>();
  for (const f of (feitos ?? []) as unknown as Desc[]) porDespesa.set(f.lancamento_id, [...(porDespesa.get(f.lancamento_id) ?? []), f]);
  const descontado = (id: string) => (porDespesa.get(id) ?? []).reduce((s, f) => s + paraCentavos(f.valor), 0);
  const sit = (d: Linha) => situacaoDespesa(paraCentavos(d.valor), descontado(d.id), d.status === "cancelado");
  const lista = todas.filter((d) => (filtro === "abertas" ? sit(d).falta > 0 && d.status !== "cancelado" : filtro === "descontadas" ? sit(d).falta === 0 : true));
  const falta = paraReais(todas.filter((d) => d.status !== "cancelado").reduce((s, d) => s + sit(d).falta, 0));
  const mes = inicioDoMes(hoje);
  const noMes = paraReais(((feitos ?? []) as unknown as Desc[]).filter((f) => f.created_at.slice(0, 10) >= mes).reduce((s, f) => s + paraCentavos(f.valor), 0));
  const donosDe = new Map<string, Map<string, string>>();
  const juntarDono = (imovelId: string | null | undefined, pessoaId: string | null, nome: string | undefined) => {
    if (!imovelId || !pessoaId) return;
    const m = donosDe.get(imovelId) ?? new Map<string, string>();
    m.set(pessoaId, nome ?? "—");
    donosDe.set(imovelId, m);
  };
  for (const d of (cadDonos ?? []) as unknown as { imovel_id: string; pessoa_id: string; pessoa: { nome: string } | null }[]) juntarDono(d.imovel_id, d.pessoa_id, d.pessoa?.nome);
  for (const d of (partesDonos ?? []) as unknown as { pessoa_id: string | null; pessoa: { nome: string } | null; contrato: { imovel_id: string } | null }[])
    juntarDono(d.contrato?.imovel_id, d.pessoa_id, d.pessoa?.nome);
  const comDono: ImovelComDonos[] = (imoveis ?? [])
    .filter((i) => donosDe.has(i.id))
    .map((i) => ({
      id: i.id,
      rotulo: [i.codigo, [i.logradouro, i.numero].filter(Boolean).join(", ")].filter(Boolean).join(" — "),
      donos: [...donosDe.get(i.id)!].map(([id, nome]) => ({ id, nome })).sort((a, b) => a.nome.localeCompare(b.nome)),
    }));
  /** Despesa marcada para quem não é dono do imóvel nunca cairia num repasse. */
  const donoErrado = (d: Linha) => Boolean(d.descontar_de_id && d.imovel_id && !donosDe.get(d.imovel_id)?.has(d.descontar_de_id));

  return (
    <>
      <Cabecalho
        titulo="Despesas a descontar"
        trilha="Repasses"
        descricao="Despesas do imóvel pagas pela imobiliária em nome do proprietário (conserto, IPTU atrasado, taxa extra…). Na aprovação do próximo repasse do imóvel (ou ao pagar, quando a aprovação não é exigida) o sistema desconta sozinho: de um dono só, se você escolher, ou de todos pela participação de cada um."
        acoes={
          <JanelaCadastro rotuloBotao={<><Plus className="size-4" /> Nova despesa</>} titulo="Despesa a descontar do proprietário" acao={criarDespesaAutorizada} icone={<HandCoins />} rotuloSalvar="Registrar" larguraMax="max-w-xl">
            <CamposImovelDono imoveis={comDono} />
            <Campo rotulo="Descrição">
              <Entrada name="descricao" required placeholder="Troca do aquecedor" />
            </Campo>
            <div className="grid gap-4 sm:grid-cols-2">
              <Campo rotulo="Valor (R$)">
                <Entrada name="valor" required inputMode="decimal" />
              </Campo>
              <Campo rotulo="Data">
                <Entrada type="date" name="data" defaultValue={hoje} />
              </Campo>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Campo rotulo="Pago a (prestador)">
                <Selecao name="pessoa_id" defaultValue="">
                  <option value="">—</option>
                  {(pessoas ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nome}
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
            </div>
            <label className="flex items-center gap-2 text-sm text-texto">
              <input type="hidden" name="ja_paga" value="" />
              <input type="checkbox" name="ja_paga" defaultChecked /> A imobiliária já pagou esta despesa
            </label>
            <Campo rotulo="Observações">
              <AreaTexto name="observacoes" rows={2} />
            </Campo>
          </JanelaCadastro>
        }
      />
      <AbasRepasses />
      <div className="entrar-cascata mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Indicador rotulo="Falta descontar" icone={<HandCoins />} valor={<Contador valor={falta} formato="moeda" />} tom={falta ? "alerta" : "neutro"} detalhe="cai na aprovação do próximo repasse de cada imóvel" />
        <Indicador rotulo="Descontado neste mês" icone={<Receipt />} valor={<Contador valor={noMes} formato="moeda" />} tom="sucesso" />
      </div>
      <PilulasLink className="mb-4" rotulo="Situação das despesas" ativo={`/repasses/despesas?f=${filtro}`} itens={Object.entries(FILTROS).map(([k, r]) => ({ href: `/repasses/despesas?f=${k}`, rotulo: r }))} />
      <Tabela colunas={["Data", "Imóvel", "Despesa", "Descontar de", "Valor", "Descontado em", "Falta", "Situação", ""]}>
        {lista.length === 0 && <LinhaVazia colunas={9}>Nenhuma despesa nesta lista.</LinhaVazia>}
        {lista.map((d) => {
          const st = sit(d);
          const reps = porDespesa.get(d.id) ?? [];
          return (
            <LinhaLink key={d.id} href={`/financeiro/lancamentos/${d.id}`}>
              <Celula>{formatarDataBR(d.vencimento)}</Celula>
              <Celula>{d.imovel ? <Link href={`/imoveis/${d.imovel.id}`} className="hover:underline">{d.imovel.codigo}</Link> : "—"}</Celula>
              <Celula>
                <span className="font-medium text-texto">{d.descricao}</span>
                {d.prestador && <span className="block text-xs text-mudo">pago a {d.prestador.nome}</span>}
                {d.status !== "liquidado" && d.status !== "cancelado" && <span className="block text-xs text-alerta">ainda não paga pela imobiliária</span>}
              </Celula>
              <Celula>
                {d.dono?.nome ?? "Todos (rateio)"}
                {donoErrado(d) && st.falta > 0 && <span className="block text-xs text-ruim">não é dono deste imóvel: exclua e lance de novo</span>}
              </Celula>
              <Celula className="tabular-nums">{formatarReais(d.valor)}</Celula>
              <Celula className="text-xs">
                {reps.length
                  ? reps.map((f, i) => (
                      <span key={i} className="block">
                        {f.repasse ? (
                          <Link href={`/repasses/${f.repasse.id}`} className="text-acento hover:underline">
                            {f.repasse.pessoa?.nome ?? "repasse"} · {formatarCompetencia(f.repasse.competencia)}
                          </Link>
                        ) : (
                          "repasse"
                        )}{" "}
                        ({formatarReais(f.valor)})
                      </span>
                    ))
                  : "—"}
              </Celula>
              <Celula className="font-semibold tabular-nums">{st.falta ? formatarReais(paraReais(st.falta)) : "—"}</Celula>
              <Celula>
                <Selo cor={st.cor}>{st.rotulo}</Selo>
              </Celula>
              <Celula>
                <div className="flex items-center justify-end gap-2">
                  {podeAprovarRepasse(papel) && !reps.length && d.status !== "cancelado" && (
                    <BotaoAcao acao={naoDescontarDespesa} id={d.id} tamanho="sm" confirmar="Não descontar esta despesa do proprietário? Ela continua no financeiro como despesa da imobiliária.">
                      Não descontar
                    </BotaoAcao>
                  )}
                  <BotaoExcluir acao={excluirDespesaAutorizada} id={d.id} rotulo="Excluir despesa" confirmar="Excluir esta despesa (sai também do financeiro)?" />
                </div>
              </Celula>
            </LinhaLink>
          );
        })}
      </Tabela>
      <p className="mt-3 text-xs text-mudo">
        O desconto aparece na ficha do repasse, no recibo, no demonstrativo mensal e no extrato do proprietário. Despesa ainda não descontada pode ser excluída ou tirada da fila (“Não descontar”).
      </p>
    </>
  );
}
