import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BotaoImprimir } from "@/components/formulario";
import { obterContexto } from "@/lib/contexto";
import { formatarDataBR } from "@/lib/dominio/datas";
import { formatarReais } from "@/lib/dominio/dinheiro";
import { formatarDocumento, qualificacao } from "@/lib/dominio/documentos";
import { carregarContrato } from "@/lib/servicos/locacao";
import { ROTULO_ADITIVO } from "../../rotulos";

export const metadata: Metadata = { title: "Aditivo" };

/** Termo aditivo para imprimir (modelo-base: revise antes de assinar). */
export default async function AditivoDoc({ params }: PageProps<"/contratos/[id]/aditivos/[aditivo]">) {
  const { id, aditivo } = await params;
  const { supabase, organizacao } = await obterContexto();
  const pessoal = organizacao.modo === "pessoal";
  const [dados, { data: a }] = await Promise.all([carregarContrato(supabase, id), supabase.from("contrato_aditivos").select("*").eq("id", aditivo).eq("contrato_id", id).maybeSingle()]);
  if (!dados || !a) notFound();
  const { contrato: c, imovel, partes } = dados;
  const locadores = partes.filter((p) => p.papel === "proprietario");
  const locatarios = partes.filter((p) => p.papel === "locatario");
  const fiadores = partes.filter((p) => p.papel === "fiador");
  const endereco = [imovel.logradouro, imovel.numero, imovel.complemento, imovel.bairro, imovel.cidade, imovel.uf].filter(Boolean).join(", ");

  return (
    <div className="mx-auto max-w-3xl">
      <div className="nao-imprimir mb-4 flex justify-between gap-3">
        <p className="text-sm text-alerta">Modelo gerado pelo sistema — revise antes de assinar.</p>
        <BotaoImprimir />
      </div>
      <article className="space-y-4 rounded-xl border border-borda bg-card p-10 text-[15px] leading-relaxed text-texto print:border-0 print:p-0">
        <h1 className="text-center text-lg font-bold uppercase">
          {a.numero}º termo aditivo ao contrato de locação nº {c.numero}
        </h1>
        <p className="text-center text-sm text-texto-2">{ROTULO_ADITIVO[a.tipo]}</p>
        <p>
          <strong>LOCADOR(ES):</strong>{" "}
          {pessoal ? `${organizacao.nome}${organizacao.documento ? `, CPF/CNPJ ${formatarDocumento(organizacao.documento)}` : ""}` : locadores.map((p) => qualificacao(p.pessoa)).join("; ")}.
        </p>
        <p>
          <strong>LOCATÁRIO(S):</strong> {locatarios.map((p) => qualificacao(p.pessoa)).join("; ")}.
        </p>
        {fiadores.length > 0 && (
          <p>
            <strong>FIADOR(ES):</strong> {fiadores.map((p) => qualificacao(p.pessoa)).join("; ")}.
          </p>
        )}
        <p>
          As partes do contrato de locação do imóvel situado em {endereco}, iniciado em {formatarDataBR(c.data_inicio)}, ajustam o presente aditivo:
        </p>
        <p>
          <strong>Cláusula 1ª.</strong> {a.descricao}
        </p>
        {a.valor_novo !== null && (
          <p>
            <strong>Cláusula 2ª — Aluguel.</strong> O aluguel mensal passa a ser de <strong>{formatarReais(a.valor_novo)}</strong>
            {a.valor_anterior !== null ? ` (antes ${formatarReais(a.valor_anterior)})` : ""}, a partir de {formatarDataBR(a.data)}.
          </p>
        )}
        {a.data_fim_nova && (
          <p>
            <strong>Cláusula {a.valor_novo !== null ? "3ª" : "2ª"} — Prazo.</strong> O prazo da locação passa a terminar em <strong>{formatarDataBR(a.data_fim_nova)}</strong>
            {a.data_fim_anterior ? ` (antes ${formatarDataBR(a.data_fim_anterior)})` : ""}.
          </p>
        )}
        <p>Ficam mantidas todas as demais cláusulas do contrato original que não conflitem com este aditivo{fiadores.length ? ", com a anuência expressa do(s) fiador(es)" : ""}.</p>
        <p className="pt-4">
          {imovel.cidade ?? "________"}, {formatarDataBR(a.data)}.
        </p>
        <div className="grid grid-cols-2 gap-10 pt-10 text-center text-sm">
          {(pessoal ? [{ nome: organizacao.nome }] : locadores.map((p) => p.pessoa)).map((p, i) => (
            <div key={`l${i}`} className="border-t border-texto pt-2">
              {p.nome}
              <br />
              LOCADOR(A)
            </div>
          ))}
          {locatarios.map((p) => (
            <div key={p.pessoa_id} className="border-t border-texto pt-2">
              {p.pessoa.nome}
              <br />
              LOCATÁRIO(A)
            </div>
          ))}
          {fiadores.map((p) => (
            <div key={p.pessoa_id} className="border-t border-texto pt-2">
              {p.pessoa.nome}
              <br />
              FIADOR(A)
            </div>
          ))}
        </div>
      </article>
    </div>
  );
}
