import { NextResponse, type NextRequest } from "next/server";
import { formatarDataBR } from "@/lib/dominio/datas";
import { paraCSV } from "@/lib/dominio/financeiro";
import { csvConversoesGoogle, csvConversoesMeta } from "@/lib/dominio/marketing";
import { criarClienteServidor } from "@/lib/supabase/server";
import { ROTULO_ORIGEM_LEAD } from "@/lib/tipos";
import { carregarLeadsOrigem } from "../dados";

/** Data só com dia vira meio-dia de Brasília (para não cair no dia anterior). */
const instante = (d: string) => (d.length === 10 ? `${d}T12:00:00-03:00` : d);

/**
 * Exporta:
 * - ?formato=google&evento=negocio|lead: conversões offline do Google Ads (gclid);
 * - ?formato=meta: eventos offline da Meta (negócios fechados);
 * - ?formato=leads: planilha de leads com origem, UTM e etapa.
 */
export async function GET(request: NextRequest) {
  const supabase = await criarClienteServidor();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });
  const { data: membro } = await supabase.from("membros").select("organizacao:organizacoes(modo)").eq("user_id", auth.user.id).order("created_at").limit(1).maybeSingle();
  if ((membro?.organizacao as unknown as { modo?: string } | null)?.modo === "pessoal") return NextResponse.json({ erro: "só no modo imobiliária" }, { status: 403 });

  const p = request.nextUrl.searchParams;
  const leads = await carregarLeadsOrigem(supabase, p.get("periodo") ?? "90", Date.now());
  const formato = p.get("formato");
  const csv = (corpo: string, nome: string) =>
    new NextResponse(corpo, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${nome}"` } });

  if (formato === "google") {
    const lead = p.get("evento") === "lead";
    const linhas = leads
      .filter((l) => l.gclid && (lead || l.status === "ganho"))
      .map((l) => ({ gclid: l.gclid!, data: lead ? l.created_at : instante(l.data_negocio ?? l.created_at), valor: lead ? null : l.valor }));
    return csv(csvConversoesGoogle(linhas, lead ? "Lead" : "Negócio fechado"), lead ? "google-ads-leads.csv" : "google-ads-negocios.csv");
  }
  if (formato === "meta") {
    const linhas = leads
      .filter((l) => l.status === "ganho")
      .map((l) => ({ email: l.email, telefone: l.telefone, nome: l.nome, evento: "Purchase", data: instante(l.data_negocio ?? l.created_at), valor: l.valor }));
    return csv(csvConversoesMeta(linhas), "meta-eventos-offline.csv");
  }
  return csv(
    paraCSV(
      ["Lead", "Telefone", "E-mail", "Chegou em", "Origem", "utm_source", "utm_medium", "utm_campaign", "Landing page", "Campanha", "gclid", "fbclid", "Visitas", "Propostas", "Negócio", "Valor"],
      leads.map((l) => [
        l.nome,
        l.telefone,
        l.email,
        formatarDataBR(l.created_at),
        ROTULO_ORIGEM_LEAD[l.origem] ?? l.origem,
        l.utm_source,
        l.utm_medium,
        l.utm_campaign,
        l.landing,
        l.campanha,
        l.gclid,
        l.fbclid,
        String(l.visitas),
        String(l.propostas),
        l.status === "ganho" ? "sim" : "",
        l.valor,
      ]),
    ),
    "leads-origem.csv",
  );
}
