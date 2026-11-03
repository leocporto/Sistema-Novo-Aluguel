import type { Metadata } from "next";
import Link from "next/link";
import { RotateCcw } from "lucide-react";
import { LinhaLink } from "@/components/linha-link";
import { PilulasLink } from "@/components/pilulas-link";
import { BotaoLink, Cabecalho, Celula, LinhaVazia, Selo, Tabela } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { diasEntre, formatarDataBR, hojeISO, somarDias } from "@/lib/dominio/datas";
import { ROTULO_CATEGORIA_CURTO, ROTULO_GARANTIA, situacaoGarantia } from "@/lib/dominio/manutencao";
import { AbasManutencao } from "../abas";
import { SELECT_LISTA, type ChamadoLista } from "../dados";

export const metadata: Metadata = { title: "Garantias dos serviços" };

const FILTROS: Record<string, string> = { "": "Valendo", vencendo: "Acabando (30 dias)", vencidas: "Vencidas (últimos 6 meses)" };
const COR = { sem: "cinza", ativa: "verde", vencendo: "amarelo", vencida: "cinza" } as const;

export default async function GarantiasPage({ searchParams }: PageProps<"/manutencao/garantias">) {
  const sp = await searchParams;
  const filtro = typeof sp.filtro === "string" && sp.filtro in FILTROS ? sp.filtro : "";
  const { supabase } = await obterContexto();
  const hoje = hojeISO();
  let q = supabase.from("chamados").select(SELECT_LISTA).in("status", ["concluido", "avaliado"]).not("garantia_ate", "is", null).order("garantia_ate").limit(1000);
  if (filtro === "") q = q.gte("garantia_ate", hoje);
  if (filtro === "vencendo") q = q.gte("garantia_ate", hoje).lte("garantia_ate", somarDias(hoje, 30));
  if (filtro === "vencidas") q = q.lt("garantia_ate", hoje).gte("garantia_ate", somarDias(hoje, -183));
  const { data } = await q;
  const lista = (data ?? []) as unknown as ChamadoLista[];
  const url = (k: string) => (k ? `/manutencao/garantias?filtro=${k}` : "/manutencao/garantias");

  return (
    <>
      <Cabecalho
        titulo="Garantias dos serviços"
        trilha="Manutenção"
        descricao="Serviços concluídos ainda na garantia. Se o problema voltar, abra o chamado por aqui: ele aponta o serviço anterior e o prestador volta sem custo."
      />
      <AbasManutencao />
      <PilulasLink className="mb-4" rotulo="Garantias" ativo={url(filtro)} itens={Object.entries(FILTROS).map(([k, r]) => ({ href: url(k), rotulo: r }))} />
      <Tabela colunas={["Serviço", "Imóvel", "Prestador", "Concluído", "Garantia até", ""]}>
        {lista.map((c) => {
          const g = situacaoGarantia(c.garantia_ate, hoje);
          const dias = c.garantia_ate ? diasEntre(hoje, c.garantia_ate) : 0;
          const novo = new URLSearchParams({ novo: "1", imovel: c.imovel_id, origem: c.id, categoria: c.categoria, titulo: `Retorno na garantia: ${c.titulo}`, ...(c.prestador_id ? { prestador: c.prestador_id } : {}), ...(c.contrato_id ? { contrato: c.contrato_id } : {}) });
          return (
            <LinhaLink key={c.id} href={`/manutencao/${c.id}`}>
              <Celula>
                <Link href={`/manutencao/${c.id}`} className="font-medium text-texto hover:underline">
                  #{c.numero} · {c.titulo}
                </Link>
                <span className="block text-xs text-mudo">{ROTULO_CATEGORIA_CURTO[c.categoria] ?? c.categoria}</span>
              </Celula>
              <Celula className="text-sm text-texto-2">{c.imovel?.codigo ?? "—"}</Celula>
              <Celula className="text-sm text-texto-2">{c.prestador?.nome ?? "—"}</Celula>
              <Celula className="text-sm text-texto-2">{formatarDataBR(c.concluido_em)}</Celula>
              <Celula>
                <Selo cor={COR[g]}>{ROTULO_GARANTIA[g]}</Selo>
                <span className="mt-1 block text-xs text-mudo">
                  {formatarDataBR(c.garantia_ate)}
                  {dias >= 0 ? ` · faltam ${dias} dia(s)` : ""}
                </span>
              </Celula>
              <Celula>
                {g !== "vencida" && (
                  <BotaoLink href={`/manutencao?${novo}`} variante="secundario">
                    <RotateCcw className="size-4" /> Abrir na garantia
                  </BotaoLink>
                )}
              </Celula>
            </LinhaLink>
          );
        })}
        {lista.length === 0 && <LinhaVazia colunas={6}>Nenhum serviço nesta situação.</LinhaVazia>}
      </Tabela>
    </>
  );
}
