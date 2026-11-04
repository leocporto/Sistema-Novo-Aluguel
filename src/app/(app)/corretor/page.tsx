import type { Metadata } from "next";
import { BadgeDollarSign, Building2, CalendarDays, Handshake, PhoneCall, UserPlus } from "lucide-react";
import { Contador } from "@/components/abas-segmentadas";
import { Cartao, Indicador } from "@/components/ui";
import { contextoCorretor, portalCorretor, semVinculo, sufixo } from "./dados";
import { AvisoSemVinculo, TopoCorretor } from "./topo";

export const metadata: Metadata = { title: "Meu portal (corretor)" };

type Resumo = {
  pessoa: { id: string; nome: string; telefone: string | null; email: string | null };
  papel: string;
  imoveis: number;
  leads_abertos: number;
  leads_sem_contato: number;
  retornos_hoje: number;
  visitas_proximas: number;
  propostas_abertas: number;
  comissoes_a_receber: number | string;
  comissoes_mes: number | string;
};

/** Portal do corretor (só imobiliária): resumo do que é dele. */
export default async function CorretorPage({ searchParams }: PageProps<"/corretor">) {
  const ctx = await contextoCorretor(await searchParams);
  const d = await portalCorretor<Resumo>(ctx.supabase, "resumo", ctx.escolhido);
  const q = sufixo(ctx.escolhido);
  return (
    <>
      <TopoCorretor ctx={ctx} titulo="Meu portal" descricao="Sua carteira de imóveis, clientes e leads, visitas, propostas, metas, comissões e documentação — só o que é seu." />
      {semVinculo(d) ? (
        <AvisoSemVinculo ctx={ctx} />
      ) : (
        <div className="space-y-5">
          <p className="text-sm text-texto-2">
            Corretor: <b className="text-texto">{d.pessoa.nome}</b>
          </p>
          <div className="entrar-cascata grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Indicador rotulo="Imóveis na carteira" valor={<Contador valor={d.imoveis} />} icone={<Building2 />} href={`/corretor/imoveis${q}`} />
            <Indicador
              rotulo="Leads em aberto"
              valor={<Contador valor={d.leads_abertos} />}
              icone={<UserPlus />}
              href={`/corretor/leads${q}`}
              detalhe={d.leads_sem_contato ? `${d.leads_sem_contato} ainda sem contato` : "todos já atendidos"}
              tom={d.leads_sem_contato ? "alerta" : "neutro"}
            />
            <Indicador rotulo="Retornos para hoje" valor={<Contador valor={d.retornos_hoje} />} icone={<PhoneCall />} tom={d.retornos_hoje ? "alerta" : "sucesso"} href={`/corretor/leads${q}`} />
            <Indicador rotulo="Visitas agendadas" valor={<Contador valor={d.visitas_proximas} />} icone={<CalendarDays />} href={`/corretor/visitas${q}`} />
            <Indicador rotulo="Propostas em negociação" valor={<Contador valor={d.propostas_abertas} />} icone={<Handshake />} href={`/corretor/visitas${q}`} />
            <Indicador
              rotulo="Comissões a receber"
              valor={<Contador valor={Number(d.comissoes_a_receber)} formato="moeda" />}
              icone={<BadgeDollarSign />}
              href={`/corretor/comissoes${q}`}
              detalhe={`pagas neste mês: ${Number(d.comissoes_mes).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}`}
            />
          </div>
          <Cartao titulo="Como funciona">
            <p className="text-sm text-texto-2">
              Aqui aparece só o que está no seu nome: imóveis em que você é o corretor responsável, leads atribuídos a você, suas visitas e propostas e as
              comissões geradas para você. Para mudar etapas do lead, transferir ou criar propostas, use a ficha do lead no Comercial.
            </p>
          </Cartao>
        </div>
      )}
    </>
  );
}
