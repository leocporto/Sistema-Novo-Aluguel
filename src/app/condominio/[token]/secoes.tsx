import Link from "next/link";
import { CalendarCheck, CheckCircle2, ExternalLink, Vote, XCircle } from "lucide-react";
import { BotaoAcao } from "@/components/botao-acao";
import { BotaoEnviar, Formulario } from "@/components/formulario";
import { PilulasLink } from "@/components/pilulas-link";
import { Aviso, AreaTexto, Campo, Cartao, Celula, Entrada, Grade, LinhaVazia, Selecao, Selo, Tabela, classeBotao } from "@/components/ui";
import { diaLocal, horaLocal } from "@/lib/dominio/agenda";
import {
  COR_STATUS_ASSEMBLEIA,
  COR_STATUS_COTA,
  COR_STATUS_OCORRENCIA,
  COR_STATUS_RESERVA,
  STATUS_ASSEMBLEIA,
  STATUS_COTA,
  STATUS_OCORRENCIA,
  STATUS_RESERVA,
  TIPOS_ASSEMBLEIA,
  TIPOS_DOCUMENTO_COND,
  TIPOS_OCORRENCIA,
  TIPOS_VOTACAO,
  totalHoje,
} from "@/lib/dominio/condominios";
import { formatarCompetencia, formatarDataBR, formatarDataLocal, hojeISO, somarDias } from "@/lib/dominio/datas";
import { formatarReais } from "@/lib/dominio/dinheiro";
import { cancelarReservaPortal, lerComunicado, reservarArea, responderOcorrenciaPortal, votarPortal } from "./actions";
import { FormOcorrenciaPortal } from "./formularios";

export type CotaPortal = {
  id: string;
  numero: number;
  tipo: string;
  competencia: string;
  vencimento: string;
  valor: number;
  valor_abatido: number;
  status: string;
  pago_em: string | null;
  unidade: string;
  saldo: number;
  multa: number;
  juros: number;
  dias: number;
  itens: { descricao: string; valor: number; tipo: string }[];
  pagamentos: { data: string; valor: number }[];
};

export function SecaoCotas({ token, cotas }: { token: string; cotas: CotaPortal[] }) {
  return (
    <Tabela colunas={["Competência", "Unidade", "Vencimento", "Valor", "Situação", ""]}>
      {cotas.map((c) => (
        <tr key={c.id}>
          <Celula>{formatarCompetencia(c.competencia)}</Celula>
          <Celula className="text-sm text-texto-2">{c.unidade}</Celula>
          <Celula className="text-sm">
            {formatarDataBR(c.vencimento)}
            {c.status === "aberta" && c.dias > 0 && <span className="block text-xs font-semibold text-ruim">{c.dias} dia(s) de atraso</span>}
          </Celula>
          <Celula className="tabular-nums">
            {formatarReais(c.valor)}
            {c.status === "aberta" && Number(c.saldo) < Number(c.valor) && <span className="block text-xs text-mudo">falta {formatarReais(c.saldo)}</span>}
          </Celula>
          <Celula>
            <Selo cor={COR_STATUS_COTA[c.status] ?? "cinza"}>{c.status === "paga" ? `paga em ${formatarDataBR(c.pago_em)}` : (STATUS_COTA[c.status as keyof typeof STATUS_COTA] ?? c.status)}</Selo>
          </Celula>
          <Celula>
            <Link href={`/condominio/${token}/cotas/${c.id}`} className={classeBotao(c.status === "aberta" ? "primario" : "secundario", "sm")}>
              {c.status === "aberta" ? `Pagar ${formatarReais(totalHoje(c))}` : "Ver"}
            </Link>
          </Celula>
        </tr>
      ))}
      {cotas.length === 0 && <LinhaVazia colunas={6}>Nenhuma cota para mostrar.</LinhaVazia>}
    </Tabela>
  );
}

