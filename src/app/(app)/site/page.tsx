import type { Metadata } from "next";
import { CheckCircle2, ExternalLink, Globe, Inbox, Megaphone, MonitorSmartphone, TriangleAlert } from "lucide-react";
import { Contador } from "@/components/abas-segmentadas";
import { BotaoAcao } from "@/components/botao-acao";
import { BotaoExcluir } from "@/components/botao-excluir";
import { Copiar } from "@/components/copiar";
import { BotaoEnviar, Formulario } from "@/components/formulario";
import { JanelaCadastro } from "@/components/janela-cadastro";
import { AreaTexto, Aviso, Cabecalho, Campo, Cartao, Entrada, Indicador, Selo, classeBotao } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { formatarDataBR, hojeISO, somarDias } from "@/lib/dominio/datas";
import { descricaoSeo, instrucoesDns, sugerirSlug } from "@/lib/dominio/site";
import { AbasSite } from "./abas";
import { criarSite, excluirSite, salvarEnderecoSite, salvarSite, verificarDominio } from "./actions";
import { carregarConfig, origemAtual, podeAdministrar } from "./dados";
import { LogoSite } from "./logo-site";

export const metadata: Metadata = { title: "Site e portais" };

/** Caixa de marcar que salva sozinha (com o campo escondido para salvar quando desmarcada). */
function Marcar({ nome, rotulo, dica, marcado }: { nome: string; rotulo: string; dica?: string; marcado: boolean }) {
  return (
    <label className="flex cursor-pointer gap-3 rounded-[14px] border border-borda p-3 has-[:checked]:border-acento-bd has-[:checked]:bg-acento-bg">
      <input type="hidden" name={nome} value="" />
      <input type="checkbox" name={nome} defaultChecked={marcado} className="mt-1 size-4" />
      <span>
        <span className="block font-semibold text-texto">{rotulo}</span>
        {dica && <span className="text-xs text-texto-2">{dica}</span>}
      </span>
    </label>
  );
}

