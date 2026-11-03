import type { Metadata } from "next";
import { Formulario } from "@/components/formulario";
import { Campo, Cartao, Entrada } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { salvarImovel } from "../../actions";
import { carregarArquivos } from "../arquivos";
import { GaleriaImovel } from "../galeria";

export const metadata: Metadata = { title: "Fotos e mídia" };

/** Converte link do YouTube/Vimeo no endereço do player. */
function embedVideo(url: string | null): string | null {
  if (!url) return null;
  const yt = url.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/);
  if (yt) return `https://www.youtube.com/embed/${yt[1]}`;
  const vm = url.match(/vimeo\.com\/(\d+)/);
  if (vm) return `https://player.vimeo.com/video/${vm[1]}`;
  return null;
}

export default async function MidiaPage({ params }: PageProps<"/imoveis/[id]/midia">) {
  const { id } = await params;
  const { supabase, organizacao } = await obterContexto();
  const [arquivos, { data: im }] = await Promise.all([
    carregarArquivos(supabase, id, ["foto", "planta"]),
    supabase.from("imoveis").select("video_url, tour_url").eq("id", id).single(),
  ]);
  const fotos = arquivos.filter((a) => a.tipo === "foto");
  const plantas = arquivos.filter((a) => a.tipo === "planta");
  const video = embedVideo(im?.video_url ?? null);
  const tour = im?.tour_url && /^https:\/\//.test(im.tour_url) ? im.tour_url : null;

  return (
    <div className="space-y-6">
      <Cartao titulo={`Fotos (${fotos.length})`}>
        <GaleriaImovel organizacaoId={organizacao.id} imovelId={id} tipo="foto" arquivos={fotos} vazio="Nenhuma foto ainda. A primeira enviada vira a capa (dá para trocar na estrela)." />
      </Cartao>
      <Cartao titulo={`Plantas (${plantas.length})`}>
        <GaleriaImovel organizacaoId={organizacao.id} imovelId={id} tipo="planta" arquivos={plantas} vazio="Nenhuma planta enviada." />
      </Cartao>
      <Formulario acao={salvarImovel} automatico>
        <input type="hidden" name="id" value={id} />
        <Cartao titulo="Vídeo e tour virtual">
          <div className="grid gap-4 md:grid-cols-2">
            <Campo rotulo="Link do vídeo" dica="YouTube ou Vimeo.">
              <Entrada name="video_url" type="url" defaultValue={im?.video_url ?? ""} placeholder="https://youtu.be/…" />
            </Campo>
            <Campo rotulo="Link do tour virtual" dica="Matterport, Kuula, Google Street View…">
              <Entrada name="tour_url" type="url" defaultValue={im?.tour_url ?? ""} placeholder="https://my.matterport.com/show/?m=…" />
            </Campo>
            {video && (
              <iframe title="Vídeo do imóvel" src={video} className="aspect-video w-full rounded-[14px] border border-borda" allowFullScreen loading="lazy" />
            )}
            {tour && (
              <iframe title="Tour virtual" src={tour} className="aspect-video w-full rounded-[14px] border border-borda" allowFullScreen loading="lazy" />
            )}
          </div>
        </Cartao>
      </Formulario>
    </div>
  );
}
