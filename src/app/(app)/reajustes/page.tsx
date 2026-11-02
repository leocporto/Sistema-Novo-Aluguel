import type { Metadata } from "next";
import Link from "next/link";
import { Cabecalho, Celula, LinhaVazia, Selo, Tabela } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { diasEntre, formatarDataBR, hojeISO } from "@/lib/dominio/datas";
import { formatarReais, paraReais } from "@/lib/dominio/dinheiro";
import { calcularReajuste, proximoReajuste } from "@/lib/dominio/reajuste";
import { paraCentavos } from "@/lib/dominio/dinheiro";
import type { Contrato } from "@/lib/tipos";

export const metadata: Metadata = { title: "Reajustes" };

export default async function ReajustesPage() {
  const { supabase } = await obterContexto();
  const hoje = hojeISO();
  const [{ data: contratos }, { data: indices }] = await Promise.all([
    supabase.from("contratos").select("*, imovel:imoveis(codigo)").eq("status", "ativo"),
    supabase.from("indices_economicos").select("indice, competencia, variacao_pct"),
  ]);
  const lista = ((contratos ?? []) as (Contrato & { imovel: { codigo: string } })[])
    .map((c) => {
      const data = proximoReajuste(c.data_base_reajuste, c.periodicidade_reajuste_meses);
      const r = calcularReajuste({
        valorAtual: paraCentavos(c.valor_aluguel),
        dataReajuste: data,
        periodicidadeMeses: c.periodicidade_reajuste_meses,
        variacoes: (indices ?? [])
          .filter((i) => i.indice === c.indice_reajuste)
          .map((i) => ({ competencia: i.competencia, variacaoPct: Number(i.variacao_pct) })),
      });
      return { c, data, r, dias: diasEntre(hoje, data) };
    })
    .filter((x) => x.dias <= 60)
    .sort((a, b) => a.data.localeCompare(b.data));

  return (
    <>
      <Cabecalho
        titulo="Reajustes"
        descricao="Contratos com aniversário de reajuste vencido ou nos próximos 60 dias. Aplique o reajuste na página do contrato."
      />
      <Tabela colunas={["Contrato", "Data do reajuste", "Índice", "Acumulado", "Aluguel atual", "Novo aluguel", "Situação"]}>
        {lista.length === 0 && <LinhaVazia colunas={7}>Nenhum reajuste nos próximos 60 dias.</LinhaVazia>}
        {lista.map(({ c, data, r, dias }) => (
          <tr key={c.id}>
            <Celula>
              <Link href={`/contratos/${c.id}`} className="font-medium text-acento hover:underline">
                #{c.numero} · {c.imovel.codigo}
              </Link>
            </Celula>
            <Celula>{formatarDataBR(data)}</Celula>
            <Celula>{c.indice_reajuste}</Celula>
            <Celula>{r.mesesFaltantes.length ? "—" : `${r.percentualAcumulado.toFixed(4)}%`}</Celula>
            <Celula>{formatarReais(c.valor_aluguel)}</Celula>
            <Celula>{r.mesesFaltantes.length ? "—" : formatarReais(paraReais(r.valorNovo))}</Celula>
            <Celula>
              {r.mesesFaltantes.length ? (
                <Link href="/indices">
                  <Selo cor="amarelo">faltam {r.mesesFaltantes.length} índice(s)</Selo>
                </Link>
              ) : dias < 0 ? (
                <Selo cor="vermelho">atrasado {Math.abs(dias)} dias</Selo>
              ) : (
                <Selo cor="azul">em {dias} dias</Selo>
              )}
            </Celula>
          </tr>
        ))}
      </Tabela>
    </>
  );
}
