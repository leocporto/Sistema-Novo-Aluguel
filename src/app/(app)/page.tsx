import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import {
  AlarmClock,
  AlertTriangle,
  ArrowLeftRight,
  BadgeDollarSign,
  Bell,
  Building2,
  CalendarClock,
  CalendarDays,
  CircleDollarSign,
  ClipboardList,
  FileClock,
  Globe,
  Handshake,
  Home,
  Inbox,
  Megaphone,
  MessageCircle,
  KeyRound,
  MessageSquareWarning,
  DoorOpen,
  ShieldAlert,
  ListTodo,
  Scale,
  Target,
  TrendingUp,
  UserCheck,
  UserPlus,
  Users,
  Wallet,
  Wrench,
  BadgeCheck,
  Gavel,
  Mail,
  Hammer,
} from "lucide-react";
import { Contador } from "@/components/abas-segmentadas";
import { BarraProgresso } from "@/components/barra-progresso";
import { GraficoComparativo } from "@/components/grafico-comparativo";
import { BotaoLink, Cabecalho, Cartao, Indicador, Selo } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { agoraMs, fimDoMes, formatarDataBR, hojeISO, somarDias } from "@/lib/dominio/datas";
import { formatarReais } from "@/lib/dominio/dinheiro";
import { contarPorMes, mesAnoAnterior, mesesAte, progressoMeta, somarPorMes, variacaoPct } from "@/lib/dominio/painel";
import { proximoReajuste } from "@/lib/dominio/reajuste";
import { ROTULO_META, ROTULO_STATUS_IMOVEL, TIPOS_META, type TipoMeta } from "@/lib/tipos";
import { quadroPermitido } from "@/lib/modos";
import { pendencias } from "@/lib/dominio/pessoas";
import { ROTULO_TIPO_COMPROMISSO } from "@/lib/dominio/agenda";
import { STATUS_EM_ANDAMENTO, situacaoPrazo } from "@/lib/dominio/manutencao";
import { numerosAnalisePainel } from "./analise/painel";
import { numerosEquipePainel } from "./equipe/painel";
import type { PreferenciaPainel } from "./painel-actions";
import { PainelWidgets, type Quadro } from "./painel-widgets";

export const metadata: Metadata = { title: "Painel" };

const COR_STATUS = { disponivel: "vermelho", alugado: "verde", reservado: "amarelo", vendido: "cinza", inativo: "cinza" } as const;

type Im = {
  id: string;
  codigo: string;
  status: string;
  finalidades: string[];
  valor_aluguel: number | null;
  valor_venda: number | null;
  captado_em: string;
  vendido_em: string | null;
  logradouro: string | null;
  numero: string | null;
  bairro: string | null;
  imovel_proprietarios: { pessoa_id: string }[];
  contratos: { status: string }[];
};
type Ct = {
  id: string;
  numero: number;
  status: string;
  data_inicio: string;
  data_fim: string;
  data_base_reajuste: string;
  periodicidade_reajuste_meses: number;
  valor_aluguel: number;
  seguro_incendio_vencimento: string | null;
  imovel: { codigo: string };
};
type Aviso = { texto: string; href: string; data?: string; tom: "ruim" | "alerta" | "info"; icone: ReactNode };

const diaLocal = (iso: string) => new Date(iso).toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
const horaLocal = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });

function Variacao({ pct, inverso = false }: { pct: number | null; inverso?: boolean }) {
  if (pct === null) return null;
  const bom = inverso ? pct <= 0 : pct >= 0;
  return (
    <span className={bom ? "text-ok" : "text-ruim"}>
      {pct >= 0 ? "▲" : "▼"} {Math.abs(pct).toLocaleString("pt-BR")}%
    </span>
  );
}

