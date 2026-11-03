import type { Metadata } from "next";
import { Download, Handshake, Radar, Target, UserPlus } from "lucide-react";
import { Contador } from "@/components/abas-segmentadas";
import { PilulasLink } from "@/components/pilulas-link";
import { Aviso, Cabecalho, Cartao, Celula, classeBotao, Indicador, LinhaVazia, Selo, Tabela } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { agoraMs } from "@/lib/dominio/datas";
import { formatarReais } from "@/lib/dominio/dinheiro";
import { formatarDataHora, funilPorOrigem } from "@/lib/dominio/marketing";
import { ROTULO_ORIGEM_LEAD } from "@/lib/tipos";
import { AbasMarketing } from "../campos";
import { obterConfig } from "../dados";
import { carregarLeadsOrigem, PERIODOS, type LeadOrigem } from "./dados";

export const metadata: Metadata = { title: "Origem dos leads" };

const AGRUPAR: Record<string, { rotulo: string; chave: (l: LeadOrigem) => string | null }> = {
  origem: { rotulo: "Origem", chave: (l) => ROTULO_ORIGEM_LEAD[l.origem] ?? l.origem },
  fonte: { rotulo: "Fonte (utm_source)", chave: (l) => (l.utm_source ? `${l.utm_source}${l.utm_medium ? ` / ${l.utm_medium}` : ""}` : l.gclid ? "google / cpc" : l.fbclid ? "facebook / cpc" : null) },
  campanha: { rotulo: "Campanha (utm_campaign)", chave: (l) => l.utm_campaign },
  landing: { rotulo: "Landing page", chave: (l) => l.landing },
  sistema: { rotulo: "Campanha do sistema", chave: (l) => l.campanha },
};

const pct = (n: number | null) => (n === null ? "—" : `${String(n).replace(".", ",")}%`);

