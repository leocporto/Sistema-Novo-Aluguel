import type { Metadata } from "next";
import Link from "next/link";
import { BadgeCheck, FileWarning, KeyRound, Mail, UserPlus, Users } from "lucide-react";
import { Contador } from "@/components/abas-segmentadas";
import { BotaoAcao } from "@/components/botao-acao";
import { Copiar } from "@/components/copiar";
import { FiltroAutomatico } from "@/components/filtro-automatico";
import { JanelaCadastro } from "@/components/janela-cadastro";
import { LinhaLink } from "@/components/linha-link";
import { PilulasLink } from "@/components/pilulas-link";
import { Aviso, Cabecalho, Campo, Cartao, Celula, Entrada, Indicador, LinhaVazia, Selecao, Selo, Tabela } from "@/components/ui";
import { agoraMs, formatarDataBR, formatarDataLocal, hojeISO } from "@/lib/dominio/datas";
import {
  COR_PAPEL_USUARIO,
  COR_VALIDADE,
  DIAS_AVISO_CRECI,
  DIAS_AVISO_DOCUMENTO,
  DICA_PAPEL_USUARIO,
  PAPEIS_USUARIO,
  ROTULO_PAPEL_USUARIO,
  formatarCreci,
  situacaoValidade,
  textoValidade,
} from "@/lib/dominio/equipe";
import { exigirVerRota } from "@/lib/permissoes";
import { AbasEquipe } from "./abas";
import { cancelarConvite, convidarUsuario, criarFichaUsuario, novoColaborador } from "./actions";
import { CamposCreci, CamposLotacao } from "./campos";
import { carregarColaboradores, carregarEstrutura, carregarMembros, contextoEquipe, nomeDoMembro, urlBase } from "./dados";
import { numerosEquipePainel } from "./painel";

export const metadata: Metadata = { title: "Equipe" };

const FILTROS: Record<string, string> = {
  ativos: "Ativos",
  acesso: "Com acesso ao sistema",
  corretores: "Corretores",
  creci: "CRECI a renovar",
  documentos: "Documentos a renovar",
  desligados: "Desligados",
};

