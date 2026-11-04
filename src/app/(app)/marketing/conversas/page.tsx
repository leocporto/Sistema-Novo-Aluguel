import type { Metadata } from "next";
import { MessageSquarePlus } from "lucide-react";
import { BotaoExcluir } from "@/components/botao-excluir";
import { FiltroAutomatico } from "@/components/filtro-automatico";
import { JanelaCadastro } from "@/components/janela-cadastro";
import { LinhaLink } from "@/components/linha-link";
import { PilulasLink } from "@/components/pilulas-link";
import { AreaTexto, Cabecalho, Campo, Celula, Entrada, LinhaVazia, Selecao, Selo, Tabela } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { formatarDataHora, ROTULO_STATUS_CONVERSA } from "@/lib/dominio/marketing";
import { criarConversa, excluirConversa } from "../actions";
import { AbasMarketing, SeloCanal } from "../campos";
import { carregarMembros } from "../dados";

export const metadata: Metadata = { title: "Conversas" };

const FILTROS: Record<string, string> = { "": "Esperando resposta", minhas: "Minhas", sem: "Sem responsável", aguardando: "Esperando o cliente", resolvida: "Resolvidas", todas: "Todas" };

export default async function ConversasPage({ searchParams }: PageProps<"/marketing/conversas">) {
  const sp = await searchParams;
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const filtro = s("filtro") in FILTROS ? s("filtro") : "";
  const busca = s("busca").replace(/[%,()]/g, " ").trim();
  const { supabase, usuario } = await obterContexto();

  let q = supabase.from("mkt_conversas").select("*").order("ultima_em", { ascending: false }).limit(500);
  if (filtro === "") q = q.eq("status", "aberta");
  if (filtro === "minhas") q = q.eq("responsavel_id", usuario.id).neq("status", "resolvida");
  if (filtro === "sem") q = q.is("responsavel_id", null).neq("status", "resolvida");
  if (filtro === "aguardando" || filtro === "resolvida") q = q.eq("status", filtro);
  if (busca) q = q.or(`nome.ilike.%${busca}%,contato.ilike.%${busca}%,ultima_mensagem.ilike.%${busca}%`);
  const [{ data }, membros] = await Promise.all([q, carregarMembros(supabase)]);
  const nomes = new Map(membros.map((m) => [m.user_id, m.nome]));
  type C = { id: string; canal: string; contato: string; nome: string | null; responsavel_id: string | null; status: string; nao_lidas: number; ultima_mensagem: string | null; ultima_em: string; lead_id: string | null; pessoa_id: string | null };
  const conversas = (data ?? []) as C[];
  const url = (k: string) => {
    const p = new URLSearchParams(Object.entries({ filtro: k, busca }).filter(([, v]) => v) as [string, string][]);
    return `/marketing/conversas${p.size ? `?${p}` : ""}`;
  };

  return (
    <>
      <Cabecalho
        titulo="Conversas"
        trilha="Marketing"
        descricao="Caixa de entrada compartilhada: mensagens do WhatsApp Business (pelo webhook) e as registradas à mão, com responsável e situação. Tudo entra no histórico do lead ou da pessoa."
        acoes={
          <JanelaCadastro rotuloBotao={<><MessageSquarePlus className="size-4" /> Registrar conversa</>} titulo="Registrar conversa" acao={criarConversa} icone={<MessageSquarePlus />}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Campo rotulo="Canal">
                <Selecao name="canal" defaultValue="whatsapp">
                  <option value="whatsapp">WhatsApp</option>
                  <option value="email">E-mail</option>
                  <option value="sms">SMS</option>
                  <option value="outro">Outro</option>
                </Selecao>
              </Campo>
              <Campo rotulo="Telefone ou e-mail">
                <Entrada name="contato" required placeholder="(11) 99999-9999" />
              </Campo>
            </div>
            <Campo rotulo="Nome (opcional)">
              <Entrada name="nome" />
            </Campo>
            <div className="grid gap-4 sm:grid-cols-[1fr_180px]">
              <Campo rotulo="Primeira mensagem (opcional)">
                <AreaTexto name="texto" rows={3} />
              </Campo>
              <Campo rotulo="Quem mandou">
                <Selecao name="direcao" defaultValue="entrada">
                  <option value="entrada">O cliente</option>
                  <option value="saida">Nós</option>
                </Selecao>
              </Campo>
            </div>
          </JanelaCadastro>
        }
      />
      <AbasMarketing />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <PilulasLink rotulo="Conversas" ativo={url(filtro)} itens={Object.entries(FILTROS).map(([k, r]) => ({ href: url(k), rotulo: r }))} />
        <FiltroAutomatico className="flex flex-wrap gap-2">
          {filtro && <input type="hidden" name="filtro" value={filtro} />}
          <Entrada name="busca" aria-label="Buscar conversas" defaultValue={busca} placeholder="Buscar nome, telefone ou mensagem…" className="max-w-80" />
        </FiltroAutomatico>
      </div>
      <Tabela colunas={["Contato", "Última mensagem", "Responsável", "Situação", ""]}>
        {conversas.map((c) => (
          <LinhaLink key={c.id} href={`/marketing/conversas/${c.id}`}>
            <Celula>
              <span className="flex items-center gap-2 font-semibold text-texto">
                {c.nome ?? (c.canal === "email" ? c.contato : `+${c.contato}`)}
                {c.nao_lidas > 0 && <Selo cor="vermelho">{c.nao_lidas} nova(s)</Selo>}
              </span>
              <span className="mt-1 flex items-center gap-1.5 text-xs text-mudo">
                <SeloCanal canal={c.canal} /> {c.lead_id ? "lead" : c.pessoa_id ? "cadastro" : "sem vínculo"}
              </span>
            </Celula>
            <Celula className="max-w-[380px]">
              <span className="line-clamp-2 text-[13px] text-texto-2">{c.ultima_mensagem ?? "—"}</span>
              <span className="block text-xs text-mudo">{formatarDataHora(c.ultima_em)}</span>
            </Celula>
            <Celula className="text-sm text-texto-2">{c.responsavel_id ? (nomes.get(c.responsavel_id) ?? "—") : <Selo cor="amarelo">ninguém</Selo>}</Celula>
            <Celula>
              <Selo cor={c.status === "aberta" ? "amarelo" : c.status === "aguardando" ? "azul" : "verde"}>{ROTULO_STATUS_CONVERSA[c.status] ?? c.status}</Selo>
            </Celula>
            <Celula>
              <BotaoExcluir acao={excluirConversa} id={c.id} rotulo="Excluir conversa" confirmar="Excluir a conversa e as mensagens dela? (O que já foi para o histórico do lead/pessoa continua lá.)" />
            </Celula>
          </LinhaLink>
        ))}
        {conversas.length === 0 && <LinhaVazia colunas={5}>Nenhuma conversa aqui.</LinhaVazia>}
      </Tabela>
    </>
  );
}
