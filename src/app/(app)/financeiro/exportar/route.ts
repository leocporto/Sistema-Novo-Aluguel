import { NextResponse, type NextRequest } from "next/server";
import { formatarDataBR, hojeISO } from "@/lib/dominio/datas";
import { ROTULO_SITUACAO, GRUPOS_DRE, paraCSV, situacaoLancamento, valorRealizado } from "@/lib/dominio/financeiro";
import { criarClienteServidor } from "@/lib/supabase/server";
import { todas } from "../dados";
import { linhasRealizadas } from "../dre/dados";

const dataOk = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

/**
 * Exporta para o contador, em CSV (abre no Excel):
 * - padrão: todos os lançamentos com vencimento no período;
 * - ?tipo=dre: o que foi recebido/pago no período, com o grupo da DRE.
 */
export async function GET(request: NextRequest) {
  const supabase = await criarClienteServidor();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });
  const { data: membro } = await supabase.from("membros").select("organizacao:organizacoes(modo)").eq("user_id", auth.user.id).order("created_at").limit(1).maybeSingle();
  const pessoal = (membro?.organizacao as unknown as { modo?: string } | null)?.modo === "pessoal";
  const p = request.nextUrl.searchParams;
  const hoje = hojeISO();
  const de = dataOk(p.get("de")) ?? `${hoje.slice(0, 7)}-01`;
  const ate = dataOk(p.get("ate")) ?? hoje;
  let csv: string;
  let nome: string;

  if (p.get("tipo") === "dre") {
    const linhas = await linhasRealizadas(supabase, pessoal, de, ate);
    csv = paraCSV(
      ["Data", "Descrição", "Tipo", "Valor", "Conta do plano", "Grupo da DRE"],
      linhas
        .sort((a, b) => a.data.localeCompare(b.data))
        .map((l) => [formatarDataBR(l.data), l.descricao, l.tipo === "receber" ? "Receita" : "Despesa", l.valor, l.plano_nome ?? "", GRUPOS_DRE[l.grupo_dre ?? (l.tipo === "receber" ? "receita_operacional" : "despesas_operacionais")]]),
    );
    nome = `resultado-${de}-a-${ate}.csv`;
  } else {
    const data = await todas<unknown>(() =>
      supabase
        .from("lancamentos")
        .select("*, pessoa:pessoas(nome, documento), plano:plano_contas(codigo, nome), conta:contas_financeiras(nome), centro:centros_custo(nome)")
        .gte("vencimento", de)
        .lte("vencimento", ate)
        .order("vencimento")
        .order("id"),
    );
    type L = {
      tipo: "receber" | "pagar";
      descricao: string;
      categoria: string | null;
      valor: number;
      valor_pago: number | null;
      juros: number;
      desconto: number;
      vencimento: string;
      liquidado_em: string | null;
      status: string;
      requer_aprovacao: boolean;
      aprovado_em: string | null;
      documento_numero: string | null;
      forma: string | null;
      terceiros: boolean;
      pessoa: { nome: string; documento: string | null } | null;
      plano: { codigo: string; nome: string } | null;
      conta: { nome: string } | null;
      centro: { nome: string } | null;
    };
    csv = paraCSV(
      ["Vencimento", "Tipo", "Descrição", "Pessoa", "CPF/CNPJ", "Plano de contas", "Categoria", "Centro de custo", "Conta", "Valor", "Situação", "Data da baixa", "Valor pago", "Juros", "Desconto", "Forma", "Nº documento", "Terceiros"],
      (data as L[]).map((l) => [
        formatarDataBR(l.vencimento),
        l.tipo === "receber" ? "A receber" : "A pagar",
        l.descricao,
        l.pessoa?.nome ?? "",
        l.pessoa?.documento ?? "",
        l.plano ? `${l.plano.codigo} ${l.plano.nome}` : "",
        l.categoria ?? "",
        l.centro?.nome ?? "",
        l.conta?.nome ?? "",
        Number(l.valor),
        ROTULO_SITUACAO[situacaoLancamento(l, hoje)],
        l.liquidado_em ? formatarDataBR(l.liquidado_em) : "",
        l.status === "liquidado" ? valorRealizado(l) : null,
        Number(l.juros),
        Number(l.desconto),
        l.forma ?? "",
        l.documento_numero ?? "",
        l.terceiros ? "sim" : "",
      ]),
    );
    nome = `lancamentos-${de}-a-${ate}.csv`;
  }
  return new NextResponse(csv, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${nome}"` },
  });
}
