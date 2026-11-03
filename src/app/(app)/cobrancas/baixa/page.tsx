import type { Metadata } from "next";
import Link from "next/link";
import { Aviso, Cabecalho, Cartao } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { hojeISO, somarDias } from "@/lib/dominio/datas";
import { AbasCobrancas } from "../abas";
import { contasAtivas, sugerirBaixas } from "../dados";
import { ColarArquivo, ListaBaixas } from "./lista-baixas";

export const metadata: Metadata = { title: "Baixa automática" };

export default async function BaixaAutomaticaPage() {
  const { supabase } = await obterContexto();
  const hoje = hojeISO();
  const [{ data: extrato }, contas] = await Promise.all([
    supabase
      .from("extrato_itens")
      .select("id, data, valor, descricao, documento, conta_id, conta:contas_financeiras(nome)")
      .gt("valor", 0)
      .is("lancamento_id", null)
      .is("fatura_id", null)
      .is("repasse_id", null)
      .eq("ignorado", false)
      .gte("data", somarDias(hoje, -120))
      .order("data")
      .limit(1000),
    contasAtivas(supabase),
  ]);
  const linhas = ((extrato ?? []) as unknown as { id: string; data: string; valor: number; descricao: string; documento: string | null; conta_id: string; conta: { nome: string } | null }[]).map((l) => ({
    id: l.id,
    data: l.data,
    valor: Number(l.valor),
    descricao: [l.descricao, l.documento].filter(Boolean).join(" "),
    extratoItemId: l.id,
    contaId: l.conta_id,
    conta: l.conta?.nome ?? null,
  }));
  const sugestoes = await sugerirBaixas(supabase, hoje, linhas);

  return (
    <>
      <Cabecalho
        titulo="Baixa automática"
        trilha="Cobranças"
        descricao="O sistema procura no extrato do banco (ou num arquivo de retorno) os aluguéis que entraram e dá a baixa de uma vez, já conciliando com a conta."
      />
      <AbasCobrancas />
      <div className="mb-6">
        <Aviso tipo="info">
          Funciona melhor com o Pix gerado aqui: o identificador <strong>FAT</strong> + número da cobrança (ou <strong>AC</strong> + acordo + <strong>P</strong> + parcela, nas
          parcelas de acordo) volta no extrato e o casamento é certeiro. Cada entrada do extrato ou do arquivo dá baixa uma vez só. Baixa sem nenhum clique (aviso do banco na
          hora do Pix ou retorno de boleto registrado) fica pronta para ligar quando houver contrato de cobrança com um banco.
        </Aviso>
      </div>
      <Cartao titulo={`No extrato importado (${sugestoes.length} encontradas em ${linhas.length} entradas sem conciliar)`} className="mb-6">
        {linhas.length === 0 ? (
          <p className="text-sm text-mudo">
            Nenhuma entrada sem conciliar nos últimos 120 dias. Importe o extrato (OFX ou CSV) em{" "}
            <Link href="/financeiro/contas" className="text-acento hover:underline">
              Financeiro → Contas e conciliação
            </Link>
            .
          </p>
        ) : (
          <ListaBaixas sugestoes={sugestoes} origem="extrato" />
        )}
      </Cartao>
      <Cartao titulo="Colar arquivo de retorno ou extrato">
        <ColarArquivo contas={contas.map((c) => ({ id: c.id, nome: c.nome }))} />
      </Cartao>
    </>
  );
}