export function SecaoComunicados({ token, lista }: { token: string; lista: { id: string; titulo: string; texto: string; publicado_em: string; fixado: boolean; lido: boolean }[] }) {
  if (lista.length === 0) return <Cartao><p className="text-sm text-mudo">Nenhum comunicado no mural.</p></Cartao>;
  return (
    <div className="space-y-3">
      {lista.map((c) => (
        <Cartao
          key={c.id}
          titulo={
            <span className="flex flex-wrap items-center gap-2">
              {c.titulo} {c.fixado && <Selo cor="azul">fixado</Selo>} {!c.lido && <Selo cor="amarelo">novo</Selo>}
            </span>
          }
        >
          <p className="whitespace-pre-line text-sm text-texto">{c.texto}</p>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-mudo">
            <span>Publicado em {formatarDataLocal(c.publicado_em)}</span>
            {c.lido ? (
              <span className="flex items-center gap-1 text-ok">
                <CheckCircle2 className="size-3.5" /> lido
              </span>
            ) : (
              <BotaoAcao acao={lerComunicado} id={`${token}|${c.id}`} tamanho="sm">
                <CheckCircle2 className="size-3.5" /> Confirmar que li
              </BotaoAcao>
            )}
          </div>
        </Cartao>
      ))}
    </div>
  );
}

type Reservas = {
  unidades: { id: string; nome: string }[];
  areas: { id: string; nome: string; regras: string | null; capacidade: number | null; taxa: number; antecedencia_min_horas: number; antecedencia_max_dias: number; duracao_max_horas: number; ocupado: { inicio: string; fim: string }[] }[];
  minhas: { id: string; area: string; unidade: string; inicio: string; fim: string; status: string; taxa: number | null; resposta: string | null }[];
};

export function SecaoReservas({ token, d, agoraIso }: { token: string; d: Reservas; agoraIso: string }) {
  const hoje = hojeISO();
  return (
    <div className="space-y-5">
      <Tabela colunas={["Quando", "Área", "Unidade", "Taxa", "Situação", ""]}>
        {d.minhas.map((r) => (
          <tr key={r.id}>
            <Celula className="text-sm">
              {formatarDataBR(diaLocal(r.inicio))}
              <span className="block text-xs text-mudo">
                {horaLocal(r.inicio)} às {horaLocal(r.fim)}
              </span>
            </Celula>
            <Celula>{r.area}</Celula>
            <Celula className="text-sm text-texto-2">{r.unidade}</Celula>
            <Celula className="tabular-nums text-sm">{r.taxa ? formatarReais(r.taxa) : "—"}</Celula>
            <Celula>
              <Selo cor={COR_STATUS_RESERVA[r.status] ?? "cinza"}>{STATUS_RESERVA[r.status as keyof typeof STATUS_RESERVA] ?? r.status}</Selo>
              {r.resposta && <span className="block text-xs text-mudo">{r.resposta}</span>}
            </Celula>
            <Celula>
              {["pedida", "confirmada"].includes(r.status) && r.inicio > agoraIso && (
                <BotaoAcao acao={cancelarReservaPortal} id={`${token}|${r.id}`} tamanho="sm" variante="fantasma" confirmar="Cancelar esta reserva?">
                  <XCircle className="size-3.5" /> Cancelar
                </BotaoAcao>
              )}
            </Celula>
          </tr>
        ))}
        {d.minhas.length === 0 && <LinhaVazia colunas={6}>Você não tem reservas.</LinhaVazia>}
      </Tabela>
      {d.areas.length === 0 ? (
        <Aviso>O condomínio ainda não abriu áreas para reserva pelo portal.</Aviso>
      ) : (
        <Cartao titulo="Pedir reserva">
          <Formulario acao={reservarArea} className="space-y-4">
            <input type="hidden" name="token" value={token} />
            <Grade colunas={3}>
              <Campo rotulo="Área">
                <Selecao name="area_id" defaultValue={d.areas[0].id}>
                  {d.areas.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.nome}
                      {Number(a.taxa) > 0 ? ` (taxa ${formatarReais(a.taxa)})` : ""}
                    </option>
                  ))}
                </Selecao>
              </Campo>
              <Campo rotulo="Unidade">
                <Selecao name="unidade_id" defaultValue={d.unidades[0]?.id}>
                  {d.unidades.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.nome}
                    </option>
                  ))}
                </Selecao>
              </Campo>
              <Campo rotulo="Dia">
                <Entrada name="dia" type="date" required min={hoje} defaultValue={somarDias(hoje, 7)} />
              </Campo>
              <Campo rotulo="Das">
                <Entrada name="hora_inicio" type="time" required defaultValue="18:00" />
              </Campo>
              <Campo rotulo="Até">
                <Entrada name="hora_fim" type="time" required defaultValue="23:00" />
              </Campo>
              <Campo rotulo="Observação">
                <Entrada name="observacao" maxLength={500} />
              </Campo>
            </Grade>
            <BotaoEnviar>
              <CalendarCheck className="size-4" /> Pedir reserva
            </BotaoEnviar>
          </Formulario>
          <div className="mt-5 space-y-3">
            {d.areas.map((a) => (
              <div key={a.id} className="rounded-[14px] border border-borda bg-elev p-3 text-sm">
                <div className="font-medium text-texto">{a.nome}</div>
                <div className="text-xs text-mudo">
                  Peça com {a.antecedencia_min_horas}h de antecedência, até {a.antecedencia_max_dias} dias à frente; no máximo {a.duracao_max_horas}h
                  {a.capacidade ? ` · até ${a.capacidade} pessoas` : ""}
                  {Number(a.taxa) > 0 ? ` · taxa ${formatarReais(a.taxa)} na cota do mês seguinte` : ""}
                </div>
                {a.regras && <p className="mt-1 whitespace-pre-line text-texto-2">{a.regras}</p>}
                {a.ocupado.length > 0 && (
                  <p className="mt-1 text-xs text-texto-2">
                    Já reservado: {a.ocupado.slice(0, 12).map((o) => `${formatarDataBR(diaLocal(o.inicio))} ${horaLocal(o.inicio)}–${horaLocal(o.fim)}`).join(" · ")}
                  </p>
                )}
              </div>
            ))}
          </div>
        </Cartao>
      )}
    </div>
  );
}

