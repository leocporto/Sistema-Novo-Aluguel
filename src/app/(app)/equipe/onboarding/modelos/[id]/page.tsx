import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Plus } from "lucide-react";
import { BotaoExcluir } from "@/components/botao-excluir";
import { Formulario } from "@/components/formulario";
import { JanelaCadastro } from "@/components/janela-cadastro";
import { AreaTexto, Cabecalho, Campo, Cartao, Entrada, Grade, Selecao } from "@/components/ui";
import { PAPEIS_USUARIO, RESPONSAVEIS_ONBOARDING, ROTULO_PAPEL_USUARIO } from "@/lib/dominio/equipe";
import { exigirVerRota } from "@/lib/permissoes";
import { AbasEquipe } from "../../../abas";
import { adicionarItemModelo, excluirItemModelo, excluirModeloOnboarding, salvarItemModelo, salvarModeloOnboarding } from "../../../actions";
import { contextoEquipe } from "../../../dados";

export const metadata: Metadata = { title: "Modelo de onboarding" };

type ItemModelo = { id: string; ordem: number; titulo: string; descricao: string | null; responsavel: string; prazo_dias: number };
const pequeno = "!min-h-10 !text-sm";

export default async function ModeloOnboardingPage({ params }: PageProps<"/equipe/onboarding/modelos/[id]">) {
  await exigirVerRota("/equipe");
  const { id } = await params;
  const { supabase, pode } = await contextoEquipe();
  const podeEditar = pode("equipe", "editar");
  const [{ data }, { data: itensData }] = await Promise.all([
    supabase.from("equipe_onboarding_modelos").select("id, nome, descricao, papel, ativo").eq("id", id).maybeSingle(),
    supabase.from("equipe_onboarding_modelo_itens").select("id, ordem, titulo, descricao, responsavel, prazo_dias").eq("modelo_id", id).order("ordem").order("titulo"),
  ]);
  if (!data) notFound();
  const m = data as { id: string; nome: string; descricao: string | null; papel: string | null; ativo: boolean };
  const itens = (itensData ?? []) as ItemModelo[];

  return (
    <>
      <Cabecalho
        titulo={m.nome}
        trilha="Modelos de onboarding"
        descricao="Itens do checklist com quem faz e em quantos dias depois do início. Mudar o modelo não mexe nos onboardings já começados."
        acoes={
          podeEditar && (
            <BotaoExcluir acao={excluirModeloOnboarding} id={id} variante="botao" rotulo="Excluir modelo" confirmar={`Excluir o modelo "${m.nome}"? Os onboardings já começados continuam.`} depois="/equipe/onboarding" />
          )
        }
      />
      <AbasEquipe />
      <div className="space-y-6">
        {podeEditar && (
          <Formulario acao={salvarModeloOnboarding} automatico>
            <input type="hidden" name="id" value={id} />
            <Cartao titulo="Modelo">
              <Grade colunas={3}>
                <Campo rotulo="Nome">
                  <Entrada name="nome" required defaultValue={m.nome} />
                </Campo>
                <Campo rotulo="Para qual papel">
                  <Selecao name="papel" defaultValue={m.papel ?? ""}>
                    <option value="">Qualquer</option>
                    {PAPEIS_USUARIO.map((p) => (
                      <option key={p} value={p}>
                        {ROTULO_PAPEL_USUARIO[p]}
                      </option>
                    ))}
                  </Selecao>
                </Campo>
                <Campo rotulo="Descrição">
                  <Entrada name="descricao" defaultValue={m.descricao ?? ""} />
                </Campo>
              </Grade>
              <label className="mt-4 flex items-center gap-2 text-sm text-texto">
                <input type="hidden" name="ativo" value="" />
                <input type="checkbox" name="ativo" defaultChecked={m.ativo} /> Modelo ativo (aparece ao iniciar um onboarding)
              </label>
            </Cartao>
          </Formulario>
        )}
        <Cartao
          titulo={`Itens (${itens.length})`}
          acoes={
            podeEditar ? (
              <JanelaCadastro rotuloBotao={<><Plus className="size-4" /> Item</>} tamanho="sm" variante="secundario" titulo="Novo item do modelo" acao={adicionarItemModelo} icone={<Plus />} rotuloSalvar="Incluir">
                <input type="hidden" name="modelo_id" value={id} />
                <Campo rotulo="Item">
                  <Entrada name="titulo" required />
                </Campo>
                <Campo rotulo="Detalhes">
                  <AreaTexto name="descricao" rows={2} />
                </Campo>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Campo rotulo="Quem faz">
                    <Selecao name="responsavel" defaultValue="gestor">
                      {Object.entries(RESPONSAVEIS_ONBOARDING).map(([k, r]) => (
                        <option key={k} value={k}>
                          {r}
                        </option>
                      ))}
                    </Selecao>
                  </Campo>
                  <Campo rotulo="Prazo (dias depois do início)">
                    <Entrada name="prazo_dias" inputMode="numeric" defaultValue="7" />
                  </Campo>
                </div>
              </JanelaCadastro>
            ) : undefined
          }
        >
          {itens.length === 0 ? (
            <p className="text-sm text-mudo">Nenhum item.</p>
          ) : (
            <ul className="space-y-2">
              {itens.map((i) =>
                podeEditar ? (
                  <li key={i.id} className="flex items-center gap-2">
                    <Formulario acao={salvarItemModelo} automatico semAviso className="grid flex-1 gap-2 sm:grid-cols-[70px_1fr_1fr_170px_90px]">
                      <input type="hidden" name="id" value={i.id} />
                      <Entrada name="ordem" inputMode="numeric" defaultValue={String(i.ordem)} aria-label="Ordem" className={pequeno} />
                      <Entrada name="titulo" required defaultValue={i.titulo} aria-label="Item" className={pequeno} />
                      <Entrada name="descricao" defaultValue={i.descricao ?? ""} placeholder="Detalhes" aria-label="Detalhes" className={pequeno} />
                      <Selecao name="responsavel" defaultValue={i.responsavel} aria-label="Quem faz" className={pequeno}>
                        {Object.entries(RESPONSAVEIS_ONBOARDING).map(([k, r]) => (
                          <option key={k} value={k}>
                            {r}
                          </option>
                        ))}
                      </Selecao>
                      <Entrada name="prazo_dias" inputMode="numeric" defaultValue={String(i.prazo_dias)} aria-label="Prazo em dias" className={pequeno} />
                    </Formulario>
                    <BotaoExcluir acao={excluirItemModelo} id={i.id} rotulo="Excluir item" confirmar={`Excluir o item "${i.titulo}"?`} />
                  </li>
                ) : (
                  <li key={i.id} className="text-sm text-texto">
                    {i.ordem}. {i.titulo} <span className="text-mudo">· {RESPONSAVEIS_ONBOARDING[i.responsavel]} · {i.prazo_dias} dia(s)</span>
                  </li>
                ),
              )}
            </ul>
          )}
          {podeEditar && itens.length > 0 && <p className="mt-3 text-right text-xs text-mudo">Colunas: ordem, item, detalhes, quem faz e prazo em dias. Salva sozinho.</p>}
        </Cartao>
      </div>
    </>
  );
}
