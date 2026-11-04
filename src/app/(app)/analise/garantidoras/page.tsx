import type { Metadata } from "next";
import { CheckCircle2, Hourglass, Timer, TriangleAlert } from "lucide-react";
import { Contador } from "@/components/abas-segmentadas";
import { FiltroAutomatico } from "@/components/filtro-automatico";
import { LinhaLink } from "@/components/linha-link";
import { PilulasLink } from "@/components/pilulas-link";
import { Cabecalho, Celula, Entrada, Indicador, LinhaVazia, Selo, Tabela } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { COR_STATUS_GARANTIA_PROPOSTA, ROTULO_STATUS_GARANTIA_PROPOSTA } from "@/lib/dominio/analise";
import { diasEntre, formatarDataBR, hojeISO } from "@/lib/dominio/datas";
import { formatarReais } from "@/lib/dominio/dinheiro";
import { ROTULO_TIPO_GARANTIA } from "@/lib/dominio/garantias";
import { normalizar } from "@/lib/dominio/imoveis";
import { AbasAnalise } from "../abas";

export const metadata: Metadata = { title: "Garantidoras" };

const FILTROS: Record<string, { rotulo: string; status: string[] | null }> = {
  "": { rotulo: "Aguardando resposta", status: ["solicitada", "em_analise"] },
  propostas: { rotulo: "Ainda não enviadas", status: ["proposta"] },
  aprovadas: { rotulo: "Aprovadas", status: ["aprovada", "aprovada_restricao", "contratada"] },
  recusadas: { rotulo: "Recusadas", status: ["recusada"] },
  todas: { rotulo: "Todas", status: null },
};

type G = {
  id: string;
  analise_id: string;
  tipo: string;
  garantidora: string | null;
  proposta_numero: string | null;
  valor: number | null;
  premio: number | null;
  status: string;
  solicitada_em: string | null;
  respondida_em: string | null;
  resposta: string | null;
  analise: { numero: number; status: string; candidato: { nome: string } | null; imovel: { codigo: string } | null } | null;
};

