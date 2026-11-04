import type { Metadata } from "next";
import { FiltroAutomatico } from "@/components/filtro-automatico";
import { BotaoImprimir } from "@/components/formulario";
import { Cabecalho, Entrada, Selecao } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { hojeISO } from "@/lib/dominio/datas";
import { informeRendimentos, type LinhaInforme } from "@/lib/dominio/portal";
import { todas } from "../../financeiro/dados";
import { AbasPortais } from "../abas";
import { DocumentoInforme } from "../informe";

export const metadata: Metadata = { title: "Informe de rendimentos" };

type Linha = {
  id: string;
  competencia: string;
  status: string;
  pago_em: string | null;
  aluguel: number;
  encargos: number;
  multa_juros: number;
  taxa_administracao: number;
  taxa_intermediacao: number;
  irrf: number;
  imposto: number;
  outros_descontos: number;
  valor_liquido: number;
  fatura: { status: string; pago_em: string | null } | null;
  contrato: {
    numero: number;
    imovel: { codigo: string; logradouro: string | null; numero: string | null; bairro: string | null; cidade: string | null } | null;
    contrato_partes: { papel: string; pessoa: { nome: string; documento: string | null } | null }[];
  } | null;
};

/**
 * Informe de rendimentos anual por proprietário (mesma conta do portal do
 * proprietário — src/lib/dominio/portal.ts): aluguéis recebidos no ano (pela
 * data do pagamento), taxas, IRRF e repasses líquidos, por mês e por imóvel.
 */
export default async function InformesPage({ searchParams }: PageProps<"/portais/informes">) {
  const sp = await searchParams;
  const pessoaId = typeof sp.pessoa === "string" ? sp.pessoa : "";
  const ano = typeof sp.ano === "string" && /^\d{4}$/.test(sp.ano) ? Number(sp.ano) : Number(hojeISO().slice(0, 4)) - 1;
  const { supabase, organizacao } = await obterContexto();
  const { data: donos } = await supabase.from("pessoas").select("id, nome").contains("papeis", ["proprietario"]).order("nome").limit(5000);

  let pessoa: { nome: string; documento: string | null } | null = null;
  let linhas: LinhaInforme[] = [];
  if (pessoaId) {
    pessoa = (await supabase.from("pessoas").select("nome, documento").eq("id", pessoaId).maybeSingle()).data;
    // Pagamento no ano pode ser de competência de anos anteriores (atraso) ou do seguinte (antecipado).
    const dados = await todas<Linha>(() =>
      supabase
        .from("repasses")
        .select(
          "id, competencia, status, pago_em, aluguel, encargos, multa_juros, taxa_administracao, taxa_intermediacao, irrf, imposto, outros_descontos, valor_liquido, fatura:faturas(status, pago_em), contrato:contratos(numero, imovel:imoveis(codigo, logradouro, numero, bairro, cidade), contrato_partes(papel, pessoa:pessoas(nome, documento)))",
        )
        .eq("pessoa_id", pessoaId)
        .neq("status", "cancelado")
        .gte("competencia", `${ano - 3}-01-01`)
        .lte("competencia", `${ano + 1}-02-01`)
        .order("id"),
    );
    linhas = dados.map((r) => {
      const loc = r.contrato?.contrato_partes.find((p) => p.papel === "locatario")?.pessoa ?? null;
      const im = r.contrato?.imovel;
      return {
        competencia: r.competencia,
        faturaPagoEm: r.fatura?.pago_em ?? null,
        faturaPaga: r.fatura?.status === "paga",
        repassePagoEm: r.pago_em,
        status: r.status,
        imovel: im?.codigo ?? "—",
        endereco: im ? [[im.logradouro, im.numero].filter(Boolean).join(", "), im.bairro, im.cidade].filter(Boolean).join(", ") || null : null,
        contrato: r.contrato?.numero ?? null,
        locatarioNome: loc?.nome ?? null,
        locatarioDocumento: loc?.documento ?? null,
        aluguel: r.aluguel,
        encargos: r.encargos,
        multaJuros: r.multa_juros,
        taxaAdministracao: r.taxa_administracao,
        taxaIntermediacao: r.taxa_intermediacao,
        irrf: r.irrf,
        imposto: r.imposto,
        outrosDescontos: r.outros_descontos,
        liquido: r.valor_liquido,
      };
    });
  }

  return (
    <>
      <div className="nao-imprimir">
        <Cabecalho
          titulo="Informe de rendimentos"
          trilha="Portal de clientes"
          descricao="Aluguéis recebidos no ano por proprietário, para o Imposto de Renda. É o mesmo informe que o proprietário vê no portal."
          acoes={pessoa ? <BotaoImprimir /> : undefined}
        />
        <AbasPortais modo={organizacao.modo} />
        <FiltroAutomatico className="barra-filtros mb-5 flex flex-wrap gap-2">
          <Selecao name="pessoa" defaultValue={pessoaId} className="max-w-xs" aria-label="Proprietário">
            <option value="">Escolha o proprietário…</option>
            {(donos ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.nome}
              </option>
            ))}
          </Selecao>
          <Entrada type="number" name="ano" defaultValue={ano} min={2000} max={2100} className="w-28" aria-label="Ano" />
        </FiltroAutomatico>
      </div>
      {pessoa ? (
        <DocumentoInforme informe={informeRendimentos(linhas, ano)} organizacao={{ nome: organizacao.nome, documento: organizacao.documento }} beneficiario={pessoa} />
      ) : (
        <div className="rounded-card border border-borda bg-card p-8 text-center text-sm text-mudo">Escolha o proprietário e o ano.</div>
      )}
    </>
  );
}
