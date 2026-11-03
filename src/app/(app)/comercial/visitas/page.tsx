import type { Metadata } from "next";
import Link from "next/link";
import { CalendarPlus, Check, MessageCircle, X } from "lucide-react";
import { BotaoExcluir } from "@/components/botao-excluir";
import { JanelaCadastro } from "@/components/janela-cadastro";
import { Cabecalho, Selo } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { hojeISO, somarDias } from "@/lib/dominio/datas";
import { ROTULO_STATUS_VISITA } from "@/lib/tipos";
import { linkWhatsapp } from "@/lib/whatsapp";
import { criarVisita, excluirVisita, mudarStatusVisita } from "../actions";
import { AbasComercial, CamposVisita, rotuloImovel } from "../campos";
import { carregarOpcoes } from "../dados";

export const metadata: Metadata = { title: "Visitas" };

type V = {
  id: string;
  data_hora: string;
  status: string;
  observacoes: string | null;
  lead: { id: string; nome: string; telefone: string | null } | null;
  imovel: { id: string; codigo: string; logradouro: string | null; numero: string | null } | null;
  corretor: { nome: string } | null;
  captacao: { id: string; proprietario_nome: string; logradouro: string | null; numero_end: string | null } | null;
};

/** Data local (Brasília) de um timestamp. */
const diaLocal = (iso: string) => new Date(iso).toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
const hora = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
const diaExtenso = (iso: string) =>
  new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "short", day: "2-digit", month: "short" }).replace(/\./g, "");

