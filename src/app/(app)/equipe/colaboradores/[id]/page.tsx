import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Building2, CalendarClock, GraduationCap, Inbox, KeyRound, Link2, Mail, Megaphone, Users } from "lucide-react";
import { Contador } from "@/components/abas-segmentadas";
import { BarraProgresso } from "@/components/barra-progresso";
import { BotaoExcluir } from "@/components/botao-excluir";
import { Formulario } from "@/components/formulario";
import { JanelaCadastro } from "@/components/janela-cadastro";
import { Campo, Cartao, Definicao, Entrada, Grade, Indicador, Selecao, Selo } from "@/components/ui";
import { formatarDataBR, formatarDataLocal, hojeISO } from "@/lib/dominio/datas";
import {
  DICA_PAPEL_USUARIO,
  PAPEIS_USUARIO,
  ROTULO_PAPEL_USUARIO,
  TIPOS_CRECI,
  formatarCreci,
  progressoOnboarding,
} from "@/lib/dominio/equipe";
import { convidarUsuario, iniciarOnboarding, ligarUsuarioPessoa, removerAcesso, salvarAcessoUsuario, salvarDadosProfissionais } from "../../actions";
import { CamposCreci, CamposLotacao } from "../../campos";
import { SELECT_COLABORADOR, carregarEstrutura, carregarMembros, contextoEquipe, nomeDoMembro, type Colaborador } from "../../dados";

export const metadata: Metadata = { title: "Colaborador" };

