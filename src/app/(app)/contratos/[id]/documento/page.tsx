import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BotaoImprimir } from "@/components/formulario";
import { obterContexto } from "@/lib/contexto";
import { formatarDataBR } from "@/lib/dominio/datas";
import { formatarReais } from "@/lib/dominio/dinheiro";
import { formatarDocumento, qualificacao } from "@/lib/dominio/documentos";
import { NOME_INDICE } from "@/lib/dominio/reajuste";
import { carregarContrato } from "@/lib/servicos/locacao";
import { ROTULO_GARANTIA } from "@/lib/tipos";

export const metadata: Metadata = { title: "Contrato de locação" };

/**
 * Minuta de contrato gerada a partir dos dados cadastrados. É um modelo-base
 * próprio do sistema: revise com sua assessoria jurídica antes de usar.
 */
export default async function DocumentoContratoPage({ params }: PageProps<"/contratos/[id]/documento">) {
  const { id } = await params;
  const { supabase, organizacao } = await obterContexto();
  const pessoal = organizacao.modo === "pessoal";
  const dados = await carregarContrato(supabase, id);
  if (!dados) notFound();
  const { contrato: c, imovel, partes, encargos } = dados;
  const locadores = partes.filter((p) => p.papel === "proprietario");
  const locatarios = partes.filter((p) => p.papel === "locatario");
  const fiadores = partes.filter((p) => p.papel === "fiador");
  const endereco = [imovel.logradouro, imovel.numero, imovel.complemento, imovel.bairro, imovel.cidade, imovel.uf]
    .filter(Boolean)
    .join(", ");

  let n = 0;
  const cl = () => `Cláusula ${++n}ª`;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="nao-imprimir mb-4 flex justify-between">
        <p className="text-sm text-alerta">Minuta gerada automaticamente — revise antes de assinar.</p>
        <BotaoImprimir />
      </div>
      <article className="space-y-4 rounded-xl border border-borda bg-card p-10 text-[15px] leading-relaxed text-texto print:border-0 print:p-0">
        <h1 className="text-center text-lg font-bold uppercase">
          Contrato de locação {c.finalidade === "comercial" ? "não residencial" : "residencial"}
        </h1>

        <p>
          <strong>LOCADOR(ES):</strong>{" "}
          {pessoal
            ? `${organizacao.nome}${organizacao.documento ? `, CPF/CNPJ ${formatarDocumento(organizacao.documento)}` : ""}`
            : locadores.map((p) => qualificacao(p.pessoa)).join("; ")}
          .
        </p>
        <p>
          <strong>LOCATÁRIO(S):</strong> {locatarios.map((p) => qualificacao(p.pessoa)).join("; ")}.
        </p>
        {fiadores.length > 0 && (
          <p>
            <strong>FIADOR(ES):</strong> {fiadores.map((p) => qualificacao(p.pessoa)).join("; ")}.
          </p>
        )}
        {!pessoal && (
          <p>
            <strong>ADMINISTRADORA:</strong> {organizacao.nome}
            {organizacao.documento ? `, CNPJ/CPF ${formatarDocumento(organizacao.documento)}` : ""}
            {organizacao.creci ? `, CRECI ${organizacao.creci}` : ""}.
          </p>
        )}

        <p>As partes acima ajustam a locação do imóvel descrito abaixo, regida pela Lei nº 8.245/1991 e pelas cláusulas seguintes.</p>

        <p>
          <strong>{cl()} — Objeto.</strong> Imóvel do tipo {imovel.tipo}, situado em {endereco || "____"}
          {imovel.matricula ? `, matrícula nº ${imovel.matricula}` : ""}
          {imovel.inscricao_iptu ? `, inscrição municipal ${imovel.inscricao_iptu}` : ""}, destinado exclusivamente a uso{" "}
          {c.finalidade === "comercial" ? "não residencial" : "residencial"}.
        </p>
        <p>
          <strong>{cl()} — Prazo.</strong> {c.prazo_meses} meses, de {formatarDataBR(c.data_inicio)} a {formatarDataBR(c.data_fim)}. Findo o
          prazo sem manifestação das partes, a locação prossegue por prazo indeterminado nos termos da lei.
        </p>
        <p>
          <strong>{cl()} — Aluguel.</strong> O aluguel mensal é de {formatarReais(c.valor_aluguel)}, com vencimento no dia {c.dia_vencimento} de
          cada mês ({c.modalidade === "vencido" ? "referente ao mês anterior de uso" : "referente ao mês corrente"}), pago por meio do documento de
          cobrança emitido pelo {pessoal ? "LOCADOR" : "ADMINISTRADORA"}.
        </p>
        {encargos.length > 0 && (
          <p>
            <strong>{cl()} — Encargos.</strong> Além do aluguel, o LOCATÁRIO pagará juntamente com a cobrança mensal:{" "}
            {encargos.map((e) => `${e.descricao} (${formatarReais(e.valor)} estimados)`).join("; ")}, valores sujeitos às alterações dos
            respectivos credores.
          </p>
        )}
        <p>
          <strong>{cl()} — Atraso.</strong> O pagamento após o vencimento sujeita o LOCATÁRIO a multa de {Number(c.multa_atraso_pct)}% e juros de{" "}
          {Number(c.juros_mes_pct)}% ao mês, calculados proporcionalmente aos dias de atraso.
        </p>
        <p>
          <strong>{cl()} — Reajuste.</strong> O aluguel será reajustado a cada {c.periodicidade_reajuste_meses} meses pela variação acumulada do{" "}
          {NOME_INDICE[c.indice_reajuste as keyof typeof NOME_INDICE] ?? c.indice_reajuste}, ou outro índice oficial que venha a substituí-lo.
        </p>
        <p>
          <strong>{cl()} — Garantia.</strong> {ROTULO_GARANTIA[c.garantia_tipo]}
          {c.garantia_valor ? ` no valor de ${formatarReais(c.garantia_valor)}` : ""}
          {c.garantia_detalhes ? ` (${c.garantia_detalhes})` : ""}.
          {fiadores.length > 0 &&
            " O(s) FIADOR(ES) responde(m) solidariamente por todas as obrigações deste contrato até a efetiva entrega das chaves."}
        </p>
        <p>
          <strong>{cl()} — Rescisão antecipada.</strong> A devolução do imóvel antes do fim do prazo obriga o LOCATÁRIO ao pagamento de multa
          equivalente a {Number(c.multa_rescisoria_alugueis)} aluguel(is), reduzida proporcionalmente ao tempo de contrato já cumprido, salvo as
          hipóteses de dispensa previstas em lei.
        </p>
        <p>
          <strong>{cl()} — Conservação e vistoria.</strong> O imóvel é entregue conforme laudo de vistoria de entrada, que integra este contrato, e
          deverá ser devolvido no mesmo estado, ressalvado o desgaste natural de uso.
        </p>
        <p>
          <strong>{cl()} — Seguro.</strong> O LOCATÁRIO manterá seguro contra incêndio do imóvel durante toda a locação
          {c.seguro_incendio_apolice ? ` (apólice ${c.seguro_incendio_apolice})` : ""}.
        </p>
        {c.observacoes && (
          <p>
            <strong>{cl()} — Disposições adicionais.</strong> {c.observacoes}
          </p>
        )}
        <p>
          <strong>{cl()} — Foro.</strong> Fica eleito o foro da comarca de {imovel.cidade ?? "____"} para dirimir questões deste contrato.
        </p>

        <p className="pt-6">
          {imovel.cidade ?? "____"}, {formatarDataBR(c.data_inicio)}.
        </p>
        <div className="grid grid-cols-2 gap-10 pt-10 text-center text-sm">
          {pessoal && (
            <div className="border-t border-borda-forte pt-1">
              {organizacao.nome}
              <div className="text-xs uppercase text-mudo">locador</div>
            </div>
          )}
          {[...(pessoal ? [] : locadores), ...locatarios, ...fiadores].map((p) => (
            <div key={`${p.pessoa_id}-${p.papel}`} className="border-t border-borda-forte pt-1">
              {p.pessoa.nome}
              <div className="text-xs uppercase text-mudo">{p.papel === "proprietario" ? "locador" : p.papel}</div>
            </div>
          ))}
        </div>
      </article>
    </div>
  );
}
