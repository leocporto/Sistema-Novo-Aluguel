import { obterContexto } from "@/lib/contexto";
import { hojeISO } from "@/lib/dominio/datas";
import { pode } from "@/lib/permissoes";
import { equipeCondominio, moduloCondominios } from "../../../dados";
import { RELATORIOS_COND, montarRelatorioCond, paraCsv, type RelatorioCond } from "../tabelas";

/** CSV (Excel) do relatório do condomínio. Rota de arquivo: confere modo, módulo e papel aqui (o layout não roda em rota). */
export async function GET(req: Request, { params }: RouteContext<"/condominios/[id]/relatorios/exportar">) {
  const { id } = await params;
  const { supabase, papel, organizacao } = await obterContexto();
  if (!moduloCondominios(organizacao) || !equipeCondominio(papel) || !(await pode("financeiro", "ver"))) return new Response("Sem permissão.", { status: 403 });
  const sp = new URL(req.url).searchParams;
  const hoje = hojeISO();
  const r = (sp.get("r") ?? "") in RELATORIOS_COND ? (sp.get("r") as RelatorioCond) : "balancete";
  const mes = /^\d{4}-\d{2}$/.test(sp.get("mes") ?? "") ? (sp.get("mes") as string) : hoje.slice(0, 7);
  const ano = /^\d{4}$/.test(sp.get("ano") ?? "") ? Number(sp.get("ano")) : Number(hoje.slice(0, 4));
  const { data: c } = await supabase.from("cond_condominios").select("nome").eq("id", id).maybeSingle();
  if (!c) return new Response("Condomínio não encontrado.", { status: 404 });
  const t = await montarRelatorioCond(supabase, id, r, { mes, ano, conta: sp.get("conta") });
  const nome = `${String(c.nome).normalize("NFD").replace(/[^\w]+/g, "-").toLowerCase()}-${r}-${r === "previsto" || r === "fundo" ? ano : mes}.csv`;
  return new Response(paraCsv({ ...t, subtitulo: `${c.nome} · ${t.subtitulo}` }), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${nome}"`, "Cache-Control": "no-store" },
  });
}
