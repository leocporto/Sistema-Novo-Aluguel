import type { Metadata } from "next";
import { BotaoImprimir } from "@/components/formulario";
import { Aviso, BotaoLink, Cabecalho } from "@/components/ui";
import type { TabelaRelatorio } from "@/lib/dominio/bi";
import { formatarDataBR, hojeISO } from "@/lib/dominio/datas";
import { mensagemErro } from "@/lib/form";
import { TabelaRelatorioView } from "../componentes";
import { contextoRelatorios } from "../dados";
import { relatorioDaUrl } from "../tabelas";

export const metadata: Metadata = { title: "Imprimir relatório" };

/**
 * Versão para imprimir ou salvar em PDF de qualquer relatório (mesmos
 * parâmetros da exportação). No papel sai sempre no tema claro e sem o menu.
 */
export default async function ImprimirRelatorioPage({ searchParams }: PageProps<"/relatorios/imprimir">) {
  const sp = await searchParams;
  const hoje = hojeISO();
  const { supabase, imob, organizacao } = await contextoRelatorios();
  let tabela: TabelaRelatorio | null = null;
  let erro: string | null = null;
  try {
    tabela = await relatorioDaUrl(supabase, sp, { imob, hoje });
  } catch (e) {
    erro = mensagemErro(e);
  }
  const voltar = sp.r === "personalizado" && typeof sp.id === "string" ? `/relatorios/personalizados/${sp.id}` : "/relatorios";

  return (
    <>
      <Cabecalho
        titulo={tabela?.titulo ?? "Relatório"}
        trilha="Relatórios"
        descricao={
          <>
            {tabela?.subtitulo && <span className="block">{tabela.subtitulo}</span>}
            <span className="block">
              {organizacao.nome} · gerado em {formatarDataBR(hoje)}
            </span>
          </>
        }
        acoes={
          <div className="nao-imprimir flex gap-2">
            <BotaoImprimir />
            <BotaoLink href={voltar} variante="secundario">
              Voltar
            </BotaoLink>
          </div>
        }
      />
      <p className="nao-imprimir mb-4 text-sm text-mudo">Para salvar em PDF, clique em Imprimir e escolha “Salvar como PDF” no destino.</p>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {tabela && (
        <>
          <TabelaRelatorioView t={tabela} />
          {tabela.rodape && <p className="mt-3 text-xs text-mudo">{tabela.rodape}</p>}
        </>
      )}
    </>
  );
}
