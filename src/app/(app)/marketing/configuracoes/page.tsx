import type { Metadata } from "next";
import { RefreshCw } from "lucide-react";
import { BotaoAcao } from "@/components/botao-acao";
import { Copiar } from "@/components/copiar";
import { Formulario } from "@/components/formulario";
import { AreaTexto, Aviso, Cabecalho, Campo, Cartao, Entrada, Selo } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { salvarConfig, trocarCodigo } from "../actions";
import { AbasMarketing } from "../campos";
import { obterConfig, urlBase } from "../dados";

export const metadata: Metadata = { title: "Integrações de marketing" };

const caixaCodigo = "mt-1 overflow-x-auto whitespace-nowrap rounded-[10px] border border-borda bg-elev px-3 py-2 font-mono text-[12px] text-texto";

function Codigo({ rotulo, valor, trocar, podeTrocar }: { rotulo: string; valor: string; trocar?: string; podeTrocar: boolean }) {
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-mudo">{rotulo}</span>
        <span className="flex items-center gap-2">
          <Copiar texto={valor} />
          {trocar && podeTrocar && (
            <BotaoAcao acao={trocarCodigo} id={trocar} tamanho="sm" variante="fantasma" confirmar="Gerar um novo código? O anterior para de funcionar (atualize onde ele estiver cadastrado).">
              <RefreshCw className="size-3.5" /> Trocar
            </BotaoAcao>
          )}
        </span>
      </div>
      <div className={caixaCodigo}>{valor}</div>
    </div>
  );
}

