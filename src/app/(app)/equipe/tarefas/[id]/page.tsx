import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2, Play, RotateCcw } from "lucide-react";
import { BotaoAcao } from "@/components/botao-acao";
import { BotaoExcluir } from "@/components/botao-excluir";
import { BotaoEnviar, Formulario } from "@/components/formulario";
import { AreaTexto, Cabecalho, Campo, Cartao, Selecao, Selo } from "@/components/ui";
import { formatarDataBR, formatarDataLocal, hojeISO } from "@/lib/dominio/datas";
import { COR_STATUS_TAREFA, ROTULO_STATUS_TAREFA, STATUS_TAREFA, tarefaAberta } from "@/lib/dominio/equipe";
import { exigirVerRota } from "@/lib/permissoes";
import { AbasEquipe } from "../../abas";
import { comecarTarefaInterna, comentarTarefa, concluirTarefaInterna, excluirComentarioTarefa, excluirTarefaInterna, reabrirTarefaInterna, salvarTarefaInterna } from "../../actions";
import { carregarOpcoesTarefa, comVinculosDaTarefa, contextoEquipe, nomeDoMembro } from "../../dados";
import { CamposTarefaInterna, type TarefaEditavel } from "../campos-tarefa";

export const metadata: Metadata = { title: "Tarefa interna" };

type Tarefa = TarefaEditavel & {
  id: string;
  numero: number;
  status: string;
  criado_por: string | null;
  concluida_em: string | null;
  created_at: string;
  imovel: { id: string; codigo: string } | null;
  contrato: { id: string; numero: number } | null;
  pessoa: { id: string; nome: string } | null;
};

