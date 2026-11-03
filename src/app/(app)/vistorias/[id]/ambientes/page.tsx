import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Copy, Home, ListPlus, Plus } from "lucide-react";
import { BotaoAcao } from "@/components/botao-acao";
import { BotaoExcluir } from "@/components/botao-excluir";
import { Formulario } from "@/components/formulario";
import { JanelaCadastro } from "@/components/janela-cadastro";
import { PilulasLink } from "@/components/pilulas-link";
import { AreaTexto, Aviso, Campo, Cartao, Celula, Entrada, LinhaVazia, Selecao, Selo, Tabela } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { COR_ESTADO, ROTULO_ESTADO, ROTULO_STATUS_VISTORIA, progressoVistoria, vistoriaEditavel } from "@/lib/dominio/vistorias";
import {
  atualizarAmbiente,
  copiarAmbientesDaReferencia,
  criarAmbiente,
  criarAmbientesDoImovel,
  criarItem,
  excluirAmbiente,
  excluirItem,
  salvarItensAmbiente,
} from "../../actions";
import { OpcoesEstado, OpcoesTipoAmbiente } from "../../campos";
import { carregarAmbientes, carregarMidias, carregarVistoria, linksAssinados } from "../../dados";
import { EnvioMidia } from "../../envio-midia";
import { Miniatura } from "../../galeria";
import { MarcarNaoAvaliadosBom } from "../../marcar-bom";

export const metadata: Metadata = { title: "Checklist da vistoria" };

