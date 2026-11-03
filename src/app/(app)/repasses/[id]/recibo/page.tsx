import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BotaoImprimir } from "@/components/formulario";
import { Aviso } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { formatarCompetencia, formatarDataBR } from "@/lib/dominio/datas";
import { formatarReais } from "@/lib/dominio/dinheiro";
import { formatarDocumento } from "@/lib/dominio/documentos";
import { FORMAS_REPASSE } from "@/lib/dominio/repasses";
import { carregarRepasse } from "../../dados";

export const metadata: Metadata = { title: "Recibo de repasse" };

/** Recibo do repasse para o proprietário assinar (ou guardar), com o demonstrativo do cálculo. */
export default async function ReciboRepasse({ params }: PageProps<"/repasses/[id]/recibo">) {
  const { id } = await params;
  const { supabase, organizacao } = await obterContexto();
  const r = await carregarRepasse(supabase, id);
  if (!r) notFound();
  const { data: descontos } = await supabase.from("repasse_descontos").select("descricao, valor").eq("repasse_id", id).order("created_at");
  const im = r.contrato.imovel;
  const endereco = [im.logradouro, im.numero, im.cidade].filter(Boolean).join(", ");
  const linhas: [string, number][] = [
    ["Aluguel recebido (sua parte)", Number(r.aluguel)],
    ["Encargos", Number(r.encargos)],
    ["Multa e juros", Number(r.multa_juros)],
    ["Taxa de administração", -Number(r.taxa_administracao)],
    ["Taxa de intermediação", -Number(r.taxa_intermediacao)],
    ["IRRF retido", -Number(r.irrf)],
    ["Imposto do proprietário", -Number(r.imposto ?? 0)],
    ...((descontos ?? []).map((d) => [d.descricao, -Number(d.valor)]) as [string, number][]),
  ];
  const outros = Number(r.outros_descontos ?? 0) - (descontos ?? []).reduce((s, d) => s + Number(d.valor), 0);
  if (Math.abs(outros) >= 0.01) linhas.push(["Outros descontos", -outros]);

  return (
    <div className="mx-auto max-w-2xl">
      {r.status !== "pago" && (
        <div className="nao-imprimir mb-4">
          <Aviso tipo="alerta">Este repasse ainda não foi pago — o recibo sai como prévia, sem a data do pagamento.</Aviso>
        </div>
      )}
      <div className="nao-imprimir mb-4 flex justify-end">
        <BotaoImprimir />
      </div>
      <article className="space-y-4 rounded-xl border border-borda bg-card p-10 text-[15px] leading-relaxed text-texto print:border-0 print:p-0">
        <div className="flex items-start justify-between gap-4">
          <h1 className="text-lg font-bold uppercase">Recibo de repasse de aluguel</h1>
          <div className="text-right text-xl font-bold tabular-nums">{formatarReais(r.valor_liquido)}</div>
        </div>
        <p>
          Recebi de <strong>{organizacao.nome}</strong>
          {organizacao.documento ? `, CNPJ/CPF ${formatarDocumento(organizacao.documento)}` : ""}, a importância líquida de{" "}
          <strong>{formatarReais(r.valor_liquido)}</strong>, referente ao repasse dos aluguéis de <strong>{formatarCompetencia(r.competencia)}</strong> do imóvel{" "}
          {im.codigo}
          {endereco ? ` (${endereco})` : ""}, contrato nº {r.contrato.numero}, já descontadas as taxas, impostos e despesas abaixo
          {r.status === "pago" ? (
            <>
              , pago em {formatarDataBR(r.pago_em)}
              {r.forma_pagamento ? ` por ${FORMAS_REPASSE[r.forma_pagamento]?.toLowerCase() ?? r.forma_pagamento}` : ""}
            </>
          ) : null}
          .
        </p>
        <table className="w-full text-sm">
          <tbody>
            {linhas
              .filter(([, v]) => Math.abs(v) >= 0.01)
              .map(([rotulo, v], k) => (
                <tr key={k} className="border-b border-borda-suave">
                  <td className="py-1">{rotulo}</td>
                  <td className="py-1 text-right tabular-nums">{formatarReais(v)}</td>
                </tr>
              ))}
            <tr className="font-semibold">
              <td className="py-1">Líquido repassado</td>
              <td className="py-1 text-right tabular-nums">{formatarReais(r.valor_liquido)}</td>
            </tr>
          </tbody>
        </table>
        {r.comprovante && <p className="text-sm">Comprovante / identificação da transferência: {r.comprovante}</p>}
        <p className="text-sm">Dou plena quitação do valor acima referente à competência indicada.</p>
        <p className="pt-6">
          {im.cidade ?? "________"}, {r.status === "pago" ? formatarDataBR(r.pago_em) : "____/____/______"}.
        </p>
        <div className="mx-auto w-72 border-t border-texto pt-2 text-center text-sm">
          {r.pessoa.nome}
          {r.pessoa.documento ? <span className="block text-xs">CPF/CNPJ {formatarDocumento(r.pessoa.documento)}</span> : null}
        </div>
      </article>
    </div>
  );
}
