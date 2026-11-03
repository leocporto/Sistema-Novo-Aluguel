import { obterContexto } from "@/lib/contexto";
import { gerarICS } from "@/lib/dominio/agenda";
import { SELECT_COMPROMISSO, clienteDo, enderecoDo, tituloDo, type CompromissoTela } from "../../dados";

/** Baixa um compromisso como arquivo .ics (abre no calendário do celular/computador). */
export async function GET(_req: Request, ctx: RouteContext<"/agenda/[id]/ics">) {
  const { id } = await ctx.params;
  const { supabase } = await obterContexto();
  const { data } = await supabase.from("visitas").select(SELECT_COMPROMISSO).eq("id", id).maybeSingle();
  if (!data) return new Response("Não encontrado", { status: 404 });
  const v = data as unknown as CompromissoTela;
  const c = clienteDo(v);
  const ics = gerarICS([
    {
      id: v.id,
      titulo: tituloDo(v),
      inicio: v.data_hora,
      duracao_min: v.duracao_min,
      local: enderecoDo(v),
      descricao: [c?.nome, c?.telefone, v.link_virtual, v.observacoes].filter(Boolean).join("\n"),
      lembrete_min: v.lembrete_min,
      cancelado: v.status === "cancelada",
    },
  ]);
  return new Response(ics, {
    headers: { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": `attachment; filename="compromisso.ics"` },
  });
}
