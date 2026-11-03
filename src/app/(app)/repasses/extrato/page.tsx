import type { Metadata } from "next";
import Link from "next/link";
import { BotaoImprimir } from "@/components/formulario";
import { Aviso, Cabecalho, Celula, Entrada, LinhaVazia, Selecao, Tabela } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { formatarCompetencia, formatarDataBR, hojeISO } from "@/lib/dominio/datas";
import { formatarReais, paraCentavos, paraReais } from "@/lib/dominio/dinheiro";
import { formatarDocumento } from "@/lib/dominio/documentos";
import type { Pessoa, Repasse } from "@/lib/tipos";
import { FiltroAutomatico } from "@/components/filtro-automatico";
import { AbasRepasses } from "../abas";

export const metadata: Metadata = { title: "Extrato do proprietário" };

type Linha = Repasse & { observacoes: string | null; contrato: { numero: number; imovel: { codigo: string; logradouro: string | null; numero: string | null } } };

/** Extrato e informe de rendimentos do proprietário (repasses no período). */
export default async function ExtratoPage({ searchParams }: PageProps<"/repasses/extrato">) {
  const sp = await searchParams;
  const pessoaId = typeof sp.pessoa === "string" ? sp.pessoa : "";
  const ano = typeof sp.ano === "string" && sp.ano ? sp.ano : hojeISO().slice(0, 4);
  const { supabase, organizacao } = await obterContexto();
  const { data: props } = await supabase.from("pessoas").select("id, nome").contains("papeis", ["proprietario"]).order("nome");

  let pessoa: Pessoa | null = null;
  let repasses: Linha[] = [];
  if (pessoaId) {
    pessoa = ((await supabase.from("pessoas").select("*").eq("id", pessoaId).maybeSingle()).data as Pessoa) ?? null;
    const { data } = await supabase
      .from("repasses")
      .select("*, contrato:contratos(numero, imovel:imoveis(codigo, logradouro, numero))")
      .eq("pessoa_id", pessoaId)
      .neq("status", "cancelado")
      .gte("competencia", `${ano}-01-01`)
      .lte("competencia", `${ano}-12-31`)
      .order("competencia");
    repasses = (data ?? []) as unknown as Linha[];
  }
  const tot = (k: keyof Repasse) => paraReais(repasses.reduce((s, r) => s + paraCentavos(r[k] as number | string | null), 0));

  return (
    <>
      <div className="nao-imprimir">
        <Cabecalho titulo="Extrato do proprietário" trilha="Repasses" descricao="Repasses do ano, despesas descontadas e informe de rendimentos de aluguéis." acoes={pessoa ? <BotaoImprimir /> : undefined} />
        <AbasRepasses />
        <FiltroAutomatico className="mb-6 flex flex-wrap gap-2">
          <Selecao name="pessoa" defaultValue={pessoaId} className="max-w-xs" aria-label="Proprietário">
            <option value="">Selecione o proprietário…</option>
            {(props ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.nome}
              </option>
            ))}
          </Selecao>
          <Entrada type="number" name="ano" defaultValue={ano} className="w-28" aria-label="Ano" />
        </FiltroAutomatico>
      </div>
      {pessoa && (
        <div className="space-y-4">
          <div className="rounded-xl border border-borda bg-card p-6 text-sm">
            <div className="flex flex-wrap justify-between gap-2">
              <div>
                <div className="text-xs uppercase text-mudo">Fonte pagadora / administradora</div>
                {organizacao.nome} · {formatarDocumento(organizacao.documento)}
              </div>
              <div>
                <div className="text-xs uppercase text-mudo">Beneficiário</div>
                {pessoa.nome} · {formatarDocumento(pessoa.documento)}
              </div>
              <div>
                <div className="text-xs uppercase text-mudo">Ano-calendário</div>
                {ano}
              </div>
            </div>
          </div>
          <Tabela colunas={["Competência", "Contrato / imóvel", "Aluguel", "Encargos", "Multa/juros", "Taxa adm.", "Intermediação", "IRRF", "Imposto", "Descontos", "Líquido", "Pago em"]}>
            {repasses.length === 0 && <LinhaVazia colunas={12}>Nenhum repasse no ano.</LinhaVazia>}
            {repasses.map((r) => (
              <tr key={r.id}>
                <Celula>{formatarCompetencia(r.competencia)}</Celula>
                <Celula>
                  #{r.contrato.numero} · {r.contrato.imovel.codigo}
                </Celula>
                <Celula>{formatarReais(r.aluguel)}</Celula>
                <Celula>{formatarReais(r.encargos)}</Celula>
                <Celula>{formatarReais(r.multa_juros)}</Celula>
                <Celula>{formatarReais(r.taxa_administracao)}</Celula>
                <Celula>{formatarReais(r.taxa_intermediacao)}</Celula>
                <Celula>{formatarReais(r.irrf)}</Celula>
                <Celula>{formatarReais(r.imposto ?? 0)}</Celula>
                <Celula>
                  {formatarReais(r.outros_descontos ?? 0)}
                  {r.observacoes && <span className="block text-xs text-mudo">{r.observacoes}</span>}
                </Celula>
                <Celula className="font-medium">{formatarReais(r.valor_liquido)}</Celula>
                <Celula>
                  <Link href={`/repasses/${r.id}`} className="text-acento hover:underline">
                    {r.status === "pago" ? formatarDataBR(r.pago_em) : "pendente"}
                  </Link>
                </Celula>
              </tr>
            ))}
            {repasses.length > 0 && (
              <tr className="bg-elev font-semibold">
                <Celula>Total</Celula>
                <Celula />
                <Celula>{formatarReais(tot("aluguel"))}</Celula>
                <Celula>{formatarReais(tot("encargos"))}</Celula>
                <Celula>{formatarReais(tot("multa_juros"))}</Celula>
                <Celula>{formatarReais(tot("taxa_administracao"))}</Celula>
                <Celula>{formatarReais(tot("taxa_intermediacao"))}</Celula>
                <Celula>{formatarReais(tot("irrf"))}</Celula>
                <Celula>{formatarReais(tot("imposto"))}</Celula>
                <Celula>{formatarReais(tot("outros_descontos"))}</Celula>
                <Celula>{formatarReais(tot("valor_liquido"))}</Celula>
                <Celula />
              </tr>
            )}
          </Tabela>
          <Aviso>
            Para a declaração de IR: rendimento bruto de aluguéis {formatarReais(tot("aluguel") + tot("multa_juros"))}; despesas dedutíveis
            (administração e intermediação) {formatarReais(tot("taxa_administracao") + tot("taxa_intermediacao"))}; imposto retido na fonte{" "}
            {formatarReais(tot("irrf"))}; imposto descontado no repasse {formatarReais(tot("imposto"))}. Confirme os valores com seu contador.
          </Aviso>
        </div>
      )}
    </>
  );
}
