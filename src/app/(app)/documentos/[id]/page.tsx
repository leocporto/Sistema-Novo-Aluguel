import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { CheckCircle2, FileSignature, History, MessageCircle, Printer, Send, ShieldCheck, Undo2, UserPlus, Users, XCircle } from "lucide-react";
import { BotaoAcao } from "@/components/botao-acao";
import { BotaoExcluir } from "@/components/botao-excluir";
import { Copiar } from "@/components/copiar";
import { BotaoEnviar, Formulario } from "@/components/formulario";
import { JanelaCadastro } from "@/components/janela-cadastro";
import { AreaTexto, BotaoLink, Campo, Cartao, Entrada, Selecao, Selo, classeBotao } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { formatarDataBR } from "@/lib/dominio/datas";
import { CHECKLIST_DOCUMENTO, ROTULO_PAPEL_SIGNATARIO, ROTULO_STATUS_DOCUMENTO, ROTULO_TIPO_DOCUMENTO } from "@/lib/dominio/modelos";
import { linkWhatsapp } from "@/lib/whatsapp";
import {
  adicionarPartesComoSignatarios,
  adicionarSignatario,
  atualizarDocumento,
  excluirDocumento,
  excluirSignatario,
  mudarStatusDocumento,
  salvarChecklistDocumento,
  salvarConteudo,
} from "../actions";
import { AbasDocumentos, CampoValidade, CamposVinculos, TextoDocumento } from "../campos";
import { opcoesDocumentos } from "../dados";
import { AbrirArquivo } from "./abrir-arquivo";

export const metadata: Metadata = { title: "Documento" };

