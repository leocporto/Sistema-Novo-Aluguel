import { obterContexto } from "@/lib/contexto";
import { formatarCompetencia, formatarDataBR, hojeISO } from "@/lib/dominio/datas";
import { paraCSV } from "@/lib/dominio/financeiro";
import { faixaAtraso } from "@/lib/dominio/cobrancas";
import { carregarCobrancas, reais } from "../../dados";

/** Planilha (CSV) das cobranças vencidas, com aluguel, multa e juros separados e a faixa de atraso. */
export async function GET() {
  const { supabase } = await obterContexto();
  const hoje = hojeISO();
  const lista = (await carregarCobrancas(supabase, hoje, { venceAte: hoje, status: ["aberta", "renegociada"] })).filter((c) => c.dias > 0);
  const csv = paraCSV(
    ["Cobrança", "Locatário", "Telefone", "Imóvel", "Contrato", "Mês", "Vencimento", "Dias de atraso", "Faixa", "Situação", "Já recebido", "Saldo do aluguel", "Multa (hoje)", "Juros (hoje)", "Total hoje"],
    lista.map((c) => [
      c.numero,
      c.locatario?.nome ?? "",
      c.locatario?.telefone ?? "",
      c.imovelTexto,
      c.contratoNumero,
      formatarCompetencia(c.competencia),
      formatarDataBR(c.vencimento),
      c.dias,
      faixaAtraso(c.dias) ?? "",
      c.status === "renegociada" ? "em acordo" : c.juridicoAtivo ? "jurídico" : c.sit.parcial ? "parcial" : "em aberto",
      reais(c.sit.recebido),
      reais(c.sit.saldo),
      reais(c.sit.multa),
      reais(c.sit.juros),
      reais(c.sit.totalComEncargos),
    ]),
  );
  return new Response(csv, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="inadimplencia-${hoje}.csv"` },
  });
}
