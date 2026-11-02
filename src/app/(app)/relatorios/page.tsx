import type { Metadata } from "next";
import Link from "next/link";
import { Aviso, Cabecalho, Cartao, Celula, Entrada, LinhaVazia, Tabela, classeBotao } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { diasEntre, formatarCompetencia, formatarDataBR, hojeISO } from "@/lib/dominio/datas";
import { formatarReais } from "@/lib/dominio/dinheiro";
import { LinhaLink } from "@/components/linha-link";

export const metadata: Metadata = { title: "Relatórios" };

type Inad = {
  id: string;
  numero: number;
  competencia: string;
  vencimento: string;
  valor_total: number;
  contrato: { id: string; numero: number; imovel: { codigo: string }; contrato_partes: { papel: string; pessoa: { nome: string; telefone: string | null } }[] };
};

export default async function RelatoriosPage() {
  const { supabase } = await obterContexto();
  const hoje = hojeISO();
  const anoAnterior = String(Number(hoje.slice(0, 4)) - 1);
  const { data } = await supabase
    .from("faturas")
    .select("id, numero, competencia, vencimento, valor_total, contrato:contratos(id, numero, imovel:imoveis(codigo), contrato_partes(papel, pessoa:pessoas(nome, telefone)))")
    .eq("status", "aberta")
    .lt("vencimento", hoje)
    .order("vencimento");
  const inad = (data ?? []) as unknown as Inad[];
  const total = inad.reduce((s, f) => s + Number(f.valor_total), 0);

  return (
    <>
      <Cabecalho titulo="Relatórios e obrigações" />
      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <Cartao titulo="DIMOB — dados anuais para a Receita Federal">
          <p className="mb-3 text-sm text-texto-2">
            Planilha por contrato e locador com aluguel bruto, comissão e IR retido mês a mês, a partir dos repasses registrados.
          </p>
          <form action="/relatorios/dimob" className="flex gap-2">
            <Entrada type="number" name="ano" defaultValue={anoAnterior} className="w-28" />
            <button className={classeBotao()}>Baixar CSV</button>
          </form>
          <div className="mt-3">
            <Aviso tipo="alerta">
              A exportação no layout oficial do programa da DIMOB está no roadmap. Use esta planilha para conferência e digitação/importação.
            </Aviso>
          </div>
        </Cartao>
        <Cartao titulo="Informe de rendimentos dos proprietários">
          <p className="mb-3 text-sm text-texto-2">Extrato anual por proprietário, com aluguéis, taxas dedutíveis e IRRF, pronto para imprimir.</p>
          <Link href="/repasses/extrato" className={classeBotao("secundario")}>
            Abrir extratos
          </Link>
        </Cartao>
      </div>

      <Cartao titulo={`Inadimplência — ${inad.length} fatura(s), ${formatarReais(total)}`}>
        <Tabela colunas={["Fatura", "Contrato", "Locatário", "Competência", "Vencimento", "Dias", "Valor"]}>
          {inad.length === 0 && <LinhaVazia colunas={7}>Nenhuma fatura em atraso. 🎉</LinhaVazia>}
          {inad.map((f) => {
            const loc = f.contrato.contrato_partes.find((p) => p.papel === "locatario")?.pessoa;
            return (
              <LinhaLink href={`/faturas/${f.id}`} key={f.id}>
                <Celula>
                  <Link className="text-acento hover:underline" href={`/faturas/${f.id}`}>
                    #{f.numero}
                  </Link>
                </Celula>
                <Celula>
                  <Link className="hover:underline" href={`/contratos/${f.contrato.id}`}>
                    #{f.contrato.numero} · {f.contrato.imovel.codigo}
                  </Link>
                </Celula>
                <Celula>
                  {loc?.nome}
                  <div className="text-xs text-mudo">{loc?.telefone}</div>
                </Celula>
                <Celula>{formatarCompetencia(f.competencia)}</Celula>
                <Celula>{formatarDataBR(f.vencimento)}</Celula>
                <Celula className="text-ruim">{diasEntre(f.vencimento, hoje)}</Celula>
                <Celula>{formatarReais(f.valor_total)}</Celula>
              </LinhaLink>
            );
          })}
        </Tabela>
      </Cartao>
    </>
  );
}
