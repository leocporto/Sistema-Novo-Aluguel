import "server-only";
import { after } from "next/server";
import { obterContexto } from "@/lib/contexto";

/** Última tentativa por organização nesta instância (o banco ainda segura 1 rodada a cada 10 min). */
const ultimaVez = new Map<string, number>();
const INTERVALO_MS = 60_000;

/**
 * "Relógio" das automações por regras (Assistente e automações), sem servidor
 * de tarefas — mesmo esquema do marketing: depois de responder qualquer tela
 * (a página já foi entregue, não atrasa nada), chama public.automacoes_rodar(),
 * que no máximo a cada 10 minutos por organização avalia as regras ativas
 * (trava por regra + objeto + dia) e prepara a resposta fora do horário.
 * Nos dois modos (gatilhos de leads só na imobiliária, o banco confere).
 * Erro aqui nunca aparece para o usuário. As automações de MARKETING continuam
 * em src/app/(app)/marketing/agendar.ts (não são duplicadas aqui).
 *
 * PONTO DE INTEGRAÇÃO: chamar `await agendarAutomacoesIA()` no layout do app
 * (src/app/(app)/layout.tsx), ao lado de agendarAutomacoesMarketing().
 */
export async function agendarAutomacoesIA(): Promise<void> {
  const { supabase, organizacao } = await obterContexto();
  const agora = Date.now();
  if ((ultimaVez.get(organizacao.id) ?? 0) > agora - INTERVALO_MS) return;
  ultimaVez.set(organizacao.id, agora);
  after(async () => {
    await supabase.rpc("automacoes_rodar", { p_forcar: false }).then(
      () => null,
      () => null,
    );
  });
}