type Ocorrencias = {
  unidades: { id: string; nome: string }[];
  lista: { id: string; numero: number; tipo: string; titulo: string; descricao: string | null; status: string; criado_em: string; unidade: string | null; fotos: number; respostas: { autor: string; texto: string; data: string }[] }[];
};

export function SecaoOcorrencias({ token, d }: { token: string; d: Ocorrencias }) {
  return (
    <div className="space-y-5">
      <Cartao titulo="Registrar ocorrência ou sugestão">
        <FormOcorrenciaPortal token={token} unidades={d.unidades} />
      </Cartao>
      {d.lista.map((o) => (
        <Cartao
          key={o.id}
          titulo={
            <span className="flex flex-wrap items-center gap-2">
              #{o.numero} · {o.titulo}
              <Selo cor={COR_STATUS_OCORRENCIA[o.status] ?? "cinza"}>{STATUS_OCORRENCIA[o.status as keyof typeof STATUS_OCORRENCIA] ?? o.status}</Selo>
            </span>
          }
        >
          <p className="text-xs text-mudo">
            {TIPOS_OCORRENCIA[o.tipo as keyof typeof TIPOS_OCORRENCIA] ?? o.tipo} · {o.unidade ?? "área comum"} · {formatarDataLocal(o.criado_em)}
            {o.fotos ? ` · ${o.fotos} foto(s)` : ""}
          </p>
          {o.descricao && <p className="mt-2 whitespace-pre-line text-sm text-texto">{o.descricao}</p>}
          {o.respostas.length > 0 && (
            <ul className="mt-3 space-y-2">
              {o.respostas.map((r, i) => (
                <li key={i} className={`rounded-[12px] border px-3 py-2 text-sm ${r.autor === "equipe" ? "border-acento-bd bg-acento-bg" : "border-borda bg-elev"}`}>
                  <span className="block text-xs text-mudo">
                    {r.autor === "equipe" ? "Administradora" : "Você"} · {formatarDataLocal(r.data)}
                  </span>
                  {r.texto}
                </li>
              ))}
            </ul>
          )}
          {o.status !== "cancelada" && (
            <Formulario acao={responderOcorrenciaPortal} className="mt-3 space-y-2">
              <input type="hidden" name="token" value={token} />
              <input type="hidden" name="ocorrencia_id" value={o.id} />
              <AreaTexto name="texto" required rows={2} maxLength={2000} aria-label="Mensagem para a administradora" placeholder="Escreva para a administradora…" />
              <BotaoEnviar variante="secundario">Enviar mensagem</BotaoEnviar>
            </Formulario>
          )}
        </Cartao>
      ))}
    </div>
  );
}

type Assembleia = {
  id: string;
  tipo: string;
  titulo: string;
  data: string;
  segunda_chamada: string | null;
  local: string | null;
  link_online: string | null;
  status: string;
  voto_portal: boolean;
  edital: string | null;
  ata: string | null;
  itens: { id: string; ordem: number; titulo: string; descricao: string | null; tipo_votacao: string; opcoes: string[]; resultado: string | null; meus_votos: { unidade_id: string; opcao: string }[] }[];
  unidades_voto: { id: string; nome: string }[];
};

