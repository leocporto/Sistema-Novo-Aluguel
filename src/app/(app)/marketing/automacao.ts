import "server-only";
import { hojeISO, somarDias } from "@/lib/dominio/datas";
import {
  contatosParaImovel,
  deduplicar,
  devidoAgora,
  interessadoNoPreco,
  JANELA_AUTOMACAO_DIAS,
  motivoExclusao,
  reducaoPct,
  textosPreco,
  VALIDADE_EVENTO_DIAS,
  type Canal,
  type Contato,
  type Gatilho,
} from "@/lib/dominio/marketing";
import { carregarBloqueios, carregarContatos, landingPorImovel, numerico, obterConfig, SELECT_IMOVEL_BASICO, todas, type ImovelBasico, type Supabase } from "./dados";
import { corpoPadrao, gravarFila, linhaParaContato, type NovaLinhaEnvio, type NovaPesquisa } from "./montar-fila";

type Automacao = {
  id: string;
  nome: string;
  gatilho: Gatilho;
  acao: "mensagem" | "tarefa";
  canal: Canal;
  mensagem: string | null;
  dias: number;
  reducao_min_pct: number;
  publico: "leads" | "pessoas" | "ambos";
  modelo: { corpo: string; assunto: string | null } | null;
};

type Evento = {
  id: string;
  tipo: "novo_imovel" | "reducao_preco";
  imovel_id: string;
  campo: string | null;
  valor_anterior: number | null;
  valor_novo: number | null;
  criado_em: string;
};

export type ResultadoAutomacoes = { envios: number; tarefas: number; eventos: number };

const LIMITE_POR_EVENTO = 300;
const INTERVALO_MIN = 10;

/**
 * Roda as automações. Sem servidor de tarefas, o "relógio" é o próprio uso do
 * sistema: depois de responder qualquer tela (agendar.ts, chamado pelo layout do
 * app), ao abrir o Marketing ou pelo botão "Rodar agora" — no máximo a cada 10
 * minutos por imobiliária.
 * - imóvel novo / preço baixou: monta a fila para quem tem perfil compatível;
 * - pós-venda / pós-locação: X dias depois → mensagem na fila ou tarefa.
 * Nada é enviado sozinho: tudo cai na fila de envio.
 */
