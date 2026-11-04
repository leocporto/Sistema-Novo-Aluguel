import type { Metadata } from "next";
import { KeyRound, Link2, MessageCircle, Power, RefreshCw } from "lucide-react";
import { BotaoAcao } from "@/components/botao-acao";
import { BotaoExcluir } from "@/components/botao-excluir";
import { Copiar } from "@/components/copiar";
import { JanelaCadastro } from "@/components/janela-cadastro";
import { Aviso, Campo, Cartao, Celula, LinhaVazia, Selecao, Selo, Tabela, classeBotao } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { PAPEIS_CONDOMINIO, mensagemPortalCondominio } from "@/lib/dominio/condominios";
import { agoraMs, formatarDataLocal } from "@/lib/dominio/datas";
import { COR_SITUACAO_LINK, DICA_CODIGO, ROTULO_SITUACAO_LINK, VALIDADES_LINK, codigoConfirmacao, situacaoLink } from "@/lib/dominio/portal";
import { linkWhatsapp } from "@/lib/whatsapp";
import { desativarLinkCondominio, excluirLinkCondominio, gerarLinkCondominio, reativarLinkCondominio, trocarLinkCondominio } from "../../actions-gestao";
import { carregarCondominio, urlBase, vinculosDo } from "../../dados";
import { todas } from "../../../financeiro/dados";

export const metadata: Metadata = { title: "Portal do condômino" };

type Acesso = {
  id: string;
  token: string;
  ativo: boolean;
  expira_em: string | null;
  bloqueado_ate: string | null;
  ultimo_acesso: string | null;
  acessos: number;
  pessoa_id: string;
  pessoa: { nome: string; documento: string | null; telefone: string | null } | null;
};

const ROTULO_EVENTO: Record<string, string> = {
  gerado: "Link gerado",
  entrada: "Entrou",
  falha: "Errou os números",
  bloqueio: "Entrada bloqueada",
  saida: "Saiu",
  trocado: "Link trocado",
  revogado: "Link desativado",
  reativado: "Link reativado",
  excluido: "Link excluído",
  reserva: "Pediu reserva",
  reserva_cancelada: "Cancelou reserva",
  ocorrencia: "Abriu ocorrência",
  resposta: "Respondeu ocorrência",
  voto: "Votou",
};

/**
 * Portal do condômino: link pessoal por pessoa (condômino, inquilino,
 * morador, síndico…). A pessoa entra em /condominio/<link> confirmando 4
 * números (CPF/CNPJ ou telefone) e vê cotas (2ª via e Pix), comunicados,
 * reservas, ocorrências, assembleias, documentos e a prestação de contas.
 */
