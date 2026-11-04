import type { Metadata } from "next";
import Link from "next/link";
import { Building2, HardHat, KeyRound, Link2, MessageCircle, RefreshCw, UserRound, Users } from "lucide-react";
import { Contador } from "@/components/abas-segmentadas";
import { BotaoAcao } from "@/components/botao-acao";
import { BotaoExcluir } from "@/components/botao-excluir";
import { Copiar } from "@/components/copiar";
import { FiltroAutomatico } from "@/components/filtro-automatico";
import { JanelaCadastro } from "@/components/janela-cadastro";
import { LinhaLink } from "@/components/linha-link";
import { PilulasLink } from "@/components/pilulas-link";
import { Aviso, Cabecalho, Campo, Celula, Entrada, Indicador, LinhaVazia, Selecao, Selo, Tabela, classeBotao } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { diaLocal, horaLocal } from "@/lib/dominio/agenda";
import { agoraMs, formatarDataBR } from "@/lib/dominio/datas";
import { normalizar } from "@/lib/dominio/imoveis";
import {
  COR_SITUACAO_LINK,
  ROTULO_PERFIL,
  ROTULO_SITUACAO_LINK,
  VALIDADES_LINK,
  codigoConfirmacao,
  ehPerfilPortal,
  mensagemPortal,
  perfisDoModo,
  situacaoLink,
  type PerfilPortal,
} from "@/lib/dominio/portal";
import { linkWhatsapp } from "@/lib/whatsapp";
import { AbasPortais } from "./abas";
import { desativarLinkPortal, excluirLinkPortal, gerarLinkPortal, reativarLinkPortal, trocarLinkPortal } from "./actions";
import { SELECT_ACESSO, pessoasDoPerfil, urlBase, type Acesso, type Opcao } from "./dados";

export const metadata: Metadata = { title: "Portal de clientes" };

const ICONE: Record<PerfilPortal, React.ReactNode> = { proprietario: <Building2 />, locatario: <KeyRound />, prestador: <HardHat /> };

function rotuloValidade(d: number) {
  return d === 0 ? "Sem data para expirar" : `${d} dias`;
}

function JanelaLink({ perfil, pessoas }: { perfil: PerfilPortal; pessoas: Opcao[] }) {
  return (
    <JanelaCadastro
      rotuloBotao={
        <>
          <Link2 className="size-4" /> {ROTULO_PERFIL[perfil]}
        </>
      }
      variante={perfil === "locatario" ? "primario" : "secundario"}
      titulo={`Link do portal: ${ROTULO_PERFIL[perfil].toLowerCase()}`}
      acao={gerarLinkPortal}
      icone={ICONE[perfil]}
      rotuloSalvar="Gerar link"
    >
      <input type="hidden" name="perfil" value={perfil} />
      <Campo rotulo="Pessoa" dica="Precisa ter CPF/CNPJ ou telefone no cadastro: é com ele que a pessoa confirma quem é.">
        <Selecao name="pessoa_id" required defaultValue="">
          <option value="" disabled>
            Escolha…
          </option>
          {pessoas.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nome}
            </option>
          ))}
        </Selecao>
      </Campo>
      <Campo rotulo="Validade do link">
        <Selecao name="validade" defaultValue="0">
          {VALIDADES_LINK.map((d) => (
            <option key={d} value={d}>
              {rotuloValidade(d)}
            </option>
          ))}
        </Selecao>
      </Campo>
    </JanelaCadastro>
  );
}

/**
 * Portal de clientes (nos dois modos; proprietário só na imobiliária): um link
 * pessoal por pessoa e perfil, com confirmação de identidade, registro de
 * acessos, troca e desativação.
 */
