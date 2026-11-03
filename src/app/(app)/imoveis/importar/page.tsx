import type { Metadata } from "next";
import { Cabecalho, Cartao } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { COLUNAS_IMPORTACAO } from "@/lib/dominio/imoveis";
import { Importador } from "./importador";

export const metadata: Metadata = { title: "Importar imóveis" };

export default async function ImportarPage() {
  const { supabase } = await obterContexto();
  const { data } = await supabase.from("imoveis").select("id, codigo, logradouro, numero, complemento, cidade, matricula, inscricao_iptu");
  return (
    <>
      <Cabecalho
        titulo="Importar imóveis"
        trilha="Imóveis"
        descricao="Traga vários imóveis de uma vez a partir de uma planilha do Excel ou CSV. Antes de gravar, você vê a prévia com erros e possíveis repetidos."
      />
      <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
        <Importador existentes={(data ?? []) as { id: string; codigo: string }[]} />
        <Cartao titulo="Colunas aceitas">
          <p className="mb-3 text-xs text-mudo">Use estes títulos na primeira linha. Só o código é obrigatório; a ordem não importa.</p>
          <ul className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm text-texto-2">
            {COLUNAS_IMPORTACAO.map((c) => (
              <li key={c.campo}>{c.rotulo}</li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-mudo">Finalidade: locação, venda ou temporada (pode juntar: “venda e locação”). Valores como 2.500,00.</p>
        </Cartao>
      </div>
    </>
  );
}