export default async function VisitasPage({ searchParams }: PageProps<"/comercial/visitas">) {
  const sp = await searchParams;
  const { supabase } = await obterContexto();
  const hoje = hojeISO();
  const [{ data }, opcoes] = await Promise.all([
    supabase
      .from("visitas")
      .select("id, data_hora, status, observacoes, lead:leads(id, nome, telefone), imovel:imoveis(id, codigo, logradouro, numero), corretor:pessoas(nome), captacao:captacoes(id, proprietario_nome, logradouro, numero_end)")
      .gte("data_hora", `${somarDias(hoje, -30)}T00:00:00-03:00`)
      .order("data_hora"),
    carregarOpcoes(supabase),
  ]);
  const visitas = (data ?? []) as unknown as V[];
  const agendadas = visitas.filter((v) => v.status === "agendada");
  const em7 = somarDias(hoje, 7);
  const grupos: { titulo: string; itens: V[]; tom?: string }[] = [
    { titulo: "Passaram e ainda sem baixa", itens: agendadas.filter((v) => diaLocal(v.data_hora) < hoje), tom: "text-ruim" },
    { titulo: "Hoje", itens: agendadas.filter((v) => diaLocal(v.data_hora) === hoje) },
    { titulo: "Próximos 7 dias", itens: agendadas.filter((v) => diaLocal(v.data_hora) > hoje && diaLocal(v.data_hora) <= em7) },
    { titulo: "Mais para frente", itens: agendadas.filter((v) => diaLocal(v.data_hora) > em7) },
    { titulo: "Realizadas e canceladas (últimos 30 dias)", itens: visitas.filter((v) => v.status !== "agendada").reverse() },
  ];
  const leadId = typeof sp.lead === "string" ? sp.lead : undefined;

  return (
    <>
      <Cabecalho
        titulo="Visitas"
        trilha="Comercial"
        descricao="Agenda de visitas aos imóveis. Marque como realizada depois da visita."
        acoes={
          <JanelaCadastro
            rotuloBotao={<><CalendarPlus className="size-4" /> Nova visita</>}
            titulo="Agendar visita"
            acao={criarVisita}
            rotuloSalvar="Agendar"
            icone={<CalendarPlus />}
            abertaInicial={sp.novo === "1"}
          >
            <CamposVisita imoveis={opcoes.imoveis} leads={opcoes.leads} corretores={opcoes.corretores} leadId={leadId} hoje={hoje} />
          </JanelaCadastro>
        }
      />
      <AbasComercial />

      <div className="space-y-6">
        {grupos
          .filter((g) => g.itens.length > 0 || g.titulo === "Hoje")
          .map((g) => (
            <section key={g.titulo} className="entrar">
              <h3 className={`mb-2 text-[15px] font-semibold ${g.tom ?? "text-texto"}`}>
                {g.titulo} <span className="text-mudo">({g.itens.length})</span>
              </h3>
              {g.itens.length === 0 ? (
                <div className="rounded-card border border-borda bg-card px-5 py-6 text-sm text-mudo">Nenhuma visita hoje.</div>
              ) : (
                <ul className="divide-y divide-borda-suave overflow-hidden rounded-card border border-borda bg-card">
                  {g.itens.map((v) => (
                    <li key={v.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5">
                      <div className="w-28 shrink-0">
                        <div className="text-[17px] font-semibold tabular-nums text-texto">{hora(v.data_hora)}</div>
                        <div className="text-xs capitalize text-mudo">{diaExtenso(v.data_hora)}</div>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-texto">
                          {v.captacao ? (
                            <Link href={`/captacao/${v.captacao.id}`} className="hover:underline">
                              Avaliação para captação · {v.captacao.proprietario_nome}
                            </Link>
                          ) : v.lead ? (
                            <Link href={`/comercial/leads/${v.lead.id}`} className="hover:underline">
                              {v.lead.nome}
                            </Link>
                          ) : (
                            "Sem cliente"
                          )}
                        </div>
                        <div className="truncate text-xs text-texto-2">
                          {v.imovel ? (
                            <Link href={`/imoveis/${v.imovel.id}`} className="hover:underline">
                              {rotuloImovel(v.imovel)}
                            </Link>
                          ) : v.captacao ? (
                            [v.captacao.logradouro, v.captacao.numero_end].filter(Boolean).join(", ") || "Endereço a confirmar"
                          ) : (
                            "Imóvel não informado"
                          )}
                          {v.corretor ? ` · com ${v.corretor.nome}` : ""}
                          {v.observacoes ? ` · ${v.observacoes}` : ""}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {v.status !== "agendada" && (
                          <Selo cor={v.status === "realizada" ? "verde" : "cinza"}>{ROTULO_STATUS_VISITA[v.status]}</Selo>
                        )}
                        {v.lead?.telefone && v.status === "agendada" && (
                          <a
                            href={linkWhatsapp(
                              v.lead.telefone,
                              `Olá ${v.lead.nome.split(" ")[0]}! Confirmando nossa visita ${diaLocal(v.data_hora) === hoje ? "hoje" : `em ${diaExtenso(v.data_hora)}`} às ${hora(v.data_hora)}${v.imovel ? ` no imóvel ${rotuloImovel(v.imovel)}` : ""}.`,
                            )}
                            target="_blank"
                            rel="noreferrer"
                            title="Confirmar pelo WhatsApp"
                            className="grid size-9 place-items-center rounded-[10px] border border-ok-bd bg-ok-bg text-ok"
                          >
                            <MessageCircle className="size-4" />
                          </a>
                        )}
                        {v.status === "agendada" ? (
                          <>
                            <form action={mudarStatusVisita}>
                              <input type="hidden" name="id" value={v.id} />
                              <input type="hidden" name="status" value="realizada" />
                              <button className="flex h-9 items-center gap-1.5 rounded-[10px] border border-ok-bd px-3 text-[13px] font-semibold text-ok hover:bg-ok-bg">
                                <Check className="size-4" /> Realizada
                              </button>
                            </form>
                            <form action={mudarStatusVisita}>
                              <input type="hidden" name="id" value={v.id} />
                              <input type="hidden" name="status" value="cancelada" />
                              <button title="Cancelar visita" className="grid size-9 place-items-center rounded-[10px] border border-borda text-mudo hover:text-ruim">
                                <X className="size-4" />
                              </button>
                            </form>
                          </>
                        ) : (
                          null
                        )}
                        <BotaoExcluir acao={excluirVisita} id={v.id} rotulo="Excluir visita" confirmar="Excluir esta visita?" />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
      </div>
    </>
  );
}
