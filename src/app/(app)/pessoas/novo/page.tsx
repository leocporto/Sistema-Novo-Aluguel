import type { Metadata } from "next";
import { Cabecalho } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { FormPessoa, type ImovelOpcao } from "../form-pessoa";

export const metadata: Metadata = { title: "Nova pessoa" };

export default async function NovaPessoaPage({ searchParams }: PageProps<"/pessoas/novo">) {
  const sp = await searchParams;
  const { supabase, organizacao } = await obterContexto();
  const { data } = await supabase
    .from("imoveis")
    .select("id, codigo, logradouro, numero, bairro, cidade")
    .order("logradouro");
  return (
    <>
      <Cabecalho titulo="Nova pessoa" />
      <FormPessoa
        pessoal={organizacao.modo === "pessoal"}
        papelInicial={typeof sp.papel === "string" ? sp.papel : undefined}
        imoveis={(data ?? []) as ImovelOpcao[]}
      />
    </>
  );
}
