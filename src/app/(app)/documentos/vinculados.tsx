import Link from "next/link";
import { Cartao, Selo } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { formatarDataBR } from "@/lib/dominio/datas";
import { ROTULO_STATUS_DOCUMENTO, ROTULO_TIPO_DOCUMENTO } from "@/lib/dominio/modelos";

/** Documentos da central ligados a um imóvel ou cliente (organização documental). */
export async function DocumentosVinculados({ campo, id }: { campo: "imovel_id" | "pessoa_id"; id: string }) {
  const { supabase } = await obterContexto();
  const { data } = await supabase.from("documentos").select("id, titulo, tipo, status, validade, updated_at").eq(campo, id).order("updated_at", { ascending: false }).limit(50);
  const novo = campo === "imovel_id" ? `/documentos?novo=1&imovel=${id}` : `/documentos?novo=1&pessoa=${id}`;
  return (
    <Cartao
      titulo={`Contratos e documentos (${data?.length ?? 0})`}
      acoes={
        <Link href={novo} className="text-xs text-acento hover:underline">
          + gerar
        </Link>
      }
    >
      <ul className="space-y-2 text-sm">
        {(data ?? []).map((d) => (
          <li key={d.id} className="flex items-center justify-between gap-2">
            <Link href={`/documentos/${d.id}`} className="min-w-0">
              <span className="block truncate font-medium text-acento hover:underline">{d.titulo}</span>
              <span className="text-xs text-mudo">
                {ROTULO_TIPO_DOCUMENTO[d.tipo] ?? d.tipo}
                {d.validade ? ` · vence ${formatarDataBR(d.validade)}` : ""}
              </span>
            </Link>
            <Selo cor={d.status === "assinado" ? "verde" : d.status === "aguardando_assinatura" ? "amarelo" : "cinza"}>{ROTULO_STATUS_DOCUMENTO[d.status]}</Selo>
          </li>
        ))}
        {!data?.length && <li className="text-mudo">Nenhum documento na central.</li>}
      </ul>
    </Cartao>
  );
}
