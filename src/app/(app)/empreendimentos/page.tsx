import type { Metadata } from "next";
import { Building } from "lucide-react";
import { JanelaCadastro } from "@/components/janela-cadastro";
import { LinhaLink } from "@/components/linha-link";
import { Cabecalho, Celula, LinhaVazia, Tabela } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { criarEmpreendimento } from "./actions";
import { CamposEmpreendimento } from "./campos";

export const metadata: Metadata = { title: "Empreendimentos" };

export default async function EmpreendimentosPage() {
  const { supabase } = await obterContexto();
  const { data } = await supabase.from("empreendimentos").select("id, nome, construtora, bairro, cidade, imoveis(status)").order("nome");
  type E = { id: string; nome: string; construtora: string | null; bairro: string | null; cidade: string | null; imoveis: { status: string }[] };
  const lista = (data ?? []) as E[];
  return (
    <>
      <Cabecalho
        titulo="Empreendimentos"
        trilha="Cadastros"
        descricao="Prédios e condomínios com blocos e unidades. Cadastre o empreendimento e gere todas as unidades de uma vez."
        acoes={
          <JanelaCadastro rotuloBotao={<><Building className="size-4" /> Novo empreendimento</>} titulo="Novo empreendimento" acao={criarEmpreendimento} icone={<Building />} larguraMax="max-w-2xl">
            <CamposEmpreendimento />
          </JanelaCadastro>
        }
      />
      <Tabela colunas={["Empreendimento", "Construtora", "Local", "Unidades", "Disponíveis"]}>
        {lista.length === 0 && <LinhaVazia colunas={5}>Nenhum empreendimento cadastrado.</LinhaVazia>}
        {lista.map((e) => (
          <LinhaLink key={e.id} href={`/empreendimentos/${e.id}`} className="hover:bg-card-hover">
            <Celula className="font-semibold text-acento">{e.nome}</Celula>
            <Celula>{e.construtora ?? "—"}</Celula>
            <Celula>{[e.bairro, e.cidade].filter(Boolean).join(" · ") || "—"}</Celula>
            <Celula>{e.imoveis.length}</Celula>
            <Celula>{e.imoveis.filter((i) => i.status === "disponivel").length}</Celula>
          </LinhaLink>
        ))}
      </Tabela>
    </>
  );
}
