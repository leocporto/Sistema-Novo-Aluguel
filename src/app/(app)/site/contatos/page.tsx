import type { Metadata } from "next";
import Link from "next/link";
import { CalendarCheck, HousePlus, Inbox, Megaphone } from "lucide-react";
import { Contador } from "@/components/abas-segmentadas";
import { BotaoExcluir } from "@/components/botao-excluir";
import { PilulasLink } from "@/components/pilulas-link";
import { Cabecalho, Celula, Indicador, LinhaVazia, Selo, Tabela } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { hojeISO, somarDias } from "@/lib/dominio/datas";
import { PORTAIS, ehPortal } from "@/lib/dominio/site-portais";
import { linkWhatsapp } from "@/lib/whatsapp";
import { AbasSite } from "../abas";
import { excluirSolicitacao } from "../actions";

export const metadata: Metadata = { title: "Contatos recebidos" };

const TIPOS: Record<string, string> = { "": "Todos", contato: "Mensagens", visita: "Visitas", captacao: "Anuncie seu imóvel", empreendimento: "Lançamentos", portal: "Portais" };
const COR = { contato: "azul", visita: "verde", captacao: "amarelo", empreendimento: "azul", portal: "cinza" } as const;

type Sol = {
  id: string;
  tipo: keyof typeof COR;
  origem: string;
  nome: string | null;
  telefone: string | null;
  email: string | null;
  mensagem: string | null;
  lead_id: string | null;
  captacao_id: string | null;
  visita_id: string | null;
  visita_em: string | null;
  duplicado: boolean;
  created_at: string;
  imovel: { id: string; codigo: string } | null;
  empreendimento: { id: string; nome: string } | null;
};

const dataHora = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });

