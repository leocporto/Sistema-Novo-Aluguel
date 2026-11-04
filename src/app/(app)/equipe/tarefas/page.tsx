import type { Metadata } from "next";
import { AlarmClock, CheckCircle2, Hourglass, ListTodo, UserRound } from "lucide-react";
import { Contador } from "@/components/abas-segmentadas";
import { BotaoAcao } from "@/components/botao-acao";
import { FiltroAutomatico } from "@/components/filtro-automatico";
import { JanelaCadastro } from "@/components/janela-cadastro";
import { LinhaLink } from "@/components/linha-link";
import { PilulasLink } from "@/components/pilulas-link";
import { Cabecalho, Celula, Entrada, Indicador, LinhaVazia, Selecao, Selo, Tabela } from "@/components/ui";
import { formatarDataBR, hojeISO } from "@/lib/dominio/datas";
import {
  CATEGORIAS_TAREFA,
  COR_PRIORIDADE,
  COR_STATUS_TAREFA,
  ROTULO_PRIORIDADE,
  ROTULO_STATUS_TAREFA,
  ordenarTarefas,
  tarefaAberta,
} from "@/lib/dominio/equipe";
import { exigirVerRota } from "@/lib/permissoes";
import { AbasEquipe } from "../abas";
import { concluirTarefaInterna, criarTarefaInterna } from "../actions";
import { carregarOpcoesTarefa, contextoEquipe, nomeDoMembro } from "../dados";
import { CamposTarefaInterna } from "./campos-tarefa";

export const metadata: Metadata = { title: "Tarefas internas" };

const FILTROS: Record<string, string> = {
  minhas: "Minhas",
  abertas: "Todas em aberto",
  atrasadas: "Atrasadas",
  criadas: "Que eu pedi",
  concluidas: "Concluídas",
};

type Tarefa = {
  id: string;
  numero: number;
  titulo: string;
  categoria: string;
  prioridade: string;
  status: string;
  responsavel_id: string | null;
  criado_por: string | null;
  prazo: string | null;
  concluida_em: string | null;
  comentarios: { count: number }[];
};

