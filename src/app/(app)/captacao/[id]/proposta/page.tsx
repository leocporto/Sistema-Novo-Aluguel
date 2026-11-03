import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BotaoImprimir } from "@/components/formulario";
import { BotaoLink } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { formatarDataBR, hojeISO } from "@/lib/dominio/datas";
import { formatarDocumento } from "@/lib/dominio/documentos";
import { formatarReais } from "@/lib/dominio/dinheiro";
import { enderecoCaptacao, type Captacao } from "../../campos";

export const metadata: Metadata = { title: "Proposta de captação" };

const pct = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `${String(Number(n)).replace(".", ",")}%`);

/** Proposta de administração/intermediação para o proprietário (pronta para imprimir ou salvar em PDF). */
export default async function PropostaCaptacao({ params }: PageProps<"/captacao/[id]/proposta">) {
  const { id } = await params;
  const { supabase, organizacao } = await obterContexto();
  const { data } = await supabase.from("captacoes").select("*").eq("id", id).maybeSingle();
  if (!data) notFound();
  const c = data as unknown as Captacao;
  const adm = c.proposta_tipo !== "intermediacao";
  const inter = c.proposta_tipo !== "administracao";
  const aluga = c.finalidades.includes("locacao");
  const vende = c.finalidades.includes("venda");
  const num = (x: unknown) => (x === null || x === undefined || x === "" ? null : Number(x));
  const aluguel = num(c.valor_avaliado_aluguel ?? (aluga ? c.valor_pretendido : null));
  const venda = num(c.valor_avaliado_venda ?? (vende ? c.valor_pretendido : null));
  const taxaAdm = num(c.proposta_taxa_adm) ?? Number(organizacao.taxa_administracao_pct ?? 0);
  const taxaInt = num(c.proposta_taxa_intermediacao) ?? Number(organizacao.taxa_intermediacao_pct ?? 0);
  const caracteristicas = [
    c.area ? `${Number(c.area)} m²` : null,
    c.quartos ? `${c.quartos} quarto(s)` : null,
    c.suites ? `${c.suites} suíte(s)` : null,
    c.banheiros ? `${c.banheiros} banheiro(s)` : null,
    c.vagas ? `${c.vagas} vaga(s)` : null,
  ].filter(Boolean);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="nao-imprimir mb-4 flex items-center justify-between gap-2">
        <BotaoLink href={`/captacao/${c.id}`} variante="secundario">
          Voltar
        </BotaoLink>
        <BotaoImprimir />
      </div>
      <article className="space-y-5 rounded-xl border border-borda bg-card p-10 text-[15px] leading-relaxed text-texto print:border-0 print:p-0">
        <header className="border-b border-borda pb-4">
          <div className="text-xl font-bold">{organizacao.nome}</div>
          <div className="text-sm text-texto-2">
            {[
              organizacao.documento ? `CNPJ/CPF ${formatarDocumento(organizacao.documento)}` : null,
              organizacao.creci ? `CRECI ${organizacao.creci}` : null,
              organizacao.telefone,
              organizacao.email,
            ]
              .filter(Boolean)
              .join(" · ")}
          </div>
        </header>
        <h1 className="text-center text-lg font-bold uppercase">
          Proposta de {adm && inter ? "intermediação e administração" : adm ? "administração de imóvel" : "intermediação imobiliária"}
        </h1>
        <p>
          Ao(À) Sr(a). <strong>{c.proprietario_nome}</strong>,
        </p>
        <p>
          Agradecemos a confiança em nos apresentar o seu imóvel. Seguem as condições para{" "}
          {[aluga && "a locação", vende && "a venda"].filter(Boolean).join(" e ")} do imóvel abaixo.
        </p>
        <section>
          <h2 className="mb-1 font-semibold">1. O imóvel</h2>
          <p className="capitalize">{c.tipo}</p>
          <p>{[enderecoCaptacao(c), c.complemento, c.uf, c.cep ? `CEP ${c.cep}` : null].filter(Boolean).join(" · ") || "Endereço a confirmar"}</p>
          {caracteristicas.length > 0 && <p>{caracteristicas.join(" · ")}</p>}
        </section>
        <section>
          <h2 className="mb-1 font-semibold">2. Valor de mercado</h2>
          {aluga && <p>Aluguel sugerido: <strong>{formatarReais(aluguel)}</strong> por mês.</p>}
          {vende && <p>Valor de venda sugerido: <strong>{formatarReais(venda)}</strong>.</p>}
          <p className="text-sm text-texto-2">Valores baseados em imóveis comparáveis da região{c.avaliado_em ? `, avaliados em ${formatarDataBR(c.avaliado_em)}` : ""}.</p>
        </section>
        <section>
          <h2 className="mb-1 font-semibold">3. Nossos honorários</h2>
          <ul className="list-disc space-y-1 pl-5">
            {aluga && inter && <li>Intermediação da locação: {pct(taxaInt)} sobre o primeiro aluguel{aluguel ? ` (≈ ${formatarReais((aluguel * taxaInt) / 100)})` : ""}.</li>}
            {aluga && adm && <li>Administração mensal: {pct(taxaAdm)} sobre cada aluguel recebido{aluguel ? ` (≈ ${formatarReais((aluguel * taxaAdm) / 100)} por mês)` : ""}.</li>}
            {vende && <li>Comissão de venda: {pct(c.proposta_comissao_venda ?? 6)} sobre o valor da venda{venda ? ` (≈ ${formatarReais((venda * Number(c.proposta_comissao_venda ?? 6)) / 100)})` : ""}.</li>}
          </ul>
        </section>
        {adm && aluga && (
          <section>
            <h2 className="mb-1 font-semibold">4. O que está incluído</h2>
            <ul className="list-disc space-y-1 pl-5">
              <li>Anúncio nos principais portais, com fotos tratadas.</li>
              <li>Análise de cadastro e garantias do inquilino; contrato e vistoria.</li>
              <li>Cobrança mensal, repasse do aluguel e prestação de contas.</li>
              <li>Acompanhamento de reajustes, renovação e manutenção.</li>
            </ul>
          </section>
        )}
        {c.exclusivo && (
          <p>
            Exclusividade de comercialização
            {c.exclusividade_inicio ? ` de ${formatarDataBR(c.exclusividade_inicio)}` : ""}
            {c.exclusividade_fim ? ` até ${formatarDataBR(c.exclusividade_fim)}` : ""}.
          </p>
        )}
        {c.proposta_texto && <p className="whitespace-pre-line">{c.proposta_texto}</p>}
        <p className="text-sm text-texto-2">Proposta válida por 15 dias. {formatarDataBR(c.proposta_enviada_em ?? hojeISO())}.</p>
        <div className="grid grid-cols-2 gap-10 pt-12 text-center text-sm">
          <div className="border-t border-texto pt-2">{organizacao.nome}</div>
          <div className="border-t border-texto pt-2">{c.proprietario_nome} — de acordo</div>
        </div>
      </article>
    </div>
  );
}