export async function processarAutomacoes(
  supabase: Supabase,
  opcoes: { base: string; imobiliaria: string; forcar?: boolean },
): Promise<ResultadoAutomacoes> {
  const res: ResultadoAutomacoes = { envios: 0, tarefas: 0, eventos: 0 };
  const cfg = await obterConfig(supabase);
  if (!opcoes.forcar && cfg.automacoes_em && Date.now() - new Date(cfg.automacoes_em).getTime() < INTERVALO_MIN * 60_000) return res;
  await supabase.from("mkt_config").update({ automacoes_em: new Date().toISOString() }).eq("id", cfg.id);

  const { data: autosBrutas } = await supabase
    .from("mkt_automacoes")
    .select("id, nome, gatilho, acao, canal, mensagem, dias, reducao_min_pct, publico, modelo:mkt_modelos(corpo, assunto)")
    .eq("ativa", true);
  const autos = ((autosBrutas ?? []) as unknown as Automacao[]).map((a) => ({ ...a, reducao_min_pct: Number(a.reducao_min_pct) }));
  const hoje = hojeISO();
  const agora = new Date().toISOString();

  // 1) Eventos de imóvel -------------------------------------------------------
  // Evento sem automação ativa fica esperando (se a regra for criada/ligada em até
  // 30 dias, ainda vale); depois disso expira.
  const validade = new Date(Date.now() - VALIDADE_EVENTO_DIAS * 86_400_000).toISOString();
  await supabase.from("mkt_eventos").update({ processado_em: agora, resultado: `Expirou (mais de ${VALIDADE_EVENTO_DIAS} dias sem ser aproveitado)` }).is("processado_em", null).lt("criado_em", validade);
  const tiposAtivos = [...new Set(autos.map((a) => a.gatilho).filter((g) => g === "novo_imovel" || g === "reducao_preco"))];
  const { data: evBrutos } = tiposAtivos.length
    ? await supabase
        .from("mkt_eventos")
        .select("id, tipo, imovel_id, campo, valor_anterior, valor_novo, criado_em")
        .is("processado_em", null)
        .in("tipo", tiposAtivos)
        .order("criado_em")
        .limit(200)
    : { data: [] };
  const eventos = (evBrutos ?? []) as Evento[];
  if (eventos.length) {
    const marcar = async (id: string, resultado: string) => {
      await supabase.from("mkt_eventos").update({ processado_em: agora, resultado }).eq("id", id);
      res.eventos++;
    };
    const [contatos, bloqueios, imoveisLista, landing] = await Promise.all([
      carregarContatos(supabase),
      carregarBloqueios(supabase),
      supabase.from("imoveis").select(SELECT_IMOVEL_BASICO).in("id", [...new Set(eventos.map((e) => e.imovel_id))]),
      landingPorImovel(supabase, opcoes.base),
    ]);
    const imoveis = new Map(((imoveisLista.data ?? []) as ImovelBasico[]).map((i) => [i.id, numerico(i)]));
    const abertos = contatos.filter((c) => c.tipo === "pessoa" || (c.status !== "ganho" && c.status !== "perdido"));

    for (const ev of eventos) {
      const doTipo = autos.filter((a) => a.gatilho === ev.tipo);
      const imovel = imoveis.get(ev.imovel_id);
      const velho = Date.now() - new Date(ev.criado_em).getTime() > VALIDADE_EVENTO_DIAS * 86_400_000;
      if (!imovel || imovel.status !== "disponivel") {
        if (velho || !imovel) await marcar(ev.id, "Imóvel não está disponível");
        continue;
      }
      const pct = ev.tipo === "reducao_preco" ? reducaoPct(ev.valor_anterior, ev.valor_novo) : 0;
      const linhas: NovaLinhaEnvio[] = [];
      const pesquisas: NovaPesquisa[] = [];
      let tarefas = 0;
      for (const a of doTipo) {
        if (ev.tipo === "reducao_preco" && pct < a.reducao_min_pct) continue;
        const publico = abertos.filter((c) => a.publico === "ambos" || (a.publico === "leads" ? c.tipo === "lead" : c.tipo === "pessoa"));
        // Preço que baixou: aluguel só para quem quer alugar; venda só para quem quer comprar/investir.
        const campo = ev.campo === "aluguel" || ev.campo === "venda" ? ev.campo : null;
        const alvo = deduplicar(contatosParaImovel(imovel, publico, ev.tipo === "reducao_preco"))
          .filter((c) => ev.tipo !== "reducao_preco" || !campo || interessadoNoPreco(c, campo, imovel.id))
          .filter((c) => !motivoExclusao(c, a.canal, "ofertas", false, bloqueios.descadastros, bloqueios.consentimentos));
        if (!alvo.length) continue;
        if (a.acao === "tarefa") {
          const chave = `evento:${ev.id}`;
          const { error } = await supabase.from("mkt_execucoes").insert({ automacao_id: a.id, chave });
          if (error) continue; // já feito
          const titulo =
            ev.tipo === "reducao_preco"
              ? `Preço do ${imovel.codigo} baixou ${pct}%: avisar ${alvo.length} interessado(s)`
              : `Imóvel novo ${imovel.codigo}: avisar ${alvo.length} interessado(s) (Marketing › Sugestões)`;
          // Sem responsável de propósito (cai em "sem responsável"): a automação roda com quem abriu a tela.
          const { data: t } = await supabase.from("tarefas").insert({ titulo, vencimento: hoje, imovel_id: imovel.id, responsavel_id: null }).select("id").single();
          if (t) await supabase.from("mkt_execucoes").update({ tarefa_id: t.id }).eq("automacao_id", a.id).eq("chave", chave);
          tarefas++;
          continue;
        }
        const precos = ev.tipo === "reducao_preco" ? textosPreco(ev.campo, ev.valor_anterior, ev.valor_novo) : { preco: null, precoAnterior: null };
        const ctx = { base: opcoes.base, imobiliaria: opcoes.imobiliaria, imovel, linkImovel: landing.get(imovel.id) ?? null, ...precos };
        for (const c of alvo.slice(0, LIMITE_POR_EVENTO)) {
          const r = linhaParaContato(c, {
            prefixoChave: `a:${a.id}:${ev.id}`,
            origem: "automacao",
            finalidade: "ofertas",
            canal: a.canal,
            corpo: a.modelo?.corpo || a.mensagem || corpoPadrao(ev.tipo),
            assunto: a.modelo?.assunto ?? null,
            agendadoPara: agora,
            automacaoId: a.id,
            imovelId: imovel.id,
            ctx,
          });
          linhas.push(r.linha);
          if (r.pesquisa) pesquisas.push(r.pesquisa);
        }
      }
      const n = await gravarFila(supabase, linhas, pesquisas);
      res.envios += n;
      res.tarefas += tarefas;
      await marcar(ev.id, n || tarefas ? `${n} mensagem(ns) na fila${tarefas ? `, ${tarefas} tarefa(s)` : ""}` : "Ninguém com perfil compatível");
    }
  }

  // 2) Pós-venda e pós-locação -------------------------------------------------
  const pos = autos.filter((a) => a.gatilho === "pos_venda" || a.gatilho === "pos_locacao");
  for (const a of pos) {
    const desde = somarDias(hoje, -(a.dias + JANELA_AUTOMACAO_DIAS));
    const ate = somarDias(hoje, -a.dias);
    type Alvo = { chave: string; contato: Contato; imovelId: string | null; vendaId?: string; contratoId?: string; titulo: string; leadId: string | null; imovel: ImovelBasico | null };
    const alvos: Alvo[] = [];
    if (a.gatilho === "pos_venda") {
      const vendas = await todas<{
        id: string;
        numero: number;
        concluida_em: string;
        comprador_nome: string | null;
        comprador_telefone: string | null;
        imovel: ImovelBasico | null;
        comprador: { id: string; nome: string; telefone: string | null; email: string | null; preferencias_token: string } | null;
        lead: { id: string; nome: string; telefone: string | null; email: string | null; preferencias_token: string } | null;
      }>(() =>
        supabase
          .from("vendas")
          .select(
            `id, numero, concluida_em, comprador_nome, comprador_telefone, imovel:imoveis(${SELECT_IMOVEL_BASICO}), comprador:pessoas!vendas_comprador_id_fkey(id, nome, telefone, email, preferencias_token), lead:leads(id, nome, telefone, email, preferencias_token)`,
          )
          .eq("status", "concluida")
          .gte("concluida_em", desde)
          .lte("concluida_em", ate)
          .order("id"),
      );
      for (const v of vendas) {
        if (!devidoAgora(v.concluida_em, a.dias, hoje)) continue;
        const c: Contato = v.comprador
          ? { tipo: "pessoa", ...v.comprador }
          : v.lead
            ? { tipo: "lead", ...v.lead }
            : { tipo: "pessoa", id: "", nome: v.comprador_nome ?? "Comprador", telefone: v.comprador_telefone, email: null };
        alvos.push({
          chave: `venda:${v.id}`,
          contato: c,
          imovelId: v.imovel?.id ?? null,
          imovel: v.imovel ? numerico(v.imovel) : null,
          vendaId: v.id,
          leadId: v.lead?.id ?? null,
          titulo: `Pós-venda: falar com ${c.nome} (venda #${v.numero}${v.imovel ? ` · ${v.imovel.codigo}` : ""})`,
        });
      }
    } else {
      const contratos = await todas<{
        id: string;
        numero: number;
        data_inicio: string;
        imovel: ImovelBasico | null;
        contrato_partes: { papel: string; pessoa: { id: string; nome: string; telefone: string | null; email: string | null; preferencias_token: string } | null }[];
      }>(() =>
        supabase
          .from("contratos")
          .select(`id, numero, data_inicio, imovel:imoveis(${SELECT_IMOVEL_BASICO}), contrato_partes(papel, pessoa:pessoas(id, nome, telefone, email, preferencias_token))`)
          .eq("status", "ativo")
          .gte("data_inicio", desde)
          .lte("data_inicio", ate)
          .order("id"),
      );
      for (const ct of contratos) {
        if (!devidoAgora(ct.data_inicio, a.dias, hoje)) continue;
        const locatarios = ct.contrato_partes.filter((p) => p.papel === "locatario" && p.pessoa);
        if (a.acao === "tarefa") {
          const nomes = locatarios.map((l) => l.pessoa!.nome.split(" ")[0]).join(", ") || "o locatário";
          alvos.push({
            chave: `contrato:${ct.id}`,
            contato: { tipo: "pessoa", id: locatarios[0]?.pessoa?.id ?? "", nome: nomes, telefone: null, email: null },
            imovelId: ct.imovel?.id ?? null,
            imovel: ct.imovel ? numerico(ct.imovel) : null,
            contratoId: ct.id,
            leadId: null,
            titulo: `Pós-locação: falar com ${nomes} (contrato #${ct.numero}${ct.imovel ? ` · ${ct.imovel.codigo}` : ""})`,
          });
        } else {
          for (const l of locatarios)
            alvos.push({
              chave: `contrato:${ct.id}:p:${l.pessoa!.id}`,
              contato: { tipo: "pessoa", ...l.pessoa! },
              imovelId: ct.imovel?.id ?? null,
              imovel: ct.imovel ? numerico(ct.imovel) : null,
              contratoId: ct.id,
              leadId: null,
              titulo: "",
            });
        }
      }
    }
    if (!alvos.length) continue;
    const { data: feitas } = await supabase
      .from("mkt_execucoes")
      .select("chave")
      .eq("automacao_id", a.id)
      .in(
        "chave",
        alvos.map((x) => x.chave),
      );
    const jaFeito = new Set((feitas ?? []).map((f) => f.chave as string));
    const novos = alvos.filter((x) => !jaFeito.has(x.chave));
    if (!novos.length) continue;
    const { error: eExec } = await supabase.from("mkt_execucoes").insert(novos.map((x) => ({ automacao_id: a.id, chave: x.chave })));
    if (eExec) continue; // outra aba rodou ao mesmo tempo
    if (a.acao === "tarefa") {
      for (const x of novos) {
        const { data: t } = await supabase
          .from("tarefas")
          .insert({ titulo: x.titulo.slice(0, 200), vencimento: hoje, imovel_id: x.imovelId, lead_id: x.leadId, contrato_id: x.contratoId ?? null, responsavel_id: null })
          .select("id")
          .single();
        if (t) await supabase.from("mkt_execucoes").update({ tarefa_id: t.id }).eq("automacao_id", a.id).eq("chave", x.chave);
        res.tarefas++;
      }
      continue;
    }
    const linhas: NovaLinhaEnvio[] = [];
    const pesquisas: NovaPesquisa[] = [];
    for (const x of novos) {
      const r = linhaParaContato(x.contato, {
        prefixoChave: `a:${a.id}:${x.chave}`,
        origem: "automacao",
        finalidade: "relacionamento",
        canal: a.canal,
        corpo: a.modelo?.corpo || a.mensagem || corpoPadrao(a.gatilho),
        assunto: a.modelo?.assunto ?? null,
        agendadoPara: agora,
        automacaoId: a.id,
        imovelId: x.imovelId,
        ctx: { base: opcoes.base, imobiliaria: opcoes.imobiliaria, imovel: x.imovel },
        pesquisa: { contexto: a.gatilho as "pos_venda" | "pos_locacao", venda_id: x.vendaId ?? null, contrato_id: x.contratoId ?? null, imovel_id: x.imovelId, pergunta: cfg.pesquisa_pergunta },
      });
      linhas.push(r.linha);
      if (r.pesquisa) pesquisas.push(r.pesquisa);
    }
    res.envios += await gravarFila(supabase, linhas, pesquisas);
  }
  return res;
}
