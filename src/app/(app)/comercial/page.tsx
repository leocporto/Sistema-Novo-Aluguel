import type { Metadata } from "next";
import Link from "next/link";
import { CalendarCheck, Handshake, Inbox, MessageCircle, Phone, UserPlus, Users } from "lucide-react";
import { Contador } from "@/components/abas-segmentadas";
import { BotaoExcluir } from "@/components/botao-excluir";
import { Formulario } from "@/components/formulario";
import { FiltroAutomatico } from "@/components/filtro-automatico";
import { JanelaCadastro } from "@/components/janela-cadastro";
import { Cabecalho, Indicador, Selecao } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { agoraMs, hojeISO } from "@/lib/dominio/datas";
import { ROTULO_INTERESSE, ROTULO_ORIGEM_LEAD, ROTULO_STATUS_LEAD, type Lead, type StatusLead } from "@/lib/tipos";
import { linkWhatsapp } from "@/lib/whatsapp";
import { criarLead, excluirLead, mudarStatusLead } from "./actions";
import { AbasComercial, CamposLead } from "./campos";
import { carregarOpcoes } from "./dados";

export const metadata: Metadata = { title: "Leads" };

const ETAPAS: StatusLead[] = ["novo", "em_atendimento", "visita", "proposta", "ganho", "perdido"];
const COR_ETAPA: Record<StatusLead, string> = {
  novo: "bg-acento",
  em_atendimento: "bg-alerta",
  visita: "bg-violeta",
  proposta: "bg-acento-hot",
  ganho: "bg-ok",
  perdido: "bg-fraco",
};

function haQuanto(iso: string, agora: number) {
  const dias = Math.floor((agora - new Date(iso).getTime()) / 86_400_000);
  if (dias <= 0) return "hoje";
  if (dias === 1) return "ontem";
  return `há ${dias} dias`;
}

