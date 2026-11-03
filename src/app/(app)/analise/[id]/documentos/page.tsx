import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Check, FilePlus2, ListChecks, RotateCcw, X } from "lucide-react";
import { BarraProgresso } from "@/components/barra-progresso";
import { BotaoAcao } from "@/components/botao-acao";
import { BotaoExcluir } from "@/components/botao-excluir";
import { JanelaCadastro } from "@/components/janela-cadastro";
import { AreaTexto, Campo, Cartao, Entrada, Selecao, Selo } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { COR_STATUS_DOCUMENTO, PARTES_DOCUMENTO, ROTULO_PARTE_DOCUMENTO, ROTULO_STATUS_DOCUMENTO, progressoDocumentos, situacaoDocumento } from "@/lib/dominio/analise";
import { formatarDataBR } from "@/lib/dominio/datas";
import { formatarDocumento } from "@/lib/dominio/documentos";
import { adicionarDocumento, dispensarDocumento, excluirArquivo, excluirDocumento, gerarChecklist, reabrirDocumento, recusarDocumento, validarDocumento } from "../../actions";
import { carregarAnalise, nomesEquipe, quando, type Documento } from "../../dados";
import { AbrirArquivo, EnvioDocumentos } from "./arquivos";

export const metadata: Metadata = { title: "Documentos do candidato" };

type Arquivo = { id: string; documento_id: string | null; nome: string | null; enviado_pela_ficha: boolean; created_at: string };

