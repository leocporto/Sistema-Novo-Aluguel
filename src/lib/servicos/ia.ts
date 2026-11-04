import "server-only";
import type { obterContexto } from "@/lib/contexto";
import { INSTRUCOES_FIXAS, extrairJSON, mascararDadosPessoais, saidaParaHistorico, type PedidoMontado, type RecursoIA } from "@/lib/dominio/ia";

/*
 * Camada única de IA (Messages API da Anthropic), só no servidor:
 * 1. confere se a chave e o modelo existem (ANTHROPIC_API_KEY e ANTHROPIC_MODEL);
 * 2. RESERVA a cota no banco (public.ia_reservar: IA ligada, recurso ligado,
 *    permissão, modo e limite diário por organização e por usuário);
 * 3. chama a API com tempo limite, instruções fixas com cache de prompt e os
 *    dados do usuário sempre delimitados;
 * 4. registra a execução (public.ia_concluir: tokens, custo estimado, duração,
 *    status, saída mascarada — da leitura de documentos, só os nomes dos campos
 *    encontrados, nunca os dados lidos);
 * 5. devolve só o JSON lido — quem chama valida o formato contra a lista
 *    fechada antes de mostrar ou gravar qualquer coisa.
 * O modelo vem SÓ da variável de ambiente. Sem as variáveis, nada é chamado e
 * a tela usa a versão por regra (quando existe).
 */

type Supabase = Awaited<ReturnType<typeof obterContexto>>["supabase"];

const URL_API = "https://api.anthropic.com/v1/messages";
const VERSAO_API = "2023-06-01";
const TEMPO_MS = 60_000;
/** Tamanho máximo de arquivo enviado para leitura (imagem e PDF). */
export const MAX_ARQUIVO_IA = { imagem: 5 * 1024 * 1024, pdf: 10 * 1024 * 1024 };
export const TIPOS_IMAGEM_IA = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;

export const MENSAGEM_SEM_IA = "IA não configurada (peça ao administrador para cadastrar a chave).";

/** As variáveis de ambiente da IA existem? (a chave nunca sai do servidor) */
export function iaConfigurada(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim() && process.env.ANTHROPIC_MODEL?.trim());
}

export type AnexoIA = { tipo: "imagem"; midia: (typeof TIPOS_IMAGEM_IA)[number]; base64: string } | { tipo: "pdf"; base64: string };

export type PedidoIA = {
  recurso: RecursoIA;
  pedido: PedidoMontado;
  /** Resumo da entrada para o histórico (sem dados sensíveis; é mascarado de novo no banco). */
  entradaResumo: string;
  referencia?: { tipo: string; id: string } | null;
  anexo?: AnexoIA | null;
};

export type MotivoSemIA = "nao_configurada" | "desligada" | "recurso_desligado" | "limite_org" | "limite_usuario" | "permissao" | "modo" | "erro";
export type RespostaIA =
  | { ok: true; json: Record<string, unknown>; texto: string; execucaoId: string }
  | { ok: false; motivo: MotivoSemIA; mensagem: string; execucaoId?: string };

type Uso = { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };

async function concluir(supabase: Supabase, id: string, dados: Record<string, unknown>) {
  // Registrar nunca derruba a resposta ao usuário.
  await supabase.rpc("ia_concluir", { p_id: id, p: dados }).then(
    () => null,
    () => null,
  );
}