export default async function EquipePage({ searchParams }: PageProps<"/equipe">) {
  await exigirVerRota("/equipe");
  const sp = await searchParams;
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const filtro = s("f") in FILTROS ? s("f") : "ativos";
  const busca = s("q").trim().toLowerCase();
  const filialFiltro = s("filial");
  const equipeFiltro = s("equipe");
  const hoje = hojeISO();
  const agora = new Date(agoraMs()).toISOString();
  const { supabase, pode, papel, usuario } = await contextoEquipe();
  const podeConvidar = pode("equipe", "criar");

  const membros = await carregarMembros(supabase);
  const [colaboradores, estrutura, { data: docs }, { data: convites }, base, pend] = await Promise.all([
    carregarColaboradores(supabase, membros),
    carregarEstrutura(supabase),
    supabase.from("equipe_documentos").select("pessoa_id, validade").not("validade", "is", null).limit(5000),
    podeConvidar
      ? supabase.from("equipe_convites").select("id, email, nome, papel, token, expira_em, aceito_em, revogado_em, created_at").order("created_at", { ascending: false }).limit(60)
      : Promise.resolve({ data: [] as never[] }),
    urlBase(),
    numerosEquipePainel(supabase, hoje, usuario.id),
  ]);
  // O que está esperando por mim (os mesmos números de painel.ts, que viram quadros do Painel na integração).
  const paraMim = (
    [
      pode("aprovacoes", "aprovar") && pend.aprovacoesPendentes ? [`${pend.aprovacoesPendentes} solicitação(ões) esperando aprovação`, "/equipe/aprovacoes"] : null,
      pend.minhasTarefas ? [`${pend.minhasTarefas} tarefa(s) interna(s) suas em aberto`, "/equipe/tarefas"] : null,
      pend.mensagensNaoLidas ? [`${pend.mensagensNaoLidas} mensagem(ns) nova(s)`, "/equipe/comunicacao/mensagens"] : null,
      pend.avisosNaoLidos ? [`${pend.avisosNaoLidos} aviso(s) do mural para confirmar a leitura`, "/equipe/comunicacao"] : null,
    ] as ([string, string] | null)[]
  ).filter((x): x is [string, string] => Boolean(x));
  const membroDe = new Map(membros.filter((m) => m.pessoa_id).map((m) => [m.pessoa_id as string, m]));
  const semFicha = membros.filter((m) => !m.pessoa_id);
  const nomeFilial = new Map(estrutura.filiais.map((f) => [f.id, f.nome]));
  const nomeEquipe = new Map(estrutura.equipes.map((e) => [e.id, e.nome]));
  const docsVencendo = new Map<string, number>();
  for (const d of (docs ?? []) as { pessoa_id: string; validade: string }[]) {
    const sit = situacaoValidade(d.validade, hoje, DIAS_AVISO_DOCUMENTO).situacao;
    if (sit === "vencido" || sit === "vencendo") docsVencendo.set(d.pessoa_id, (docsVencendo.get(d.pessoa_id) ?? 0) + 1);
  }
  const desligado = (c: { desligamento: string | null }) => Boolean(c.desligamento && c.desligamento <= hoje);
  const creciDe = (c: { creci_validade: string | null }) => situacaoValidade(c.creci_validade, hoje, DIAS_AVISO_CRECI);
  const ativos = colaboradores.filter((c) => !desligado(c));

  const lista = colaboradores.filter((c) => {
    if (filtro === "desligados" ? !desligado(c) : desligado(c)) return false;
    if (filtro === "acesso" && !membroDe.has(c.id)) return false;
    if (filtro === "corretores" && !c.papeis.includes("corretor")) return false;
    if (filtro === "creci" && !["vencido", "vencendo"].includes(creciDe(c).situacao)) return false;
    if (filtro === "documentos" && !docsVencendo.has(c.id)) return false;
    if (filialFiltro && c.filial_id !== filialFiltro) return false;
    if (equipeFiltro && estrutura.equipeDe.get(c.id) !== equipeFiltro) return false;
    if (busca && !`${c.nome} ${c.email ?? ""} ${c.creci_numero ?? ""} ${c.cargo ?? ""}`.toLowerCase().includes(busca)) return false;
    return true;
  });
  const creciAlerta = ativos.filter((c) => ["vencido", "vencendo"].includes(creciDe(c).situacao)).length;
  const creciVencido = ativos.filter((c) => creciDe(c).situacao === "vencido").length;
  const pendentes = ((convites ?? []) as { aceito_em: string | null; revogado_em: string | null; expira_em: string }[]).filter((c) => !c.aceito_em && !c.revogado_em && c.expira_em > agora);
  const url = (f: string) => {
    const p = new URLSearchParams(Object.entries({ f, q: s("q"), filial: filialFiltro, equipe: equipeFiltro }).filter(([, v]) => v) as [string, string][]);
    return `/equipe?${p}`;
  };

  return (
    <>
      <Cabecalho
        titulo="Equipe"
        descricao="Colaboradores e corretores, acesso ao sistema, CRECI e documentos profissionais. Cada pessoa tem uma ficha com dados, documentos e desempenho."
        acoes={
          <>
            {podeConvidar && (
              <JanelaCadastro rotuloBotao={<><Mail className="size-4" /> Convidar usuário</>} variante="secundario" titulo="Convidar para o sistema" acao={convidarUsuario} icone={<Mail />} rotuloSalvar="Criar convite">
                <p className="text-sm text-texto-2">
                  Gera um link para a pessoa entrar no sistema. Ela cria a conta (Entrar → Criar conta) com <strong>este mesmo e-mail</strong> e abre o link. O link vale 7 dias e
                  só funciona uma vez.
                </p>
                <Campo rotulo="E-mail">
                  <Entrada name="email" type="email" required />
                </Campo>
                <Campo rotulo="Nome">
                  <Entrada name="nome" />
                </Campo>
                <Campo rotulo="Papel" dica="O papel é a base do acesso; o perfil pode ajustar o que a pessoa vê e faz.">
                  <Selecao name="papel" defaultValue="corretor">
                    {PAPEIS_USUARIO.filter((p) => papel === "admin" || p === "corretor" || p === "financeiro").map((p) => (
                      <option key={p} value={p}>
                        {ROTULO_PAPEL_USUARIO[p]} — {DICA_PAPEL_USUARIO[p]}
                      </option>
                    ))}
                  </Selecao>
                </Campo>
                {papel === "admin" && (
                  <Campo rotulo="Perfil de acesso">
                    <Selecao name="perfil_id" defaultValue="">
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
                )}
                <Campo rotulo="Ligar a um colaborador já cadastrado (opcional)">
                  <Selecao name="pessoa_id" defaultValue="">
                    <option value="">Criar a ficha quando ela aceitar</option>
                    {colaboradores
                      .filter((c) => !membroDe.has(c.id))
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.nome}
                        </option>
                      ))}
                  </Selecao>
                </Campo>
              </JanelaCadastro>
            )}
            {podeConvidar && (
              <JanelaCadastro rotuloBotao={<><UserPlus className="size-4" /> Novo colaborador</>} titulo="Novo colaborador" acao={novoColaborador} icone={<UserPlus />} larguraMax="max-w-2xl">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Campo rotulo="Nome">
                    <Entrada name="nome" required />
                  </Campo>
                  <Campo rotulo="Cargo">
                    <Entrada name="cargo" placeholder="Corretor, secretária, gerente…" />
                  </Campo>
                  <Campo rotulo="E-mail">
                    <Entrada name="email" type="email" />
                  </Campo>
                  <Campo rotulo="Telefone">
                    <Entrada name="telefone" />
                  </Campo>
                  <Campo rotulo="Admissão">
                    <Entrada name="admissao" type="date" defaultValue={hoje} />
                  </Campo>
                </div>
                <label className="flex items-center gap-2 text-sm text-texto">
                  <input type="hidden" name="corretor" value="" />
                  <input type="checkbox" name="corretor" defaultChecked /> É corretor (entra na fila de leads e nas comissões)
                </label>
                <CamposCreci />
                <CamposLotacao filiais={estrutura.filiais} equipes={estrutura.equipes} />
              </JanelaCadastro>
            )}
          </>
        }
      />
      <AbasEquipe />
      {paraMim.length > 0 && (
        <div className="mb-4">
          <Aviso>
            <span className="font-medium">Para você:</span>{" "}
            {paraMim.map(([t, href], i) => (
              <span key={href}>
                {i > 0 && " · "}
                <Link href={href} className="text-acento hover:underline">
                  {t}
                </Link>
              </span>
            ))}
          </Aviso>
        </div>
      )}
      <div className="entrar-cascata mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Indicador rotulo="Colaboradores ativos" icone={<Users />} valor={<Contador valor={ativos.length} />} detalhe={`${ativos.filter((c) => c.papeis.includes("corretor")).length} corretores`} href={url("ativos")} />
        <Indicador rotulo="Com acesso ao sistema" icone={<KeyRound />} valor={<Contador valor={membros.length} />} detalhe={pendentes.length ? `${pendentes.length} convite(s) esperando` : "usuários"} href={url("acesso")} />
        <Indicador
          rotulo="CRECI a renovar"
          icone={<BadgeCheck />}
          valor={<Contador valor={creciAlerta} />}
          detalhe={creciVencido ? `${creciVencido} vencido(s)` : `vence em até ${DIAS_AVISO_CRECI} dias`}
          tom={creciVencido ? "perigo" : creciAlerta ? "alerta" : "neutro"}
          href={url("creci")}
        />
        <Indicador
          rotulo="Documentos a renovar"
          icone={<FileWarning />}
          valor={<Contador valor={[...docsVencendo.values()].reduce((a, b) => a + b, 0)} />}
          detalhe={`vencidos ou vencendo em ${DIAS_AVISO_DOCUMENTO} dias`}
          tom={docsVencendo.size ? "alerta" : "neutro"}
          href={url("documentos")}
        />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <PilulasLink rotulo="Filtro de colaboradores" ativo={url(filtro)} itens={Object.entries(FILTROS).map(([k, r]) => ({ href: url(k), rotulo: r }))} />
        <FiltroAutomatico className="flex flex-wrap gap-2">
          <input type="hidden" name="f" value={filtro} />
          <Entrada name="q" defaultValue={s("q")} placeholder="Buscar por nome, e-mail ou CRECI" aria-label="Buscar colaborador" className="max-w-xs" />
          <Selecao name="filial" defaultValue={filialFiltro} aria-label="Filial" className="max-w-56">
            <option value="">Todas as filiais</option>
            {estrutura.filiais.map((f) => (
              <option key={f.id} value={f.id}>
                {f.nome}
              </option>
            ))}
          </Selecao>
          <Selecao name="equipe" defaultValue={equipeFiltro} aria-label="Equipe" className="max-w-56">
            <option value="">Todas as equipes</option>
            {estrutura.equipes.map((e) => (
              <option key={e.id} value={e.id}>
                {e.nome}
              </option>
            ))}
          </Selecao>
        </FiltroAutomatico>
      </div>

      <Tabela colunas={["Colaborador", "Acesso", "Equipe e filial", "CRECI", "Documentos"]}>
        {lista.length === 0 && <LinhaVazia colunas={5}>Ninguém nesta lista.</LinhaVazia>}
        {lista.map((c) => {
          const m = membroDe.get(c.id);
          const cr = creciDe(c);
          const equipe = estrutura.equipeDe.get(c.id);
          return (
            <LinhaLink key={c.id} href={`/equipe/colaboradores/${c.id}`}>
              <Celula>
                <span className="font-medium text-texto">{c.nome}</span>
                <span className="block text-xs text-mudo">
                  {[c.cargo, c.papeis.includes("corretor") ? "corretor" : null, desligado(c) ? `desligado em ${formatarDataBR(c.desligamento)}` : null].filter(Boolean).join(" · ") || "—"}
                </span>
              </Celula>
              <Celula>{m ? <Selo cor={COR_PAPEL_USUARIO[m.papel as keyof typeof COR_PAPEL_USUARIO] ?? "cinza"}>{ROTULO_PAPEL_USUARIO[m.papel] ?? m.papel}</Selo> : <span className="text-xs text-mudo">sem acesso</span>}</Celula>
              <Celula className="text-sm">
                {equipe ? nomeEquipe.get(equipe) : <span className="text-mudo">sem equipe</span>}
                {c.filial_id && <span className="block text-xs text-mudo">{nomeFilial.get(c.filial_id)}</span>}
              </Celula>
              <Celula>
                {c.creci_numero ? (
                  <>
                    <span className="text-sm">{formatarCreci(c.creci_numero, c.creci_uf)}</span>
                    <span className="mt-1 flex items-center gap-1.5">
                      <Selo cor={COR_VALIDADE[cr.situacao]}>{cr.situacao === "em_dia" ? "em dia" : cr.situacao === "sem_data" ? "sem validade" : textoValidade(cr.dias)}</Selo>
                    </span>
                  </>
                ) : (
                  <span className="text-xs text-mudo">{c.papeis.includes("corretor") ? "falta o CRECI" : "—"}</span>
                )}
              </Celula>
              <Celula>{docsVencendo.get(c.id) ? <Selo cor="amarelo">{docsVencendo.get(c.id)} a renovar</Selo> : <span className="text-xs text-mudo">ok</span>}</Celula>
            </LinhaLink>
          );
        })}
      </Tabela>

      {semFicha.length > 0 && (
        <Cartao titulo="Usuários sem ficha de colaborador" className="mt-6">
          <p className="mb-3 text-sm text-texto-2">Estes usuários entram no sistema mas ainda não têm ficha (CRECI, equipe, documentos, desempenho). Crie a ficha para acompanhar.</p>
          <ul className="divide-y divide-borda-suave">
            {semFicha.map((m) => (
              <li key={m.user_id} className="flex flex-wrap items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-texto">{nomeDoMembro(m)}</div>
                  <div className="text-xs text-mudo">{[m.email, m.cargo].filter(Boolean).join(" · ") || "—"}</div>
                </div>
                <Selo cor={COR_PAPEL_USUARIO[m.papel as keyof typeof COR_PAPEL_USUARIO] ?? "cinza"}>{ROTULO_PAPEL_USUARIO[m.papel] ?? m.papel}</Selo>
                {pode("equipe", "editar") && (
                  <BotaoAcao acao={criarFichaUsuario} id={m.user_id} tamanho="sm">
                    Criar ficha
                  </BotaoAcao>
                )}
              </li>
            ))}
          </ul>
        </Cartao>
      )}

      {podeConvidar && (convites ?? []).length > 0 && (
        <Cartao titulo="Convites" className="mt-6">
          {pendentes.length > 0 && (
            <div className="mb-3">
              <Aviso>Mande o link para a pessoa. Ela precisa criar a conta com o mesmo e-mail do convite.</Aviso>
            </div>
          )}
          <ul className="divide-y divide-borda-suave">
            {(convites as { id: string; email: string; nome: string | null; papel: string; token: string; expira_em: string; aceito_em: string | null; revogado_em: string | null; created_at: string }[]).map((c) => {
              const vencido = !c.aceito_em && !c.revogado_em && c.expira_em <= agora;
              const link = `${base}/convite/${c.token}`;
              return (
                <li key={c.id} className="flex flex-wrap items-center gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-texto">
                      {c.nome ? `${c.nome} · ` : ""}
                      {c.email}
                    </div>
                    <div className="text-xs text-mudo">
                      {ROTULO_PAPEL_USUARIO[c.papel]} · convidado em {formatarDataLocal(c.created_at)}
                      {!c.aceito_em && !c.revogado_em && !vencido && ` · vale até ${formatarDataLocal(c.expira_em)}`}
                    </div>
                  </div>
                  {c.aceito_em ? (
                    <Selo cor="verde">aceito</Selo>
                  ) : c.revogado_em ? (
                    <Selo cor="cinza">cancelado</Selo>
                  ) : vencido ? (
                    <Selo cor="vermelho">venceu</Selo>
                  ) : (
                    <>
                      <Selo cor="amarelo">esperando</Selo>
                      <Copiar texto={link} rotulo="Copiar link" />
                      <BotaoAcao acao={cancelarConvite} id={c.id} tamanho="sm" confirmar={`Cancelar o convite de ${c.email}? O link deixa de funcionar.`}>
                        Cancelar
                      </BotaoAcao>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        </Cartao>
      )}
    </>
  );
}
