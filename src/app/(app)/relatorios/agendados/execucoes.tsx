import { Download, MessageCircle } from "lucide-react";
import { BotaoExcluir } from "@/components/botao-excluir";
import { Copiar } from "@/components/copiar";
import { Celula, LinhaVazia, Selo, Tabela, classeBotao } from "@/components/ui";
import { COR_STATUS_EXECUCAO, DIAS_GUARDA_ARQUIVOS, ROTULO_STATUS_EXECUCAO, mensagemWhatsApp } from "@/lib/dominio/bi";
import { formatarDataHora } from "@/lib/dominio/marketing";
import { linkWhatsapp } from "@/lib/whatsapp";
import { apagarArquivoExecucao } from "../actions";
import type { Execucao } from "../dados";

/**
 * Histórico de envios: quem gerou, arquivo para baixar, link para copiar,
 * WhatsApp com a mensagem pronta e (para quem programa envios) apagar o
 * arquivo antes do prazo de guarda.
 */
export function TabelaExecucoes({
  execucoes,
  links,
  imobiliaria,
  nomes,
  podeApagar,
}: {
  execucoes: Execucao[];
  links: Map<string, string>;
  imobiliaria: string;
  nomes: Map<string, string>;
  podeApagar: boolean;
}) {
  return (
    <>
      <Tabela colunas={["Quando", "Envio", "Situação", "Arquivo e envio"]}>
        {execucoes.length === 0 && <LinhaVazia colunas={4}>Nenhum envio gerado ainda.</LinhaVazia>}
        {execucoes.map((e) => {
          const link = e.arquivo_path && !e.arquivo_apagado_em ? links.get(e.arquivo_path) : undefined;
          const periodo = e.destinatarios?.periodo ?? "";
          const zaps = e.destinatarios?.whatsapps ?? [];
          const emails = e.destinatarios?.emails ?? [];
          return (
            <tr key={e.id}>
              <Celula>
                {formatarDataHora(e.data)}
                <span className="block text-xs text-mudo">
                  {e.origem === "manual" ? "rodado na hora" : "programado"}
                  {e.usuario_id ? ` · por ${nomes.get(e.usuario_id) ?? "ex-usuário"}` : ""}
                </span>
              </Celula>
              <Celula>
                <span className="font-medium">{e.nome}</span>
                {e.resumo && <span className="block text-xs text-mudo">{e.resumo}</span>}
                {emails.length > 0 && <span className="block text-xs text-mudo">e-mail: {emails.join(", ")}</span>}
              </Celula>
              <Celula>
                <Selo cor={COR_STATUS_EXECUCAO[e.status as keyof typeof COR_STATUS_EXECUCAO] ?? "cinza"}>{ROTULO_STATUS_EXECUCAO[e.status] ?? e.status}</Selo>
                {e.erro && <span className="mt-1 block max-w-xs text-xs text-ruim">{e.erro}</span>}
              </Celula>
              <Celula>
                {e.arquivo_apagado_em ? (
                  <span className="text-xs text-mudo">Arquivo apagado em {formatarDataHora(e.arquivo_apagado_em)}</span>
                ) : link ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <a href={link} className={classeBotao("secundario", "sm")}>
                      <Download className="size-3.5" /> Baixar
                    </a>
                    <Copiar texto={link} rotulo="Copiar link" />
                    {zaps.map((z) => (
                      <a key={z} href={linkWhatsapp(z, mensagemWhatsApp(e.nome, periodo, link, imobiliaria))} target="_blank" rel="noreferrer" className={classeBotao("secundario", "sm")}>
                        <MessageCircle className="size-3.5" /> WhatsApp {z.slice(-4)}
                      </a>
                    ))}
                    {podeApagar && (
                      <BotaoExcluir
                        acao={apagarArquivoExecucao}
                        id={e.id}
                        rotulo="Apagar arquivo"
                        confirmar={`Apagar o arquivo de "${e.nome}" gerado em ${formatarDataHora(e.data)}? O link para de funcionar; o registro do envio fica.`}
                      />
                    )}
                  </div>
                ) : (
                  <span className="text-xs text-mudo">{e.arquivo_path ? "Link indisponível (sem acesso ao arquivo)" : "—"}</span>
                )}
              </Celula>
            </tr>
          );
        })}
      </Tabela>
      <p className="mt-3 text-xs text-mudo">
        Os arquivos ficam guardados por {DIAS_GUARDA_ARQUIVOS} dias e depois são apagados sozinhos (proteção de dados — LGPD); o registro do envio continua.
        {podeApagar ? " Você também pode apagar um arquivo antes, pela lixeira." : ""}
      </p>
    </>
  );
}
