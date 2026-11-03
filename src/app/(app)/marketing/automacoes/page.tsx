import type { Metadata } from "next";
import Link from "next/link";
import { Play, Workflow } from "lucide-react";
import { BotaoAcao } from "@/components/botao-acao";
import { BotaoExcluir } from "@/components/botao-excluir";
import { JanelaCadastro } from "@/components/janela-cadastro";
import { LinhaLink } from "@/components/linha-link";
import { Aviso, Cabecalho, Cartao, Celula, LinhaVazia, Selo, Tabela } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { formatarReais } from "@/lib/dominio/dinheiro";
import { formatarDataHora, reducaoPct, ROTULO_CANAL, ROTULO_GATILHO, type Canal, type Gatilho } from "@/lib/dominio/marketing";
import { criarAutomacao, excluirAutomacao, rodarAutomacoes } from "../actions";
import { AbasMarketing } from "../campos";
import { obterConfig } from "../dados";
import { CamposAutomacao } from "./campos-automacao";

export const metadata: Metadata = { title: "Automações" };

export default async function AutomacoesPage() {
  const { supabase } = await obterContexto();
  const [{ data }, { data: modelos }, { data: eventos }, cfg] = await Promise.all([
    supabase.from("mkt_automacoes").select("*, modelo:mkt_modelos(nome), mkt_execucoes(count), mkt_envios(count)").order("created_at"),
    supabase.from("mkt_modelos").select("id, nome, canal").eq("ativo", true).order("nome"),
    supabase.from("mkt_eventos").select("id, tipo, criado_em, processado_em, resultado, valor_anterior, valor_novo, imovel:imoveis(id, codigo)").order("criado_em", { ascending: false }).limit(15),
    obterConfig(supabase),
  ]);
  type A = {
    id: string;
    nome: string;
    gatilho: Gatilho;
    acao: string;
    canal: Canal;
    dias: number;
    reducao_min_pct: number;
    ativa: boolean;
    modelo: { nome: string } | null;
    mkt_execucoes: { count: number }[];
    mkt_envios: { count: number }[];
  };
  const autos = (data ?? []) as unknown as A[];
  type E = { id: string; tipo: string; criado_em: string; processado_em: string | null; resultado: string | null; valor_anterior: number | null; valor_novo: number | null; imovel: { id: string; codigo: string } | null };

  return (
    <>
      <Cabecalho
        titulo="Automações"
        trilha="Marketing"
        descricao="Regras que trabalham sozinhas: imóvel novo ou com preço menor avisa quem tem o perfil; X dias depois da venda ou do início da locação, mensagem (ou tarefa) de pós-venda/pós-locação."
        acoes={
          <>
            <BotaoAcao acao={rodarAutomacoes} id="agora">
              <Play className="size-4" /> Rodar agora
            </BotaoAcao>
            <JanelaCadastro rotuloBotao={<><Workflow className="size-4" /> Nova automação</>} titulo="Nova automação" acao={criarAutomacao} icone={<Workflow />} larguraMax="max-w-2xl">
              <CamposAutomacao modelos={modelos ?? []} />
            </JanelaCadastro>
          </>
        }
      />
      <AbasMarketing />
      <div className="mb-4">
        <Aviso>
          As automações rodam sozinhas enquanto a equipe usa o sistema (qualquer tela, no máximo a cada 10 minutos) e pelo botão “Rodar agora”. Última vez:{" "}
          {formatarDataHora(cfg.automacoes_em)}. Imóvel novo ou preço que baixou sem automação ligada fica guardado por 30 dias: se você ligar a automação nesse prazo,
          ele ainda vale. Elas só montam a fila (ou criam tarefas, sem responsável): ninguém recebe nada sem passar pela fila de envio, e quem pediu para não receber
          fica de fora.
        </Aviso>
      </div>
      <Tabela colunas={["Automação", "Quando", "Faz", "Já fez", "Situação", ""]}>
        {autos.map((a) => (
          <LinhaLink key={a.id} href={`/marketing/automacoes/${a.id}`}>
            <Celula>
              <span className="font-semibold text-texto">{a.nome}</span>
              {a.modelo && <span className="block text-xs text-mudo">modelo: {a.modelo.nome}</span>}
            </Celula>
            <Celula className="text-sm text-texto-2">
              {ROTULO_GATILHO[a.gatilho]}
              {(a.gatilho === "pos_venda" || a.gatilho === "pos_locacao") && <span className="block text-xs text-mudo">{a.dias} dia(s) depois</span>}
              {a.gatilho === "reducao_preco" && Number(a.reducao_min_pct) > 0 && <span className="block text-xs text-mudo">redução de {String(a.reducao_min_pct).replace(".", ",")}% ou mais</span>}
            </Celula>
            <Celula className="text-sm text-texto-2">{a.acao === "tarefa" ? "Cria tarefa" : `Mensagem por ${ROTULO_CANAL[a.canal]}`}</Celula>
            <Celula className="text-sm tabular-nums text-texto-2">
              {a.mkt_envios?.[0]?.count ?? 0} mensagem(ns)
              {a.acao === "tarefa" && <span className="block text-xs">{a.mkt_execucoes?.[0]?.count ?? 0} tarefa(s)</span>}
            </Celula>
            <Celula>{a.ativa ? <Selo cor="verde">ativa</Selo> : <Selo>pausada</Selo>}</Celula>
            <Celula>
              <BotaoExcluir acao={excluirAutomacao} id={a.id} rotulo="Excluir automação" confirmar={`Excluir a automação "${a.nome}"? O que já foi para a fila continua lá.`} />
            </Celula>
          </LinhaLink>
        ))}
        {autos.length === 0 && <LinhaVazia colunas={6}>Nenhuma automação. Crie a primeira: por exemplo, “imóvel novo → WhatsApp para quem tem perfil”.</LinhaVazia>}
      </Tabela>

      <div className="mt-6">
        <Cartao titulo="Últimos acontecimentos nos imóveis">
          {!(eventos ?? []).length ? (
            <p className="text-sm text-mudo">Quando um imóvel ficar disponível ou o preço baixar, aparece aqui (e as automações correspondentes rodam).</p>
          ) : (
            <ul className="divide-y divide-borda-suave text-sm">
              {((eventos ?? []) as unknown as E[]).map((e) => (
                <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>
                    {e.imovel ? (
                      <Link href={`/imoveis/${e.imovel.id}`} className="font-semibold text-acento hover:underline">
                        {e.imovel.codigo}
                      </Link>
                    ) : (
                      "Imóvel"
                    )}{" "}
                    {e.tipo === "novo_imovel"
                      ? "ficou disponível"
                      : `baixou de ${formatarReais(Number(e.valor_anterior))} para ${formatarReais(Number(e.valor_novo))} (−${String(reducaoPct(e.valor_anterior, e.valor_novo)).replace(".", ",")}%)`}
                    <span className="block text-xs text-mudo">{formatarDataHora(e.criado_em)}</span>
                  </span>
                  {e.processado_em ? <span className="text-xs text-texto-2">{e.resultado}</span> : <Selo cor="amarelo">aguardando</Selo>}
                </li>
              ))}
            </ul>
          )}
        </Cartao>
      </div>
    </>
  );
}
