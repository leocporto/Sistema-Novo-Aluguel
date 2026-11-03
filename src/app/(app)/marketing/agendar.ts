import "server-only";
import { after } from "next/server";
import { obterContexto } from "@/lib/contexto";
import { processarAutomacoes } from "./automacao";
import { urlBase } from "./dados";

/**
 * "Relógio" das automações de marketing sem servidor de tarefas: depois de
 * responder qualquer tela do sistema (a página já foi entregue, não atrasa
 * nada), roda as automações da imobiliária — imóvel novo, preço que baixou,
 * pós-venda e pós-locação montam a fila mesmo que ninguém abra o Marketing.
 * Roda no máximo a cada 10 minutos por imobiliária (processarAutomacoes) e
 * nunca no modo pessoal. Erro aqui nunca aparece para o usuário.
 */
export async function agendarAutomacoesMarketing(): Promise<void> {
  const { supabase, organizacao } = await obterContexto();
  if (organizacao.modo === "pessoal") return;
  // headers()/cookies() só podem ser lidos durante a renderização: lidos aqui, usados depois.
  const base = await urlBase();
  after(async () => {
    await processarAutomacoes(supabase, { base, imobiliaria: organizacao.nome }).catch(() => null);
  });
}