export function SecaoAssembleias({ token, lista }: { token: string; lista: Assembleia[] }) {
  if (lista.length === 0) return <Cartao><p className="text-sm text-mudo">Nenhuma assembleia convocada.</p></Cartao>;
  return (
    <div className="space-y-4">
      {lista.map((a) => {
        const votando = a.status === "em_andamento" && a.voto_portal && a.unidades_voto.length > 0;
        return (
          <Cartao
            key={a.id}
            titulo={
              <span className="flex flex-wrap items-center gap-2">
                {a.titulo}
                <Selo cor={COR_STATUS_ASSEMBLEIA[a.status] ?? "cinza"}>{STATUS_ASSEMBLEIA[a.status as keyof typeof STATUS_ASSEMBLEIA] ?? a.status}</Selo>
              </span>
            }
          >
            <p className="text-sm text-texto-2">
              {TIPOS_ASSEMBLEIA[a.tipo as keyof typeof TIPOS_ASSEMBLEIA]} · {formatarDataBR(diaLocal(a.data))} às {horaLocal(a.data)}
              {a.local ? ` · ${a.local}` : ""}
            </p>
            {a.link_online && a.status !== "encerrada" && (
              <a href={a.link_online} target="_blank" rel="noreferrer" className={`mt-2 ${classeBotao("secundario", "sm")}`}>
                <ExternalLink className="size-3.5" /> Entrar na reunião online
              </a>
            )}
            <ol className="mt-3 space-y-3">
              {a.itens.map((it) => (
                <li key={it.id} className="rounded-[12px] border border-borda bg-elev p-3 text-sm">
                  <div className="font-medium text-texto">
                    {it.ordem}. {it.titulo}
                  </div>
                  {it.descricao && <p className="text-texto-2">{it.descricao}</p>}
                  {it.resultado && <p className="mt-1 text-xs font-semibold text-acento">Resultado: {it.resultado}</p>}
                  {it.meus_votos.length > 0 && (
                    <p className="mt-1 text-xs text-ok">
                      Seu voto: {it.meus_votos.map((v) => `${a.unidades_voto.find((u) => u.id === v.unidade_id)?.nome ?? "unidade"}: ${v.opcao}`).join(" · ")}
                    </p>
                  )}
                  {votando && it.tipo_votacao !== "informativo" && it.meus_votos.length < a.unidades_voto.length && (
                    <Formulario acao={votarPortal} className="mt-2 flex flex-wrap items-end gap-2">
                      <input type="hidden" name="token" value={token} />
                      <input type="hidden" name="item_id" value={it.id} />
                      <Selecao name="unidade_id" aria-label="Unidade" className="max-w-48">
                        {a.unidades_voto
                          .filter((u) => !it.meus_votos.some((v) => v.unidade_id === u.id))
                          .map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.nome}
                            </option>
                          ))}
                      </Selecao>
                      <Selecao name="opcao" required defaultValue="" aria-label="Seu voto" className="max-w-48">
                        <option value="" disabled>
                          Seu voto…
                        </option>
                        {it.opcoes.map((o) => (
                          <option key={o} value={o}>
                            {o}
                          </option>
                        ))}
                      </Selecao>
                      <BotaoEnviar confirmar="Confirmar o voto? Ele não pode ser mudado depois.">
                        <Vote className="size-4" /> Votar
                      </BotaoEnviar>
                    </Formulario>
                  )}
                  {it.tipo_votacao !== "informativo" && <span className="mt-1 block text-[11px] text-mudo">{TIPOS_VOTACAO[it.tipo_votacao as keyof typeof TIPOS_VOTACAO]}</span>}
                </li>
              ))}
            </ol>
            {a.status === "em_andamento" && a.voto_portal && a.unidades_voto.length === 0 && <p className="mt-2 text-xs text-mudo">Pelo portal vota só o condômino (proprietário) da unidade.</p>}
            {a.edital && (
              <details className="mt-3 text-sm">
                <summary className="cursor-pointer text-acento">Edital de convocação</summary>
                <pre className="mt-2 whitespace-pre-wrap font-sans text-texto-2">{a.edital}</pre>
              </details>
            )}
            {a.ata && (
              <details className="mt-3 text-sm">
                <summary className="cursor-pointer text-acento">Ata</summary>
                <pre className="mt-2 whitespace-pre-wrap font-sans text-texto-2">{a.ata}</pre>
              </details>
            )}
          </Cartao>
        );
      })}
    </div>
  );
}

