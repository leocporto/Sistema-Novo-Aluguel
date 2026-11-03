import type { Metadata } from "next";
import Link from "next/link";
import { AlarmClock, CalendarCheck, CalendarDays, CalendarPlus, ChevronLeft, ChevronRight, MessageSquareWarning } from "lucide-react";
import { Contador } from "@/components/abas-segmentadas";
import { FiltroAutomatico } from "@/components/filtro-automatico";
import { JanelaCadastro } from "@/components/janela-cadastro";
import { NOMES_MES } from "@/components/navegador-mes";
import { PilulasLink } from "@/components/pilulas-link";
import { BotaoLink, Cabecalho, Indicador, Selecao } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { ROTULO_TIPO_COMPROMISSO, TIPOS_COMPROMISSO, TIPOS_SO_IMOBILIARIA, diaLocal, gradeMes, gradeSemana, instante } from "@/lib/dominio/agenda";
import { hojeISO, somarDias, somarMeses } from "@/lib/dominio/datas";
import { criarCompromisso } from "./actions";
import { AbasAgenda, CamposCompromisso } from "./campos";
import { CalendarioMes, Chip, Linha, SEMANA } from "./calendario";
import { SELECT_COMPROMISSO, carregarOpcoesAgenda, type CompromissoTela } from "./dados";

export const metadata: Metadata = { title: "Agenda" };

const VISTAS = { mes: "Mês", semana: "Semana", dia: "Dia", lista: "Lista" } as const;
type Vista = keyof typeof VISTAS;

const diaExtenso = (d: string) => {
  const [a, m, dia] = d.split("-").map(Number);
  return `${SEMANA[new Date(Date.UTC(a, m - 1, dia)).getUTCDay()]}, ${dia} de ${NOMES_MES[m - 1]}`;
};

