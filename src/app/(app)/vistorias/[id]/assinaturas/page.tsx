import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { FileSignature, Mail, MessageCircle, MessageSquareReply, MessageSquareWarning, RefreshCw } from "lucide-react";
import { BotaoAcao } from "@/components/botao-acao";
import { BotaoExcluir } from "@/components/botao-excluir";
import { Copiar } from "@/components/copiar";
import { Formulario } from "@/components/formulario";
import { JanelaCadastro } from "@/components/janela-cadastro";
import { AreaTexto, Aviso, Campo, Cartao, Entrada, Selecao, Selo, classeBotao } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { formatarDataBR, hojeISO } from "@/lib/dominio/datas";
import { ROTULO_PAPEL_SIGNATARIO, ROTULO_STATUS_DOCUMENTO } from "@/lib/dominio/modelos";
import { ROTULO_DECISAO, contestacaoAberta } from "@/lib/dominio/vistorias";
import { linkWhatsapp } from "@/lib/whatsapp";
import { atualizarVistoria, excluirContestacao, gerarLaudoAssinatura, novoLinkContestacao, registrarContestacaoManual, responderContestacao } from "../../actions";
import { carregarVistoria, linksAssinados, partesDaVistoria } from "../../dados";
import { Miniatura } from "../../galeria";

export const metadata: Metadata = { title: "Assinatura e contestação" };

const quando = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });

type Sig = { id: string; nome: string; papel: string; telefone: string | null; email: string | null; token: string; assinado_em: string | null; visualizado_em: string | null; recusado_em: string | null; motivo_recusa: string | null };
type Contestacao = {
  id: string;
  nome: string;
  contato: string | null;
  texto: string;
  itens: { item: string; texto: string }[];
  fotos: string[];
  origem: string;
  status: string;
  decisao: string | null;
  resposta: string | null;
  respondida_em: string | null;
  created_at: string;
};

