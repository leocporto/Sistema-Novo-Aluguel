import type { Metadata } from "next";
import Link from "next/link";
import { Formulario } from "@/components/formulario";
import { AreaTexto, BotaoLink, Cabecalho, Campo, Cartao, Entrada, Selecao, Selo } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { ROTULO_FASE } from "@/lib/dominio/site";
import { AbasSite } from "../abas";
import { salvarEmpreendimentoSite } from "../actions";
import { carregarConfig, origemAtual } from "../dados";

export const metadata: Metadata = { title: "Lançamentos no site" };

type Emp = {
  id: string;
  nome: string;
  bairro: string | null;
  cidade: string | null;
  publicar_site: boolean;
  fase: string | null;
  previsao_entrega: string | null;
  descricao_site: string | null;
  video_url: string | null;
  tour_url: string | null;
  imoveis: { status: string; publicar_site: boolean }[];
};

/** Páginas de empreendimentos e lançamentos no site. */
export default async function LancamentosSitePage() {
  const { supabase } = await obterContexto();
  const [config, origem, { data }] = await Promise.all([
    carregarConfig(supabase),
    origemAtual(),
    supabase
      .from("empreendimentos")
      .select("id, nome, bairro, cidade, publicar_site, fase, previsao_entrega, descricao_site, video_url, tour_url, imoveis(status, publicar_site)")
      .order("nome"),
  ]);
  const lista = (data ?? []) as Emp[];

  return (
    <>
      <Cabecalho
        titulo="Lançamentos no site"
        trilha="Site e portais"
        descricao="Cada empreendimento publicado ganha uma página com fase da obra, previsão de entrega, unidades disponíveis, vídeo, tour e formulário de interesse."
        acoes={<BotaoLink href="/empreendimentos" variante="secundario">Cadastro de empreendimentos</BotaoLink>}
      />
      <AbasSite />
      {lista.length === 0 ? (
        <Cartao>
          <p className="text-sm text-texto-2">
            Nenhum empreendimento cadastrado.{" "}
            <Link href="/empreendimentos" className="font-semibold text-acento hover:underline">
              Cadastre o primeiro
            </Link>{" "}
            e marque aqui para aparecer no site.
          </p>
        </Cartao>
      ) : (
        <div className="entrar-cascata grid gap-5 xl:grid-cols-2">
          {lista.map((e) => {
            const unidades = e.imoveis.filter((i) => i.publicar_site && (i.status === "disponivel" || i.status === "reservado")).length;
            return (
              <Cartao
                key={e.id}
                titulo={
                  <span className="flex flex-wrap items-center gap-2">
                    <Link href={`/empreendimentos/${e.id}`} className="hover:text-acento">
                      {e.nome}
                    </Link>
                    {e.publicar_site ? <Selo cor="verde">NO SITE</Selo> : <Selo>FORA DO SITE</Selo>}
                  </span>
                }
                acoes={
                  e.publicar_site && config?.ativo ? (
                    <a href={`${origem}/s/${config.slug}/empreendimentos/${e.id}`} target="_blank" rel="noreferrer" className="text-xs font-semibold text-acento hover:underline">
                      ver no site
                    </a>
                  ) : null
                }
              >
                <Formulario acao={salvarEmpreendimentoSite} automatico semAviso className="space-y-4">
                  <input type="hidden" name="id" value={e.id} />
                  <label className="flex items-center gap-2 text-sm text-texto">
                    <input type="hidden" name="publicar_site" value="" />
                    <input type="checkbox" name="publicar_site" defaultChecked={e.publicar_site} className="size-4" /> Mostrar no site
                  </label>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Campo rotulo="Fase">
                      <Selecao name="fase" defaultValue={e.fase ?? ""}>
                        <option value="">—</option>
                        {Object.entries(ROTULO_FASE).map(([k, r]) => (
                          <option key={k} value={k}>
                            {r}
                          </option>
                        ))}
                      </Selecao>
                    </Campo>
                    <Campo rotulo="Previsão de entrega">
                      <Entrada type="date" name="previsao_entrega" defaultValue={e.previsao_entrega ?? ""} />
                    </Campo>
                  </div>
                  <Campo rotulo="Texto da página">
                    <AreaTexto name="descricao_site" rows={3} defaultValue={e.descricao_site ?? ""} placeholder="Diferenciais, lazer, plantas, condições de pagamento…" />
                  </Campo>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Campo rotulo="Vídeo (YouTube ou Vimeo)">
                      <Entrada type="url" name="video_url" defaultValue={e.video_url ?? ""} placeholder="https://youtu.be/…" />
                    </Campo>
                    <Campo rotulo="Tour virtual">
                      <Entrada type="url" name="tour_url" defaultValue={e.tour_url ?? ""} placeholder="https://…" />
                    </Campo>
                  </div>
                </Formulario>
                <p className="mt-3 text-xs text-mudo">
                  {[e.bairro, e.cidade].filter(Boolean).join(", ") || "Sem endereço"} · {unidades} unidade(s) no site
                  {unidades === 0 && " — marque as unidades em “Imóveis no site” para aparecerem na página"}
                  {e.fase ? ` · ${ROTULO_FASE[e.fase]}` : ""}
                </p>
              </Cartao>
            );
          })}
        </div>
      )}
      {lista.length > 0 && <p className="mt-4 text-right text-xs text-mudo">As alterações são salvas automaticamente.</p>}
    </>
  );
}
