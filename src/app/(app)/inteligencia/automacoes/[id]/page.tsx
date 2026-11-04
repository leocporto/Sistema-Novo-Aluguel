import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BotaoExcluir } from "@/components/botao-excluir";
import { Formulario } from "@/components/formulario";
import { Aviso, Cabecalho, Cartao, Celula, LinhaVazia, Selo, Tabela } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { ROTULO_STATUS_EXECUCAO, type AcaoRegra, type GatilhoIA } from "@/lib/dominio/ia";
import { AbasInteligencia } from "../../abas";
import { excluirRegra, salvarRegra } from "../../actions";
import { exigirOuVoltar, podeConfigurarIA, quando } from "../../dados";
import { CamposRegra } from "../campos-regra";

export const metadata: Metadata = { title: "Automação" };

type Regra = {
  id: string;
  nome: string;
  gatilho: GatilhoIA;
  dias: number;
  acao: AcaoRegra;
  ativa: boolean;
  repetir_dias: number;
  condicoes: Record<string, unknown>;
  acao_config: Record<string, unknown>;
  ultima_execucao_em: string | null;
};

/** Edição de uma automação (salva sozinha) e os disparos dela. */
export default async function AutomacaoPage({ params }: PageProps<"/inteligencia/automacoes/[id]">) {
  const { id } = await params;
  const { supabase, organizacao, papel } = await obterContexto();
  await exigirOuVoltar("configuracoes", "ver");
  const { data } = await supabase.from("automacoes_regras").select("*").eq("id", id).maybeSingle();
  if (!data) notFound();
  const r = data as Regra;
  const pode = podeConfigurarIA(papel);
  const { data: execs } = await supabase
    .from("automacoes_execucoes")
    .select("id, objeto_nome, objeto_tipo, dia, status, resultado, criado_em")
    .eq("regra_id", id)
    .order("criado_em", { ascending: false })
    .limit(100);
  const lista = (execs ?? []) as { id: string; objeto_nome: string | null; objeto_tipo: string; dia: string; status: string; resultado: string | null; criado_em: string }[];
  return (
    <>
      <Cabecalho
        titulo={r.nome}
        trilha="Automações"
        descricao={`Última rodada: ${quando(r.ultima_execucao_em)}.`}
        acoes={pode ? <BotaoExcluir acao={excluirRegra} id={r.id} variante="botao" confirmar="Excluir esta automação? O histórico dos disparos continua guardado." depois="/inteligencia/automacoes" /> : undefined}
      />
      <AbasInteligencia modo={organizacao.modo} />
      <div className="space-y-5">
        <Cartao titulo="Regra">
          {pode ? (
            <Formulario acao={salvarRegra} automatico>
              <input type="hidden" name="id" value={r.id} />
              <label className="flex items-center gap-2 text-sm text-texto">
                <input type="hidden" name="ativa" value="off" />
                <input type="checkbox" name="ativa" defaultChecked={r.ativa} className="size-4 accent-[var(--accent)]" /> Automação ligada
              </label>
              <CamposRegra modo={organizacao.modo} inicial={r} />
            </Formulario>
          ) : (
            <Aviso>Só o administrador ou o gestor mudam as automações.</Aviso>
          )}
        </Cartao>
        <Tabela colunas={["Quando", "Item", "Resultado", "Situação"]}>
          {lista.length === 0 ? (
            <LinhaVazia colunas={4}>Esta automação ainda não disparou.</LinhaVazia>
          ) : (
            lista.map((e) => (
              <tr key={e.id}>
                <Celula className="whitespace-nowrap text-texto-2">{quando(e.criado_em)}</Celula>
                <Celula>{e.objeto_nome ?? e.objeto_tipo}</Celula>
                <Celula className="text-[13px] text-texto-2">{e.resultado ?? "—"}</Celula>
                <Celula>
                  <Selo cor={e.status === "ok" ? "verde" : e.status === "erro" ? "vermelho" : "cinza"}>{ROTULO_STATUS_EXECUCAO[e.status] ?? e.status}</Selo>
                </Celula>
              </tr>
            ))
          )}
        </Tabela>
      </div>
    </>
  );
}