export default async function PortaisPage({ searchParams }: PageProps<"/portais">) {
  const sp = await searchParams;
  const { supabase, organizacao, papel } = await obterContexto();
  const perfis = perfisDoModo(organizacao.modo);
  const filtro = typeof sp.perfil === "string" && ehPerfilPortal(sp.perfil) && perfis.includes(sp.perfil) ? sp.perfil : "";
  const busca = typeof sp.busca === "string" ? sp.busca : "";

  if (papel === "corretor")
    return (
      <>
        <Cabecalho titulo="Portal de clientes" descricao="Links pessoais para proprietários, locatários e prestadores acompanharem tudo sem senha." />
        <Aviso>Só administradores, gestores e o financeiro cuidam dos links do portal. O seu portal está em “Meu portal (corretor)”.</Aviso>
      </>
    );

  const [{ data }, pessoas, base, { count: novos }] = await Promise.all([
    supabase.from("portal_acessos").select(SELECT_ACESSO).order("created_at", { ascending: false }).limit(2000),
    pessoasDoPerfil(supabase),
    urlBase(),
    supabase.from("portal_solicitacoes").select("id", { count: "exact", head: true }).eq("status", "nova"),
  ]);
  const ms = agoraMs();
  const agora = new Date(ms).toISOString();
  const haUmMes = new Date(ms - 30 * 86_400_000).toISOString();
  let lista = ((data ?? []) as unknown as Acesso[]).filter((a) => perfis.includes(a.perfil));
  const contar = (p: PerfilPortal) => lista.filter((a) => a.perfil === p && a.ativo).length;
  const ativos = lista.filter((a) => situacaoLink(a, agora) === "ativo").length;
  const entraram = lista.filter((a) => a.ultimo_acesso && a.ultimo_acesso > haUmMes).length;
  if (filtro) lista = lista.filter((a) => a.perfil === filtro);
  if (busca) {
    const b = normalizar(busca);
    lista = lista.filter((a) => normalizar(a.pessoa?.nome ?? "").includes(b));
  }
  const url = (q: Record<string, string>) => {
    const p = new URLSearchParams({ ...(busca ? { busca } : {}), ...q });
    const s = p.toString();
    return `/portais${s ? `?${s}` : ""}`;
  };

  return (
    <>
      <Cabecalho
        titulo="Portal de clientes"
        descricao="Cada pessoa recebe um link pessoal para acompanhar tudo sem senha: ela confirma quem é com os 4 primeiros números do CPF/CNPJ (ou os 4 últimos do telefone) e só vê o que é dela."
        acoes={
          <>
            {perfis.map((p) => (
              <JanelaLink key={p} perfil={p} pessoas={pessoas[p]} />
            ))}
          </>
        }
      />
      <AbasPortais modo={organizacao.modo} />
      <div className="entrar-cascata mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Indicador rotulo="Links ativos" valor={<Contador valor={ativos} />} icone={<Link2 />} />
        <Indicador rotulo="Entraram nos últimos 30 dias" valor={<Contador valor={entraram} />} icone={<Users />} tom="sucesso" />
        <Indicador rotulo="Pedidos novos" valor={<Contador valor={novos ?? 0} />} icone={<MessageCircle />} tom={novos ? "alerta" : "neutro"} href="/portais/solicitacoes" />
        <Indicador
          rotulo="Por perfil"
          valor={<span className="text-[18px]">{perfis.map((p) => `${contar(p)} ${ROTULO_PERFIL[p].split(" ")[0].toLowerCase()}`).join(" · ")}</span>}
          icone={<UserRound />}
        />
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <PilulasLink
          rotulo="Perfil"
          ativo={url(filtro ? { perfil: filtro } : {})}
          itens={[{ href: url({}), rotulo: "Todos" }, ...perfis.map((p) => ({ href: url({ perfil: p }), rotulo: ROTULO_PERFIL[p] }))]}
        />
        <FiltroAutomatico className="barra-filtros flex flex-wrap gap-2">
          {filtro && <input type="hidden" name="perfil" value={filtro} />}
          <Entrada name="busca" defaultValue={busca} placeholder="Buscar pessoa…" aria-label="Buscar pessoa" className="max-w-72" />
        </FiltroAutomatico>
      </div>
      <Tabela colunas={["Pessoa", "Perfil", "Situação", "Último acesso", "Link", ""]}>
        {lista.length === 0 && <LinhaVazia colunas={6}>Nenhum link ainda. Use os botões acima para gerar.</LinhaVazia>}
        {lista.map((a) => {
          const sit = situacaoLink(a, agora);
          const link = `${base}/portal/${a.token}`;
          const cod = a.pessoa ? codigoConfirmacao(a.pessoa) : null;
          return (
            <LinhaLink key={a.id} href={`/portais/${a.id}`}>
              <Celula>
                <span className="font-medium">{a.pessoa?.nome ?? "—"}</span>
                {a.expira_em && <span className="block text-xs text-mudo">vale até {formatarDataBR(diaLocal(a.expira_em))}</span>}
              </Celula>
              <Celula>{ROTULO_PERFIL[a.perfil]}</Celula>
              <Celula>
                <Selo cor={COR_SITUACAO_LINK[sit]}>{ROTULO_SITUACAO_LINK[sit]}</Selo>
              </Celula>
              <Celula className="text-sm">
                {a.ultimo_acesso ? `${formatarDataBR(diaLocal(a.ultimo_acesso))} às ${horaLocal(a.ultimo_acesso)}` : <span className="text-mudo">nunca entrou</span>}
                {a.acessos > 0 && <span className="block text-xs text-mudo">{a.acessos} entrada(s)</span>}
              </Celula>
              <Celula>
                {a.ativo ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <Copiar texto={link} rotulo="Copiar link" />
                    {a.pessoa?.telefone && (
                      <a
                        href={linkWhatsapp(a.pessoa.telefone, mensagemPortal({ nome: a.pessoa.nome, perfil: a.perfil, link, organizacao: organizacao.nome, tipoCodigo: cod?.tipo }))}
                        target="_blank"
                        rel="noreferrer"
                        className={classeBotao("secundario", "sm")}
                      >
                        <MessageCircle className="size-3.5" /> WhatsApp
                      </a>
                    )}
                  </div>
                ) : (
                  <span className="text-xs text-mudo">desativado{a.revogado_em ? ` em ${formatarDataBR(diaLocal(a.revogado_em))}` : ""}</span>
                )}
              </Celula>
              <Celula>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  {a.ativo ? (
                    <>
                      <BotaoAcao acao={trocarLinkPortal} id={a.id} tamanho="sm" confirmar="Trocar o link? O endereço antigo para de funcionar e você precisa mandar o novo.">
                        <RefreshCw className="size-3.5" /> Trocar
                      </BotaoAcao>
                      <BotaoAcao acao={desativarLinkPortal} id={a.id} tamanho="sm" variante="fantasma" confirmar="Desativar o link? A pessoa não consegue mais entrar até você reativar.">
                        Desativar
                      </BotaoAcao>
                    </>
                  ) : (
                    <BotaoAcao acao={reativarLinkPortal} id={a.id} tamanho="sm" variante="primario">
                      Reativar
                    </BotaoAcao>
                  )}
                  <BotaoExcluir acao={excluirLinkPortal} id={a.id} rotulo="Excluir link" confirmar="Excluir este link? Os arquivos compartilhados saem junto; o registro de acessos e os pedidos continuam guardados." />
                </div>
              </Celula>
            </LinhaLink>
          );
        })}
      </Tabela>
      <p className="mt-4 text-xs text-mudo">
        O envio automático por WhatsApp Business, SMS ou e-mail fica pronto para ligar quando houver a integração contratada; por enquanto o botão abre o WhatsApp
        com a mensagem pronta. Documentos, recibos, extratos e o informe de rendimentos aparecem no portal como páginas para imprimir; arquivos (PDF e fotos) só
        quando você compartilha na ficha do link. <Link href="/portais/solicitacoes" className="text-acento hover:underline">Ver pedidos recebidos</Link>.
      </p>
    </>
  );
}