const quando = (iso: string | null) => (iso ? new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—");

type S = {
  id: string;
  nome: string;
  cpf: string | null;
  telefone: string | null;
  email: string | null;
  papel: string;
  token: string;
  visualizado_em: string | null;
  assinado_em: string | null;
  recusado_em: string | null;
  motivo_recusa: string | null;
  ip: string | null;
};

function Mudar({ id, para, children, variante = "secundario", confirmar, comObs }: { id: string; para: string; children: React.ReactNode; variante?: "primario" | "secundario" | "fantasma" | "perigo"; confirmar?: string; comObs?: boolean }) {
  return (
    <form action={mudarStatusDocumento} className="flex items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="para" value={para} />
      {comObs && <input name="obs" placeholder="O que ajustar?" className="h-10 w-56 rounded-btn border border-borda-forte bg-input px-3 text-sm" />}
      <BotaoEnviar variante={variante} confirmar={confirmar}>
        {children}
      </BotaoEnviar>
    </form>
  );
}

export default async function DocumentoPage({ params, searchParams }: PageProps<"/documentos/[id]">) {
  const { id } = await params;
  const sp = await searchParams;
  const { supabase, organizacao, papel } = await obterContexto();
  const pessoal = organizacao.modo === "pessoal";
  const gestor = papel === "admin" || papel === "gestor";
  const [{ data }, { data: sigs }, { data: versoes }, { data: eventos }, op] = await Promise.all([
    supabase.from("documentos").select("*").eq("id", id).maybeSingle(),
    supabase.from("documento_signatarios").select("*").eq("documento_id", id).order("ordem"),
    supabase.from("documento_versoes").select("versao, observacao, created_at, conteudo").eq("documento_id", id).order("versao", { ascending: false }),
    supabase.from("documento_eventos").select("id, tipo, descricao, data, ip").eq("documento_id", id).order("data", { ascending: false }),
    opcoesDocumentos(supabase, pessoal),
  ]);
  if (!data) notFound();
  const d = data as {
    id: string;
    numero: number;
    titulo: string;
    tipo: string;
    status: string;
    conteudo: string | null;
    versao: number;
    arquivo_path: string | null;
    arquivo_nome: string | null;
    validade: string | null;
    alerta_dias: number;
    restrito: boolean;
    checklist: Record<string, boolean>;
    revisor_obs: string | null;
    hash_final: string | null;
    imovel_id: string | null;
    pessoa_id: string | null;
    contrato_id: string | null;
    venda_id: string | null;
  };
  const signatarios = (sigs ?? []) as S[];
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const base = `${host.startsWith("localhost") ? "http" : "https"}://${host}`;
  const editavel = ["rascunho", "em_revisao", "aprovado", "recusado"].includes(d.status);
  const verVersao = typeof sp.versao === "string" ? Number(sp.versao) : null;
  const antiga = verVersao ? (versoes ?? []).find((v) => v.versao === verVersao) : null;
  const checklist = CHECKLIST_DOCUMENTO[d.tipo] ?? [];
  const arquivo = d.status === "arquivo";

  return (
    <>
      <div className="mb-[clamp(14px,1.5vw,18px)] flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[13px] text-mudo">
            <span>Novo Aluguel</span>
            <span className="text-fraco">›</span>
            <Link href="/documentos" className="text-acento-hot hover:underline">
              Documentos
            </Link>
            <span className="text-fraco">›</span>
            <span>nº {d.numero}</span>
          </div>
          <h1 className="mt-1.5 text-[clamp(26px,2.8vw,36px)] font-semibold leading-[1.05] tracking-[-0.025em] text-texto">{d.titulo}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[13.5px] text-texto-2">
            <Selo cor={d.status === "assinado" ? "verde" : d.status === "recusado" ? "vermelho" : d.status === "aguardando_assinatura" || d.status === "em_revisao" ? "amarelo" : "azul"}>
              {ROTULO_STATUS_DOCUMENTO[d.status]}
            </Selo>
            {d.restrito && <Selo>restrito</Selo>}
            <span>
              {ROTULO_TIPO_DOCUMENTO[d.tipo] ?? d.tipo}
              {!arquivo && ` · versão ${d.versao}`}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(d.status === "rascunho" || d.status === "recusado") && (
            <Mudar id={id} para="em_revisao">
              <Send className="size-4" /> Enviar para revisão
            </Mudar>
          )}
          {d.status === "em_revisao" && gestor && (
            <Mudar id={id} para="aprovado" variante="primario">
              <CheckCircle2 className="size-4" /> Aprovar
            </Mudar>
          )}
          {["rascunho", "aprovado", "recusado"].includes(d.status) && signatarios.length > 0 && (
            <Mudar id={id} para="aguardando_assinatura" variante={d.status === "aprovado" ? "primario" : "secundario"} confirmar="Enviar para assinatura? O texto fica travado até todos assinarem.">
              <FileSignature className="size-4" /> Enviar para assinatura
            </Mudar>
          )}
          {d.status === "aguardando_assinatura" && (
            <Mudar id={id} para="rascunho" confirmar="Voltar para edição? As assinaturas já feitas serão descartadas.">
              <Undo2 className="size-4" /> Voltar para edição
            </Mudar>
          )}
          {!arquivo && (
            <BotaoLink href={`/documentos/${id}/imprimir`} variante="secundario">
              <Printer className="size-4" /> PDF / imprimir
            </BotaoLink>
          )}
          {arquivo && <AbrirArquivo id={id} />}
          {!["assinado", "cancelado", "arquivo"].includes(d.status) && (
            <Mudar id={id} para="cancelado" variante="fantasma" confirmar="Cancelar este documento? Ele fica no histórico, mas não vale mais.">
              <XCircle className="size-4" /> Cancelar
            </Mudar>
          )}
          <BotaoExcluir acao={excluirDocumento} id={id} variante="botao" rotulo="Excluir" confirmar="Excluir este documento?" depois="/documentos" />
        </div>
      </div>
      <AbasDocumentos />

      {d.status === "em_revisao" && gestor && (
        <div className="mb-5 flex flex-wrap items-center gap-3 rounded-[14px] border border-alerta-bd bg-alerta-bg px-4 py-3 text-sm text-alerta">
          <span className="flex-1 font-medium">Documento aguardando revisão.</span>
          <Mudar id={id} para="rascunho" comObs>
            Devolver para ajuste
          </Mudar>
        </div>
      )}
      {d.revisor_obs && d.status === "rascunho" && <div className="mb-5 rounded-[14px] border border-alerta-bd bg-alerta-bg px-4 py-3 text-sm text-alerta">Revisão pediu: {d.revisor_obs}</div>}
      {d.status === "assinado" && d.hash_final && (
        <div className="mb-5 flex items-center gap-2 rounded-[14px] border border-ok-bd bg-ok-bg px-4 py-3 text-sm text-ok">
          <ShieldCheck className="size-4" /> Assinado por todos. Código de integridade (SHA-256): <code className="break-all text-xs">{d.hash_final}</code>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[1fr_400px]">
        <div className="space-y-6">
          {arquivo ? (
            <Cartao titulo="Arquivo">
              <p className="text-sm text-texto-2">{d.arquivo_nome}</p>
              <div className="mt-3">
                <AbrirArquivo id={id} />
              </div>
            </Cartao>
          ) : antiga ? (
            <Cartao titulo={`Versão ${antiga.versao} (antiga)`} acoes={<Link href={`/documentos/${id}`} className="text-xs text-acento hover:underline">voltar à atual</Link>}>
              <TextoDocumento texto={antiga.conteudo ?? ""} />
            </Cartao>
          ) : editavel ? (
            <Cartao titulo="Texto do documento">
              <Formulario acao={salvarConteudo} className="space-y-3">
                <input type="hidden" name="id" value={id} />
                <AreaTexto name="conteudo" rows={26} defaultValue={d.conteudo ?? ""} className="font-mono text-[13px] leading-relaxed" />
                <p className="text-xs text-mudo">Dica: linha começando com “# ” vira título; **texto** fica em negrito; deixe uma linha em branco entre parágrafos.</p>
                <div className="flex flex-wrap items-end gap-3">
                  <Campo rotulo="O que mudou (opcional)">
                    <Entrada name="observacao" className="w-72" placeholder="Ajuste na cláusula de multa" />
                  </Campo>
                  <BotaoEnviar>Salvar nova versão</BotaoEnviar>
                </div>
              </Formulario>
            </Cartao>
          ) : (
            <Cartao titulo="Texto do documento">
              <TextoDocumento texto={d.conteudo ?? ""} />
            </Cartao>
          )}

          <Cartao titulo={`Trilha de auditoria (${eventos?.length ?? 0})`}>
            <ol className="max-h-80 space-y-2 overflow-y-auto text-sm">
              {(eventos ?? []).map((e) => (
                <li key={e.id} className="flex justify-between gap-3 border-b border-borda-suave pb-1.5 last:border-0">
                  <span className="text-texto-2">{e.descricao}</span>
                  <span className="shrink-0 text-xs text-mudo">
                    {quando(e.data)}
                    {e.ip ? ` · IP ${e.ip}` : ""}
                  </span>
                </li>
              ))}
            </ol>
          </Cartao>
        </div>

        <div className="space-y-6">
          {!arquivo && (
            <Cartao
              titulo={`Signatários e testemunhas (${signatarios.length})`}
              acoes={
                ["rascunho", "em_revisao", "aprovado", "recusado"].includes(d.status) && (
                  <JanelaCadastro rotuloBotao={<><UserPlus className="size-3.5" /> Incluir</>} variante="fantasma" tamanho="sm" titulo="Novo signatário" acao={adicionarSignatario} rotuloSalvar="Incluir">
                    <input type="hidden" name="documento_id" value={id} />
                    <Campo rotulo="Pessoa cadastrada">
                      <Selecao name="pessoa_id" defaultValue="">
                        <option value="">— digitar abaixo —</option>
                        {op.pessoas.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.nome}
                          </option>
                        ))}
                      </Selecao>
                    </Campo>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Campo rotulo="Nome">
                        <Entrada name="nome" />
                      </Campo>
                      <Campo rotulo="CPF/CNPJ">
                        <Entrada name="cpf" />
                      </Campo>
                      <Campo rotulo="Telefone">
                        <Entrada name="telefone" />
                      </Campo>
                      <Campo rotulo="Papel">
                        <Selecao name="papel" defaultValue="parte">
                          {Object.entries(ROTULO_PAPEL_SIGNATARIO).map(([k, r]) => (
                            <option key={k} value={k}>
                              {r}
                            </option>
                          ))}
                        </Selecao>
                      </Campo>
                    </div>
                  </JanelaCadastro>
                )
              }
            >
              <ul className="space-y-3">
                {signatarios.map((s) => {
                  const link = `${base}/assinar/${s.token}`;
                  return (
                    <li key={s.id} className="rounded-[12px] border border-borda p-3 text-sm">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="font-medium text-texto">{s.nome}</div>
                          <div className="text-xs text-mudo">
                            {ROTULO_PAPEL_SIGNATARIO[s.papel]}
                            {s.cpf ? ` · ${s.cpf}` : ""}
                          </div>
                        </div>
                        {s.assinado_em ? <Selo cor="verde">assinou</Selo> : s.recusado_em ? <Selo cor="vermelho">recusou</Selo> : s.visualizado_em ? <Selo cor="amarelo">abriu</Selo> : <Selo>pendente</Selo>}
                      </div>
                      {s.assinado_em && (
                        <div className="mt-1 text-xs text-mudo">
                          {quando(s.assinado_em)}
                          {s.ip ? ` · IP ${s.ip}` : ""}
                        </div>
                      )}
                      {s.recusado_em && <div className="mt-1 text-xs text-ruim">Motivo: {s.motivo_recusa || "—"}</div>}
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        {d.status === "aguardando_assinatura" && !s.assinado_em && (
                          <>
                            <Copiar texto={link} rotulo="Copiar link" />
                            {s.telefone && (
                              <a
                                href={linkWhatsapp(s.telefone, `Olá ${s.nome.split(" ")[0]}! Segue o documento "${d.titulo}" para assinatura eletrônica: ${link}`)}
                                target="_blank"
                                rel="noreferrer"
                                className={classeBotao("secundario", "sm")}
                              >
                                <MessageCircle className="size-3.5" /> WhatsApp
                              </a>
                            )}
                          </>
                        )}
                        {!s.assinado_em && <BotaoExcluir acao={excluirSignatario} id={s.id} rotulo={`Remover ${s.nome}`} confirmar={`Remover ${s.nome} dos signatários?`} />}
                      </div>
                    </li>
                  );
                })}
                {signatarios.length === 0 && <li className="text-sm text-mudo">Ninguém ainda. Inclua as partes e as testemunhas.</li>}
              </ul>
              {["rascunho", "em_revisao", "aprovado", "recusado"].includes(d.status) && (
                <div className="mt-3">
                  <BotaoAcao acao={adicionarPartesComoSignatarios} id={id} tamanho="sm">
                    <Users className="size-3.5" /> Incluir as partes do contrato/imóvel
                  </BotaoAcao>
                </div>
              )}
              {d.status === "aguardando_assinatura" && <p className="mt-3 text-xs text-mudo">Cada pessoa recebe um link só dela. A assinatura registra nome, CPF, data, hora, IP e o código do texto assinado.</p>}
            </Cartao>
          )}

          <Formulario acao={atualizarDocumento} automatico>
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="_restrito" value="1" />
            <Cartao titulo="Dados">
              <div className="space-y-4">
                <Campo rotulo="Título">
                  <Entrada name="titulo" defaultValue={d.titulo} />
                </Campo>
                <div className="grid grid-cols-2 gap-3">
                  <CampoValidade padrao={d.validade} />
                  <Campo rotulo="Avisar com (dias)">
                    <Entrada type="number" name="alerta_dias" min={0} defaultValue={d.alerta_dias} />
                  </Campo>
                </div>
                <CamposVinculos imoveis={op.imoveis} pessoas={op.pessoas} contratos={op.contratos} vendas={op.vendas} padrao={d} />
                {gestor && (
                  <label className="flex items-center gap-2 text-sm text-texto-2">
                    <input type="checkbox" name="restrito" defaultChecked={d.restrito} /> Restrito (só administradores e gestores veem)
                  </label>
                )}
              </div>
            </Cartao>
          </Formulario>

          {checklist.length > 0 && (
            <Cartao titulo="Documentação obrigatória">
              <Formulario acao={salvarChecklistDocumento} automatico className="space-y-1">
                <input type="hidden" name="id" value={id} />
                <input type="hidden" name="tipo" value={d.tipo} />
                {checklist.map((i) => (
                  <label key={i.id} className="flex cursor-pointer items-start gap-2.5 rounded-[10px] px-2 py-1.5 text-sm text-texto-2 transition hover:bg-elev has-[:checked]:text-texto">
                    <input type="checkbox" name="item" value={i.id} defaultChecked={!!d.checklist?.[i.id]} className="mt-0.5 size-4 accent-[var(--accent)]" />
                    {i.rotulo}
                  </label>
                ))}
              </Formulario>
            </Cartao>
          )}

          {!arquivo && (
            <Cartao titulo={`Versões (${versoes?.length ?? 0})`}>
              <ul className="space-y-1.5 text-sm">
                {(versoes ?? []).map((v) => (
                  <li key={v.versao} className="flex items-center justify-between gap-2">
                    <Link href={v.versao === d.versao ? `/documentos/${id}` : `/documentos/${id}?versao=${v.versao}`} className="inline-flex items-center gap-1.5 text-acento hover:underline">
                      <History className="size-3.5" /> Versão {v.versao}
                      {v.versao === d.versao ? " (atual)" : ""}
                    </Link>
                    <span className="truncate text-xs text-mudo">
                      {formatarDataBR(String(v.created_at).slice(0, 10))}
                      {v.observacao ? ` · ${v.observacao}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </Cartao>
          )}
        </div>
      </div>
    </>
  );
}
