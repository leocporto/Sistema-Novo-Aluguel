import { testarWebhooks } from "@/lib/servicos/integracoes/api-v1";

/** POST /api/v1/webhooks/teste — põe um evento "webhook.teste" na fila (escopo webhooks:escrita). */
export async function POST(req: Request) {
  return testarWebhooks(req);
}
