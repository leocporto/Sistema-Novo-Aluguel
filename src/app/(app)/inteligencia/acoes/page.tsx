import type { Metadata } from "next";
import { CircleCheck, CircleDashed, CircleX, Hourglass } from "lucide-react";
import { Contador } from "@/components/abas-segmentadas";
import { LinhaLink } from "@/components/linha-link";
import { PilulasLink } from "@/components/pilulas-link";
import { Aviso, Cabecalho, Celula, Indicador, LinhaVazia, Selo, Tabela } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { formatarReais } from "@/lib/dominio/dinheiro";
import { COR_STATUS_ACAO, ROTULO_ORIGEM_ACAO, ROTULO_STATUS_ACAO, ROTULO_TIPO_ACAO, STATUS_ACAO_IA, type StatusAcaoIA, type TipoAcaoIA } from "@/lib/dominio/ia";
import { AbasInteligencia } from "../abas";
import { carregarConfigIA, quando } from "../dados";

export const metadata: Metadata = { title: "Ações para aprovar" };

type Linha = { id: string; numero: number; tipo: TipoAcaoIA; origem: string; titulo: string; valor: number | null; status: StatusAcaoIA; created_at: string; aprovacao_automatica: boolean };

/**
 * Caixa "Ações para aprovar": o que a IA ou as automações sugeriram e que mexe
 * em dados ou fala com cliente. Nada roda sem a aprovação de uma pessoa; cada
 * um vê o que pediu e o que pode decidir (o banco filtra).
 */
export default async function AcoesPage({ searchParams }: PageProps<"/inteligencia/acoes">) {
  const sp = await searchParams;
  const { supabase, organizacao } = await obterContexto();
  const filtro = (STATUS_ACAO_IA as readonly string[]).includes(String(sp.status)) ? (sp.status as StatusAcaoIA) : sp.status === "todas" ? "todas" : "pendente";
  let q = supabase.from("ia_acoes").select("id, numero, tipo, origem, titulo, valor, status, created_at, aprovacao_automatica").order("created_at", { ascending: false }).limit(200);
  if (filtro !== "todas") q = q.eq("status", filtro);
  const contar = (s: string) => supabase.from("ia_acoes").select("id", { count: "exact", head: true }).eq("status", s);
  const [{ data }, cfg, { count: pend }, { count: aprov }, { count: erros }, { count: feitas }] = await Promise.all([
    q,
    carregarConfigIA(supabase),
    contar("pendente"),
    contar("aprovada"),
    contar("erro"),
    contar("executada"),
  ]);
  const lista = (data ?? []) as Linha[];
  const base = "/inteligencia/acoes";
  return (
    <>
      <Cabecalho
        titulo="Ações para aprovar"
        trilha="Assistente e automações"
        descricao="Mensagens a clientes, mudanças de etapa ou responsável de lead, descontos, preços, cancelamento ou renegociação de cobrança, lançamentos e tarefas sugeridos pela IA ou pelas automações. Só rodam depois de aprovados — e pela via normal do sistema."
      />
      <AbasInteligencia modo={organizacao.modo} />
      {!cfg.exigir_aprovacao && (
        <div className="mb-4">
          <Aviso tipo="alerta">“Exigir aprovação” está desligado: quem tem permissão no módulo pode confirmar a própria sugestão. Mesmo assim, nada roda sem um clique de uma pessoa.</Aviso>
        </div>
      )}
      <div className="entrar-cascata mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Indicador rotulo="Esperando aprovação" valor={<Contador valor={pend ?? 0} />} icone={<Hourglass />} tom={pend ? "alerta" : "neutro"} href={base} />
        <Indicador rotulo="Aprovadas, falta fazer" valor={<Contador valor={aprov ?? 0} />} icone={<CircleDashed />} href={`${base}?status=aprovada`} detalhe="mensagens e acordos (passo humano)" />
        <Indicador rotulo="Deram erro" valor={<Contador valor={erros ?? 0} />} icone={<CircleX />} tom={erros ? "perigo" : "neutro"} href={`${base}?status=erro`} />
        <Indicador rotulo="Feitas" valor={<Contador valor={feitas ?? 0} />} icone={<CircleCheck />} tom="sucesso" href={`${base}?status=executada`} />
      </div>
      <PilulasLink
        className="mb-4"
        rotulo="Situação"
        ativo={filtro === "pendente" ? base : `${base}?status=${filtro}`}
        itens={[
          { href: base, rotulo: "Esperando" },
          ...(["aprovada", "executada", "recusada", "erro", "cancelada"] as const).map((s) => ({ href: `${base}?status=${s}`, rotulo: ROTULO_STATUS_ACAO[s] })),
          { href: `${base}?status=todas`, rotulo: "Todas" },
        ]}
      />
      <Tabela colunas={["Nº", "Ação", "O quê", "Origem", "Quando", "Valor", "Situação"]}>
        {lista.length === 0 ? (
          <LinhaVazia colunas={7}>{filtro === "pendente" ? "Nada esperando aprovação." : "Nenhuma ação nesta situação."}</LinhaVazia>
        ) : (
          lista.map((a) => (
            <LinhaLink key={a.id} href={`${base}/${a.id}`}>
              <Celula className="font-mono text-[12.5px] text-mudo">{a.numero}</Celula>
              <Celula className="whitespace-nowrap">{ROTULO_TIPO_ACAO[a.tipo]}</Celula>
              <Celula className="font-semibold">{a.titulo}</Celula>
              <Celula className="whitespace-nowrap text-[13px] text-texto-2">{ROTULO_ORIGEM_ACAO[a.origem] ?? a.origem}</Celula>
              <Celula className="whitespace-nowrap text-texto-2">{quando(a.created_at)}</Celula>
              <Celula className="tabular-nums">{a.valor !== null ? formatarReais(a.valor) : "—"}</Celula>
              <Celula>
                <Selo cor={COR_STATUS_ACAO[a.status]}>{a.aprovacao_automatica && a.status === "aprovada" ? "Pré-aprovada (regra)" : ROTULO_STATUS_ACAO[a.status]}</Selo>
              </Celula>
            </LinhaLink>
          ))
        )}
      </Tabela>
    </>
  );
}
