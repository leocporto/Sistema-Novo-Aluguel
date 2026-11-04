import type { Metadata } from "next";
import { ArrowLeftRight, ListOrdered, Plus } from "lucide-react";
import { BotaoAcao } from "@/components/botao-acao";
import { BotaoExcluir } from "@/components/botao-excluir";
import { BotaoEnviar, Formulario } from "@/components/formulario";
import { FiltroAutomatico } from "@/components/filtro-automatico";
import { JanelaCadastro } from "@/components/janela-cadastro";
import { AreaTexto, Aviso, Cabecalho, Campo, Cartao, Celula, LinhaVazia, Selecao, Selo, Tabela } from "@/components/ui";
import { formatarDataLocal, hojeISO } from "@/lib/dominio/datas";
import { TIPOS_REDISTRIBUICAO } from "@/lib/dominio/equipe";
import { exigirVerRota } from "@/lib/permissoes";
import { ROTULO_ORIGEM_LEAD } from "@/lib/tipos";
import { AbasEquipe } from "../abas";
import { alternarRegraDistribuicao, criarRegraDistribuicao, excluirRegraDistribuicao, redistribuir, salvarFila } from "../actions";
import { carregarColaboradores, carregarEstrutura, carregarMembros, contextoEquipe, nomesUsuarios, opcoesColaboradores } from "../dados";

export const metadata: Metadata = { title: "Distribuição de atendimentos" };

const FUNIS: Record<string, string> = { locacao: "Locação", venda: "Venda", captacao: "Captação (quem quer anunciar)" };

type Item = { id: string; titulo: string; detalhe: string };

