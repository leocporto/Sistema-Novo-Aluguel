import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { CalendarDays, FileSignature, Handshake, Mail, MessageCircle, MessageSquarePlus, Phone, ShieldCheck, StickyNote, Users, Wallet } from "lucide-react";
import { BotaoExcluir } from "@/components/botao-excluir";
import { JanelaCadastro } from "@/components/janela-cadastro";
import { AreaTexto, Campo, Cartao, Entrada, Selecao } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { formatarCompetencia, hojeISO } from "@/lib/dominio/datas";
import { formatarReais } from "@/lib/dominio/dinheiro";
import { CANAIS_COMUNICACAO, TIPOS_INTERACAO } from "@/lib/tipos";
import { criarInteracao, excluirInteracao } from "../../actions";

export const metadata: Metadata = { title: "Relacionamento" };

type Evento = { data: string; icone: ReactNode; titulo: ReactNode; detalhe?: string; tom?: "ok" | "ruim" | "info"; interacaoId?: string };

const ICONE: Record<string, ReactNode> = {
  ligacao: <Phone />,
  whatsapp: <MessageCircle />,
  email: <Mail />,
  reuniao: <Users />,
  visita: <CalendarDays />,
  nota: <StickyNote />,
};

const dataHora = (iso: string) =>
  new Date(iso.length === 10 ? `${iso}T12:00:00-03:00` : iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "short", year: "numeric" });

