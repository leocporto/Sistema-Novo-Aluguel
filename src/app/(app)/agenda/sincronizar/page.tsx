import type { Metadata } from "next";
import { headers } from "next/headers";
import { Copiar } from "@/components/copiar";
import { Cabecalho, Cartao, classeBotao } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { AbasAgenda } from "../campos";
import { NovoLinkAgenda } from "./novo-link";

export const metadata: Metadata = { title: "Sincronizar agenda" };

/** Link para assinar a agenda no Google Agenda, iPhone ou Outlook (os lembretes tocam no celular). */
export default async function SincronizarPage() {
  const { supabase, organizacao, usuario } = await obterContexto();
  const { data } = await supabase.from("organizacoes").select("agenda_token").eq("id", organizacao.id).single();
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const base = `${host.startsWith("localhost") ? "http" : "https"}://${host}`;
  const todos = `${base}/api/agenda/${data?.agenda_token}.ics`;
  const minha = `${todos}?u=${usuario.id}`;
  const webcal = (u: string) => u.replace(/^https?:/, "webcal:");

  return (
    <>
      <Cabecalho titulo="Sincronizar com o celular" trilha="Agenda" descricao="Veja os compromissos no Google Agenda, no calendário do iPhone ou no Outlook — com lembrete automático antes de cada um." />
      <AbasAgenda />
      <div className="grid gap-6 xl:grid-cols-2">
        <Cartao titulo="Links da agenda">
          <div className="space-y-5 text-sm">
            <div>
              <div className="mb-1 font-medium text-texto">Minha agenda (meus + compartilhados)</div>
              <code className="block break-all rounded-[10px] border border-borda bg-elev p-2 text-xs text-texto-2">{minha}</code>
              <div className="mt-2 flex flex-wrap gap-2">
                <Copiar texto={minha} rotulo="Copiar link" />
                <a href={webcal(minha)} className={classeBotao("secundario", "sm")}>
                  Abrir no iPhone/Mac
                </a>
              </div>
            </div>
            <div>
              <div className="mb-1 font-medium text-texto">Agenda da equipe toda</div>
              <code className="block break-all rounded-[10px] border border-borda bg-elev p-2 text-xs text-texto-2">{todos}</code>
              <div className="mt-2 flex flex-wrap gap-2">
                <Copiar texto={todos} rotulo="Copiar link" />
              </div>
            </div>
            <p className="text-xs text-mudo">Quem tiver o link vê os compromissos. Se ele vazar, gere um novo — o antigo para de funcionar.</p>
            <NovoLinkAgenda />
          </div>
        </Cartao>
        <Cartao titulo="Como assinar">
          <ol className="list-decimal space-y-3 pl-5 text-sm text-texto-2">
            <li>
              <strong className="text-texto">Google Agenda (Android/computador):</strong> abra calendar.google.com no computador → “Outras agendas” → <em>+</em> → “Do URL” → cole o link → Adicionar. Aparece no
              celular sozinho.
            </li>
            <li>
              <strong className="text-texto">iPhone:</strong> toque em “Abrir no iPhone/Mac” ou vá em Ajustes → Calendário → Contas → Adicionar conta → Outra → “Adicionar calendário assinado” e cole o link.
            </li>
            <li>
              <strong className="text-texto">Outlook:</strong> Calendário → Adicionar calendário → “Assinar da Web” → cole o link.
            </li>
            <li>Os calendários atualizam sozinhos (o Google pode levar algumas horas). Cada compromisso já vem com o lembrete escolhido.</li>
            <li>Para um compromisso só, use os botões “Google Agenda” ou “.ics” na ficha dele.</li>
          </ol>
        </Cartao>
      </div>
    </>
  );
}
