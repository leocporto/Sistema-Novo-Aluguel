import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink, FileUp, MessageCircle, RefreshCw } from "lucide-react";
import { BotaoAcao } from "@/components/botao-acao";
import { BotaoExcluir } from "@/components/botao-excluir";
import { Copiar } from "@/components/copiar";
import { Formulario } from "@/components/formulario";
import { JanelaCadastro } from "@/components/janela-cadastro";
import { Aviso, BotaoLink, Cabecalho, Campo, Cartao, Definicao, Entrada, Selecao, Selo, classeBotao } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { diaLocal, horaLocal } from "@/lib/dominio/agenda";
import { agoraMs, formatarDataBR } from "@/lib/dominio/datas";
import {
  COR_SITUACAO_LINK,
  COR_STATUS_SOLICITACAO,
  DICA_CODIGO,
  ROTULO_PERFIL,
  ROTULO_SITUACAO_LINK,
  ROTULO_STATUS_SOLICITACAO,
  ROTULO_TIPO_SOLICITACAO,
  VALIDADES_ARQUIVO,
  VALIDADES_LINK,
  codigoConfirmacao,
  mensagemPortal,
  situacaoLink,
  type StatusSolicitacao,
  type TipoSolicitacao,
} from "@/lib/dominio/portal";
import { linkWhatsapp } from "@/lib/whatsapp";
import { AbasPortais } from "../abas";
import { compartilharArquivoPortal, desativarLinkPortal, excluirLinkPortal, reativarLinkPortal, removerArquivoPortal, trocarLinkPortal, validadeLinkPortal } from "../actions";
import { SELECT_ACESSO, arquivosParaCompartilhar, urlBase, type Acesso } from "../dados";

export const metadata: Metadata = { title: "Link do portal" };

const ROTULO_EVENTO: Record<string, string> = {
  gerado: "Link gerado",
  entrada: "Entrou",
  falha: "Errou os números",
  bloqueio: "Entrada bloqueada",
  saida: "Saiu",
  trocado: "Link trocado",
  revogado: "Link desativado",
  reativado: "Link reativado",
  validade: "Validade",
  solicitacao: "Pedido",
  chamado: "Chamado",
  pasta: "Envio de fotos",
  aprovacao: "Aprovação de orçamento",
  orcamento: "Orçamento",
  execucao: "Serviço",
};

