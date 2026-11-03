import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { BotaoExcluir } from "@/components/botao-excluir";
import { Copiar } from "@/components/copiar";
import { Formulario } from "@/components/formulario";
import { AreaTexto, Cabecalho, Campo, Cartao, classeBotao, Definicao, Entrada, Selecao } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { formatarDataHora, montarLinkUtm } from "@/lib/dominio/marketing";
import { ROTULO_ORIGEM_LEAD } from "@/lib/tipos";
import { atualizarLanding, excluirLanding } from "../../actions";
import { AbasMarketing } from "../../campos";
import { urlBase } from "../../dados";

export const metadata: Metadata = { title: "Landing page" };

const CANAIS_LINK: [string, string, string][] = [
  ["Facebook (anúncio)", "facebook", "cpc"],
  ["Instagram (anúncio)", "instagram", "cpc"],
  ["Instagram (bio/post)", "instagram", "social"],
  ["Google Ads", "google", "cpc"],
  ["WhatsApp (status/lista)", "whatsapp", "mensagem"],
  ["E-mail", "email", "email"],
];

export default async function LandingPage({ params }: PageProps<"/marketing/landing/[id]">) {
  const { id } = await params;
  const { supabase } = await obterContexto();
  const base = await urlBase();
  const [{ data: p }, { data: imoveis }, { data: leads }] = await Promise.all([
    supabase.from("mkt_landing_pages").select("*").eq("id", id).maybeSingle(),
    supabase.from("imoveis").select("id, codigo, bairro").neq("status", "inativo").order("codigo").limit(2000),
    supabase.from("leads").select("id, nome, origem, utm_source, utm_campaign, created_at").eq("landing_id", id).order("created_at", { ascending: false }).limit(20),
  ]);
  if (!p) notFound();
  const link = `${base}/lp/${p.slug}`;
  const campanha = (p.utm_campaign as string | null) ?? (p.slug as string);

  return (
    <>
      <Cabecalho
        titulo={p.titulo as string}
        trilha="Landing pages"
        descricao={
          <span className="font-mono text-[12.5px]">
            {link} {!p.publicada && "· fora do ar"}
          </span>
        }
        acoes={
          <>
            <a href={link} target="_blank" rel="noreferrer" className={classeBotao("secundario")}>
              <ExternalLink className="size-4" /> Abrir página
            </a>
            <BotaoExcluir acao={excluirLanding} id={id} variante="botao" confirmar="Excluir esta landing page?" depois="/marketing/landing" />
          </>
        }
      />
      <AbasMarketing />
      <div className="grid gap-6 xl:grid-cols-[1fr_420px]">
        <Formulario acao={atualizarLanding} automatico>
          <input type="hidden" name="id" value={id} />
          <Cartao titulo="Conteúdo">
            <div className="space-y-4">
              <Campo rotulo="Título">
                <Entrada name="titulo" required defaultValue={p.titulo as string} />
              </Campo>
              <Campo rotulo="Subtítulo">
                <Entrada name="subtitulo" defaultValue={(p.subtitulo as string | null) ?? ""} />
              </Campo>
              <Campo rotulo="Texto" dica="Aparece acima do formulário. Pule linhas para separar parágrafos.">
                <AreaTexto name="texto" rows={5} defaultValue={(p.texto as string | null) ?? ""} />
              </Campo>
              <div className="grid gap-4 sm:grid-cols-2">
                <Campo rotulo="Texto do botão">
                  <Entrada name="chamada" defaultValue={p.chamada as string} />
                </Campo>
                <Campo rotulo="Quem preenche">
                  <Selecao name="funil" defaultValue={p.funil as string}>
                    <option value="locacao">Quer alugar</option>
                    <option value="venda">Quer comprar</option>
                    <option value="captacao">Quer anunciar o imóvel</option>
                  </Selecao>
                </Campo>
                <Campo rotulo="Imóvel em destaque">
                  <Selecao name="imovel_id" defaultValue={(p.imovel_id as string | null) ?? ""}>
                    <option value="">— nenhum —</option>
                    {(imoveis ?? []).map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.codigo}
                        {i.bairro ? ` — ${i.bairro}` : ""}
                      </option>
                    ))}
                  </Selecao>
                </Campo>
                <Campo rotulo="Imagem de capa (link https)" dica="Cole o link de uma foto já publicada (site, Instagram, Drive público).">
                  <Entrada name="imagem_url" type="url" defaultValue={(p.imagem_url as string | null) ?? ""} placeholder="https://" />
                </Campo>
                <Campo rotulo="Endereço da página" dica="Mudar o endereço quebra os links já divulgados.">
                  <Entrada name="slug" required defaultValue={p.slug as string} />
                </Campo>
                <Campo rotulo="Campanha padrão (utm_campaign)">
                  <Entrada name="utm_campaign" defaultValue={(p.utm_campaign as string | null) ?? ""} />
                </Campo>
              </div>
              <label className="flex items-center gap-2 text-sm text-texto-2">
                <input type="hidden" name="publicada" value="" />
                <input type="checkbox" name="publicada" defaultChecked={p.publicada as boolean} className="size-4" /> Página no ar
              </label>
            </div>
          </Cartao>
        </Formulario>
        <div className="space-y-6">
          <Cartao titulo="Resultado">
            <Definicao
              itens={[
                ["Visitas", String(p.visitas)],
                ["Leads", String(p.leads)],
                ["Conversão", p.visitas ? `${String(Math.round((Number(p.leads) / Number(p.visitas)) * 1000) / 10).replace(".", ",")}%` : "—"],
              ]}
            />
          </Cartao>
          <Cartao titulo="Links com origem (UTM)">
            <p className="mb-3 text-sm text-texto-2">Use um link para cada lugar onde divulgar: o lead chega com a origem certa e aparece no relatório “Origem dos leads”.</p>
            <ul className="space-y-2 text-sm">
              {CANAIS_LINK.map(([rotulo, source, medium]) => (
                <li key={rotulo} className="flex items-center justify-between gap-2">
                  <span className="text-texto-2">{rotulo}</span>
                  <Copiar texto={montarLinkUtm(link, { source, medium, campaign: campanha })} rotulo="Copiar link" />
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-mudo">O Google Ads e a Meta acrescentam sozinhos o gclid/fbclid ao link: o sistema guarda os dois no lead.</p>
          </Cartao>
          <Cartao titulo="Últimos leads desta página">
            {!(leads ?? []).length ? (
              <p className="text-sm text-mudo">Nenhum ainda.</p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {(leads ?? []).map((l) => (
                  <li key={l.id} className="flex justify-between gap-2">
                    <Link href={`/comercial/leads/${l.id}`} className="text-acento hover:underline">
                      {l.nome}
                    </Link>
                    <span className="text-right text-xs text-mudo">
                      {l.utm_source ?? ROTULO_ORIGEM_LEAD[l.origem] ?? l.origem} · {formatarDataHora(l.created_at)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Cartao>
        </div>
      </div>
    </>
  );
}
