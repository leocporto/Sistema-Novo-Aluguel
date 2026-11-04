import type { Metadata } from "next";
import { FiltroAutomatico } from "@/components/filtro-automatico";
import { LinhaLink } from "@/components/linha-link";
import { PilulasLink } from "@/components/pilulas-link";
import { Cabecalho, Celula, Entrada, LinhaVazia, Selo, Tabela } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { descricaoImovel, precoDoImovel } from "@/lib/dominio/marketing";
import { ROTULO_STATUS_IMOVEL } from "@/lib/tipos";
import { AbasMarketing } from "../campos";

export const metadata: Metadata = { title: "Materiais de divulgação" };

export default async function MateriaisPage({ searchParams }: PageProps<"/marketing/materiais">) {
  const sp = await searchParams;
  const todos = sp.todos === "1";
  const busca = typeof sp.busca === "string" ? sp.busca.replace(/[%,()]/g, " ").trim() : "";
  const { supabase } = await obterContexto();
  let q = supabase.from("imoveis").select("id, codigo, tipo, status, bairro, cidade, quartos, valor_aluguel, valor_venda, finalidades").order("codigo").limit(500);
  if (!todos) q = q.eq("status", "disponivel");
  if (busca) q = q.or(`codigo.ilike.%${busca}%,bairro.ilike.%${busca}%,cidade.ilike.%${busca}%,logradouro.ilike.%${busca}%,titulo.ilike.%${busca}%`);
  const { data } = await q;
  type I = { id: string; codigo: string; tipo: string; status: string; bairro: string | null; cidade: string | null; quartos: number | null; valor_aluguel: number | null; valor_venda: number | null; finalidades: string[] };
  const imoveis = (data ?? []) as I[];

  return (
    <>
      <Cabecalho
        titulo="Materiais de divulgação"
        trilha="Marketing"
        descricao="Escolha o imóvel para gerar a ficha em A4 (imprimir ou salvar em PDF), a arte para post e story com foto, preço e contato, e o texto pronto para anúncio."
      />
      <AbasMarketing />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <PilulasLink
          rotulo="Imóveis"
          ativo={todos ? "/marketing/materiais?todos=1" : "/marketing/materiais"}
          itens={[
            { href: "/marketing/materiais", rotulo: "Disponíveis" },
            { href: "/marketing/materiais?todos=1", rotulo: "Todos" },
          ]}
        />
        <FiltroAutomatico className="filtros-linha">
          {todos && <input type="hidden" name="todos" value="1" />}
          <Entrada name="busca" aria-label="Buscar imóvel" defaultValue={busca} placeholder="Código, bairro, rua…" className="max-w-72" />
        </FiltroAutomatico>
      </div>
      <Tabela colunas={["Imóvel", "Preço", "Situação"]}>
        {imoveis.map((i) => (
          <LinhaLink key={i.id} href={`/marketing/materiais/${i.id}`}>
            <Celula>
              <span className="font-semibold text-texto">{descricaoImovel(i)}</span>
              {i.cidade && <span className="block text-xs text-mudo">{i.cidade}</span>}
            </Celula>
            <Celula className="tabular-nums">{precoDoImovel(i)}</Celula>
            <Celula>
              <Selo cor={i.status === "disponivel" ? "verde" : "cinza"}>{ROTULO_STATUS_IMOVEL[i.status] ?? i.status}</Selo>
            </Celula>
          </LinhaLink>
        ))}
        {imoveis.length === 0 && <LinhaVazia colunas={3}>Nenhum imóvel aqui.</LinhaVazia>}
      </Tabela>
    </>
  );
}
