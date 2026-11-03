import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Aviso } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { identificacaoImovel } from "@/lib/dominio/cobrancas";
import { formatarCompetencia, formatarDataBR } from "@/lib/dominio/datas";
import { formatarReais } from "@/lib/dominio/dinheiro";
import { formatarDocumento } from "@/lib/dominio/documentos";
import { reaisPorExtenso } from "@/lib/dominio/modelos";
import { carregarFicha } from "../../ficha";

export const metadata: Metadata = { title: "Recibo de aluguel" };

const FORMA: Record<string, string> = { boleto: "boleto", pix: "Pix", transferencia: "transferência", dinheiro: "dinheiro", cartao: "cartão", outro: "outro meio" };

/** Recibo de aluguel pago, com todos os locatários, o imóvel (código e endereço) e os itens (multa e juros separados). */
export default async function ReciboFatura({ params }: PageProps<"/faturas/[id]/recibo">) {
  const { id } = await params;
  const ficha = await carregarFicha(id);
  if (!ficha) notFound();
  const { organizacao } = await obterContexto();
  const { fatura: f, dados, itens } = ficha;
  const { contrato: c, imovel, partes } = dados;
  const locatarios = partes.filter((p) => p.papel === "locatario").map((p) => p.pessoa);
  const valor = Number(f.valor_pago ?? f.valor_total);
  const pessoal = organizacao.modo === "pessoal";

  if (f.status !== "paga")
    return (
      <div className="mx-auto max-w-2xl">
        <Aviso tipo="alerta">Esta cobrança ainda não foi quitada — o recibo fica disponível depois que o saldo for pago.</Aviso>
      </div>
    );

  return (
    <div className="mx-auto max-w-2xl">
      <article className="space-y-4 rounded-card border border-borda bg-card p-10 text-[15px] leading-relaxed text-texto print:border-0 print:p-0">
        <div className="flex items-start justify-between gap-4">
          <h1 className="text-lg font-bold uppercase">Recibo de aluguel</h1>
          <div className="text-right text-xl font-bold tabular-nums">{formatarReais(valor)}</div>
        </div>
        <p>
          Recebi(emos) de <strong>{locatarios.map((l) => l.nome).join(" e ") || "locatário"}</strong>
          {locatarios[0]?.documento ? `, CPF/CNPJ ${formatarDocumento(locatarios[0].documento)}` : ""}, a importância de <strong>{formatarReais(valor)}</strong>
 ({reaisPorExtenso(valor)}), referente ao aluguel e encargos de <strong>{formatarCompetencia(f.competencia)}</strong>
          {f.periodo_inicio && f.periodo_fim ? ` (período de ${formatarDataBR(f.periodo_inicio)} a ${formatarDataBR(f.periodo_fim)})` : ""} do imóvel{" "}
          <strong>{identificacaoImovel(imovel)}</strong>, contrato nº {c.numero}, quitado em {formatarDataBR(f.pago_em)}
          {f.forma_pagamento ? ` por ${FORMA[f.forma_pagamento] ?? f.forma_pagamento}` : ""}.
        </p>
        <table className="w-full text-sm">
          <tbody>
            {itens.map((i) => (
              <tr key={i.id} className="border-b border-borda-suave">
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
        {ficha.pagamentos.length > 1 && (
          <p className="text-sm text-texto-2">
            Pago em {ficha.pagamentos.length} vezes: {ficha.pagamentos.map((p) => `${formatarDataBR(p.pago_em)} (${formatarReais(p.valor)})`).join(", ")}.
          </p>
        )}
        <p className="text-sm">Dou(damos) plena quitação do valor acima, ressalvados débitos anteriores não incluídos neste recibo.</p>
        <p className="pt-6">
          {imovel.cidade ?? "________"}, {formatarDataBR(f.pago_em)}.
        </p>
        <div className="mx-auto w-72 border-t border-texto pt-2 text-center text-sm">
          {organizacao.nome}
          {pessoal ? <span className="block text-xs">Locador</span> : null}
          {organizacao.documento ? <span className="block text-xs">CPF/CNPJ {formatarDocumento(organizacao.documento)}</span> : null}
        </div>
      </article>
    </div>
  );
}
