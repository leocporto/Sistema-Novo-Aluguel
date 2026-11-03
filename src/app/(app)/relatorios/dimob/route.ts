import { NextResponse, type NextRequest } from "next/server";
import { consolidarDimob, dimobParaCSV, type RepasseDimob } from "@/lib/dominio/dimob";
import { paraCentavos } from "@/lib/dominio/dinheiro";
import { criarClienteServidor } from "@/lib/supabase/server";

type Linha = {
  competencia: string;
  aluguel: number;
  multa_juros: number;
  taxa_administracao: number;
  taxa_intermediacao: number;
  irrf: number;
  pessoa: { nome: string; documento: string | null };
  contrato: {
    numero: number;
    codigo: string | null;
    data_inicio: string;
    imovel: { logradouro: string | null; numero: string | null; complemento: string | null; cep: string | null; cidade: string | null; uf: string | null };
    contrato_partes: { papel: string; pessoa: { nome: string; documento: string | null } }[];
  };
};

/** Exporta a planilha de apoio à DIMOB do ano informado (?ano=2026). */
export async function GET(request: NextRequest) {
  const supabase = await criarClienteServidor();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });
  // DIMOB é obrigação da imobiliária: no modo imóveis pessoais não existe.
  const { data: membro } = await supabase.from("membros").select("organizacao:organizacoes(modo)").eq("user_id", auth.user.id).order("created_at").limit(1).maybeSingle();
  if ((membro?.organizacao as unknown as { modo?: string } | null)?.modo === "pessoal")
    return NextResponse.json({ erro: "A DIMOB só existe no modo imobiliária." }, { status: 403 });

  const ano = Number(request.nextUrl.searchParams.get("ano")) || new Date().getFullYear();
  const { data, error } = await supabase
    .from("repasses")
    .select(
      "competencia, aluguel, multa_juros, taxa_administracao, taxa_intermediacao, irrf, pessoa:pessoas(nome, documento), contrato:contratos(numero, codigo, data_inicio, imovel:imoveis(logradouro, numero, complemento, cep, cidade, uf), contrato_partes(papel, pessoa:pessoas(nome, documento)))",
    )
    .neq("status", "cancelado")
    .gte("competencia", `${ano}-01-01`)
    .lte("competencia", `${ano}-12-31`);
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });

  const repasses: RepasseDimob[] = ((data ?? []) as unknown as Linha[]).map((r) => {
    const loc = r.contrato.contrato_partes.find((p) => p.papel === "locatario")?.pessoa;
    const im = r.contrato.imovel;
    return {
      contratoCodigo: r.contrato.codigo ?? String(r.contrato.numero),
      dataContrato: r.contrato.data_inicio,
      imovelEndereco: [im.logradouro, im.numero, im.complemento].filter(Boolean).join(", "),
      imovelCep: (im.cep ?? "").replace(/\D/g, ""),
      imovelCidade: im.cidade ?? "",
      imovelUf: im.uf ?? "",
      locadorNome: r.pessoa.nome,
      locadorDocumento: (r.pessoa.documento ?? "").replace(/\D/g, ""),
      locatarioNome: loc?.nome ?? "",
      locatarioDocumento: (loc?.documento ?? "").replace(/\D/g, ""),
      competencia: r.competencia,
      aluguelBruto: paraCentavos(r.aluguel) + paraCentavos(r.multa_juros),
      comissao: paraCentavos(r.taxa_administracao) + paraCentavos(r.taxa_intermediacao),
      irrf: paraCentavos(r.irrf),
    };
  });

  const csv = dimobParaCSV(consolidarDimob(repasses, ano));
  return new NextResponse(`﻿${csv}`, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="dimob-${ano}.csv"`,
    },
  });
}
