import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BotaoExcluir } from "@/components/botao-excluir";
import { Formulario } from "@/components/formulario";
import { AreaTexto, Cabecalho, Campo, Cartao, Entrada, Selecao } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { comRodape, renderizarMensagem, USOS_MODELO, VARIAVEIS_MENSAGEM, type Canal } from "@/lib/dominio/marketing";
import { atualizarModelo, excluirModelo } from "../../actions";
import { AbasMarketing, SelecaoCanal, TextoMensagem } from "../../campos";

export const metadata: Metadata = { title: "Modelo de mensagem" };

export default async function ModeloPage({ params }: PageProps<"/marketing/modelos/[id]">) {
  const { id } = await params;
  const { supabase, organizacao } = await obterContexto();
  const { data: m } = await supabase.from("mkt_modelos").select("*").eq("id", id).maybeSingle();
  if (!m) notFound();
  const exemplo = {
    nome: "Maria Souza",
    primeiro_nome: "Maria",
    imobiliaria: organizacao.nome,
    corretor: "João",
    imovel: "AP-101 · Apartamento · 2 qtos · Centro",
    codigo: "AP-101",
    preco: "R$ 2.300,00/mês",
    preco_anterior: "R$ 2.500,00/mês",
    imoveis: "• AP-101 · Apartamento · 2 qtos · Centro — R$ 2.300,00/mês\n• CA-12 · Casa · 3 qtos · Jardim — R$ 3.100,00/mês",
    link: "https://exemplo.com/lp/apartamento-centro",
    link_pesquisa: "https://exemplo.com/pesquisa/…",
    link_preferencias: "https://exemplo.com/preferencias/…",
  };
  const previa = comRodape(renderizarMensagem(m.corpo as string, exemplo), m.canal as Canal, exemplo.link_preferencias);

  return (
    <>
      <Cabecalho
        titulo={m.nome as string}
        trilha="Modelos de mensagem"
        acoes={<BotaoExcluir acao={excluirModelo} id={id} variante="botao" confirmar="Excluir este modelo?" depois="/marketing/modelos" />}
      />
      <AbasMarketing />
      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <Formulario acao={atualizarModelo} automatico>
          <input type="hidden" name="id" value={id} />
          <Cartao titulo="Modelo">
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-3">
                <Campo rotulo="Nome" className="sm:col-span-3">
                  <Entrada name="nome" required defaultValue={m.nome as string} />
                </Campo>
                <Campo rotulo="Canal">
                  <SelecaoCanal padrao={m.canal as string} />
                </Campo>
                <Campo rotulo="Para que serve" className="sm:col-span-2">
                  <Selecao name="uso" defaultValue={m.uso as string}>
                    {Object.entries(USOS_MODELO).map(([k, r]) => (
                      <option key={k} value={k}>
                        {r}
                      </option>
                    ))}
                  </Selecao>
                </Campo>
              </div>
              <Campo rotulo="Assunto (só e-mail)">
                <Entrada name="assunto" defaultValue={(m.assunto as string | null) ?? ""} />
              </Campo>
              <Campo rotulo="Texto">
                <AreaTexto name="corpo" rows={9} required defaultValue={m.corpo as string} />
              </Campo>
              <label className="flex items-center gap-2 text-sm text-texto-2">
                <input type="hidden" name="ativo" value="" />
                <input type="checkbox" name="ativo" defaultChecked={m.ativo as boolean} className="size-4" /> Modelo ativo (aparece nas campanhas, automações e respostas)
              </label>
            </div>
          </Cartao>
        </Formulario>
        <div className="space-y-6">
          <Cartao titulo="Prévia com dados de exemplo">
            <div className="rounded-[14px] border border-borda bg-elev p-4">
              <TextoMensagem texto={previa} />
            </div>
            <p className="mt-2 text-xs text-mudo">Em ofertas, o sistema acrescenta sozinho o jeito de sair da lista (LGPD).</p>
          </Cartao>
          <Cartao titulo="Variáveis">
            <ul className="space-y-1.5 text-sm">
              {VARIAVEIS_MENSAGEM.map((v) => (
                <li key={v.chave} className="flex justify-between gap-3">
                  <code className="font-mono text-[12px] text-acento-hot">{`{{${v.chave}}}`}</code>
                  <span className="text-right text-texto-2">{v.descricao}</span>
                </li>
              ))}
            </ul>
          </Cartao>
        </div>
      </div>
    </>
  );
}
