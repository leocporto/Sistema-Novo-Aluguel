import type { Metadata } from "next";
import { Cartao } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { CATEGORIAS_DOCUMENTO_IMOVEL } from "@/lib/tipos";
import { carregarArquivos } from "../arquivos";
import { GaleriaImovel } from "../galeria";

export const metadata: Metadata = { title: "Documentos do imóvel" };

export default async function DocumentosImovelPage({ params }: PageProps<"/imoveis/[id]/documentos">) {
  const { id } = await params;
  const { supabase, organizacao } = await obterContexto();
  const [docs, { data: im }] = await Promise.all([
    carregarArquivos(supabase, id, ["documento"]),
    supabase.from("imoveis").select("matricula, inscricao_iptu").eq("id", id).single(),
  ]);
  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
      <Cartao titulo={`Documentos (${docs.length})`}>
        <GaleriaImovel
          organizacaoId={organizacao.id}
          imovelId={id}
          tipo="documento"
          arquivos={docs}
          categorias={CATEGORIAS_DOCUMENTO_IMOVEL}
          vazio="Nenhum documento. Escolha o tipo e envie matrícula, escritura, carnê do IPTU…"
        />
      </Cartao>
      <Cartao titulo="Registro">
        <dl className="space-y-3 text-sm">
          <div>
            <dt className="text-xs text-mudo">Matrícula</dt>
            <dd className="font-medium text-texto">{im?.matricula || "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-mudo">Inscrição IPTU</dt>
            <dd className="font-medium text-texto">{im?.inscricao_iptu || "—"}</dd>
          </div>
          <p className="text-xs text-mudo">Edite esses números na aba Dados.</p>
        </dl>
      </Cartao>
    </div>
  );
}
