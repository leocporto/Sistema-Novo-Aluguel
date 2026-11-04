import type { Metadata } from "next";
import Link from "next/link";
import { KeyRound, Plug, RefreshCw } from "lucide-react";
import { BotaoAcao } from "@/components/botao-acao";
import { BotaoExcluir } from "@/components/botao-excluir";
import { Copiar } from "@/components/copiar";
import { Formulario } from "@/components/formulario";
import { JanelaCadastro } from "@/components/janela-cadastro";
import { AreaTexto, Aviso, Cabecalho, Campo, Cartao, Entrada, Selo } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { hojeISO, somarDias } from "@/lib/dominio/datas";
import { LISTA_PORTAIS, PORTAIS, type Portal } from "@/lib/dominio/site-portais";
import { todas } from "../../financeiro/dados";
import { AbasSite } from "../abas";
import { conferirPortal, excluirPortal, novoTokenPortais, salvarPortal } from "../actions";
import { carregarConfig, carregarPortais, origemAtual, podeAdministrar, type ConfigPortal } from "../dados";

export const metadata: Metadata = { title: "Portais" };

const dataHora = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

type Envio = { portal: Portal; gerado_em: string; origem: string; total_elegiveis: number; total_enviados: number; total_falhas: number; total_fora_limite: number };

function CamposPortal({ cfg, portal }: { cfg?: ConfigPortal; portal: Portal }) {
  return (
    <>
      <input type="hidden" name="portal" value={portal} />
      <div className="space-y-2">
        <label className="flex items-center gap-2 text-sm text-texto">
          <input type="hidden" name="ativo" value="" />
          <input type="checkbox" name="ativo" defaultChecked={cfg ? cfg.ativo : true} className="size-4" /> Enviar imóveis para o {PORTAIS[portal].nome}
        </label>
        <label className="flex items-center gap-2 text-sm text-texto">
          <input type="hidden" name="publicar_todos" value="" />
          <input type="checkbox" name="publicar_todos" defaultChecked={cfg ? cfg.publicar_todos : true} className="size-4" /> Mandar todos os imóveis do site (sem marcar um a um)
        </label>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Campo rotulo="Código do anunciante">
          <Entrada name="codigo_anunciante" defaultValue={cfg?.codigo_anunciante ?? ""} placeholder="Do contrato" />
        </Campo>
        <Campo rotulo="Anúncios no plano" dica="Vazio = sem limite">
          <Entrada name="limite_anuncios" inputMode="numeric" defaultValue={cfg?.limite_anuncios ?? ""} />
        </Campo>
        <Campo rotulo="Destaques no plano" dica="Vazio = sem limite">
          <Entrada name="limite_destaques" inputMode="numeric" defaultValue={cfg?.limite_destaques ?? ""} />
        </Campo>
      </div>
      <Campo rotulo="Observações">
        <AreaTexto name="observacoes" rows={2} defaultValue={cfg?.observacoes ?? ""} placeholder="Contrato, gerente de contas, vencimento do plano…" />
      </Campo>
    </>
  );
}

