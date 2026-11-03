import type { Metadata } from "next";
import Link from "next/link";
import { Check, ListTodo, Trash2 } from "lucide-react";
import { JanelaCadastro } from "@/components/janela-cadastro";
import { Cabecalho, Selo } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { formatarDataBR, hojeISO } from "@/lib/dominio/datas";
import { alternarTarefa, criarTarefa, excluirTarefa } from "../actions";
import { AbasComercial, CamposTarefa } from "../campos";

export const metadata: Metadata = { title: "Tarefas" };

type T = {
  id: string;
  titulo: string;
  vencimento: string | null;
  prioridade: "alta" | "normal";
  concluida: boolean;
  concluida_em: string | null;
  lead: { id: string; nome: string } | null;
  imovel: { id: string; codigo: string } | null;
  contrato: { id: string; numero: number } | null;
};

export default async function TarefasPage({ searchParams }: PageProps<"/comercial/tarefas">) {
  const sp = await searchParams;
  const verConcluidas = sp.ver === "concluidas";
  const { supabase } = await obterContexto();
  const hoje = hojeISO();
  const { data } = await supabase
    .from("tarefas")
    .select("id, titulo, vencimento, prioridade, concluida, concluida_em, lead:leads(id, nome), imovel:imoveis(id, codigo), contrato:contratos(id, numero)")
    .eq("concluida", verConcluidas)
    .order(verConcluidas ? "concluida_em" : "vencimento", { ascending: !verConcluidas, nullsFirst: false })
    .limit(300);
  const tarefas = (data ?? []) as unknown as T[];
  if (!verConcluidas) {
    const peso = (t: T) => (t.vencimento && t.vencimento < hoje ? 0 : t.prioridade === "alta" ? 1 : 2);
    tarefas.sort((a, b) => peso(a) - peso(b) || (a.vencimento ?? "9").localeCompare(b.vencimento ?? "9"));
  }

  return (
    <>
      <Cabecalho
        titulo="Tarefas"
        trilha="Comercial"
        descricao="O que precisa ser feito. As vencidas e de prioridade alta aparecem primeiro e também no Painel."
        acoes={
          <JanelaCadastro rotuloBotao={<><ListTodo className="size-4" /> Nova tarefa</>} titulo="Nova tarefa" acao={criarTarefa} rotuloSalvar="Criar" icone={<ListTodo />} abertaInicial={sp.novo === "1"}>
            <CamposTarefa hoje={hoje} />
          </JanelaCadastro>
        }
      />
      <AbasComercial />
      <div className="mb-4 flex gap-2 text-sm">
        <Link href="/comercial/tarefas" className={`rounded-full px-3.5 py-1.5 font-semibold ${verConcluidas ? "text-texto-2 hover:bg-card-hover" : "bg-acento text-white"}`}>
          A fazer
        </Link>
        <Link href="/comercial/tarefas?ver=concluidas" className={`rounded-full px-3.5 py-1.5 font-semibold ${verConcluidas ? "bg-acento text-white" : "text-texto-2 hover:bg-card-hover"}`}>
          Concluídas
        </Link>
      </div>

      {tarefas.length === 0 ? (
        <div className="rounded-card border border-borda bg-card px-5 py-10 text-center text-sm text-mudo">
          {verConcluidas ? "Nenhuma tarefa concluída." : "Nada pendente. 🎉"}
        </div>
      ) : (
        <ul className="entrar divide-y divide-borda-suave overflow-hidden rounded-card border border-borda bg-card">
          {tarefas.map((t) => {
            const vencida = !t.concluida && t.vencimento && t.vencimento < hoje;
            return (
              <li key={t.id} className="flex items-center gap-3 px-4 py-3">
                <form action={alternarTarefa}>
                  <input type="hidden" name="id" value={t.id} />
                  <input type="hidden" name="concluir" value={t.concluida ? "0" : "1"} />
                  <button
                    role="checkbox"
                    aria-checked={t.concluida}
                    aria-label={t.concluida ? `Reabrir: ${t.titulo}` : `Concluir: ${t.titulo}`}
                    className={`grid size-7 place-items-center rounded-full border-2 transition ${t.concluida ? "border-ok bg-ok text-white" : "border-borda-forte text-transparent hover:border-ok hover:text-ok"}`}
                  >
                    <Check className="size-4" strokeWidth={3} />
                  </button>
                </form>
                <div className="min-w-0 flex-1">
                  <div className={`font-medium ${t.concluida ? "text-mudo line-through" : "text-texto"}`}>{t.titulo}</div>
                  <div className="flex flex-wrap gap-x-2 text-xs text-mudo">
                    {t.lead && (
                      <Link href={`/comercial/leads/${t.lead.id}`} className="hover:underline">
                        {t.lead.nome}
                      </Link>
                    )}
                    {t.imovel && (
                      <Link href={`/imoveis/${t.imovel.id}`} className="hover:underline">
                        {t.imovel.codigo}
                      </Link>
                    )}
                    {t.contrato && (
                      <Link href={`/contratos/${t.contrato.id}`} className="hover:underline">
                        contrato #{t.contrato.numero}
                      </Link>
                    )}
                  </div>
                </div>
                {t.prioridade === "alta" && !t.concluida && <Selo cor="vermelho">alta</Selo>}
                <span className={`w-24 text-right text-sm tabular-nums ${vencida ? "font-semibold text-ruim" : "text-mudo"}`}>
                  {t.vencimento ? (t.vencimento === hoje ? "hoje" : formatarDataBR(t.vencimento)) : "sem data"}
                </span>
                <form action={excluirTarefa}>
                  <input type="hidden" name="id" value={t.id} />
                  <button title="Excluir tarefa" aria-label="Excluir tarefa" className="grid size-8 place-items-center rounded-[9px] text-mudo hover:bg-ruim-bg hover:text-ruim">
                    <Trash2 className="size-4" />
                  </button>
                </form>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
