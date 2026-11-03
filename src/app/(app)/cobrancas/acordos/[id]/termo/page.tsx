import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BotaoImprimir } from "@/components/formulario";
import { obterContexto } from "@/lib/contexto";
import { identificacaoImovel, type ImovelEndereco } from "@/lib/dominio/cobrancas";
import { formatarCompetencia, formatarDataBR } from "@/lib/dominio/datas";
import { formatarReais } from "@/lib/dominio/dinheiro";
import { formatarDocumento } from "@/lib/dominio/documentos";
import { reaisPorExtenso } from "@/lib/dominio/modelos";
import { configCobranca } from "../../../dados";

export const metadata: Metadata = { title: "Termo de acordo" };

/** Termo de confissão de dívida e acordo de parcelamento, para imprimir e assinar. */
export default async function TermoAcordo({ params }: PageProps<"/cobrancas/acordos/[id]/termo">) {
  const { id } = await params;
  const { supabase, organizacao } = await obterContexto();
  const cfg = configCobranca(organizacao);
  const pessoal = organizacao.modo === "pessoal";
  const [{ data }, { data: parcelas }, { data: faturas }] = await Promise.all([
    supabase
      .from("acordos")
      .select("*, contrato:contratos(numero, imovel:imoveis(codigo, logradouro, numero, complemento, bairro, cidade, uf)), pessoa:pessoas(nome, documento, logradouro, numero, cidade, uf)")
      .eq("id", id)
      .maybeSingle(),
    supabase.from("acordo_parcelas").select("numero, vencimento, valor, status").eq("acordo_id", id).order("numero"),
    supabase.from("acordo_faturas").select("principal, multa, juros, desconto, total, fatura:faturas(competencia, vencimento)").eq("acordo_id", id),
  ]);
  if (!data) notFound();
  const a = data as unknown as {
    numero: number;
    data: string;
    total: number;
    desconto: number;
    principal: number;
    multa: number;
    juros: number;
    condicoes: string | null;
    contrato: { numero: number; imovel: ImovelEndereco | null } | null;
    pessoa: { nome: string; documento: string | null; logradouro: string | null; numero: string | null; cidade: string | null; uf: string | null } | null;
  };
  const fs = ((faturas ?? []) as unknown as { principal: number; multa: number; juros: number; desconto: number; total: number; fatura: { competencia: string; vencimento: string } | null }[]).sort((x, y) =>
    (x.fatura?.vencimento ?? "").localeCompare(y.fatura?.vencimento ?? ""),
  );
  const ps = (parcelas ?? []).filter((p) => p.status !== "cancelada");
  const cidade = a.contrato?.imovel?.cidade ?? "________";

  return (
    <div className="mx-auto max-w-3xl">
      <div className="nao-imprimir mb-4 flex justify-between">
        <Link href={`/cobrancas/acordos/${id}`} className="text-sm text-acento hover:underline">
          ← voltar ao acordo
        </Link>
        <BotaoImprimir />
      </div>
      <article className="space-y-4 rounded-card border border-borda bg-card p-10 text-[14.5px] leading-relaxed text-texto print:border-0 print:p-0">
        <h1 className="text-center text-lg font-bold uppercase">Termo de confissão de dívida e acordo de parcelamento nº {a.numero}</h1>
        <p>
          <strong>CREDOR{pessoal ? " (LOCADOR)" : ""}:</strong> {organizacao.nome}
          {organizacao.documento ? `, CPF/CNPJ ${formatarDocumento(organizacao.documento)}` : ""}
          {!pessoal ? ", na qualidade de administradora do imóvel e em nome do(s) proprietário(s)" : ""}.
        </p>
        <p>
          <strong>DEVEDOR (LOCATÁRIO):</strong> {a.pessoa?.nome ?? "________________"}
          {a.pessoa?.documento ? `, CPF/CNPJ ${formatarDocumento(a.pessoa.documento)}` : ""}
          {a.pessoa?.logradouro ? `, residente em ${[a.pessoa.logradouro, a.pessoa.numero, a.pessoa.cidade, a.pessoa.uf].filter(Boolean).join(", ")}` : ""}.
        </p>
        <p>
          <strong>1. Da dívida.</strong> O DEVEDOR reconhece e confessa dever ao CREDOR os valores abaixo, referentes ao contrato de locação nº {a.contrato?.numero ?? "—"} do imóvel{" "}
          {identificacaoImovel(a.contrato?.imovel)}:
        </p>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-borda text-left text-xs uppercase text-mudo">
              <th className="py-1">Aluguel de</th>
              <th className="py-1 text-right">Aluguel</th>
              <th className="py-1 text-right">Multa</th>
              <th className="py-1 text-right">Juros</th>
            </tr>
          </thead>
          <tbody>
            {fs.map((f, i) => (
              <tr key={i} className="border-b border-borda-suave">
                <td className="py-1">
                  {formatarCompetencia(f.fatura?.competencia)} (venc. {formatarDataBR(f.fatura?.vencimento)})
                </td>
                <td className="py-1 text-right tabular-nums">{formatarReais(f.principal)}</td>
                <td className="py-1 text-right tabular-nums">{formatarReais(f.multa)}</td>
                <td className="py-1 text-right tabular-nums">{formatarReais(f.juros)}</td>
              </tr>
            ))}
            <tr className="font-semibold">
              <td className="py-1">Soma</td>
              <td className="py-1 text-right tabular-nums">{formatarReais(a.principal)}</td>
              <td className="py-1 text-right tabular-nums">{formatarReais(a.multa)}</td>
              <td className="py-1 text-right tabular-nums">{formatarReais(a.juros)}</td>
            </tr>
          </tbody>
        </table>
        <p>
          <strong>2. Do acordo.</strong> {Number(a.desconto) > 0 ? `Com desconto de ${formatarReais(a.desconto)}, as` : "As"} partes ajustam o pagamento de{" "}
          <strong>
            {formatarReais(a.total)} ({reaisPorExtenso(Number(a.total))})
          </strong>
          , assim:
        </p>
        <ul className="list-disc pl-6">
          {ps.map((p) => (
            <li key={p.numero}>
              {p.numero === 0 ? "Entrada" : `${p.numero}ª parcela`} de {formatarReais(p.valor)}, com vencimento em {formatarDataBR(p.vencimento)};
            </li>
          ))}
        </ul>
        <p>
          <strong>3. Do pagamento.</strong> Os pagamentos serão feitos{cfg.meios.includes("pix") && cfg.pixChave ? ` por Pix (chave ${cfg.pixChave})` : ""} ou pelo meio indicado pelo CREDOR, valendo como prova o comprovante bancário ou o recibo.
        </p>
        <p>
          <strong>4. Do descumprimento.</strong> O atraso de qualquer parcela por mais de {cfg.quebraDias} dias quebra este acordo: o desconto concedido perde o efeito, o saldo ainda não pago vence de imediato e volta a ser cobrado com a multa e os juros previstos no contrato de locação, podendo o CREDOR promover a cobrança judicial.
        </p>
        <p>
          <strong>5.</strong> Este acordo não altera as demais obrigações do contrato de locação, inclusive os aluguéis e encargos que vencerem a partir de hoje.
        </p>
        {a.condicoes && (
          <p className="whitespace-pre-line">
            <strong>6. Condições combinadas.</strong> {a.condicoes}
          </p>
        )}
        <p>Por estarem de acordo, assinam este termo em duas vias, com duas testemunhas.</p>
        <p className="pt-4">
          {cidade}, {formatarDataBR(a.data)}.
        </p>
        <div className="grid grid-cols-1 gap-10 pt-10 sm:grid-cols-2">
          {[
            [a.pessoa?.nome ?? "Devedor", "Devedor (locatário)"],
            [organizacao.nome, pessoal ? "Credor (locador)" : "Credor"],
            ["", "Testemunha 1 — nome e CPF"],
            ["", "Testemunha 2 — nome e CPF"],
          ].map(([nome, papel], i) => (
            <div key={i} className="border-t border-texto pt-2 text-center text-sm">
              {nome}
              <span className="block text-xs text-mudo">{papel}</span>
            </div>
          ))}
        </div>
      </article>
    </div>
  );
}