export default async function IntegracoesPage() {
  const { supabase, papel } = await obterContexto();
  const cfg = await obterConfig(supabase);
  const base = await urlBase();
  const gestor = papel === "admin" || papel === "gestor";
  const urlWhatsapp = `${base}/api/marketing/whatsapp/${cfg.webhook_token}`;
  const urlLeadAds = `${base}/api/marketing/lead-ads/${cfg.webhook_token}`;
  const v = (s: string | null) => s ?? "";

  return (
    <>
      <Cabecalho
        titulo="Integrações"
        trilha="Marketing"
        descricao="WhatsApp Business, Meta Ads, Google Ads e e-mail. O que depende de contrato ou credencial fica indicado — a estrutura (filas, registros, webhooks) já está pronta."
        acoes={
          gestor ? (
            <BotaoAcao acao={trocarCodigo} id="webhook" confirmar="Trocar o endereço dos webhooks? Os endereços antigos param de funcionar e precisam ser atualizados na Meta e no Google.">
              <RefreshCw className="size-4" /> Trocar endereço dos webhooks
            </BotaoAcao>
          ) : null
        }
      />
      <AbasMarketing />
      {!gestor && (
        <div className="mb-4">
          <Aviso tipo="alerta">Só administradores e gestores mudam estas configurações. Você pode consultar e copiar os endereços.</Aviso>
        </div>
      )}
      <Formulario acao={salvarConfig} automatico className="grid gap-6 xl:grid-cols-2">
        <fieldset disabled={!gestor} className="contents">
          <Cartao titulo="WhatsApp Business (API oficial / Cloud API)" acoes={<Selo cor="amarelo">envio: precisa de credencial</Selo>}>
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Campo rotulo="Número do WhatsApp da empresa">
                  <Entrada name="whatsapp_numero" defaultValue={v(cfg.whatsapp_numero)} placeholder="(11) 99999-9999" />
                </Campo>
                <Campo rotulo="Phone number ID (Meta)">
                  <Entrada name="whatsapp_phone_number_id" defaultValue={v(cfg.whatsapp_phone_number_id)} />
                </Campo>
                <Campo rotulo="WhatsApp Business Account ID">
                  <Entrada name="whatsapp_waba_id" defaultValue={v(cfg.whatsapp_waba_id)} />
                </Campo>
              </div>
              <label className="flex items-center gap-2 text-sm text-texto-2">
                <input type="hidden" name="whatsapp_cria_lead" value="" />
                <input type="checkbox" name="whatsapp_cria_lead" defaultChecked={cfg.whatsapp_cria_lead} className="size-4" /> Número desconhecido que mandar mensagem vira lead (origem WhatsApp)
              </label>
              <Codigo rotulo="URL de retorno (Callback URL)" valor={urlWhatsapp} podeTrocar={false} />
              <Codigo rotulo="Token de verificação (Verify token)" valor={cfg.whatsapp_verify_token} trocar="whatsapp" podeTrocar={gestor} />
              <p className="text-xs text-mudo">
                <b>Já funciona:</b> receber mensagens na caixa de entrada (Conversas), ligar ao lead/pessoa pelo telefone e tratar “SAIR”. Cadastre a URL e o token no app da
                Meta (WhatsApp › Configuração › Webhooks, campo “messages”). <b>Para ligar depois:</b> enviar pela API sem abrir o WhatsApp exige o token de acesso permanente
                do app e modelos aprovados pela Meta — a fila de envio já está pronta para isso.
              </p>
            </div>
          </Cartao>

          <Cartao titulo="Meta Ads (Facebook e Instagram)">
            <div className="space-y-4">
              <Campo rotulo="ID do pixel da Meta" dica="Vai para as landing pages: visita e lead contam como evento (PageView e Lead).">
                <Entrada name="meta_pixel_id" inputMode="numeric" defaultValue={v(cfg.meta_pixel_id)} placeholder="123456789012345" />
              </Campo>
              <Codigo rotulo="Lead Ads — URL do webhook" valor={urlLeadAds} podeTrocar={false} />
              <Codigo rotulo="Lead Ads — token de verificação" valor={cfg.meta_verify_token} trocar="meta" podeTrocar={gestor} />
              <p className="text-xs text-mudo">
                A Meta avisa que chegou um lead (campo “leadgen”) e o aviso fica guardado. <b>Para ligar depois:</b> buscar nome e telefone do lead exige o token da página
                (Graph API). Enquanto isso, use Zapier/Make mandando os dados para a mesma URL (formato simples abaixo) ou baixe os leads no Gerenciador de Anúncios.
              </p>
            </div>
          </Cartao>

          <Cartao titulo="Google Ads">
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Campo rotulo="Tag do Google (G- ou AW-)">
                  <Entrada name="google_tag_id" defaultValue={v(cfg.google_tag_id)} placeholder="AW-123456789" />
                </Campo>
                <Campo rotulo="Conversão de lead (AW-…/rótulo)" dica="Dispara quando alguém envia o formulário da landing page.">
                  <Entrada name="google_conversao_label" defaultValue={v(cfg.google_conversao_label)} placeholder="AW-123456789/AbCdEfGh" />
                </Campo>
              </div>
              <Codigo rotulo="Formulário de lead — URL do webhook" valor={urlLeadAds} podeTrocar={false} />
              <Codigo rotulo="Formulário de lead — chave (key)" valor={cfg.google_lead_key} trocar="google" podeTrocar={gestor} />
              <p className="text-xs text-mudo">
                <b>Já funciona:</b> no Google Ads, no formulário de lead, escolha “Integração com webhook” e cole a URL e a chave — o lead cai no Comercial com o gclid. As
                conversões offline saem em CSV na aba Origem dos leads. <b>Para ligar depois:</b> envio automático das conversões pela API do Google Ads.
              </p>
            </div>
          </Cartao>

          <Cartao titulo="E-mail e mensagens" acoes={<Selo cor="amarelo">envio automático: precisa de provedor</Selo>}>
            <div className="space-y-4">
              <Campo rotulo="E-mail que aparece como remetente" dica="Usado quando um provedor de e-mail for ligado (Resend, SendGrid, Amazon SES…). Hoje o e-mail abre no seu programa.">
                <Entrada name="email_remetente" type="email" defaultValue={v(cfg.email_remetente)} />
              </Campo>
              <Campo rotulo="Assinatura">
                <AreaTexto name="assinatura" rows={2} defaultValue={v(cfg.assinatura)} />
              </Campo>
              <Campo rotulo="Pergunta da pesquisa de satisfação" dica="Use {{imobiliaria}} para o nome da imobiliária.">
                <Entrada name="pesquisa_pergunta" defaultValue={v(cfg.pesquisa_pergunta)} placeholder="De 0 a 10, quanto você recomendaria a {{imobiliaria}} para um amigo?" />
              </Campo>
            </div>
          </Cartao>
        </fieldset>
      </Formulario>

      <div className="mt-6">
        <Cartao titulo="Leads por integração (Zapier, Make, site)">
          <p className="text-sm text-texto-2">Mande um POST em JSON para a URL de Lead Ads. O lead entra no Comercial sem repetir quem já está em atendimento.</p>
          <div className="mt-2 overflow-x-auto whitespace-pre-wrap break-all rounded-[12px] border border-borda bg-elev p-3 font-mono text-[12px] text-texto">
            {`curl -X POST ${urlLeadAds} \\\n  -H "Content-Type: application/json" \\\n  -d '{"nome":"Maria","telefone":"11999999999","email":"maria@exemplo.com","utm_source":"facebook","utm_campaign":"lancamento","funil":"venda"}'`}
          </div>
        </Cartao>
      </div>
    </>
  );
}
