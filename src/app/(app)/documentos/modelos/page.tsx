import type { Metadata } from "next";
import { Download, FilePlus2 } from "lucide-react";
import { BotaoAcao } from "@/components/botao-acao";
import { BotaoExcluir } from "@/components/botao-excluir";
import { JanelaCadastro } from "@/components/janela-cadastro";
import { LinhaLink } from "@/components/linha-link";
import { Cabecalho, Campo, Celula, Entrada, LinhaVazia, Selecao, Selo, Tabela } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { formatarDataBR } from "@/lib/dominio/datas";
import { ROTULO_TIPO_DOCUMENTO, TIPOS_DOCUMENTO, TIPOS_DOC_SO_IMOBILIARIA } from "@/lib/dominio/modelos";
import { criarModelo, excluirModelo, instalarModelosPadrao } from "../actions";
import { AbasDocumentos } from "../campos";

export const metadata: Metadata = { title: "Modelos de documento" };

export default async function ModelosPage() {
  const { supabase, organizacao } = await obterContexto();
  const pessoal = organizacao.modo === "pessoal";
  const { data } = await supabase.from("documento_modelos").select("id, nome, tipo, ativo, padrao_sistema, updated_at").order("tipo").order("nome");
  const modelos = (data ?? []).filter((m) => !(pessoal && TIPOS_DOC_SO_IMOBILIARIA.includes(m.tipo)));
  const tipos = TIPOS_DOCUMENTO.filter((t) => !(pessoal && TIPOS_DOC_SO_IMOBILIARIA.includes(t)));

  return (
    <>
      <Cabecalho
        titulo="Modelos de documento"
        trilha="Documentos"
        descricao="Textos-base com campos automáticos ({{imovel.endereco}}, {{locatarios.qualificacao}}…) que viram documentos preenchidos com um clique."
        acoes={
          <>
            <BotaoAcao acao={instalarModelosPadrao} id="todos">
              <Download className="size-4" /> Instalar modelos-base
            </BotaoAcao>
            <JanelaCadastro rotuloBotao={<><FilePlus2 className="size-4" /> Novo modelo</>} titulo="Novo modelo" acao={criarModelo} icone={<FilePlus2 />}>
              <Campo rotulo="Nome">
                <Entrada name="nome" required placeholder="Contrato de locação comercial" />
              </Campo>
              <div className="grid gap-4 sm:grid-cols-2">
                <Campo rotulo="Tipo">
                  <Selecao name="tipo" defaultValue="locacao">
                    {tipos.map((t) => (
                      <option key={t} value={t}>
                        {ROTULO_TIPO_DOCUMENTO[t]}
                      </option>
                    ))}
                  </Selecao>
                </Campo>
                <Campo rotulo="Começar a partir de">
                  <Selecao name="base" defaultValue="">
                    <option value="">Em branco</option>
                    {modelos.map((m) => (
                      <option key={m.id} value={m.id}>
                        Cópia de “{m.nome}”
                      </option>
                    ))}
                  </Selecao>
                </Campo>
              </div>
            </JanelaCadastro>
          </>
        }
      />
      <AbasDocumentos />
      <Tabela colunas={["Modelo", "Tipo", "Atualizado", "Situação", ""]}>
        {modelos.map((m) => (
          <LinhaLink key={m.id} href={`/documentos/modelos/${m.id}`}>
            <Celula>
              <span className="font-medium text-texto">{m.nome}</span>
              {m.padrao_sistema && <span className="block text-xs text-mudo">modelo-base do sistema</span>}
            </Celula>
            <Celula>{ROTULO_TIPO_DOCUMENTO[m.tipo]}</Celula>
            <Celula>{formatarDataBR(String(m.updated_at).slice(0, 10))}</Celula>
            <Celula>{m.ativo ? <Selo cor="verde">ativo</Selo> : <Selo>inativo</Selo>}</Celula>
            <Celula>
              <BotaoExcluir acao={excluirModelo} id={m.id} rotulo="Excluir modelo" confirmar={`Excluir o modelo "${m.nome}"? Documentos já gerados não mudam.`} />
            </Celula>
          </LinhaLink>
        ))}
        {modelos.length === 0 && <LinhaVazia colunas={5}>Nenhum modelo. Clique em “Instalar modelos-base” para começar com contratos prontos.</LinhaVazia>}
      </Tabela>
    </>
  );
}
