import type { Metadata } from "next";
import Link from "next/link";
import { Frown, Meh, MessageSquareHeart, Smile, SmilePlus } from "lucide-react";
import { Contador } from "@/components/abas-segmentadas";
import { BotaoExcluir } from "@/components/botao-excluir";
import { Copiar } from "@/components/copiar";
import { JanelaCadastro } from "@/components/janela-cadastro";
import { PilulasLink } from "@/components/pilulas-link";
import { Cabecalho, Campo, Celula, Entrada, Indicador, LinhaVazia, Selecao, Selo, Tabela } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { agoraMs } from "@/lib/dominio/datas";
import { calcularNps, classeNota, formatarDataHora } from "@/lib/dominio/marketing";
import { criarPesquisa, excluirPesquisa } from "../actions";
import { AbasMarketing, opcoesContato, SelecaoCanal, SelecaoContato } from "../campos";
import { todas, urlBase } from "../dados";

export const metadata: Metadata = { title: "Pesquisas de satisfação" };

const CONTEXTO: Record<string, string> = { pos_venda: "Pós-venda", pos_locacao: "Pós-locação", atendimento: "Atendimento", geral: "Geral" };
const FILTROS: Record<string, string> = { "": "Todas", respondidas: "Respondidas", aguardando: "Aguardando resposta", detratores: "Notas até 6" };

