import type { Metadata } from "next";
import { LayoutTemplate } from "lucide-react";
import { BotaoExcluir } from "@/components/botao-excluir";
import { Copiar } from "@/components/copiar";
import { JanelaCadastro } from "@/components/janela-cadastro";
import { LinhaLink } from "@/components/linha-link";
import { Cabecalho, Campo, Celula, Entrada, LinhaVazia, Selecao, Selo, Tabela } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { criarLanding, excluirLanding } from "../actions";
import { AbasMarketing } from "../campos";
import { urlBase } from "../dados";

export const metadata: Metadata = { title: "Landing pages" };

const FUNIL: Record<string, string> = { locacao: "Quer alugar", venda: "Quer comprar", captacao: "Quer anunciar o imóvel" };

export default async function LandingPagesPage({ searchParams }: PageProps<"/marketing/landing">) {
  const sp = await searchParams;
  const { supabase } = await obterContexto();
  const base = await urlBase();
  const [{ data }, { data: imoveis }] = await Promise.all([
    supabase.from("mkt_landing_pages").select("*, imovel:imoveis(codigo)").order("created_at", { ascending: false }),
    supabase.from("imoveis").select("id, codigo, bairro").neq("status", "inativo").order("codigo").limit(2000),
  ]);
  type L = { id: string; slug: string; titulo: string; funil: string; publicada: boolean; visitas: number; leads: number; imovel: { codigo: string } | null };
  const paginas = (data ?? []) as L[];

  return (
    <>
      <Cabecalho
        titulo="Landing pages"
        trilha="Marketing"
        descricao="Páginas públicas para anúncios e posts: quem preenche vira lead no Comercial com a origem certa (UTM, gclid do Google, fbclid da Meta) e o pixel/tag de conversão dispara."
        acoes={
          <JanelaCadastro rotuloBotao={<><LayoutTemplate className="size-4" /> Nova landing page</>} titulo="Nova landing page" acao={criarLanding} icone={<LayoutTemplate />} abertaInicial={sp.novo === "1"}>
            <Campo rotulo="Título">
              <Entrada name="titulo" required placeholder="Ex.: Apartamentos para alugar no Centro" />
            </Campo>
            <Campo rotulo="Endereço (opcional)" dica={`${base}/lp/… — vazio = gerado pelo título.`}>
              <Entrada name="slug" placeholder="apartamentos-centro" />
            </Campo>
            <Campo rotulo="Subtítulo (opcional)">
              <Entrada name="subtitulo" />
            </Campo>
            <div className="grid gap-4 sm:grid-cols-2">
              <Campo rotulo="Quem preenche">
                <Selecao name="funil" defaultValue="locacao">
                  {Object.entries(FUNIL).map(([k, r]) => (
                    <option key={k} value={k}>
                      {r}
                    </option>
                  ))}
                </Selecao>
              </Campo>
              <Campo rotulo="Imóvel em destaque (opcional)">
                <Selecao name="imovel_id" defaultValue={typeof sp.imovel === "string" ? sp.imovel : ""}>
                  <option value="">— nenhum —</option>
                  {(imoveis ?? []).map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.codigo}
                      {i.bairro ? ` — ${i.bairro}` : ""}
                    </option>
                  ))}
                </Selecao>
              </Campo>
            </div>
          </JanelaCadastro>
        }
      />
      <AbasMarketing />
      <Tabela colunas={["Página", "Endereço", "Visitas", "Leads", "Conversão", ""]}>
        {paginas.map((p) => (
          <LinhaLink key={p.id} href={`/marketing/landing/${p.id}`}>
            <Celula>
              <span className="font-semibold text-texto">{p.titulo}</span>
              <span className="mt-1 flex items-center gap-1.5 text-xs text-mudo">
                {FUNIL[p.funil] ?? p.funil}
                {p.imovel ? ` · ${p.imovel.codigo}` : ""}
                {!p.publicada && <Selo>fora do ar</Selo>}
              </span>
            </Celula>
            <Celula>
              <div className="flex items-center gap-2">
                <span className="font-mono text-[12px] text-texto-2">/lp/{p.slug}</span>
                <Copiar texto={`${base}/lp/${p.slug}`} rotulo="Copiar" />
              </div>
            </Celula>
            <Celula className="tabular-nums">{p.visitas}</Celula>
            <Celula className="tabular-nums">{p.leads}</Celula>
            <Celula className="tabular-nums">{p.visitas ? `${String(Math.round((p.leads / p.visitas) * 1000) / 10).replace(".", ",")}%` : "—"}</Celula>
            <Celula>
              <BotaoExcluir acao={excluirLanding} id={p.id} rotulo="Excluir landing page" confirmar={`Excluir a página "${p.titulo}"? O link para de funcionar (os leads continuam).`} />
            </Celula>
          </LinhaLink>
        ))}
        {paginas.length === 0 && <LinhaVazia colunas={6}>Nenhuma landing page ainda.</LinhaVazia>}
      </Tabela>
    </>
  );
}
