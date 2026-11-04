import { NextResponse, type NextRequest } from "next/server";
import { nomeArquivo, tabelaParaCSV, tabelaParaXLS } from "@/lib/dominio/bi";
import { hojeISO } from "@/lib/dominio/datas";
import { mensagemErro } from "@/lib/form";
import { pode } from "@/lib/permissoes";
import { contextoRelatorios } from "../dados";
import { relatorioDaUrl } from "../tabelas";

/**
 * Baixa um relatório (padrão ou personalizado) em CSV (UTF-8 com BOM e ";",
 * abre direto no Excel brasileiro) ou Excel (?formato=xls: planilha XML 2003).
 * Exige login e Relatórios → ver; os números vêm das funções do banco (RLS).
 */
export async function GET(request: NextRequest) {
  const { supabase, imob } = await contextoRelatorios();
  if (!(await pode("relatorios", "ver"))) return NextResponse.json({ erro: "Seu perfil de acesso não permite ver Relatórios." }, { status: 403 });
  const sp = Object.fromEntries(request.nextUrl.searchParams.entries());
  const hoje = hojeISO();
  let tabela;
  try {
    tabela = await relatorioDaUrl(supabase, sp, { imob, hoje });
  } catch (e) {
    return NextResponse.json({ erro: mensagemErro(e) }, { status: 400 });
  }
  const xls = sp.formato === "xls";
  const nome = nomeArquivo(tabela.titulo, hoje, xls ? "xls" : "csv");
  return new NextResponse(xls ? tabelaParaXLS(tabela) : tabelaParaCSV(tabela), {
    headers: {
      "Content-Type": xls ? "application/vnd.ms-excel; charset=utf-8" : "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${nome}"`,
      "Cache-Control": "no-store",
    },
  });
}
