import type { Metadata } from "next";
import Link from "next/link";
import { Mail, MessageCircle } from "lucide-react";
import { FiltroAutomatico } from "@/components/filtro-automatico";
import { BotaoImprimir } from "@/components/formulario";
import { LinhaLink } from "@/components/linha-link";
import { NOMES_MES, NavegadorMes, lerMes } from "@/components/navegador-mes";
import { Cabecalho, Celula, LinhaVazia, Selecao, Selo, Tabela, classeBotao } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { formatarCompetencia, formatarDataBR, hojeISO } from "@/lib/dominio/datas";
import { formatarDocumento } from "@/lib/dominio/documentos";
import { formatarReais } from "@/lib/dominio/dinheiro";
import { COR_SITUACAO_REPASSE, ROTULO_SITUACAO_REPASSE, mensagemDemonstrativo, situacaoRepasse, totaisDemonstrativo } from "@/lib/dominio/repasses";
import { linkWhatsapp } from "@/lib/whatsapp";
import { AbasRepasses } from "../abas";
import type { RepasseCompleto } from "../dados";

export const metadata: Metadata = { title: "Demonstrativo mensal" };

type Linha = Omit<RepasseCompleto, "pessoa" | "fatura" | "contrato"> & {
  pessoa: { id: string; nome: string };
  contrato: { id: string; numero: number; imovel: { codigo: string; logradouro: string | null; numero: string | null } };
};

