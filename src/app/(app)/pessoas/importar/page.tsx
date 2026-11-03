import type { Metadata } from "next";
import { Cabecalho, Cartao } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { COLUNAS_PESSOA } from "@/lib/dominio/pessoas";
import { PAPEIS_SO_IMOBILIARIA } from "@/lib/modos";
import { ROTULO_PAPEL } from "@/lib/tipos";
import { ImportadorPessoas } from "./importador";

export const metadata: Metadata = { title: "Importar pessoas" };

export default async function ImportarPessoasPage() {
  const { supabase, organizacao } = await obterContexto();
  const { data } = await supabase.from("pessoas").select("id, nome, documento, email, telefone");
  const papeis = Object.keys(ROTULO_PAPEL).filter((k) => organizacao.modo !== "pessoal" || !(PAPEIS_SO_IMOBILIARIA as readonly string[]).includes(k));
  return (
    <>
      <Cabecalho
        titulo="Importar pessoas"
        trilha="Pessoas"
        descricao="Traga clientes, proprietários e inquilinos de uma planilha (Excel ou CSV). Você vê a prévia com CPF inválido e cadastros repetidos antes de gravar."
      />
      <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
        <ImportadorPessoas existentes={data ?? []} papeisPermitidos={papeis} />
        <Cartao titulo="Colunas aceitas">
          <p className="mb-3 text-xs text-mudo">Use estes títulos na primeira linha. Só o nome é obrigatório.</p>
          <ul className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm text-texto-2">
            {COLUNAS_PESSOA.map((c) => (
              <li key={c.campo}>{c.rotulo}</li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-mudo">
            Papéis aceitos: {papeis.map((p) => ROTULO_PAPEL[p]).join(", ")}. Pode juntar: “inquilino e fiador”.
          </p>
        </Cartao>
      </div>
    </>
  );
}