export default async function DocumentosAnalise({ params }: PageProps<"/analise/[id]/documentos">) {
  const { id } = await params;
  const { supabase, organizacao, usuario } = await obterContexto();
  const [c, nome, { data: arqs }] = await Promise.all([
    carregarAnalise(supabase, id),
    nomesEquipe(supabase, usuario.id),
    supabase.from("analise_arquivos").select("id, documento_id, nome, enviado_pela_ficha, created_at").eq("analise_id", id).order("created_at", { ascending: false }),
  ]);
  if (!c) notFound();
  const { analise: a, documentos, fiadores } = c;
  const arquivos = (arqs ?? []) as Arquivo[];
  const prog = progressoDocumentos(documentos);
  const grupos: { chave: string; titulo: string; itens: Documento[] }[] = [
    { chave: "candidato", titulo: `Candidato — ${a.candidato?.nome ?? ""}`, itens: documentos.filter((d) => !d.fiador_id && d.parte === "candidato") },
    ...fiadores.map((f) => ({ chave: f.id, titulo: `Fiador — ${f.pessoa?.nome ?? ""}`, itens: documentos.filter((d) => d.fiador_id === f.id) })),
    ...PARTES_DOCUMENTO.filter((p) => p !== "candidato" && p !== "fiador").map((p) => ({ chave: p, titulo: ROTULO_PARTE_DOCUMENTO[p], itens: documentos.filter((d) => !d.fiador_id && d.parte === p) })),
  ].filter((g) => g.itens.length > 0);
  const pessoasDoc = [
    { nome: a.candidato?.nome ?? "Candidato", papel: "Candidato", doc: a.candidato?.documento ?? null },
    ...fiadores.map((f) => ({ nome: f.pessoa?.nome ?? "Fiador", papel: "Fiador", doc: f.pessoa?.documento ?? null })),
  ];

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_400px]">
      <Cartao
        titulo={`Checklist de documentos (${prog.validados}/${prog.total} validados)`}
        acoes={
          <div className="flex flex-wrap gap-2">
            <BotaoAcao acao={gerarChecklist} id={id} tamanho="sm" variante="fantasma">
              <ListChecks className="size-3.5" /> Completar padrão
            </BotaoAcao>
            <JanelaCadastro rotuloBotao={<><FilePlus2 className="size-3.5" /> Incluir</>} tamanho="sm" titulo="Incluir documento no checklist" acao={adicionarDocumento} rotuloSalvar="Incluir">
              <input type="hidden" name="analise_id" value={id} />
              <Campo rotulo="Documento">
                <Entrada name="rotulo" required placeholder="Ex.: Contrato de trabalho, CNH do cônjuge…" />
              </Campo>
              <div className="grid gap-4 sm:grid-cols-2">
                <Campo rotulo="De quem">
                  <Selecao name="parte" defaultValue="candidato">
                    {PARTES_DOCUMENTO.filter((p) => p !== "fiador").map((p) => (
                      <option key={p} value={p}>
                        {ROTULO_PARTE_DOCUMENTO[p]}
                      </option>
                    ))}
                  </Selecao>
                </Campo>
                <Campo rotulo="Ou de um fiador">
                  <Selecao name="fiador_id" defaultValue="">
                    <option value="">—</option>
                    {fiadores.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.pessoa?.nome}
                      </option>
                    ))}
                  </Selecao>
                </Campo>
              </div>
              <input type="hidden" name="obrigatorio" value="" />
              <label className="flex items-center gap-2 text-sm text-texto-2">
                <input type="checkbox" name="obrigatorio" defaultChecked className="size-4 accent-[var(--accent)]" /> Obrigatório para aprovar
              </label>
            </JanelaCadastro>
          </div>
        }
      >
        <BarraProgresso pct={prog.pct} atingida={prog.total > 0 && prog.validados === prog.total} />
        {prog.obrigatoriosPendentes > 0 && <p className="mt-2 text-xs text-alerta">{prog.obrigatoriosPendentes} documento(s) obrigatório(s) ainda sem validação.</p>}
        <div className="mt-5 space-y-6">
          {grupos.map((g) => (
            <section key={g.chave}>
              <h4 className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-mudo">{g.titulo}</h4>
              <ul className="divide-y divide-borda-suave overflow-hidden rounded-[14px] border border-borda">
                {g.itens.map((d) => {
                  const fs = arquivos.filter((f) => f.documento_id === d.id);
                  return (
                    <li key={d.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Selo cor={COR_STATUS_DOCUMENTO[d.status]}>{ROTULO_STATUS_DOCUMENTO[d.status]}</Selo>
                          <span className="text-sm font-medium text-texto">{d.rotulo}</span>
                          {!d.obrigatorio && <span className="text-xs text-mudo">(opcional)</span>}
                        </div>
                        {d.status === "recusado" && d.motivo_recusa && <p className="mt-1 text-xs text-ruim">Motivo: {d.motivo_recusa}</p>}
                        {d.validado_em && (
                          <p className="mt-1 text-xs text-mudo">
                            {d.status === "validado" ? "Validado" : d.status === "recusado" ? "Recusado" : "Dispensado"} por {nome(d.validado_por)} em {quando(d.validado_em)}
                          </p>
                        )}
                        {fs.length > 0 && (
                          <div className="mt-1.5 flex flex-col gap-1">
                            {fs.map((f) => (
                              <div key={f.id} className="flex min-w-0 items-center gap-1.5">
                                <AbrirArquivo id={f.id} nome={f.nome ?? "arquivo"} ficha={f.enviado_pela_ficha} />
                                <BotaoExcluir acao={excluirArquivo} id={f.id} rotulo="Excluir arquivo" confirmar={`Excluir o arquivo "${f.nome ?? "arquivo"}"? Ele sai do armazenamento e a exclusão fica na auditoria.`} />
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {d.status !== "validado" && (
                          <BotaoAcao acao={validarDocumento} id={d.id} tamanho="sm" variante="secundario">
                            <Check className="size-3.5" /> Validar
                          </BotaoAcao>
                        )}
                        {d.status !== "recusado" && (
                          <JanelaCadastro rotuloBotao={<><X className="size-3.5" /> Recusar</>} tamanho="sm" variante="fantasma" titulo={`Recusar: ${d.rotulo}`} acao={recusarDocumento} rotuloSalvar="Recusar" icone={<X />}>
                            <input type="hidden" name="id" value={d.id} />
                            <Campo rotulo="Motivo (o candidato vê na ficha online)">
                              <AreaTexto name="motivo" rows={3} required placeholder="Ilegível, vencido, faltou o verso…" />
                            </Campo>
                          </JanelaCadastro>
                        )}
                        {d.status === "pendente" || d.status === "recebido" ? (
                          <BotaoAcao acao={dispensarDocumento} id={d.id} tamanho="sm" variante="fantasma" confirmar={`Dispensar "${d.rotulo}"? Ele deixa de contar como pendência.`}>
                            Dispensar
                          </BotaoAcao>
                        ) : (
                          <BotaoAcao acao={reabrirDocumento} id={d.id} tamanho="sm" variante="fantasma">
                            <RotateCcw className="size-3.5" /> Pendente
                          </BotaoAcao>
                        )}
                        <BotaoExcluir acao={excluirDocumento} id={d.id} rotulo="Excluir do checklist" confirmar={`Tirar "${d.rotulo}" do checklist? Os arquivos enviados continuam na lista.`} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
          {grupos.length === 0 && <p className="text-sm text-mudo">Checklist vazio. Use “Completar padrão” para incluir os documentos de sempre.</p>}
        </div>
      </Cartao>

      <div className="space-y-6">
        <Cartao titulo={`Enviar documentos (${arquivos.length})`}>
          <EnvioDocumentos
            pasta={`${organizacao.id}/${id}`}
            analiseId={id}
            itens={documentos.map((d) => ({ id: d.id, rotulo: d.fiador_id ? `${d.rotulo} (fiador ${fiadores.find((f) => f.id === d.fiador_id)?.pessoa?.nome ?? ""})` : d.rotulo }))}
            soltos={arquivos
              .filter((f) => !f.documento_id)
              .map((f) => ({ id: f.id, nome: f.nome ?? "arquivo", criado: formatarDataBR(f.created_at.slice(0, 10)), ficha: f.enviado_pela_ficha }))}
          />
        </Cartao>
        <Cartao titulo="Validação de CPF / CNPJ">
          <ul className="space-y-2.5 text-sm">
            {pessoasDoc.map((p, i) => {
              const s = situacaoDocumento(p.doc);
              return (
                <li key={i} className="flex flex-wrap items-center justify-between gap-2">
                  <span className="min-w-0">
                    <span className="font-medium text-texto">{p.nome}</span>
                    <span className="block text-xs text-mudo">
                      {p.papel} · {p.doc ? formatarDocumento(p.doc) : "sem documento"}
                    </span>
                  </span>
                  <Selo cor={s === "valido" ? "verde" : s === "invalido" ? "vermelho" : "amarelo"}>{s === "valido" ? "dígitos ok" : s === "invalido" ? "inválido" : "falta"}</Selo>
                </li>
              );
            })}
          </ul>
          <p className="mt-3 text-xs text-mudo">
            O sistema confere os dígitos do CPF/CNPJ. A situação na Receita Federal é conferida no site da Receita (ou pela integração com birô, quando contratada).
            A conferência do documento original (foto x pessoa) fica no Resumo e na aba Fiadores.
          </p>
        </Cartao>
      </div>
    </div>
  );
}
