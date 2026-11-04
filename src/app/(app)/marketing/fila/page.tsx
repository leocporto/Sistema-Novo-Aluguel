import type { Metadata } from "next";
import { CheckCheck, Download } from "lucide-react";
import { BotaoAcao } from "@/components/botao-acao";
import { FiltroAutomatico } from "@/components/filtro-automatico";
import { PilulasLink } from "@/components/pilulas-link";
import { Aviso, Cabecalho, classeBotao, Entrada, Selecao } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { agoraMs } from "@/lib/dominio/datas";
import { ROTULO_CANAL } from "@/lib/dominio/marketing";
import { processarAutomacoes } from "../automacao";
import { marcarEmailsEnviados } from "../actions";
import { AbasMarketing } from "../campos";
import { urlBase } from "../dados";
import { TabelaEnvios, type EnvioLista } from "../tabela-envios";

export const metadata: Metadata = { title: "Fila de envio" };

const FILTROS: Record<string, string> = { "": "Para enviar agora", agendado: "Agendados", enviado: "Enviados", bloqueado: "Descadastrados", problemas: "Falhas e cancelados" };

export default async function FilaPage({ searchParams }: PageProps<"/marketing/fila">) {
  const sp = await searchParams;
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const filtro = s("situacao") in FILTROS ? s("situacao") : "";
  const canal = s("canal") in ROTULO_CANAL ? s("canal") : "";
  const busca = s("busca").replace(/[%,()]/g, " ").trim();
  const { supabase, organizacao } = await obterContexto();
  await processarAutomacoes(supabase, { base: await urlBase(), imobiliaria: organizacao.nome }).catch(() => null);
  const agora = new Date(agoraMs()).toISOString();

  let q = supabase.from("mkt_envios").select("*, campanha:mkt_campanhas(id, nome), automacao:mkt_automacoes(nome)").limit(500);
  if (filtro === "") q = q.eq("status", "pendente").lte("agendado_para", agora).order("agendado_para");
  if (filtro === "agendado") q = q.eq("status", "pendente").gt("agendado_para", agora).order("agendado_para");
  if (filtro === "enviado") q = q.eq("status", "enviado").order("enviado_em", { ascending: false });
  if (filtro === "bloqueado") q = q.eq("status", "bloqueado").order("created_at", { ascending: false });
  if (filtro === "problemas") q = q.in("status", ["falhou", "cancelado"]).order("created_at", { ascending: false });
  if (canal) q = q.eq("canal", canal);
  if (busca) q = q.or(`nome.ilike.%${busca}%,telefone.ilike.%${busca}%,email.ilike.%${busca}%`);
  const [{ data }, { count: emailsParaCsv }] = await Promise.all([
    q,
    supabase.from("mkt_envios").select("id", { count: "exact", head: true }).eq("status", "pendente").eq("canal", "email").lte("agendado_para", agora).lte("created_at", agora),
  ]);
  const envios = (data ?? []) as EnvioLista[];
  const url = (k: string) => {
    const p = new URLSearchParams(Object.entries({ situacao: k, canal, busca }).filter(([, v]) => v) as [string, string][]);
    return `/marketing/fila${p.size ? `?${p}` : ""}`;
  };
  const exportar = `/marketing/fila/exportar?${new URLSearchParams(Object.entries({ situacao: filtro || "agora", canal }).filter(([, v]) => v) as [string, string][])}`;

  return (
    <>
      <Cabecalho
        titulo="Fila de envio"
        trilha="Marketing"
        descricao="Tudo o que as campanhas, automações, sugestões e pesquisas mandaram enviar. Clique em “Abrir e enviar”: o WhatsApp (ou e-mail/SMS) abre com a mensagem pronta e o envio fica registrado no histórico do lead/da pessoa."
        acoes={
          <>
            <a href={exportar} className={classeBotao("secundario")}>
              <Download className="size-4" /> Exportar planilha
            </a>
            <a
              href={`/marketing/fila/exportar?${new URLSearchParams({ situacao: "agora", canal: "email", formato: "email", ate: agora })}`}
              className={classeBotao("secundario")}
              title="E-mail, nome, assunto e mensagem — para Mailchimp, Brevo, RD Station"
            >
              <Download className="size-4" /> CSV para e-mail marketing
            </a>
            {(emailsParaCsv ?? 0) > 0 && (
              <BotaoAcao
                acao={marcarEmailsEnviados}
                id={`fila|${agora}`}
                confirmar={`Já disparou pela ferramenta de e-mail? Marcar como enviados os ${emailsParaCsv} e-mail(s) do CSV (eles entram no histórico do lead/da pessoa)? Quem pediu para não receber fica de fora.`}
              >
                <CheckCheck className="size-4" /> Marcar os {emailsParaCsv} e-mails do CSV como enviados
              </BotaoAcao>
            )}
          </>
        }
      />
      <AbasMarketing />
      <div className="mb-4">
        <Aviso>
          Sem a API oficial do WhatsApp Business ou um provedor de e-mail, o envio é assistido: um clique por mensagem. Para e-mail em quantidade, exporte o CSV, importe na sua
          ferramenta (Mailchimp, Brevo, RD…), dispare e depois clique em “Marcar os e-mails do CSV como enviados”. Quando a integração for contratada, esta mesma fila passa a sair sozinha na hora agendada.
        </Aviso>
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <PilulasLink rotulo="Situação" ativo={url(filtro)} itens={Object.entries(FILTROS).map(([k, r]) => ({ href: url(k), rotulo: r }))} />
        <FiltroAutomatico className="filtros-linha">
          {filtro && <input type="hidden" name="situacao" value={filtro} />}
          <Entrada name="busca" aria-label="Buscar na fila" defaultValue={busca} placeholder="Buscar nome, telefone, e-mail…" className="max-w-72" />
          <Selecao name="canal" aria-label="Filtrar por canal" defaultValue={canal} className="w-44">
            <option value="">Todos os canais</option>
            {Object.entries(ROTULO_CANAL).map(([k, r]) => (
              <option key={k} value={k}>
                {r}
              </option>
            ))}
          </Selecao>
        </FiltroAutomatico>
      </div>
      <TabelaEnvios envios={envios} vazio={filtro === "" ? "Nada para enviar agora." : "Nada aqui."} />
      {envios.length >= 500 && <p className="mt-3 text-sm text-alerta">Mostrando 500 por vez. Envie estes (ou exporte o CSV) para ver os próximos.</p>}
    </>
  );
}
