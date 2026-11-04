import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeftRight, CircleDollarSign, Gavel, Inbox, Send, Settings2, Wrench } from "lucide-react";
import { aprovarLancamento } from "@/app/(app)/financeiro/actions";
import { Contador } from "@/components/abas-segmentadas";
import { BotaoAcao } from "@/components/botao-acao";
import { BotaoExcluir } from "@/components/botao-excluir";
import { JanelaCadastro } from "@/components/janela-cadastro";
import { PilulasLink } from "@/components/pilulas-link";
import { AreaTexto, BotaoLink, Cabecalho, Campo, Cartao, Entrada, Indicador, Selecao, Selo } from "@/components/ui";
import { formatarDataBR, formatarDataLocal, hojeISO } from "@/lib/dominio/datas";
import { formatarReais } from "@/lib/dominio/dinheiro";
import { COR_STATUS_APROVACAO, ROTULO_STATUS_APROVACAO, TIPOS_APROVACAO, descreverAprovador, linkInterno, podeDecidirAprovacao } from "@/lib/dominio/equipe";
import { exigirVerRota } from "@/lib/permissoes";
import { AbasEquipe } from "../abas";
import { cancelarSolicitacao, decidirSolicitacao, excluirSolicitacao, novaSolicitacao } from "../actions";
import { carregarEstrutura, carregarMembros, contextoEquipe, nomeDoMembro, perfilEfetivo } from "../dados";

export const metadata: Metadata = { title: "Aprovações" };

const FILTROS: Record<string, string> = { minhas: "Para eu decidir", pendentes: "Todas pendentes", pedidas: "Que eu pedi", decididas: "Decididas" };

type Aprovacao = {
  id: string;
  numero: number;
  tipo: string;
  titulo: string;
  descricao: string | null;
  valor: number | null;
  link: string | null;
  solicitante_id: string | null;
  aprovador_id: string | null;
  aprovador_papel: string | null;
  aprovador_perfil_id: string | null;
  prazo: string | null;
  status: string;
  comentario: string | null;
  decidida_em: string | null;
  decidida_por: string | null;
  created_at: string;
};

