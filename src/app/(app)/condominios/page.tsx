import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, Building2, CalendarClock, Home, MessageSquareWarning, Plus } from "lucide-react";
import { Contador } from "@/components/abas-segmentadas";
import { JanelaCadastro } from "@/components/janela-cadastro";
import { LinhaLink } from "@/components/linha-link";
import { Cabecalho, Celula, Indicador, LinhaVazia, Selo, Tabela } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { hojeISO } from "@/lib/dominio/datas";
import { formatarReais, paraCentavos, paraReais } from "@/lib/dominio/dinheiro";
import { todas } from "../financeiro/dados";
import { criarCondominio } from "./actions";
import { CamposCondominio } from "./campos";

export const metadata: Metadata = { title: "Condomínios" };

type Linha = { id: string; nome: string; cidade: string | null; uf: string | null; ativo: boolean; sindico: { nome: string } | null };

/** Lista dos condomínios administrados (módulo opcional, só imobiliária). */
export default async function CondominiosPage() {
  const { supabase } = await obterContexto();
  const hoje = hojeISO();
  const [{ data }, unidades, atrasadas, ocorrencias, { data: assembleias }] = await Promise.all([
    supabase.from("cond_condominios").select("id, nome, cidade, uf, ativo, sindico:pessoas(nome)").order("nome"),
    todas<{ condominio_id: string }>(() => supabase.from("cond_unidades").select("condominio_id").order("id")),
    todas<{ condominio_id: string; unidade_id: string; valor: number; valor_abatido: number }>(() =>
      supabase.from("cond_cotas").select("condominio_id, unidade_id, valor, valor_abatido").eq("status", "aberta").lt("vencimento", hoje).order("id"),
    ),
    todas<{ condominio_id: string }>(() => supabase.from("cond_ocorrencias").select("condominio_id").in("status", ["aberta", "em_andamento"]).order("id")),
    supabase.from("cond_assembleias").select("id, condominio_id, titulo, data").in("status", ["convocada", "em_andamento"]).order("data").limit(20),
  ]);
  const lista = (data ?? []) as unknown as Linha[];
  const conta = <T extends { condominio_id: string }>(xs: T[], id: string) => xs.filter((x) => x.condominio_id === id);
  const devido = (id: string) => conta(atrasadas, id).reduce((a, c) => a + paraCentavos(c.valor) - paraCentavos(c.valor_abatido), 0);
  const totalDevido = atrasadas.reduce((a, c) => a + paraCentavos(c.valor) - paraCentavos(c.valor_abatido), 0);
  const unidadesDevendo = new Set(atrasadas.map((c) => c.unidade_id)).size;

  return (
    <>
      <Cabecalho
        titulo="Condomínios"
        descricao="Administração de condomínios: unidades e frações, cotas, inadimplência, fundo de reserva, prestação de contas, assembleias, comunicados, reservas e o portal do condômino. O dinheiro de cada condomínio fica no livro-caixa dele, separado do da imobiliária."
        acoes={
          <JanelaCadastro
            rotuloBotao={
              <>
                <Plus className="size-4" /> Novo condomínio
              </>
            }
            titulo="Cadastrar condomínio"
            acao={criarCondominio}
            icone={<Building2 />}
            larguraMax="max-w-3xl"
          >
            <CamposCondominio />
            <p className="text-xs text-mudo">A conta corrente e o fundo de reserva do condomínio são criados junto. O resto (síndico, Pix, taxa de administração) fica na ficha.</p>
          </JanelaCadastro>
        }
      />

      <div className="entrar-cascata mb-6 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Indicador rotulo="Condomínios" icone={<Building2 />} valor={<Contador valor={lista.filter((c) => c.ativo).length} />} detalhe={`${unidades.length} unidade(s) no total`} />
        <Indicador
          rotulo="Inadimplência"
          icone={<AlertTriangle />}
          tom={totalDevido > 0 ? "perigo" : "sucesso"}
          valor={<Contador valor={paraReais(totalDevido)} formato="moeda" />}
          detalhe={`${unidadesDevendo} unidade(s) com cota vencida (sem multa e juros)`}
        />
        <Indicador rotulo="Ocorrências abertas" icone={<MessageSquareWarning />} tom={ocorrencias.length ? "alerta" : "neutro"} valor={<Contador valor={ocorrencias.length} />} detalhe="abertas ou em andamento" />
        <Indicador rotulo="Assembleias marcadas" icone={<CalendarClock />} valor={<Contador valor={(assembleias ?? []).length} />} detalhe="convocadas ou em andamento" />
      </div>

      <Tabela colunas={["Condomínio", "Cidade", "Unidades", "Síndico", "Em atraso", "Ocorrências", ""]}>
        {lista.map((c) => (
          <LinhaLink key={c.id} href={`/condominios/${c.id}`}>
            <Celula>
              <Link href={`/condominios/${c.id}`} className="font-medium text-texto hover:underline">
                {c.nome}
              </Link>
            </Celula>
            <Celula className="text-texto-2">{[c.cidade, c.uf].filter(Boolean).join(" / ") || "—"}</Celula>
            <Celula className="tabular-nums">
              <span className="inline-flex items-center gap-1.5">
                <Home className="size-3.5 text-mudo" /> {conta(unidades, c.id).length}
              </span>
            </Celula>
            <Celula className="text-texto-2">{c.sindico?.nome ?? "—"}</Celula>
            <Celula className={`tabular-nums ${devido(c.id) > 0 ? "font-semibold text-ruim" : "text-mudo"}`}>{devido(c.id) > 0 ? formatarReais(paraReais(devido(c.id))) : "—"}</Celula>
            <Celula className="tabular-nums">{conta(ocorrencias, c.id).length || "—"}</Celula>
            <Celula>{!c.ativo && <Selo cor="cinza">inativo</Selo>}</Celula>
          </LinhaLink>
        ))}
        {lista.length === 0 && <LinhaVazia colunas={7}>Nenhum condomínio ainda. Clique em “Novo condomínio”.</LinhaVazia>}
      </Tabela>
    </>
  );
}