export function SecaoDocumentos({ lista }: { lista: { id: string; tipo: string; titulo: string; url: string; expira_em: string; validade: string | null }[] }) {
  return (
    <Tabela colunas={["Documento", "Tipo", "Validade", ""]}>
      {lista.map((d) => (
        <tr key={d.id}>
          <Celula className="font-medium">{d.titulo}</Celula>
          <Celula className="text-sm text-texto-2">{TIPOS_DOCUMENTO_COND[d.tipo as keyof typeof TIPOS_DOCUMENTO_COND] ?? d.tipo}</Celula>
          <Celula className="text-sm text-texto-2">{d.validade ? formatarDataBR(d.validade) : "—"}</Celula>
          <Celula>
            <a href={d.url} target="_blank" rel="noreferrer" className={classeBotao("secundario", "sm")}>
              <ExternalLink className="size-3.5" /> Abrir
            </a>
          </Celula>
        </tr>
      ))}
      {lista.length === 0 && <LinhaVazia colunas={4}>A administradora ainda não liberou documentos aqui.</LinhaVazia>}
    </Tabela>
  );
}

type Balancete = {
  competencia: string;
  receitas: { categoria: string; valor: number }[];
  despesas: { categoria: string; valor: number }[];
  total_receitas: number;
  total_despesas: number;
  contas: { nome: string; saldo_final: number }[];
  fundo: { saldo_final: number; entradas: number; saidas: number };
  inadimplencia: { em?: string; unidades: number; valor: number };
};

export function SecaoContas({ token, meses, b, mes }: { token: string; meses: string[]; b: Balancete | null; mes: string | null }) {
  if (!b) return <Cartao><p className="text-sm text-mudo">A prestação de contas aparece aqui depois que a administradora fecha cada mês.</p></Cartao>;
  return (
    <div className="space-y-4">
      {meses.length > 1 && (
        <PilulasLink
          rotulo="Mês da prestação de contas"
          ativo={`/condominio/${token}/contas?mes=${mes ?? meses[0]}`}
          itens={meses.map((m) => ({ href: `/condominio/${token}/contas?mes=${m}`, rotulo: formatarCompetencia(`${m}-01`) }))}
        />
      )}
      <Cartao titulo={`Prestação de contas de ${formatarCompetencia(b.competencia)}`}>
        <div className="grid gap-6 md:grid-cols-2">
          <div>
            <h4 className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-mudo">Receitas</h4>
            <ul className="space-y-1 text-sm">
              {b.receitas.map((r) => (
                <li key={r.categoria} className="flex justify-between gap-2">
                  <span>{r.categoria}</span>
                  <span className="tabular-nums">{formatarReais(r.valor)}</span>
                </li>
              ))}
              <li className="flex justify-between gap-2 border-t border-borda pt-1 font-semibold">
                <span>Total</span>
                <span className="tabular-nums">{formatarReais(b.total_receitas)}</span>
              </li>
            </ul>
          </div>
          <div>
            <h4 className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-mudo">Despesas</h4>
            <ul className="space-y-1 text-sm">
              {b.despesas.map((r) => (
                <li key={r.categoria} className="flex justify-between gap-2">
                  <span>{r.categoria}</span>
                  <span className="tabular-nums">{formatarReais(r.valor)}</span>
                </li>
              ))}
              <li className="flex justify-between gap-2 border-t border-borda pt-1 font-semibold">
                <span>Total</span>
                <span className="tabular-nums">{formatarReais(b.total_despesas)}</span>
              </li>
            </ul>
          </div>
        </div>
        <div className="mt-5 grid gap-2 text-sm sm:grid-cols-3">
          <div className="rounded-[12px] border border-borda bg-elev p-3">
            Resultado do mês
            <div className="text-[18px] font-semibold tabular-nums">{formatarReais(Number(b.total_receitas) - Number(b.total_despesas))}</div>
          </div>
          <div className="rounded-[12px] border border-borda bg-elev p-3">
            Fundo de reserva
            <div className="text-[18px] font-semibold tabular-nums">{formatarReais(b.fundo?.saldo_final ?? 0)}</div>
          </div>
          <div className="rounded-[12px] border border-borda bg-elev p-3">
            Inadimplência em {b.inadimplencia?.em ? formatarDataBR(b.inadimplencia.em) : "fim do mês"}
            <div className="text-[18px] font-semibold tabular-nums">{formatarReais(b.inadimplencia?.valor ?? 0)}</div>
            <span className="text-xs text-mudo">{b.inadimplencia?.unidades ?? 0} unidade(s)</span>
          </div>
        </div>
      </Cartao>
    </div>
  );
}