export default async function OrigemPage({ searchParams }: PageProps<"/marketing/origem">) {
  const sp = await searchParams;
  const periodo = typeof sp.periodo === "string" && sp.periodo in PERIODOS ? sp.periodo : "90";
  const agrupar = typeof sp.por === "string" && sp.por in AGRUPAR ? sp.por : "origem";
  const { supabase } = await obterContexto();
  const [leads, cfg, { data: anuncios }] = await Promise.all([
    carregarLeadsOrigem(supabase, periodo, agoraMs()),
    obterConfig(supabase),
    supabase.from("mkt_lead_ads").select("id, plataforma, status, recebido_em, lead:leads(id, nome)").order("recebido_em", { ascending: false }).limit(8),
  ]);
  const linhas = funilPorOrigem(leads, AGRUPAR[agrupar].chave);
  const rastreados = leads.filter((l) => l.utm_source || l.gclid || l.fbclid || l.landing).length;
  const negocios = leads.filter((l) => l.status === "ganho");
  const valor = negocios.reduce((s, l) => s + (l.valor ?? 0), 0);
  const comGclid = negocios.filter((l) => l.gclid).length;
  const url = (p: Record<string, string>) => {
    const q = new URLSearchParams({ periodo, por: agrupar, ...p });
    return `/marketing/origem?${q}`;
  };
  const exp = (formato: string, extra = "") => `/marketing/origem/exportar?formato=${formato}&periodo=${periodo}${extra}`;
  type A = { id: string; plataforma: string; status: string; recebido_em: string; lead: { id: string; nome: string } | null };

  return (
    <>
      <Cabecalho
        titulo="Origem dos leads"
        trilha="Marketing"
        descricao="De onde vêm os leads e quanto cada origem vira visita, proposta e negócio. As conversões podem voltar para o Google Ads e a Meta (CSV) para os anúncios aprenderem quem fecha."
        acoes={
          <a href={exp("leads")} className={classeBotao("secundario")}>
            <Download className="size-4" /> Leads com origem (CSV)
          </a>
        }
      />
      <AbasMarketing />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <PilulasLink rotulo="Período" ativo={url({ periodo })} itens={Object.entries(PERIODOS).map(([k, p]) => ({ href: url({ periodo: k }), rotulo: p.rotulo }))} />
        <PilulasLink rotulo="Agrupar por" ativo={url({ por: agrupar })} itens={Object.entries(AGRUPAR).map(([k, a]) => ({ href: url({ por: k }), rotulo: a.rotulo }))} />
      </div>
      <div className="entrar-cascata mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Indicador rotulo="Leads no período" icone={<UserPlus />} valor={<Contador valor={leads.length} />} />
        <Indicador
          rotulo="Com origem rastreada"
          icone={<Radar />}
          valor={<Contador valor={leads.length ? Math.round((rastreados / leads.length) * 100) : 0} formato="pct" />}
          detalhe={`${rastreados} com UTM, landing, gclid ou fbclid`}
          tom={leads.length && rastreados / leads.length < 0.3 ? "alerta" : "neutro"}
        />
        <Indicador rotulo="Negócios fechados" icone={<Handshake />} valor={<Contador valor={negocios.length} />} detalhe={`conversão de ${pct(leads.length ? Math.round((negocios.length / leads.length) * 1000) / 10 : null)}`} tom="sucesso" />
        <Indicador rotulo="Valor dos negócios" icone={<Target />} valor={<Contador valor={valor} formato="moeda" />} detalhe="venda = preço; locação = aluguel mensal" />
      </div>

      <Tabela colunas={[AGRUPAR[agrupar].rotulo, "Leads", "Visitaram", "Proposta", "Negócio", "Conversão", "Valor"]}>
        {linhas.map((l) => (
          <tr key={l.chave}>
            <Celula className="font-medium">{l.chave}</Celula>
            <Celula className="tabular-nums">{l.leads}</Celula>
            <Celula className="tabular-nums">{l.visitas}</Celula>
            <Celula className="tabular-nums">{l.propostas}</Celula>
            <Celula className="tabular-nums">{l.negocios}</Celula>
            <Celula className="tabular-nums">{pct(l.conversao)}</Celula>
            <Celula className="tabular-nums">{l.valor ? formatarReais(l.valor) : "—"}</Celula>
          </tr>
        ))}
        {linhas.length === 0 && <LinhaVazia colunas={7}>Nenhum lead no período.</LinhaVazia>}
      </Tabela>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Cartao titulo="Conversões offline (Google Ads e Meta)">
          <p className="text-sm text-texto-2">
            Baixe e importe na ferramenta de anúncios. Assim o Google e a Meta sabem quais cliques viraram negócio e mostram os anúncios para quem tem mais chance de fechar.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <a href={exp("google", "&evento=negocio")} className={classeBotao("secundario", "sm")}>
              <Download className="size-3.5" /> Google: negócios ({comGclid})
            </a>
            <a href={exp("google", "&evento=lead")} className={classeBotao("secundario", "sm")}>
              <Download className="size-3.5" /> Google: leads ({leads.filter((l) => l.gclid).length})
            </a>
            <a href={exp("meta")} className={classeBotao("secundario", "sm")}>
              <Download className="size-3.5" /> Meta: negócios ({negocios.filter((l) => l.email || l.telefone).length})
            </a>
          </div>
          <p className="mt-3 text-xs text-mudo">
            Google Ads: Metas › Conversões › Uploads (crie antes a conversão “Negócio fechado” ou “Lead”). Meta: Gerenciador de Eventos › Eventos offline › Carregar. O envio automático
            pela API (Google Ads API / Meta Conversions API) fica pronto para ligar quando houver as credenciais.
          </p>
        </Cartao>
        <Cartao titulo="Rastreamento nos anúncios">
          <ul className="space-y-2 text-sm">
            <li className="flex justify-between gap-2">
              <span className="text-texto-2">Pixel da Meta nas landing pages</span>
              {cfg.meta_pixel_id ? <Selo cor="verde">ligado</Selo> : <Selo>não configurado</Selo>}
            </li>
            <li className="flex justify-between gap-2">
              <span className="text-texto-2">Tag do Google nas landing pages</span>
              {cfg.google_tag_id ? <Selo cor="verde">ligada</Selo> : <Selo>não configurada</Selo>}
            </li>
            <li className="flex justify-between gap-2">
              <span className="text-texto-2">Conversão do Google Ads no envio do formulário</span>
              {cfg.google_conversao_label ? <Selo cor="verde">ligada</Selo> : <Selo>não configurada</Selo>}
            </li>
          </ul>
          <h4 className="mb-1 mt-4 text-sm font-semibold text-texto">Leads recebidos dos anúncios</h4>
          {!(anuncios ?? []).length ? (
            <p className="text-sm text-mudo">Nenhum ainda. Configure o webhook de Lead Ads na aba Integrações.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {((anuncios ?? []) as unknown as A[]).map((a) => (
                <li key={a.id} className="flex justify-between gap-2">
                  <span>
                    {a.plataforma === "google" ? "Google" : a.plataforma === "meta" ? "Meta" : "Outro"}: {a.lead?.nome ?? (a.status === "sem_dados" ? "aguardando token da página (Meta)" : a.status)}
                  </span>
                  <span className="text-xs text-mudo">{formatarDataHora(a.recebido_em)}</span>
                </li>
              ))}
            </ul>
          )}
        </Cartao>
      </div>
      {leads.length > 0 && rastreados === 0 && (
        <div className="mt-6">
          <Aviso tipo="alerta">Nenhum lead com origem rastreada. Use os links com UTM das landing pages nos anúncios e posts.</Aviso>
        </div>
      )}
    </>
  );
}
