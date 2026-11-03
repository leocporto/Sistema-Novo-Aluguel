/**
 * Fotos e vídeos da vistoria no navegador: reduz a foto (para subir rápido
 * no 4G), carimba data/hora e ambiente na imagem e envia ao bucket privado
 * "vistorias" (pasta <organização>/<vistoria>/). Só usado por componentes
 * do navegador.
 */
import { clienteNavegador } from "@/lib/supabase/navegador";

export const TIPOS_MIDIA_VISTORIA = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "video/mp4", "video/quicktime", "video/webm"];
export const TAMANHO_MAX_MIDIA = 50 * 1024 * 1024;

const nomeSeguro = (n: string) => n.normalize("NFD").replace(/[^\w.-]+/g, "_").slice(-60) || "arquivo";

export const ehVideo = (mime: string) => mime.startsWith("video/");

/** Confere tipo e tamanho; devolve a mensagem de erro (ou null). */
export function validarMidia(f: { name: string; type: string; size: number }): string | null {
  if (!TIPOS_MIDIA_VISTORIA.includes(f.type)) return `"${f.name}": envie foto (JPG, PNG, WEBP, HEIC) ou vídeo (MP4, MOV, WEBM).`;
  if (f.size > TAMANHO_MAX_MIDIA) return `"${f.name}" passa de 50 MB.`;
  return null;
}

/**
 * Reduz a foto para no máximo 1600 px e grava no canto a identificação
 * (data, hora e ambiente). Vídeos e fotos que o navegador não consegue abrir
 * (ex.: HEIC fora do iPhone) seguem como vieram.
 */
export async function prepararFoto(f: File, carimbo?: string): Promise<{ blob: Blob; mime: string; nome: string }> {
  if (!f.type.startsWith("image/")) return { blob: f, mime: f.type, nome: nomeSeguro(f.name) };
  try {
    const bmp = await createImageBitmap(f);
    const escala = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * escala);
    c.height = Math.round(bmp.height * escala);
    const ctx = c.getContext("2d");
    if (!ctx) throw new Error("sem canvas");
    ctx.drawImage(bmp, 0, 0, c.width, c.height);
    if (carimbo) {
      const tam = Math.max(14, Math.round(c.width / 55));
      ctx.font = `600 ${tam}px sans-serif`;
      const largura = ctx.measureText(carimbo).width + tam;
      ctx.fillStyle = "rgba(0,0,0,.55)";
      ctx.fillRect(c.width - largura - 8, c.height - tam * 1.9 - 8, largura, tam * 1.9);
      ctx.fillStyle = "#fff";
      ctx.fillText(carimbo, c.width - largura - 8 + tam / 2, c.height - tam * 0.65 - 8);
    }
    const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, "image/jpeg", 0.82));
    if (!blob) throw new Error("sem blob");
    return { blob, mime: "image/jpeg", nome: nomeSeguro(f.name).replace(/\.\w+$/, "") + ".jpg" };
  } catch {
    return { blob: f, mime: f.type, nome: nomeSeguro(f.name) };
  }
}

/** Carimbo da foto: "03/11/2026 14:32 · Sala · Piso". */
export function carimboFoto(partes: (string | null | undefined)[], quando = new Date()) {
  const data = quando.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).replace(",", "");
  return [data, ...partes.filter(Boolean)].join(" · ");
}

/** Caminho do arquivo no bucket (o id do registro vai no nome: reenviar não duplica). */
export const caminhoMidia = (organizacaoId: string, vistoriaId: string, id: string, nome: string) => `${organizacaoId}/${vistoriaId}/${id}-${nomeSeguro(nome)}`;

/** Envia ao bucket. Se o arquivo já subiu antes (reenvio depois de cair a internet), segue normalmente. */
export async function enviarMidiaVistoria(caminho: string, blob: Blob, mime: string) {
  const { error } = await clienteNavegador().storage.from("vistorias").upload(caminho, blob, { contentType: mime, upsert: false });
  if (error && !/exist|duplicate/i.test(error.message)) throw new Error(`Não foi possível enviar o arquivo: ${error.message}`);
  return caminho;
}