export default async function LeadsPage({ searchParams }: PageProps<"/comercial">) {
  const sp = await searchParams;
  const origem = typeof sp.origem === "string" ? sp.origem : "";
  const interesse = typeof sp.interesse === "string" ? sp.interesse : "";
  const { supabase } = await obterContexto();
  const hoje = hojeISO();
  const mes = hoje.slice(0, 7);

  let consulta = supabase.from("leads").select("*, imovel:imoveis(codigo)").order("created_at", { ascending: false });
  if (origem) consulta = consulta.eq("origem", origem);
  if (interesse) consulta = consulta.eq("interesse", interesse);
  const [{ data }, opcoes, { count: fechadosMes }] = await Promise.all([
    consulta,
    carregarOpcoes(supabase),
    supabase.from("propostas").select("id", { count: "exact", head: true }).eq("status", "aceita").gte("fechada_em", `${mes}-01`),
  ]);
  type L = Lead & { imovel: { codigo: string } | null };
  const leads = (data ?? []) as L[];
  const agora = agoraMs();
  const doMes = leads.filter((l) => l.created_at.slice(0, 7) === mes).length;
  const novos = leads.filter((l) => l.status === "novo");
  const emNegociacao = leads.filter((l) => l.status === "proposta").length;

  return (
    <>
      <Cabecalho
        titulo="Leads"
        trilha="Comercial"
        descricao="Quem procurou a imobiliária: do primeiro contato ao negócio fechado."
        acoes={
          <JanelaCadastro rotuloBotao={<><UserPlus className="size-4" /> Novo lead</>} titulo="Novo lead" acao={criarLead} icone={<UserPlus />}>
            <CamposLead imoveis={opcoes.imoveis} />
          </JanelaCadastro>
        }
      />
      <AbasComercial />

      <div className="entrar-cascata mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Indicador rotulo="Leads no mês" icone={<Users />} valor={<Contador valor={doMes} />} detalhe={`${leads.length} no total`} />
        <Indicador
          rotulo="Aguardando atendimento"
          icone={<Inbox />}
          valor={<Contador valor={novos.length} />}
          tom={novos.length ? "alerta" : "sucesso"}
          detalhe={novos.length ? `o mais antigo chegou ${haQuanto(novos[novos.length - 1].created_at, agora)}` : "ninguém esperando"}
        />
        <Indicador rotulo="Com proposta" icone={<Handshake />} valor={<Contador valor={emNegociacao} />} href="/comercial/propostas" />
        <Indicador rotulo="Negócios fechados no mês" icone={<CalendarCheck />} valor={<Contador valor={fechadosMes ?? 0} />} tom="sucesso" />
      </div>

      <FiltroAutomatico className="mb-4 flex flex-wrap gap-2">
        <Selecao name="origem" defaultValue={origem} className="w-48">
          <option value="">Todas as origens</option>
          {Object.entries(ROTULO_ORIGEM_LEAD).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Selecao>
        <Selecao name="interesse" defaultValue={interesse} className="w-48">
          <option value="">Alugar e comprar</option>
          {Object.entries(ROTULO_INTERESSE).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Selecao>
      </FiltroAutomatico>

      <div className="entrar-cascata grid auto-cols-[minmax(250px,1fr)] grid-flow-col gap-3 overflow-x-auto pb-3">
        {ETAPAS.map((etapa) => {
          const daEtapa = leads.filter((l) => l.status === etapa);
          return (
            <section key={etapa} className="flex min-h-40 flex-col rounded-card border border-borda bg-app p-2.5">
              <header className="mb-2 flex items-center gap-2 px-1.5 pt-1">
                <span className={`size-2.5 rounded-full ${COR_ETAPA[etapa]}`} />
                <h3 className="text-[14px] font-semibold text-texto">{ROTULO_STATUS_LEAD[etapa]}</h3>
                <span className="ml-auto rounded-full bg-card px-2 py-0.5 text-xs font-semibold text-texto-2">{daEtapa.length}</span>
              </header>
              <div className="flex flex-col gap-2">
                {daEtapa.map((l) => (
                  <article key={l.id} className="rounded-[14px] border border-borda bg-card p-3 transition hover:border-borda-forte">
                    <Link href={`/comercial/leads/${l.id}`} className="block">
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-semibold text-texto">{l.nome}</span>
                        <span className="whitespace-nowrap text-[11px] text-mudo">{haQuanto(l.created_at, agora)}</span>
                      </div>
                      <div className="mt-1 text-xs text-texto-2">
                        {ROTULO_INTERESSE[l.interesse]} · {ROTULO_ORIGEM_LEAD[l.origem] ?? l.origem}
                        {l.imovel ? ` · ${l.imovel.codigo}` : ""}
                      </div>
                    </Link>
                    <div className="mt-2.5 flex items-center gap-1.5">
                      <Formulario acao={mudarStatusLead} automatico salvarQuando="status" className="min-w-0 flex-1">
                        <input type="hidden" name="id" value={l.id} />
                        <select
                          name="status"
                          defaultValue={l.status}
                          aria-label={`Etapa de ${l.nome}`}
                          className="h-8 w-full rounded-[9px] border border-borda bg-input px-2 text-xs font-medium text-texto"
                        >
                          {ETAPAS.map((e) => (
                            <option key={e} value={e}>
                              {ROTULO_STATUS_LEAD[e]}
                            </option>
                          ))}
                        </select>
                      </Formulario>
                      <BotaoExcluir acao={excluirLead} id={l.id} rotulo={`Excluir ${l.nome}`} confirmar={`Excluir o lead "${l.nome}"?`} />
                      {l.telefone && (
                        <>
                          <a
                            href={linkWhatsapp(l.telefone, `Olá ${l.nome.split(" ")[0]}! Tudo bem?`)}
                            target="_blank"
                            rel="noreferrer"
                            title="WhatsApp"
                            className="grid size-8 place-items-center rounded-[9px] border border-ok-bd bg-ok-bg text-ok"
                          >
                            <MessageCircle className="size-4" />
                          </a>
                          <a href={`tel:${l.telefone}`} title="Ligar" className="grid size-8 place-items-center rounded-[9px] border border-borda text-texto-2">
                            <Phone className="size-4" />
                          </a>
                        </>
                      )}
                    </div>
                  </article>
                ))}
                {daEtapa.length === 0 && <p className="px-1.5 py-3 text-xs text-fraco">Nenhum.</p>}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}
