import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BotaoExcluir } from "@/components/botao-excluir";
import { Formulario } from "@/components/formulario";
import { Cabecalho, Cartao } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { atualizarAutomacao, excluirAutomacao } from "../../actions";
import { AbasMarketing } from "../../campos";
import { TabelaEnvios, type EnvioLista } from "../../tabela-envios";
import { CamposAutomacao, type AutomacaoForm } from "../campos-automacao";

export const metadata: Metadata = { title: "Automação" };

export default async function AutomacaoPage({ params }: PageProps<"/marketing/automacoes/[id]">) {
  const { id } = await params;
  const { supabase } = await obterContexto();
  const [{ data: a }, { data: modelos }, { data: envios }, { data: tarefas }] = await Promise.all([
    supabase.from("mkt_automacoes").select("*").eq("id", id).maybeSingle(),
    supabase.from("mkt_modelos").select("id, nome, canal").eq("ativo", true).order("nome"),
    supabase.from("mkt_envios").select("*").eq("automacao_id", id).order("created_at", { ascending: false }).limit(100),
    supabase.from("mkt_execucoes").select("id, created_at, tarefa:tarefas(id, titulo, concluida)").eq("automacao_id", id).not("tarefa_id", "is", null).order("created_at", { ascending: false }).limit(50),
  ]);
  if (!a) notFound();
  type T = { id: string; created_at: string; tarefa: { id: string; titulo: string; concluida: boolean } | null };

  return (
    <>
      <Cabecalho titulo={a.nome as string} trilha="Automações" acoes={<BotaoExcluir acao={excluirAutomacao} id={id} variante="botao" confirmar="Excluir esta automação?" depois="/marketing/automacoes" />} />
      <AbasMarketing />
      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <Formulario acao={atualizarAutomacao} automatico>
          <input type="hidden" name="id" value={id} />
          <Cartao titulo="Regra">
            <CamposAutomacao a={a as AutomacaoForm} modelos={modelos ?? []} />
            <label className="mt-4 flex items-center gap-2 text-sm text-texto-2">
              <input type="hidden" name="ativa" value="" />
              <input type="checkbox" name="ativa" defaultChecked={a.ativa as boolean} className="size-4" /> Automação ativa
            </label>
          </Cartao>
        </Formulario>
        <Cartao titulo="Tarefas criadas">
          {!(tarefas ?? []).length ? (
            <p className="text-sm text-mudo">Nenhuma tarefa criada por esta automação.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {((tarefas ?? []) as unknown as T[]).map((t) => (
                <li key={t.id} className={t.tarefa?.concluida ? "text-mudo line-through" : "text-texto"}>
                  {t.tarefa?.titulo ?? "(tarefa excluída)"}
                </li>
              ))}
            </ul>
          )}
        </Cartao>
      </div>
      <h2 className="mb-3 mt-8 text-[17px] font-semibold text-texto">Mensagens que esta automação pôs na fila</h2>
      <TabelaEnvios envios={(envios ?? []) as EnvioLista[]} mostrarCampanha={false} vazio="Nenhuma mensagem ainda." />
    </>
  );
}
