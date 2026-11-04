import { obterContexto } from "@/lib/contexto";
import { ROTULO_BUCKET, ZIP_MAX_ARQUIVOS, ZIP_MAX_BYTES } from "@/lib/dominio/integracoes";
import { montarZip, type ArquivoZip } from "@/lib/servicos/integracoes/zip";

export const maxDuration = 60;

/**
 * Exportação dos arquivos de uma área (bucket) em .zip, por partes. Baixa com a
 * sessão do administrador (as regras do Storage valem). O que não couber no
 * limite da parte sai num "nao-incluidos.txt" com link de 24 h.
 */
export async function GET(req: Request) {
  const { supabase, papel, organizacao } = await obterContexto();
  if (papel !== "admin") return new Response("Só o administrador exporta os arquivos.", { status: 403 });
  const sp = new URL(req.url).searchParams;
  const bucket = sp.get("bucket") ?? "";
  if (!(bucket in ROTULO_BUCKET)) return new Response("Área desconhecida.", { status: 400 });
  const pular = Math.max(0, Number(sp.get("pular")) || 0);
  const limite = Math.min(ZIP_MAX_ARQUIVOS, Math.max(1, Number(sp.get("limite")) || ZIP_MAX_ARQUIVOS));
  const parte = Math.max(1, Number(sp.get("parte")) || 1);

  const { data, error } = await supabase.rpc("integracoes_arquivos", { p_bucket: bucket, p_pular: pular, p_limite: limite });
  if (error) return new Response(error.message, { status: 400 });
  const lista = (data ?? []) as { nome: string; bytes: number }[];
  const arquivos: ArquivoZip[] = [];
  const fora: string[] = [];
  let total = 0;
  const prefixo = `${organizacao.id}/`;
  for (const a of lista) {
    const nome = `${bucket}/${a.nome.startsWith(prefixo) ? a.nome.slice(prefixo.length) : a.nome}`;
    if (total + Number(a.bytes) > ZIP_MAX_BYTES * 1.25) {
      const { data: link } = await supabase.storage.from(bucket).createSignedUrl(a.nome, 86_400);
      fora.push(`${nome}\t${link?.signedUrl ?? "(sem acesso)"}`);
      continue;
    }
    const { data: blob, error: e } = await supabase.storage.from(bucket).download(a.nome);
    if (e || !blob) {
      fora.push(`${nome}\t(não foi possível baixar: ${e?.message ?? "sem acesso"})`);
      continue;
    }
    const dados = new Uint8Array(await blob.arrayBuffer());
    total += dados.length;
    arquivos.push({ nome, dados });
  }
  if (fora.length)
    arquivos.push({ nome: "nao-incluidos.txt", dados: new TextEncoder().encode(`Arquivos fora deste .zip (links valem 24 horas):\r\n${fora.join("\r\n")}\r\n`) });
  if (!arquivos.length) arquivos.push({ nome: "LEIA-ME.txt", dados: new TextEncoder().encode("Nenhum arquivo nesta parte.\r\n") });
  const zip = montarZip(arquivos);
  return new Response(zip.buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="arquivos-${bucket}-parte-${parte}.zip"`,
      "Cache-Control": "no-store",
    },
  });
}