export default async function ColaboradorPage({ params }: PageProps<"/equipe/colaboradores/[id]">) {
  const { id } = await params;
  const { supabase, pode, papel, minhaPessoa } = await contextoEquipe();
  const hoje = hojeISO();
  const [{ data }, membros, estrutura, carteira, { data: onbs }, { data: modelos }] = await Promise.all([
    supabase.from("pessoas").select(SELECT_COLABORADOR).eq("id", id).maybeSingle(),
    carregarMembros(supabase),
    carregarEstrutura(supabase),
    Promise.all([
      supabase.from("leads").select("id", { count: "exact", head: true }).eq("corretor_id", id).not("status", "in", "(ganho,perdido)"),
      supabase.from("captacoes").select("id", { count: "exact", head: true }).eq("corretor_id", id).not("status", "in", "(captado,nao_captado)"),
      supabase.from("imoveis").select("id", { count: "exact", head: true }).eq("corretor_id", id).not("status", "in", "(inativo,vendido)"),
      supabase.from("pessoas").select("id", { count: "exact", head: true }).eq("corretor_id", id),
      supabase.from("visitas").select("id", { count: "exact", head: true }).eq("corretor_id", id).eq("status", "agendada").gte("data_hora", `${hoje}T00:00:00-03:00`),
    ]),
    supabase.from("equipe_onboardings").select("id, titulo, inicio, status, itens:equipe_onboarding_itens(concluido_em, prazo)").eq("pessoa_id", id).order("inicio", { ascending: false }),
    supabase.from("equipe_onboarding_modelos").select("id, nome").eq("ativo", true).order("nome"),
  ]);
  if (!data) notFound();
  const c = data as Colaborador;
  const membro = membros.find((m) => m.pessoa_id === id) ?? null;
  // Gestor (Equipe → editar) muda tudo; o próprio colaborador só o contato e o CRECI.
  const gestor = pode("equipe", "editar");
  const podeEditar = gestor || minhaPessoa === id;
  const admin = papel === "admin";
  const nomeFilial = estrutura.filiais.find((f) => f.id === c.filial_id)?.nome ?? null;
  const nomeEquipe = estrutura.equipes.find((e) => e.id === estrutura.equipeDe.get(id))?.nome ?? null;
  const perfil = membro?.perfil_id ? estrutura.perfis.find((p) => p.id === membro.perfil_id) : null;
  const [leads, captacoes, imoveis, clientes, visitas] = carteira.map((r) => r.count ?? 0);
  const semFicha = membros.filter((m) => !m.pessoa_id);

  return (
    <div className="space-y-6">
      {podeEditar ? (
        <Formulario acao={salvarDadosProfissionais} automatico>
          <input type="hidden" name="id" value={id} />
          <Cartao titulo="Dados profissionais">
            <div className="space-y-4">
              <Grade colunas={3}>
                <Campo rotulo="Nome">
                  <Entrada name="nome" required defaultValue={c.nome} />
                </Campo>
                <Campo rotulo="E-mail">
                  <Entrada name="email" type="email" defaultValue={c.email ?? ""} />
                </Campo>
                <Campo rotulo="Telefone">
                  <Entrada name="telefone" defaultValue={c.telefone ?? ""} />
                </Campo>
                {gestor && (
                  <>
                    <Campo rotulo="Cargo">
                      <Entrada name="cargo" defaultValue={c.cargo ?? ""} />
                    </Campo>
                    <Campo rotulo="Admissão">
                      <Entrada type="date" name="admissao" defaultValue={c.admissao ?? ""} />
                    </Campo>
                    <Campo rotulo="Desligamento" dica="Com data, sai da fila de leads e da lista de ativos.">
                      <Entrada type="date" name="desligamento" defaultValue={c.desligamento ?? ""} />
                    </Campo>
                  </>
                )}
              </Grade>
              <CamposCreci c={c} />
              {gestor ? (
                <>
                  <CamposLotacao filiais={estrutura.filiais} equipes={estrutura.equipes} filialId={c.filial_id} equipeId={estrutura.equipeDe.get(id) ?? null} />
                  <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-texto">
                    <label className="flex items-center gap-2">
                      <input type="hidden" name="corretor" value="" />
                      <input type="checkbox" name="corretor" defaultChecked={c.papeis.includes("corretor")} /> É corretor
                    </label>
                    <label className="flex items-center gap-2">
                      <input type="hidden" name="recebe_leads" value="" />
                      <input type="checkbox" name="recebe_leads" defaultChecked={c.recebe_leads} /> Participa da fila de leads (rodízio)
                    </label>
                  </div>
                </>
              ) : (
                <>
                  <Definicao
                    itens={[
                      ["Cargo", c.cargo],
                      ["Admissão", formatarDataBR(c.admissao)],
                      ["Filial", nomeFilial],
                      ["Equipe", nomeEquipe],
                      ["Fila de leads", c.papeis.includes("corretor") ? (c.recebe_leads ? "participa" : "fora da fila") : null],
                    ]}
                  />
                  <p className="text-xs text-mudo">Cargo, admissão, equipe, filial e fila de leads são mudados pelo gestor. Você pode atualizar o seu contato e o CRECI.</p>
                </>
              )}
            </div>
          </Cartao>
        </Formulario>
      ) : (
        <Cartao titulo="Dados profissionais">
          <Definicao
            itens={[
              ["E-mail", c.email],
              ["Telefone", c.telefone],
              ["Cargo", c.cargo],
              ["Admissão", formatarDataBR(c.admissao)],
              ["CRECI", c.creci_numero ? `${formatarCreci(c.creci_numero, c.creci_uf)}${c.creci_tipo ? ` (${TIPOS_CRECI[c.creci_tipo]})` : ""}` : null],
              ["Validade do CRECI", formatarDataBR(c.creci_validade)],
              ["Filial", nomeFilial],
              ["Equipe", nomeEquipe],
            ]}
          />
        </Cartao>
      )}

      <Cartao
        titulo="Acesso ao sistema"
        acoes={
          membro && admin ? (
            <BotaoExcluir acao={removerAcesso} id={membro.user_id} variante="texto" rotulo="Tirar acesso" confirmar={`Tirar o acesso de ${c.nome} ao sistema? A ficha e o histórico continuam.`} />
          ) : undefined
        }
      >
        {membro ? (
          admin ? (
            <Formulario acao={salvarAcessoUsuario} automatico>
              <input type="hidden" name="user_id" value={membro.user_id} />
              <Grade colunas={3}>
                <Campo rotulo="Papel" dica={DICA_PAPEL_USUARIO[membro.papel]}>
                  <Selecao name="papel" defaultValue={membro.papel}>
                    {PAPEIS_USUARIO.map((p) => (
                      <option key={p} value={p}>
                        {ROTULO_PAPEL_USUARIO[p]}
                      </option>
                    ))}
                  </Selecao>
                </Campo>
                <Campo rotulo="Perfil de acesso" dica="Padrão = o perfil do papel (Equipe → Perfis de acesso).">
                  <Selecao name="perfil_id" defaultValue={membro.perfil_id ?? ""}>
                    <option value="">Padrão do papel</option>
                    {estrutura.perfis
                      .filter((p) => !p.padrao)
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.nome}
                        </option>
                      ))}
                  </Selecao>
                </Campo>
                <Campo rotulo="E-mail de entrada">
                  <Entrada value={membro.email ?? "—"} readOnly aria-label="E-mail de entrada" />
                </Campo>
              </Grade>
            </Formulario>
          ) : (
            <Definicao
              itens={[
                ["Papel", ROTULO_PAPEL_USUARIO[membro.papel] ?? membro.papel],
                ["Perfil de acesso", perfil?.nome ?? "Padrão do papel"],
                ["E-mail de entrada", membro.email],
                ["Usuário desde", formatarDataLocal(membro.created_at)],
              ]}
            />
          )
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <p className="flex-1 text-sm text-texto-2">Esta pessoa ainda não entra no sistema.</p>
            {pode("equipe", "criar") && (
              <JanelaCadastro rotuloBotao={<><Mail className="size-4" /> Convidar para o sistema</>} titulo={`Convidar ${c.nome}`} acao={convidarUsuario} icone={<Mail />} rotuloSalvar="Criar convite">
                <input type="hidden" name="pessoa_id" value={id} />
                <input type="hidden" name="nome" value={c.nome} />
                <p className="text-sm text-texto-2">Depois, copie o link em Equipe → Colaboradores → Convites e mande para a pessoa. Ela cria a conta com este e-mail e abre o link.</p>
                <Campo rotulo="E-mail">
                  <Entrada name="email" type="email" required defaultValue={c.email ?? ""} />
                </Campo>
                <Campo rotulo="Papel">
                  <Selecao name="papel" defaultValue={c.papeis.includes("corretor") ? "corretor" : "financeiro"}>
                    {PAPEIS_USUARIO.filter((p) => admin || p === "corretor" || p === "financeiro").map((p) => (
                      <option key={p} value={p}>
                        {ROTULO_PAPEL_USUARIO[p]}
                      </option>
                    ))}
                  </Selecao>
                </Campo>
              </JanelaCadastro>
            )}
            {pode("equipe", "editar") && semFicha.length > 0 && (
              <JanelaCadastro rotuloBotao={<><Link2 className="size-4" /> Ligar a um usuário</>} variante="secundario" titulo="Ligar a um usuário que já entra no sistema" acao={ligarUsuarioPessoa} icone={<KeyRound />} rotuloSalvar="Ligar">
                <input type="hidden" name="pessoa_id" value={id} />
                <Campo rotulo="Usuário">
                  <Selecao name="user_id" required defaultValue="">
                    <option value="">Selecione…</option>
                    {semFicha.map((m) => (
                      <option key={m.user_id} value={m.user_id}>
                        {nomeDoMembro(m)} ({ROTULO_PAPEL_USUARIO[m.papel]})
                      </option>
                    ))}
                  </Selecao>
                </Campo>
              </JanelaCadastro>
            )}
          </div>
        )}
      </Cartao>

      <Cartao
        titulo="Carteira"
        acoes={
          gestor ? (
            <Link href={`/equipe/distribuicao?de=${id}`} className="text-sm text-acento hover:underline">
              Redistribuir
            </Link>
          ) : undefined
        }
      >
        <div className="entrar-cascata grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <Indicador rotulo="Leads em aberto" icone={<Inbox />} valor={<Contador valor={leads} />} href={`/comercial?corretor=${id}`} />
          <Indicador rotulo="Captações" icone={<Megaphone />} valor={<Contador valor={captacoes} />} href={`/captacao?corretor=${id}`} />
          <Indicador rotulo="Imóveis" icone={<Building2 />} valor={<Contador valor={imoveis} />} href="/imoveis" />
          <Indicador rotulo="Clientes" icone={<Users />} valor={<Contador valor={clientes} />} href={`/equipe/colaboradores/${id}/clientes`} />
          <Indicador rotulo="Visitas agendadas" icone={<CalendarClock />} valor={<Contador valor={visitas} />} href="/agenda" />
        </div>
      </Cartao>

      <Cartao
        titulo="Onboarding"
        acoes={
          pode("equipe", "editar") ? (
            <JanelaCadastro rotuloBotao="Iniciar onboarding" tamanho="sm" variante="secundario" titulo={`Onboarding de ${c.nome}`} acao={iniciarOnboarding} icone={<GraduationCap />} rotuloSalvar="Começar">
              <input type="hidden" name="pessoa_id" value={id} />
              <Campo rotulo="Modelo de checklist">
                <Selecao name="modelo_id" defaultValue={(modelos ?? [])[0]?.id ?? ""}>
                  <option value="">Sem modelo (checklist vazio)</option>
                  {(modelos ?? []).map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.nome}
                    </option>
                  ))}
                </Selecao>
              </Campo>
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
            </JanelaCadastro>
          ) : undefined
        }
      >
        {(onbs ?? []).length === 0 ? (
          <p className="text-sm text-mudo">Nenhum onboarding. Use um modelo de checklist para a integração de quem chegou.</p>
        ) : (
          <ul className="space-y-3">
            {((onbs ?? []) as { id: string; titulo: string; inicio: string; status: string; itens: { concluido_em: string | null; prazo: string | null }[] }[]).map((o) => {
              const p = progressoOnboarding(o.itens ?? [], hoje);
              return (
                <li key={o.id}>
                  <Link href={`/equipe/onboarding/${o.id}`} className="block rounded-[14px] border border-borda px-4 py-3 transition hover:border-borda-forte">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <span className="flex-1 font-medium text-texto">{o.titulo}</span>
                      <span className="text-xs text-mudo">desde {formatarDataBR(o.inicio)}</span>
                      {o.status === "concluido" ? <Selo cor="verde">concluído</Selo> : o.status === "cancelado" ? <Selo>cancelado</Selo> : p.atrasados ? <Selo cor="vermelho">{p.atrasados} atrasado(s)</Selo> : <Selo cor="azul">em andamento</Selo>}
                    </div>
                    <div className="flex items-center gap-3">
                      <BarraProgresso pct={p.pct} atingida={p.pct >= 100} />
                      <span className="w-20 text-right text-sm tabular-nums text-texto-2">
                        {p.feitos}/{p.total}
                      </span>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Cartao>
    </div>
  );
}