export default async function PortalCondominioPage({ params }: PageProps<"/condominios/[id]/portal">) {
  const { id } = await params;
  const { supabase, organizacao } = await obterContexto();
  const [c, base, vinculos, acessos, { data: eventos }] = await Promise.all([
    carregarCondominio(supabase, id),
    urlBase(),
    vinculosDo(supabase, id),
    todas<Acesso>(() =>
      supabase
        .from("cond_portal_acessos")
        .select("id, token, ativo, expira_em, bloqueado_ate, ultimo_acesso, acessos, pessoa_id, pessoa:pessoas(nome, documento, telefone)")
        .eq("condominio_id", id)
        .order("created_at", { ascending: false })
        .order("id"),
    ),
    supabase.from("cond_portal_eventos").select("id, tipo, descricao, pessoa_nome, ip, data").eq("condominio_id", id).order("data", { ascending: false }).limit(80),
  ]);
  const agora = new Date(agoraMs()).toISOString();
  const comLink = new Set(acessos.filter((a) => a.ativo).map((a) => a.pessoa_id));
  const papeis = new Map<string, { nome: string; papeis: string[] }>();
  for (const v of vinculos) {
    if (!v.pessoa) continue;
    const p = papeis.get(v.pessoa_id) ?? { nome: v.pessoa.nome, papeis: [] };
    p.papeis.push(PAPEIS_CONDOMINIO[v.papel as keyof typeof PAPEIS_CONDOMINIO] ?? v.papel);
    papeis.set(v.pessoa_id, p);
  }
  const candidatos = [...papeis.entries()].filter(([pid]) => !comLink.has(pid)).sort((a, b) => a[1].nome.localeCompare(b[1].nome, "pt-BR"));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-3xl text-sm text-texto-2">
          Cada pessoa ligada ao condomínio pode ter um link pessoal. Ela confirma quem é com 4 números do CPF/CNPJ (ou do telefone); 5 erros bloqueiam por 30 minutos. Trocar ou desativar o link derruba quem estava dentro.
        </p>
        <JanelaCadastro rotuloBotao={<><Link2 className="size-4" /> Gerar link</>} titulo="Link do portal do condômino" acao={gerarLinkCondominio} icone={<KeyRound />} rotuloSalvar="Gerar">
          <input type="hidden" name="condominio_id" value={id} />
          <Campo rotulo="Pessoa (ligada ao condomínio)">
            <Selecao name="pessoa_id" required defaultValue="">
              <option value="" disabled>
                Escolha…
              </option>
              {candidatos.map(([pid, p]) => (
                <option key={pid} value={pid}>
                  {p.nome} — {[...new Set(p.papeis)].join(", ")}
                </option>
              ))}
            </Selecao>
          </Campo>
          <Campo rotulo="Validade">
            <Selecao name="validade" defaultValue="365">
              {VALIDADES_LINK.map((d) => (
                <option key={d} value={d}>
                  {d === 0 ? "Sem data para expirar" : `${d} dias`}
                </option>
              ))}
            </Selecao>
          </Campo>
        </JanelaCadastro>
      </div>
      {candidatos.length === 0 && acessos.length === 0 && <Aviso>Ligue as pessoas ao condomínio (aba Pessoas) antes de gerar os links.</Aviso>}

      <Tabela colunas={["Pessoa", "Situação", "Último acesso", "Link", ""]}>
        {acessos.map((a) => {
          const sit = situacaoLink(a, agora);
          const link = `${base}/condominio/${a.token}`;
          const cod = a.pessoa ? codigoConfirmacao(a.pessoa) : null;
          const msg = mensagemPortalCondominio({ nome: a.pessoa?.nome ?? "", condominio: c?.nome ?? "condomínio", link, organizacao: organizacao.nome, dica: cod ? DICA_CODIGO[cod.tipo] : null });
          return (
            <tr key={a.id} className={a.ativo ? "" : "opacity-60"}>
              <Celula>
                <span className="font-medium text-texto">{a.pessoa?.nome ?? "—"}</span>
                <span className="block text-xs text-mudo">{papeis.get(a.pessoa_id)?.papeis.join(", ") ?? "sem vínculo em vigor"}</span>
              </Celula>
              <Celula>
                <Selo cor={COR_SITUACAO_LINK[sit]}>{ROTULO_SITUACAO_LINK[sit]}</Selo>
                {a.expira_em && <span className="block text-xs text-mudo">até {formatarDataLocal(a.expira_em)}</span>}
              </Celula>
              <Celula className="text-sm text-texto-2">
                {a.ultimo_acesso ? formatarDataLocal(a.ultimo_acesso) : "nunca entrou"}
                <span className="block text-xs text-mudo">{a.acessos} entrada(s)</span>
              </Celula>
              <Celula>
                {a.ativo && (
                  <span className="flex flex-wrap gap-2">
                    <Copiar texto={link} rotulo="Copiar link" />
                    {a.pessoa?.telefone && (
                      <a href={linkWhatsapp(a.pessoa.telefone, msg)} target="_blank" rel="noreferrer" className={classeBotao("secundario", "sm")}>
                        <MessageCircle className="size-3.5" /> WhatsApp
                      </a>
                    )}
                  </span>
                )}
              </Celula>
              <Celula>
                <span className="flex justify-end gap-2">
                  <BotaoAcao acao={trocarLinkCondominio} id={a.id} tamanho="sm" confirmar="Trocar o link? O endereço antigo para de funcionar e quem estava dentro precisa entrar de novo.">
                    <RefreshCw className="size-3.5" /> Trocar
                  </BotaoAcao>
                  {a.ativo ? (
                    <BotaoAcao acao={desativarLinkCondominio} id={a.id} tamanho="sm" variante="fantasma" confirmar="Desativar este link?">
                      <Power className="size-3.5" /> Desativar
                    </BotaoAcao>
                  ) : (
                    <BotaoAcao acao={reativarLinkCondominio} id={a.id} tamanho="sm">
                      <Power className="size-3.5" /> Reativar
                    </BotaoAcao>
                  )}
                  <BotaoExcluir acao={excluirLinkCondominio} id={a.id} rotulo="Excluir link" confirmar="Excluir este link? O registro de acessos fica guardado." />
                </span>
              </Celula>
            </tr>
          );
        })}
        {acessos.length === 0 && <LinhaVazia colunas={5}>Nenhum link gerado.</LinhaVazia>}
      </Tabela>

      <Cartao titulo="Registro de acessos e pedidos pelo portal">
        {(eventos ?? []).length === 0 ? (
          <p className="text-sm text-mudo">Nada registrado ainda.</p>
        ) : (
          <ul className="space-y-1.5 text-sm">
            {(eventos ?? []).map((e) => (
              <li key={e.id as string} className="flex flex-wrap gap-2 text-texto-2">
                <span className="w-36 shrink-0 text-xs text-mudo">{formatarDataLocal(e.data as string)}</span>
                <Selo cor={e.tipo === "falha" || e.tipo === "bloqueio" ? "vermelho" : "cinza"}>{ROTULO_EVENTO[e.tipo as string] ?? (e.tipo as string)}</Selo>
                <span>
                  {(e.pessoa_nome as string | null) ?? ""} {e.descricao ? `— ${e.descricao as string}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Cartao>
    </div>
  );
}