export default async function SitePage() {
  const { supabase, organizacao, papel } = await obterContexto();
  const [config, origem] = await Promise.all([carregarConfig(supabase), origemAtual()]);

  if (!config) {
    const sugestao = sugerirSlug(organizacao.nome);
    const campos = (
      <>
        <Campo rotulo="Endereço do site" dica={`Fica assim: ${origem}/s/${sugestao}. Dá para trocar depois e ligar um domínio próprio.`}>
          <Entrada name="slug" required defaultValue={sugestao} pattern="[a-z0-9][a-z0-9-]{1,48}[a-z0-9]" />
        </Campo>
        <Campo rotulo="Nome que aparece no site">
          <Entrada name="nome" defaultValue={organizacao.nome} />
        </Campo>
      </>
    );
    return (
      <>
        <Cabecalho
          titulo="Site e portais"
          descricao="Site da imobiliária com seus imóveis, busca, mapa, favoritos e formulários que viram leads — e envio automático para ZAP, Viva Real e OLX."
          acoes={
            <JanelaCadastro rotuloBotao={<><Globe className="size-4" /> Criar meu site</>} titulo="Criar o site da imobiliária" acao={criarSite} icone={<Globe />} rotuloSalvar="Criar site">
              {campos}
            </JanelaCadastro>
          }
        />
        <AbasSite />
        <Cartao titulo="Seu site em poucos minutos">
          <ul className="grid gap-3 text-sm text-texto-2 sm:grid-cols-2">
            {[
              "Catálogo com busca por local, preço e características, filtros e mapa",
              "Página de cada imóvel com fotos, vídeo, tour, mapa e parecidos",
              "Contato e agendamento de visita que caem direto no Comercial e na Agenda",
              "Favoritos e comparação de imóveis para o visitante",
              "“Anuncie seu imóvel”: proprietários viram oportunidades de captação",
              "Lançamentos, sua marca e cores, Google Analytics e domínio próprio",
            ].map((t) => (
              <li key={t} className="flex gap-2">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ok" /> {t}
              </li>
            ))}
          </ul>
          <p className="mt-4 text-sm text-texto">Clique em “Criar meu site” para começar.</p>
        </Cartao>
      </>
    );
  }

  const linkSite = `${origem}/s/${config.slug}`;
  const desde = somarDias(hojeISO(), -30);
  const [{ count: noSite }, { count: disponiveisFora }, { count: contatos }, { count: leadsPortais }, { count: falhas }] = await Promise.all([
    supabase.from("imoveis").select("id", { count: "exact", head: true }).eq("publicar_site", true).in("status", ["disponivel", "reservado"]),
    supabase.from("imoveis").select("id", { count: "exact", head: true }).eq("publicar_site", false).eq("status", "disponivel"),
    supabase.from("site_solicitacoes").select("id", { count: "exact", head: true }).neq("tipo", "portal").gte("created_at", desde),
    supabase.from("site_solicitacoes").select("id", { count: "exact", head: true }).eq("tipo", "portal").gte("created_at", desde),
    supabase.from("portal_imoveis").select("id", { count: "exact", head: true }).eq("ultimo_status", "falha"),
  ]);
  const logo = config.logo_path ? supabase.storage.from("site").getPublicUrl(config.logo_path).data.publicUrl : null;
  const admin = podeAdministrar(papel);
  const dns = config.dominio ? instrucoesDns(config.dominio, config.id) : [];

  return (
    <>
      <Cabecalho
        titulo="Site e portais"
        descricao="Seu site imobiliário: aparência, textos, contatos, Google e domínio. Os imóveis, preços e fotos vêm sempre do cadastro."
        acoes={
          <>
            <a href={linkSite} target="_blank" rel="noreferrer" className={classeBotao()}>
              <ExternalLink className="size-4" /> Abrir o site
            </a>
            <Copiar texto={linkSite} rotulo="Copiar link" />
            {admin && (
              <BotaoExcluir
                acao={excluirSite}
                id={config.id}
                variante="botao"
                rotulo="Excluir site"
                confirmar="Excluir o site? Ele sai do ar, os feeds dos portais passam a vir vazios (os portais tiram os anúncios) e os anúncios abertos pelo feed são encerrados hoje. O endereço fica reservado para a sua imobiliária por 12 meses. Os imóveis e os contatos recebidos continuam no sistema."
              />
            )}
          </>
        }
      />
      <AbasSite />

      <div className="entrar-cascata mb-6 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Indicador rotulo="Imóveis no site" icone={<MonitorSmartphone />} valor={<Contador valor={noSite ?? 0} />} detalhe={disponiveisFora ? `${disponiveisFora} disponível(is) fora do site` : "todos os disponíveis estão no site"} href="/site/imoveis" tom={disponiveisFora ? "alerta" : "sucesso"} />
        <Indicador rotulo="Contatos pelo site (30 dias)" icone={<Inbox />} valor={<Contador valor={contatos ?? 0} />} detalhe="mensagens, visitas e anúncios" href="/site/contatos" />
        <Indicador rotulo="Leads dos portais (30 dias)" icone={<Megaphone />} valor={<Contador valor={leadsPortais ?? 0} />} detalhe="ZAP, Viva Real e OLX" href="/site/contatos?tipo=portal" />
        <Indicador rotulo="Falhas nos portais" icone={<TriangleAlert />} valor={<Contador valor={falhas ?? 0} />} detalhe={falhas ? "imóveis que não foram enviados" : "nenhuma falha"} href="/site/portais/historico" tom={falhas ? "perigo" : "sucesso"} />
      </div>

      <div className="mb-6">
        {config.ativo ? (
          <Aviso>
            O site está <b>no ar</b> em{" "}
            <a href={linkSite} target="_blank" rel="noreferrer" className="font-semibold text-acento hover:underline">
              {linkSite}
            </a>
            . Divulgue o link no Instagram, no WhatsApp e no cartão de visitas.
          </Aviso>
        ) : (
          <Aviso tipo="alerta">
            O site está <b>fora do ar</b>: o link mostra “página não encontrada” e as fotos não aparecem. Marque “Site no ar” para ver como ficou — ninguém encontra o endereço até você
            divulgar.
          </Aviso>
        )}
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Formulario acao={salvarSite} automatico className="space-y-6">
          <input type="hidden" name="id" value={config.id} />
          <Cartao titulo="Situação e opções">
            <div className="space-y-3">
              <Marcar nome="ativo" rotulo="Site no ar" dica="Desmarcado, o site e as fotos ficam fora do ar para os visitantes." marcado={config.ativo} />
              <Marcar nome="agendamento_ativo" rotulo="Agendamento de visitas pelo site" dica="O visitante escolhe dia e horário; a visita entra na Agenda para você confirmar." marcado={config.agendamento_ativo} />
              <Marcar nome="captacao_ativa" rotulo="Página “Anuncie seu imóvel”" dica="Proprietários mandam os dados e viram oportunidades em Captação de imóveis." marcado={config.captacao_ativa} />
              <Marcar nome="mostrar_endereco" rotulo="Mostrar o endereço exato" dica="Desmarcado, o site mostra só bairro e cidade, e o mapa fica aproximado." marcado={config.mostrar_endereco} />
            </div>
          </Cartao>
          <Cartao titulo="Marca e cores">
            <div className="grid gap-4 sm:grid-cols-2">
              <Campo rotulo="Nome no site">
                <Entrada name="nome" defaultValue={config.nome ?? ""} placeholder={organizacao.nome} />
              </Campo>
              <Campo rotulo="Frase da marca (slogan)">
                <Entrada name="slogan" defaultValue={config.slogan ?? ""} placeholder="Seu novo lar começa aqui" />
              </Campo>
              <Campo rotulo="Cor principal" dica="Botões, preços e destaques.">
                <Entrada name="cor_primaria" type="color" defaultValue={config.cor_primaria} className="h-[46px] cursor-pointer p-1.5" />
              </Campo>
              <Campo rotulo="Cor do rodapé e do topo da página inicial">
                <Entrada name="cor_secundaria" type="color" defaultValue={config.cor_secundaria} className="h-[46px] cursor-pointer p-1.5" />
              </Campo>
            </div>
          </Cartao>
          <Cartao titulo="Textos da página inicial">
            <div className="space-y-4">
              <Campo rotulo="Título">
                <Entrada name="titulo_home" defaultValue={config.titulo_home ?? ""} placeholder="Encontre o imóvel certo para você" />
              </Campo>
              <Campo rotulo="Subtítulo">
                <Entrada name="subtitulo_home" defaultValue={config.subtitulo_home ?? ""} placeholder="Casas e apartamentos para alugar e comprar em…" />
              </Campo>
              <Campo rotulo="Sobre a imobiliária">
                <AreaTexto name="sobre" rows={4} defaultValue={config.sobre ?? ""} placeholder="Há quanto tempo atuam, diferenciais, região de atendimento…" />
              </Campo>
            </div>
          </Cartao>
          <Cartao titulo="Contatos no site">
            <div className="grid gap-4 sm:grid-cols-2">
              <Campo rotulo="WhatsApp" dica="Aparece no botão verde e nos anúncios.">
                <Entrada name="whatsapp" inputMode="tel" defaultValue={config.whatsapp ?? ""} placeholder="(11) 99999-9999" />
              </Campo>
              <Campo rotulo="Telefone">
                <Entrada name="telefone" inputMode="tel" defaultValue={config.telefone ?? ""} />
              </Campo>
              <Campo rotulo="E-mail">
                <Entrada name="email" type="email" defaultValue={config.email ?? ""} />
              </Campo>
              <Campo rotulo="CRECI">
                <Entrada name="creci" defaultValue={config.creci ?? ""} />
              </Campo>
              <Campo rotulo="Endereço da imobiliária" className="sm:col-span-2">
                <Entrada name="endereco" defaultValue={config.endereco ?? ""} />
              </Campo>
              <Campo rotulo="Instagram">
                <Entrada name="instagram" defaultValue={config.instagram ?? ""} placeholder="@suaimobiliaria" />
              </Campo>
              <Campo rotulo="Facebook">
                <Entrada name="facebook" defaultValue={config.facebook ?? ""} placeholder="facebook.com/…" />
              </Campo>
              <Campo rotulo="YouTube">
                <Entrada name="youtube" defaultValue={config.youtube ?? ""} placeholder="youtube.com/@…" />
              </Campo>
            </div>
          </Cartao>
          <Cartao titulo="Busca no Google">
            <div className="space-y-4">
              <Campo rotulo="Título no Google" dica="Até 60 letras. Ex.: Imobiliária Central — imóveis em Canoas">
                <Entrada name="seo_titulo" maxLength={70} defaultValue={config.seo_titulo ?? ""} placeholder={config.nome ?? organizacao.nome} />
              </Campo>
              <Campo rotulo="Descrição no Google" dica="Até 160 letras: o que aparece embaixo do título no resultado da busca.">
                <AreaTexto name="seo_descricao" rows={2} maxLength={200} defaultValue={config.seo_descricao ?? ""} />
              </Campo>
              <div className="rounded-[14px] border border-borda bg-elev p-4">
                <div className="text-xs text-mudo">Prévia no Google</div>
                <div className="mt-1 truncate text-[17px] text-acento">{config.seo_titulo || config.nome || organizacao.nome}</div>
                <div className="truncate text-xs text-ok">{linkSite}</div>
                <div className="mt-0.5 text-sm text-texto-2">{descricaoSeo(config.seo_descricao || config.slogan || `Imóveis para alugar e comprar com ${config.nome ?? organizacao.nome}.`)}</div>
              </div>
              <p className="text-xs text-mudo">
                Cada página do site já sai pronta para o Google (título, descrição, imagem para WhatsApp/Facebook e dados estruturados). Envie o mapa do site no Google Search Console:{" "}
                <span className="font-mono">{linkSite}/sitemap.xml</span>
              </p>
            </div>
          </Cartao>
          <Cartao titulo="Google Analytics">
            <Campo rotulo="Código de medição (GA4)" dica="No Google Analytics: Administrador → Fluxos de dados → seu site → “ID da métrica” (começa com G-).">
              <Entrada name="ga4_id" defaultValue={config.ga4_id ?? ""} placeholder="G-AB12CD34EF" />
            </Campo>
            <p className="mt-3 text-xs text-mudo">Com o código, o site mede as visitas e marca cada contato enviado como “generate_lead”.</p>
          </Cartao>
        </Formulario>

        <div className="space-y-6">
          <Cartao titulo="Logo">
            <LogoSite organizacaoId={organizacao.id} siteId={config.id} url={logo} />
          </Cartao>
          <Cartao titulo="Endereço e domínio próprio">
            <Formulario acao={salvarEnderecoSite} className="space-y-4">
              <input type="hidden" name="id" value={config.id} />
              <Campo rotulo="Endereço do site" dica={`${origem}/s/…`}>
                <Entrada name="slug" required defaultValue={config.slug} disabled={!admin} pattern="[a-z0-9][a-z0-9-]{1,48}[a-z0-9]" />
              </Campo>
              <Campo rotulo="Domínio próprio (opcional)" dica="O domínio que você já tem ou vai comprar, como minhaimobiliaria.com.br.">
                <Entrada name="dominio" defaultValue={config.dominio ?? ""} disabled={!admin} placeholder="minhaimobiliaria.com.br" />
              </Campo>
              {admin ? (
                <BotaoEnviar variante="secundario" confirmar="Salvar o endereço? Se você mudou o endereço, os links antigos passam a abrir a página inicial do novo (o endereço antigo fica reservado para a sua imobiliária por 12 meses).">
                  Salvar endereço
                </BotaoEnviar>
              ) : (
                <p className="text-xs text-mudo">Só administradores e gestores mudam o endereço e o domínio.</p>
              )}
            </Formulario>
            {config.dominio && (
              <div className="mt-5 space-y-3 border-t border-borda-suave pt-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-texto">{config.dominio}</span>
                  {config.dominio_verificado_em ? <Selo cor="verde">CONFIRMADO EM {formatarDataBR(config.dominio_verificado_em)}</Selo> : <Selo cor="amarelo">AGUARDANDO DNS</Selo>}
                  {admin && (
                    <BotaoAcao acao={verificarDominio} id={config.id} tamanho="sm">
                      Verificar agora
                    </BotaoAcao>
                  )}
                </div>
                <p className="text-sm text-texto-2">
                  No painel onde você comprou o domínio (Registro.br, GoDaddy, Hostinger…), crie estes três registros de DNS. O TXT prova que o domínio é seu: sem ele o
                  site não abre no domínio, mesmo que outra pessoa cadastre o mesmo endereço.
                </p>
                <div className="overflow-x-auto rounded-[12px] border border-borda">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="bg-elev text-left font-mono text-[10.5px] uppercase tracking-[0.1em] text-mudo">
                        <th className="px-3 py-2">Tipo</th>
                        <th className="px-3 py-2">Nome</th>
                        <th className="px-3 py-2">Valor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dns.map((r) => (
                        <tr key={r.tipo} className="border-t border-borda-suave">
                          <td className="px-3 py-2 font-semibold">{r.tipo}</td>
                          <td className="px-3 py-2">
                            <span className="mr-2 font-mono">{r.nome}</span>
                            {r.nome !== "@" && <Copiar texto={r.nome} />}
                          </td>
                          <td className="px-3 py-2">
                            <span className="mr-2 break-all font-mono">{r.valor}</span>
                            <Copiar texto={r.valor} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Aviso>
                  Depois de confirmado, a equipe do sistema liga o domínio na hospedagem (o certificado de segurança https sai sozinho). Até lá, use o endereço{" "}
                  <span className="font-mono">{linkSite}</span>.
                </Aviso>
              </div>
            )}
          </Cartao>
          <Cartao titulo="Links úteis">
            <ul className="space-y-2 text-sm">
              {[
                ["Página inicial", linkSite],
                ["Imóveis para alugar", `${linkSite}/imoveis?finalidade=locacao`],
                ["Imóveis à venda", `${linkSite}/imoveis?finalidade=venda`],
                ["Anuncie seu imóvel", `${linkSite}/anuncie`],
                ["Mapa do site (Google)", `${linkSite}/sitemap.xml`],
              ].map(([r, u]) => (
                <li key={u} className="flex flex-wrap items-center justify-between gap-2">
                  <a href={u} target="_blank" rel="noreferrer" className="text-acento hover:underline">
                    {r}
                  </a>
                  <Copiar texto={u} />
                </li>
              ))}
            </ul>
          </Cartao>
        </div>
      </div>
    </>
  );
}
