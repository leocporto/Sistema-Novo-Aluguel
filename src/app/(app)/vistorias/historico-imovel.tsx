import Link from "next/link";
import { ClipboardCheck } from "lucide-react";
import { BotaoLink, Cartao, Selo } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { formatarDataBR } from "@/lib/dominio/datas";
import { COR_STATUS_VISTORIA, ROTULO_STATUS_VISTORIA, ROTULO_TIPO_VISTORIA, progressoVistoria } from "@/lib/dominio/vistorias";

type Linha = {
  id: string;
  numero: number;
  tipo: string;
  status: string;
  data: string;
  referencia_id: string | null;
  assinada_em: string | null;
  contrato: { id: string; numero: number } | null;
  vistoria_itens: { estado: string | null }[];
  vistoria_pendencias: { status: string }[];
};

/**
 * Histórico completo das vistorias de um imóvel (linha do tempo, em qualquer
 * situação, inclusive de imóvel inativo). Usado em /vistorias?imovel=<id> e na
 * aba Histórico da ficha do imóvel. Nos dois modos.
 */
export async function HistoricoVistoriasImovel({ imovelId, naFichaDoImovel = false, className }: { imovelId: string; naFichaDoImovel?: boolean; className?: string }) {
  const { supabase } = await obterContexto();
  const [{ data: im }, { data }] = await Promise.all([
    supabase.from("imoveis").select("id, codigo").eq("id", imovelId).maybeSingle(),
    supabase
      .from("vistorias")
      .select("id, numero, tipo, status, data, referencia_id, assinada_em, contrato:contratos(id, numero), vistoria_itens(estado), vistoria_pendencias(status)")
      .eq("imovel_id", imovelId)
      .order("data")
      .order("numero"),
  ]);
  if (!im) return null;
  const lista = (data ?? []) as unknown as Linha[];

  return (
    <Cartao
      className={className}
      titulo={naFichaDoImovel ? `Vistorias (${lista.length})` : `Histórico de vistorias do imóvel ${im.codigo}`}
      acoes={
        naFichaDoImovel ? (
          <Link href={`/vistorias?imovel=${imovelId}`} className="text-xs text-acento hover:underline">
            ver em Vistorias
          </Link>
        ) : (
          <Link href={`/imoveis/${imovelId}`} className="text-xs text-acento hover:underline">
            abrir imóvel
          </Link>
        )
      }
    >
      {lista.length === 0 ? (
        <p className="mb-4 text-sm text-mudo">Este imóvel ainda não tem vistorias.</p>
      ) : (
        <ol className="relative mb-4 space-y-4 border-l border-borda pl-5">
          {lista.map((v) => {
            const p = progressoVistoria(v.vistoria_itens);
            const abertas = v.vistoria_pendencias.filter((x) => x.status === "aberta" || x.status === "em_reparo").length;
            return (
              <li key={v.id} className="relative">
                <span className={`absolute -left-[26px] top-1 size-3 rounded-full border-2 border-card ${v.tipo === "entrada" ? "bg-ok" : v.tipo === "saida" ? "bg-ruim" : "bg-acento"}`} />
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Link href={`/vistorias/${v.id}`} className="font-semibold text-texto hover:underline">
                    {ROTULO_TIPO_VISTORIA[v.tipo]} · {formatarDataBR(v.data)}
                  </Link>
                  <Selo cor={COR_STATUS_VISTORIA[v.status]}>{ROTULO_STATUS_VISTORIA[v.status]}</Selo>
                  <span className="text-xs text-mudo">
                    nº {v.numero}
                    {v.contrato ? ` · contrato ${v.contrato.numero}` : ""} · {p.avaliados}/{p.total} itens{p.danos ? ` · ${p.danos} com dano` : ""}
                    {abertas ? ` · ${abertas} reparo(s) em aberto` : ""}
                  </span>
                  {v.referencia_id && (
                    <Link href={`/vistorias/${v.id}/comparacao`} className="text-xs text-acento hover:underline">
                      comparar com a anterior
                    </Link>
                  )}
                  <Link href={`/vistorias/${v.id}/laudo`} className="text-xs text-acento hover:underline">
                    laudo
                  </Link>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      <BotaoLink href={`/vistorias?novo=1&imovel_novo=${imovelId}`} variante="secundario">
        <ClipboardCheck className="size-4" /> Nova vistoria deste imóvel
      </BotaoLink>
    </Cartao>
  );
}
