import "server-only";
import { after } from "next/server";
import { obterContexto } from "@/lib/contexto";
import { entregarWebhooks, vezDeEntregar } from "@/lib/servicos/integracoes/webhooks";

/**
 * "Relógio" dos webhooks sem servidor de tarefas (mesmo esquema do marketing):
 * depois de responder qualquer tela do sistema, entrega o que está vencido na
 * fila da organização — no máximo 5 por rodada e uma rodada a cada 20 s por
 * instância. Nos dois modos. Só quando quem usa é administrador ou gestor (são
 * eles que podem ler a fila; o banco devolve vazio para os outros papéis).
 * Erro aqui nunca aparece para o usuário.
 *
 * Ponto de integração: chamar `await agendarWebhooks()` no layout do app
 * (src/app/(app)/layout.tsx), ao lado de agendarAutomacoesMarketing().
 */
export async function agendarWebhooks(): Promise<void> {
  const { supabase, organizacao, papel } = await obterContexto();
  if (papel !== "admin" && papel !== "gestor") return;
  if (!vezDeEntregar(organizacao.id)) return;
  after(async () => {
    await entregarWebhooks(supabase).catch(() => null);
  });
}
