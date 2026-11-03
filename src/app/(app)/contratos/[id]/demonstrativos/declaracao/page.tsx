import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BotaoImprimir } from "@/components/formulario";
import { obterContexto } from "@/lib/contexto";
import { formatarCompetencia, formatarDataBR, hojeISO } from "@/lib/dominio/datas";
import { formatarReais } from "@/lib/dominio/dinheiro";
import { formatarDocumento } from "@/lib/dominio/documentos";
import { carregarContrato } from "@/lib/servicos/locacao";

export const metadata: Metadata = { title: "Declaração de quitação" };

/** Declaração anual de quitação de aluguéis (Lei 12.007/2009, por analogia) para o locatário. */
export default async function DeclaracaoQuitacao({ params, searchParams }: PageProps<"/contratos/[id]/demonstrativos/declaracao">) {
  const { id } = await params;
  const sp = await searchParams;
  const ano = typeof sp.ano === "string" && /^\d{4}$/.test(sp.ano) ? sp.ano : String(new Date().getFullYear() - 1);
  const { supabase, organizacao } = await obterContexto();
  const dados = await carregarContrato(supabase, id);
  if (!dados) notFound();
  const { contrato: c, imovel, partes } = dados;
  const { data } = await supabase
    .from("faturas")
    .select("competencia, pago_em, valor_pago, valor_total, status")
    .eq("contrato_id", id)
    .gte("competencia", `${ano}-01-01`)
    .lte("competencia", `${ano}-12-01`)
    .neq("status", "cancelada")
    .order("competencia");
  const faturas = data ?? [];
  const pagas = faturas.filter((f) => f.status === "paga");
  const abertas = faturas.filter((f) => f.status === "aberta");
  const total = pagas.reduce((s, f) => s + Number(f.valor_pago ?? f.valor_total), 0);
  const locatarios = partes.filter((p) => p.papel === "locatario").map((p) => p.pessoa);
  const endereco = [imovel.logradouro, imovel.numero, imovel.complemento, imovel.bairro, imovel.cidade, imovel.uf].filter(Boolean).join(", ");

  return (
    <div className="mx-auto max-w-3xl">
      <div className="nao-imprimir mb-4 flex justify-end">
        <BotaoImprimir />
      </div>
      <article className="space-y-4 rounded-xl border border-borda bg-card p-10 text-[15px] leading-relaxed text-texto print:border-0 print:p-0">
        <h1 className="text-center text-lg font-bold uppercase">Declaração anual de pagamento de aluguéis — {ano}</h1>
        <p>
          {organizacao.nome}
          {organizacao.documento ? `, CPF/CNPJ ${formatarDocumento(organizacao.documento)}` : ""}, declara que{" "}
          {locatarios.map((l) => `${l.nome}${l.documento ? ` (CPF/CNPJ ${formatarDocumento(l.documento)})` : ""}`).join(" e ")}, locatário(s) do imóvel situado em {endereco} (contrato nº {c.numero}),
          {abertas.length === 0 ? " quitou" : " pagou"} os aluguéis e encargos de {ano} abaixo, no total de <strong>{formatarReais(total)}</strong>.
        </p>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-borda text-left">
              <th className="py-1">Competência</th>
              <th className="py-1">Pago em</th>
              <th className="py-1 text-right">Valor</th>
            </tr>
          </thead>
          <tbody>
            {pagas.map((f) => (
              <tr key={f.competencia} className="border-b border-borda-suave">
                <td className="py-1">{formatarCompetencia(f.competencia)}</td>
                <td className="py-1">{formatarDataBR(f.pago_em)}</td>
                <td className="py-1 text-right tabular-nums">{formatarReais(f.valor_pago ?? f.valor_total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {abertas.length > 0 ? (
          <p className="text-sm">Ficam ressalvadas as competências ainda em aberto: {abertas.map((f) => formatarCompetencia(f.competencia)).join(", ")}.</p>
        ) : (
          <p className="text-sm">Não há débitos de aluguel referentes a {ano}.</p>
        )}
        <p className="pt-6">
          {imovel.cidade ?? "________"}, {formatarDataBR(hojeISO())}.
        </p>
        <div className="mx-auto w-72 border-t border-texto pt-2 text-center text-sm">{organizacao.nome}</div>
      </article>
    </div>
  );
}