export default async function RelacionamentoPage({ params }: PageProps<"/pessoas/[id]/relacionamento">) {
  const { id } = await params;
  const { supabase, organizacao } = await obterContexto();
  const pessoal = organizacao.modo === "pessoal";
  const hoje = hojeISO();
  const [{ data: interacoes }, { data: partes }, { data: repasses }, { data: consent }, { data: visitas }, { data: propostas }] = await Promise.all([
    supabase.from("pessoa_interacoes").select("id, tipo, descricao, data").eq("pessoa_id", id).order("data", { ascending: false }).limit(200),
    supabase
      .from("contrato_partes")
      .select("papel, contrato:contratos(id, numero, status, data_inicio, data_fim, data_rescisao, imovel:imoveis(codigo), faturas(competencia, status, vencimento, pago_em, valor_total, valor_pago))")
      .eq("pessoa_id", id),
    supabase.from("repasses").select("competencia, valor_liquido, pago_em").eq("pessoa_id", id).eq("status", "pago"),
    supabase.from("pessoa_consentimentos").select("canal, concedido, em, origem").eq("pessoa_id", id),
    pessoal ? Promise.resolve({ data: [] }) : supabase.from("visitas").select("data_hora, status, imovel:imoveis(codigo)").eq("corretor_id", id),
    pessoal ? Promise.resolve({ data: [] }) : supabase.from("propostas").select("created_at, status, valor, tipo, imovel:imoveis(codigo)").eq("corretor_id", id),
  ]);

  type F = { competencia: string; status: string; vencimento: string; pago_em: string | null; valor_total: number; valor_pago: number | null };
  type P = { papel: string; contrato: { id: string; numero: number; status: string; data_inicio: string; data_fim: string; data_rescisao: string | null; imovel: { codigo: string }; faturas: F[] } };
  const eventos: Evento[] = [];
  for (const parte of (partes ?? []) as unknown as P[]) {
    const c = parte.contrato;
    const link = (
      <Link href={`/contratos/${c.id}`} className="text-acento hover:underline">
        contrato #{c.numero} ({c.imovel.codigo})
      </Link>
    );
    eventos.push({ data: c.data_inicio, icone: <FileSignature />, titulo: <>Início do {link} como {parte.papel}</>, tom: "info" });
    if (c.data_rescisao || c.status === "encerrado" || c.status === "rescindido")
      eventos.push({ data: c.data_rescisao ?? c.data_fim, icone: <FileSignature />, titulo: <>Fim do {link}</> });
    if (parte.papel === "locatario")
      for (const f of c.faturas ?? []) {
        if (f.status === "paga" && f.pago_em)
          eventos.push({
            data: f.pago_em,
            icone: <Wallet />,
            titulo: `Pagou o aluguel de ${formatarCompetencia(f.competencia)}`,
            detalhe: `${formatarReais(f.valor_pago ?? f.valor_total)}${f.pago_em > f.vencimento ? " · com atraso" : ""}`,
            tom: f.pago_em > f.vencimento ? "ruim" : "ok",
          });
        if (f.status === "aberta" && f.vencimento < hoje)
          eventos.push({ data: f.vencimento, icone: <Wallet />, titulo: `Aluguel de ${formatarCompetencia(f.competencia)} em atraso`, detalhe: formatarReais(f.valor_total), tom: "ruim" });
      }
  }
  for (const r of repasses ?? [])
    if (r.pago_em) eventos.push({ data: r.pago_em, icone: <Wallet />, titulo: `Recebeu repasse de ${formatarCompetencia(r.competencia)}`, detalhe: formatarReais(r.valor_liquido), tom: "ok" });
  for (const c of consent ?? [])
    eventos.push({
      data: c.em,
      icone: <ShieldCheck />,
      titulo: `${c.concedido ? "Autorizou" : "Retirou autorização de"} contato por ${CANAIS_COMUNICACAO[c.canal] ?? c.canal}`,
      detalhe: c.origem ?? undefined,
    });
  type Vi = { data_hora: string; status: string; imovel: { codigo: string } | null };
  for (const v of (visitas ?? []) as unknown as Vi[])
    eventos.push({ data: v.data_hora, icone: <CalendarDays />, titulo: `Visita como corretor${v.imovel ? ` em ${v.imovel.codigo}` : ""}`, detalhe: v.status });
  type Pr = { created_at: string; status: string; valor: number; tipo: string; imovel: { codigo: string } | null };
  for (const pr of (propostas ?? []) as unknown as Pr[])
    eventos.push({ data: pr.created_at, icone: <Handshake />, titulo: `Proposta de ${pr.tipo === "venda" ? "venda" : "locação"} como corretor${pr.imovel ? ` (${pr.imovel.codigo})` : ""}`, detalhe: `${formatarReais(pr.valor)} · ${pr.status.replace("_", " ")}` });
  const anotacoes = (interacoes ?? []).filter((i) => i.tipo === "nota");
  for (const i of (interacoes ?? []).filter((i) => i.tipo !== "nota"))
    eventos.push({ data: i.data, icone: ICONE[i.tipo] ?? <StickyNote />, titulo: TIPOS_INTERACAO[i.tipo] ?? i.tipo, detalhe: i.descricao, interacaoId: i.id });
  eventos.sort((a, b) => b.data.localeCompare(a.data));
  const corTom = { ok: "border-ok-bd bg-ok-bg text-ok", ruim: "border-ruim-bd bg-ruim-bg text-ruim", info: "border-acento-bd bg-acento-bg text-acento-hot" };

  const novo = (tipoPadrao: string, rotulo: ReactNode, variante: "primario" | "secundario") => (
    <JanelaCadastro rotuloBotao={rotulo} titulo={tipoPadrao === "nota" ? "Nova anotação interna" : "Registrar contato"} acao={criarInteracao} rotuloSalvar="Salvar" variante={variante} tamanho="sm" icone={<MessageSquarePlus />}>
      <input type="hidden" name="pessoa_id" value={id} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo rotulo="Tipo">
          <Selecao name="tipo" defaultValue={tipoPadrao}>
            {Object.entries(TIPOS_INTERACAO).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Selecao>
        </Campo>
        <Campo rotulo="Data">
          <Entrada type="date" name="data" defaultValue={hoje} max={hoje} />
        </Campo>
      </div>
      <Campo rotulo={tipoPadrao === "nota" ? "Anotação (só a equipe vê)" : "O que foi conversado"}>
        <AreaTexto name="descricao" rows={4} required />
      </Campo>
    </JanelaCadastro>
  );

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
      <Cartao titulo={`Linha do tempo (${eventos.length})`} acoes={novo("ligacao", "+ Registrar contato", "primario")}>
        {eventos.length === 0 ? (
          <p className="text-sm text-mudo">Nada ainda. Registre ligações, mensagens e reuniões; contratos e pagamentos aparecem aqui sozinhos.</p>
        ) : (
          <ol className="relative space-y-4 before:absolute before:bottom-2 before:left-[15px] before:top-2 before:w-px before:bg-borda">
            {eventos.map((e, i) => (
              <li key={i} className="relative flex gap-3">
                <span className={`relative z-10 grid size-8 shrink-0 place-items-center rounded-full border bg-card [&>svg]:size-4 ${e.tom ? corTom[e.tom] : "border-borda text-texto-2"}`}>{e.icone}</span>
                <div className="min-w-0 flex-1 pt-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-sm font-medium text-texto">{e.titulo}</div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="text-xs text-mudo">{dataHora(e.data)}</span>
                      {e.interacaoId && <BotaoExcluir acao={excluirInteracao} id={e.interacaoId} rotulo="Excluir registro" confirmar="Excluir este registro?" />}
                    </div>
                  </div>
                  {e.detalhe && <div className="mt-0.5 whitespace-pre-line text-[13px] text-texto-2">{e.detalhe}</div>}
                </div>
              </li>
            ))}
          </ol>
        )}
      </Cartao>
      <Cartao titulo={`Anotações internas (${anotacoes.length})`} acoes={novo("nota", "+ Anotação", "secundario")}>
        <ul className="space-y-3">
          {anotacoes.map((a) => (
            <li key={a.id} className="rounded-[14px] border border-alerta-bd bg-alerta-bg p-3 text-sm">
              <div className="flex items-start justify-between gap-2">
                <span className="text-xs text-mudo">{dataHora(a.data)}</span>
                <BotaoExcluir acao={excluirInteracao} id={a.id} rotulo="Excluir anotação" confirmar="Excluir esta anotação?" />
              </div>
              <p className="mt-1 whitespace-pre-line text-texto">{a.descricao}</p>
            </li>
          ))}
          {anotacoes.length === 0 && <li className="text-sm text-mudo">Nenhuma anotação. Só a equipe vê o que for escrito aqui.</li>}
        </ul>
      </Cartao>
    </div>
  );
}
