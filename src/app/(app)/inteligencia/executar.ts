import "server-only";
import type { obterContexto } from "@/lib/contexto";
import { ACAO_AUTOMATICA, permissaoAcao, type TipoAcaoIA } from "@/lib/dominio/ia";
import { mensagemErro } from "@/lib/form";
import { exigirPermissao } from "@/lib/permissoes";
import { moverLead, transferirLead } from "../comercial/actions";
import { adicionarDesconto } from "../contratos/locacao-actions";
import { cancelarFatura } from "../faturas/actions";

type Contexto = Awaited<ReturnType<typeof obterContexto>>;

export type AcaoParaExecutar = { id: string; tipo: TipoAcaoIA; payload: Record<string, unknown>; titulo: string };
export type ResultadoExecucao = { ok: boolean; resultado?: string; erro?: string };

const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));

function form(campos: Record<string, unknown>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(campos)) if (v !== null && v !== undefined && v !== "") fd.set(k, String(v));
  return fd;
}

/**
 * Roda uma ação APROVADA pela via normal do sistema — as mesmas actions/RPC
 * das telas de cada módulo, com a sessão de quem aprovou (RLS, gatilhos e
 * permissões valem). Mensagem ao cliente e renegociação pedem um passo humano
 * (abrir o WhatsApp com o texto; montar o acordo) e não passam por aqui.
 */
export async function executarAcao(ctx: Contexto, a: AcaoParaExecutar): Promise<ResultadoExecucao> {
  if (!ACAO_AUTOMATICA[a.tipo]) return { ok: false, erro: "Esta ação é feita à mão (abra pelo botão e depois marque como feita)." };
  const p = a.payload;
  try {
    const [modulo, operacao] = permissaoAcao(a.tipo, ctx.organizacao.modo !== "pessoal");
    await exigirPermissao(modulo, operacao);
    switch (a.tipo) {
      case "mudar_etapa_lead": {
        const r = await moverLead(s(p.lead_id), s(p.status), p.motivo ? s(p.motivo) : null);
        return r.ok ? { ok: true, resultado: "Etapa do lead mudada." } : { ok: false, erro: r.erro };
      }
      case "mudar_responsavel_lead": {
        const r = await transferirLead({}, form({ lead_id: p.lead_id, corretor_id: p.corretor_id ?? "", motivo: p.motivo ?? "Sugestão aprovada (Assistente e automações)" }));
        return r.erro ? { ok: false, erro: r.erro } : { ok: true, resultado: "Responsável do lead trocado." };
      }
      case "desconto": {
        const r = await adicionarDesconto({}, form({ contrato_id: p.contrato_id, tipo: p.tipo, valor: p.valor, inicio: p.inicio, fim: p.fim, motivo: p.motivo }));
        return r.erro ? { ok: false, erro: r.erro } : { ok: true, resultado: r.ok ?? "Desconto incluído." };
      }
      case "cancelar_cobranca": {
        const r = await cancelarFatura({}, form({ fatura_id: p.fatura_id, motivo: p.motivo }));
        return r.erro ? { ok: false, erro: r.erro } : { ok: true, resultado: "Cobrança cancelada." };
      }
      case "alterar_preco": {
        const campo = p.campo === "valor_venda" ? "valor_venda" : "valor_aluguel";
        const { error } = await ctx.supabase.from("imoveis").update({ [campo]: Number(p.valor) }).eq("id", s(p.imovel_id));
        if (error) throw error;
        return { ok: true, resultado: "Preço do imóvel atualizado (fica no histórico de preços)." };
      }
      case "criar_lancamento": {
        const { error } = await ctx.supabase.from("lancamentos").insert({
          tipo: p.tipo,
          descricao: s(p.descricao),
          categoria: p.categoria ? s(p.categoria) : null,
          valor: Number(p.valor),
          vencimento: s(p.vencimento),
          status: "aberto",
          pessoa_id: p.pessoa_id ?? null,
          contrato_id: p.contrato_id ?? null,
          imovel_id: p.imovel_id ?? null,
        });
        if (error) throw error;
        return { ok: true, resultado: "Lançamento criado em aberto no Financeiro." };
      }
      case "criar_tarefa": {
        const { error } = await ctx.supabase.from("tarefas").insert({
          titulo: s(p.titulo),
          vencimento: p.vencimento ?? null,
          prioridade: p.prioridade === "alta" ? "alta" : "normal",
          lead_id: p.lead_id ?? null,
          imovel_id: p.imovel_id ?? null,
          contrato_id: p.contrato_id ?? null,
        });
        if (error) throw error;
        return { ok: true, resultado: "Tarefa criada." };
      }
      default:
        return { ok: false, erro: "Esta ação é feita à mão." };
    }
  } catch (e) {
    return { ok: false, erro: mensagemErro(e) };
  }
}
