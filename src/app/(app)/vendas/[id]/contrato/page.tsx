import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BotaoImprimir } from "@/components/formulario";
import { obterContexto } from "@/lib/contexto";
import { formatarDataBR, hojeISO } from "@/lib/dominio/datas";
import { formatarReais } from "@/lib/dominio/dinheiro";
import { formatarDocumento, qualificacao, type DadosQualificacao } from "@/lib/dominio/documentos";
import { ROTULO_FORMA_PAGAMENTO, ROTULO_TIPO_DESPESA, ROTULO_TIPO_PAGAMENTO, comissaoTotal } from "@/lib/dominio/vendas";

export const metadata: Metadata = { title: "Compromisso de compra e venda" };

/**
 * Minuta de compromisso particular de compra e venda montada com os dados da
 * venda. Modelo-base do sistema: revise com a assessoria jurídica antes de assinar.
 */
export default async function ContratoVenda({ params }: PageProps<"/vendas/[id]/contrato">) {
  const { id } = await params;
  const { supabase, organizacao } = await obterContexto();
  const { data } = await supabase
    .from("vendas")
    .select("*, imovel:imoveis(*, imovel_proprietarios(percentual, pessoa:pessoas(*))), comprador:pessoas!vendas_comprador_id_fkey(*)")
    .eq("id", id)
    .maybeSingle();
  if (!data) notFound();
  const [{ data: pags }, { data: desp }] = await Promise.all([
    supabase.from("venda_pagamentos").select("*").eq("venda_id", id).order("vencimento", { nullsFirst: false }),
    supabase.from("venda_despesas").select("*").eq("venda_id", id),
  ]);
  type Im = { codigo: string; tipo: string; logradouro: string | null; numero: string | null; complemento: string | null; bairro: string | null; cidade: string | null; uf: string | null; cep: string | null; matricula: string | null; inscricao_iptu: string | null; area_util: number | null; imovel_proprietarios: { percentual: number; pessoa: DadosQualificacao | null }[] };
  const v = data as unknown as {
    valor: number; forma_pagamento: string; banco: string | null; valor_financiado: number | null; cartorio: string | null; escritura_data: string | null; posse_data: string | null;
    matricula: string | null; comissao_pct: number; comissao_valor: number | null; comprador_nome: string | null; imovel: Im | null; comprador: DadosQualificacao | null;
  };
  const im = v.imovel;
  const vendedores = (im?.imovel_proprietarios ?? []).map((p) => p.pessoa).filter((p): p is DadosQualificacao => !!p);
  const endereco = im ? [im.logradouro, im.numero, im.complemento, im.bairro, im.cidade, im.uf].filter(Boolean).join(", ") : "____";
  const pagamentos = (pags ?? []) as { tipo: string; descricao: string | null; valor: number; vencimento: string | null }[];
  const sinal = pagamentos.filter((p) => p.tipo === "sinal").reduce((s, p) => s + Number(p.valor), 0);
  const despesas = (desp ?? []) as { tipo: string; responsavel: string }[];
  const quemPaga = (tipo: string, padrao: string) => despesas.find((d) => d.tipo === tipo)?.responsavel ?? padrao;
  const QUEM: Record<string, string> = { comprador: "COMPRADOR(ES)", vendedor: "VENDEDOR(ES)", imobiliaria: "INTERVENIENTE" };
  const comissao = comissaoTotal(Number(v.valor), Number(v.comissao_pct), v.comissao_valor == null ? null : Number(v.comissao_valor));
  let n = 0;
  const cl = () => `Cláusula ${++n}ª`;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="nao-imprimir mb-4 flex justify-between gap-3">
        <p className="text-sm text-alerta">Minuta gerada com os dados da venda — revise com a assessoria jurídica antes de assinar.</p>
        <BotaoImprimir />
      </div>
      <article className="space-y-4 rounded-xl border border-borda bg-card p-10 text-[15px] leading-relaxed text-texto print:border-0 print:p-0">
        <h1 className="text-center text-lg font-bold uppercase">Instrumento particular de compromisso de compra e venda de imóvel</h1>
        <p>
          <strong>VENDEDOR(ES):</strong> {vendedores.length ? vendedores.map(qualificacao).join("; ") : "________________"}.
        </p>
        <p>
          <strong>COMPRADOR(ES):</strong> {v.comprador ? qualificacao(v.comprador) : `${v.comprador_nome ?? "________________"}, inscrito(a) no CPF ____, residente em ____`}.
        </p>
        <p>
          <strong>INTERVENIENTE (intermediadora):</strong> {organizacao.nome}
          {organizacao.documento ? `, CNPJ/CPF ${formatarDocumento(organizacao.documento)}` : ""}
          {organizacao.creci ? `, CRECI ${organizacao.creci}` : ""}.
        </p>
        <p>As partes acima ajustam o presente compromisso de compra e venda, que se regerá pelas cláusulas seguintes:</p>

        <p>
          <strong>{cl()} — Objeto.</strong> O(s) VENDEDOR(ES) promete(m) vender ao(s) COMPRADOR(ES) o imóvel ({im?.tipo ?? "imóvel"}) situado em {endereco}
          {im?.cep ? `, CEP ${im.cep}` : ""}, objeto da matrícula nº {v.matricula ?? im?.matricula ?? "____"}
          {v.cartorio ? ` (${v.cartorio})` : " do Cartório de Registro de Imóveis competente"}
          {im?.inscricao_iptu ? `, inscrição municipal ${im.inscricao_iptu}` : ""}
          {im?.area_util ? `, com ${Number(im.area_util)} m² de área útil` : ""}, livre e desembaraçado de quaisquer ônus, dívidas ou pendências.
        </p>
        <p>
          <strong>{cl()} — Preço.</strong> O preço total é de <strong>{formatarReais(v.valor)}</strong>, pago na forma “{ROTULO_FORMA_PAGAMENTO[v.forma_pagamento] ?? v.forma_pagamento}”
          {pagamentos.length ? ", conforme o cronograma abaixo:" : ", nas condições combinadas entre as partes."}
        </p>
        {pagamentos.length > 0 && (
          <ul className="list-disc pl-6">
            {pagamentos.map((p, i) => (
              <li key={i}>
                {ROTULO_TIPO_PAGAMENTO[p.tipo]}
                {p.descricao ? ` (${p.descricao})` : ""}: {formatarReais(p.valor)}
                {p.vencimento ? ` em ${formatarDataBR(p.vencimento)}` : ""}
              </li>
            ))}
          </ul>
        )}
        {sinal > 0 && (
          <p>
            <strong>{cl()} — Sinal.</strong> O valor de {formatarReais(sinal)} é pago a título de sinal e princípio de pagamento (arras confirmatórias, arts. 417 a 420 do Código Civil),
            integrando o preço.
          </p>
        )}
        {(v.forma_pagamento === "financiamento" || v.forma_pagamento === "misto") && (
          <p>
            <strong>{cl()} — Financiamento.</strong> Parte do preço{v.valor_financiado ? `, no valor de ${formatarReais(v.valor_financiado)},` : ""} será paga por financiamento bancário
            {v.banco ? ` junto ao ${v.banco}` : ""}. O(s) COMPRADOR(ES) se obriga(m) a apresentar a documentação exigida pelo banco no prazo combinado; se o crédito for negado sem culpa das partes, este
            compromisso poderá ser desfeito com a devolução dos valores pagos, descontadas as despesas comprovadas.
          </p>
        )}
        <p>
          <strong>{cl()} — Escritura.</strong> A escritura definitiva será lavrada {v.escritura_data ? `até ${formatarDataBR(v.escritura_data)}` : "em até 60 (sessenta) dias"}, após a quitação do preço,
          obrigando-se o(s) VENDEDOR(ES) a apresentar as certidões necessárias.
        </p>
        <p>
          <strong>{cl()} — Despesas.</strong> O ITBI e as despesas de escritura e registro ficam a cargo do(s) {QUEM[quemPaga("itbi", "comprador")]}
          {quemPaga("escritura", "comprador") !== quemPaga("itbi", "comprador") ? ` (escritura: ${QUEM[quemPaga("escritura", "comprador")]})` : ""}; as certidões pessoais e do imóvel, a cargo do(s) VENDEDOR(ES).
          {despesas.length > 0 && ` Despesas previstas: ${despesas.map((d) => ROTULO_TIPO_DESPESA[d.tipo]).join(", ")}.`}
        </p>
        <p>
          <strong>{cl()} — Posse.</strong> A posse será transmitida {v.posse_data ? `em ${formatarDataBR(v.posse_data)}` : "na assinatura da escritura"}, com a entrega das chaves e o imóvel desocupado,
          respondendo o(s) VENDEDOR(ES) por tributos, condomínio e consumo até essa data.
        </p>
        <p>
          <strong>{cl()} — Intermediação.</strong> A comissão de intermediação, de {formatarReais(comissao)}, é devida à INTERVENIENTE pelo(s) VENDEDOR(ES) na assinatura deste instrumento ou conforme combinado,
          sendo devida mesmo em caso de desistência imotivada de qualquer das partes.
        </p>
        <p>
          <strong>{cl()} — Inadimplemento.</strong> O descumprimento de qualquer obrigação sujeita a parte infratora à multa de 10% (dez por cento) do preço, sem prejuízo das perdas e danos, aplicando-se ao sinal
          as regras dos arts. 418 e 419 do Código Civil.
        </p>
        <p>
          <strong>{cl()} — Irretratabilidade.</strong> Este compromisso é celebrado em caráter irrevogável e irretratável, obrigando herdeiros e sucessores.
        </p>
        <p>
          <strong>{cl()} — Foro.</strong> Fica eleito o foro da comarca de {im?.cidade ?? "____"} para dirimir questões deste instrumento.
        </p>
        <p className="pt-4">
          {im?.cidade ?? "________"}, {formatarDataBR(hojeISO())}.
        </p>
        <div className="grid grid-cols-2 gap-10 pt-10 text-center text-sm">
          {vendedores.map((p, i) => (
            <div key={i} className="border-t border-texto pt-2">
              {p.nome}
              <br />
              VENDEDOR(A)
            </div>
          ))}
          <div className="border-t border-texto pt-2">
            {v.comprador?.nome ?? v.comprador_nome ?? "Comprador(a)"}
            <br />
            COMPRADOR(A)
          </div>
          <div className="border-t border-texto pt-2">
            {organizacao.nome}
            <br />
            INTERVENIENTE
          </div>
          <div className="border-t border-texto pt-2">Testemunha 1</div>
          <div className="border-t border-texto pt-2">Testemunha 2</div>
        </div>
      </article>
    </div>
  );
}
