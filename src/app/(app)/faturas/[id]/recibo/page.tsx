import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BotaoImprimir } from "@/components/formulario";
import { Aviso } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { formatarCompetencia, formatarDataBR } from "@/lib/dominio/datas";
import { formatarReais } from "@/lib/dominio/dinheiro";
import { formatarDocumento } from "@/lib/dominio/documentos";
import { carregarContrato } from "@/lib/servicos/locacao";

export const metadata: Metadata = { title: "Recibo de aluguel" };

const FORMA: Record<string, string> = { boleto: "boleto", pix: "Pix", transferencia: "transferência", dinheiro: "dinheiro", cartao: "cartão", outro: "outro meio" };

/** Recibo de aluguel pago, com todos os locatários e os itens da fatura. */
export default async function ReciboFatura({ params }: PageProps<"/faturas/[id]/recibo">) {
  const { id } = await params;
  const { supabase, organizacao } = await obterContexto();
  const [{ data: f }, { data: itens }] = await Promise.all([
    supabase.from("faturas").select("*").eq("id", id).maybeSingle(),
    supabase.from("fatura_itens").select("descricao, valor, tipo").eq("fatura_id", id),
  ]);
  if (!f) notFound();
  const dados = await carregarContrato(supabase, f.contrato_id);
  if (!dados) notFound();
  const { contrato: c, imovel, partes } = dados;
  const locatarios = partes.filter((p) => p.papel === "locatario").map((p) => p.pessoa);
  const endereco = [imovel.logradouro, imovel.numero, imovel.complemento, imovel.bairro, imovel.cidade, imovel.uf].filter(Boolean).join(", ");
  const valor = Number(f.valor_pago ?? f.valor_total);

  if (f.status !== "paga")
    return (
      <div className="mx-auto max-w-2xl">
        <Aviso tipo="alerta">Esta fatura ainda não foi paga — o recibo fica disponível depois da baixa.</Aviso>
      </div>
    );

  return (
    <div className="mx-auto max-w-2xl">
      <div className="nao-imprimir mb-4 flex justify-end">
        <BotaoImprimir />
      </div>
      <article className="space-y-4 rounded-xl border border-borda bg-card p-10 text-[15px] leading-relaxed text-texto print:border-0 print:p-0">
        <div className="flex items-start justify-between gap-4">
          <h1 className="text-lg font-bold uppercase">Recibo de aluguel</h1>
          <div className="text-right text-xl font-bold tabular-nums">{formatarReais(valor)}</div>
        </div>
        <p>
          Recebi(emos) de <strong>{locatarios.map((l) => l.nome).join(" e ")}</strong>
          {locatarios[0]?.documento ? `, CPF/CNPJ ${formatarDocumento(locatarios[0].documento)}` : ""}, a importância de <strong>{formatarReais(valor)}</strong>, referente ao aluguel e encargos
          de <strong>{formatarCompetencia(f.competencia)}</strong>
          {f.periodo_inicio && f.periodo_fim ? ` (período de ${formatarDataBR(f.periodo_inicio)} a ${formatarDataBR(f.periodo_fim)})` : ""} do imóvel situado em {endereco}, contrato nº {c.numero}, pago em{" "}
          {formatarDataBR(f.pago_em)}
          {f.forma_pagamento ? ` por ${FORMA[f.forma_pagamento] ?? f.forma_pagamento}` : ""}.
        </p>
        <table className="w-full text-sm">
          <tbody>
            {(itens ?? []).map((i, k) => (
              <tr key={k} className="border-b border-borda-suave">
                <td className="py-1">{i.descricao}</td>
                <td className="py-1 text-right tabular-nums">{formatarReais(i.valor)}</td>
              </tr>
            ))}
            <tr className="font-semibold">
              <td className="py-1">Total pago</td>
              <td className="py-1 text-right tabular-nums">{formatarReais(valor)}</td>
            </tr>
          </tbody>
        </table>
        <p className="text-sm">Dou(damos) plena quitação do valor acima, ressalvados débitos anteriores não incluídos neste recibo.</p>
        <p className="pt-6">
          {imovel.cidade ?? "________"}, {formatarDataBR(f.pago_em)}.
        </p>
        <div className="mx-auto w-72 border-t border-texto pt-2 text-center text-sm">
          {organizacao.nome}
          {organizacao.documento ? <span className="block text-xs">CPF/CNPJ {formatarDocumento(organizacao.documento)}</span> : null}
        </div>
      </article>
    </div>
  );
}
