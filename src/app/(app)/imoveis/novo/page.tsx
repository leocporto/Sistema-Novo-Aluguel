import type { Metadata } from "next";
import { Cabecalho } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import type { Pessoa } from "@/lib/tipos";
import { FormImovel } from "../form-imovel";

export const metadata: Metadata = { title: "Novo imóvel" };

export default async function NovoImovelPage() {
  const { supabase, organizacao } = await obterContexto();
  const { data } = await supabase.from("pessoas").select("*").contains("papeis", ["proprietario"]).order("nome");
  return (
    <>
      <Cabecalho titulo="Novo imóvel" />
      <FormImovel proprietarios={organizacao.modo === "pessoal" ? undefined : ((data ?? []) as Pessoa[])} />
    </>
  );
}