/** Integração com ZAP Imóveis, Viva Real e OLX: feed por portal, leads por webhook e último envio. */
export default async function PortaisPage() {
  const { supabase, papel } = await obterContexto();
  const desde = `${somarDias(hojeISO(), -30)}T00:00:00-03:00`;
  const [config, portais, origem, { data: envios }, leads, controles] = await Promise.all([
    carregarConfig(supabase),
    carregarPortais(supabase),
    origemAtual(),
    supabase.from("portal_sincronizacoes").select("portal, gerado_em, origem, total_elegiveis, total_enviados, total_falhas, total_fora_limite").order("gerado_em", { ascending: false }).limit(60),
    todas<{ origem: string }>(() => supabase.from("site_solicitacoes").select("origem").eq("tipo", "portal").gte("created_at", desde).order("id")),
    todas<{ portal: string; ultimo_status: string | null }>(() => supabase.from("portal_imoveis").select("portal, ultimo_status").order("id")),
  ]);
  const porPortal = new Map(portais.map((p) => [p.portal, p]));
  // Busca do portal e conferência no sistema são coisas diferentes: só a busca é envio.
  const ultimo = (p: Portal) => ((envios ?? []) as Envio[]).find((e) => e.portal === p && e.origem !== "manual");
  const conferido = (p: Portal) => ((envios ?? []) as Envio[]).find((e) => e.portal === p && e.origem === "manual");
  const nLeads = (p: Portal) => leads.filter((l) => l.origem === p).length;
  const nStatus = (p: Portal, s: string) => controles.filter((c) => c.portal === p && c.ultimo_status === s).length;
  const token = config?.portais_token;
  const tokenLeads = config?.leads_portais_token ?? token;

  return (
    <>
      <Cabecalho
        titulo="Portais"
        trilha="Site e portais"
        descricao="Publique seus imóveis no ZAP Imóveis, no Viva Real e na OLX. O portal busca o arquivo de imóveis (feed) gerado na hora com preço, fotos e disponibilidade do cadastro, e os leads de lá caem no Comercial. Quando um imóvel entra ou sai do feed, isso fica anotado na aba Histórico do imóvel (Anúncios em portais)."
      />
      <AbasSite />
      {!config ? (
        <Aviso tipo="alerta">
          Crie o site primeiro na aba{" "}
          <Link href="/site" className="font-semibold text-acento hover:underline">
            Configuração
          </Link>
          : os portais usam o endereço das fotos e o código secreto do site.
        </Aviso>
      ) : (
        <div className="space-y-6">
          <div className="grid gap-6 xl:grid-cols-3">
            {LISTA_PORTAIS.map((p) => {
              const cfg = porPortal.get(p);
              const feed = `${origem}/api/portais/${token}/${p}.xml`;
              const webhook = `${origem}/api/portais/${tokenLeads}/${p}/leads`;
              const u = ultimo(p);
              const c = conferido(p);
              if (!cfg)
                return (
                  <Cartao key={p} titulo={<span className="flex items-center gap-2">{PORTAIS[p].nome} <Selo>NÃO LIGADO</Selo></span>}>
                    <p className="mb-4 text-sm text-texto-2">
                      Formato {PORTAIS[p].formato === "vrsync" ? "VRSync (padrão do Grupo OLX para ZAP e Viva Real)" : "XML de carga da OLX"}. Depois de ligar, copie o endereço do feed para o painel do portal.
                    </p>
                    <JanelaCadastro rotuloBotao={<><Plug className="size-4" /> Ligar {PORTAIS[p].nome}</>} titulo={`Ligar ${PORTAIS[p].nome}`} acao={salvarPortal} icone={<Plug />} rotuloSalvar="Ligar" larguraMax="max-w-xl">
                      <CamposPortal portal={p} />
                    </JanelaCadastro>
                  </Cartao>
                );
              return (
                <Cartao
                  key={p}
                  titulo={
                    <span className="flex items-center gap-2">
                      {PORTAIS[p].nome} {cfg.ativo ? <Selo cor="verde">ENVIANDO</Selo> : <Selo cor="amarelo">PAUSADO</Selo>}
                    </span>
                  }
                  acoes={
                    <BotaoExcluir
                      acao={excluirPortal}
                      id={cfg.id}
                      rotulo={`Desligar ${PORTAIS[p].nome}`}
                      confirmar={`Desligar o ${PORTAIS[p].nome}? O endereço do feed continua respondendo, mas vazio: na próxima busca o portal tira os anúncios. As escolhas por imóvel deste portal são apagadas e os anúncios abertos pelo feed são encerrados hoje.`}
                    />
                  }
                >
                  <div className="space-y-5">
                    <Formulario acao={salvarPortal} automatico semAviso className="space-y-4">
                      <CamposPortal cfg={cfg} portal={p} />
                    </Formulario>
                    <div className="space-y-3 border-t border-borda-suave pt-4 text-sm">
                      <div>
                        <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-mudo">Endereço do feed (cole no portal)</div>
                        <div className="mt-1 break-all rounded-[10px] border border-borda bg-elev px-3 py-2 font-mono text-[12px] text-texto">{feed}</div>
                        <div className="mt-1.5 flex flex-wrap gap-2">
                          <Copiar texto={feed} />
                          {/* Prévia: não conta como busca do portal nem abre anúncio no Histórico. */}
                          <a href={`${feed}?previa=1`} target="_blank" rel="noreferrer" className="text-xs font-semibold text-acento hover:underline">
                            ver o arquivo
                          </a>
                        </div>
                      </div>
                      <div>
                        <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-mudo">Endereço para receber leads (webhook)</div>
                        <div className="mt-1 break-all rounded-[10px] border border-borda bg-elev px-3 py-2 font-mono text-[12px] text-texto">{webhook}</div>
                        <div className="mt-1.5">
                          <Copiar texto={webhook} />
                        </div>
                      </div>
                      <p className="text-xs text-mudo">Onde cadastrar: {PORTAIS[p].painel}.</p>
                    </div>
                    <div className="space-y-2 border-t border-borda-suave pt-4 text-sm">
                      {u ? (
                        <p className="text-texto-2">
                          O portal buscou: <b className="text-texto">{dataHora(u.gerado_em)}</b> · <span className="text-ok">{u.total_enviados} enviado(s)</span>
                          {u.total_falhas ? <span className="text-ruim"> · {u.total_falhas} com falha</span> : null}
                          {u.total_fora_limite ? <span className="text-alerta"> · {u.total_fora_limite} fora do limite</span> : null}
                        </p>
                      ) : (
                        <p className="text-texto-2">O portal ainda não buscou o feed (cole o endereço acima no painel do portal).</p>
                      )}
                      {c && (!u || c.gerado_em > u.gerado_em) && (
                        <p className="text-xs text-mudo">
                          Conferido no sistema em {dataHora(c.gerado_em)}: {c.total_enviados} pronto(s) para ir
                          {c.total_falhas ? `, ${c.total_falhas} com falha` : ""}
                          {c.total_fora_limite ? `, ${c.total_fora_limite} fora do limite` : ""}. Vão de fato na próxima busca do portal.
                        </p>
                      )}
                      <p className="text-texto-2">
                        Leads nos últimos 30 dias: <b className="text-texto">{nLeads(p)}</b>
                        {nStatus(p, "falha") ? (
                          <>
                            {" · "}
                            <Link href={`/site/portais/historico?portal=${p}`} className="font-semibold text-ruim hover:underline">
                              {nStatus(p, "falha")} imóvel(is) com falha
                            </Link>
                          </>
                        ) : null}
                      </p>
                      <BotaoAcao acao={conferirPortal} id={p} tamanho="sm">
                        <RefreshCw className="size-3.5" /> Conferir agora
                      </BotaoAcao>
                    </div>
                  </div>
                </Cartao>
              );
            })}
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            <Cartao titulo="Como funciona">
              <ul className="list-disc space-y-1.5 pl-5 text-sm text-texto-2">
                <li>O portal busca o feed de tempos em tempos (geralmente a cada poucas horas). Cada busca fica em “Envios e falhas”.</li>
                <li>Preço, fotos e situação vêm sempre do cadastro: alugou ou vendeu, o imóvel sai do portal na próxima busca.</li>
                <li>Imóvel com dado obrigatório faltando (fotos, descrição, CEP, área…) não vai e aparece como falha, com o que corrigir.</li>
                <li>Na aba “Publicação nos portais” você escolhe imóvel por imóvel: não publicar, normal, destaque ou super destaque, e o código do anúncio no portal.</li>
                <li>Leads do portal entram no Comercial com a origem do portal, sem repetir quem já está em atendimento.</li>
              </ul>
            </Cartao>
            <Cartao titulo="O que depende do contrato com o portal">
              <ul className="list-disc space-y-1.5 pl-5 text-sm text-texto-2">
                <li>Ter um plano de anunciante ativo no portal (Canal Pro para ZAP e Viva Real; OLX Pro para a OLX).</li>
                <li>Cadastrar o endereço do feed no painel do portal (ou pedir ao gerente de contas) — o portal confirma o formato ao validar o arquivo.</li>
                <li>Ligar o envio de leads por webhook no painel do portal com o endereço de leads acima.</li>
              </ul>
              {podeAdministrar(papel) && config && (
                <div className="mt-4 border-t border-borda-suave pt-4">
                  <p className="mb-2 text-xs text-mudo">Se alguém de fora ficou com os endereços, gere um novo código secreto (depois atualize no painel dos portais).</p>
                  <BotaoAcao acao={novoTokenPortais} id={config.id} tamanho="sm" confirmar="Gerar novos endereços? Os antigos param de funcionar e você precisa atualizar no painel de cada portal.">
                    <KeyRound className="size-3.5" /> Gerar novo código secreto
                  </BotaoAcao>
                </div>
              )}
            </Cartao>
          </div>
        </div>
      )}
    </>
  );
}
