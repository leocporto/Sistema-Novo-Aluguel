import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Ban, FileText, Megaphone, Play, Plus, RotateCcw, Square, UserCheck, Vote } from "lucide-react";
import { Contador } from "@/components/abas-segmentadas";
import { BarraProgresso } from "@/components/barra-progresso";
import { BotaoAcao } from "@/components/botao-acao";
import { BotaoExcluir } from "@/components/botao-excluir";
import { BotaoImprimir, Formulario } from "@/components/formulario";
import { JanelaCadastro } from "@/components/janela-cadastro";
import { AreaTexto, Aviso, Campo, Cartao, Entrada, Grade, Indicador, Selecao, Selo, classeBotao } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { diaLocal, horaLocal } from "@/lib/dominio/agenda";
import { agoraMs } from "@/lib/dominio/datas";
import { COR_STATUS_ASSEMBLEIA, PESOS_VOTO, STATUS_ASSEMBLEIA, TIPOS_ASSEMBLEIA, TIPOS_VOTACAO, apurarItem, nomeUnidade, quorum, type ItemPauta } from "@/lib/dominio/condominios";
import {
  adicionarItemPauta,
  desfazerVoto,
  excluirAssembleia,
  excluirItemPauta,
  excluirPresenca,
  gerarAta,
  gerarEdital,
  registrarPresenca,
  registrarVoto,
  salvarAssembleia,
  salvarTextoAssembleia,
  statusAssembleia,
} from "../../../actions-gestao";
import { unidadesDo } from "../../../dados";
import { todas } from "../../../../financeiro/dados";

export const metadata: Metadata = { title: "Assembleia" };