export default async function TarefasInternasPage({ searchParams }: PageProps<"/equipe/tarefas">) {
  await exigirVerRota("/equipe");
  const sp = await searchParams;
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const filtro = s("f") in FILTROS ? s("f") : "minhas";
  const categoria = s("categoria") in CATEGORIAS_TAREFA ? s("categoria") : "";
  const responsavel = s("resp");
  const busca = s("q").trim();
  const hoje = hojeISO();
  const { supabase, usuario } = await contextoEquipe();

  let q = supabase
    .from("equipe_tarefas")
    .select("id, numero, titulo, categoria, prioridade, status, responsavel_id, criado_por, prazo, concluida_em, comentarios:equipe_tarefa_comentarios(count)")
    .limit(500);
  if (filtro === "concluidas") q = q.in("status", ["concluida", "cancelada"]).order("concluida_em", { ascending: false, nullsFirst: false });
  else q = q.in("status", ["a_fazer", "em_andamento", "aguardando"]);
  if (filtro === "minhas") q = q.eq("responsavel_id", usuario.id);
  if (filtro === "criadas") q = q.eq("criado_por", usuario.id);
  if (filtro === "atrasadas") q = q.lt("prazo", hoje);
  if (categoria) q = q.eq("categoria", categoria);
  if (responsavel) q = q.eq("responsavel_id", responsavel);
  if (busca) q = q.ilike("titulo", `%${busca.replace(/[%_]/g, "")}%`);

  const [{ data }, opcoes, minhas, atrasadas, aguardando, concluidasMes] = await Promise.all([
    q,
    carregarOpcoesTarefa(supabase),
    supabase.from("equipe_tarefas").select("id", { count: "exact", head: true }).eq("responsavel_id", usuario.id).in("status", ["a_fazer", "em_andamento", "aguardando"]),
    supabase.from("equipe_tarefas").select("id", { count: "exact", head: true }).in("status", ["a_fazer", "em_andamento", "aguardando"]).lt("prazo", hoje),
    supabase.from("equipe_tarefas").select("id", { count: "exact", head: true }).eq("status", "aguardando"),
    supabase.from("equipe_tarefas").select("id", { count: "exact", head: true }).eq("status", "concluida").gte("concluida_em", `${hoje.slice(0, 7)}-01T00:00:00-03:00`),
  ]);
  const tarefas = filtro === "concluidas" ? ((data ?? []) as unknown as Tarefa[]) : ordenarTarefas((data ?? []) as unknown as Tarefa[], hoje);
  const nomes = new Map(opcoes.membros.map((m) => [m.user_id, nomeDoMembro(m)]));
  const url = (f: string) => {
    const p = new URLSearchParams(Object.entries({ f, categoria, resp: responsavel, q: s("q") }).filter(([, v]) => v) as [string, string][]);
    return `/equipe/tarefas?${p}`;
  };

  return (
    <>
      <Cabecalho
        titulo="Tarefas internas"
        trilha="Equipe"
        descricao="O que a equipe precisa fazer fora do comercial: documentos, financeiro, jurídico, manutenção do escritório… Com responsável, prazo, prioridade e comentários. As tarefas de lead ficam em Comercial → Tarefas."
        acoes={
          <JanelaCadastro rotuloBotao={<><ListTodo className="size-4" /> Nova tarefa</>} titulo="Nova tarefa interna" acao={criarTarefaInterna} icone={<ListTodo />} rotuloSalvar="Criar" abertaInicial={s("novo") === "1"} larguraMax="max-w-2xl">
            <CamposTarefaInterna opcoes={opcoes} eu={usuario.id} />
          </JanelaCadastro>
        }
      />
      <AbasEquipe />
      <div className="entrar-cascata mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Indicador rotulo="Minhas em aberto" icone={<UserRound />} valor={<Contador valor={minhas.count ?? 0} />} href={url("minhas")} />
        <Indicador rotulo="Atrasadas" icone={<AlarmClock />} valor={<Contador valor={atrasadas.count ?? 0} />} tom={atrasadas.count ? "perigo" : "neutro"} href={url("atrasadas")} />
        <Indicador rotulo="Aguardando alguém" icone={<Hourglass />} valor={<Contador valor={aguardando.count ?? 0} />} tom={aguardando.count ? "alerta" : "neutro"} href={url("abertas")} />
        <Indicador rotulo="Concluídas no mês" icone={<CheckCircle2 />} valor={<Contador valor={concluidasMes.count ?? 0} />} tom="sucesso" href={url("concluidas")} />
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <PilulasLink rotulo="Filtro de tarefas" ativo={url(filtro)} itens={Object.entries(FILTROS).map(([k, r]) => ({ href: url(k), rotulo: r }))} />
        <FiltroAutomatico className="filtros-linha">
          <input type="hidden" name="f" value={filtro} />
          <Entrada name="q" defaultValue={s("q")} placeholder="Buscar tarefa" aria-label="Buscar tarefa" className="max-w-xs" />
          <Selecao name="categoria" defaultValue={categoria} aria-label="Categoria" className="max-w-56">
            <option value="">Todas as categorias</option>
            {Object.entries(CATEGORIAS_TAREFA).map(([k, r]) => (
              <option key={k} value={k}>
                {r}
              </option>
            ))}
          </Selecao>
          {filtro !== "minhas" && (
            <Selecao name="resp" defaultValue={responsavel} aria-label="Responsável" className="max-w-56">
              <option value="">Qualquer responsável</option>
              {opcoes.membros.map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {nomeDoMembro(m)}
                </option>
              ))}
            </Selecao>
          )}
        </FiltroAutomatico>
      </div>
      <Tabela colunas={["Tarefa", "Responsável", "Prazo", "Prioridade", "Situação", ""]}>
        {tarefas.length === 0 && <LinhaVazia colunas={6}>{filtro === "minhas" ? "Nada com você agora." : "Nenhuma tarefa nesta lista."}</LinhaVazia>}
        {tarefas.map((t) => {
          const atrasada = tarefaAberta(t.status) && t.prazo && t.prazo < hoje;
          const nComentarios = t.comentarios?.[0]?.count ?? 0;
          return (
            <LinhaLink key={t.id} href={`/equipe/tarefas/${t.id}`}>
              <Celula>
                <span className={`font-medium ${t.status === "concluida" ? "text-mudo line-through" : "text-texto"}`}>{t.titulo}</span>
                <span className="block text-xs text-mudo">
                  #{t.numero} · {CATEGORIAS_TAREFA[t.categoria] ?? t.categoria}
                  {nComentarios ? ` · ${nComentarios} comentário(s)` : ""}
                </span>
              </Celula>
              <Celula className="text-sm">{t.responsavel_id ? (nomes.get(t.responsavel_id) ?? "—") : <span className="text-mudo">ninguém</span>}</Celula>
              <Celula className={atrasada ? "font-semibold text-ruim" : "text-sm"}>{t.prazo ? (t.prazo === hoje ? "hoje" : formatarDataBR(t.prazo)) : "sem prazo"}</Celula>
              <Celula>
                <Selo cor={COR_PRIORIDADE[t.prioridade as keyof typeof COR_PRIORIDADE] ?? "cinza"}>{ROTULO_PRIORIDADE[t.prioridade]}</Selo>
              </Celula>
              <Celula>
                <Selo cor={COR_STATUS_TAREFA[t.status as keyof typeof COR_STATUS_TAREFA] ?? "cinza"}>{ROTULO_STATUS_TAREFA[t.status]}</Selo>
              </Celula>
              <Celula>
                {tarefaAberta(t.status) && (t.responsavel_id === usuario.id || t.criado_por === usuario.id) && (
                  <BotaoAcao acao={concluirTarefaInterna} id={t.id} tamanho="sm">
                    Concluir
                  </BotaoAcao>
                )}
              </Celula>
            </LinhaLink>
          );
        })}
      </Tabela>
    </>
  );
}