export default async function AssinaturasVistoria({ params }: PageProps<"/vistorias/[id]/assinaturas">) {
  const { id } = await params;
  const { supabase, papel } = await obterContexto();
  const v = await carregarVistoria(supabase, id);
  if (!v) notFound();
  const [{ data: doc }, { data: sigs }, { data: cont }, partes] = await Promise.all([
    v.documento_id ? supabase.from("documentos").select("id, titulo, status, numero").eq("id", v.documento_id).maybeSingle() : Promise.resolve({ data: null }),
    v.documento_id
      ? supabase.from("documento_signatarios").select("id, nome, papel, telefone, email, token, assinado_em, visualizado_em, recusado_em, motivo_recusa").eq("documento_id", v.documento_id).order("ordem")
      : Promise.resolve({ data: [] }),
    supabase.from("vistoria_contestacoes").select("*").eq("vistoria_id", id).order("created_at", { ascending: false }),
    partesDaVistoria(supabase, v),
  ]);
  const contestacoes = (cont ?? []) as Contestacao[];
  const links = await linksAssinados(supabase, contestacoes.flatMap((c) => c.fotos));
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const base = `${host.startsWith("localhost") ? "http" : "https"}://${host}`;
  const linkContestacao = `${base}/contestar/${v.contestacao_token}`;
  const concluida = ["concluida", "assinada", "contestada"].includes(v.status);
  const aberta = concluida && contestacaoAberta(v.contestacao_ate, hojeISO());
  const decide = papel === "admin" || papel === "gestor" || papel === "financeiro";
  const signatarios = (sigs ?? []) as Sig[];
  const msgContestacao = `Segue a vistoria do imóvel ${v.imovel?.codigo ?? ""}. Confira o laudo e, se não concordar com algum item, conteste${v.contestacao_ate ? ` até ${formatarDataBR(v.contestacao_ate)}` : ""} por este link: ${linkContestacao}`;

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <div className="space-y-6">
        <Cartao
          titulo="Laudo para assinatura"
          acoes={
            doc ? (
              <Link href={`/documentos/${doc.id}`} className="text-xs text-acento hover:underline">
                abrir documento nº {doc.numero}
              </Link>
            ) : undefined
          }
        >
          {!concluida ? (
            <p className="text-sm text-mudo">Conclua a vistoria (no Resumo) para gerar o laudo e mandar para os envolvidos assinarem.</p>
          ) : !doc ? (
            <>
              <p className="mb-4 text-sm text-texto-2">
                O laudo vira um documento (em Documentos) com o checklist, medidores, danos e a comparação, e cada envolvido recebe um link para assinar com nome e CPF (data, hora, IP e código do texto ficam
                registrados). Assinam: locatário(s), {v.contrato_id || partes.proprietarios.length ? "locador/proprietário(s)" : "locador"} e quem fez a vistoria.
              </p>
              <BotaoAcao acao={gerarLaudoAssinatura} id={id} variante="primario">
                <FileSignature className="size-4" /> Gerar laudo e mandar para assinatura
              </BotaoAcao>
            </>
          ) : (
            <>
              <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
                <Selo cor={doc.status === "assinado" ? "verde" : doc.status === "recusado" || doc.status === "cancelado" ? "vermelho" : "amarelo"}>{ROTULO_STATUS_DOCUMENTO[doc.status] ?? doc.status}</Selo>
                <span className="text-texto-2">{doc.titulo}</span>
              </div>
              <ul className="space-y-3">
                {signatarios.map((s) => {
                  const link = `${base}/assinar/${s.token}`;
                  return (
                    <li key={s.id} className="rounded-[12px] border border-borda p-3 text-sm">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="font-medium text-texto">{s.nome}</div>
                          <div className="text-xs text-mudo">{s.papel === "parte" ? "Vistoriador" : ROTULO_PAPEL_SIGNATARIO[s.papel]}</div>
                        </div>
                        {s.assinado_em ? <Selo cor="verde">assinou</Selo> : s.recusado_em ? <Selo cor="vermelho">recusou</Selo> : s.visualizado_em ? <Selo cor="amarelo">abriu</Selo> : <Selo>pendente</Selo>}
                      </div>
                      {s.assinado_em && <div className="mt-1 text-xs text-mudo">{quando(s.assinado_em)}</div>}
                      {s.recusado_em && <div className="mt-1 text-xs text-ruim">Motivo: {s.motivo_recusa || "—"}</div>}
                      {doc.status === "aguardando_assinatura" && !s.assinado_em && (
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <Copiar texto={link} rotulo="Copiar link" />
                          {s.telefone && (
                            <a
                              href={linkWhatsapp(s.telefone, `Olá ${s.nome.split(" ")[0]}! Segue o laudo da vistoria do imóvel ${v.imovel?.codigo ?? ""} para assinatura eletrônica: ${link}`)}
                              target="_blank"
                              rel="noreferrer"
                              className={classeBotao("secundario", "sm")}
                            >
                              <MessageCircle className="size-3.5" /> WhatsApp
                            </a>
                          )}
                          {s.email && (
                            <a href={`mailto:${s.email}?subject=${encodeURIComponent("Laudo de vistoria para assinatura")}&body=${encodeURIComponent(`Olá ${s.nome.split(" ")[0]}! Segue o laudo da vistoria para assinatura eletrônica: ${link}`)}`} className={classeBotao("secundario", "sm")}>
                              <Mail className="size-3.5" /> E-mail
                            </a>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
                {!signatarios.length && <li className="text-sm text-alerta">Nenhum signatário: inclua no documento (abrir documento).</li>}
              </ul>
              {doc.status !== "assinado" ? (
                <div className="mt-4">
                  <BotaoAcao acao={gerarLaudoAssinatura} id={id} variante="fantasma" confirmar="Gerar o laudo de novo? O laudo atual (não assinado) é cancelado e os links antigos param de funcionar.">
                    <RefreshCw className="size-4" /> Gerar de novo (depois de corrigir)
                  </BotaoAcao>
                </div>
              ) : (
                <p className="mt-4 text-sm text-texto-2">
                  Laudo assinado por todos. Se precisar corrigir (por exemplo, uma contestação aceita), use “Reabrir” no{" "}
                  <Link href={`/vistorias/${id}`} className="text-acento hover:underline">
                    Resumo
                  </Link>
                  : este laudo fica em Documentos como histórico e, depois de corrigir e concluir, você gera um laudo novo aqui.
                </p>
              )}
            </>
          )}
        </Cartao>

        <Cartao titulo="Prazo e link de contestação">
          <Formulario acao={atualizarVistoria} automatico className="space-y-4">
            <input type="hidden" name="id" value={id} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Campo rotulo="Dias para contestar" dica="Contados da conclusão da vistoria.">
                <Entrada name="contestacao_dias" inputMode="numeric" defaultValue={String(v.contestacao_dias)} />
              </Campo>
              <Campo rotulo="Pode contestar até" dica="Vazio = sem prazo">
                <Entrada type="date" name="contestacao_ate" defaultValue={v.contestacao_ate ?? ""} />
              </Campo>
            </div>
          </Formulario>
          {!concluida ? (
            <p className="mt-3 text-sm text-mudo">O link passa a funcionar quando a vistoria for concluída.</p>
          ) : (
            <div className="mt-4 space-y-3">
              {aberta ? <Aviso>O locatário pode contestar pelo link {v.contestacao_ate ? `até ${formatarDataBR(v.contestacao_ate)}` : "(sem prazo)"}.</Aviso> : <Aviso tipo="alerta">O prazo de contestação terminou.</Aviso>}
              <p className="break-all rounded-[12px] border border-borda bg-elev px-3 py-2 font-mono text-xs text-texto-2">{linkContestacao}</p>
              <div className="flex flex-wrap gap-2">
                <Copiar texto={linkContestacao} rotulo="Copiar link" />
                {partes.locatarios
                  .filter((l) => l.telefone)
                  .map((l) => (
                    <a key={l.id} href={linkWhatsapp(l.telefone!, `Olá ${l.nome.split(" ")[0]}! ${msgContestacao}`)} target="_blank" rel="noreferrer" className={classeBotao("secundario", "sm")}>
                      <MessageCircle className="size-3.5" /> {l.nome.split(" ")[0]}
                    </a>
                  ))}
                <BotaoAcao acao={novoLinkContestacao} id={id} tamanho="sm" variante="fantasma" confirmar="Trocar o link? O anterior para de funcionar.">
                  <RefreshCw className="size-3.5" /> Trocar link
                </BotaoAcao>
              </div>
            </div>
          )}
        </Cartao>
      </div>

      <Cartao
        titulo={`Contestações (${contestacoes.length})`}
        acoes={
          <JanelaCadastro rotuloBotao="+ Registrar" tamanho="sm" variante="secundario" titulo="Registrar contestação recebida" acao={registrarContestacaoManual} icone={<MessageSquareWarning />} rotuloSalvar="Registrar">
            <input type="hidden" name="vistoria_id" value={id} />
            <p className="text-sm text-texto-2">Use quando a contestação chegou por e-mail, carta ou mensagem.</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Campo rotulo="Quem contestou">
                <Entrada name="nome" required defaultValue={partes.locatarios[0]?.nome ?? ""} />
              </Campo>
              <Campo rotulo="Contato">
                <Entrada name="contato" defaultValue={partes.locatarios[0]?.telefone ?? ""} />
              </Campo>
            </div>
            <Campo rotulo="O que foi contestado">
              <AreaTexto name="texto" rows={4} required />
            </Campo>
          </JanelaCadastro>
        }
      >
        {contestacoes.length === 0 ? (
          <p className="text-sm text-mudo">Nenhuma contestação recebida.</p>
        ) : (
          <ul className="space-y-4">
            {contestacoes.map((c) => {
              const tel = c.contato && c.contato.replace(/\D/g, "").length >= 10 ? c.contato : partes.locatarios[0]?.telefone;
              return (
                <li key={c.id} className="rounded-[14px] border border-borda p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-texto">{c.nome}</span>
                        <Selo cor={c.status === "aberta" ? "vermelho" : "verde"}>{c.status === "aberta" ? "aguardando resposta" : "respondida"}</Selo>
                        <Selo>{c.origem === "link" ? "pelo link" : "registrada à mão"}</Selo>
                      </div>
                      <div className="text-xs text-mudo">
                        {quando(c.created_at)}
                        {c.contato ? ` · ${c.contato}` : ""}
                      </div>
                    </div>
                    <BotaoExcluir acao={excluirContestacao} id={c.id} rotulo="Excluir contestação" confirmar="Excluir esta contestação (e as fotos dela)?" />
                  </div>
                  <p className="mt-2 whitespace-pre-line text-sm text-texto">{c.texto}</p>
                  {c.itens.length > 0 && (
                    <ul className="mt-2 space-y-1 text-sm">
                      {c.itens.map((i, k) => (
                        <li key={k} className="text-texto-2">
                          <strong className="text-texto">{i.item}</strong>
                          {i.texto ? `: ${i.texto}` : ""}
                        </li>
                      ))}
                    </ul>
                  )}
                  {c.fotos.length > 0 && (
                    <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
                      {c.fotos.map((f) => (
                        <Miniatura key={f} url={links[f]} tipo="foto" legenda="Foto enviada pelo locatário" className="aspect-square" />
                      ))}
                    </div>
                  )}
                  {c.status === "respondida" ? (
                    <div className="mt-3 rounded-[12px] border border-ok-bd bg-ok-bg px-3 py-2 text-sm">
                      <div className="font-semibold text-ok">{ROTULO_DECISAO[c.decisao ?? ""] ?? "Respondida"}</div>
                      <p className="whitespace-pre-line text-texto">{c.resposta}</p>
                      <div className="text-xs text-mudo">{c.respondida_em ? quando(c.respondida_em) : ""}</div>
                    </div>
                  ) : null}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {c.status === "aberta" && decide && (
                      <JanelaCadastro rotuloBotao={<><MessageSquareReply className="size-3.5" /> Responder</>} tamanho="sm" titulo={`Responder ${c.nome}`} acao={responderContestacao} icone={<MessageSquareReply />} rotuloSalvar="Salvar resposta">
                        <input type="hidden" name="id" value={c.id} />
                        <Campo rotulo="Decisão">
                          <Selecao name="decisao" defaultValue="parcial">
                            {Object.entries(ROTULO_DECISAO).map(([k, r]) => (
                              <option key={k} value={k}>
                                {r}
                              </option>
                            ))}
                          </Selecao>
                        </Campo>
                        <Campo rotulo="Resposta ao locatário">
                          <AreaTexto name="resposta" rows={5} required />
                        </Campo>
                        <p className="text-xs text-mudo">
                          Se aceitar (no todo ou em parte): depois de salvar a resposta, use “Reabrir” no Resumo (funciona mesmo com o laudo já assinado), corrija os itens, conclua de novo e gere um laudo
                          novo para assinatura. O laudo anterior fica em Documentos como histórico.
                        </p>
                      </JanelaCadastro>
                    )}
                    {c.status === "aberta" && !decide && <span className="text-xs text-mudo">Só administrador, gestor ou financeiro respondem.</span>}
                    {c.status === "respondida" && tel && (
                      <a
                        href={linkWhatsapp(tel, `Olá ${c.nome.split(" ")[0]}! Sobre a sua contestação da vistoria do imóvel ${v.imovel?.codigo ?? ""}: ${c.resposta ?? ""}`)}
                        target="_blank"
                        rel="noreferrer"
                        className={classeBotao("secundario", "sm")}
                      >
                        <MessageCircle className="size-3.5" /> Mandar resposta
                      </a>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Cartao>
    </div>
  );
}
