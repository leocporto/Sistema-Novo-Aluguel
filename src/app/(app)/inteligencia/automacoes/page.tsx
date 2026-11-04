import type { Metadata } from "next";
import Link from "next/link";
import { Play, Plus, Workflow } from "lucide-react";
import { BotaoAcao } from "@/components/botao-acao";
import { JanelaCadastro } from "@/components/janela-cadastro";
import { LinhaLink } from "@/components/linha-link";
import { Aviso, Cabecalho, Celula, LinhaVazia, Selo, Tabela } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { ROTULO_ACAO_REGRA, ROTULO_GATILHO_IA, ROTULO_STATUS_EXECUCAO, type AcaoRegra, type GatilhoIA } from "@/lib/dominio/ia";
import { AbasInteligencia } from "../abas";
import { criarRegra, rodarAutomacoesAgora } from "../actions";
import { carregarConfigIA, exigirOuVoltar, podeConfigurarIA, quando } from "../dados";
import { CamposRegra } from "./campos-regra";

export const metadata: Metadata = { title: "Automações" };

type Regra = { id: string; nome: string; gatilho: GatilhoIA; dias: number; acao: AcaoRegra; ativa: boolean; repetir_dias: number; ultima_execucao_em: string | null };
type Exec = { id: string; regra_nome: string | null; gatilho: string; acao: string; objeto_nome: string | null; dia: string; status: string; resultado: string | null; criado_em: string };

/**
 * Automações por regras configuráveis (nos dois modos; gatilhos de leads e
 * visitas só na imobiliária). Rodam sozinhas em segundo plano (no máximo a
 * cada 10 min), cada item uma vez por dia por regra.
 */
export default async function AutomacoesPage() {
  const { supabase, organizacao, papel } = await obterContexto();
  await exigirOuVoltar("configuracoes", "ver");
  const pode = podeConfigurarIA(papel);
  const [{ data: regras }, { data: execs }, cfg] = await Promise.all([
    supabase.from("automacoes_regras").select("id, nome, gatilho, dias, acao, ativa, repetir_dias, ultima_execucao_em").order("created_at"),
    supabase.from("automacoes_execucoes").select("id, regra_nome, gatilho, acao, objeto_nome, dia, status, resultado, criado_em").order("criado_em", { ascending: false }).limit(30),
    carregarConfigIA(supabase),
  ]);
  const lista = (regras ?? []) as Regra[];
  const ultimas = (execs ?? []) as Exec[];
  return (
    <>
      <Cabecalho
        titulo="Automações"
        trilha="Assistente e automações"
        descricao={
          organizacao.modo === "pessoal"
            ? "Regras simples: QUANDO algo acontece (aluguel vencido, contrato vencendo, garantia vencendo…) o sistema FAZ uma ação (avisa você aqui no Assistente ou sugere uma mensagem para aprovar). Rodam sozinhas em segundo plano."
            : "Regras simples: QUANDO algo acontece (lead parado, aluguel vencido, contrato vencendo…) o sistema FAZ uma ação (cria tarefa, avisa o responsável, sugere mensagem para aprovar, marca o lead). Rodam sozinhas em segundo plano."
        }
        acoes={
          pode ? (
            <>
              <BotaoAcao acao={rodarAutomacoesAgora} id="agora" confirmar="Rodar todas as automações agora?">
                <Play className="size-4" /> Rodar agora
              </BotaoAcao>
              <JanelaCadastro rotuloBotao={<><Plus className="size-4" /> Nova automação</>} titulo="Nova automação" acao={criarRegra} icone={<Workflow />} larguraMax="max-w-2xl">
                <CamposRegra modo={organizacao.modo} />
              </JanelaCadastro>
            </>
          ) : undefined
        }
      />
      <AbasInteligencia modo={organizacao.modo} />
      <div className="mb-5 space-y-3">
        <Aviso>
          Última rodada: {quando(cfg.automacoes_em)}. Cada item dispara a regra uma vez por dia (com “repetir” = 0, uma vez só). Mensagens a clientes nunca saem sozinhas: viram{" "}
          <Link href="/inteligencia/acoes" className="text-acento hover:underline">
            ações para aprovar
          </Link>
          .
          {organizacao.modo !== "pessoal" && (
            <>
              {" "}
              As automações de divulgação (imóvel novo, preço baixou, pós-venda e pós-locação) ficam em{" "}
              <Link href="/marketing/automacoes" className="text-acento hover:underline">
                Marketing → Automações
              </Link>
              .
            </>
          )}
        </Aviso>
        {!pode && <Aviso tipo="alerta">Você acompanha as automações. Só o administrador ou o gestor criam e mudam.</Aviso>}
      </div>
      <Tabela colunas={["Automação", "Quando", "Fazer", "Repete", "Última vez", "Situação"]}>
        {lista.length === 0 ? (
          <LinhaVazia colunas={6}>
            Nenhuma automação ainda. Comece com “Aluguel vencido há 3 dias → {organizacao.modo === "pessoal" ? "avisar o responsável" : "criar tarefa"}”.
          </LinhaVazia>
        ) : (
          lista.map((r) => (
            <LinhaLink key={r.id} href={`/inteligencia/automacoes/${r.id}`}>
              <Celula className="font-semibold">{r.nome}</Celula>
              <Celula className="text-texto-2">
                {ROTULO_GATILHO_IA[r.gatilho]} · {r.dias} dia(s)
              </Celula>
              <Celula className="text-texto-2">{ROTULO_ACAO_REGRA[r.acao]}</Celula>
              <Celula className="text-texto-2">{r.repetir_dias ? `a cada ${r.repetir_dias} dia(s)` : "uma vez"}</Celula>
              <Celula className="whitespace-nowrap text-texto-2">{quando(r.ultima_execucao_em)}</Celula>
              <Celula>{r.ativa ? <Selo cor="verde">Ligada</Selo> : <Selo cor="cinza">Desligada</Selo>}</Celula>
            </LinhaLink>
          ))
        )}
      </Tabela>
      <h2 className="mb-3 mt-8 text-[17px] font-semibold tracking-[-0.01em] text-texto">Últimos disparos</h2>
      <Tabela colunas={["Quando", "Automação", "Item", "Resultado", "Situação"]}>
        {ultimas.length === 0 ? (
          <LinhaVazia colunas={5}>Nada disparado ainda.</LinhaVazia>
        ) : (
          ultimas.map((e) => (
            <tr key={e.id}>
              <Celula className="whitespace-nowrap text-texto-2">{quando(e.criado_em)}</Celula>
              <Celula>{e.regra_nome ?? "—"}</Celula>
              <Celula>{e.objeto_nome ?? "—"}</Celula>
              <Celula className="text-[13px] text-texto-2">{e.resultado ?? "—"}</Celula>
              <Celula>
                <Selo cor={e.status === "ok" ? "verde" : e.status === "erro" ? "vermelho" : "cinza"}>{ROTULO_STATUS_EXECUCAO[e.status] ?? e.status}</Selo>
              </Celula>
            </tr>
          ))
        )}
      </Tabela>
    </>
  );
}
