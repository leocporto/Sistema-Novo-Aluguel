import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BotaoImprimir } from "@/components/formulario";
import { obterContexto } from "@/lib/contexto";
import { ROTULO_PAPEL_SIGNATARIO } from "@/lib/dominio/modelos";
import { TextoDocumento } from "../../campos";

export const metadata: Metadata = { title: "Imprimir documento" };

const quando = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });

/** Versão para imprimir/salvar em PDF, com o manifesto das assinaturas eletrônicas. */
export default async function ImprimirDocumento({ params }: PageProps<"/documentos/[id]/imprimir">) {
  const { id } = await params;
  const { supabase } = await obterContexto();
  const [{ data: d }, { data: sigs }] = await Promise.all([
    supabase.from("documentos").select("titulo, numero, versao, conteudo, status, hash_final").eq("id", id).maybeSingle(),
    supabase.from("documento_signatarios").select("nome, papel, cpf, assinado_em, nome_assinado, cpf_assinado, ip, hash_documento").eq("documento_id", id).order("ordem"),
  ]);
  if (!d) notFound();
  await supabase.from("documento_eventos").insert({ documento_id: id, tipo: "exportado", descricao: "Aberto para impressão/PDF" });
  const assinados = (sigs ?? []).filter((s) => s.assinado_em);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="nao-imprimir mb-4 flex items-center justify-between gap-3">
        <p className="text-sm text-texto-2">Use “Imprimir” e escolha “Salvar como PDF” para exportar.</p>
        <BotaoImprimir />
      </div>
      <article className="rounded-xl border border-borda bg-card p-10 print:border-0 print:p-0">
        <TextoDocumento texto={d.conteudo ?? ""} />
        {assinados.length > 0 && (
          <section className="mt-10 break-inside-avoid border-t border-borda pt-4 text-xs text-texto-2">
            <h3 className="mb-2 text-sm font-semibold text-texto">Manifesto de assinaturas eletrônicas</h3>
            <p className="mb-2">
              Documento nº {d.numero}, versão {d.versao}. Assinado eletronicamente pelas partes abaixo, que concordaram com o uso de assinatura eletrônica (art. 10, § 2º, da MP 2.200-2/2001).
            </p>
            <ul className="space-y-1">
              {assinados.map((s, i) => (
                <li key={i}>
                  <strong>{s.nome_assinado ?? s.nome}</strong> ({ROTULO_PAPEL_SIGNATARIO[s.papel]}) · CPF/CNPJ {s.cpf_assinado ?? s.cpf ?? "—"} · {quando(s.assinado_em!)} · IP {s.ip ?? "—"}
                </li>
              ))}
            </ul>
            {d.hash_final && <p className="mt-2 break-all">Código de integridade (SHA-256 do texto): {d.hash_final}</p>}
          </section>
        )}
      </article>
    </div>
  );
}