export default async function AprovacoesPage({ searchParams }: PageProps<"/equipe/aprovacoes">) {
  await exigirVerRota("/equipe/aprovacoes");
  const sp = await searchParams;
  const filtro = typeof sp.f === "string" && sp.f in FILTROS ? sp.f : "minhas";
  const hoje = hojeISO();
  const { supabase, usuario, papel, pode, meuPerfil, admin, organizacao } = await contextoEquipe();

  const campos = "id, numero, tipo, titulo, descricao, valor, link, solicitante_id, aprovador_id, aprovador_papel, aprovador_perfil_id, prazo, status, comentario, decidida_em, decidida_por, created_at";
  const pendentesQ = supabase.from("aprovacoes").select(campos).eq("status", "pendente").order("created_at").limit(500);
  const outrasQ =
    filtro === "decididas"
      ? supabase.from("aprovacoes").select(campos).neq("status", "pendente").order("decidida_em", { ascending: false, nullsFirst: false }).limit(300)
      : filtro === "pedidas"
        ? supabase.from("aprovacoes").select(campos).eq("solicitante_id", usuario.id).order("created_at", { ascending: false }).limit(300)
        : Promise.resolve({ data: null });

  const podeFinanceiro = papel === "admin" || papel === "gestor";
  const [{ data: pendentesData }, { data: outrasData }, membros, estrutura, { data: pagamentos }, { data: org }, { count: chamadosProp }, { data: pendVistoria }] = await Promise.all([
    pendentesQ,
    outrasQ,
    carregarMembros(supabase),
    carregarEstrutura(supabase),
    supabase.from("lancamentos").select("id, descricao, valor, vencimento").eq("tipo", "pagar").eq("status", "aberto").eq("requer_aprovacao", true).is("aprovado_em", null).order("vencimento").limit(100),
    supabase.from("organizacoes").select("repasse_exige_aprovacao").eq("id", organizacao.id).maybeSingle(),
    supabase.from("chamados").select("id", { count: "exact", head: true }).eq("aprovacao_status", "pendente"),
    supabase.from("vistoria_orcamentos").select("pendencia_id, pendencia:vistoria_pendencias!inner(status)").eq("aprovado", false).in("pendencia.status", ["aberta", "em_reparo"]).limit(1000),
  ]);
  const { count: repassesAguardando } = org?.repasse_exige_aprovacao
    ? await supabase.from("repasses").select("id", { count: "exact", head: true }).eq("status", "pendente").is("aprovado_em", null)
    : { count: 0 };
  const nomes = new Map(membros.map((m) => [m.user_id, nomeDoMembro(m)]));
  const nomesPerfis = new Map(estrutura.perfis.map((p) => [p.id, p.nome]));
  const eu = { userId: usuario.id, papel, perfilEfetivo: perfilEfetivo(estrutura.perfis, papel, meuPerfil), podeAprovar: pode("aprovacoes", "aprovar") };
  const pendentes = (pendentesData ?? []) as Aprovacao[];
  const paraMim = pendentes.filter((a) => podeDecidirAprovacao(a, eu));
  const lista = filtro === "minhas" ? paraMim : filtro === "pendentes" ? pendentes : ((outrasData ?? []) as Aprovacao[]);
  const vistoriasAguardando = new Set((pendVistoria ?? []).map((v) => v.pendencia_id as string)).size;

  return (
    <>
      <Cabecalho
        titulo="Aprovações"
        trilha="Equipe"
        descricao="Caixa central: o que está esperando decisão — solicitações da equipe (despesas, descontos, reembolsos, férias…) e as aprovações dos outros módulos (pagamentos acima do limite, repasses e orçamentos)."
        acoes={
          <>
            {pode("aprovacoes", "editar") && (
              <BotaoLink href="/equipe/aprovacoes/regras" variante="secundario">
                <Settings2 className="size-4" /> Quem aprova o quê
              </BotaoLink>
            )}
            {pode("aprovacoes", "criar") && (
              <JanelaCadastro rotuloBotao={<><Send className="size-4" /> Pedir aprovação</>} titulo="Pedir aprovação" acao={novaSolicitacao} icone={<Send />} rotuloSalvar="Enviar">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Campo rotulo="Tipo">
                    <Selecao name="tipo" defaultValue="despesa">
                      {Object.entries(TIPOS_APROVACAO).map(([k, r]) => (
                        <option key={k} value={k}>
                          {r}
                        </option>
                      ))}
                    </Selecao>
                  </Campo>
                  <Campo rotulo="Valor (R$, se houver)">
                    <Entrada name="valor" inputMode="decimal" />
                  </Campo>
                </div>
                <Campo rotulo="O que precisa ser aprovado">
                  <Entrada name="titulo" required placeholder="Compra de placas de 'Aluga-se'" />
                </Campo>
                <Campo rotulo="Detalhes">
                  <AreaTexto name="descricao" rows={3} />
                </Campo>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Campo rotulo="Precisa até">
                    <Entrada type="date" name="prazo" />
                  </Campo>
                  <Campo rotulo="Pedir para (se não houver regra)">
                    <Selecao name="aprovador_id" defaultValue="">
                      <option value="">Quem a regra mandar</option>
                      {membros
                        .filter((m) => m.user_id !== usuario.id && m.papel !== "corretor")
                        .map((m) => (
                          <option key={m.user_id} value={m.user_id}>
                            {nomeDoMembro(m)}
                          </option>
                        ))}
                    </Selecao>
                  </Campo>
                </div>
                <p className="text-xs text-mudo">As regras de “quem aprova o quê” valem primeiro (pelo tipo e pelo valor).</p>
              </JanelaCadastro>
            )}
          </>
        }
      />
      <AbasEquipe />
      <div className="entrar-cascata mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Indicador
          rotulo="Para eu decidir"
          icone={<Gavel />}
          valor={<Contador valor={paraMim.length} />}
          detalhe={`${pendentes.length} pendente(s) no total`}
          tom={paraMim.length ? "alerta" : "neutro"}
          href="/equipe/aprovacoes"
        />
        <Indicador
          rotulo="Pagamentos acima do limite"
          icone={<CircleDollarSign />}
          valor={<Contador valor={(pagamentos ?? []).length} />}
          detalhe={formatarReais((pagamentos ?? []).reduce((s, l) => s + Number(l.valor), 0))}
          tom={(pagamentos ?? []).length ? "alerta" : "neutro"}
        />
        <Indicador rotulo="Repasses a aprovar" icone={<ArrowLeftRight />} valor={<Contador valor={repassesAguardando ?? 0} />} detalhe={org?.repasse_exige_aprovacao ? "aprovação exigida antes de pagar" : "aprovação não exigida"} href="/repasses" />
        <Indicador rotulo="Orçamentos esperando decisão" icone={<Wrench />} valor={<Contador valor={(chamadosProp ?? 0) + vistoriasAguardando} />} detalhe={`${chamadosProp ?? 0} do proprietário (manutenção) · ${vistoriasAguardando} de reparo (vistoria)`} />
      </div>

      <PilulasLink className="mb-4" rotulo="Filtro de aprovações" ativo={`/equipe/aprovacoes?f=${filtro}`} itens={Object.entries(FILTROS).map(([k, r]) => ({ href: `/equipe/aprovacoes?f=${k}`, rotulo: r }))} />

      {lista.length === 0 ? (
        <div className="mb-6 flex items-center gap-3 rounded-card border border-borda bg-card px-5 py-8 text-sm text-mudo">
          <Inbox className="size-5" /> {filtro === "minhas" ? "Nada esperando a sua decisão." : "Nenhuma solicitação nesta lista."}
        </div>
      ) : (
        <ul className="entrar mb-6 space-y-3">
          {lista.map((a) => {
            const decide = a.status === "pendente" && podeDecidirAprovacao(a, eu);
            const minha = a.solicitante_id === usuario.id;
            return (
              <li key={a.id} className="rounded-card border border-borda bg-card p-4">
                <div className="flex flex-wrap items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-texto">{a.titulo}</span>
                      <Selo cor={COR_STATUS_APROVACAO[a.status as keyof typeof COR_STATUS_APROVACAO] ?? "cinza"}>{ROTULO_STATUS_APROVACAO[a.status]}</Selo>
                      {a.valor !== null && <span className="font-semibold tabular-nums text-texto">{formatarReais(a.valor)}</span>}
                    </div>
                    <div className="mt-1 text-xs text-mudo">
                      #{a.numero} · {TIPOS_APROVACAO[a.tipo] ?? a.tipo} · pedido por {a.solicitante_id ? (nomes.get(a.solicitante_id) ?? "usuário") : "sistema"} em{" "}
                      {formatarDataLocal(a.created_at)} · decide: {descreverAprovador(a, { usuarios: nomes, perfis: nomesPerfis })}
                      {a.prazo && <span className={a.status === "pendente" && a.prazo < hoje ? "font-semibold text-ruim" : ""}> · precisa até {formatarDataBR(a.prazo)}</span>}
                    </div>
                    {a.descricao && <p className="mt-2 whitespace-pre-wrap text-sm text-texto-2">{a.descricao}</p>}
                    {linkInterno(a.link) && (
                      <Link href={linkInterno(a.link) as string} className="mt-1 inline-block text-sm text-acento hover:underline">
                        Abrir o que foi pedido
                      </Link>
                    )}
                    {a.status !== "pendente" && (
                      <p className="mt-2 text-sm text-texto-2">
                        {ROTULO_STATUS_APROVACAO[a.status]} por {a.decidida_por ? (nomes.get(a.decidida_por) ?? "usuário") : "—"} em {formatarDataLocal(a.decidida_em)}
                        {a.comentario && ` — “${a.comentario}”`}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {decide && (
                      <JanelaCadastro rotuloBotao="Decidir" tamanho="sm" titulo={`Decidir: ${a.titulo}`} acao={decidirSolicitacao} icone={<Gavel />} rotuloSalvar="Registrar decisão">
                        <input type="hidden" name="id" value={a.id} />
                        {a.valor !== null && <p className="text-sm text-texto">Valor pedido: {formatarReais(a.valor)}</p>}
                        <Campo rotulo="Decisão">
                          <Selecao name="decisao" defaultValue="aprovar">
                            <option value="aprovar">Aprovar</option>
                            <option value="recusar">Recusar</option>
                          </Selecao>
                        </Campo>
                        <Campo rotulo="Comentário (obrigatório para recusar)">
                          <AreaTexto name="comentario" rows={2} />
                        </Campo>
                      </JanelaCadastro>
                    )}
                    {a.status === "pendente" && (minha || admin) && (
                      <BotaoAcao acao={cancelarSolicitacao} id={a.id} tamanho="sm" confirmar="Cancelar esta solicitação?">
                        Cancelar
                      </BotaoAcao>
                    )}
                    {(a.status === "pendente" || a.status === "cancelada") && (minha || admin) && (
                      <BotaoExcluir acao={excluirSolicitacao} id={a.id} rotulo="Excluir solicitação" confirmar={`Excluir a solicitação "${a.titulo}"?`} />
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {filtro !== "decididas" && filtro !== "pedidas" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Cartao
            titulo="Pagamentos acima do limite"
            acoes={
              <Link href="/financeiro" className="text-sm text-acento hover:underline">
                Financeiro
              </Link>
            }
          >
            {(pagamentos ?? []).length === 0 ? (
              <p className="text-sm text-mudo">Nenhum pagamento esperando aprovação.</p>
            ) : (
              <ul className="divide-y divide-borda-suave">
                {((pagamentos ?? []) as { id: string; descricao: string; valor: number; vencimento: string }[]).map((l) => (
                  <li key={l.id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
                    <span className="min-w-0 flex-1">
                      <span className="text-texto">{l.descricao}</span>
                      <span className="block text-xs text-mudo">vence {formatarDataBR(l.vencimento)}</span>
                    </span>
                    <span className="font-semibold tabular-nums">{formatarReais(l.valor)}</span>
                    {podeFinanceiro && (
                      <BotaoAcao acao={aprovarLancamento} id={l.id} tamanho="sm" variante="primario" confirmar={`Aprovar o pagamento "${l.descricao}" de ${formatarReais(l.valor)}?`}>
                        Aprovar
                      </BotaoAcao>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {!podeFinanceiro && (pagamentos ?? []).length > 0 && <p className="mt-2 text-xs text-mudo">Só administradores e gestores aprovam pagamentos.</p>}
          </Cartao>
          <Cartao titulo="Outras aprovações dos módulos">
            <ul className="space-y-2 text-sm">
              <li className="flex items-center justify-between gap-3">
                <span>Repasses esperando aprovação</span>
                <Link href="/repasses" className="font-semibold text-acento hover:underline">
                  {repassesAguardando ?? 0}
                </Link>
              </li>
              <li className="flex items-center justify-between gap-3">
                <span>Orçamentos de manutenção esperando o proprietário</span>
                <Link href="/manutencao" className="font-semibold text-acento hover:underline">
                  {chamadosProp ?? 0}
                </Link>
              </li>
              <li className="flex items-center justify-between gap-3">
                <span>Reparos de vistoria com orçamento sem aprovar</span>
                <Link href="/vistorias/pendencias" className="font-semibold text-acento hover:underline">
                  {vistoriasAguardando}
                </Link>
              </li>
            </ul>
            <p className="mt-3 text-xs text-mudo">Estas aprovações são feitas na tela de cada módulo, com as regras de lá.</p>
          </Cartao>
        </div>
      )}
    </>
  );
}
