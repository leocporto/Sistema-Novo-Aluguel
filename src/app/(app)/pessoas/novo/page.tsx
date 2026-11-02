import type { Metadata } from "next";
import { Cabecalho } from "@/components/ui";
import { FormPessoa } from "../form-pessoa";

export const metadata: Metadata = { title: "Nova pessoa" };

export default async function NovaPessoaPage({ searchParams }: PageProps<"/pessoas/novo">) {
  const sp = await searchParams;
  return (
    <>
      <Cabecalho titulo="Nova pessoa" />
      <FormPessoa papelInicial={typeof sp.papel === "string" ? sp.papel : undefined} />
    </>
  );
}
