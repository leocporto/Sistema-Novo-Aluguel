import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Ban, Check, Plus, RotateCcw } from "lucide-react";
import { BarraProgresso } from "@/components/barra-progresso";
import { BotaoAcao } from "@/components/botao-acao";
import { BotaoExcluir } from "@/components/botao-excluir";
import { JanelaCadastro } from "@/components/janela-cadastro";
import { AreaTexto, Cabecalho, Campo, Cartao, Entrada, Selecao, Selo } from "@/components/ui";
import { formatarDataBR, formatarDataLocal, hojeISO } from "@/lib/dominio/datas";
import { RESPONSAVEIS_ONBOARDING, progressoOnboarding } from "@/lib/dominio/equipe";
import { exigirVerRota } from "@/lib/permissoes";
import { AbasEquipe } from "../../abas";
import { adicionarItemOnboarding, cancelarOnboarding, concluirItemOnboarding, excluirItemOnboarding, excluirOnboarding, reabrirItemOnboarding } from "../../actions";
import { contextoEquipe, nomesUsuarios } from "../../dados";

export const metadata: Metadata = { title: "Onboarding do colaborador" };

type Item = { id: string; ordem: number; titulo: string; descricao: string | null; responsavel: string; prazo: string | null; concluido_em: string | null; concluido_por: string | null };

export default async function OnboardingColaboradorPage({ params }: PageProps<"/equipe/onboarding/[id]">) {
  await exigirVerRota("/equipe");
  const { id } = await params;
  const hoje = hojeISO();
  const { supabase, pode, minhaPessoa } = await contextoEquipe();
  const [{ data }, { data: itensData }, nomes] = await Promise.all([
    supabase.from("equipe_onboardings").select("id, titulo, inicio, status, responsavel_id, concluido_em, pessoa_id, pessoa:pessoas(id, nome)").eq("id", id).maybeSingle(),
    supabase.from("equipe_onboarding_itens").select("id, ordem, titulo, descricao, responsavel, prazo, concluido_em, concluido_por").eq("onboarding_id", id).order("ordem").order("titulo"),
    nomesUsuarios(supabase),
  ]);
  if (!data) notFound();
  const o = data as unknown as { id: string; titulo: string; inicio: string; status: string; responsavel_id: string | null; concluido_em: string | null; pessoa_id: string; pessoa: { id: string; nome: string } | null };
  const itens = (itensData ?? []) as Item[];
  const p = progressoOnboarding(itens, hoje);
  const podeEditar = pode("equipe", "editar");
  const podeMarcar = podeEditar || minhaPessoa === o.pessoa_id;

  return (
    <>
      <Cabecalho
        titulo={`Onboarding de ${o.pessoa?.nome ?? "colaborador"}`}
        trilha="Onboarding"
        descricao={
          <span className="flex flex-wrap items-center gap-2">
            {o.titulo} · começou em {formatarDataBR(o.inicio)}
            {o.responsavel_id && ` · responsável: ${nomes.get(o.responsavel_id) ?? "—"}`}
            {o.status === "concluido" ? <Selo cor="verde">concluído em {formatarDataLocal(o.concluido_em)}</Selo> : o.status === "cancelado" ? <Selo>cancelado</Selo> : <Selo cor="azul">em andamento</Selo>}
            {o.pessoa && (
              <Link href={`/equipe/colaboradores/${o.pessoa.id}`} className="text-acento hover:underline">
                ver ficha
              </Link>
            )}
          </span>
        }
        acoes={
          podeEditar && (
            <>
              {o.status === "em_andamento" && (
                <BotaoAcao acao={cancelarOnboarding} id={id} confirmar="Cancelar este onboarding? Os itens ficam guardados.">
                  <Ban className="size-4" /> Cancelar
                </BotaoAcao>
              )}
              <BotaoExcluir acao={excluirOnboarding} id={id} variante="botao" confirmar="Excluir este onboarding e todos os itens?" depois="/equipe/onboarding" />
            </>
          )
        }
      />
      <AbasEquipe />
      <Cartao
        titulo={`Checklist — ${p.feitos} de ${p.total} feitos`}
        acoes={
          podeEditar ? (
            <JanelaCadastro rotuloBotao={<><Plus className="size-4" /> Item</>} tamanho="sm" variante="secundario" titulo="Novo item do checklist" acao={adicionarItemOnboarding} icone={<Plus />} rotuloSalvar="Incluir">
              <input type="hidden" name="onboarding_id" value={id} />
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
                <Campo rotulo="Prazo">
                  <Entrada type="date" name="prazo" />
                </Campo>
              </div>
            </JanelaCadastro>
          ) : undefined
        }
      >
        <div className="mb-5 flex items-center gap-3">
          <BarraProgresso pct={p.pct} atingida={p.pct >= 100} />
          <span className="w-14 text-right text-sm font-semibold tabular-nums text-texto-2">{p.pct}%</span>
        </div>
        {itens.length === 0 ? (
          <p className="text-sm text-mudo">Checklist vazio. Inclua os itens.</p>
        ) : (
          <ul className="divide-y divide-borda-suave">
            {itens.map((i) => {
              const atrasado = !i.concluido_em && i.prazo && i.prazo < hoje;
              return (
                <li key={i.id} className="flex flex-wrap items-start gap-3 py-3">
                  <span className={`mt-0.5 grid size-7 shrink-0 place-items-center rounded-full border-2 ${i.concluido_em ? "border-ok bg-ok text-white" : "border-borda-forte text-transparent"}`} aria-hidden>
                    <Check className="size-4" strokeWidth={3} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className={`font-medium ${i.concluido_em ? "text-mudo line-through" : "text-texto"}`}>{i.titulo}</div>
                    {i.descricao && <div className="text-sm text-texto-2">{i.descricao}</div>}
                    <div className="mt-0.5 text-xs text-mudo">
                      {RESPONSAVEIS_ONBOARDING[i.responsavel] ?? i.responsavel}
                      {i.prazo && <span className={atrasado ? "font-semibold text-ruim" : ""}> · até {formatarDataBR(i.prazo)}</span>}
                      {i.concluido_em && ` · feito em ${formatarDataLocal(i.concluido_em)}${i.concluido_por ? ` por ${nomes.get(i.concluido_por) ?? "usuário"}` : ""}`}
                    </div>
                  </div>
                  {podeMarcar && o.status !== "cancelado" && (
                    i.concluido_em ? (
                      <BotaoAcao acao={reabrirItemOnboarding} id={i.id} tamanho="sm">
                        <RotateCcw className="size-3.5" /> Desfazer
                      </BotaoAcao>
                    ) : (
                      <BotaoAcao acao={concluirItemOnboarding} id={i.id} tamanho="sm" variante="primario">
                        <Check className="size-3.5" /> Feito
                      </BotaoAcao>
                    )
                  )}
                  {podeEditar && <BotaoExcluir acao={excluirItemOnboarding} id={i.id} rotulo="Excluir item" confirmar={`Excluir o item "${i.titulo}"?`} />}
                </li>
              );
            })}
          </ul>
        )}
      </Cartao>
    </>
  );
}
