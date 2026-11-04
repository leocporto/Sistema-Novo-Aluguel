import type { Metadata } from "next";
import { Building2, FileSignature, Users } from "lucide-react";
import { Aviso, BotaoLink, Cabecalho, Cartao } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { AbasIntegracoes } from "../abas";
import { ImportadorContratos } from "./importador-contratos";

export const metadata: Metadata = { title: "Importar de outro sistema" };

/**
 * Importar de outro ERP: imóveis e pessoas já têm importação própria (leva até
 * lá); aqui o assistente de CONTRATOS (mapeamento de colunas, prévia com
 * validação, ligação por código do imóvel e CPF/CNPJ, modelos salvos).
 */
export default async function ImportarPage() {
  const { supabase, organizacao, papel } = await obterContexto();
  const admin = papel === "admin";
  const { data } = await supabase.from("importacao_modelos").select("id, nome, mapa").eq("tipo", "contratos").order("nome");
  const modelos = (data ?? []) as { id: string; nome: string; mapa: Record<string, string> }[];

  return (
    <>
      <Cabecalho
        titulo="Importar de outro sistema"
        trilha="Integrações"
        descricao="Trazendo os dados de outro sistema? Siga a ordem: primeiro imóveis e pessoas, depois os contratos (que ligam os dois)."
      />
      <AbasIntegracoes />
      <div className="entrar-cascata mb-6 grid grid-cols-1 gap-4 md:grid-cols-3">
        <Cartao titulo="1. Imóveis">
          <p className="mb-3 text-sm text-texto-2">Planilha do Excel ou CSV, com prévia, aviso de repetidos e planilha-modelo.</p>
          <BotaoLink href="/imoveis/importar" variante="secundario">
            <Building2 className="size-4" /> Importar imóveis
          </BotaoLink>
        </Cartao>
        <Cartao titulo="2. Pessoas">
          <p className="mb-3 text-sm text-texto-2">Proprietários, locatários e fiadores com CPF/CNPJ (é por ele que os contratos acham cada um).</p>
          <BotaoLink href="/pessoas/importar" variante="secundario">
            <Users className="size-4" /> Importar pessoas
          </BotaoLink>
        </Cartao>
        <Cartao titulo="3. Contratos">
          <p className="text-sm text-texto-2">
            <FileSignature className="mr-1 inline size-4" /> Aqui embaixo. {organizacao.modo === "pessoal" ? "" : "Os proprietários de cada imóvel precisam estar vinculados no cadastro do imóvel."}
          </p>
        </Cartao>
      </div>
      {admin ? (
        <Cartao titulo="Importar contratos">
          <ImportadorContratos modo={organizacao.modo} modelos={modelos} />
        </Cartao>
      ) : (
        <Aviso>Só o administrador importa contratos.</Aviso>
      )}
    </>
  );
}