/** Ficha do link: situação, envio, validade, arquivos compartilhados, registro de acessos e pedidos. */
export default async function LinkPortalPage({ params }: PageProps<"/portais/[id]">) {
  const { id } = await params;
  const { supabase, organizacao, papel } = await obterContexto();
  if (papel === "corretor") notFound();
  const { data } = await supabase.from("portal_acessos").select(SELECT_ACESSO).eq("id", id).maybeSingle();
  const a = data as unknown as Acesso | null;
  if (!a || (a.perfil === "proprietario" && organizacao.modo === "pessoal")) notFound();
  const [base, { data: eventos }, { data: arquivos }, { data: pedidos }, candidatos] = await Promise.all([
    urlBase(),
    supabase.from("portal_eventos").select("id, tipo, descricao, ip, data").eq("acesso_id", id).order("data", { ascending: false }).limit(100),
    supabase.from("portal_arquivos").select("id, titulo, url, expira_em, created_at").eq("acesso_id", id).order("created_at", { ascending: false }),
    supabase.from("portal_solicitacoes").select("id, numero, tipo, mensagem, status, created_at").eq("pessoa_id", a.pessoa_id).eq("perfil", a.perfil).order("created_at", { ascending: false }).limit(20),
    arquivosParaCompartilhar(supabase, a),
  ]);
  const agora = new Date(agoraMs()).toISOString();
  const sit = situacaoLink(a, agora);
  const link = `${base}/portal/${a.token}`;
  const cod = a.pessoa ? codigoConfirmacao(a.pessoa) : null;
  const grupos = [...new Set(candidatos.map((c) => c.grupo))];

  return (
    <>
      <Cabecalho
        titulo={a.pessoa?.nome ?? "Link do portal"}
        trilha="Portal de clientes"
        descricao={`Portal do ${ROTULO_PERFIL[a.perfil].toLowerCase()}`}
        acoes={
          <>
            {a.pessoa && <BotaoLink href={`/pessoas/${a.pessoa.id}`} variante="secundario">Abrir cadastro</BotaoLink>}
            <BotaoExcluir acao={excluirLinkPortal} id={a.id} variante="botao" rotulo="Excluir link" depois="/portais" confirmar="Excluir este link? Os arquivos compartilhados saem junto; o registro de acessos e os pedidos continuam guardados." />
          </>
        }
      />
      <AbasPortais modo={organizacao.modo} />
      <div className="grid gap-5 lg:grid-cols-[1.2fr_1fr]">
        <Cartao titulo="Link" acoes={<Selo cor={COR_SITUACAO_LINK[sit]}>{ROTULO_SITUACAO_LINK[sit]}</Selo>}>
          <Definicao
            itens={[
              ["Para entrar", cod ? DICA_CODIGO[cod.tipo] : "cadastre CPF/CNPJ ou telefone"],
              ["Gerado em", formatarDataBR(diaLocal(a.created_at))],
              ["Último acesso", a.ultimo_acesso ? `${formatarDataBR(diaLocal(a.ultimo_acesso))} às ${horaLocal(a.ultimo_acesso)}` : "nunca entrou"],
              ["Entradas", String(a.acessos)],
              ["Validade", a.expira_em ? `até ${formatarDataBR(diaLocal(a.expira_em))}` : "sem data para expirar"],
              ["Bloqueado até", a.bloqueado_ate && a.bloqueado_ate > agora ? `${horaLocal(a.bloqueado_ate)} (tentativas erradas)` : "—"],
            ]}
          />
          {a.ativo ? (
            <div className="mt-5 space-y-3">
              <div className="flex flex-wrap items-center gap-2 rounded-[12px] border border-borda bg-elev px-3 py-2">
                <code className="min-w-0 flex-1 truncate text-xs text-texto-2" title={link}>
                  {link}
                </code>
                <Copiar texto={link} rotulo="Copiar" />
              </div>
              <div className="flex flex-wrap gap-2">
                {a.pessoa?.telefone && (
                  <a
                    href={linkWhatsapp(a.pessoa.telefone, mensagemPortal({ nome: a.pessoa.nome, perfil: a.perfil, link, organizacao: organizacao.nome, tipoCodigo: cod?.tipo }))}
                    target="_blank"
                    rel="noreferrer"
                    className={classeBotao("primario")}
                  >
                    <MessageCircle className="size-4" /> Enviar pelo WhatsApp
                  </a>
                )}
                <a href={link} target="_blank" rel="noreferrer" className={classeBotao("secundario")}>
                  <ExternalLink className="size-4" /> Ver como a pessoa vê
                </a>
                <BotaoAcao acao={trocarLinkPortal} id={a.id} confirmar="Trocar o link? O endereço antigo para de funcionar e quem estava dentro precisa entrar de novo.">
                  <RefreshCw className="size-4" /> Trocar link
                </BotaoAcao>
                <BotaoAcao acao={desativarLinkPortal} id={a.id} variante="fantasma" confirmar="Desativar o link? A pessoa não consegue mais entrar até você reativar.">
                  Desativar
                </BotaoAcao>
              </div>
              <Formulario acao={validadeLinkPortal} automatico>
                <input type="hidden" name="id" value={a.id} />
                <Campo rotulo="Validade (a partir de hoje)">
                  <Selecao name="validade" defaultValue="" aria-label="Validade do link">
                    <option value="" disabled>
                      Mudar validade…
                    </option>
                    {VALIDADES_LINK.map((d) => (
                      <option key={d} value={d}>
                        {d === 0 ? "Sem data para expirar" : `${d} dias`}
                      </option>
                    ))}
                  </Selecao>
                </Campo>
              </Formulario>
            </div>
          ) : (
            <div className="mt-5">
              <BotaoAcao acao={reativarLinkPortal} id={a.id} variante="primario">
                Reativar link
              </BotaoAcao>
            </div>
          )}
        </Cartao>

        <Cartao
          titulo="Arquivos compartilhados"
          acoes={
            candidatos.length > 0 ? (
              <JanelaCadastro rotuloBotao={<><FileUp className="size-4" /> Compartilhar</>} titulo="Compartilhar arquivo no portal" acao={compartilharArquivoPortal} icone={<FileUp />} tamanho="sm" variante="secundario" rotuloSalvar="Compartilhar">
                <input type="hidden" name="acesso_id" value={a.id} />
                <Campo rotulo="Arquivo">
                  <Selecao name="arquivo" required defaultValue="">
                    <option value="" disabled>
                      Escolha…
                    </option>
                    {grupos.map((g) => (
                      <optgroup key={g} label={g}>
                        {candidatos
                          .filter((c) => c.grupo === g)
                          .map((c) => (
                            <option key={c.chave} value={c.chave}>
                              {c.titulo}
                            </option>
                          ))}
                      </optgroup>
                    ))}
                  </Selecao>
                </Campo>
                <Campo rotulo="Nome no portal (opcional)">
                  <Entrada name="titulo" maxLength={160} />
                </Campo>
                <Campo rotulo="Pode baixar por">
                  <Selecao name="dias" defaultValue="7">
                    {VALIDADES_ARQUIVO.map((d) => (
                      <option key={d} value={d}>
                        {d === 1 ? "1 dia" : `${d} dias`}
                      </option>
                    ))}
                  </Selecao>
                </Campo>
                <Aviso>O portal mostra um link assinado do arquivo, que para de funcionar no fim do prazo. Ninguém lista ou abre outros arquivos.</Aviso>
              </JanelaCadastro>
            ) : undefined
          }
        >
          {(arquivos ?? []).length === 0 ? (
            <p className="text-sm text-mudo">
              {candidatos.length ? "Nenhum arquivo compartilhado." : "Nenhum arquivo desta pessoa para compartilhar (documentos, comprovantes ou fotos)."}
            </p>
          ) : (
            <ul className="divide-y divide-borda-suave">
              {(arquivos ?? []).map((f) => (
                <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <div>
                    <div className="text-sm font-medium text-texto">{f.titulo}</div>
                    <div className="text-xs text-mudo">{f.expira_em > agora ? `disponível até ${formatarDataBR(diaLocal(f.expira_em))}` : "expirado"}</div>
                  </div>
                  <BotaoExcluir acao={removerArquivoPortal} id={f.id} rotulo="Tirar do portal" confirmar="Tirar este arquivo do portal?" />
                </li>
              ))}
            </ul>
          )}
        </Cartao>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Cartao titulo="Registro de acessos">
          {(eventos ?? []).length === 0 ? (
            <p className="text-sm text-mudo">Nada registrado ainda.</p>
          ) : (
            <ul className="divide-y divide-borda-suave">
              {(eventos ?? []).map((e) => (
                <li key={e.id} className="flex flex-wrap justify-between gap-2 py-2 text-sm">
                  <span>
                    <b className="font-medium">{ROTULO_EVENTO[e.tipo as string] ?? e.tipo}</b> {e.descricao ? <span className="text-texto-2">· {e.descricao}</span> : null}
                  </span>
                  <span className="text-xs text-mudo">
                    {formatarDataBR(diaLocal(e.data as string))} {horaLocal(e.data as string)}
                    {e.ip ? ` · IP ${e.ip}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Cartao>
        <Cartao titulo="Pedidos desta pessoa" acoes={<Link href="/portais/solicitacoes" className="text-sm text-acento hover:underline">Todos os pedidos</Link>}>
          {(pedidos ?? []).length === 0 ? (
            <p className="text-sm text-mudo">Nenhum pedido pelo portal.</p>
          ) : (
            <ul className="divide-y divide-borda-suave">
              {(pedidos ?? []).map((p) => (
                <li key={p.id} className="py-2.5 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">
                      #{p.numero} · {ROTULO_TIPO_SOLICITACAO[p.tipo as TipoSolicitacao] ?? p.tipo}
                    </span>
                    <Selo cor={COR_STATUS_SOLICITACAO[p.status as StatusSolicitacao] ?? "cinza"}>{ROTULO_STATUS_SOLICITACAO[p.status as StatusSolicitacao] ?? p.status}</Selo>
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-texto-2">{p.mensagem}</p>
                </li>
              ))}
            </ul>
          )}
        </Cartao>
      </div>
    </>
  );
}
