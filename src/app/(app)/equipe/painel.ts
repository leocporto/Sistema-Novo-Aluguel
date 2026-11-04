import "server-only";
import type { obterContexto } from "@/lib/contexto";
import { DIAS_AVISO_CRECI, DIAS_AVISO_DOCUMENTO, avisoParaMim } from "@/lib/dominio/equipe";
import { somarDias } from "@/lib/dominio/datas";

type Supabase = Awaited<ReturnType<typeof obterContexto>>["supabase"];

/**
 * Números para quadros do Painel (ponto de integração: painel-widgets.tsx).
 * Só no modo imobiliária. Contagens feitas no banco (head + count).
 */
export async function numerosEquipePainel(supabase: Supabase, hoje: string, usuarioId: string) {
  const [creci, docs, aprovacoes, tarefas, mensagens, avisos, lidos, onboardings, eu] = await Promise.all([
    supabase.from("pessoas").select("id", { count: "exact", head: true }).not("creci_validade", "is", null).lte("creci_validade", somarDias(hoje, DIAS_AVISO_CRECI)).is("desligamento", null),
    supabase.from("equipe_documentos").select("id", { count: "exact", head: true }).not("validade", "is", null).lte("validade", somarDias(hoje, DIAS_AVISO_DOCUMENTO)),
    supabase.from("aprovacoes").select("id", { count: "exact", head: true }).eq("status", "pendente"),
    supabase.from("equipe_tarefas").select("id", { count: "exact", head: true }).eq("responsavel_id", usuarioId).in("status", ["a_fazer", "em_andamento", "aguardando"]),
    supabase.from("equipe_mensagens").select("id", { count: "exact", head: true }).eq("para_id", usuarioId).is("lida_em", null),
    supabase.from("equipe_avisos").select("id, para, equipe_id, filial_id, papel, expira_em").eq("exige_leitura", true).or(`expira_em.is.null,expira_em.gte.${hoje}`).limit(500),
    supabase.from("equipe_aviso_leituras").select("aviso_id").eq("user_id", usuarioId).limit(2000),
    supabase.from("equipe_onboardings").select("id", { count: "exact", head: true }).eq("status", "em_andamento"),
    supabase.from("membros").select("papel, pessoa:pessoas(filial_id, equipe:equipe_membros(equipe_id))").eq("user_id", usuarioId).maybeSingle(),
  ]);
  const jaLidos = new Set((lidos.data ?? []).map((l) => l.aviso_id as string));
  const pessoa = (eu.data?.pessoa ?? null) as unknown as { filial_id: string | null; equipe: { equipe_id: string }[] | { equipe_id: string } | null } | null;
  const equipe = Array.isArray(pessoa?.equipe) ? (pessoa?.equipe[0]?.equipe_id ?? null) : (pessoa?.equipe?.equipe_id ?? null);
  const quem = { papel: (eu.data?.papel as string) ?? "", equipeId: equipe, filialId: pessoa?.filial_id ?? null };
  return {
    /** CRECI vencido ou vencendo em até 60 dias (→ /equipe?f=creci). */
    creciVencendo: creci.count ?? 0,
    /** Documentos profissionais vencidos ou vencendo em até 30 dias (→ /equipe?f=documentos). */
    documentosVencendo: docs.count ?? 0,
    /** Solicitações esperando decisão (→ /equipe/aprovacoes). */
    aprovacoesPendentes: aprovacoes.count ?? 0,
    /** Minhas tarefas internas em aberto (→ /equipe/tarefas). */
    minhasTarefas: tarefas.count ?? 0,
    /** Mensagens de colegas que eu ainda não li (→ /equipe/comunicacao/mensagens). */
    mensagensNaoLidas: mensagens.count ?? 0,
    /** Avisos do mural que pedem leitura e eu ainda não confirmei (→ /equipe/comunicacao). */
    avisosNaoLidos: ((avisos.data ?? []) as { id: string; para: string; equipe_id: string | null; filial_id: string | null; papel: string | null; expira_em: string | null }[]).filter(
      (a) => !jaLidos.has(a.id) && avisoParaMim(a, quem, hoje),
    ).length,
    /** Integrações de colaboradores em andamento (→ /equipe/onboarding). */
    onboardingsEmAndamento: onboardings.count ?? 0,
  };
}
