import { NextResponse, type NextRequest } from "next/server";
import { hojeISO } from "@/lib/dominio/datas";
import { agruparProdutividade, lerLinhaProdutividade, periodoPorChave, tempoMedioResposta, type Agrupamento } from "@/lib/dominio/equipe";
import { paraCSV } from "@/lib/dominio/financeiro";
import { criarClienteServidor } from "@/lib/supabase/server";

/** Planilha do desempenho da equipe (?periodo=mes|mes_passado|90d|ano&por=pessoa|equipe|filial). Só imobiliária. */
export async function GET(request: NextRequest) {
  const supabase = await criarClienteServidor();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });
  const { data: membro } = await supabase.from("membros").select("organizacao:organizacoes(modo)").eq("user_id", auth.user.id).order("created_at").limit(1).maybeSingle();
  if ((membro?.organizacao as unknown as { modo?: string } | null)?.modo === "pessoal") return NextResponse.json({ erro: "só no modo imobiliária" }, { status: 403 });
  const { data: perms } = await supabase.rpc("minhas_permissoes");
  if (perms && !((perms as Record<string, string[]>).equipe ?? []).includes("ver")) return NextResponse.json({ erro: "sem permissão" }, { status: 403 });

  const p = request.nextUrl.searchParams;
  const per = periodoPorChave(p.get("periodo") ?? "mes", hojeISO());
  const por = (["pessoa", "equipe", "filial"].includes(p.get("por") ?? "") ? p.get("por") : "pessoa") as Agrupamento;
  const [{ data }, { data: equipes }, { data: filiais }] = await Promise.all([
    supabase.rpc("equipe_produtividade", { p_inicio: per.inicio, p_fim: per.fim }),
    supabase.from("equipes").select("id, nome"),
    supabase.from("filiais").select("id, nome"),
  ]);
  const linhas = ((data ?? []) as Record<string, unknown>[]).map(lerLinhaProdutividade);
  const grupos = agruparProdutividade(linhas, por, {
    equipes: new Map((equipes ?? []).map((e) => [e.id as string, e.nome as string])),
    filiais: new Map((filiais ?? []).map((f) => [f.id as string, f.nome as string])),
  });
  const corpo = paraCSV(
    [por === "pessoa" ? "Colaborador" : por === "equipe" ? "Equipe" : "Filial", "Pessoas", "Leads recebidos", "Leads atendidos", "1º atendimento (min)", "Visitas", "Propostas", "Propostas fechadas", "Locações", "Vendas", "Valor vendido", "Captações", "Tarefas", "Chamados"],
    grupos.map((g) => [
      g.nome,
      String(g.pessoas),
      String(g.totais.leads_recebidos),
      String(g.totais.leads_atendidos),
      tempoMedioResposta(g.totais) === null ? "" : String(tempoMedioResposta(g.totais)),
      String(g.totais.visitas),
      String(g.totais.propostas),
      String(g.totais.propostas_aceitas),
      String(g.totais.locacoes),
      String(g.totais.vendas),
      g.totais.valor_vendas,
      String(g.totais.captacoes),
      String(g.totais.tarefas),
      String(g.totais.chamados),
    ]),
  );
  return new NextResponse(corpo, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="desempenho-${per.inicio}-a-${per.fim}.csv"` },
  });
}