/** Demonstrativo mensal do proprietário: o que entrou, o que foi descontado e o que foi repassado. */
export default async function DemonstrativoPage({ searchParams }: PageProps<"/repasses/demonstrativo">) {
  const sp = await searchParams;
  const hoje = hojeISO();
  const mes = lerMes(sp.mes, hoje);
  const pessoaId = typeof sp.pessoa === "string" ? sp.pessoa : "";
  const { supabase, organizacao } = await obterContexto();
  const competencia = `${mes}-01`;
  let q = supabase
    .from("repasses")
    .select("*, pessoa:pessoas(id, nome), contrato:contratos(id, numero, imovel:imoveis(codigo, logradouro, numero))")
    .eq("competencia", competencia)
    .neq("status", "cancelado")
    .order("pagar_em")
    .limit(3000);
  if (pessoaId) q = q.eq("pessoa_id", pessoaId);
  const [{ data }, { data: donos }, { data: pessoa }] = await Promise.all([
    q,
    supabase.from("pessoas").select("id, nome").contains("papeis", ["proprietario"]).order("nome"),
    pessoaId ? supabase.from("pessoas").select("id, nome, documento, telefone, email").eq("id", pessoaId).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const repasses = (data ?? []) as unknown as Linha[];
  const nomeMes = `${NOMES_MES[Number(mes.slice(5)) - 1]} de ${mes.slice(0, 4)}`;

  // Sem proprietário escolhido: um resumo por proprietário do mês.
  if (!pessoa) {
    const porDono = new Map<string, Linha[]>();
    for (const r of repasses) porDono.set(r.pessoa.id, [...(porDono.get(r.pessoa.id) ?? []), r]);
    const linhas = [...porDono.entries()].map(([id, l]) => ({ id, nome: l[0].pessoa.nome, n: l.length, t: totaisDemonstrativo(l) })).sort((a, b) => a.nome.localeCompare(b.nome));
    return (
      <>
        <Cabecalho titulo="Demonstrativo mensal" trilha="Repasses" descricao="Escolha o proprietário para ver, imprimir ou enviar o demonstrativo do mês (aluguéis recebidos, taxas, impostos, despesas descontadas e repasse)." />
        <AbasRepasses />
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <NavegadorMes caminho="/repasses/demonstrativo" mes={mes} hoje={hoje} />
          <FiltroAutomatico className="flex gap-2">
            <input type="hidden" name="mes" value={mes} />
            <Selecao name="pessoa" defaultValue="" className="max-w-xs" aria-label="Proprietário">
              <option value="">Escolha o proprietário…</option>
              {(donos ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome}
                </option>
              ))}
            </Selecao>
          </FiltroAutomatico>
        </div>
        <Tabela colunas={["Proprietário", "Repasses", "Recebido", "Taxas", "Impostos", "Descontos", "Líquido", "Pago", "A pagar"]}>
          {linhas.length === 0 && <LinhaVazia colunas={9}>Nenhum repasse com competência {formatarCompetencia(competencia)}.</LinhaVazia>}
          {linhas.map((l) => (
            <LinhaLink key={l.id} href={`/repasses/demonstrativo?mes=${mes}&pessoa=${l.id}`}>
              <Celula>
                <span className="font-medium text-texto">{l.nome}</span>
              </Celula>
              <Celula className="tabular-nums">{l.n}</Celula>
              <Celula className="tabular-nums">{formatarReais(l.t.bruto)}</Celula>
              <Celula className="tabular-nums">{formatarReais(l.t.taxas)}</Celula>
              <Celula className="tabular-nums">{formatarReais(l.t.impostos)}</Celula>
              <Celula className="tabular-nums">{formatarReais(l.t.descontos)}</Celula>
              <Celula className="font-semibold tabular-nums">{formatarReais(l.t.liquido)}</Celula>
              <Celula className="tabular-nums text-ok">{formatarReais(l.t.pago)}</Celula>
              <Celula className="tabular-nums text-alerta">{formatarReais(l.t.aPagar)}</Celula>
            </LinhaLink>
          ))}
        </Tabela>
      </>
    );
  }

  const ids = repasses.map((r) => r.id);
  const { data: descontos } = ids.length
    ? await supabase.from("repasse_descontos").select("repasse_id, descricao, valor, tipo").in("repasse_id", ids).order("created_at")
    : { data: [] };
  const t = totaisDemonstrativo(repasses);
  const msg = mensagemDemonstrativo(pessoa.nome, formatarCompetencia(competencia), t, organizacao.nome);

  return (
    <>
      <div className="nao-imprimir">
        <Cabecalho
          titulo="Demonstrativo mensal"
          trilha="Repasses"
          descricao={`${pessoa.nome} · competência ${formatarCompetencia(competencia)}`}
          acoes={
            <>
              {pessoa.telefone && (
                <a href={linkWhatsapp(pessoa.telefone, msg)} target="_blank" rel="noreferrer" className={classeBotao("secundario")}>
                  <MessageCircle className="size-4" /> WhatsApp
                </a>
              )}
              {pessoa.email && (
                <a href={`mailto:${pessoa.email}?subject=${encodeURIComponent(`Demonstrativo ${formatarCompetencia(competencia)}`)}&body=${encodeURIComponent(msg)}`} className={classeBotao("secundario")}>
                  <Mail className="size-4" /> E-mail
                </a>
              )}
              <BotaoImprimir />
            </>
          }
        />
        <AbasRepasses />
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <NavegadorMes caminho="/repasses/demonstrativo" mes={mes} hoje={hoje} extra={{ pessoa: pessoaId }} />
          <FiltroAutomatico className="flex gap-2">
            <input type="hidden" name="mes" value={mes} />
            <Selecao name="pessoa" defaultValue={pessoaId} className="max-w-xs" aria-label="Proprietário">
              <option value="">Todos os proprietários</option>
              {(donos ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome}
                </option>
              ))}
            </Selecao>
          </FiltroAutomatico>
        </div>
      </div>

      <article className="space-y-5 rounded-card border border-borda bg-card p-[clamp(18px,2.4vw,32px)] text-sm text-texto print:border-0 print:p-0">
        <header className="flex flex-wrap justify-between gap-4 border-b border-borda pb-4">
          <div>
            <h2 className="text-[20px] font-semibold">Demonstrativo de repasse — {nomeMes}</h2>
            <p className="text-texto-2">
              {organizacao.nome}
              {organizacao.documento ? ` · ${formatarDocumento(organizacao.documento)}` : ""}
            </p>
          </div>
          <div className="text-right">
            <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-mudo">Proprietário</div>
            <div className="font-medium">{pessoa.nome}</div>
            {pessoa.documento && <div className="text-xs text-mudo">{formatarDocumento(pessoa.documento)}</div>}
          </div>
        </header>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="text-left font-mono text-[10px] uppercase tracking-[0.12em] text-mudo">
                <th className="py-2 pr-2">Imóvel / contrato</th>
                <th className="px-2 py-2 text-right">Aluguel</th>
                <th className="px-2 py-2 text-right">Encargos e multa</th>
                <th className="px-2 py-2 text-right">Taxas</th>
                <th className="px-2 py-2 text-right">Impostos</th>
                <th className="px-2 py-2 text-right">Descontos</th>
                <th className="px-2 py-2 text-right">Líquido</th>
                <th className="py-2 pl-2">Situação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-borda-suave">
              {repasses.map((r) => {
                const sit = situacaoRepasse(r, hoje);
                return (
                  <tr key={r.id}>
                    <td className="py-2 pr-2">
                      <Link href={`/repasses/${r.id}`} className="font-medium hover:underline">
                        {r.contrato.imovel.codigo}
                      </Link>{" "}
                      <span className="text-xs text-mudo">
                        #{r.contrato.numero}
                        {r.contrato.imovel.logradouro ? ` · ${[r.contrato.imovel.logradouro, r.contrato.imovel.numero].filter(Boolean).join(", ")}` : ""}
                      </span>
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">{formatarReais(r.aluguel)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{formatarReais(Number(r.encargos) + Number(r.multa_juros))}</td>
                    <td className="px-2 py-2 text-right tabular-nums">−{formatarReais(Number(r.taxa_administracao) + Number(r.taxa_intermediacao))}</td>
                    <td className="px-2 py-2 text-right tabular-nums">−{formatarReais(Number(r.irrf) + Number(r.imposto ?? 0))}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{Number(r.outros_descontos) ? `−${formatarReais(r.outros_descontos)}` : "—"}</td>
                    <td className="px-2 py-2 text-right font-semibold tabular-nums">{formatarReais(r.valor_liquido)}</td>
                    <td className="py-2 pl-2">
                      <Selo cor={COR_SITUACAO_REPASSE[sit]}>{ROTULO_SITUACAO_REPASSE[sit]}</Selo>
                      {r.pago_em && <span className="block text-xs text-mudo">{formatarDataBR(r.pago_em)}</span>}
                    </td>
                  </tr>
                );
              })}
              {repasses.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-6 text-center text-mudo">
                    Nenhum repasse deste proprietário com competência {formatarCompetencia(competencia)}.
                  </td>
                </tr>
              )}
              {repasses.length > 0 && (
                <tr className="font-semibold">
                  <td className="py-2 pr-2">Total</td>
                  <td className="px-2 py-2 text-right tabular-nums">{formatarReais(t.aluguel)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{formatarReais(t.encargos + t.multaJuros)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">−{formatarReais(t.taxas)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">−{formatarReais(t.impostos)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{t.descontos ? `−${formatarReais(t.descontos)}` : "—"}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{formatarReais(t.liquido)}</td>
                  <td className="py-2 pl-2" />
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {(descontos ?? []).length > 0 && (
          <section>
            <h3 className="mb-2 text-[15px] font-semibold">Despesas e descontos</h3>
            <ul className="divide-y divide-borda-suave">
              {(descontos ?? []).map((d, i) => (
                <li key={i} className="flex justify-between gap-3 py-1.5">
                  <span>
                    {d.descricao} <span className="text-xs text-mudo">({d.tipo === "despesa" ? "despesa paga pela imobiliária" : "desconto"})</span>
                  </span>
                  <span className="tabular-nums">−{formatarReais(d.valor)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
        <div className="grid gap-2 rounded-[14px] border border-borda bg-elev p-4 sm:grid-cols-3">
          <div>
            <div className="text-xs text-mudo">Líquido do mês</div>
            <div className="text-[20px] font-semibold tabular-nums">{formatarReais(t.liquido)}</div>
          </div>
          <div>
            <div className="text-xs text-mudo">Já repassado</div>
            <div className="text-[20px] font-semibold tabular-nums text-ok">{formatarReais(t.pago)}</div>
          </div>
          <div>
            <div className="text-xs text-mudo">A repassar</div>
            <div className="text-[20px] font-semibold tabular-nums text-alerta">{formatarReais(t.aPagar)}</div>
          </div>
        </div>
        <p className="text-xs text-mudo">
          Taxas = administração e intermediação da imobiliária. Impostos = IRRF retido pelo locatário pessoa jurídica e imposto do proprietário descontado no repasse. Emitido em{" "}
          {formatarDataBR(hoje)}.
        </p>
      </article>
    </>
  );
}
