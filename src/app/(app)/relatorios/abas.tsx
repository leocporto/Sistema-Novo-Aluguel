import { SubAbas } from "@/components/sub-abas";
import { Aviso } from "@/components/ui";
import { bancoPronto, contextoRelatorios } from "./dados";

/**
 * Abas do centro de relatórios. Comercial, Equipe e Obrigações (DIMOB) só na
 * imobiliária; Agendados some para o corretor (o envio sai com os dados da
 * imobiliária inteira).
 */
export async function AbasRelatorios() {
  const { imob, bi } = await contextoRelatorios();
  const pronto = await bancoPronto();
  const itens = [
    { href: "/relatorios", rotulo: "Visão geral" },
    { href: "/relatorios/financeiro", rotulo: "Financeiro" },
    { href: "/relatorios/imoveis", rotulo: "Imóveis" },
    ...(imob ? [{ href: "/relatorios/comercial", rotulo: "Comercial" }] : []),
    ...(imob ? [{ href: "/relatorios/equipe", rotulo: "Equipe" }] : []),
    { href: "/relatorios/previsao", rotulo: "Previsão" },
    { href: "/relatorios/metas", rotulo: "Metas" },
    { href: "/relatorios/personalizados", rotulo: "Personalizados" },
    ...(bi.rodar ? [{ href: "/relatorios/agendados", rotulo: "Envios programados" }] : []),
    ...(imob ? [{ href: "/relatorios/obrigacoes", rotulo: "DIMOB e informes" }] : []),
  ];
  return (
    <div className="nao-imprimir">
      <SubAbas rotulo="Relatórios" itens={itens} />
      {!pronto && (
        <div className="mb-5">
          <Aviso tipo="alerta">
            Os relatórios novos precisam de uma atualização do banco de dados (migração <code>20261107000008_relatorios_bi</code>). Enquanto ela não for aplicada, os números aparecem zerados.
          </Aviso>
        </div>
      )}
    </div>
  );
}
