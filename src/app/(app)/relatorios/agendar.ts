import "server-only";
import { after } from "next/server";
import { obterContexto } from "@/lib/contexto";
import { pode } from "@/lib/permissoes";
import { processarAgendamentos } from "./executar";

/** Última verificação por organização (nesta instância do servidor): no máximo 1 por minuto. */
const ultimaVez = new Map<string, number>();
const INTERVALO_MS = 60_000;

/**
 * "Relógio" dos envios programados de relatórios, sem servidor de tarefas
 * (mesmo esquema das automações de marketing): depois de responder a tela (a
 * página já foi entregue, não atrasa nada), gera os envios que já venceram e
 * apaga os arquivos que passaram do prazo de guarda. Só quando quem está
 * usando vê relatórios e não é corretor (o arquivo sai com os dados da
 * imobiliária inteira) — o banco confere de novo. Erro aqui nunca aparece
 * para o usuário.
 *
 * Hoje é chamado pelo layout de /relatorios (os envios saem quando alguém abre
 * os Relatórios). PONTO DE INTEGRAÇÃO: chamar `await agendarRelatorios()` no
 * layout do app (src/app/(app)/layout.tsx), ao lado de
 * agendarAutomacoesMarketing(), para valer em qualquer tela — e então tirar a
 * chamada de relatorios/layout.tsx e trocar o aviso da tela de envios
 * (agendados/page.tsx: "por enquanto, quando alguém… abre a área de
 * Relatórios") por "abre qualquer tela".
 */
export async function agendarRelatorios(): Promise<void> {
  const ctx = await obterContexto();
  if (ctx.papel === "corretor") return;
  // Sem Relatórios → ver no perfil, nem tenta (o banco recusaria).
  if (!(await pode("relatorios", "ver"))) return;
  const agora = Date.now();
  if ((ultimaVez.get(ctx.organizacao.id) ?? 0) > agora - INTERVALO_MS) return;
  ultimaVez.set(ctx.organizacao.id, agora);
  after(async () => {
    await processarAgendamentos(ctx).catch(() => null);
  });
}
