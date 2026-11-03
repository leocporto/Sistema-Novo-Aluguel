import type { Metadata } from "next";
import { FilePlus2, Sparkles } from "lucide-react";
import { BotaoAcao } from "@/components/botao-acao";
import { BotaoExcluir } from "@/components/botao-excluir";
import { JanelaCadastro } from "@/components/janela-cadastro";
import { LinhaLink } from "@/components/linha-link";
import { PilulasLink } from "@/components/pilulas-link";
import { AreaTexto, Cabecalho, Campo, Celula, Entrada, LinhaVazia, Selecao, Selo, Tabela } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { ROTULO_CANAL, USOS_MODELO, VARIAVEIS_MENSAGEM } from "@/lib/dominio/marketing";
import { criarModelo, excluirModelo, instalarModelosProntos } from "../actions";
import { AbasMarketing, SelecaoCanal, SeloCanal } from "../campos";

export const metadata: Metadata = { title: "Modelos de mensagem" };

export default async function ModelosPage({ searchParams }: PageProps<"/marketing/modelos">) {
  const sp = await searchParams;
  const canal = typeof sp.canal === "string" && sp.canal in ROTULO_CANAL ? sp.canal : "";
  const { supabase } = await obterContexto();
  let q = supabase.from("mkt_modelos").select("*").order("nome");
  if (canal) q = q.eq("canal", canal);
  const { data } = await q;
  type M = { id: string; nome: string; canal: string; uso: string; assunto: string | null; corpo: string; ativo: boolean };
  const modelos = (data ?? []) as M[];
  const url = (k: string) => (k ? `/marketing/modelos?canal=${k}` : "/marketing/modelos");

  return (
    <>
      <Cabecalho
        titulo="Modelos de mensagem"
        trilha="Marketing"
        descricao={`Textos prontos para WhatsApp, e-mail e SMS, com variáveis que o sistema preenche: ${VARIAVEIS_MENSAGEM.slice(0, 6)
          .map((v) => `{{${v.chave}}}`)
          .join(", ")}…`}
        acoes={
          <>
            <BotaoAcao acao={instalarModelosProntos} id="padrao">
              <Sparkles className="size-4" /> Instalar modelos prontos
            </BotaoAcao>
            <JanelaCadastro rotuloBotao={<><FilePlus2 className="size-4" /> Novo modelo</>} titulo="Novo modelo de mensagem" acao={criarModelo} icone={<FilePlus2 />} larguraMax="max-w-2xl">
              <div className="grid gap-4 sm:grid-cols-3">
                <Campo rotulo="Nome" className="sm:col-span-3">
                  <Entrada name="nome" required />
                </Campo>
                <Campo rotulo="Canal">
                  <SelecaoCanal />
                </Campo>
                <Campo rotulo="Para que serve" className="sm:col-span-2">
                  <Selecao name="uso" defaultValue="geral">
                    {Object.entries(USOS_MODELO).map(([k, r]) => (
                      <option key={k} value={k}>
                        {r}
                      </option>
                    ))}
                  </Selecao>
                </Campo>
              </div>
              <Campo rotulo="Assunto (só e-mail)">
                <Entrada name="assunto" />
              </Campo>
              <Campo rotulo="Texto" dica={VARIAVEIS_MENSAGEM.map((v) => `{{${v.chave}}}`).join(" ")}>
                <AreaTexto name="corpo" rows={6} required defaultValue="Olá {{primeiro_nome}}! " />
              </Campo>
            </JanelaCadastro>
          </>
        }
      />
      <AbasMarketing />
      <PilulasLink
        className="mb-4"
        rotulo="Canal"
        ativo={url(canal)}
        itens={[{ href: url(""), rotulo: "Todos" }, ...Object.entries(ROTULO_CANAL).map(([k, r]) => ({ href: url(k), rotulo: r }))]}
      />
      <Tabela colunas={["Modelo", "Canal", "Texto", ""]}>
        {modelos.map((m) => (
          <LinhaLink key={m.id} href={`/marketing/modelos/${m.id}`}>
            <Celula>
              <span className="font-semibold text-texto">{m.nome}</span>
              <span className="mt-1 flex items-center gap-1.5 text-xs text-mudo">
                {USOS_MODELO[m.uso] ?? m.uso}
                {!m.ativo && <Selo>inativo</Selo>}
              </span>
            </Celula>
            <Celula>
              <SeloCanal canal={m.canal} />
            </Celula>
            <Celula className="max-w-[520px]">
              {m.assunto && <span className="block text-xs font-semibold text-texto-2">{m.assunto}</span>}
              <span className="line-clamp-2 whitespace-pre-wrap text-[13px] text-texto-2">{m.corpo}</span>
            </Celula>
            <Celula>
              <BotaoExcluir acao={excluirModelo} id={m.id} rotulo="Excluir modelo" confirmar={`Excluir o modelo "${m.nome}"? Campanhas que já usaram continuam com o texto.`} />
            </Celula>
          </LinhaLink>
        ))}
        {modelos.length === 0 && <LinhaVazia colunas={4}>Nenhum modelo. Clique em “Instalar modelos prontos” para começar com os textos sugeridos.</LinhaVazia>}
      </Tabela>
    </>
  );
}