/** Chama a IA para um recurso. Nunca lança: devolve {ok:false, mensagem} em qualquer falha. */
export async function chamarIA(supabase: Supabase, p: PedidoIA): Promise<RespostaIA> {
  if (!iaConfigurada()) return { ok: false, motivo: "nao_configurada", mensagem: MENSAGEM_SEM_IA };

  const { data: reserva, error: erroReserva } = await supabase.rpc("ia_reservar", {
    p_recurso: p.recurso,
    p_entrada: mascararDadosPessoais(p.entradaResumo).slice(0, 2000),
    p_ref_tipo: p.referencia?.tipo ?? null,
    p_ref_id: p.referencia?.id ?? null,
  });
  if (erroReserva) return { ok: false, motivo: "erro", mensagem: erroReserva.message.includes("ia_reservar") ? "A IA precisa da atualização do banco (migração 20261107000010)." : erroReserva.message };
  const r = (reserva ?? {}) as { ok?: boolean; id?: string; motivo?: MotivoSemIA; mensagem?: string };
  if (!r.ok || !r.id) return { ok: false, motivo: r.motivo ?? "erro", mensagem: r.mensagem ?? "Não foi possível usar a IA agora." };
  const id = r.id;

  const conteudo: Record<string, unknown>[] = [];
  if (p.anexo?.tipo === "imagem") conteudo.push({ type: "image", source: { type: "base64", media_type: p.anexo.midia, data: p.anexo.base64 } });
  if (p.anexo?.tipo === "pdf") conteudo.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: p.anexo.base64 } });
  conteudo.push({ type: "text", text: p.pedido.usuario });

  const inicio = Date.now();
  let resposta: Response;
  try {
    resposta = await fetch(URL_API, {
      method: "POST",
      headers: {
        "x-api-key": process.env.ANTHROPIC_API_KEY!.trim(),
        "anthropic-version": VERSAO_API,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL!.trim(),
        max_tokens: p.pedido.maxTokens,
        // Instruções fixas primeiro (iguais em todo pedido) e as do recurso depois,
        // as duas marcadas para o cache de prompt; os dados vão só na mensagem.
        system: [
          { type: "text", text: INSTRUCOES_FIXAS },
          { type: "text", text: p.pedido.instrucoes, cache_control: { type: "ephemeral" } },
        ],
        messages: [{ role: "user", content: conteudo }],
      }),
      signal: AbortSignal.timeout(TEMPO_MS),
      cache: "no-store",
      redirect: "error",
    });
  } catch (e) {
    const tempo = e instanceof Error && e.name === "TimeoutError";
    const mensagem = tempo ? "A IA não respondeu a tempo. Tente de novo." : "Não foi possível falar com a IA agora.";
    await concluir(supabase, id, { status: "erro", erro: mensagem, duracao_ms: Date.now() - inicio });
    return { ok: false, motivo: "erro", mensagem, execucaoId: id };
  }

  const corpo = (await resposta.json().catch(() => null)) as {
    content?: { type: string; text?: string }[];
    usage?: Uso;
    stop_reason?: string;
    error?: { message?: string; type?: string };
  } | null;
  const uso = corpo?.usage ?? {};
  const base = {
    duracao_ms: Date.now() - inicio,
    tokens_entrada: uso.input_tokens ?? 0,
    tokens_saida: uso.output_tokens ?? 0,
    tokens_cache_leitura: uso.cache_read_input_tokens ?? 0,
    tokens_cache_escrita: uso.cache_creation_input_tokens ?? 0,
  };
  if (!resposta.ok || !corpo) {
    const mensagem =
      resposta.status === 401 || resposta.status === 403
        ? "A chave da IA foi recusada. Peça ao administrador para conferir a chave."
        : resposta.status === 429
          ? "A IA está com muitos pedidos agora. Tente de novo em instantes."
          : resposta.status >= 500
            ? "O serviço de IA está fora do ar no momento."
            : `A IA recusou o pedido (${resposta.status}).`;
    await concluir(supabase, id, { ...base, status: "erro", erro: `${mensagem} ${corpo?.error?.type ?? ""}`.trim() });
    return { ok: false, motivo: "erro", mensagem, execucaoId: id };
  }
  const texto = (corpo.content ?? [])
    .filter((c) => c.type === "text")
    .map((c) => c.text ?? "")
    .join("\n")
    .trim();
  const json = extrairJSON(texto);
  if (!json) {
    const mensagem = corpo.stop_reason === "max_tokens" ? "A resposta da IA ficou longa demais e veio cortada. Tente de novo." : "A IA respondeu fora do formato combinado. Tente de novo.";
    // Texto fora do formato: guarda só mascarado (e nada da leitura de documentos).
    const saida = p.recurso === "extracao_documento" ? null : mascararDadosPessoais(texto).slice(0, 2000);
    await concluir(supabase, id, { ...base, status: "erro", erro: mensagem, saida });
    return { ok: false, motivo: "erro", mensagem, execucaoId: id };
  }
  await concluir(supabase, id, { ...base, status: "ok", saida: saidaParaHistorico(p.recurso, json) });
  return { ok: true, json, texto, execucaoId: id };
}