export default async function PainelPage() {
  const { supabase, organizacao, usuario } = await obterContexto();
  const pessoal = organizacao.modo === "pessoal";
  const hoje = hojeISO();
  const mes = hoje.slice(0, 7);
  const iniMes = `${mes}-01`;
  const fimMes = fimDoMes(iniMes);
  const meses12 = mesesAte(mes, 12);
  const mesesAnt = meses12.map((m) => mesAnoAnterior(m));
  const desde = `${mesesAnt[0]}-01`;
  const mesPassado = meses12[10];

  const [imoveisR, contratosR, abertasR, pagasMesR, receitasR, abertosR, repassesR, leadsR, visitasR, propostasR, tarefasR, metasR, prefR, pessoasDocR, arquivosR, chavesAtrasR, semRetornoR, desocR, garantiasR, docsR, vistAbertasR, vistHojeR, contestR, reparosR, reparosVencR, chamadosR, garantiasManutR, analiseN, siteContatosR, portaisFalhaR, mktConversasR, mktFilaR, portalPedidosR, portalConclusoesR, equipeN] =
    await Promise.all([
      supabase
        .from("imoveis")
        .select("id, codigo, status, finalidades, valor_aluguel, valor_venda, captado_em, vendido_em, logradouro, numero, bairro, created_at, imovel_proprietarios(pessoa_id), contratos(status)")
        .order("created_at", { ascending: false }),
      supabase
        .from("contratos")
        .select("id, numero, status, data_inicio, data_fim, data_base_reajuste, periodicidade_reajuste_meses, valor_aluguel, seguro_incendio_vencimento, imovel:imoveis(codigo)")
        .neq("status", "rascunho"),
      supabase.from("faturas").select("valor_total, valor_abatido, vencimento").eq("status", "aberta"),
      // Cada recebimento de aluguel no mês (inclusive parcial), na data dele.
      supabase.from("alugueis_recebidos").select("valor").gte("data", iniMes).lte("data", fimMes),
      supabase.from("lancamentos").select("valor, liquidado_em").eq("tipo", "receber").eq("status", "liquidado").gte("liquidado_em", desde),
      supabase.from("lancamentos").select("tipo, valor, vencimento, categoria").eq("status", "aberto"),
      supabase.from("repasses").select("valor_liquido, pagar_em").eq("status", "pendente"),
      supabase.from("leads").select("status, created_at, proximo_contato"),
      supabase
        .from("visitas")
        .select("id, tipo, titulo, data_hora, contato_nome, lead:leads(id, nome), pessoa:pessoas!visitas_pessoa_id_fkey(nome), imovel:imoveis(codigo)")
        .eq("status", "agendada")
        .gte("data_hora", `${hoje}T00:00:00-03:00`)
        .order("data_hora")
        .limit(8),
      supabase.from("propostas").select("valor, tipo, status, fechada_em").or(`status.eq.em_negociacao,fechada_em.gte.${iniMes}`),
      supabase.from("tarefas").select("id, titulo, vencimento, prioridade").eq("concluida", false),
      supabase.from("metas").select("tipo, valor").eq("competencia", iniMes),
      supabase.from("painel_preferencias").select("widgets").eq("user_id", usuario.id).eq("organizacao_id", organizacao.id).maybeSingle(),
      supabase
        .from("pessoas")
        .select("id, nome, tipo_pessoa, documento, email, telefone, papeis, banco, conta, pix_chave")
        .overlaps("papeis", ["locatario", "fiador", "proprietario"]),
      supabase.from("pessoa_arquivos").select("pessoa_id, categoria"),
      supabase
        .from("chave_movimentacoes")
        .select("id, retirada_por, previsao_devolucao, chave:chaves(id, codigo)")
        .is("devolvida_em", null)
        .lt("previsao_devolucao", new Date().toISOString()),
      supabase
        .from("visitas")
        .select("id", { count: "exact", head: true })
        .eq("tipo", "visita")
        .neq("status", "cancelada")
        .is("feedback_interesse", null)
        .lt("data_hora", `${hoje}T00:00:00-03:00`)
        .gte("data_hora", `${somarDias(hoje, -30)}T00:00:00-03:00`),
      supabase.from("contrato_desocupacoes").select("id, contrato_id, entrega_prevista").neq("status", "concluida"),
      supabase.from("contrato_garantias").select("id, contrato_id, tipo, fim").eq("status", "ativa").not("fim", "is", null).lte("fim", somarDias(hoje, 30)),
      supabase.from("documentos").select("id, titulo, status, validade, alerta_dias, updated_at").or(`status.eq.aguardando_assinatura,validade.lte.${somarDias(hoje, 120)}`).neq("status", "cancelado"),
      supabase.from("vistorias").select("id", { count: "exact", head: true }).in("status", ["rascunho", "em_andamento"]),
      supabase.from("vistorias").select("id", { count: "exact", head: true }).in("status", ["rascunho", "em_andamento"]).eq("data", hoje),
      supabase.from("vistoria_contestacoes").select("id", { count: "exact", head: true }).eq("status", "aberta"),
      supabase.from("vistoria_pendencias").select("id", { count: "exact", head: true }).in("status", ["aberta", "em_reparo"]),
      supabase.from("vistoria_pendencias").select("id", { count: "exact", head: true }).in("status", ["aberta", "em_reparo"]).lt("prazo", hoje),
      supabase.from("chamados").select("id, numero, titulo, status, origem, prazo_atendimento").in("status", STATUS_EM_ANDAMENTO),
      supabase.from("chamados").select("id", { count: "exact", head: true }).in("status", ["concluido", "avaliado"]).gte("garantia_ate", hoje).lte("garantia_ate", somarDias(hoje, 30)),
      numerosAnalisePainel(supabase, hoje),
      pessoal
        ? Promise.resolve({ count: 0 })
        : supabase.from("site_solicitacoes").select("id", { count: "exact", head: true }).neq("tipo", "portal").gte("created_at", `${somarDias(hoje, -30)}T00:00:00-03:00`),
      pessoal ? Promise.resolve({ count: 0 }) : supabase.from("portal_imoveis").select("id", { count: "exact", head: true }).eq("ultimo_status", "falha"),
      pessoal ? Promise.resolve({ count: 0 }) : supabase.from("mkt_conversas").select("id", { count: "exact", head: true }).eq("status", "aberta"),
      pessoal
        ? Promise.resolve({ count: 0 })
        : supabase.from("mkt_envios").select("id", { count: "exact", head: true }).eq("status", "pendente").lte("agendado_para", new Date().toISOString()),
      supabase.from("portal_solicitacoes").select("id", { count: "exact", head: true }).eq("status", "nova"),
      supabase.from("chamados").select("id", { count: "exact", head: true }).eq("status", "em_execucao").not("prestador_concluiu_em", "is", null),
      pessoal ? Promise.resolve(null) : numerosEquipePainel(supabase, hoje, usuario.id).catch(() => null),
    ]);

  // ---------------------------------------------------------------- imóveis
  const im = (imoveisR.data ?? []) as unknown as Im[];
  const ativosIm = im.filter((i) => i.status !== "inativo");
  const qtd = (s: string) => im.filter((i) => i.status === s).length;
  const dispVenda = im.filter((i) => i.status === "disponivel" && i.finalidades?.includes("venda"));
  const dispLocacao = im.filter((i) => i.status === "disponivel" && (i.finalidades?.includes("locacao") ?? true));
  const vendidosMes = im.filter((i) => i.vendido_em && i.vendido_em >= iniMes && i.vendido_em <= fimMes).length;
  const captadosMes = im.filter((i) => i.captado_em >= iniMes && i.captado_em <= fimMes).length;
  const pendenciasImoveis: { texto: string; href: string }[] = [];
  for (const i of im) {
    if (!pessoal && i.imovel_proprietarios.length === 0) pendenciasImoveis.push({ texto: `${i.codigo}: sem proprietário vinculado`, href: `/imoveis/${i.id}` });
    if (i.status === "alugado" && !i.contratos.some((c) => c.status === "ativo"))
      pendenciasImoveis.push({ texto: `${i.codigo}: marcado como alugado, mas sem contrato ativo`, href: `/contratos/novo?imovel=${i.id}` });
  }

  // -------------------------------------------------------------- contratos
  const contratos = (contratosR.data ?? []) as unknown as Ct[];
  const ativos = contratos.filter((c) => c.status === "ativo");
  const alugadosMes = contratos.filter((c) => c.data_inicio >= iniMes && c.data_inicio <= fimMes).length;
  const em60 = somarDias(hoje, 60);
  const vencendo = ativos.filter((c) => c.data_fim <= em60).sort((a, b) => a.data_fim.localeCompare(b.data_fim));

  // ------------------------------------------------------------- financeiro
  const abertas = abertasR.data ?? [];
  const atrasadas = abertas.filter((f) => f.vencimento < hoje);
  // Saldo da fatura = total − o que já foi recebido/abatido (pagamentos parciais).
  const saldoFatura = (f: { valor_total: number; valor_abatido: number | null }) => Number(f.valor_total) - Number(f.valor_abatido ?? 0);
  const valorAtraso = atrasadas.reduce((s, f) => s + saldoFatura(f), 0);
  const aluguelRecebidoMes = (pagasMesR.data ?? []).reduce((s, f) => s + Number(f.valor ?? 0), 0);
  const receitas = (receitasR.data ?? []).map((l) => ({ data: l.liquidado_em as string, valor: Number(l.valor) }));
  const fat12 = somarPorMes(receitas, meses12);
  const fatAnt = somarPorMes(receitas, mesesAnt);
  const faturamentoMes = fat12[11];
  const abertos = abertosR.data ?? [];
  const aPagarLanc = abertos.filter((l) => l.tipo === "pagar" && l.vencimento <= fimMes);
  const despesasVencidas = abertos.filter((l) => l.tipo === "pagar" && l.vencimento < hoje);
  const comissoes = abertos.filter((l) => l.tipo === "pagar" && l.categoria === "Comissões");
  const repasses = repassesR.data ?? [];
  const repassesAteFim = repasses.filter((r) => r.pagar_em <= fimMes);
  const aReceber =
    abertas.filter((f) => f.vencimento <= fimMes).reduce((s, f) => s + saldoFatura(f), 0) +
    abertos.filter((l) => l.tipo === "receber" && l.vencimento <= fimMes).reduce((s, l) => s + Number(l.valor), 0);
  const aPagar =
    aPagarLanc.reduce((s, l) => s + Number(l.valor), 0) + (pessoal ? 0 : repassesAteFim.reduce((s, r) => s + Number(r.valor_liquido), 0));
  const somaRep = repasses.reduce((s, r) => s + Number(r.valor_liquido), 0);
  const repHoje = repasses.filter((r) => r.pagar_em <= hoje);

  // -------------------------------------------------------------- comercial
  const leads = leadsR.data ?? [];
  const leadsPorMes = contarPorMes(leads.map((l) => diaLocal(l.created_at)), meses12);
  const leadsMes = leadsPorMes[11];
  const novos = leads.filter((l) => l.status === "novo");
  const agora = agoraMs();
  const novosAntigos = novos.filter((l) => agora - new Date(l.created_at).getTime() > 86_400_000);
  type Vis = { id: string; tipo: string; titulo: string | null; data_hora: string; contato_nome: string | null; lead: { id: string; nome: string } | null; pessoa: { nome: string } | null; imovel: { codigo: string } | null };
  const nomeVisita = (v: Vis) => v.lead?.nome ?? v.pessoa?.nome ?? v.contato_nome ?? null;
  const visitas = (visitasR.data ?? []) as unknown as Vis[];
  const visitasHoje = visitas.filter((v) => diaLocal(v.data_hora) === hoje);
  const propostas = propostasR.data ?? [];
  const negociando = propostas.filter((p) => p.status === "em_negociacao");
  type Tar = { id: string; titulo: string; vencimento: string | null; prioridade: string };
  const tarefas = (tarefasR.data ?? []) as Tar[];

  // ------------------------------------------------------------------ metas
  const realizado: Record<TipoMeta, number> = {
    locacoes: alugadosMes,
    vendas: vendidosMes,
    captacoes: captadosMes,
    leads: leadsMes,
    faturamento: faturamentoMes,
  };
  const metas = Object.fromEntries((metasR.data ?? []).map((m) => [m.tipo, Number(m.valor)])) as Partial<Record<TipoMeta, number>>;
  const metasDef = TIPOS_META.filter((t) => metas[t] !== undefined);

  // --------------------------------------------------------- notificações
  const avisos: Aviso[] = [];
  // Tarefas, leads e visitas são da parte comercial: só no modo imobiliária.
  for (const t of pessoal ? [] : tarefas) {
    if (t.vencimento && t.vencimento < hoje)
      avisos.push({ texto: `Tarefa atrasada: ${t.titulo}`, href: "/comercial/tarefas", data: t.vencimento, tom: "ruim", icone: <ListTodo /> });
    else if (t.prioridade === "alta" || t.vencimento === hoje)
      avisos.push({ texto: `${t.prioridade === "alta" ? "Prioridade alta" : "Para hoje"}: ${t.titulo}`, href: "/comercial/tarefas", data: t.vencimento ?? undefined, tom: "alerta", icone: <ListTodo /> });
  }
  if (atrasadas.length)
    avisos.push({ texto: `${atrasadas.length} aluguel(is) em atraso — ${formatarReais(valorAtraso)}`, href: "/cobrancas", tom: "ruim", icone: <AlertTriangle /> });
  // Cadastros de inquilinos, fiadores e proprietários com documentação faltando.
  const docsPorPessoa = new Map<string, string[]>();
  for (const a of arquivosR.data ?? []) docsPorPessoa.set(a.pessoa_id as string, [...(docsPorPessoa.get(a.pessoa_id as string) ?? []), a.categoria as string]);
  const comPendencia = (pessoasDocR.data ?? []).filter((p) => pendencias(p, docsPorPessoa.get(p.id) ?? [], organizacao.modo).length > 0).length;
  if (comPendencia)
    avisos.push({ texto: `${comPendencia} cadastro(s) com documentação pendente`, href: "/pessoas?pendencia=1", tom: "alerta", icone: <FileClock /> });
  if (despesasVencidas.length)
    avisos.push({ texto: `${despesasVencidas.length} despesa(s) vencida(s) sem pagamento`, href: "/despesas", tom: "ruim", icone: <Wallet /> });
  const retornos = leads.filter((l) => l.proximo_contato && l.proximo_contato <= hoje && l.status !== "ganho" && l.status !== "perdido").length;
  if (!pessoal && retornos)
    avisos.push({ texto: `${retornos} lead(s) para retornar hoje (follow-up)`, href: "/comercial", tom: "alerta", icone: <AlarmClock /> });
  if (!pessoal && novosAntigos.length)
    avisos.push({ texto: `${novosAntigos.length} lead(s) esperando atendimento há mais de 1 dia`, href: "/comercial", tom: "alerta", icone: <Inbox /> });
  for (const v of visitasHoje)
    avisos.push({
      texto: `${v.titulo ?? ROTULO_TIPO_COMPROMISSO[v.tipo] ?? "Compromisso"} hoje às ${horaLocal(v.data_hora)}${nomeVisita(v) ? ` com ${nomeVisita(v)}` : ""}${v.imovel ? ` (${v.imovel.codigo})` : ""}`,
      href: `/agenda/${v.id}`,
      tom: "info",
      icone: <CalendarDays />,
    });
  type ChAtr = { id: string; retirada_por: string; previsao_devolucao: string; chave: { id: string; codigo: string | null } | null };
  for (const m of (chavesAtrasR.data ?? []) as unknown as ChAtr[])
    avisos.push({ texto: `Chave ${m.chave?.codigo ?? ""} não devolvida por ${m.retirada_por}`, href: m.chave ? `/chaves/${m.chave.id}` : "/chaves", data: diaLocal(m.previsao_devolucao), tom: "ruim", icone: <KeyRound /> });
  const chamados = (chamadosR.data ?? []) as { id: string; numero: number; titulo: string; status: string; origem: string; prazo_atendimento: string | null }[];
  const agoraIso = new Date(agora).toISOString();
  const chamadosAtrasados = chamados.filter((c) => situacaoPrazo(c, agoraIso).situacao === "atrasado");
  const chamadosAprovacao = chamados.filter((c) => c.status === "aguardando_aprovacao");
  for (const c of chamados.filter((x) => x.origem === "link" && x.status === "aberto"))
    avisos.push({ texto: `Chamado novo do locatário: ${c.titulo}`, href: `/manutencao/${c.id}`, tom: "alerta", icone: <Wrench /> });
  if (garantiasManutR.count)
    avisos.push({ texto: `${garantiasManutR.count} garantia(s) de conserto acabando em 30 dias`, href: "/manutencao/garantias?filtro=vencendo", tom: "info", icone: <Wrench /> });
  const desocupacoes = desocR.data ?? [];
  if (desocupacoes.length)
    avisos.push({ texto: `${desocupacoes.length} desocupação(ões) em andamento`, href: "/contratos?status=desocupacao", tom: "alerta", icone: <DoorOpen /> });
  for (const g of garantiasR.data ?? [])
    avisos.push({
      texto: `Garantia (${String(g.tipo).replace(/_/g, " ")}) ${String(g.fim) < hoje ? "vencida" : "vencendo"}`,
      href: `/contratos/${g.contrato_id}/partes`,
      data: String(g.fim),
      tom: String(g.fim) < hoje ? "ruim" : "alerta",
      icone: <ShieldAlert />,
    });
  for (const d of docsR.data ?? []) {
    if (d.validade && d.validade <= somarDias(hoje, Number(d.alerta_dias ?? 30)))
      avisos.push({ texto: `Documento ${d.validade < hoje ? "vencido" : "vencendo"}: ${d.titulo}`, href: `/documentos/${d.id}`, data: d.validade, tom: d.validade < hoje ? "ruim" : "alerta", icone: <FileClock /> });
    else if (d.status === "aguardando_assinatura" && String(d.updated_at).slice(0, 10) <= somarDias(hoje, -5))
      avisos.push({ texto: `Assinatura pendente há dias: ${d.titulo}`, href: `/documentos/${d.id}`, tom: "alerta", icone: <FileClock /> });
  }
  if (semRetornoR.count)
    avisos.push({ texto: `${semRetornoR.count} visita(s) sem retorno do cliente (feedback)`, href: "/agenda?vista=lista&tipo=visita", tom: "alerta", icone: <MessageSquareWarning /> });
  if (!pessoal && repHoje.length)
    avisos.push({ texto: `${repHoje.length} repasse(s) para pagar até hoje`, href: "/repasses", tom: "alerta", icone: <ArrowLeftRight /> });
  for (const c of ativos) {
    const r = proximoReajuste(c.data_base_reajuste, c.periodicidade_reajuste_meses);
    if (r <= somarDias(hoje, 30)) avisos.push({ texto: `Reajuste do contrato #${c.numero} (${c.imovel.codigo})`, href: `/contratos/${c.id}`, data: r, tom: "info", icone: <TrendingUp /> });
    if (c.seguro_incendio_vencimento && c.seguro_incendio_vencimento <= somarDias(hoje, 30))
      avisos.push({ texto: `Seguro incêndio vencendo — contrato #${c.numero}`, href: `/contratos/${c.id}`, data: c.seguro_incendio_vencimento, tom: "alerta", icone: <FileClock /> });
  }
  const pesoTom = { ruim: 0, alerta: 1, info: 2 };
  avisos.sort((a, b) => pesoTom[a.tom] - pesoTom[b.tom] || (a.data ?? "").localeCompare(b.data ?? ""));
  const corTom = { ruim: "text-ruim bg-ruim-bg border-ruim-bd", alerta: "text-alerta bg-alerta-bg border-alerta-bd", info: "text-acento-hot bg-acento-bg border-acento-bd" };

  // ------------------------------------------------------------------ quadros
  const varFat = variacaoPct(faturamentoMes, fat12[10]);
  const varFatAno = variacaoPct(faturamentoMes, fatAnt[11]);
  const anoAtual = mes.slice(0, 4);
  const acumAno = fat12.filter((_, i) => meses12[i].startsWith(anoAtual)).reduce((s, v) => s + v, 0);
  const acumAnoAnt = fatAnt.filter((_, i) => meses12[i].startsWith(anoAtual)).reduce((s, v) => s + v, 0);

  const quadros: (Quadro | false)[] = [
    {
      id: "imoveis_total",
      titulo: "Total de imóveis",
      largura: 1,
      conteudo: (
        <Indicador
          rotulo="Imóveis cadastrados"
          icone={<Building2 />}
          valor={<Contador valor={ativosIm.length} />}
          detalhe={`${qtd("alugado")} alugado(s) · ${qtd("disponivel")} desalugado(s)${qtd("vendido") ? ` · ${qtd("vendido")} vendido(s)` : ""}`}
          href="/imoveis"
        />
      ),
    },
    !pessoal && {
      id: "disp_venda",
      titulo: "Disponíveis para venda",
      largura: 1,
      conteudo: (
        <Indicador
          rotulo="Disponíveis para venda"
          icone={<CircleDollarSign />}
          valor={<Contador valor={dispVenda.length} />}
          detalhe={`${formatarReais(dispVenda.reduce((s, i) => s + Number(i.valor_venda ?? 0), 0))} em estoque`}
          href="/imoveis?status=disponivel"
        />
      ),
    },
    {
      id: "disp_locacao",
      titulo: "Disponíveis para locação",
      largura: 1,
      conteudo: (
        <Indicador
          rotulo="Disponíveis para locação"
          icone={<KeyRound />}
          valor={<Contador valor={dispLocacao.length} />}
          detalhe={`${formatarReais(dispLocacao.reduce((s, i) => s + Number(i.valor_aluguel ?? 0), 0))}/mês parados`}
          tom={dispLocacao.length ? "alerta" : "sucesso"}
          href="/imoveis?status=disponivel"
        />
      ),
    },
    {
      id: "fechados_mes",
      titulo: pessoal ? "Alugados no mês" : "Vendidos e alugados no mês",
      largura: 1,
      conteudo: (
        <Indicador
          rotulo={pessoal ? "Alugados no mês" : "Vendidos e alugados no mês"}
          icone={<Handshake />}
          valor={<Contador valor={pessoal ? alugadosMes : alugadosMes + vendidosMes} />}
          detalhe={pessoal ? "contratos iniciados no mês" : `${alugadosMes} alugado(s) · ${vendidosMes} vendido(s)`}
          tom="sucesso"
        />
      ),
    },
    {
      id: "captados",
      titulo: "Imóveis captados",
      largura: 1,
      conteudo: (
        <Indicador rotulo="Imóveis captados" icone={<Home />} valor={<Contador valor={im.length} />} detalhe={`+${captadosMes} neste mês`} href="/imoveis/novo" />
      ),
    },
    {
      id: "leads_mes",
      titulo: "Leads recebidos",
      largura: 1,
      conteudo: (
        <Indicador
          rotulo="Leads recebidos no mês"
          icone={<Users />}
          valor={<Contador valor={leadsMes} />}
          detalhe={
            <>
              <Variacao pct={variacaoPct(leadsMes, leadsPorMes[10])} /> {leadsPorMes[10]} no mês passado · {leads.length} no total
            </>
          }
          href="/comercial"
        />
      ),
    },
    {
      id: "leads_aguardando",
      titulo: "Leads aguardando atendimento",
      largura: 1,
      conteudo: (
        <Indicador
          rotulo="Aguardando atendimento"
          icone={<Inbox />}
          valor={<Contador valor={novos.length} />}
          detalhe={novosAntigos.length ? `${novosAntigos.length} há mais de 1 dia` : "ninguém esperando muito"}
          tom={novosAntigos.length ? "perigo" : novos.length ? "alerta" : "sucesso"}
          href="/comercial"
        />
      ),
    },
    {
      id: "propostas",
      titulo: "Propostas em negociação",
      largura: 1,
      conteudo: (
        <Indicador
          rotulo="Propostas em negociação"
          icone={<Handshake />}
          valor={<Contador valor={negociando.length} />}
          detalhe={`${formatarReais(negociando.reduce((s, p) => s + Number(p.valor), 0))} em jogo`}
          href="/comercial/propostas"
        />
      ),
    },
    {
      id: "faturamento",
      titulo: "Faturamento mensal",
      largura: 1,
      conteudo: (
        <Indicador
          rotulo={pessoal ? "Receita do mês" : "Faturamento do mês"}
          icone={<BadgeDollarSign />}
          valor={<Contador valor={faturamentoMes} formato="moeda" />}
          detalhe={
            <>
              <Variacao pct={varFat} /> vs mês passado
              {!pessoal && ` · aluguéis recebidos ${formatarReais(aluguelRecebidoMes)}`}
            </>
          }
          tom="sucesso"
          href="/financeiro"
        />
      ),
    },
    {
      id: "receber_pagar",
      titulo: "A receber × a pagar",
      largura: 1,
      conteudo: (
        <Link href="/financeiro" className="block h-full">
          <div className="flex h-full flex-col gap-3 rounded-card border border-borda bg-card p-[clamp(16px,1.6vw,20px)] transition hover:border-borda-forte">
            <div className="flex min-h-8 items-center gap-2.5">
              <span className="flex size-8 items-center justify-center rounded-[10px] border border-acento-bd bg-acento-bg text-acento-hot [&>svg]:size-4">
                <Scale />
              </span>
              <span className="text-[13px] font-medium text-texto-2">Até o fim do mês</span>
            </div>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-xs text-mudo">A receber</span>
              <span className="text-[19px] font-semibold tabular-nums text-ok">{formatarReais(aReceber)}</span>
            </div>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-xs text-mudo">A pagar</span>
              <span className="text-[19px] font-semibold tabular-nums text-ruim">{formatarReais(aPagar)}</span>
            </div>
            <div className="flex items-baseline justify-between gap-2 border-t border-borda-suave pt-2">
              <span className="text-xs text-mudo">Saldo previsto</span>
              <span className={`text-[15px] font-semibold tabular-nums ${aReceber - aPagar >= 0 ? "text-texto" : "text-ruim"}`}>{formatarReais(aReceber - aPagar)}</span>
            </div>
          </div>
        </Link>
      ),
    },
    {
      id: "atraso",
      titulo: "Aluguéis em atraso",
      largura: 1,
      conteudo: (
        <Indicador
          rotulo="Aluguéis em atraso"
          icone={<AlertTriangle />}
          valor={<Contador valor={valorAtraso} formato="moeda" />}
          detalhe={`${atrasadas.length} aluguel(is)`}
          tom={atrasadas.length ? "perigo" : "sucesso"}
          href="/cobrancas"
        />
      ),
    },
    !pessoal && {
      id: "repasses",
      titulo: "Repasses pendentes",
      largura: 1,
      conteudo: (
        <Indicador
          rotulo="Repasses pendentes"
          icone={<ArrowLeftRight />}
          valor={<Contador valor={somaRep} formato="moeda" />}
          detalhe={`${repasses.length} pendente(s) · ${repHoje.length} para hoje`}
          tom={repHoje.length ? "alerta" : "neutro"}
          href="/repasses"
        />
      ),
    },
    !pessoal && {
      id: "comissoes",
      titulo: "Comissões a pagar",
      largura: 1,
      conteudo: (
        <Indicador
          rotulo="Comissões a pagar"
          icone={<Wallet />}
          valor={<Contador valor={comissoes.reduce((s, c) => s + Number(c.valor), 0)} formato="moeda" />}
          detalhe={`${comissoes.length} comissão(ões) em aberto`}
          tom={comissoes.length ? "alerta" : "neutro"}
          href="/comissoes?f=a_pagar"
        />
      ),
    },
    {
      id: "notificacoes",
      titulo: pessoal ? "Notificações" : "Notificações e tarefas prioritárias",
      largura: 2,
      conteudo: (
        <Cartao
          titulo={
            <span className="flex items-center gap-2">
              <Bell className="size-4" /> {pessoal ? "Notificações" : "Notificações e tarefas"} ({avisos.length})
            </span>
          }
          acoes={
            pessoal ? undefined : (
              <Link href="/comercial/tarefas?novo=1" className="text-xs text-acento hover:underline">
                + tarefa
              </Link>
            )
          }
          className="h-full"
        >
          <ul className="space-y-2 text-sm">
            {avisos.slice(0, 9).map((a, i) => (
              <li key={i}>
                <Link href={a.href} className="flex items-center gap-2.5 rounded-[10px] px-1 py-1 hover:bg-card-hover">
                  <span className={`grid size-7 shrink-0 place-items-center rounded-[8px] border [&>svg]:size-3.5 ${corTom[a.tom]}`}>{a.icone}</span>
                  <span className="min-w-0 flex-1 truncate text-texto">{a.texto}</span>
                  {a.data && <span className={`whitespace-nowrap text-xs ${a.data < hoje ? "text-ruim" : "text-mudo"}`}>{formatarDataBR(a.data)}</span>}
                </Link>
              </li>
            ))}
            {avisos.length === 0 && <li className="py-2 text-mudo">Tudo em dia. Nenhuma pendência agora.</li>}
          </ul>
          {avisos.length > 9 && <p className="mt-2 text-xs text-mudo">+ {avisos.length - 9} outro(s)</p>}
        </Cartao>
      ),
    },
    {
      id: "visitas",
      titulo: "Próximos compromissos",
      largura: 2,
      conteudo: (
        <Cartao
          titulo={`Próximos compromissos (${visitas.length})`}
          acoes={
            <Link href="/agenda?novo=1" className="text-xs text-acento hover:underline">
              + agendar
            </Link>
          }
          className="h-full"
        >
          <ul className="divide-y divide-borda-suave text-sm">
            {visitas.slice(0, 5).map((v) => (
              <li key={v.id} className="flex items-center justify-between gap-2 py-2">
                <Link href={`/agenda/${v.id}`} className="min-w-0 truncate hover:underline">
                  <span className="font-medium text-texto">{v.titulo ?? nomeVisita(v) ?? ROTULO_TIPO_COMPROMISSO[v.tipo]}</span>
                  <span className="text-mudo">{v.imovel ? ` · ${v.imovel.codigo}` : ""}</span>
                </Link>
                <span className={`whitespace-nowrap text-xs ${diaLocal(v.data_hora) === hoje ? "font-semibold text-acento-hot" : "text-mudo"}`}>
                  {diaLocal(v.data_hora) === hoje ? "hoje" : formatarDataBR(diaLocal(v.data_hora))} {horaLocal(v.data_hora)}
                </span>
              </li>
            ))}
            {visitas.length === 0 && <li className="py-2 text-mudo">Nada marcado.</li>}
          </ul>
        </Cartao>
      ),
    },
    {
      id: "vistorias_abertas",
      titulo: "Vistorias em aberto",
      largura: 1,
      conteudo: (
        <Indicador
          rotulo="Vistorias em aberto"
          icone={<ClipboardList />}
          valor={<Contador valor={vistAbertasR.count ?? 0} />}
          detalhe={vistHojeR.count ? `${vistHojeR.count} marcada(s) para hoje` : "agendadas ou em andamento"}
          href="/vistorias?situacao=abertas"
        />
      ),
    },
    {
      id: "vistorias_contestadas",
      titulo: "Vistorias contestadas",
      largura: 1,
      conteudo: (
        <Indicador
          rotulo="Contestações a responder"
          icone={<MessageSquareWarning />}
          valor={<Contador valor={contestR.count ?? 0} />}
          detalhe="enviadas pelo locatário"
          tom={contestR.count ? "perigo" : "sucesso"}
          href="/vistorias?situacao=contestadas"
        />
      ),
    },
    {
      id: "reparos_vistoria",
      titulo: "Reparos de vistoria",
      largura: 1,
      conteudo: (
        <Indicador
          rotulo="Danos e reparos em aberto"
          icone={<Wrench />}
          valor={<Contador valor={reparosR.count ?? 0} />}
          detalhe={reparosVencR.count ? `${reparosVencR.count} com prazo vencido` : "nenhum prazo vencido"}
          tom={reparosVencR.count ? "alerta" : "neutro"}
          href="/vistorias/pendencias"
        />
      ),
    },
    {
      id: "manutencao",
      titulo: "Manutenção",
      largura: 1,
      conteudo: (
        <Indicador
          rotulo="Chamados em andamento"
          icone={<Wrench />}
          valor={<Contador valor={chamados.length} />}
          detalhe={[
            chamadosAtrasados.length ? `${chamadosAtrasados.length} atrasado(s) no atendimento` : "nenhum atrasado",
            !pessoal && chamadosAprovacao.length ? `${chamadosAprovacao.length} aguardando o proprietário` : "",
          ]
            .filter(Boolean)
            .join(" · ")}
          tom={chamadosAtrasados.length ? "perigo" : chamados.length ? "alerta" : "sucesso"}
          href="/manutencao"
        />
      ),
    },
    {
      id: "analises_pendentes",
      titulo: "Análise cadastral",
      largura: 1,
      conteudo: (
        <Indicador
          rotulo="Candidatos em análise"
          icone={<UserCheck />}
          valor={<Contador valor={analiseN.emAnalise} />}
          detalhe={analiseN.aguardandoGarantidora ? `${analiseN.aguardandoGarantidora} esperando a garantidora` : "nenhuma garantidora pendente"}
          tom={analiseN.emAnalise ? "alerta" : "neutro"}
          href="/analise"
        />
      ),
    },
    {
      id: "garantias_vencendo",
      titulo: "Garantias locatícias",
      largura: 1,
      conteudo: (
        <Indicador
          rotulo="Garantias vencendo em 30 dias"
          icone={<ShieldAlert />}
          valor={<Contador valor={analiseN.garantiasVencendo} />}
          detalhe={analiseN.garantiasVencidas ? `${analiseN.garantiasVencidas} já vencida(s)` : "nenhuma vencida"}
          tom={analiseN.garantiasVencidas ? "perigo" : analiseN.garantiasVencendo ? "alerta" : "sucesso"}
          href={analiseN.garantiasVencidas ? "/analise/garantias?filtro=vencida" : "/analise/garantias?filtro=30"}
        />
      ),
    },
    !pessoal && {
      id: "site_contatos",
      titulo: "Contatos pelo site",
      largura: 1,
      conteudo: (
        <Indicador
          rotulo="Contatos pelo site (30 dias)"
          icone={<Globe />}
          valor={<Contador valor={siteContatosR.count ?? 0} />}
          detalhe="contato, visita, anuncie e lançamentos"
          href="/site/contatos"
        />
      ),
    },
    !pessoal && {
      id: "portais_falhas",
      titulo: "Falhas nos portais",
      largura: 1,
      conteudo: (
        <Indicador
          rotulo="Imóveis com falha nos portais"
          icone={<Globe />}
          valor={<Contador valor={portaisFalhaR.count ?? 0} />}
          detalhe={portaisFalhaR.count ? "corrija o cadastro para voltar ao portal" : "nenhuma falha"}
          tom={portaisFalhaR.count ? "perigo" : "sucesso"}
          href="/site/portais/imoveis?filtro=falha"
        />
      ),
    },
    !pessoal && {
      id: "mkt_conversas",
      titulo: "Conversas do WhatsApp",
      largura: 1,
      conteudo: (
        <Indicador
          rotulo="Conversas esperando resposta"
          icone={<MessageCircle />}
          valor={<Contador valor={mktConversasR.count ?? 0} />}
          detalhe="caixa de entrada do Marketing"
          tom={mktConversasR.count ? "alerta" : "sucesso"}
          href="/marketing/conversas"
        />
      ),
    },
    !pessoal && {
      id: "mkt_fila",
      titulo: "Fila de envio",
      largura: 1,
      conteudo: (
        <Indicador
          rotulo="Mensagens para enviar agora"
          icone={<Megaphone />}
          valor={<Contador valor={mktFilaR.count ?? 0} />}
          detalhe="campanhas e automações"
          tom={mktFilaR.count ? "alerta" : "neutro"}
          href="/marketing/fila"
        />
      ),
    },
    {
      id: "portal_pedidos",
      titulo: "Pedidos pelo portal",
      largura: 1,
      conteudo: (
        <Indicador
          rotulo="Pedidos novos pelo portal"
          icone={<DoorOpen />}
          valor={<Contador valor={portalPedidosR.count ?? 0} />}
          detalhe="renovação, desocupação e contato"
          tom={portalPedidosR.count ? "alerta" : "sucesso"}
          href="/portais/solicitacoes"
        />
      ),
    },
    {
      id: "portal_conclusoes",
      titulo: "Serviços terminados pelo prestador",
      largura: 1,
      conteudo: (
        <Indicador
          rotulo="Prestador avisou que terminou"
          icone={<Hammer />}
          valor={<Contador valor={portalConclusoesR.count ?? 0} />}
          detalhe={portalConclusoesR.count ? "confira e conclua o chamado" : "nada esperando"}
          tom={portalConclusoesR.count ? "alerta" : "sucesso"}
          href="/manutencao"
        />
      ),
    },
    !pessoal && !!equipeN && {
      id: "equipe_creci",
      titulo: "CRECI a renovar",
      largura: 1,
      conteudo: (
        <Indicador
          rotulo="CRECI vencido ou vencendo (60 dias)"
          icone={<BadgeCheck />}
          valor={<Contador valor={equipeN!.creciVencendo} />}
          detalhe="corretores da equipe"
          tom={equipeN!.creciVencendo ? "perigo" : "sucesso"}
          href="/equipe?f=creci"
        />
      ),
    },
    !pessoal && !!equipeN && {
      id: "equipe_documentos",
      titulo: "Documentos da equipe a renovar",
      largura: 1,
      conteudo: (
        <Indicador
          rotulo="Documentos profissionais (30 dias)"
          icone={<FileClock />}
          valor={<Contador valor={equipeN!.documentosVencendo} />}
          detalhe="vencidos ou vencendo"
          tom={equipeN!.documentosVencendo ? "alerta" : "sucesso"}
          href="/equipe?f=documentos"
        />
      ),
    },
    !pessoal && !!equipeN && {
      id: "equipe_aprovacoes",
      titulo: "Aprovações pendentes",
      largura: 1,
      conteudo: (
        <Indicador
          rotulo="Aprovações esperando decisão"
          icone={<Gavel />}
          valor={<Contador valor={equipeN!.aprovacoesPendentes} />}
          detalhe="descontos, despesas, exceções"
          tom={equipeN!.aprovacoesPendentes ? "alerta" : "sucesso"}
          href="/equipe/aprovacoes"
        />
      ),
    },
    !pessoal && !!equipeN && {
      id: "equipe_tarefas",
      titulo: "Minhas tarefas internas",
      largura: 1,
      conteudo: (
        <Indicador
          rotulo="Minhas tarefas internas"
          icone={<ListTodo />}
          valor={<Contador valor={equipeN!.minhasTarefas} />}
          detalhe="em aberto"
          tom={equipeN!.minhasTarefas ? "alerta" : "neutro"}
          href="/equipe/tarefas"
        />
      ),
    },
    !pessoal && !!equipeN && {
      id: "equipe_mensagens",
      titulo: "Mensagens da equipe",
      largura: 1,
      conteudo: (
        <Indicador
          rotulo="Mensagens não lidas"
          icone={<Mail />}
          valor={<Contador valor={equipeN!.mensagensNaoLidas} />}
          detalhe="de colegas"
          tom={equipeN!.mensagensNaoLidas ? "alerta" : "neutro"}
          href="/equipe/comunicacao/mensagens"
        />
      ),
    },
    !pessoal && !!equipeN && {
      id: "equipe_avisos",
      titulo: "Avisos para confirmar",
      largura: 1,
      conteudo: (
        <Indicador
          rotulo="Avisos do mural para confirmar"
          icone={<Megaphone />}
          valor={<Contador valor={equipeN!.avisosNaoLidos} />}
          detalhe="confirme a leitura"
          tom={equipeN!.avisosNaoLidos ? "alerta" : "neutro"}
          href="/equipe/comunicacao"
        />
      ),
    },
    {
      id: "contratos_vencendo",
      titulo: "Contratos próximos do vencimento",
      largura: 2,
      conteudo: (
        <Cartao titulo={`Contratos vencendo em 60 dias (${vencendo.length})`} className="h-full">
          <ul className="divide-y divide-borda-suave text-sm">
            {vencendo.slice(0, 6).map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-2 py-2">
                <Link href={`/contratos/${c.id}`} className="text-acento hover:underline">
                  #{c.numero} · {c.imovel.codigo}
                </Link>
                <span className={`text-xs ${c.data_fim < hoje ? "font-semibold text-ruim" : "text-mudo"}`}>
                  {c.data_fim < hoje ? "venceu " : "vence "}
                  {formatarDataBR(c.data_fim)}
                </span>
              </li>
            ))}
            {vencendo.length === 0 && <li className="py-2 text-mudo">Nenhum contrato vencendo.</li>}
          </ul>
        </Cartao>
      ),
    },
    {
      id: "metas",
      titulo: "Metas comerciais",
      largura: 2,
      conteudo: (
        <Cartao
          titulo={
            <span className="flex items-center gap-2">
              <Target className="size-4" /> Metas do mês
            </span>
          }
          acoes={
            <Link href="/comercial/metas" className="text-xs text-acento hover:underline">
              {metasDef.length ? "editar" : "definir metas"}
            </Link>
          }
          className="h-full"
        >
          {metasDef.length === 0 ? (
            <p className="text-sm text-mudo">
              Nenhuma meta para este mês.{" "}
              <Link href="/comercial/metas" className="text-acento hover:underline">
                Definir agora
              </Link>
            </p>
          ) : (
            <ul className="space-y-3.5">
              {metasDef.map((t) => {
                const p = progressoMeta(realizado[t], metas[t])!;
                const fmt = (v: number) => (t === "faturamento" ? formatarReais(v) : String(v));
                return (
                  <li key={t}>
                    <div className="mb-1 flex justify-between gap-2 text-sm">
                      <span className="text-texto-2">{ROTULO_META[t]}</span>
                      <span className="tabular-nums text-texto">
                        <strong>{fmt(realizado[t])}</strong> <span className="text-mudo">de {fmt(metas[t]!)}</span>
                      </span>
                    </div>
                    <BarraProgresso pct={p.pct} atingida={p.atingida} />
                  </li>
                );
              })}
            </ul>
          )}
        </Cartao>
      ),
    },
    {
      id: "comparativo",
      titulo: "Comparativo mensal e anual",
      largura: 4,
      conteudo: (
        <Cartao titulo={pessoal ? "Receita: últimos 12 meses × ano anterior" : "Faturamento: últimos 12 meses × ano anterior"}>
          <div className="mb-5 grid gap-3 sm:grid-cols-3">
            <div className="rounded-[14px] border border-borda-suave p-3">
              <div className="text-xs text-mudo">Este mês × mês passado</div>
              <div className="mt-1 text-[18px] font-semibold tabular-nums text-texto">{formatarReais(faturamentoMes)}</div>
              <div className="text-xs text-mudo">
                <Variacao pct={varFat} /> mês passado: {formatarReais(fat12[10])} ({mesPassado.split("-").reverse().join("/")})
              </div>
            </div>
            <div className="rounded-[14px] border border-borda-suave p-3">
              <div className="text-xs text-mudo">Este mês × mesmo mês do ano passado</div>
              <div className="mt-1 text-[18px] font-semibold tabular-nums text-texto">{formatarReais(fatAnt[11])}</div>
              <div className="text-xs text-mudo">
                <Variacao pct={varFatAno} /> em {Number(anoAtual) - 1}
              </div>
            </div>
            <div className="rounded-[14px] border border-borda-suave p-3">
              <div className="text-xs text-mudo">Acumulado de {anoAtual} × mesmo período de {Number(anoAtual) - 1}</div>
              <div className="mt-1 text-[18px] font-semibold tabular-nums text-texto">{formatarReais(acumAno)}</div>
              <div className="text-xs text-mudo">
                <Variacao pct={variacaoPct(acumAno, acumAnoAnt)} /> antes: {formatarReais(acumAnoAnt)}
              </div>
            </div>
          </div>
          <GraficoComparativo meses={meses12} atual={fat12} anterior={fatAnt} />
        </Cartao>
      ),
    },
    {
      id: "imoveis_lista",
      titulo: "Lista de imóveis",
      largura: 2,
      conteudo: (
        <Cartao
          titulo={`Imóveis (${im.length})`}
          acoes={
            <Link href="/imoveis/novo" className="text-xs text-acento hover:underline">
              + novo imóvel
            </Link>
          }
          className="h-full"
        >
          <div className="mb-3 flex flex-wrap gap-2">
            {Object.keys(ROTULO_STATUS_IMOVEL)
              .filter((s) => qtd(s) > 0)
              .map((s) => (
                <Link key={s} href={`/imoveis?status=${s}`}>
                  <Selo cor={COR_STATUS[s as keyof typeof COR_STATUS] ?? "cinza"}>
                    {ROTULO_STATUS_IMOVEL[s]}: {qtd(s)}
                  </Selo>
                </Link>
              ))}
          </div>
          <ul className="divide-y divide-borda-suave text-sm">
            {im.slice(0, 6).map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-2 py-2">
                <span className="min-w-0 truncate">
                  <Link href={`/imoveis/${i.id}`} className="font-medium text-acento hover:underline">
                    {i.codigo}
                  </Link>
                  <span className="text-mudo"> — {[i.logradouro, i.numero, i.bairro].filter(Boolean).join(", ") || "sem endereço"}</span>
                </span>
                <Selo cor={COR_STATUS[i.status as keyof typeof COR_STATUS] ?? "cinza"}>{ROTULO_STATUS_IMOVEL[i.status] ?? i.status}</Selo>
              </li>
            ))}
            {im.length === 0 && (
              <li className="py-2 text-mudo">
                Nenhum imóvel cadastrado.{" "}
                <Link href="/imoveis/novo" className="text-acento hover:underline">
                  Cadastrar o primeiro
                </Link>
              </li>
            )}
          </ul>
        </Cartao>
      ),
    },
    {
      id: "pendencias",
      titulo: "Pendências dos imóveis",
      largura: 2,
      conteudo: (
        <Cartao titulo={`Pendências dos imóveis (${pendenciasImoveis.length})`} className="h-full">
          <ul className="space-y-2 text-sm">
            {pendenciasImoveis.slice(0, 8).map((p, i) => (
              <li key={i}>
                <Link href={p.href} className="text-alerta hover:underline">
                  {p.texto}
                </Link>
              </li>
            ))}
            {pendenciasImoveis.length === 0 && <li className="text-mudo">Nenhuma pendência.</li>}
          </ul>
        </Cartao>
      ),
    },
  ];

  const pref = (prefR.data?.widgets ?? null) as PreferenciaPainel | null;

  return (
    <>
      <Cabecalho
        titulo="Painel"
        descricao={`${organizacao.nome} · resumo de ${formatarDataBR(hoje)}`}
        acoes={
          <>
            {!pessoal && (
              <BotaoLink href="/comercial" variante="secundario">
                <UserPlus className="size-4" /> Leads
              </BotaoLink>
            )}
            <BotaoLink href="/faturas" variante="secundario">
              <CalendarClock className="size-4" /> Aluguéis do mês
            </BotaoLink>
            <BotaoLink href="/contratos/novo">Novo contrato</BotaoLink>
          </>
        }
      />
      <PainelWidgets
        quadros={quadros.filter((q): q is Quadro => Boolean(q) && quadroPermitido((q as Quadro).id, organizacao.modo))}
        preferencia={pref}
      />
    </>
  );
}
