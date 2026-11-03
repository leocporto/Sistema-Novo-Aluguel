import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Formulario } from "@/components/formulario";
import { Campo, Cartao, Entrada, Selecao, Selo } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { diasEntre, formatarDataBR, hojeISO } from "@/lib/dominio/datas";
import { formatarReais } from "@/lib/dominio/dinheiro";
import { similares, type ImovelComparavel } from "@/lib/dominio/imoveis";
import { rotaPermitida } from "@/lib/modos";
import { ROTULO_STATUS_IMOVEL, type Imovel } from "@/lib/tipos";
import { salvarImovel } from "../../actions";
import { carregarArquivos } from "../arquivos";
import { GaleriaImovel } from "../galeria";

export const metadata: Metadata = { title: "Comercialização" };

function SeloPrazo({ fim, hoje, rotulo }: { fim: string | null; hoje: string; rotulo: string }) {
  if (!fim) return null;
  const dias = diasEntre(hoje, fim);
  if (dias < 0) return <Selo cor="vermelho">{rotulo} vencida há {-dias} dia(s)</Selo>;
  if (dias <= 30) return <Selo cor="amarelo">{rotulo} vence em {dias} dia(s)</Selo>;
  return <Selo cor="verde">{rotulo} até {formatarDataBR(fim)}</Selo>;
}

export default async function ComercializacaoPage({ params }: PageProps<"/imoveis/[id]/comercializacao">) {
  const { id } = await params;
  const { supabase, organizacao } = await obterContexto();
  if (!rotaPermitida(`/imoveis/${id}/comercializacao`, organizacao.modo)) redirect(`/imoveis/${id}`);
  const hoje = hojeISO();
  const [{ data }, { data: corretores }, { data: todos }, autorizacoes] = await Promise.all([
    supabase.from("imoveis").select("*").eq("id", id).single(),
    supabase.from("pessoas").select("id, nome").contains("papeis", ["corretor"]).order("nome"),
    supabase.from("imoveis").select("id, codigo, tipo, cidade, bairro, quartos, valor_aluguel, valor_venda, finalidades, status, empreendimento_id, bloco, unidade"),
    carregarArquivos(supabase, id, ["autorizacao"]),
  ]);
  const im = data as Imovel;
  type T = ImovelComparavel & { codigo: string; empreendimento_id: string | null; bloco: string | null; unidade: string | null };
  const lista = (todos ?? []) as T[];
  const parecidos = similares(im as unknown as ImovelComparavel, lista);
  const relacionados = im.empreendimento_id ? lista.filter((i) => i.empreendimento_id === im.empreendimento_id && i.id !== id) : [];

  const Linha = ({ i }: { i: T }) => (
    <li className="flex items-center justify-between gap-2 py-2">
      <Link href={`/imoveis/${i.id}`} className="min-w-0 truncate text-acento hover:underline">
        {i.codigo}
        <span className="text-mudo"> · {i.tipo}{i.quartos ? ` · ${i.quartos} qto(s)` : ""}{i.bairro ? ` · ${i.bairro}` : ""}</span>
      </Link>
      <span className="flex items-center gap-2 whitespace-nowrap text-sm">
        {i.valor_aluguel ? formatarReais(i.valor_aluguel) : i.valor_venda ? formatarReais(i.valor_venda) : ""}
        <Selo cor={i.status === "disponivel" ? "vermelho" : i.status === "alugado" ? "verde" : "cinza"}>{ROTULO_STATUS_IMOVEL[i.status] ?? i.status}</Selo>
      </span>
    </li>
  );

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
      <div className="space-y-6">
        <Formulario acao={salvarImovel} automatico>
          <input type="hidden" name="id" value={id} />
          <Cartao titulo="Corretor responsável">
            <Campo rotulo="Corretor">
              <Selecao name="corretor_id" defaultValue={im.corretor_id ?? ""}>
                <option value="">— nenhum —</option>
                {(corretores ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                  </option>
                ))}
              </Selecao>
            </Campo>
            {!corretores?.length && (
              <p className="mt-2 text-xs text-mudo">
                Cadastre corretores em{" "}
                <Link href="/pessoas/novo?papel=corretor" className="text-acento hover:underline">
                  Pessoas
                </Link>{" "}
                com o papel “Corretor”.
              </p>
            )}
          </Cartao>
          <Cartao titulo="Exclusividade" className="mt-6">
            <input type="hidden" name="_exclusivo" value="1" />
            <div className="space-y-4">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="exclusivo" defaultChecked={im.exclusivo} /> Imóvel com exclusividade da imobiliária
              </label>
              <div className="grid gap-4 sm:grid-cols-2">
                <Campo rotulo="Início">
                  <Entrada type="date" name="exclusividade_inicio" defaultValue={im.exclusividade_inicio ?? ""} />
                </Campo>
                <Campo rotulo="Fim">
                  <Entrada type="date" name="exclusividade_fim" defaultValue={im.exclusividade_fim ?? ""} />
                </Campo>
              </div>
              {im.exclusivo && <SeloPrazo fim={im.exclusividade_fim} hoje={hoje} rotulo="Exclusividade" />}
            </div>
          </Cartao>
          <Cartao titulo="Autorização de comercialização" className="mt-6">
            <div className="grid gap-4 sm:grid-cols-3">
              <Campo rotulo="Número / referência">
                <Entrada name="autorizacao_numero" defaultValue={im.autorizacao_numero ?? ""} />
              </Campo>
              <Campo rotulo="Assinada em">
                <Entrada type="date" name="autorizacao_data" defaultValue={im.autorizacao_data ?? ""} />
              </Campo>
              <Campo rotulo="Válida até">
                <Entrada type="date" name="autorizacao_validade" defaultValue={im.autorizacao_validade ?? ""} />
              </Campo>
            </div>
            <div className="mt-3">
              <SeloPrazo fim={im.autorizacao_validade} hoje={hoje} rotulo="Autorização" />
            </div>
          </Cartao>
        </Formulario>
        <Cartao titulo="Autorização assinada (arquivo)">
          <GaleriaImovel organizacaoId={organizacao.id} imovelId={id} tipo="autorizacao" arquivos={autorizacoes} vazio="Envie o PDF ou a foto da autorização assinada pelo proprietário." />
        </Cartao>
      </div>
      <div className="space-y-6">
        <Cartao titulo={`Imóveis similares (${parecidos.length})`}>
          <ul className="divide-y divide-borda-suave">
            {parecidos.map((i) => (
              <Linha key={i.id} i={i} />
            ))}
            {parecidos.length === 0 && <li className="py-2 text-sm text-mudo">Nenhum parecido (mesmo tipo, região, quartos e valor próximo).</li>}
          </ul>
        </Cartao>
        {im.empreendimento_id && (
          <Cartao titulo={`Do mesmo empreendimento (${relacionados.length})`} acoes={<Link href={`/empreendimentos/${im.empreendimento_id}`} className="text-xs text-acento">ver</Link>}>
            <ul className="divide-y divide-borda-suave">
              {relacionados.slice(0, 12).map((i) => (
                <Linha key={i.id} i={i} />
              ))}
              {relacionados.length === 0 && <li className="py-2 text-sm text-mudo">Nenhuma outra unidade.</li>}
            </ul>
          </Cartao>
        )}
      </div>
    </div>
  );
}
