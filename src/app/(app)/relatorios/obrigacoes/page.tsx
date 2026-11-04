import type { Metadata } from "next";
import Link from "next/link";
import { Aviso, Cabecalho, Cartao, Entrada, classeBotao } from "@/components/ui";
import { hojeISO } from "@/lib/dominio/datas";
import { AbasRelatorios } from "../abas";

export const metadata: Metadata = { title: "Relatórios · DIMOB e informes" };

export default async function ObrigacoesPage() {
  const anoAnterior = String(Number(hojeISO().slice(0, 4)) - 1);
  return (
    <>
      <Cabecalho titulo="DIMOB e informes" trilha="Relatórios" descricao="Obrigações anuais da imobiliária com a Receita Federal e os proprietários." />
      <AbasRelatorios />
      <div className="grid gap-6 lg:grid-cols-2">
        <Cartao titulo="DIMOB — dados anuais para a Receita Federal">
          <p className="mb-3 text-sm text-texto-2">Planilha por contrato e locador com aluguel bruto, comissão e IR retido mês a mês, a partir dos repasses registrados.</p>
          <form action="/relatorios/dimob" className="flex gap-2">
            <Entrada type="number" name="ano" defaultValue={anoAnterior} className="w-28" aria-label="Ano da DIMOB" />
            <button className={classeBotao()}>Baixar CSV</button>
          </form>
          <div className="mt-3">
            <Aviso tipo="alerta">A exportação no layout oficial do programa da DIMOB está no roadmap. Use esta planilha para conferência e digitação/importação.</Aviso>
          </div>
        </Cartao>
        <Cartao titulo="Informe de rendimentos dos proprietários">
          <p className="mb-3 text-sm text-texto-2">Extrato anual por proprietário, com aluguéis, taxas dedutíveis e IRRF, pronto para imprimir.</p>
          <Link href="/repasses/extrato" className={classeBotao("secundario")}>
            Abrir extratos
          </Link>
        </Cartao>
      </div>
    </>
  );
}
