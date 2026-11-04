import type { Metadata } from "next";
import { LinhaLink } from "@/components/linha-link";
import { Celula, LinhaVazia, Selo, Tabela } from "@/components/ui";
import { formatarDataBR } from "@/lib/dominio/datas";
import { formatarReais } from "@/lib/dominio/dinheiro";
import { ROTULO_STATUS_IMOVEL } from "@/lib/tipos";
import { contextoCorretor, portalCorretor, semVinculo } from "../dados";
import { AvisoSemVinculo, TopoCorretor } from "../topo";

export const metadata: Metadata = { title: "Carteira de imóveis" };

type Imovel = {
  id: string;
  codigo: string;
  titulo: string | null;
  tipo: string;
  status: string;
  finalidades: string[];
  valor_aluguel: number | null;
  valor_venda: number | null;
  bairro: string | null;
  cidade: string | null;
  captado_em: string | null;
  leads: number;
  visitas: number;
};

/** Imóveis em que o corretor é o responsável (imoveis.corretor_id). */
export default async function CarteiraPage({ searchParams }: PageProps<"/corretor/imoveis">) {
  const ctx = await contextoCorretor(await searchParams);
  const d = await portalCorretor<Imovel[]>(ctx.supabase, "imoveis", ctx.escolhido);
  return (
    <>
      <TopoCorretor ctx={ctx} titulo="Carteira de imóveis" descricao="Imóveis em que você é o corretor responsável (aba Comercialização do imóvel)." />
      {semVinculo(d) ? (
        <AvisoSemVinculo ctx={ctx} />
      ) : (
        <Tabela colunas={["Imóvel", "Local", "Valores", "Situação", "Interessados", "Captado em"]}>
          {d.length === 0 && <LinhaVazia colunas={6}>Nenhum imóvel na sua carteira.</LinhaVazia>}
          {d.map((i) => (
            <LinhaLink key={i.id} href={`/imoveis/${i.id}`}>
              <Celula>
                <span className="font-medium">{i.codigo}</span>
                {i.titulo && <span className="block text-xs text-mudo">{i.titulo}</span>}
              </Celula>
              <Celula>{[i.bairro, i.cidade].filter(Boolean).join(" · ") || "—"}</Celula>
              <Celula className="text-sm tabular-nums">
                {i.valor_aluguel ? <span className="block">aluguel {formatarReais(i.valor_aluguel)}</span> : null}
                {i.valor_venda ? <span className="block">venda {formatarReais(i.valor_venda)}</span> : null}
                {!i.valor_aluguel && !i.valor_venda ? "—" : null}
              </Celula>
              <Celula>
                <Selo cor={i.status === "disponivel" ? "verde" : i.status === "inativo" ? "cinza" : "azul"}>{ROTULO_STATUS_IMOVEL[i.status] ?? i.status}</Selo>
              </Celula>
              <Celula className="text-sm">
                {i.leads} lead(s) · {i.visitas} visita(s) marcada(s)
              </Celula>
              <Celula>{formatarDataBR(i.captado_em)}</Celula>
            </LinhaLink>
          ))}
        </Tabela>
      )}
    </>
  );
}
