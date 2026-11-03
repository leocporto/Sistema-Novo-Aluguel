import type { Metadata } from "next";
import { Cabecalho } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import type { Pessoa } from "@/lib/tipos";
import { FormImovel, type OpcaoEmpreendimento } from "../form-imovel";

export const metadata: Metadata = { title: "Novo imóvel" };

export default async function NovoImovelPage({ searchParams }: PageProps<"/imoveis/novo">) {
  const sp = await searchParams;
  const { supabase, organizacao } = await obterContexto();
  const pessoal = organizacao.modo === "pessoal";
  const [{ data }, { data: emps }] = await Promise.all([
    pessoal ? Promise.resolve({ data: [] }) : supabase.from("pessoas").select("*").contains("papeis", ["proprietario"]).order("nome"),
    pessoal ? Promise.resolve({ data: [] }) : supabase.from("empreendimentos").select("id, nome").order("nome"),
  ]);
  return (
    <>
      <Cabecalho titulo="Novo imóvel" descricao="Depois de cadastrar, você poderá enviar fotos, documentos e ver o mapa." />
      <FormImovel
        pessoal={pessoal}
        proprietarios={pessoal ? undefined : ((data ?? []) as Pessoa[])}
        empreendimentos={(emps ?? []) as OpcaoEmpreendimento[]}
        empreendimentoPadrao={typeof sp.empreendimento === "string" ? sp.empreendimento : undefined}
      />
    </>
  );
}
