import type { Metadata } from "next";
import Link from "next/link";
import { ClipboardList, GraduationCap } from "lucide-react";
import { BarraProgresso } from "@/components/barra-progresso";
import { JanelaCadastro } from "@/components/janela-cadastro";
import { PilulasLink } from "@/components/pilulas-link";
import { AreaTexto, Cabecalho, Campo, Cartao, Entrada, Selecao, Selo } from "@/components/ui";
import { formatarDataBR, hojeISO } from "@/lib/dominio/datas";
import { PAPEIS_USUARIO, ROTULO_PAPEL_USUARIO, progressoOnboarding } from "@/lib/dominio/equipe";
import { exigirVerRota } from "@/lib/permissoes";
import { AbasEquipe } from "../abas";
import { criarModeloOnboarding, iniciarOnboarding } from "../actions";
import { carregarColaboradores, carregarMembros, contextoEquipe, nomeDoMembro, opcoesColaboradores } from "../dados";

export const metadata: Metadata = { title: "Onboarding" };

const FILTROS: Record<string, string> = { em_andamento: "Em andamento", concluido: "Concluídos", cancelado: "Cancelados" };

type Onb = {
  id: string;
  titulo: string;
  inicio: string;
  status: string;
  responsavel_id: string | null;
  pessoa: { id: string; nome: string } | null;
  itens: { concluido_em: string | null; prazo: string | null }[];
};