/** Acompanhamento das propostas nas garantidoras (seguradoras, capitalizadoras, bancos). */
export default async function GarantidorasPage({ searchParams }: PageProps<"/analise/garantidoras">) {
  const sp = await searchParams;
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const filtro = s("filtro") in FILTROS ? s("filtro") : "";
  const busca = s("busca");
  const { supabase } = await obterContexto();
  const hoje = hojeISO();
  const { data } = await supabase
    .from("analise_garantias")
    .select("id, analise_id, tipo, garantidora, proposta_numero, valor, premio, status, solicitada_em, respondida_em, resposta, analise:analises(numero, status, candidato:pessoas!analises_candidato_id_fkey(nome), imovel:imoveis(codigo))")
    .neq("tipo", "fiador")
    .order("created_at", { ascending: false })
    .limit(1000);
  const todas = (data ?? []) as unknown as G[];
  const st = FILTROS[filtro].status;
  let lista = st ? todas.filter((g) => st.includes(g.status)) : todas;
  if (busca) {
    const b = normalizar(busca);
    lista = lista.filter((g) => normalizar([g.garantidora, g.proposta_numero, g.analise?.candidato?.nome, g.analise?.imovel?.codigo].join(" ")).includes(b));
  }
  const aguardando = todas.filter((g) => g.status === "solicitada" || g.status === "em_analise");
  const atrasadas = aguardando.filter((g) => g.solicitada_em && diasEntre(g.solicitada_em, hoje) > 3).length;
  const respondidas = todas.filter((g) => g.solicitada_em && g.respondida_em);
  const prazo = respondidas.length ? respondidas.reduce((a, g) => a + diasEntre(g.solicitada_em!, g.respondida_em!), 0) / respondidas.length : null;
  const aprov = todas.filter((g) => ["aprovada", "aprovada_restricao", "contratada"].includes(g.status)).length;
  const recus = todas.filter((g) => g.status === "recusada").length;
  const url = (k: string) => {
    const p = new URLSearchParams(Object.entries({ filtro: k, busca }).filter(([, v]) => v) as [string, string][]);
    const t = p.toString();
    return t ? `/analise/garantidoras?${t}` : "/analise/garantidoras";
  };

  return (
    <>
      <Cabecalho titulo="Garantidoras" trilha="Análise cadastral" descricao="Propostas de seguro-fiança, título de capitalização, carta-fiança e caução em análise: quem está esperando resposta e há quanto tempo." />
      <AbasAnalise />
      <div className="entrar-cascata mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Indicador rotulo="Aguardando resposta" icone={<Hourglass />} valor={<Contador valor={aguardando.length} />} tom={aguardando.length ? "alerta" : "neutro"} href={url("")} />
        <Indicador rotulo="Esperando há mais de 3 dias" icone={<TriangleAlert />} valor={<Contador valor={atrasadas} />} tom={atrasadas ? "perigo" : "sucesso"} detalhe="cobre a garantidora" />
        <Indicador rotulo="Prazo médio de resposta" icone={<Timer />} valor={prazo === null ? "—" : <Contador valor={prazo} />} detalhe="dias entre pedir e ter a resposta" />
        <Indicador
          rotulo="Taxa de aprovação"
          icone={<CheckCircle2 />}
          valor={aprov + recus ? <Contador valor={(aprov / (aprov + recus)) * 100} formato="pct" /> : "—"}
          detalhe={`${aprov} aprovada(s) · ${recus} recusada(s)`}
          tom="sucesso"
        />
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <PilulasLink rotulo="Situação" ativo={url(filtro)} itens={Object.entries(FILTROS).map(([k, f]) => ({ href: url(k), rotulo: f.rotulo }))} />
        <FiltroAutomatico className="flex flex-wrap gap-2">
          {filtro && <input type="hidden" name="filtro" value={filtro} />}
          <Entrada name="busca" aria-label="Buscar proposta" defaultValue={busca} placeholder="Buscar garantidora, proposta, candidato…" className="max-w-80" />
        </FiltroAutomatico>
      </div>
      <Tabela colunas={["Candidato", "Garantia", "Garantidora", "Valor / prêmio", "Pedida em", "Situação", "Resposta"]}>
        {lista.map((g) => {
          const espera = (g.status === "solicitada" || g.status === "em_analise") && g.solicitada_em ? diasEntre(g.solicitada_em, hoje) : null;
          return (
            <LinhaLink key={g.id} href={`/analise/${g.analise_id}/garantias`}>
              <Celula>
                <span className="font-medium text-texto">{g.analise?.candidato?.nome ?? "—"}</span>
                <span className="block text-xs text-mudo">
                  #{g.analise?.numero} {g.analise?.imovel ? `· ${g.analise.imovel.codigo}` : ""}
                </span>
              </Celula>
              <Celula>{ROTULO_TIPO_GARANTIA[g.tipo] ?? g.tipo}</Celula>
              <Celula>
                {g.garantidora ?? "—"}
                {g.proposta_numero && <span className="block text-xs text-mudo">proposta {g.proposta_numero}</span>}
              </Celula>
              <Celula className="tabular-nums">
                {g.valor !== null ? formatarReais(g.valor) : "—"}
                {g.premio !== null && <span className="block text-xs text-mudo">prêmio {formatarReais(g.premio)}</span>}
              </Celula>
              <Celula>
                {formatarDataBR(g.solicitada_em)}
                {espera !== null && <span className={`block text-xs ${espera > 3 ? "text-ruim" : "text-mudo"}`}>há {espera} dia(s)</span>}
              </Celula>
              <Celula>
                <Selo cor={COR_STATUS_GARANTIA_PROPOSTA[g.status]}>{ROTULO_STATUS_GARANTIA_PROPOSTA[g.status]}</Selo>
              </Celula>
              <Celula>
                <span className="text-xs text-texto-2">{g.resposta ?? (g.respondida_em ? formatarDataBR(g.respondida_em) : "—")}</span>
              </Celula>
            </LinhaLink>
          );
        })}
        {lista.length === 0 && <LinhaVazia colunas={7}>Nenhuma proposta aqui.</LinhaVazia>}
      </Tabela>
      <p className="mt-3 text-xs text-mudo">
        Envio e retorno automáticos com as seguradoras (API) ficam prontos para ligar quando houver contrato com a garantidora. Enquanto isso, atualize a situação na aba
        Garantias de cada candidato.
      </p>
    </>
  );
}
