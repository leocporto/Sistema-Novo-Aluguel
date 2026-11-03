import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FilePen } from "lucide-react";
import { BotaoExcluir } from "@/components/botao-excluir";
import { Formulario } from "@/components/formulario";
import { AreaTexto, BotaoLink, Cabecalho, Campo, Cartao, Entrada, Selecao } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { ROTULO_TIPO_DOCUMENTO, TIPOS_DOCUMENTO, TIPOS_DOC_SO_IMOBILIARIA, VARIAVEIS, variaveisDoTexto } from "@/lib/dominio/modelos";
import { atualizarModelo, excluirModelo } from "../../actions";
import { AbasDocumentos, TextoDocumento } from "../../campos";

export const metadata: Metadata = { title: "Modelo" };

export default async function ModeloPage({ params }: PageProps<"/documentos/modelos/[id]">) {
  const { id } = await params;
  const { supabase, organizacao } = await obterContexto();
  const pessoal = organizacao.modo === "pessoal";
  const { data: m } = await supabase.from("documento_modelos").select("*").eq("id", id).maybeSingle();
  if (!m) notFound();
  const conhecidas = new Set(VARIAVEIS.map((v) => v.chave));
  const desconhecidas = variaveisDoTexto(m.conteudo).filter((v) => !conhecidas.has(v));
  const tipos = TIPOS_DOCUMENTO.filter((t) => !(pessoal && TIPOS_DOC_SO_IMOBILIARIA.includes(t)) || t === m.tipo);

  return (
    <>
      <Cabecalho
        titulo={m.nome}
        trilha="Modelos"
        descricao={ROTULO_TIPO_DOCUMENTO[m.tipo]}
        acoes={
          <>
            <BotaoLink href="/documentos?novo=1" variante="secundario">
              <FilePen className="size-4" /> Gerar documento
            </BotaoLink>
            <BotaoExcluir acao={excluirModelo} id={id} variante="botao" rotulo="Excluir" confirmar="Excluir este modelo?" depois="/documentos/modelos" />
          </>
        }
      />
      <AbasDocumentos />
      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <Formulario acao={atualizarModelo} automatico>
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="_ativo" value="1" />
          <Cartao titulo="Texto do modelo">
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-[1fr_220px_auto]">
                <Campo rotulo="Nome">
                  <Entrada name="nome" defaultValue={m.nome} />
                </Campo>
                <Campo rotulo="Tipo">
                  <Selecao name="tipo" defaultValue={m.tipo}>
                    {tipos.map((t) => (
                      <option key={t} value={t}>
                        {ROTULO_TIPO_DOCUMENTO[t]}
                      </option>
                    ))}
                  </Selecao>
                </Campo>
                <label className="flex items-center gap-2 pt-6 text-sm text-texto-2">
                  <input type="checkbox" name="ativo" defaultChecked={m.ativo} /> Ativo
                </label>
              </div>
              <AreaTexto name="conteudo" rows={28} defaultValue={m.conteudo} className="font-mono text-[13px] leading-relaxed" />
              {desconhecidas.length > 0 && <p className="text-xs text-alerta">Campos que o sistema não conhece (vão sair em branco): {desconhecidas.map((v) => `{{${v}}}`).join(", ")}</p>}
            </div>
          </Cartao>
        </Formulario>
        <div className="space-y-6">
          <Cartao titulo="Campos automáticos">
            <p className="mb-3 text-xs text-mudo">Escreva o campo entre chaves duplas. Ele é trocado pelos dados do imóvel, pessoa, contrato ou venda escolhidos ao gerar.</p>
            <ul className="max-h-[520px] space-y-1.5 overflow-y-auto text-xs">
              {VARIAVEIS.map((v) => (
                <li key={v.chave}>
                  <code className="rounded bg-elev px-1 py-0.5 text-texto">{`{{${v.chave}}}`}</code> <span className="text-texto-2">{v.descricao}</span>
                </li>
              ))}
            </ul>
          </Cartao>
          <Cartao titulo="Como fica">
            <div className="max-h-[420px] overflow-y-auto rounded-[10px] border border-borda-suave p-3 text-[12px]">
              <TextoDocumento texto={m.conteudo} className="!text-[12.5px]" />
            </div>
          </Cartao>
        </div>
      </div>
    </>
  );
}