export default async function PesquisasPage({ searchParams }: PageProps<"/marketing/pesquisas">) {
  const sp = await searchParams;
  const filtro = typeof sp.filtro === "string" && sp.filtro in FILTROS ? sp.filtro : "";
  const { supabase } = await obterContexto();
  const base = await urlBase();
  const agora = agoraMs();
  let q = supabase.from("mkt_pesquisas").select("*").order("created_at", { ascending: false }).limit(500);
  if (filtro === "respondidas") q = q.not("respondida_em", "is", null);
  if (filtro === "aguardando") q = q.is("respondida_em", null);
  if (filtro === "detratores") q = q.lte("nota", 6);
  const [{ data }, notas, opcoes] = await Promise.all([
    q,
    todas<{ id: string; nota: number }>(() =>
      supabase.from("mkt_pesquisas").select("id, nota").not("nota", "is", null).gte("respondida_em", new Date(agora - 365 * 86_400_000).toISOString()).order("id"),
    ),
    opcoesContato(supabase),
  ]);
  const nps = calcularNps(notas.map((n) => n.nota));
  type P = {
    id: string;
    token: string;
    contexto: string;
    nome: string | null;
    telefone: string | null;
    email: string | null;
    pessoa_id: string | null;
    lead_id: string | null;
    enviada_em: string | null;
    respondida_em: string | null;
    nota: number | null;
    comentario: string | null;
    created_at: string;
  };
  const pesquisas = (data ?? []) as P[];
  const url = (k: string) => (k ? `/marketing/pesquisas?filtro=${k}` : "/marketing/pesquisas");

  return (
    <>
      <Cabecalho
        titulo="Pesquisas de satisfação"
        trilha="Marketing"
        descricao="Uma pergunta de 0 a 10 por link (NPS). Notas até 6 viram tarefa de retorno no Comercial; toda resposta entra no histórico do cliente. As automações de pós-venda e pós-locação mandam sozinhas com {{link_pesquisa}}."
        acoes={
          <JanelaCadastro rotuloBotao={<><MessageSquareHeart className="size-4" /> Nova pesquisa</>} titulo="Nova pesquisa de satisfação" acao={criarPesquisa} icone={<MessageSquareHeart />}>
            <Campo rotulo="Contato">
              <SelecaoContato opcoes={opcoes} />
            </Campo>
            <div className="grid gap-4 sm:grid-cols-3">
              <Campo rotulo="Ou nome">
                <Entrada name="nome" />
              </Campo>
              <Campo rotulo="Telefone">
                <Entrada name="telefone" inputMode="tel" />
              </Campo>
              <Campo rotulo="E-mail">
                <Entrada name="email" type="email" />
              </Campo>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Campo rotulo="Sobre">
                <Selecao name="contexto" defaultValue="atendimento">
                  {Object.entries(CONTEXTO).map(([k, r]) => (
                    <option key={k} value={k}>
                      {r}
                    </option>
                  ))}
                </Selecao>
              </Campo>
              <Campo rotulo="Mandar por">
                <SelecaoCanal />
              </Campo>
            </div>
            <p className="text-xs text-mudo">O convite entra na fila de envio com o link da pesquisa (o link também fica aqui para copiar).</p>
          </JanelaCadastro>
        }
      />
      <AbasMarketing />
      <div className="entrar-cascata mb-6 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Indicador
          rotulo="NPS (12 meses)"
          icone={<Smile />}
          valor={nps.nps === null ? "—" : <Contador valor={nps.nps} />}
          detalhe={`${nps.respostas} resposta(s)${nps.media !== null ? ` · média ${String(nps.media).replace(".", ",")}` : ""}`}
          tom={nps.nps === null ? "neutro" : nps.nps >= 50 ? "sucesso" : nps.nps < 0 ? "perigo" : "alerta"}
        />
        <Indicador rotulo="Promotores (9–10)" icone={<SmilePlus />} valor={<Contador valor={nps.promotores} />} tom="sucesso" />
        <Indicador rotulo="Neutros (7–8)" icone={<Meh />} valor={<Contador valor={nps.neutros} />} />
        <Indicador rotulo="Detratores (0–6)" icone={<Frown />} valor={<Contador valor={nps.detratores} />} tom={nps.detratores ? "perigo" : "neutro"} href={url("detratores")} />
      </div>
      <PilulasLink className="mb-4" rotulo="Pesquisas" ativo={url(filtro)} itens={Object.entries(FILTROS).map(([k, r]) => ({ href: url(k), rotulo: r }))} />
      <Tabela colunas={["Cliente", "Sobre", "Situação", "Nota", "Comentário", ""]}>
        {pesquisas.map((p) => {
          const link = `${base}/pesquisa/${p.token}`;
          const classe = p.nota === null ? null : classeNota(p.nota);
          return (
            <tr key={p.id}>
              <Celula>
                {p.pessoa_id ? (
                  <Link href={`/pessoas/${p.pessoa_id}`} className="font-semibold text-acento hover:underline">
                    {p.nome ?? "—"}
                  </Link>
                ) : p.lead_id ? (
                  <Link href={`/comercial/leads/${p.lead_id}`} className="font-semibold text-acento hover:underline">
                    {p.nome ?? "—"}
                  </Link>
                ) : (
                  <span className="font-semibold">{p.nome ?? "—"}</span>
                )}
                <span className="block text-xs text-mudo">{p.telefone ?? p.email ?? ""}</span>
              </Celula>
              <Celula className="text-sm text-texto-2">{CONTEXTO[p.contexto] ?? p.contexto}</Celula>
              <Celula className="text-xs text-texto-2">
                {p.respondida_em ? `respondeu ${formatarDataHora(p.respondida_em)}` : p.enviada_em ? `enviada ${formatarDataHora(p.enviada_em)}` : `criada ${formatarDataHora(p.created_at)}`}
              </Celula>
              <Celula>
                {p.nota === null ? (
                  <Selo>—</Selo>
                ) : (
                  <Selo cor={classe === "promotor" ? "verde" : classe === "neutro" ? "amarelo" : "vermelho"}>{p.nota}</Selo>
                )}
              </Celula>
              <Celula className="max-w-[320px] text-[13px] text-texto-2">{p.comentario ?? ""}</Celula>
              <Celula>
                <div className="flex items-center justify-end gap-2">
                  {!p.respondida_em && <Copiar texto={link} rotulo="Copiar link" />}
                  <BotaoExcluir acao={excluirPesquisa} id={p.id} rotulo="Excluir pesquisa" confirmar="Excluir esta pesquisa? O link para de funcionar." />
                </div>
              </Celula>
            </tr>
          );
        })}
        {pesquisas.length === 0 && <LinhaVazia colunas={6}>Nenhuma pesquisa aqui.</LinhaVazia>}
      </Tabela>
    </>
  );
}