export default async function OnboardingPage({ searchParams }: PageProps<"/equipe/onboarding">) {
  await exigirVerRota("/equipe");
  const sp = await searchParams;
  const filtro = typeof sp.f === "string" && sp.f in FILTROS ? sp.f : "em_andamento";
  const hoje = hojeISO();
  const { supabase, pode } = await contextoEquipe();
  const podeEditar = pode("equipe", "editar");
  const membros = await carregarMembros(supabase);
  const [{ data }, { data: modelos }, colaboradores] = await Promise.all([
    supabase
      .from("equipe_onboardings")
      .select("id, titulo, inicio, status, responsavel_id, pessoa:pessoas(id, nome), itens:equipe_onboarding_itens(concluido_em, prazo)")
      .eq("status", filtro)
      .order("inicio", { ascending: false })
      .limit(200),
    supabase.from("equipe_onboarding_modelos").select("id, nome, descricao, papel, ativo, itens:equipe_onboarding_modelo_itens(count)").order("nome"),
    carregarColaboradores(supabase, membros),
  ]);
  const onbs = (data ?? []) as unknown as Onb[];
  const nomes = new Map(membros.map((m) => [m.user_id, nomeDoMembro(m)]));
  const listaModelos = (modelos ?? []) as unknown as { id: string; nome: string; descricao: string | null; papel: string | null; ativo: boolean; itens: { count: number }[] }[];

  return (
    <>
      <Cabecalho
        titulo="Onboarding"
        trilha="Equipe"
        descricao="Integração de quem chega: um checklist por colaborador (contrato, documentos, acesso, treinamento, carteira, metas) com prazos e responsáveis. O próprio colaborador marca os itens dele."
        acoes={
          podeEditar && (
            <>
              <JanelaCadastro rotuloBotao={<><ClipboardList className="size-4" /> Novo modelo</>} variante="secundario" titulo="Novo modelo de checklist" acao={criarModeloOnboarding} icone={<ClipboardList />} rotuloSalvar="Criar">
                <Campo rotulo="Nome">
                  <Entrada name="nome" required placeholder="Corretor novo, Administrativo…" />
                </Campo>
                <Campo rotulo="Para qual papel (sugestão)">
                  <Selecao name="papel" defaultValue="">
                    <option value="">Qualquer</option>
                    {PAPEIS_USUARIO.map((p) => (
                      <option key={p} value={p}>
                        {ROTULO_PAPEL_USUARIO[p]}
                      </option>
                    ))}
                  </Selecao>
                </Campo>
                <Campo rotulo="Descrição">
                  <AreaTexto name="descricao" rows={2} />
                </Campo>
                <label className="flex items-center gap-2 text-sm text-texto">
                  <input type="hidden" name="sugerido" value="" />
                  <input type="checkbox" name="sugerido" defaultChecked /> Começar com o checklist sugerido (9 itens; dá para mudar depois)
                </label>
              </JanelaCadastro>
              <JanelaCadastro rotuloBotao={<><GraduationCap className="size-4" /> Iniciar onboarding</>} titulo="Iniciar onboarding" acao={iniciarOnboarding} icone={<GraduationCap />} rotuloSalvar="Começar">
                <Campo rotulo="Colaborador">
                  <Selecao name="pessoa_id" required defaultValue="">
                    <option value="">Selecione…</option>
                    {opcoesColaboradores(colaboradores, hoje).map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.nome}
                      </option>
                    ))}
                  </Selecao>
                </Campo>
                <Campo rotulo="Modelo de checklist">
                  <Selecao name="modelo_id" defaultValue={listaModelos.find((m) => m.ativo)?.id ?? ""}>
                    <option value="">Sem modelo (checklist vazio)</option>
                    {listaModelos
                      .filter((m) => m.ativo)
                      .map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.nome}
                        </option>
                      ))}
                  </Selecao>
                </Campo>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Campo rotulo="Começa em">
                    <Entrada type="date" name="inicio" defaultValue={hoje} />
                  </Campo>
                  <Campo rotulo="Responsável (gestor)">
                    <Selecao name="responsavel_id" defaultValue="">
                      <option value="">—</option>
                      {membros.map((m) => (
                        <option key={m.user_id} value={m.user_id}>
                          {nomeDoMembro(m)}
                        </option>
                      ))}
                    </Selecao>
                  </Campo>
                </div>
              </JanelaCadastro>
            </>
          )
        }
      />
      <AbasEquipe />
      <PilulasLink className="mb-4" rotulo="Situação do onboarding" ativo={`/equipe/onboarding?f=${filtro}`} itens={Object.entries(FILTROS).map(([k, r]) => ({ href: `/equipe/onboarding?f=${k}`, rotulo: r }))} />
      {onbs.length === 0 ? (
        <div className="mb-8 rounded-card border border-borda bg-card px-5 py-10 text-center text-sm text-mudo">Nenhum onboarding nesta lista.</div>
      ) : (
        <div className="entrar-cascata mb-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {onbs.map((o) => {
            const p = progressoOnboarding(o.itens ?? [], hoje);
            return (
              <Link key={o.id} href={`/equipe/onboarding/${o.id}`} className="block rounded-card border border-borda bg-card p-5 transition hover:-translate-y-px hover:border-borda-forte">
                <div className="mb-1 flex items-center gap-2">
                  <span className="flex-1 font-semibold text-texto">{o.pessoa?.nome ?? "Colaborador"}</span>
                  {p.atrasados > 0 && o.status === "em_andamento" && <Selo cor="vermelho">{p.atrasados} atrasado(s)</Selo>}
                </div>
                <div className="mb-3 text-xs text-mudo">
                  {o.titulo} · desde {formatarDataBR(o.inicio)}
                  {o.responsavel_id && ` · com ${nomes.get(o.responsavel_id) ?? "—"}`}
                </div>
                <div className="flex items-center gap-3">
                  <BarraProgresso pct={p.pct} atingida={p.pct >= 100} />
                  <span className="w-14 text-right text-sm font-semibold tabular-nums text-texto-2">{p.pct}%</span>
                </div>
                <div className="mt-1 text-xs text-mudo">
                  {p.feitos} de {p.total} itens
                </div>
              </Link>
            );
          })}
        </div>
      )}
      <Cartao titulo="Modelos de checklist">
        {listaModelos.length === 0 ? (
          <p className="text-sm text-mudo">Nenhum modelo. Crie um com o checklist sugerido para começar.</p>
        ) : (
          <ul className="divide-y divide-borda-suave">
            {listaModelos.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-3 py-2.5">
                <Link href={`/equipe/onboarding/modelos/${m.id}`} className="min-w-0 flex-1 hover:underline">
                  <span className="font-medium text-texto">{m.nome}</span>
                  {m.descricao && <span className="block text-xs text-mudo">{m.descricao}</span>}
                </Link>
                <span className="text-xs text-mudo">{m.itens?.[0]?.count ?? 0} itens</span>
                {m.papel && <Selo>{ROTULO_PAPEL_USUARIO[m.papel]}</Selo>}
                {!m.ativo && <Selo>inativo</Selo>}
              </li>
            ))}
          </ul>
        )}
      </Cartao>
    </>
  );
}