export default async function AgendaPage({ searchParams }: PageProps<"/agenda">) {
  const sp = await searchParams;
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const { supabase, organizacao, usuario } = await obterContexto();
  const pessoal = organizacao.modo === "pessoal";
  const hoje = hojeISO();
  const vista: Vista = s("vista") in VISTAS ? (s("vista") as Vista) : "mes";
  const dia = /^\d{4}-\d{2}-\d{2}$/.test(s("dia")) ? s("dia") : hoje;
  const f = { quem: s("quem"), corretor: s("corretor"), tipo: s("tipo"), imovel: s("imovel") };

  // Período carregado conforme a visualização
  let ini: string;
  let fim: string;
  const grade = gradeMes(dia);
  const semana = gradeSemana(dia);
  if (vista === "mes") [ini, fim] = [grade[0][0].data, grade.at(-1)!.at(-1)!.data];
  else if (vista === "semana") [ini, fim] = [semana[0], semana[6]];
  else if (vista === "dia") [ini, fim] = [dia, dia];
  else [ini, fim] = [somarDias(hoje, -30), somarDias(hoje, 180)];

  let q = supabase
    .from("visitas")
    .select(SELECT_COMPROMISSO)
    .gte("data_hora", instante(ini, "00:00"))
    .lte("data_hora", instante(fim, "23:59"))
    .order("data_hora")
    .limit(1500);
  if (f.quem === "minha") q = q.eq("responsavel_id", usuario.id);
  else q = q.or(`compartilhada.eq.true,responsavel_id.eq.${usuario.id}`);
  if (f.corretor && !pessoal) q = q.eq("corretor_id", f.corretor);
  if (f.tipo) q = q.eq("tipo", f.tipo);
  if (f.imovel) q = q.eq("imovel_id", f.imovel);

  const [{ data }, opcoes, { data: kpi }] = await Promise.all([
    q,
    carregarOpcoesAgenda(supabase),
    supabase
      .from("visitas")
      .select("id, tipo, data_hora, status, cliente_confirmado_em, feedback_interesse")
      .gte("data_hora", instante(somarDias(hoje, -30), "00:00"))
      .lte("data_hora", instante(somarDias(hoje, 7), "23:59"))
      .neq("status", "cancelada"),
  ]);
  const lista = (data ?? []) as unknown as CompromissoTela[];
  const porDia = new Map<string, CompromissoTela[]>();
  for (const v of lista) porDia.set(diaLocal(v.data_hora), [...(porDia.get(diaLocal(v.data_hora)) ?? []), v]);

  const k = kpi ?? [];
  const hojeN = k.filter((v) => diaLocal(v.data_hora) === hoje).length;
  const semanaN = k.filter((v) => diaLocal(v.data_hora) >= hoje && diaLocal(v.data_hora) <= somarDias(hoje, 7)).length;
  const aConfirmar = k.filter((v) => v.status === "agendada" && diaLocal(v.data_hora) >= hoje && !v.cliente_confirmado_em).length;
  const semRetorno = k.filter((v) => v.tipo === "visita" && diaLocal(v.data_hora) < hoje && !v.feedback_interesse).length;

  // Navegação de período
  const passo = (n: number) => (vista === "mes" ? somarMeses(dia, n) : vista === "semana" ? somarDias(dia, 7 * n) : somarDias(dia, n));
  const url = (extra: Record<string, string>) => {
    const p = new URLSearchParams(Object.entries({ vista, dia, ...f, ...extra }).filter(([, v]) => v) as [string, string][]);
    if (p.get("vista") === "mes") p.delete("vista");
    if (p.get("dia") === hoje) p.delete("dia");
    const t = p.toString();
    return t ? `/agenda?${t}` : "/agenda";
  };
  const [a, m] = dia.split("-").map(Number);
  const tituloPeriodo =
    vista === "mes"
      ? `${NOMES_MES[m - 1]} de ${a}`
      : vista === "semana"
        ? `${semana[0].slice(8)}/${semana[0].slice(5, 7)} a ${semana[6].slice(8)}/${semana[6].slice(5, 7)}`
        : vista === "dia"
          ? diaExtenso(dia)
          : "Próximos 6 meses";

  const grupos =
    vista === "lista"
      ? [
          { titulo: "Passaram e ainda sem baixa", itens: lista.filter((v) => v.status === "agendada" && diaLocal(v.data_hora) < hoje), tom: "text-ruim" },
          { titulo: "Hoje", itens: lista.filter((v) => diaLocal(v.data_hora) === hoje) },
          { titulo: "Próximos 7 dias", itens: lista.filter((v) => diaLocal(v.data_hora) > hoje && diaLocal(v.data_hora) <= somarDias(hoje, 7)) },
          { titulo: "Mais para frente", itens: lista.filter((v) => diaLocal(v.data_hora) > somarDias(hoje, 7)) },
          { titulo: "Realizadas e canceladas (últimos 30 dias)", itens: lista.filter((v) => v.status !== "agendada" && diaLocal(v.data_hora) < hoje).reverse() },
        ]
      : [];

  return (
    <>
      <Cabecalho
        titulo="Agenda"
        descricao={pessoal ? "Visitas, vistorias e compromissos dos seus imóveis." : "Visitas, avaliações, vistorias e compromissos da equipe — individual ou compartilhada."}
        acoes={
          <JanelaCadastro
            rotuloBotao={<><CalendarPlus className="size-4" /> Novo compromisso</>}
            titulo="Novo compromisso"
            acao={criarCompromisso}
            rotuloSalvar="Agendar"
            icone={<CalendarPlus />}
            larguraMax="max-w-2xl"
            abertaInicial={s("novo") === "1"}
          >
            <CamposCompromisso opcoes={opcoes} pessoal={pessoal} hoje={hoje} padrao={{ data: dia >= hoje ? dia : hoje, imovelId: s("imovel_novo") || undefined, leadId: s("lead") || undefined }} />
          </JanelaCadastro>
        }
      />
      <AbasAgenda />

      <div className="entrar-cascata mb-6 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Indicador rotulo="Hoje" icone={<CalendarDays />} valor={<Contador valor={hojeN} />} detalhe="compromissos" href={url({ vista: "dia", dia: hoje })} />
        <Indicador rotulo="Próximos 7 dias" icone={<CalendarCheck />} valor={<Contador valor={semanaN} />} detalhe="compromissos" href={url({ vista: "lista" })} />
        <Indicador rotulo="A confirmar" icone={<AlarmClock />} valor={<Contador valor={aConfirmar} />} detalhe="cliente ainda não confirmou" tom={aConfirmar ? "alerta" : "neutro"} href={url({ vista: "lista" })} />
        <Indicador rotulo="Visitas sem retorno" icone={<MessageSquareWarning />} valor={<Contador valor={semRetorno} />} detalhe="falta o feedback do cliente" tom={semRetorno ? "perigo" : "sucesso"} href={url({ vista: "lista" })} />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <PilulasLink rotulo="Visualização" ativo={url({})} itens={(Object.keys(VISTAS) as Vista[]).map((x) => ({ href: url({ vista: x }), rotulo: VISTAS[x] }))} />
        {vista !== "lista" && (
          <div className="flex items-center gap-2">
            <BotaoLink href={url({ dia: passo(-1) })} variante="secundario" aria-label="Anterior">
              <ChevronLeft className="size-4" />
            </BotaoLink>
            <BotaoLink href={url({ dia: hoje })} variante="secundario">
              Hoje
            </BotaoLink>
            <BotaoLink href={url({ dia: passo(1) })} variante="secundario" aria-label="Próximo">
              <ChevronRight className="size-4" />
            </BotaoLink>
          </div>
        )}
        <h2 className="text-[17px] font-semibold capitalize text-texto">{tituloPeriodo}</h2>
      </div>

      <FiltroAutomatico className="mb-4 flex flex-wrap gap-2">
        {vista !== "mes" && <input type="hidden" name="vista" value={vista} />}
        {dia !== hoje && <input type="hidden" name="dia" value={dia} />}
        <Selecao name="quem" defaultValue={f.quem} className="w-48">
          <option value="">Agenda compartilhada</option>
          <option value="minha">Só a minha agenda</option>
        </Selecao>
        {!pessoal && (
          <Selecao name="corretor" defaultValue={f.corretor} className="w-48">
            <option value="">Todos os corretores</option>
            {opcoes.corretores.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </Selecao>
        )}
        <Selecao name="tipo" defaultValue={f.tipo} className="w-48">
          <option value="">Todos os tipos</option>
          {TIPOS_COMPROMISSO.filter((t) => !(pessoal && TIPOS_SO_IMOBILIARIA.includes(t))).map((t) => (
            <option key={t} value={t}>
              {ROTULO_TIPO_COMPROMISSO[t]}
            </option>
          ))}
        </Selecao>
        <Selecao name="imovel" defaultValue={f.imovel} className="w-52">
          <option value="">Todos os imóveis</option>
          {opcoes.imoveis.map((i) => (
            <option key={i.id} value={i.id}>
              {i.codigo}
            </option>
          ))}
        </Selecao>
      </FiltroAutomatico>

      {vista === "mes" && <CalendarioMes grade={grade} porDia={porDia} hoje={hoje} urlDia={(d) => url({ vista: "dia", dia: d })} />}

      {vista === "semana" && (
        <div className="entrar-cascata grid gap-3 overflow-x-auto pb-2 md:grid-cols-7">
          {semana.map((d) => {
            const itens = porDia.get(d) ?? [];
            return (
              <section key={d} className={`min-h-48 rounded-card border p-2 ${d === hoje ? "border-acento bg-acento-bg" : "border-borda bg-card"}`}>
                <Link href={url({ vista: "dia", dia: d })} className="mb-2 block px-1 text-[13px] font-semibold capitalize text-texto hover:underline">
                  {SEMANA[new Date(`${d}T12:00:00Z`).getUTCDay()]} {Number(d.slice(8))}
                </Link>
                <div className="space-y-1.5">
                  {itens.map((v) => (
                    <Chip key={v.id} v={v} />
                  ))}
                  {itens.length === 0 && <p className="px-1 text-xs text-fraco">Livre</p>}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {vista === "dia" && (
        <div className="entrar overflow-hidden rounded-card border border-borda bg-card">
          {(porDia.get(dia) ?? []).length === 0 ? (
            <p className="px-5 py-6 text-sm text-mudo">Nenhum compromisso neste dia.</p>
          ) : (
            <div className="divide-y divide-borda-suave">
              {(porDia.get(dia) ?? []).map((v) => (
                <Linha key={v.id} v={v} hoje={hoje} />
              ))}
            </div>
          )}
        </div>
      )}

      {vista === "lista" &&
        grupos.map(
          (g) =>
            (g.itens.length > 0 || g.titulo === "Hoje") && (
              <section key={g.titulo} className="entrar mb-5 overflow-hidden rounded-card border border-borda bg-card">
                <h3 className={`border-b border-borda-suave px-5 py-3 text-[15px] font-semibold ${g.tom ?? "text-texto"}`}>
                  {g.titulo} ({g.itens.length})
                </h3>
                {g.itens.length === 0 ? (
                  <p className="px-5 py-4 text-sm text-mudo">Nada para hoje.</p>
                ) : (
                  <div className="divide-y divide-borda-suave">
                    {g.itens.map((v) => (
                      <div key={v.id}>
                        {g.titulo !== "Hoje" && <div className="px-5 pt-2 text-[11px] font-medium capitalize text-mudo">{diaExtenso(diaLocal(v.data_hora))}</div>}
                        <Linha v={v} hoje={hoje} />
                      </div>
                    ))}
                  </div>
                )}
              </section>
            ),
        )}
    </>
  );
}