export default async function AmbientesVistoria({ params, searchParams }: PageProps<"/vistorias/[id]/ambientes">) {
  const { id } = await params;
  const sp = await searchParams;
  const { supabase, organizacao } = await obterContexto();
  const v = await carregarVistoria(supabase, id);
  if (!v) notFound();
  const [ambientes, midias] = await Promise.all([carregarAmbientes(supabase, id), carregarMidias(supabase, id)]);
  const editavel = vistoriaEditavel(v.status);
  const escolhido = ambientes.find((a) => a.id === sp.amb) ?? ambientes[0];
  const base = `/vistorias/${id}/ambientes`;
  const fotosAmb = escolhido ? midias.filter((m) => m.ambiente_id === escolhido.id) : [];
  const links = await linksAssinados(supabase, fotosAmb.map((m) => m.path));
  const nomeItem = new Map(escolhido?.vistoria_itens.map((i) => [i.id, i.nome]) ?? []);

  const novoAmbiente = (
    <JanelaCadastro rotuloBotao={<><Plus className="size-4" /> Novo ambiente</>} variante={ambientes.length ? "secundario" : "primario"} titulo="Novo ambiente" acao={criarAmbiente} icone={<Home />} rotuloSalvar="Incluir">
      <input type="hidden" name="vistoria_id" value={id} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo rotulo="Tipo">
          <Selecao name="tipo" defaultValue="quarto">
            <OpcoesTipoAmbiente />
          </Selecao>
        </Campo>
        <Campo rotulo="Nome (opcional)" dica="Ex.: Quarto do casal, Suíte 2">
          <Entrada name="nome" />
        </Campo>
      </div>
      <label className="flex items-center gap-2 text-sm text-texto-2">
        <input type="hidden" name="checklist" value="" />
        <input type="checkbox" name="checklist" defaultChecked /> Já incluir o checklist padrão deste tipo de ambiente
      </label>
    </JanelaCadastro>
  );

  if (!ambientes.length)
    return (
      <Cartao titulo="Ambientes da vistoria">
        <p className="mb-4 text-sm text-texto-2">
          Esta vistoria ainda não tem ambientes. Monte pelo cadastro do imóvel (sala, cozinha, quartos, banheiros, garagem…) com o checklist padrão de cada um, copie da vistoria de referência ou inclua um a um.
        </p>
        {editavel ? (
          <div className="flex flex-wrap gap-2">
            <BotaoAcao acao={criarAmbientesDoImovel} id={id} variante="primario">
              <Home className="size-4" /> Montar pelo cadastro do imóvel
            </BotaoAcao>
            {v.referencia_id && (
              <BotaoAcao acao={copiarAmbientesDaReferencia} id={id}>
                <Copy className="size-4" /> Copiar da vistoria de referência
              </BotaoAcao>
            )}
            {novoAmbiente}
          </div>
        ) : (
          <Aviso tipo="alerta">A vistoria já foi concluída. Reabra no Resumo para incluir ambientes.</Aviso>
        )}
      </Cartao>
    );

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <PilulasLink
          rotulo="Ambiente"
          ativo={`${base}?amb=${escolhido.id}`}
          itens={ambientes.map((a) => {
            const p = progressoVistoria(a.vistoria_itens);
            return { href: `${base}?amb=${a.id}`, rotulo: `${a.nome} ${p.avaliados}/${p.total}`, titulo: p.danos ? `${p.danos} item(ns) com dano` : undefined };
          })}
        />
        {editavel && novoAmbiente}
      </div>
      {!editavel && (
        <div className="mb-4">
          <Aviso tipo="alerta">Vistoria {ROTULO_STATUS_VISTORIA[v.status].toLowerCase()}: o checklist e as fotos estão só para consulta. Para corrigir, use “Reabrir” no Resumo.</Aviso>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          {editavel ? (
            <Formulario acao={salvarItensAmbiente} automatico key={escolhido.id}>
              <input type="hidden" name="vistoria_id" value={id} />
              <Tabela colunas={["Item", "Estado", "Observação", ""]}>
                {escolhido.vistoria_itens.map((i) => (
                  <tr key={i.id}>
                    <Celula className="font-medium">{i.nome}</Celula>
                    <Celula className="w-48">
                      <Selecao name={`estado:${i.id}`} aria-label={`Estado: ${i.nome}`} defaultValue={i.estado ?? ""} className="min-h-10 py-1.5 text-sm">
                        <OpcoesEstado />
                      </Selecao>
                    </Celula>
                    <Celula>
                      <Entrada name={`obs:${i.id}`} aria-label={`Observação: ${i.nome}`} defaultValue={i.observacao ?? ""} placeholder="Ex.: risco perto da janela" className="min-h-10 py-1.5 text-sm" />
                    </Celula>
                    <Celula className="w-12">
                      <BotaoExcluir acao={excluirItem} id={i.id} rotulo={`Excluir item ${i.nome}`} confirmar={`Excluir o item "${i.nome}" deste ambiente?`} />
                    </Celula>
                  </tr>
                ))}
                {!escolhido.vistoria_itens.length && <LinhaVazia colunas={4}>Nenhum item. Use “Adicionar item”.</LinhaVazia>}
              </Tabela>
              {escolhido.vistoria_itens.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  <MarcarNaoAvaliadosBom ambiente={escolhido.nome} />
                </div>
              )}
            </Formulario>
          ) : (
            <Tabela colunas={["Item", "Estado", "Observação"]}>
              {escolhido.vistoria_itens.map((i) => (
                <tr key={i.id}>
                  <Celula className="font-medium">{i.nome}</Celula>
                  <Celula>{i.estado ? <Selo cor={COR_ESTADO[i.estado]}>{ROTULO_ESTADO[i.estado]}</Selo> : <span className="text-mudo">não avaliado</span>}</Celula>
                  <Celula className="text-texto-2">{i.observacao ?? "—"}</Celula>
                </tr>
              ))}
            </Tabela>
          )}
          {editavel && (
            <div className="flex flex-wrap gap-2">
              <JanelaCadastro rotuloBotao={<><ListPlus className="size-4" /> Adicionar item</>} variante="secundario" titulo={`Novo item em ${escolhido.nome}`} acao={criarItem} icone={<ListPlus />} rotuloSalvar="Incluir">
                <input type="hidden" name="ambiente_id" value={escolhido.id} />
                <Campo rotulo="Item">
                  <Entrada name="nome" required placeholder="Ex.: Ar-condicionado, Box blindex, Lustre" />
                </Campo>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Campo rotulo="Estado">
                    <Selecao name="estado" defaultValue="">
                      <OpcoesEstado />
                    </Selecao>
                  </Campo>
                  <Campo rotulo="Observação">
                    <Entrada name="observacao" />
                  </Campo>
                </div>
              </JanelaCadastro>
            </div>
          )}

          <Cartao titulo={`Fotos e vídeos de ${escolhido.nome} (${fotosAmb.length})`}>
            {fotosAmb.length > 0 && (
              <ul className="entrar-cascata mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {fotosAmb.map((m) => (
                  <li key={m.id}>
                    <Miniatura url={links[m.path]} tipo={m.tipo} legenda={m.legenda} />
                    <p className="mt-1 truncate text-xs text-texto-2" title={m.legenda ?? undefined}>
                      {[m.item_id ? nomeItem.get(m.item_id) : null, m.legenda].filter(Boolean).join(" · ") || "sem legenda"}
                    </p>
                  </li>
                ))}
              </ul>
            )}
            {editavel ? (
              <EnvioMidia
                organizacaoId={organizacao.id}
                vistoriaId={id}
                ambienteFixo={escolhido.id}
                ambientes={[{ id: escolhido.id, nome: escolhido.nome, itens: escolhido.vistoria_itens.map((i) => ({ id: i.id, nome: i.nome })) }]}
              />
            ) : (
              !fotosAmb.length && <p className="text-sm text-mudo">Nenhuma foto deste ambiente.</p>
            )}
          </Cartao>
        </div>

        <div className="space-y-6">
          {editavel ? (
            <Formulario acao={atualizarAmbiente} automatico key={`a-${escolhido.id}`}>
              <input type="hidden" name="id" value={escolhido.id} />
              <Cartao
                titulo="Ambiente"
                acoes={<BotaoExcluir acao={excluirAmbiente} id={escolhido.id} rotulo={`Excluir ambiente ${escolhido.nome}`} confirmar={`Excluir o ambiente "${escolhido.nome}" com todos os itens? (as fotos ficam na galeria)`} />}
              >
                <div className="space-y-4">
                  <Campo rotulo="Nome">
                    <Entrada name="nome" defaultValue={escolhido.nome} required />
                  </Campo>
                  <Campo rotulo="Tipo">
                    <Selecao name="tipo" defaultValue={escolhido.tipo}>
                      <OpcoesTipoAmbiente />
                    </Selecao>
                  </Campo>
                  <Campo rotulo="Ordem">
                    <Entrada name="ordem" inputMode="numeric" defaultValue={String(escolhido.ordem)} />
                  </Campo>
                  <Campo rotulo="Observações do ambiente">
                    <AreaTexto name="observacoes" rows={4} defaultValue={escolhido.observacoes ?? ""} placeholder="Ex.: cheiro de mofo, infiltração no canto" />
                  </Campo>
                </div>
              </Cartao>
            </Formulario>
          ) : (
            <Cartao titulo={escolhido.nome}>
              <p className="text-sm text-texto-2">{escolhido.observacoes ?? "Sem observações no ambiente."}</p>
            </Cartao>
          )}
          <Cartao titulo="Legenda dos estados">
            <ul className="space-y-1.5 text-sm text-texto-2">
              <li><Selo cor="azul">Novo</Selo> nunca usado</li>
              <li><Selo cor="verde">Bom</Selo> sem defeitos, desgaste normal</li>
              <li><Selo cor="amarelo">Regular</Selo> marcas de uso, funciona</li>
              <li><Selo cor="vermelho">Ruim</Selo> precisa de reparo</li>
              <li><Selo cor="vermelho">Danificado</Selo> quebrado ou sem funcionar</li>
              <li><Selo cor="cinza">Não se aplica</Selo> não existe no imóvel</li>
            </ul>
          </Cartao>
        </div>
      </div>
    </>
  );
}
