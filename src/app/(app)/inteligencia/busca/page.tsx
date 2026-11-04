import type { Metadata } from "next";
import { Cabecalho, Cartao } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { AbasInteligencia } from "../abas";
import { AvisoIA } from "../componentes";
import { estadoIA, exigirOuVoltar, podeConfigurarIA } from "../dados";
import { BuscaImoveis } from "./busca";

export const metadata: Metadata = { title: "Imóveis por texto" };

/** Sugestões de imóveis por linguagem natural (nos dois modos). */
export default async function BuscaPage() {
  const { supabase, organizacao, papel } = await obterContexto();
  await exigirOuVoltar("imoveis", "ver");
  const ia = await estadoIA(supabase);
  return (
    <>
      <Cabecalho
        titulo="Imóveis por texto"
        trilha="Assistente e automações"
        descricao="Escreva como o cliente falou. O sistema transforma o pedido em filtros (tipo, quartos, valor, bairro, vagas, comodidades) e busca nos imóveis disponíveis — a IA nunca escreve consulta ao banco."
      />
      <AbasInteligencia modo={organizacao.modo} />
      <div className="space-y-5">
        <AvisoIA configurada={ia.configurada} ativa={ia.config.ativa} podeConfigurar={podeConfigurarIA(papel)} />
        <Cartao>
          <BuscaImoveis />
        </Cartao>
      </div>
    </>
  );
}