/** Assembleia: dados, convocação (edital), pauta, presença (com procuração), votação com quórum e ata para imprimir. */
export default async function AssembleiaPage({ params, searchParams }: PageProps<"/condominios/[id]/assembleias/[a]">) {
  const { id, a: aid } = await params;
  // "?v=" muda quando o edital/ata é gerado: o editor de texto recomeça com o texto novo.
  const sp = await searchParams;
  const versao = typeof sp.v === "string" ? sp.v : "0";
  const { supabase } = await obterContexto();
  // Presença e votos podem passar de 1.000 linhas (300 unidades × 4 itens): busca tudo, de 1.000 em 1.000.
  const [{ data: a }, { data: itensD }, presencas, votos, unidades] = await Promise.all([
    supabase.from("cond_assembleias").select("*").eq("id", aid).eq("condominio_id", id).maybeSingle(),
    supabase.from("cond_assembleia_itens").select("id, ordem, titulo, descricao, tipo_votacao, opcoes, resultado").eq("assembleia_id", aid).order("ordem"),
    todas<{ id: string; unidade_id: string; nome: string | null; procuracao: boolean; procurador_nome: string | null; origem: string; pessoa: { nome: string } | null }>(() =>
      supabase.from("cond_assembleia_presencas").select("id, unidade_id, nome, procuracao, procurador_nome, origem, pessoa:pessoas(nome)").eq("assembleia_id", aid).order("id"),
    ),
    todas<{ id: string; item_id: string; unidade_id: string; opcao: string; peso: number; origem: string }>(() =>
      supabase.from("cond_votos").select("id, item_id, unidade_id, opcao, peso, origem").eq("assembleia_id", aid).order("id"),
    ),
    unidadesDo(supabase, id),
  ]);
  if (!a) notFound();
  const itens = (itensD ?? []) as (ItemPauta & { resultado: string | null })[];
  const peso = a.voto_peso as "fracao" | "unidade";
  const q = quorum(
    unidades.map((u) => ({ id: u.id, fracao: Number(u.fracao_ideal) })),
    presencas.map((p) => p.unidade_id),
    peso,
  );
  const nomeU = new Map(unidades.map((u) => [u.id, nomeUnidade(u)]));
  const status = a.status as string;
  const aberta = !["encerrada", "cancelada"].includes(status);
  const votando = status === "em_andamento";
  const semPresenca = unidades.filter((u) => !presencas.some((p) => p.unidade_id === u.id));
  const base = `/condominios/${id}/assembleias`;

  return (
    <div className="space-y-5">
      <div className="nao-imprimir flex flex-wrap items-center justify-between gap-2">
        <Link href={base} className={classeBotao("fantasma")}>
          <ArrowLeft className="size-4" /> Assembleias
        </Link>
        <div className="flex flex-wrap gap-2">
          {status === "rascunho" && (
            <BotaoAcao acao={statusAssembleia} id={`${aid}|convocada`} variante="primario" confirmar="Marcar como convocada? (o edital aparece no portal do condômino)">
              <Megaphone className="size-4" /> Convocar
            </BotaoAcao>
          )}
          {status === "convocada" && (
            <BotaoAcao acao={statusAssembleia} id={`${aid}|em_andamento`} variante="primario" confirmar="Abrir a assembleia e a votação agora?">
              <Play className="size-4" /> Abrir votação
            </BotaoAcao>
          )}
          {votando && (
            <BotaoAcao acao={statusAssembleia} id={`${aid}|encerrada`} variante="primario" confirmar="Encerrar a assembleia? Presença e votos não mudam mais (só a ata).">
              <Square className="size-4" /> Encerrar
            </BotaoAcao>
          )}
          {["convocada", "em_andamento"].includes(status) && (
            <BotaoAcao acao={statusAssembleia} id={`${aid}|rascunho`} confirmar="Voltar para rascunho?">
              <RotateCcw className="size-4" /> Rascunho
            </BotaoAcao>
          )}
          {aberta && (
            <BotaoAcao acao={statusAssembleia} id={`${aid}|cancelada`} variante="fantasma" confirmar="Cancelar esta assembleia?">
              <Ban className="size-4" /> Cancelar
            </BotaoAcao>
          )}
          {status !== "encerrada" && <BotaoExcluir acao={excluirAssembleia} id={aid} variante="botao" rotulo="Excluir" confirmar="Excluir esta assembleia (pauta, presença e votos saem junto)?" depois={base} />}
          <BotaoImprimir />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-[20px] font-semibold text-texto">{a.titulo as string}</h2>
        <Selo cor={COR_STATUS_ASSEMBLEIA[status] ?? "cinza"}>{STATUS_ASSEMBLEIA[status as keyof typeof STATUS_ASSEMBLEIA]}</Selo>
        <span className="text-sm text-texto-2">
          {formatarDataBRLocal(a.data as string)} · {TIPOS_ASSEMBLEIA[a.tipo as keyof typeof TIPOS_ASSEMBLEIA]} · voto {PESOS_VOTO[peso].toLowerCase()}
        </span>
      </div>

      <div className="entrar-cascata grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Indicador rotulo="Unidades presentes" icone={<UserCheck />} valor={<Contador valor={q.presentes} />} detalhe={`de ${q.unidades} (${q.pctUnidades.toLocaleString("pt-BR")}%)`} />
        <Indicador rotulo="Quórum pela fração" icone={<UserCheck />} valor={<Contador valor={q.pctPeso} formato="pct" />} detalhe={peso === "fracao" ? "das frações ideais presentes" : "um voto por unidade"} />
        <Indicador rotulo="Itens na pauta" icone={<FileText />} valor={<Contador valor={itens.length} />} detalhe={`${itens.filter((i) => i.tipo_votacao !== "informativo").length} com votação`} />
        <Indicador rotulo="Votos" icone={<Vote />} valor={<Contador valor={votos.length} />} detalhe={`${votos.filter((v) => v.origem === "portal").length} pelo portal`} />
      </div>

      <Cartao titulo="Dados da assembleia">
        <Formulario acao={salvarAssembleia} automatico>
          <input type="hidden" name="id" value={aid} />
          <input type="hidden" name="condominio_id" value={id} />
          <Grade colunas={3}>
            <Campo rotulo="Título">
              <Entrada name="titulo" required defaultValue={a.titulo as string} />
            </Campo>
            <Campo rotulo="Tipo">
              <Selecao name="tipo" defaultValue={a.tipo as string}>
                {Object.entries(TIPOS_ASSEMBLEIA).map(([k, r]) => (
                  <option key={k} value={k}>
                    {r}
                  </option>
                ))}
              </Selecao>
            </Campo>
            <Campo rotulo="Peso do voto">
              <Selecao name="voto_peso" defaultValue={peso}>
                {Object.entries(PESOS_VOTO).map(([k, r]) => (
                  <option key={k} value={k}>
                    {r}
                  </option>
                ))}
              </Selecao>
            </Campo>
            <Campo rotulo="Dia">
              <Entrada name="data" type="date" required defaultValue={diaLocal(a.data as string)} />
            </Campo>
            <Campo rotulo="Hora">
              <Entrada name="hora" type="time" defaultValue={horaLocal(a.data as string)} />
            </Campo>
            <Campo rotulo="Local">
              <Entrada name="local" defaultValue={(a.local as string | null) ?? ""} />
            </Campo>
            <Campo rotulo="2ª chamada (dia)">
              <Entrada name="segunda_data" type="date" defaultValue={a.segunda_chamada ? diaLocal(a.segunda_chamada as string) : ""} />
            </Campo>
            <Campo rotulo="2ª chamada (hora)">
              <Entrada name="segunda_hora" type="time" defaultValue={a.segunda_chamada ? horaLocal(a.segunda_chamada as string) : ""} />
            </Campo>
            <Campo rotulo="Link online">
              <Entrada name="link_online" defaultValue={(a.link_online as string | null) ?? ""} placeholder="https://…" />
            </Campo>
          </Grade>
          <label className="flex items-center gap-2 text-sm text-texto-2">
            <input type="hidden" name="voto_portal" value="off" />
            <input type="checkbox" name="voto_portal" defaultChecked={Boolean(a.voto_portal)} className="size-4 accent-[var(--accent)]" /> Aceitar voto pelo portal do condômino (só com a votação aberta, uma vez por unidade)
          </label>
        </Formulario>
      </Cartao>

      <Cartao
        titulo="Pauta e votação"
        acoes={
          aberta && (
            <JanelaCadastro rotuloBotao={<><Plus className="size-4" /> Item</>} variante="secundario" tamanho="sm" titulo="Item da pauta" acao={adicionarItemPauta}>
              <input type="hidden" name="condominio_id" value={id} />
              <input type="hidden" name="assembleia_id" value={aid} />
              <Grade colunas={2}>
                <Campo rotulo="Ordem">
                  <Entrada name="ordem" type="number" min={1} defaultValue={itens.length + 1} />
                </Campo>
                <Campo rotulo="Como vota">
                  <Selecao name="tipo_votacao" defaultValue="simples">
                    {Object.entries(TIPOS_VOTACAO).map(([k, r]) => (
                      <option key={k} value={k}>
                        {r}
                      </option>
                    ))}
                  </Selecao>
                </Campo>
              </Grade>
              <Campo rotulo="Item">
                <Entrada name="titulo" required placeholder="Ex.: Aprovação das contas de 2026" />
              </Campo>
              <Campo rotulo="Detalhes">
                <AreaTexto name="descricao" rows={2} />
              </Campo>
              <Campo rotulo="Opções de voto" dica="Separadas por vírgula. Ex.: Empresa A, Empresa B">
                <Entrada name="opcoes" defaultValue="Sim, Não, Abstenção" />
              </Campo>
            </JanelaCadastro>
          )
        }
      >
        {itens.length === 0 && <p className="text-sm text-mudo">Monte a pauta (ordem do dia) antes de convocar.</p>}
        <div className="space-y-4">
          {itens.map((it) => {
            const vs = votos.filter((v) => v.item_id === it.id);
            const ap = apurarItem(it, vs.map((v) => ({ opcao: v.opcao, peso: Number(v.peso) })), q.pesoTotal);
            const faltam = unidades.filter((u) => !vs.some((v) => v.unidade_id === u.id));
            return (
              <div key={it.id} className="rounded-[14px] border border-borda bg-elev p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="font-medium text-texto">
                      {it.ordem}. {it.titulo}
                    </div>
                    {it.descricao && <p className="text-sm text-texto-2">{it.descricao}</p>}
                    <span className="text-xs text-mudo">{TIPOS_VOTACAO[it.tipo_votacao]}</span>
                  </div>
                  <span className="flex items-center gap-2">
                    {it.tipo_votacao !== "informativo" && vs.length > 0 && <Selo cor={ap.aprovado === true ? "verde" : ap.aprovado === false ? "vermelho" : "azul"}>{ap.texto}</Selo>}
                    {aberta && vs.length === 0 && <BotaoExcluir acao={excluirItemPauta} id={it.id} rotulo="Tirar da pauta" confirmar={`Tirar "${it.titulo}" da pauta?`} />}
                  </span>
                </div>
                {it.tipo_votacao !== "informativo" && (
                  <div className="mt-3 space-y-2">
                    {ap.totais.map((t) => (
                      <div key={t.opcao} className="grid grid-cols-[120px_1fr_150px] items-center gap-3 text-sm">
                        <span className="text-texto">{t.opcao}</span>
                        <BarraProgresso pct={t.pct} atingida={ap.vencedora === t.opcao} />
                        <span className="text-right tabular-nums text-texto-2">
                          {t.votos} voto(s) · {t.pct.toLocaleString("pt-BR")}%
                        </span>
                      </div>
                    ))}
                    {votando && faltam.length > 0 && (
                      <Formulario acao={registrarVoto} className="mt-3 flex flex-wrap items-end gap-2">
                        <input type="hidden" name="condominio_id" value={id} />
                        <input type="hidden" name="item_id" value={it.id} />
                        <Selecao name="unidade_id" required defaultValue="" aria-label="Unidade que vota" className="max-w-56">
                          <option value="" disabled>
                            Unidade…
                          </option>
                          {faltam.map((u) => (
                            <option key={u.id} value={u.id}>
                              {nomeUnidade(u)}
                            </option>
                          ))}
                        </Selecao>
                        <Selecao name="opcao" required defaultValue="" aria-label="Voto" className="max-w-48">
                          <option value="" disabled>
                            Voto…
                          </option>
                          {it.opcoes.map((o) => (
                            <option key={o} value={o}>
                              {o}
                            </option>
                          ))}
                        </Selecao>
                        <button type="submit" className={classeBotao("primario")}>
                          <Vote className="size-4" /> Registrar voto
                        </button>
                      </Formulario>
                    )}
                    {vs.length > 0 && (
                      <details className="text-sm">
                        <summary className="cursor-pointer text-acento">Ver os {vs.length} voto(s)</summary>
                        <ul className="mt-2 flex flex-wrap gap-2">
                          {vs.map((v) => (
                            <li key={v.id} className="inline-flex items-center gap-1 rounded-full border border-borda bg-card py-0.5 pl-3 pr-1 text-xs">
                              {nomeU.get(v.unidade_id)}: <b>{v.opcao}</b> {v.origem === "portal" ? "(portal)" : ""}
                              {votando && v.origem !== "portal" && <BotaoExcluir acao={desfazerVoto} id={v.id} rotulo="Desfazer voto" confirmar="Desfazer este voto?" />}
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {!votando && aberta && itens.some((i) => i.tipo_votacao !== "informativo") && <p className="mt-3 text-xs text-mudo">A votação abre com o botão “Abrir votação”.</p>}
      </Cartao>

      <Cartao
        titulo={`Lista de presença (${presencas.length})`}
        acoes={
          aberta &&
          semPresenca.length > 0 && (
            <JanelaCadastro rotuloBotao={<><UserCheck className="size-4" /> Presença</>} variante="secundario" tamanho="sm" titulo="Registrar presença" acao={registrarPresenca} icone={<UserCheck />}>
              <input type="hidden" name="condominio_id" value={id} />
              <input type="hidden" name="assembleia_id" value={aid} />
              <Campo rotulo="Unidade">
                <Selecao name="unidade_id" required defaultValue="">
                  <option value="" disabled>
                    Escolha…
                  </option>
                  {semPresenca.map((u) => (
                    <option key={u.id} value={u.id}>
                      {nomeUnidade(u)}
                    </option>
                  ))}
                </Selecao>
              </Campo>
              <Campo rotulo="Quem assinou">
                <Entrada name="nome" />
              </Campo>
              <Campo rotulo="Representada por procuração? Nome do procurador">
                <Entrada name="procurador_nome" placeholder="Deixe vazio se o próprio condômino veio" />
              </Campo>
            </JanelaCadastro>
          )
        }
      >
        {presencas.length === 0 ? (
          <p className="text-sm text-mudo">Ninguém na lista ainda. Quem vota já entra na lista sozinho.</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {[...presencas]
              .sort((x, y) => (nomeU.get(x.unidade_id) ?? "").localeCompare(nomeU.get(y.unidade_id) ?? "", "pt-BR", { numeric: true }))
              .map((p) => (
                <li key={p.id} className="inline-flex items-center gap-2 rounded-full border border-borda bg-elev py-1 pl-3 pr-1 text-sm">
                  <b>{nomeU.get(p.unidade_id)}</b>
                  <span className="text-texto-2">{p.procuracao ? `procurador: ${p.procurador_nome}` : (p.nome ?? p.pessoa?.nome ?? (p.origem === "portal" ? "pelo portal" : ""))}</span>
                  {aberta && <BotaoExcluir acao={excluirPresenca} id={p.id} rotulo="Tirar da lista" confirmar="Tirar esta unidade da lista de presença?" />}
                </li>
              ))}
          </ul>
        )}
      </Cartao>

      <Cartao
        titulo="Edital de convocação"
        acoes={
          <BotaoAcao acao={gerarEdital} id={aid} tamanho="sm" depois={`${base}/${aid}?v=${agoraMs()}`} confirmar={a.edital ? "Refazer o edital a partir da pauta? O texto atual será trocado." : undefined}>
            <FileText className="size-3.5" /> Gerar pela pauta
          </BotaoAcao>
        }
      >
        <EditorTexto key={`edital-${versao}`} id={aid} condominioId={id} campo="edital" valor={(a.edital as string | null) ?? ""} />
      </Cartao>

      <Cartao
        titulo="Ata"
        acoes={
          <BotaoAcao acao={gerarAta} id={aid} tamanho="sm" depois={`${base}/${aid}?v=${agoraMs()}`} confirmar={a.ata ? "Refazer a ata com a presença e os votos? O texto atual será trocado." : undefined}>
            <FileText className="size-3.5" /> Gerar com os resultados
          </BotaoAcao>
        }
      >
        {status !== "encerrada" && <Aviso>A ata aparece no portal do condômino depois que a assembleia é encerrada.</Aviso>}
        <EditorTexto key={`ata-${versao}`} id={aid} condominioId={id} campo="ata" valor={(a.ata as string | null) ?? ""} />
      </Cartao>
    </div>
  );
}

function formatarDataBRLocal(iso: string) {
  const d = diaLocal(iso);
  return `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)} às ${horaLocal(iso)}`;
}

/** Texto longo (edital/ata) que salva sozinho. */
function EditorTexto({ id, condominioId, campo, valor }: { id: string; condominioId: string; campo: "edital" | "ata"; valor: string }) {
  return (
    <Formulario acao={salvarTextoAssembleia} automatico>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="condominio_id" value={condominioId} />
      <input type="hidden" name="campo" value={campo} />
      <AreaTexto name="texto" rows={14} defaultValue={valor} aria-label={campo === "edital" ? "Texto do edital" : "Texto da ata"} className="font-mono text-[13px]" />
    </Formulario>
  );
}
