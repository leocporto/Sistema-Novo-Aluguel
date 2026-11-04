import type { Metadata } from "next";
import { CheckCheck, Download } from "lucide-react";
import { BotaoAcao } from "@/components/botao-acao";
import { PilulasLink } from "@/components/pilulas-link";
import { classeBotao } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { agoraMs } from "@/lib/dominio/datas";
import { marcarEmailsEnviados } from "../../../actions";
import { TabelaEnvios, type EnvioLista } from "../../../tabela-envios";

export const metadata: Metadata = { title: "Fila da campanha" };

const FILTROS: Record<string, string> = { "": "Todos", pendente: "Para enviar", enviado: "Enviados", bloqueado: "Descadastrados", falhou: "Falharam", cancelado: "Cancelados" };

export default async function EnviosCampanhaPage({ params, searchParams }: PageProps<"/marketing/campanhas/[id]/envios">) {
  const { id } = await params;
  const sp = await searchParams;
  const filtro = typeof sp.situacao === "string" && sp.situacao in FILTROS ? sp.situacao : "";
  const { supabase } = await obterContexto();
  let q = supabase.from("mkt_envios").select("*").eq("campanha_id", id).order("status").order("nome").limit(1000);
  if (filtro) q = q.eq("status", filtro);
  const agora = new Date(agoraMs()).toISOString();
  const [{ data }, { count: emailsParaCsv }] = await Promise.all([
    q,
    supabase.from("mkt_envios").select("id", { count: "exact", head: true }).eq("campanha_id", id).eq("status", "pendente").eq("canal", "email").lte("created_at", agora),
  ]);
  const base = `/marketing/campanhas/${id}/envios`;
  const url = (k: string) => (k ? `${base}?situacao=${k}` : base);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <PilulasLink rotulo="Situação do envio" ativo={url(filtro)} itens={Object.entries(FILTROS).map(([k, r]) => ({ href: url(k), rotulo: r }))} />
        <div className="flex flex-wrap gap-2">
          <a href={`/marketing/fila/exportar?campanha=${id}`} className={classeBotao("secundario")}>
            <Download className="size-4" /> Exportar planilha
          </a>
          {/* Só quando a campanha tem e-mails para enviar (campanha de WhatsApp/SMS não sai no CSV de e-mail). */}
          {(emailsParaCsv ?? 0) > 0 && (
            <a
              href={`/marketing/fila/exportar?${new URLSearchParams({ campanha: id, formato: "email", ate: agora })}`}
              className={classeBotao("secundario")}
              title="E-mail, nome, assunto e mensagem — para Mailchimp, Brevo, RD Station"
            >
              <Download className="size-4" /> CSV para e-mail marketing
            </a>
          )}
          {(emailsParaCsv ?? 0) > 0 && (
            <BotaoAcao
              acao={marcarEmailsEnviados}
              id={`${id}|${agora}`}
              confirmar={`Já disparou pela ferramenta de e-mail? Marcar como enviados os ${emailsParaCsv} e-mail(s) do CSV desta campanha (eles entram no histórico do lead/da pessoa)? Quem pediu para não receber fica de fora.`}
            >
              <CheckCheck className="size-4" /> Marcar os {emailsParaCsv} e-mails do CSV como enviados
            </BotaoAcao>
          )}
        </div>
      </div>
      <TabelaEnvios envios={(data ?? []) as EnvioLista[]} mostrarCampanha={false} vazio="Nada aqui. Monte a fila na aba “Mensagem e público”." />
      {(data ?? []).length >= 1000 && <p className="mt-3 text-sm text-alerta">Mostrando os primeiros 1.000. Exporte o CSV para ver todos.</p>}
    </>
  );
}
