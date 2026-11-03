import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeftRight, HandCoins, Plus, Wallet } from "lucide-react";
import { Contador } from "@/components/abas-segmentadas";
import { BotaoAcao } from "@/components/botao-acao";
import { BotaoExcluir } from "@/components/botao-excluir";
import { JanelaCadastro } from "@/components/janela-cadastro";
import { Cabecalho, Campo, Cartao, Celula, Entrada, Indicador, LinhaVazia, Selecao, Tabela } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { formatarDataBR, hojeISO, inicioDoMes } from "@/lib/dominio/datas";
import { formatarReais, paraCentavos, paraReais } from "@/lib/dominio/dinheiro";
import { AbasFinanceiro } from "../abas";
import { compensarAdiantamento, descompensarAdiantamento, excluirLancamento, registrarAdiantamento } from "../actions";
import { opcoesFinanceiro, todas } from "../dados";

export const metadata: Metadata = { title: "Proprietários" };

type Rep = { pessoa_id: string; valor_liquido: number; status: string; pago_em: string | null; previsto_para: string; pessoa: { nome: string } | null };
type Adi = { id: string; pessoa_id: string; valor: number; liquidado_em: string; compensado_em: string | null; descricao: string };

/** Saldo de cada proprietário com a imobiliária: repasses a fazer, pagos no mês e adiantamentos. */
export default async function ProprietariosFinanceiroPage() {
  const { supabase } = await obterContexto();
  const hoje = hojeISO();
  const mes = inicioDoMes(hoje);
  const [reps, adis, op, { data: donos }] = await Promise.all([
    todas<Rep>(() => supabase.from("repasses").select("pessoa_id, valor_liquido, status, pago_em, previsto_para, pessoa:pessoas(nome)").or(`status.eq.pendente,pago_em.gte.${mes}`).order("id")),
    todas<Adi>(() => supabase.from("lancamentos").select("id, pessoa_id, valor, liquidado_em, compensado_em, descricao").eq("adiantamento", true).neq("status", "cancelado").order("liquidado_em", { ascending: false }).order("id")),
    opcoesFinanceiro(supabase),
    supabase.from("pessoas").select("id, nome").contains("papeis", ["proprietario"]).order("nome"),
  ]);
  const lista = reps;
  const adiant = adis;
  const nomes = new Map<string, string>([...(donos ?? []).map((d) => [d.id, d.nome] as [string, string]), ...lista.map((r) => [r.pessoa_id, r.pessoa?.nome ?? "—"] as [string, string])]);
  type Linha = { id: string; pendente: number; pagoMes: number; adiantado: number; proximo: string | null };
  const mapa = new Map<string, Linha>();
  const obter = (id: string) => mapa.get(id) ?? { id, pendente: 0, pagoMes: 0, adiantado: 0, proximo: null };
  for (const r of lista) {
    const a = obter(r.pessoa_id);
    if (r.status === "pendente") {
      a.pendente += paraCentavos(r.valor_liquido);
      if (!a.proximo || r.previsto_para < a.proximo) a.proximo = r.previsto_para;
    } else if (r.status === "pago") a.pagoMes += paraCentavos(r.valor_liquido);
    mapa.set(r.pessoa_id, a);
  }
  for (const d of adiant) {
    if (d.compensado_em) continue;
    const a = obter(d.pessoa_id);
    a.adiantado += paraCentavos(d.valor);
    mapa.set(d.pessoa_id, a);
  }
  const linhas = [...mapa.values()].sort((a, b) => (nomes.get(a.id) ?? "").localeCompare(nomes.get(b.id) ?? ""));
  const tot = (k: "pendente" | "pagoMes" | "adiantado") => paraReais(linhas.reduce((s, l) => s + l[k], 0));

  return (
    <>
      <Cabecalho
        titulo="Proprietários"
        trilha="Financeiro"
        descricao="Quanto a imobiliária deve a cada proprietário (repasses a fazer), o que já foi pago no mês e os adiantamentos a descontar."
        acoes={
          <JanelaCadastro rotuloBotao={<><Plus className="size-4" /> Adiantamento</>} titulo="Adiantamento ao proprietário" acao={registrarAdiantamento} icone={<HandCoins />} rotuloSalvar="Registrar">
            <Campo rotulo="Proprietário">
              <Selecao name="pessoa_id" required defaultValue="">
                <option value="">Selecione…</option>
                {(donos ?? []).map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.nome}
                  </option>
                ))}
              </Selecao>
            </Campo>
            <div className="grid gap-4 sm:grid-cols-2">
              <Campo rotulo="Valor (R$)">
                <Entrada name="valor" required inputMode="decimal" />
              </Campo>
              <Campo rotulo="Data">
                <Entrada type="date" name="data" defaultValue={hoje} />
              </Campo>
            </div>
            <Campo rotulo="Saiu da conta">
              <Selecao name="conta_id" defaultValue="">
                <option value="">—</option>
                {op.contas.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                  </option>
                ))}
              </Selecao>
            </Campo>
            <Campo rotulo="Descrição">
              <Entrada name="descricao" placeholder="Adiantamento ao proprietário" />
            </Campo>
          </JanelaCadastro>
        }
      />
      <AbasFinanceiro pessoal={false} />
      <div className="entrar-cascata mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Indicador rotulo="Repasses a fazer" icone={<ArrowLeftRight />} valor={<Contador valor={tot("pendente")} formato="moeda" />} tom="alerta" href="/repasses" />
        <Indicador rotulo="Repassado neste mês" icone={<Wallet />} valor={<Contador valor={tot("pagoMes")} formato="moeda" />} tom="sucesso" />
        <Indicador rotulo="Adiantamentos a descontar" icone={<HandCoins />} valor={<Contador valor={tot("adiantado")} formato="moeda" />} />
      </div>
      <Tabela colunas={["Proprietário", "Repasses a fazer", "Próximo", "Pago no mês", "Adiantado", "Saldo a repassar"]}>
        {linhas.map((l) => (
          <tr key={l.id}>
            <Celula>
              <Link href={`/pessoas/${l.id}`} className="font-medium text-texto hover:text-acento">
                {nomes.get(l.id) ?? "—"}
              </Link>
            </Celula>
            <Celula className="tabular-nums">{formatarReais(paraReais(l.pendente))}</Celula>
            <Celula>{formatarDataBR(l.proximo)}</Celula>
            <Celula className="tabular-nums">{formatarReais(paraReais(l.pagoMes))}</Celula>
            <Celula className="tabular-nums">{l.adiantado ? formatarReais(paraReais(l.adiantado)) : "—"}</Celula>
            <Celula className="font-semibold tabular-nums">{formatarReais(paraReais(l.pendente - l.adiantado))}</Celula>
          </tr>
        ))}
        {linhas.length === 0 && <LinhaVazia colunas={6}>Nenhum repasse pendente ou pago neste mês.</LinhaVazia>}
      </Tabela>
      {adiant.length > 0 && (
        <Cartao titulo="Adiantamentos" className="mt-6">
          <ul className="divide-y divide-borda-suave text-sm">
            {adiant.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                <span>
                  {formatarDataBR(d.liquidado_em)} · <b>{nomes.get(d.pessoa_id) ?? "—"}</b> · {d.descricao}
                </span>
                <span className="flex items-center gap-2">
                  <span className="font-medium tabular-nums">{formatarReais(d.valor)}</span>
                  {d.compensado_em ? (
                    <>
                      <span className="text-xs text-mudo">descontado em {formatarDataBR(d.compensado_em)}</span>
                      <BotaoAcao acao={descompensarAdiantamento} id={d.id} tamanho="sm" variante="fantasma" confirmar="Desfazer o desconto? O valor volta para o repasse (se ele ainda não foi pago).">
                        Desfazer desconto
                      </BotaoAcao>
                    </>
                  ) : (
                    <BotaoAcao acao={compensarAdiantamento} id={d.id} tamanho="sm" confirmar="Descontar este adiantamento no próximo repasse pendente do proprietário?">
                      Descontar no próximo repasse
                    </BotaoAcao>
                  )}
                  {!d.compensado_em && <BotaoExcluir acao={excluirLancamento} id={d.id} rotulo="Excluir adiantamento" confirmar="Excluir este adiantamento?" />}
                </span>
              </li>
            ))}
          </ul>
        </Cartao>
      )}
    </>
  );
}
