import type { Metadata } from "next";
import { CalendarClock, Flame, Hourglass, Users } from "lucide-react";
import { Contador } from "@/components/abas-segmentadas";
import { LinhaLink } from "@/components/linha-link";
import { PilulasLink } from "@/components/pilulas-link";
import { Cabecalho, Celula, Indicador, LinhaVazia, Selo, Tabela } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { agoraMs, formatarDataBR, hojeISO } from "@/lib/dominio/datas";
import { faixaNota } from "@/lib/dominio/ia";
import { ROTULO_ORIGEM_LEAD, ROTULO_STATUS_LEAD, type StatusLead } from "@/lib/tipos";
import { AbasInteligencia } from "../abas";
import { carregarPrioridades } from "./dados";

export const metadata: Metadata = { title: "Prioridades de hoje" };

const CANAL = { whatsapp: "WhatsApp", ligacao: "Ligação", email: "E-mail" } as const;

/** Classificação e priorização de leads por regra (imobiliária), com o próximo contato sugerido. */
export default async function PrioridadesPage({ searchParams }: PageProps<"/inteligencia/prioridades">) {
  const sp = await searchParams;
  const { supabase, organizacao } = await obterContexto();
  const hoje = hojeISO();
  const { linhas, total } = await carregarPrioridades(supabase, { agoraMs: agoraMs(), hoje });
  const filtro = sp.ver === "todos" ? "todos" : "hoje";
  const paraHoje = linhas.filter((l) => l.proximo && l.proximo.quando <= hoje);
  const lista = filtro === "hoje" ? paraHoje : linhas;
  const altas = linhas.filter((l) => l.nota >= 70).length;
  const esperando = linhas.filter((l) => l.lead.status === "novo" && !l.lead.atendido_em).length;
  const base = "/inteligencia/prioridades";
  return (
    <>
      <Cabecalho
        titulo="Prioridades de hoje"
        trilha="Assistente e automações"
        descricao="Nota de 0 a 100 por regra (origem, etapa, tempo sem resposta, perfil completo, imóvel de interesse e contatos) e o próximo contato sugerido. Na ficha de cada lead dá para pedir a análise da IA."
      />
      <AbasInteligencia modo={organizacao.modo} />
      <div className="entrar-cascata mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Indicador rotulo="Leads em aberto" valor={<Contador valor={total} />} icone={<Users />} />
        <Indicador rotulo="Prioridade alta" valor={<Contador valor={altas} />} icone={<Flame />} tom={altas ? "perigo" : "neutro"} detalhe="nota 70 ou mais" />
        <Indicador rotulo="Contatos para hoje" valor={<Contador valor={paraHoje.length} />} icone={<CalendarClock />} tom={paraHoje.length ? "alerta" : "neutro"} />
        <Indicador rotulo="Esperando o 1º contato" valor={<Contador valor={esperando} />} icone={<Hourglass />} tom={esperando ? "alerta" : "neutro"} />
      </div>
      <PilulasLink
        className="mb-4"
        rotulo="Quais leads"
        ativo={filtro === "hoje" ? base : `${base}?ver=todos`}
        itens={[
          { href: base, rotulo: `Contatos para hoje (${paraHoje.length})` },
          { href: `${base}?ver=todos`, rotulo: `Todos em aberto (${total})` },
        ]}
      />
      {filtro === "todos" && total > linhas.length && (
        <p className="mb-3 text-xs text-mudo">
          Mostrando {linhas.length} de {total}: os 500 que chegaram por último, os com retorno combinado até hoje e os parados há 7 dias ou mais. Os demais estão em Comercial → Leads.
        </p>
      )}
      <Tabela colunas={["Lead", "Nota", "Etapa", "Origem", "Principal motivo", "Próximo contato"]}>
        {lista.length === 0 ? (
          <LinhaVazia colunas={6}>{filtro === "hoje" ? "Nenhum contato combinado ou sugerido para hoje." : "Nenhum lead em aberto."}</LinhaVazia>
        ) : (
          lista.slice(0, 200).map(({ lead, nota, fatores, proximo }) => {
            const f = faixaNota(nota);
            const principal = [...fatores].filter((x) => x.rotulo !== "Base").sort((a, b) => Math.abs(b.pontos) - Math.abs(a.pontos))[0];
            return (
              <LinhaLink key={lead.id} href={`${base}/${lead.id}`}>
                <Celula className="font-semibold">{lead.nome}</Celula>
                <Celula>
                  <Selo cor={f.cor}>{nota}</Selo>
                </Celula>
                <Celula>{ROTULO_STATUS_LEAD[lead.status as StatusLead] ?? lead.status}</Celula>
                <Celula className="text-texto-2">{ROTULO_ORIGEM_LEAD[lead.origem ?? ""] ?? lead.origem ?? "—"}</Celula>
                <Celula className="text-[13px] text-texto-2">{principal ? `${principal.rotulo} (${principal.pontos > 0 ? "+" : ""}${principal.pontos})` : "—"}</Celula>
                <Celula className="text-[13px]">
                  {proximo ? (
                    <>
                      <span className={proximo.quando < hoje ? "font-semibold text-ruim" : proximo.quando === hoje ? "font-semibold text-alerta" : "text-texto"}>
                        {proximo.quando === hoje ? "Hoje" : formatarDataBR(proximo.quando)}
                      </span>{" "}
                      · {CANAL[proximo.canal]}
                      <div className="text-xs text-mudo">{proximo.motivo}</div>
                    </>
                  ) : (
                    "—"
                  )}
                </Celula>
              </LinhaLink>
            );
          })
        )}
      </Tabela>
    </>
  );
}