export default async function DistribuicaoPage({ searchParams }: PageProps<"/equipe/distribuicao">) {
  await exigirVerRota("/equipe");
  const sp = await searchParams;
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const de = s("de");
  const tipo = s("tipo") in TIPOS_REDISTRIBUICAO ? s("tipo") : "leads";
  const hoje = hojeISO();
  const { supabase, pode, organizacao } = await contextoEquipe();
  const podeEditar = pode("equipe", "editar");
  const membros = await carregarMembros(supabase);
  const [estrutura, colaboradores, { data: regras }, { data: historico }, nomes, { data: atribuicoes }, { data: proximo }] = await Promise.all([
    carregarEstrutura(supabase),
    carregarColaboradores(supabase, membros),
    supabase.from("equipe_distribuicao_regras").select("id, funil, origem, equipe_id, filial_id, ativa, created_at").order("created_at"),
    supabase.from("equipe_distribuicoes").select("id, tipo, de_nome, para_nome, equipe_id, filial_id, quantidade, motivo, usuario_id, data").order("data", { ascending: false }).limit(50),
    nomesUsuarios(supabase),
    supabase.from("leads").select("corretor_id, atribuido_em").not("atribuido_em", "is", null).order("atribuido_em", { ascending: false }).limit(1000),
    supabase.rpc("proximo_corretor_lead"),
  ]);
  const corretores = colaboradores.filter((c) => c.papeis.includes("corretor"));
  const opcoes = opcoesColaboradores(colaboradores, hoje);
  const nomeEquipe = new Map(estrutura.equipes.map((e) => [e.id, e.nome]));
  const nomeFilial = new Map(estrutura.filiais.map((f) => [f.id, f.nome]));
  const ultimo = new Map<string, string>();
  for (const a of (atribuicoes ?? []) as { corretor_id: string | null; atribuido_em: string }[]) if (a.corretor_id && !ultimo.has(a.corretor_id)) ultimo.set(a.corretor_id, a.atribuido_em);
  const fila = corretores
    .filter((c) => c.recebe_leads && !(c.desligamento && c.desligamento <= hoje))
    .sort((a, b) => (ultimo.get(a.id) ?? "").localeCompare(ultimo.get(b.id) ?? "") || a.nome.localeCompare(b.nome, "pt-BR"));

  // Itens da carteira de quem sai (para escolher só alguns).
  let itens: Item[] = [];
  if (de) {
    if (tipo === "leads") {
      const { data } = await supabase.from("leads").select("id, nome, status, funil, created_at").eq("corretor_id", de).not("status", "in", "(ganho,perdido)").order("created_at").limit(500);
      itens = (data ?? []).map((l) => ({ id: l.id, titulo: l.nome, detalhe: `${FUNIS[l.funil as string] ?? l.funil} · desde ${formatarDataLocal(l.created_at as string)}` }));
    } else if (tipo === "captacoes") {
      const { data } = await supabase.from("captacoes").select("id, numero, proprietario_nome, status").eq("corretor_id", de).not("status", "in", "(captado,nao_captado)").order("created_at").limit(500);
      itens = (data ?? []).map((c) => ({ id: c.id, titulo: `#${c.numero} · ${c.proprietario_nome ?? "proprietário"}`, detalhe: String(c.status) }));
    } else if (tipo === "imoveis") {
      const { data } = await supabase.from("imoveis").select("id, codigo, logradouro, numero, status").eq("corretor_id", de).not("status", "in", "(inativo,vendido)").order("codigo").limit(500);
      itens = (data ?? []).map((i) => ({ id: i.id, titulo: i.codigo, detalhe: [i.logradouro, i.numero].filter(Boolean).join(", ") || String(i.status) }));
    } else if (tipo === "clientes") {
      const { data } = await supabase.from("pessoas").select("id, nome, telefone").eq("corretor_id", de).order("nome").limit(500);
      itens = (data ?? []).map((p) => ({ id: p.id, titulo: p.nome, detalhe: p.telefone ?? "" }));
    } else {
      const { data } = await supabase.from("visitas").select("id, titulo, data_hora").eq("corretor_id", de).eq("status", "agendada").gte("data_hora", new Date(`${hoje}T00:00:00-03:00`).toISOString()).order("data_hora").limit(500);
      itens = (data ?? []).map((v) => ({ id: v.id, titulo: v.titulo ?? "Visita", detalhe: formatarDataLocal(v.data_hora as string) }));
    }
  }
  const nomeDe = colaboradores.find((c) => c.id === de)?.nome;

  return (
    <>
      <Cabecalho
        titulo="Distribuição de atendimentos"
        trilha="Equipe"
        descricao="Passe a carteira de um corretor para outro (férias, saída, sobrecarga) e defina a fila de leads por equipe ou filial. Tudo fica no histórico com o motivo."
      />
      <AbasEquipe />
      <div className="space-y-6">
        {podeEditar ? (
          <Cartao titulo="Redistribuir carteira">
            <FiltroAutomatico className="mb-4 flex flex-wrap gap-2">
              <Selecao name="de" defaultValue={de} aria-label="De quem sai a carteira" className="max-w-xs">
                <option value="">De quem sai a carteira…</option>
                {opcoes.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.nome}
                  </option>
                ))}
              </Selecao>
              <Selecao name="tipo" defaultValue={tipo} aria-label="O que redistribuir" className="max-w-64">
                {Object.entries(TIPOS_REDISTRIBUICAO).map(([k, r]) => (
                  <option key={k} value={k}>
                    {r}
                  </option>
                ))}
              </Selecao>
            </FiltroAutomatico>
            {!de ? (
              <p className="text-sm text-mudo">Escolha de quem sai a carteira para ver o que ele tem.</p>
            ) : itens.length === 0 ? (
              <p className="text-sm text-mudo">
                {nomeDe} não tem {TIPOS_REDISTRIBUICAO[tipo].toLowerCase()}.
              </p>
            ) : (
              <Formulario acao={redistribuir} className="space-y-4">
                <input type="hidden" name="de" value={de} />
                <input type="hidden" name="tipo" value={tipo} />
                <div>
                  <div className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-mudo">
                    {itens.length} {TIPOS_REDISTRIBUICAO[tipo].toLowerCase()} de {nomeDe} — sem marcar nada, vão todos
                  </div>
                  <ul className="max-h-72 divide-y divide-borda-suave overflow-y-auto rounded-[14px] border border-borda">
                    {itens.map((i) => (
                      <li key={i.id}>
                        <label className="flex cursor-pointer items-center gap-3 px-4 py-2 text-sm hover:bg-card-hover">
                          <input type="checkbox" name="ids" value={i.id} className="size-4 accent-[var(--accent)]" />
                          <span className="flex-1 text-texto">{i.titulo}</span>
                          <span className="text-xs text-mudo">{i.detalhe}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Campo rotulo="Para quem vai">
                    <Selecao name="destino" required defaultValue="">
                      <option value="">Escolha…</option>
                      <optgroup label="Um colaborador">
                        {opcoes
                          .filter((o) => o.id !== de)
                          .map((o) => (
                            <option key={o.id} value={`p:${o.id}`}>
                              {o.nome}
                            </option>
                          ))}
                      </optgroup>
                      {estrutura.equipes.length > 0 && (
                        <optgroup label="Dividir no rodízio da equipe">
                          {estrutura.equipes.map((e) => (
                            <option key={e.id} value={`e:${e.id}`}>
                              Rodízio: {e.nome}
                            </option>
                          ))}
                        </optgroup>
                      )}
                      {estrutura.filiais.length > 0 && (
                        <optgroup label="Dividir no rodízio da filial">
                          {estrutura.filiais.map((f) => (
                            <option key={f.id} value={`f:${f.id}`}>
                              Rodízio: {f.nome}
                            </option>
                          ))}
                        </optgroup>
                      )}
                    </Selecao>
                  </Campo>
                  <Campo rotulo="Motivo">
                    <AreaTexto name="motivo" required rows={1} placeholder="Férias, saiu da empresa, equilibrar a carteira…" />
                  </Campo>
                </div>
                <p className="text-xs text-mudo">No rodízio, quem está com menos itens recebe primeiro. Leads e captações ganham um registro de transferência no histórico deles.</p>
                <div className="flex justify-end">
                  <BotaoEnviar confirmar="Redistribuir agora? Fica registrado no histórico com o motivo.">
                    <ArrowLeftRight className="size-4" /> Redistribuir
                  </BotaoEnviar>
                </div>
              </Formulario>
            )}
          </Cartao>
        ) : (
          <Aviso>Seu perfil de acesso não permite redistribuir. Você pode ver a fila e o histórico.</Aviso>
        )}

        <Cartao titulo="Fila de leads (rodízio)">
          <p className="mb-3 text-sm text-texto-2">
            Leads que chegam pelo site, portais, formulário e marketing entram na fila: vai para quem recebeu há mais tempo. Leads e captações cadastrados à mão com
            &quot;Rodízio automático&quot; no corretor também seguem a fila. Com regra por equipe ou filial (abaixo), só a equipe/filial da regra recebe; se ninguém dela
            puder, vale a fila geral.
          </p>
          {podeEditar ? (
            <Formulario acao={salvarFila} automatico>
              <Campo rotulo="Como os leads novos são distribuídos" className="max-w-sm">
                <Selecao name="distribuicao_leads" defaultValue={(organizacao as unknown as { distribuicao_leads?: string }).distribuicao_leads ?? "manual"}>
                  <option value="manual">Manual (alguém escolhe o corretor)</option>
                  <option value="rodizio">Rodízio automático</option>
                </Selecao>
              </Campo>
              <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-mudo">Quem participa da fila</div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {corretores.map((c) => (
                  <label key={c.id} className="flex items-center gap-2 text-sm text-texto">
                    <input type="checkbox" name="recebe" value={c.id} defaultChecked={c.recebe_leads} className="size-4 accent-[var(--accent)]" /> {c.nome}
                    {c.desligamento && c.desligamento <= hoje && <span className="text-xs text-mudo">(desligado)</span>}
                  </label>
                ))}
                {corretores.length === 0 && <span className="text-sm text-mudo">Nenhum corretor cadastrado.</span>}
              </div>
            </Formulario>
          ) : null}
          <div className="mt-4">
            <div className="mb-2 flex items-center gap-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-mudo">
              <ListOrdered className="size-3.5" /> Ordem da fila geral agora
            </div>
            {fila.length === 0 ? (
              <p className="text-sm text-mudo">Ninguém na fila.</p>
            ) : (
              <ol className="flex flex-wrap gap-2">
                {fila.map((c, i) => (
                  <li key={c.id} className={`rounded-full border px-3 py-1 text-sm ${c.id === proximo ? "border-acento-bd bg-acento-bg text-acento-hot" : "border-borda text-texto"}`}>
                    {i + 1}. {c.nome}
                    {c.id === proximo && " · próximo"}
                  </li>
                ))}
              </ol>
            )}
          </div>
        </Cartao>

        <Cartao
          titulo="Regras por equipe ou filial"
          acoes={
            podeEditar && (estrutura.equipes.length > 0 || estrutura.filiais.length > 0) ? (
              <JanelaCadastro rotuloBotao={<><Plus className="size-4" /> Nova regra</>} tamanho="sm" titulo="Nova regra de distribuição" acao={criarRegraDistribuicao} icone={<ListOrdered />} rotuloSalvar="Criar">
                <Campo rotulo="Leads de qual funil">
                  <Selecao name="funil" defaultValue="">
                    <option value="">Todos</option>
                    {Object.entries(FUNIS).map(([k, r]) => (
                      <option key={k} value={k}>
                        {r}
                      </option>
                    ))}
                  </Selecao>
                </Campo>
                <Campo rotulo="Vindos de (origem)">
                  <Selecao name="origem" defaultValue="">
                    <option value="">Qualquer origem</option>
                    {Object.entries(ROTULO_ORIGEM_LEAD).map(([k, r]) => (
                      <option key={k} value={k}>
                        {r}
                      </option>
                    ))}
                  </Selecao>
                </Campo>
                <Campo rotulo="Vão para a fila de">
                  <Selecao name="grupo" required defaultValue="">
                    <option value="">Escolha…</option>
                    {estrutura.equipes.map((e) => (
                      <option key={e.id} value={`e:${e.id}`}>
                        Equipe {e.nome}
                      </option>
                    ))}
                    {estrutura.filiais.map((f) => (
                      <option key={f.id} value={`f:${f.id}`}>
                        Filial {f.nome}
                      </option>
                    ))}
                  </Selecao>
                </Campo>
                <p className="text-xs text-mudo">
                  Vale a regra mais específica (origem e funil preenchidos ganham das gerais). Vale para os leads automáticos e para os cadastrados à mão no rodízio.
                </p>
              </JanelaCadastro>
            ) : undefined
          }
        >
          {(regras ?? []).length === 0 ? (
            <p className="text-sm text-mudo">Sem regras: todos os corretores da fila recebem qualquer lead.{estrutura.equipes.length === 0 && estrutura.filiais.length === 0 && " Crie equipes ou filiais primeiro."}</p>
          ) : (
            <ul className="divide-y divide-borda-suave">
              {((regras ?? []) as { id: string; funil: string | null; origem: string | null; equipe_id: string | null; filial_id: string | null; ativa: boolean }[]).map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
                  <span className="flex-1 text-texto">
                    Leads {r.funil ? `de ${FUNIS[r.funil]?.toLowerCase()}` : "de qualquer funil"}
                    {r.origem ? ` vindos de ${ROTULO_ORIGEM_LEAD[r.origem] ?? r.origem}` : ""} →{" "}
                    <strong>{r.equipe_id ? `equipe ${nomeEquipe.get(r.equipe_id) ?? "—"}` : `filial ${nomeFilial.get(r.filial_id ?? "") ?? "—"}`}</strong>
                  </span>
                  <Selo cor={r.ativa ? "verde" : "cinza"}>{r.ativa ? "ativa" : "pausada"}</Selo>
                  {podeEditar && (
                    <>
                      <BotaoAcao acao={alternarRegraDistribuicao} id={r.id} tamanho="sm">
                        {r.ativa ? "Pausar" : "Ativar"}
                      </BotaoAcao>
                      <BotaoExcluir acao={excluirRegraDistribuicao} id={r.id} rotulo="Excluir regra" confirmar="Excluir esta regra de distribuição?" />
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Cartao>

        <div>
          <h2 className="mb-3 text-[17px] font-semibold text-texto">Histórico de redistribuições</h2>
          <Tabela colunas={["Data", "O quê", "De", "Para", "Qtd.", "Motivo", "Quem fez"]}>
            {(historico ?? []).length === 0 && <LinhaVazia colunas={7}>Nenhuma redistribuição ainda.</LinhaVazia>}
            {(
              (historico ?? []) as { id: string; tipo: string; de_nome: string | null; para_nome: string | null; equipe_id: string | null; filial_id: string | null; quantidade: number; motivo: string | null; usuario_id: string | null; data: string }[]
            ).map((h) => (
              <tr key={h.id}>
                <Celula>{formatarDataLocal(h.data)}</Celula>
                <Celula>{TIPOS_REDISTRIBUICAO[h.tipo] ?? h.tipo}</Celula>
                <Celula>{h.de_nome ?? "—"}</Celula>
                <Celula>{h.para_nome ?? (h.equipe_id ? `rodízio da equipe ${nomeEquipe.get(h.equipe_id) ?? ""}` : h.filial_id ? `rodízio da filial ${nomeFilial.get(h.filial_id) ?? ""}` : "—")}</Celula>
                <Celula className="tabular-nums">{h.quantidade}</Celula>
                <Celula className="text-sm text-texto-2">{h.motivo ?? "—"}</Celula>
                <Celula className="text-sm">{h.usuario_id ? (nomes.get(h.usuario_id) ?? "usuário") : "—"}</Celula>
              </tr>
            ))}
          </Tabela>
        </div>
      </div>
    </>
  );
}