/** Tudo que chegou pelo site e pelos portais, com o caminho para o lead, a captação ou a visita. */
export default async function ContatosSitePage({ searchParams }: PageProps<"/site/contatos">) {
  const sp = await searchParams;
  const tipo = typeof sp.tipo === "string" && sp.tipo in TIPOS ? sp.tipo : "";
  const { supabase } = await obterContexto();
  const desde = `${somarDias(hojeISO(), -30)}T00:00:00-03:00`;
  let q = supabase
    .from("site_solicitacoes")
    .select("id, tipo, origem, nome, telefone, email, mensagem, lead_id, captacao_id, visita_id, visita_em, duplicado, created_at, imovel:imoveis(id, codigo), empreendimento:empreendimentos(id, nome)")
    .order("created_at", { ascending: false })
    .limit(300);
  if (tipo) q = q.eq("tipo", tipo);
  const conta = (t: string) => supabase.from("site_solicitacoes").select("id", { count: "exact", head: true }).eq("tipo", t).gte("created_at", desde);
  const [{ data }, { count: mensagens }, { count: visitas }, { count: anuncios }, { count: portais }] = await Promise.all([q, conta("contato"), conta("visita"), conta("captacao"), conta("portal")]);
  const lista = (data ?? []) as unknown as Sol[];
  const url = (t: string) => `/site/contatos${t ? `?tipo=${t}` : ""}`;

  return (
    <>
      <Cabecalho
        titulo="Contatos recebidos"
        trilha="Site e portais"
        descricao="Mensagens, pedidos de visita e anúncios enviados pelo site, e os leads que os portais mandaram. Cada um já está no Comercial, na Agenda ou na Captação."
      />
      <AbasSite />
      <div className="entrar-cascata mb-6 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Indicador rotulo="Mensagens (30 dias)" icone={<Inbox />} valor={<Contador valor={mensagens ?? 0} />} href={url("contato")} />
        <Indicador rotulo="Visitas pedidas (30 dias)" icone={<CalendarCheck />} valor={<Contador valor={visitas ?? 0} />} href={url("visita")} />
        <Indicador rotulo="Proprietários (30 dias)" icone={<HousePlus />} valor={<Contador valor={anuncios ?? 0} />} detalhe="pelo “Anuncie seu imóvel”" href={url("captacao")} />
        <Indicador rotulo="Leads dos portais (30 dias)" icone={<Megaphone />} valor={<Contador valor={portais ?? 0} />} href={url("portal")} />
      </div>
      <PilulasLink className="mb-4" rotulo="Tipo de contato" ativo={url(tipo)} itens={Object.entries(TIPOS).map(([k, r]) => ({ href: url(k), rotulo: r }))} />
      <Tabela colunas={["Quando", "Tipo", "Quem", "Sobre", "Mensagem", "Encaminhado para", ""]}>
        {lista.map((s) => {
          const destino = s.visita_id
            ? { href: `/agenda/${s.visita_id}`, rotulo: "Visita na Agenda" }
            : s.captacao_id
              ? { href: `/captacao/${s.captacao_id}`, rotulo: "Captação" }
              : s.lead_id
                ? { href: `/comercial/leads/${s.lead_id}`, rotulo: "Lead no Comercial" }
                : null;
          return (
            <tr key={s.id}>
              <Celula className="whitespace-nowrap text-xs text-texto-2">{dataHora(s.created_at)}</Celula>
              <Celula>
                <Selo cor={COR[s.tipo] ?? "cinza"}>{(s.tipo === "portal" && ehPortal(s.origem) ? PORTAIS[s.origem].nome : TIPOS[s.tipo] ?? s.tipo).toUpperCase()}</Selo>
                {s.duplicado && <span className="mt-1 block text-[11px] text-mudo">já estava em atendimento</span>}
              </Celula>
              <Celula>
                <span className="font-medium text-texto">{s.nome ?? "—"}</span>
                <span className="block text-xs text-mudo">{[s.telefone, s.email].filter(Boolean).join(" · ")}</span>
              </Celula>
              <Celula className="text-xs">
                {s.imovel ? (
                  <Link href={`/imoveis/${s.imovel.id}`} className="font-semibold text-acento hover:underline">
                    {s.imovel.codigo}
                  </Link>
                ) : s.empreendimento ? (
                  <Link href={`/empreendimentos/${s.empreendimento.id}`} className="font-semibold text-acento hover:underline">
                    {s.empreendimento.nome}
                  </Link>
                ) : (
                  "—"
                )}
                {s.visita_em && <span className="block text-mudo">visita {dataHora(s.visita_em)}</span>}
              </Celula>
              <Celula className="max-w-72 text-xs text-texto-2">
                <span className="line-clamp-3 whitespace-pre-line">{s.mensagem ?? "—"}</span>
              </Celula>
              <Celula className="text-xs">
                {destino ? (
                  <Link href={destino.href} className="font-semibold text-acento hover:underline">
                    {destino.rotulo}
                  </Link>
                ) : (
                  <span className="text-mudo">—</span>
                )}
              </Celula>
              <Celula>
                <span className="flex items-center justify-end gap-2">
                  {s.telefone && (
                    <a href={linkWhatsapp(s.telefone, `Olá ${(s.nome ?? "").split(" ")[0]}! Recebemos seu contato pelo site.`)} target="_blank" rel="noreferrer" className="whitespace-nowrap text-xs font-semibold text-acento hover:underline">
                      WhatsApp
                    </a>
                  )}
                  <BotaoExcluir acao={excluirSolicitacao} id={s.id} rotulo="Excluir contato" confirmar="Excluir este registro? O lead, a captação ou a visita que ele gerou continuam no sistema." />
                </span>
              </Celula>
            </tr>
          );
        })}
        {lista.length === 0 && <LinhaVazia colunas={7}>Nenhum contato recebido ainda.</LinhaVazia>}
      </Tabela>
      {lista.length >= 300 && <p className="mt-3 text-sm text-mudo">Mostrando os 300 mais recentes.</p>}
    </>
  );
}
