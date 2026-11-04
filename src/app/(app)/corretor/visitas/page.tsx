import type { Metadata } from "next";
import { Cartao, Celula, LinhaVazia, Selo, Tabela } from "@/components/ui";
import { ROTULO_INTERESSE, ROTULO_TIPO_COMPROMISSO, diaLocal, horaLocal } from "@/lib/dominio/agenda";
import { agoraMs, formatarDataBR } from "@/lib/dominio/datas";
import { formatarReais } from "@/lib/dominio/dinheiro";
import { ROTULO_STATUS_PROPOSTA, ROTULO_STATUS_VISITA, ROTULO_TIPO_PROPOSTA } from "@/lib/tipos";
import { contextoCorretor, portalCorretor, semVinculo } from "../dados";
import { AvisoSemVinculo, TopoCorretor } from "../topo";

export const metadata: Metadata = { title: "Visitas e propostas" };

type Visita = { id: string; data_hora: string; status: string; tipo: string; titulo: string | null; imovel: string | null; cliente: string | null; feedback_interesse: string | null };
type Proposta = { id: string; tipo: string; valor: number; status: string; criado_em: string; fechada_em: string | null; imovel: string | null; cliente: string | null; validade: string | null };

const corProposta = (s: string) => (s === "aceita" ? "verde" : s === "recusada" || s === "cancelada" ? "cinza" : "amarelo");

/** Visitas (últimos 60 dias e próximas) e propostas (12 meses) do corretor. */
export default async function VisitasCorretorPage({ searchParams }: PageProps<"/corretor/visitas">) {
  const ctx = await contextoCorretor(await searchParams);
  const [visitas, propostas] = await Promise.all([
    portalCorretor<Visita[]>(ctx.supabase, "visitas", ctx.escolhido),
    portalCorretor<Proposta[]>(ctx.supabase, "propostas", ctx.escolhido),
  ]);
  const agora = new Date(agoraMs()).toISOString();
  return (
    <>
      <TopoCorretor ctx={ctx} titulo="Visitas e propostas" descricao="Suas visitas marcadas e realizadas e as propostas em que você é o corretor. Marcar e remarcar é na Agenda; propostas no Comercial." />
      {semVinculo(visitas) || semVinculo(propostas) ? (
        <AvisoSemVinculo ctx={ctx} />
      ) : (
        <div className="space-y-5">
          <Cartao titulo="Visitas">
            <Tabela colunas={["Quando", "Imóvel", "Cliente", "Tipo", "Situação"]}>
              {visitas.length === 0 && <LinhaVazia colunas={5}>Nenhuma visita nos últimos 60 dias.</LinhaVazia>}
              {visitas.map((v) => (
                <tr key={v.id}>
                  <Celula className="whitespace-nowrap">
                    {formatarDataBR(diaLocal(v.data_hora))} {horaLocal(v.data_hora)}
                  </Celula>
                  <Celula>{v.imovel ?? "—"}</Celula>
                  <Celula>
                    {v.cliente ?? "—"}
                    {v.feedback_interesse && <span className="block text-xs text-mudo">{ROTULO_INTERESSE[v.feedback_interesse] ?? v.feedback_interesse}</span>}
                  </Celula>
                  <Celula>{ROTULO_TIPO_COMPROMISSO[v.tipo] ?? v.tipo}</Celula>
                  <Celula>
                    <Selo cor={v.status === "realizada" ? "verde" : v.status === "cancelada" ? "cinza" : v.data_hora >= agora ? "azul" : "amarelo"}>
                      {v.status === "agendada" && v.data_hora < agora ? "Sem retorno" : (ROTULO_STATUS_VISITA[v.status] ?? v.status)}
                    </Selo>
                  </Celula>
                </tr>
              ))}
            </Tabela>
          </Cartao>
          <Cartao titulo="Propostas">
            <Tabela colunas={["Data", "Imóvel", "Cliente", "Tipo", "Valor", "Situação"]}>
              {propostas.length === 0 && <LinhaVazia colunas={6}>Nenhuma proposta nos últimos 12 meses.</LinhaVazia>}
              {propostas.map((p) => (
                <tr key={p.id}>
                  <Celula>{formatarDataBR(diaLocal(p.criado_em))}</Celula>
                  <Celula>{p.imovel ?? "—"}</Celula>
                  <Celula>{p.cliente ?? "—"}</Celula>
                  <Celula>{ROTULO_TIPO_PROPOSTA[p.tipo] ?? p.tipo}</Celula>
                  <Celula className="tabular-nums">{formatarReais(p.valor)}</Celula>
                  <Celula>
                    <Selo cor={corProposta(p.status)}>{ROTULO_STATUS_PROPOSTA[p.status] ?? p.status}</Selo>
                    {p.fechada_em && <span className="block text-xs text-mudo">fechada em {formatarDataBR(p.fechada_em)}</span>}
                  </Celula>
                </tr>
              ))}
            </Tabela>
          </Cartao>
        </div>
      )}
    </>
  );
}