export default async function TarefaInternaPage({ params }: PageProps<"/equipe/tarefas/[id]">) {
  await exigirVerRota("/equipe");
  const { id } = await params;
  const { supabase, usuario, pode } = await contextoEquipe();
  const hoje = hojeISO();
  const [{ data }, { data: comentarios }, opcoes] = await Promise.all([
    supabase
      .from("equipe_tarefas")
      .select(
        "id, numero, titulo, descricao, categoria, prioridade, status, responsavel_id, criado_por, prazo, concluida_em, created_at, imovel_id, contrato_id, pessoa_id, equipe_id, imovel:imoveis(id, codigo), contrato:contratos(id, numero), pessoa:pessoas(id, nome)",
      )
      .eq("id", id)
      .maybeSingle(),
    supabase.from("equipe_tarefa_comentarios").select("id, texto, usuario_id, data").eq("tarefa_id", id).order("data"),
    carregarOpcoesTarefa(supabase),
  ]);
  if (!data) notFound();
  const t = data as unknown as Tarefa;
  const nomes = new Map(opcoes.membros.map((m) => [m.user_id, nomeDoMembro(m)]));
  const envolvido = t.criado_por === usuario.id || t.responsavel_id === usuario.id;
  const podeMudar = envolvido || pode("equipe", "editar");
  const podeExcluir = t.criado_por === usuario.id || pode("equipe", "excluir");
  const atrasada = tarefaAberta(t.status) && t.prazo && t.prazo < hoje;

  return (
    <>
      <Cabecalho
        titulo={t.titulo}
        trilha="Tarefas internas"
        descricao={
          <span className="flex flex-wrap items-center gap-2">
            <Selo cor={COR_STATUS_TAREFA[t.status as keyof typeof COR_STATUS_TAREFA] ?? "cinza"}>{ROTULO_STATUS_TAREFA[t.status]}</Selo>
            <span>
              #{t.numero} · pedida por {t.criado_por ? (nomes.get(t.criado_por) ?? "usuário") : "—"} em {formatarDataLocal(t.created_at)}
            </span>
            {atrasada && <span className="font-semibold text-ruim">atrasada desde {formatarDataBR(t.prazo)}</span>}
            {t.imovel && (
              <Link href={`/imoveis/${t.imovel.id}`} className="text-acento hover:underline">
                {t.imovel.codigo}
              </Link>
            )}
            {t.contrato && (
              <Link href={`/contratos/${t.contrato.id}`} className="text-acento hover:underline">
                contrato #{t.contrato.numero}
              </Link>
            )}
            {t.pessoa && (
              <Link href={`/pessoas/${t.pessoa.id}`} className="text-acento hover:underline">
                {t.pessoa.nome}
              </Link>
            )}
          </span>
        }
        acoes={
          podeMudar && (
            <>
              {t.status === "a_fazer" && (
                <BotaoAcao acao={comecarTarefaInterna} id={id}>
                  <Play className="size-4" /> Começar
                </BotaoAcao>
              )}
              {tarefaAberta(t.status) ? (
                <BotaoAcao acao={concluirTarefaInterna} id={id} variante="primario">
                  <CheckCircle2 className="size-4" /> Concluir
                </BotaoAcao>
              ) : (
                <BotaoAcao acao={reabrirTarefaInterna} id={id} confirmar="Reabrir esta tarefa?">
                  <RotateCcw className="size-4" /> Reabrir
                </BotaoAcao>
              )}
              {podeExcluir && <BotaoExcluir acao={excluirTarefaInterna} id={id} variante="botao" confirmar={`Excluir a tarefa "${t.titulo}" e os comentários?`} depois="/equipe/tarefas" />}
            </>
          )
        }
      />
      <AbasEquipe />
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        {podeMudar ? (
          <Formulario acao={salvarTarefaInterna} automatico>
            <input type="hidden" name="id" value={id} />
            <Cartao titulo="Tarefa">
              <div className="space-y-4">
                <Campo rotulo="Situação" className="max-w-xs">
                  <Selecao name="status" defaultValue={t.status}>
                    {STATUS_TAREFA.map((s) => (
                      <option key={s} value={s}>
                        {ROTULO_STATUS_TAREFA[s]}
                      </option>
                    ))}
                  </Selecao>
                </Campo>
                <CamposTarefaInterna t={t} opcoes={comVinculosDaTarefa(opcoes, t)} eu={usuario.id} />
              </div>
            </Cartao>
          </Formulario>
        ) : (
          <Cartao titulo="Tarefa">
            <p className="whitespace-pre-wrap text-sm text-texto">{t.descricao ?? "Sem detalhes."}</p>
            <p className="mt-3 text-sm text-texto-2">
              Responsável: {t.responsavel_id ? nomes.get(t.responsavel_id) : "ninguém"} · prazo {t.prazo ? formatarDataBR(t.prazo) : "sem prazo"}
            </p>
          </Cartao>
        )}
        <Cartao titulo={`Comentários (${(comentarios ?? []).length})`}>
          <ul className="mb-4 space-y-3">
            {((comentarios ?? []) as { id: string; texto: string; usuario_id: string | null; data: string }[]).map((c) => (
              <li key={c.id} className="rounded-[14px] border border-borda bg-elev px-3.5 py-2.5">
                <div className="mb-1 flex items-center gap-2 text-xs text-mudo">
                  <span className="flex-1 font-medium text-texto-2">{c.usuario_id ? (nomes.get(c.usuario_id) ?? "usuário") : "—"}</span>
                  <span>{formatarDataLocal(c.data)}</span>
                  {c.usuario_id === usuario.id && <BotaoExcluir acao={excluirComentarioTarefa} id={c.id} variante="texto" rotulo="Apagar" confirmar="Apagar este comentário?" />}
                </div>
                <p className="whitespace-pre-wrap text-sm text-texto">{c.texto}</p>
              </li>
            ))}
            {(comentarios ?? []).length === 0 && <li className="text-sm text-mudo">Nenhum comentário ainda.</li>}
          </ul>
          <Formulario acao={comentarTarefa} className="space-y-3">
            <input type="hidden" name="tarefa_id" value={id} />
            <AreaTexto name="texto" required rows={3} placeholder="Escreva um comentário…" aria-label="Novo comentário" />
            <div className="flex justify-end">
              <BotaoEnviar>Comentar</BotaoEnviar>
            </div>
          </Formulario>
        </Cartao>
      </div>
    </>
  );
}
