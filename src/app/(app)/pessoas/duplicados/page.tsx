import type { Metadata } from "next";
import { Cabecalho, Cartao } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { formatarDocumento } from "@/lib/dominio/documentos";
import { ROTULO_MOTIVO_PESSOA, acharPessoasRepetidas } from "@/lib/dominio/pessoas";
import { ROTULO_PAPEL } from "@/lib/tipos";
import { JuntarGrupo } from "./juntar";

export const metadata: Metadata = { title: "Pessoas repetidas" };

export default async function PessoasDuplicadasPage() {
  const { supabase } = await obterContexto();
  const { data } = await supabase.from("pessoas").select("id, nome, documento, email, telefone, papeis, created_at").order("created_at");
  const grupos = acharPessoasRepetidas(data ?? []);
  return (
    <>
      <Cabecalho
        titulo="Possíveis cadastros repetidos"
        trilha="Pessoas"
        descricao="Pessoas com o mesmo CPF/CNPJ, e-mail, telefone ou nome. Marque qual cadastro fica e clique em Juntar: contratos, imóveis, documentos e histórico passam para ele."
      />
      {grupos.length === 0 ? (
        <div className="rounded-card border border-borda bg-card px-5 py-10 text-center text-sm text-mudo">Nenhum cadastro repetido. 👍</div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {grupos.map((g) => (
            <Cartao key={g.itens.map((i) => i.id).join("-")} titulo={<span className="capitalize">{ROTULO_MOTIVO_PESSOA[g.motivo]}</span>}>
              <JuntarGrupo
                itens={g.itens.map((i) => ({
                  id: i.id,
                  nome: i.nome,
                  detalhe: [formatarDocumento(i.documento), i.telefone, i.email, (i.papeis as string[]).map((x) => ROTULO_PAPEL[x] ?? x).join(", ")].filter(Boolean).join(" · "),
                }))}
              />
            </Cartao>
          ))}
        </div>
      )}
    </>
  );
}
