import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, KeyRound, PlugZap, Send, TriangleAlert } from "lucide-react";
import { Contador } from "@/components/abas-segmentadas";
import { Aviso, BotaoLink, Cabecalho, Indicador, Selo } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { agoraMs } from "@/lib/dominio/datas";
import {
  CATEGORIAS_INTEGRACAO,
  COR_STATUS_INTEGRACAO,
  ROTULO_STATUS_INTEGRACAO,
  catalogoDoModo,
  statusIntegracao,
  type ItemCatalogo,
  type SinaisInternos,
} from "@/lib/dominio/integracoes";
import { AbasIntegracoes } from "./abas";
import { configsProvedores, contarChavesAtivas, resumoIntegracoes, sinaisInternos, type ConfigProvedor } from "./dados";

export const metadata: Metadata = { title: "Integrações" };

function Cartao({ item, cfg, sinais, pessoal, admin }: { item: ItemCatalogo; cfg?: ConfigProvedor; sinais: SinaisInternos; pessoal: boolean; admin: boolean }) {
  const st = statusIntegracao(item, cfg, sinais);
  const href = item.tipo === "provedor" ? `/integracoes/provedores/${item.id}` : ((pessoal ? item.hrefPessoal : undefined) ?? item.href ?? "/integracoes");
  const rotulo = item.tipo === "provedor" ? (admin ? "Configurar" : "Ver") : item.id === "nominatim" ? "Testar e usar" : "Abrir";
  return (
    <div className="flex h-full flex-col gap-3 rounded-card border border-borda bg-card p-5 transition hover:border-borda-forte">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-[15px] font-semibold leading-snug text-texto">{item.nome}</h3>
        <Selo cor={COR_STATUS_INTEGRACAO[st]}>{ROTULO_STATUS_INTEGRACAO[st]}</Selo>
      </div>
      <p className="flex-1 text-[13px] leading-relaxed text-texto-2">{item.descricao}</p>
      {item.tipo === "provedor" && !item.testavel && <p className="text-xs text-mudo">Estrutura pronta: liga quando houver contrato e credencial.</p>}
      {item.tipo === "provedor" && item.testavel && <p className="text-xs text-mudo">Estrutura pronta: a emissão depende de ligar o serviço (hoje só o teste de conexão).</p>}
      {cfg?.ultimo_teste_msg && <p className={`text-xs ${cfg.ultimo_teste_ok ? "text-ok" : "text-alerta"}`}>{cfg.ultimo_teste_msg}</p>}
      <div>
        <BotaoLink href={href} variante="secundario">
          {rotulo}
        </BotaoLink>
      </div>
    </div>
  );
}

/**
 * Integrações (nos dois modos; portais, anúncios e repasses só na
 * imobiliária): catálogo com status — o que já funciona no sistema leva à
 * tela existente; o que depende de contrato guarda a configuração e diz o que
 * falta.
 */
export default async function IntegracoesPage() {
  const { supabase, organizacao, papel } = await obterContexto();
  const pessoal = organizacao.modo === "pessoal";
  const admin = papel === "admin";
  const desde = new Date(agoraMs() - 7 * 86_400_000).toISOString();
  const [cfgs, resumo, chaves, { count: webhooks }] = await Promise.all([
    configsProvedores(supabase),
    resumoIntegracoes(supabase, desde),
    contarChavesAtivas(supabase),
    supabase.from("webhook_assinaturas").select("id", { count: "exact", head: true }).eq("ativo", true),
  ]);
  const sinais = await sinaisInternos(supabase, organizacao.id, pessoal, chaves, webhooks ?? 0);
  const porId = new Map(cfgs.map((c) => [c.provedor, c]));
  const itens = catalogoDoModo(organizacao.modo);
  const ativos = itens.filter((i) => statusIntegracao(i, porId.get(i.id), sinais) === "ativo").length;
  const falhas = (resumo.entregas.falhou ?? 0) + (resumo.entregas.desistiu ?? 0);

  return (
    <>
      <Cabecalho
        titulo="Integrações"
        descricao="Ligue o sistema a bancos, gateways, e-mail, agenda, contabilidade e às suas automações (n8n, Make, Zapier). Ativo = já está em uso na sua conta; Disponível no sistema = funciona aqui dentro, é só usar; o que depende de contrato fica pronto para ligar."
        acoes={
          admin ? (
            <>
              <BotaoLink href="/integracoes/chaves" variante="secundario">
                <KeyRound className="size-4" /> Chaves de API
              </BotaoLink>
              <BotaoLink href="/integracoes/webhooks">
                <Send className="size-4" /> Webhooks
              </BotaoLink>
            </>
          ) : undefined
        }
      />
      <AbasIntegracoes />
      {!admin && (
        <div className="mb-5">
          <Aviso>Você acompanha as integrações. Só o administrador cria chaves, webhooks e guarda credenciais.</Aviso>
        </div>
      )}
      <div className="entrar-cascata mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Indicador rotulo="Integrações ativas" valor={<Contador valor={ativos} />} icone={<CheckCircle2 />} tom="sucesso" detalhe={`de ${itens.length} no catálogo`} />
        <Indicador rotulo="Chaves de API ativas" valor={<Contador valor={chaves} />} icone={<KeyRound />} href="/integracoes/chaves" />
        <Indicador rotulo="Webhooks ligados" valor={<Contador valor={webhooks ?? 0} />} icone={<PlugZap />} href="/integracoes/webhooks" detalhe={`${resumo.fila} na fila`} />
        <Indicador
          rotulo="Entregas com falha (7 dias)"
          valor={<Contador valor={falhas} />}
          icone={<TriangleAlert />}
          tom={falhas ? "alerta" : "neutro"}
          href="/integracoes/monitoramento"
          detalhe={`${resumo.api_total} chamadas à API`}
        />
      </div>
      <div className="space-y-8">
        {CATEGORIAS_INTEGRACAO.filter((c) => !(pessoal && c.soImobiliaria)).map((cat) => {
          const lista = itens.filter((i) => i.categoria === cat.id);
          if (!lista.length) return null;
          return (
            <section key={cat.id} aria-labelledby={`cat-${cat.id}`}>
              <h2 id={`cat-${cat.id}`} className="mb-3 text-[17px] font-semibold tracking-[-0.01em] text-texto">
                {cat.rotulo}
              </h2>
              <div className="entrar-cascata grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                {lista.map((i) => (
                  <Cartao key={i.id} item={i} cfg={porId.get(i.id)} sinais={sinais} pessoal={pessoal} admin={admin} />
                ))}
              </div>
            </section>
          );
        })}
      </div>
      <p className="mt-8 text-xs text-mudo">
        Precisa de algo que não está aqui? Quase tudo se resolve com a{" "}
        <Link href="/integracoes/api" className="text-acento hover:underline">
          API e os webhooks
        </Link>{" "}
        num n8n, Make ou Zapier.
      </p>
    </>
  );
}
